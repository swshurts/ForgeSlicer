"""Per-user job history.

Logged-in users get every `/api/optimize` result persisted to MongoDB so
they can revisit + re-export days later without re-uploading the photo.
Anonymous users continue to use the existing in-memory `JOBS` dict only.
"""

from __future__ import annotations

import base64
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from PIL import Image
from pydantic import BaseModel


class JobSummary(BaseModel):
    job_id: str
    name: str
    created_at: str
    delta_e_mean: float
    total_layers: int
    filament_count: int
    thumbnail_base64: str  # tiny PNG, displayed in the history strip
    render_mode: str
    listed: bool = False


def _layer_map_to_b64(layer_map: np.ndarray) -> str:
    buf = io.BytesIO()
    np.save(buf, layer_map.astype(np.int32), allow_pickle=False)
    return base64.b64encode(buf.getvalue()).decode()


def _layer_map_from_b64(b: str) -> np.ndarray:
    buf = io.BytesIO(base64.b64decode(b))
    return np.load(buf, allow_pickle=False)


def _shrink_png_for_thumb(png_b64: str, max_dim: int = 160) -> str:
    """Re-encode the preview PNG at low res so the history strip is fast
    to load even for users with 100+ jobs."""
    try:
        raw = base64.b64decode(png_b64)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, "PNG", optimize=True)
        return base64.b64encode(out.getvalue()).decode()
    except Exception:
        return png_b64  # fall back to original — never break the save path


def _job_to_summary(doc: Dict[str, Any]) -> JobSummary:
    listing = doc.get("listing") or {}
    return JobSummary(
        job_id=doc["job_id"],
        name=doc.get("name", "Untitled"),
        created_at=_iso(doc.get("created_at")),
        delta_e_mean=float(doc.get("delta_e_mean", 0.0)),
        total_layers=int(doc.get("total_layers", 0)),
        filament_count=len(doc.get("filaments", [])),
        thumbnail_base64=doc.get("thumbnail_base64", ""),
        render_mode=doc.get("render_mode", "lithophane"),
        listed=listing.get("visibility") == "listed",
    )


def _iso(dt) -> str:
    if isinstance(dt, str):
        return dt
    if isinstance(dt, datetime):
        return dt.astimezone(timezone.utc).isoformat()
    return ""


from dataclasses import dataclass


@dataclass
class JobPersistData:
    """All fields needed to persist a completed optimize job to MongoDB.

    Bundled into a dataclass so call-sites don't pass 14+ positional/
    keyword args (which is fragile when fields are added).
    """
    job_id: str
    request: Dict[str, Any]
    filaments: List[Any]
    layer_map: np.ndarray
    layer_height_mm: float
    swap_heights_mm: List[float]
    swap_colors: List[str]
    allocation: List[int]
    total_layers: int
    delta_e_mean: float
    delta_e_p95: float
    preview_png_base64: str
    heightmap_png_base64: str
    timeline: List[Dict[str, Any]]


async def persist_job(
    db: AsyncIOMotorDatabase,
    user_id: str,
    data: JobPersistData,
) -> None:
    """Called from /api/optimize when a logged-in user finishes a job."""
    now = datetime.now(timezone.utc)
    auto_name = (
        f"{now.strftime('%b %d, %Y · %H:%M')} · "
        f"{len(data.filaments)} filaments · {data.total_layers} layers"
    )
    thumbnail = _shrink_png_for_thumb(data.preview_png_base64)
    doc = {
        "job_id": data.job_id,
        "user_id": user_id,
        "name": auto_name,
        "created_at": now,
        "render_mode": data.request.get("render_mode", "lithophane"),
        "request": data.request,
        "filaments": [
            {"name": f.name, "hex": f.hex, "td": float(f.td)}
            for f in data.filaments
        ],
        "allocation": list(data.allocation),
        "total_layers": int(data.total_layers),
        "delta_e_mean": float(data.delta_e_mean),
        "delta_e_p95": float(data.delta_e_p95),
        "swap_heights_mm": list(data.swap_heights_mm),
        "swap_colors": list(data.swap_colors),
        "layer_height_mm": float(data.layer_height_mm),
        "layer_map_b64": _layer_map_to_b64(data.layer_map),
        "preview_png_base64": data.preview_png_base64,
        "heightmap_png_base64": data.heightmap_png_base64,
        "thumbnail_base64": thumbnail,
        "timeline": data.timeline,
    }
    await db.jobs.insert_one(doc)


async def load_job(
    db: AsyncIOMotorDatabase, user_id: str, job_id: str
) -> Optional[Dict[str, Any]]:
    """Return the raw stored doc (without _id) or None."""
    return await db.jobs.find_one(
        {"user_id": user_id, "job_id": job_id}, {"_id": 0}
    )


async def load_job_any_owner(
    db: AsyncIOMotorDatabase, job_id: str
) -> Optional[Dict[str, Any]]:
    """Load a job by id without an owner constraint. Used by Phase B
    checkout — a buyer with a valid download_token needs the seller's job
    even though they don't own it."""
    return await db.jobs.find_one({"job_id": job_id}, {"_id": 0})


def hydrate_in_memory_job(stored: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a persisted job doc back into the same shape the in-memory
    JOBS dict uses, so the existing /api/export paths can serve it."""
    # Local import to avoid a hard cycle with server.py at module load.
    from .lithophane import Filament

    return {
        "image_id": stored["request"].get("image_id", ""),
        "layer_map": _layer_map_from_b64(stored["layer_map_b64"]),
        "layer_height_mm": stored["layer_height_mm"],
        "filaments": [Filament(**f) for f in stored["filaments"]],
        "swap_heights_mm": stored["swap_heights_mm"],
        "swap_colors": stored["swap_colors"],
        "allocation": stored["allocation"],
        "request": stored["request"],
    }


def build_jobs_router(
    db: AsyncIOMotorDatabase, require_user, in_memory_jobs: Dict[str, Any]
) -> APIRouter:
    router = APIRouter(prefix="/my-jobs", tags=["jobs"])

    @router.get("", response_model=List[JobSummary])
    async def list_jobs(user=Depends(require_user)):
        cursor = db.jobs.find(
            {"user_id": user.user_id},
            {
                "_id": 0,
                "job_id": 1,
                "name": 1,
                "created_at": 1,
                "delta_e_mean": 1,
                "total_layers": 1,
                "filaments": 1,
                "thumbnail_base64": 1,
                "render_mode": 1,
                "listing": 1,
            },
        ).sort("created_at", -1).limit(60)
        docs = await cursor.to_list(60)
        return [_job_to_summary(d) for d in docs]

    @router.get("/{job_id}")
    async def get_job(job_id: str, user=Depends(require_user)):
        doc = await load_job(db, user.user_id, job_id)
        if not doc:
            raise HTTPException(404, "Job not found")
        # Hydrate into the in-memory JOBS dict so the existing /api/export
        # endpoints can serve STL/3MF/txt immediately for restored jobs.
        in_memory_jobs[job_id] = hydrate_in_memory_job(doc)
        # Return the same payload shape /api/optimize returns so the
        # frontend can hydrate state in one go.
        return {
            "job_id": doc["job_id"],
            "name": doc["name"],
            "created_at": _iso(doc["created_at"]),
            "render_mode": doc.get("render_mode", "lithophane"),
            "request": doc["request"],
            "filaments": doc["filaments"],
            "allocation": doc["allocation"],
            "total_layers": doc["total_layers"],
            "delta_e_mean": doc["delta_e_mean"],
            "delta_e_p95": doc["delta_e_p95"],
            "swap_heights_mm": doc["swap_heights_mm"],
            "layer_height_mm": doc["layer_height_mm"],
            "preview_png_base64": doc["preview_png_base64"],
            "heightmap_png_base64": doc["heightmap_png_base64"],
            "timeline": doc["timeline"],
        }

    @router.delete("/{job_id}")
    async def delete_job(job_id: str, user=Depends(require_user)):
        result = await db.jobs.delete_one(
            {"user_id": user.user_id, "job_id": job_id}
        )
        if result.deleted_count == 0:
            raise HTTPException(404, "Job not found")
        in_memory_jobs.pop(job_id, None)
        return {"ok": True}

    return router

"""User-uploaded custom textures.

Stores grayscale heightmap-source images per user. The browser
converts whatever the user uploads (PNG / JPG / GIF) into a
≤256×256 grayscale PNG before POSTing, so the wire format and
the storage format match. We keep the image inline as a base64
data-URL — the entire texture fits in ~30-80 KB which is cheap
enough to embed directly in the document (no separate object
storage hop needed).

Schema (`custom_textures` collection):
  {
    texture_id:        str   # uuid4
    user_id:           str   # owner (indexed)
    name:              str   # user-facing label
    image_b64:         str   # data:image/png;base64,...
    thumb_b64:         str   # 64x64 preview (smaller, used in grid)
    tile_size_mm:      float # default mm one tile spans (UI default)
    default_height_mm: float # default relief height (UI default)
    default_invert:    bool  # flip light/dark by default
    default_fit:       str   # "tile" | "stretch"
    created_at:        ISO str
  }

Endpoints:
  GET    /api/textures        — list current user's saved textures
  POST   /api/textures        — upload a new one
  DELETE /api/textures/{tid}  — remove one
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional
import re
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


# Hard cap on the image data-URL to keep one document small. A
# 512×512 grayscale PNG with full opacity rounds out around 200 KB
# of base64; 800 KB ceiling keeps headroom for noisy / high-detail
# uploads while still leaving the whole "My Textures" list well
# under a few MB even with many uploads.
_MAX_IMAGE_B64_BYTES = 800_000
_MAX_THUMB_B64_BYTES = 30_000


class CustomTextureCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    image_b64: str = Field(..., min_length=32)
    thumb_b64: str = Field(..., min_length=32)
    tile_size_mm: float = Field(12.0, gt=0.1, le=200.0)
    default_height_mm: float = Field(1.2, gt=0.01, le=20.0)
    default_invert: bool = False
    default_fit: str = Field("tile", pattern="^(tile|stretch)$")


class CustomTexture(BaseModel):
    texture_id: str
    name: str
    image_b64: str
    thumb_b64: str
    tile_size_mm: float
    default_height_mm: float
    default_invert: bool
    default_fit: str
    created_at: str


_DATA_URL_PNG_RE = re.compile(r"^data:image/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_image(field: str, value: str, max_bytes: int) -> None:
    if not _DATA_URL_PNG_RE.match(value):
        raise HTTPException(
            status_code=400,
            detail=f"{field}: must be a data:image/png;base64 or data:image/jpeg;base64 URL",
        )
    # `value` is base64 — its length in chars is roughly its size in bytes.
    if len(value) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"{field}: image too large ({len(value)} > {max_bytes} bytes)",
        )


def build_custom_textures_router(db, get_current_user) -> APIRouter:
    """Wire up the /api/textures router. `db` is the Motor MongoDB
    instance; `get_current_user` is the standard auth dependency
    (raises 401 on missing / invalid session)."""
    router = APIRouter(prefix="/textures", tags=["textures"])

    @router.get("", response_model=List[CustomTexture])
    async def list_textures(request: Request):
        user = await get_current_user(request)
        cursor = db.custom_textures.find(
            {"user_id": user["user_id"]},
            {"_id": 0, "user_id": 0},
        ).sort("created_at", -1)
        docs = await cursor.to_list(length=500)
        return [CustomTexture(**d) for d in docs]

    @router.post("", response_model=CustomTexture)
    async def create_texture(item: CustomTextureCreate, request: Request):
        user = await get_current_user(request)
        _validate_image("image_b64", item.image_b64, _MAX_IMAGE_B64_BYTES)
        _validate_image("thumb_b64", item.thumb_b64, _MAX_THUMB_B64_BYTES)
        doc = {
            "texture_id": f"tex_{uuid.uuid4().hex[:16]}",
            "user_id": user["user_id"],
            "name": item.name.strip(),
            "image_b64": item.image_b64,
            "thumb_b64": item.thumb_b64,
            "tile_size_mm": float(item.tile_size_mm),
            "default_height_mm": float(item.default_height_mm),
            "default_invert": bool(item.default_invert),
            "default_fit": item.default_fit,
            "created_at": _now_iso(),
        }
        await db.custom_textures.insert_one(doc)
        return CustomTexture(**{k: v for k, v in doc.items() if k != "user_id"})

    @router.delete("/{tid}")
    async def delete_texture(tid: str, request: Request):
        user = await get_current_user(request)
        res = await db.custom_textures.delete_one(
            {"texture_id": tid, "user_id": user["user_id"]},
        )
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Texture not found")
        return {"ok": True}

    return router

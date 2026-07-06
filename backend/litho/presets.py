"""Cloud preset storage for logged-in users.

Anonymous users continue to use localStorage on the frontend; presets here
are scoped per-user and synced across devices once a user logs in.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field


class PresetFilament(BaseModel):
    name: str
    hex: str
    td: float = 3.0


class PresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    config: Dict[str, Any]
    filaments: List[PresetFilament]
    vibrancy: float = 0.5


class PresetOut(PresetIn):
    preset_id: str
    created_at: str
    updated_at: str


def build_presets_router(
    db: AsyncIOMotorDatabase, require_user
) -> APIRouter:
    router = APIRouter(prefix="/presets", tags=["presets"])

    def _to_iso(dt: Any) -> str:
        if isinstance(dt, str):
            return dt
        if isinstance(dt, datetime):
            return dt.astimezone(timezone.utc).isoformat()
        return ""

    def _doc_to_out(doc: Dict[str, Any]) -> PresetOut:
        return PresetOut(
            preset_id=doc["preset_id"],
            name=doc["name"],
            config=doc.get("config", {}),
            filaments=[PresetFilament(**f) for f in doc.get("filaments", [])],
            vibrancy=doc.get("vibrancy", 0.5),
            created_at=_to_iso(doc.get("created_at", "")),
            updated_at=_to_iso(doc.get("updated_at", "")),
        )

    @router.get("", response_model=List[PresetOut])
    async def list_presets(user=Depends(require_user)) -> List[PresetOut]:
        cursor = db.presets.find(
            {"user_id": user.user_id}, {"_id": 0}
        ).sort("updated_at", -1)
        docs = await cursor.to_list(200)
        return [_doc_to_out(d) for d in docs]

    @router.post("", response_model=PresetOut)
    async def create_preset(
        body: PresetIn, user=Depends(require_user)
    ) -> PresetOut:
        # Reject duplicate name within the same user's collection.
        existing = await db.presets.find_one(
            {"user_id": user.user_id, "name": body.name}, {"_id": 0}
        )
        if existing:
            raise HTTPException(409, "A preset with that name already exists")
        now = datetime.now(timezone.utc)
        doc = {
            "preset_id": f"preset_{uuid.uuid4().hex[:12]}",
            "user_id": user.user_id,
            "name": body.name,
            "config": body.config,
            "filaments": [f.model_dump() for f in body.filaments],
            "vibrancy": body.vibrancy,
            "created_at": now,
            "updated_at": now,
        }
        await db.presets.insert_one(doc)
        return _doc_to_out(doc)

    @router.delete("/{preset_id}")
    async def delete_preset(
        preset_id: str, user=Depends(require_user)
    ) -> Dict[str, bool]:
        result = await db.presets.delete_one(
            {"user_id": user.user_id, "preset_id": preset_id}
        )
        if result.deleted_count == 0:
            raise HTTPException(404, "Preset not found")
        return {"ok": True}

    @router.post("/import", response_model=List[PresetOut])
    async def import_presets(
        body: List[PresetIn], user=Depends(require_user)
    ) -> List[PresetOut]:
        """One-shot import of the user's localStorage presets after first
        login. Skips any preset whose name already exists in the cloud
        (so re-importing is idempotent)."""
        if not body:
            return []
        existing_names = {
            d["name"]
            for d in await db.presets.find(
                {"user_id": user.user_id}, {"name": 1, "_id": 0}
            ).to_list(500)
        }
        now = datetime.now(timezone.utc)
        new_docs = []
        for p in body:
            if p.name in existing_names:
                continue
            new_docs.append(
                {
                    "preset_id": f"preset_{uuid.uuid4().hex[:12]}",
                    "user_id": user.user_id,
                    "name": p.name,
                    "config": p.config,
                    "filaments": [f.model_dump() for f in p.filaments],
                    "vibrancy": p.vibrancy,
                    "created_at": now,
                    "updated_at": now,
                }
            )
            existing_names.add(p.name)
        if new_docs:
            await db.presets.insert_many(new_docs)
        return [_doc_to_out(d) for d in new_docs]

    return router

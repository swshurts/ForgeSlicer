"""LithoForge → ForgeSlicer inbox.

Receives finished STL / 3MF lithophanes from LithoForge.net (or any
trusted partner tool using the same Emergent SSO session) and queues
them for the user. When the user lands in ForgeSlicer, the workspace
polls /api/litho/inbox, surfaces a "1 new lithophane" notification,
and on click imports the file straight onto the build plate.

Auth: standard `get_current_user` — both tools share the same
Emergent session_token (cookie OR Authorization: Bearer). LithoForge
running on a sibling domain forwards the user's token in the POST.

File storage: GridFS (mongo-native) — lithophane STLs are typically
5-50 MB which busts the 16 MB BSON document limit, so we can't store
them inline. GridFS chunks them transparently and gives us back a
single ObjectId we keep on the inbox record.

Schema (`litho_inbox` collection):
    {
        inbox_id:        str   # uuid prefixed "litho_"
        user_id:         str   # owner (indexed)
        name:            str   # display label (e.g. "Family photo on cylinder")
        file_id:         ObjectId  # GridFS reference (collection litho_files.{files,chunks})
        file_size:       int   # bytes
        format:          str   # "stl" | "3mf"
        source_shape:    str   # "flat" | "curved" | "cylinder" | "disc" |
                               # "lightbox_rect" | "lightbox_circle"
        source_metadata: dict  # arbitrary {width, height, diameter, image_name, …}
        created_at:      ISO str
        consumed:        bool  # set True when user imports; kept around briefly
                               # so re-opens within a session still show the
                               # one they just imported (purged on a TTL job).
    }

Endpoints:
    POST   /api/litho/inbox              — partner tool drops a file here.
    GET    /api/litho/inbox              — list pending items for current user.
    GET    /api/litho/inbox/{id}/download — stream the binary back to FS frontend.
    DELETE /api/litho/inbox/{id}         — remove (called after import).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import json
import uuid

from bson import ObjectId
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel


# 100 MB hard cap — lithophanes up to ~25 megavertex / 50MB are
# realistic; 100 MB leaves head-room for high-detail circular
# lightbox panels without inviting abuse.
_MAX_FILE_BYTES = 100 * 1024 * 1024

_ALLOWED_FORMATS = {"stl", "3mf"}
_ALLOWED_SHAPES = {
    "flat", "curved", "cylinder", "disc",
    "lightbox_rect", "lightbox_circle",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LithoInboxItem(BaseModel):
    inbox_id: str
    name: str
    file_size: int
    format: str
    source_shape: str
    source_metadata: Dict[str, Any]
    created_at: str
    consumed: bool


def build_litho_inbox_router(db, get_current_user) -> APIRouter:
    """Build the /api/litho/inbox router. `db` is the motor mongo
    instance; `get_current_user` is the standard auth dependency.

    Uses GridFS bucket `litho_files` on the same db for the file
    payloads — avoids a separate storage backend dependency."""
    router = APIRouter(prefix="/litho/inbox", tags=["litho-inbox"])
    gridfs = AsyncIOMotorGridFSBucket(db, bucket_name="litho_files")

    @router.post("", response_model=LithoInboxItem)
    async def receive_lithophane(
        request: Request,
        file: UploadFile = File(...),
        name: str = Form(...),
        format: str = Form(...),
        source_shape: str = Form(...),
        source_metadata: Optional[str] = Form(None),  # JSON-encoded dict
    ):
        user = await get_current_user(request)
        fmt = (format or "").strip().lower()
        if fmt not in _ALLOWED_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=f"format must be one of {sorted(_ALLOWED_FORMATS)}",
            )
        shape = (source_shape or "").strip().lower()
        if shape not in _ALLOWED_SHAPES:
            raise HTTPException(
                status_code=400,
                detail=f"source_shape must be one of {sorted(_ALLOWED_SHAPES)}",
            )
        meta: Dict[str, Any] = {}
        if source_metadata:
            try:
                meta = json.loads(source_metadata)
                if not isinstance(meta, dict):
                    raise ValueError("source_metadata JSON must be an object")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"source_metadata: invalid JSON ({e})")

        # Stream upload through GridFS, enforcing size cap on the fly
        # so a misbehaving partner can't OOM us by sending a 5 GB file.
        gridfs_stream = gridfs.open_upload_stream(
            filename=f"{name}.{fmt}",
            metadata={"user_id": user["user_id"], "format": fmt},
        )
        total = 0
        try:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB at a time
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_FILE_BYTES:
                    await gridfs_stream.abort()
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large (>{_MAX_FILE_BYTES // (1024*1024)} MB cap)",
                    )
                await gridfs_stream.write(chunk)
            await gridfs_stream.close()
        except HTTPException:
            raise
        except Exception as e:
            try: await gridfs_stream.abort()
            except Exception: pass
            raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

        doc = {
            "inbox_id": f"litho_{uuid.uuid4().hex[:16]}",
            "user_id": user["user_id"],
            "name": (name or "Lithophane").strip()[:120],
            "file_id": gridfs_stream._id,
            "file_size": total,
            "format": fmt,
            "source_shape": shape,
            "source_metadata": meta,
            "created_at": _now_iso(),
            "consumed": False,
        }
        await db.litho_inbox.insert_one(doc)
        return LithoInboxItem(**{k: v for k, v in doc.items()
                                  if k not in {"user_id", "file_id"}})

    @router.get("", response_model=List[LithoInboxItem])
    async def list_inbox(request: Request):
        user = await get_current_user(request)
        cursor = db.litho_inbox.find(
            {"user_id": user["user_id"], "consumed": False},
            {"_id": 0, "user_id": 0, "file_id": 0},
        ).sort("created_at", -1)
        docs = await cursor.to_list(length=50)
        return [LithoInboxItem(**d) for d in docs]

    @router.get("/{inbox_id}/download")
    async def download_inbox_item(inbox_id: str, request: Request):
        user = await get_current_user(request)
        doc = await db.litho_inbox.find_one({
            "inbox_id": inbox_id,
            "user_id": user["user_id"],
        })
        if not doc:
            raise HTTPException(status_code=404, detail="Inbox item not found")

        # Stream out of GridFS so we don't materialise the whole file in
        # memory. We mark consumed=True opportunistically here — the
        # frontend will also call DELETE after a successful import to
        # release the GridFS chunks.
        stream = await gridfs.open_download_stream(doc["file_id"])
        async def iterator():
            try:
                while True:
                    chunk = await stream.readchunk()
                    if not chunk:
                        break
                    yield chunk
            finally:
                await stream.close()

        await db.litho_inbox.update_one(
            {"_id": doc["_id"]},
            {"$set": {"consumed": True}},
        )
        return StreamingResponse(
            iterator(),
            media_type="application/octet-stream" if doc["format"] == "stl" else "model/3mf",
            headers={
                "Content-Disposition": f'attachment; filename="{doc["name"]}.{doc["format"]}"',
                "Content-Length": str(doc["file_size"]),
            },
        )

    @router.delete("/{inbox_id}")
    async def delete_inbox_item(inbox_id: str, request: Request):
        user = await get_current_user(request)
        doc = await db.litho_inbox.find_one_and_delete({
            "inbox_id": inbox_id,
            "user_id": user["user_id"],
        })
        if not doc:
            raise HTTPException(status_code=404, detail="Inbox item not found")
        # Cleanup the GridFS payload too — orphaned blobs otherwise.
        try:
            await gridfs.delete(doc["file_id"])
        except Exception:
            # GridFS file might already be gone (e.g. previous partial
            # cleanup) — don't error the user-facing DELETE for that.
            pass
        return {"ok": True}

    return router

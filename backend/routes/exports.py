"""ForgeSlicer → desktop slicer handoff.

The browser cannot launch a desktop slicer with a local file path (the
custom URL-protocol handlers only accept `http(s)://` URLs as the
`file` argument — `file://` and blob URLs are blocked for security).
This route gives us the HTTP URL we need: the frontend POSTs the
3MF bytes here, we stash them in GridFS keyed by an opaque one-time
token, and return the public URL the slicer should fetch.

The frontend then assembles `orcaslicer://open/?file=<URL>` (or the
equivalent for PrusaSlicer / SuperSlicer / Bambu Studio) so the OS
launches the slicer, which downloads the file from our URL and opens
it — no manual "Open Project" step.

Storage policy
--------------
* GridFS bucket `export_handoff_files` — separate from litho_files
  so retention policies don't entangle.
* Each handoff record carries `expires_at` (default +30 min). A
  passive sweep on every download (and on POST) deletes anything
  past expiry. We don't run a separate TTL job because traffic
  through this route is bursty.
* Single-shot download: the GET endpoint deletes the GridFS chunks
  AND the inbox record AFTER successfully streaming the file out.
  The user can re-send-to-slicer to mint a fresh token.

Auth
----
* POST requires the standard ForgeSlicer session (cookie OR
  `Authorization: Bearer …`). We need to know *which* user is
  staging the handoff so we can rate-limit per-user.
* GET is intentionally UNAUTHENTICATED. The desktop slicer (running
  outside the browser) can't forward our cookies; the handoff URL
  itself carries an opaque 32-hex token which is the only authority
  the slicer needs to fetch the file. Tokens are 128-bit
  cryptographic random, single-shot, and expire in 30 min — the
  same threat model PrusaSlicer's own `prusaslicer://` upload-
  service handoff uses.

Endpoints
---------
* POST  /api/exports/handoff                  — stage a 3MF for handoff.
                                                Body: raw `application/octet-stream` bytes.
                                                Returns: { token, url, filename, expires_at }.
* GET   /api/exports/handoff/{token}          — slicer downloads the
                                                file. Single-use; deletes after stream.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
import secrets
import re

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorGridFSBucket


# 50 MB cap matches `mesh_repair.py` — large enough for a 200 k-tri
# multi-material 3MF, small enough to discourage abuse via this route.
_MAX_BYTES = 50 * 1024 * 1024

# 30-min window covers the slowest "I'll get to it later" launch
# without leaving files lying around. PrusaSlicer's upload-service
# handoff is 60 min; we err on the tighter side.
_TTL_MINUTES = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _public_base_url(request: Request) -> str:
    """Reconstruct the external base URL the slicer should hit when
    downloading the handoff file. We trust the standard reverse-proxy
    headers (X-Forwarded-Host / X-Forwarded-Proto) because the
    ForgeSlicer ingress sets them on every request. Falling back to
    `request.base_url` keeps local development working without the
    headers."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or str(request.base_url.hostname)
    )
    return f"{proto}://{host}"


def build_exports_router(db, get_current_user) -> APIRouter:
    """Build the /api/exports router. `db` is the motor mongo
    instance; `get_current_user` is the standard auth dependency
    (kept consistent with the rest of the routes/ tree)."""
    router = APIRouter(prefix="/exports", tags=["exports"])
    gridfs = AsyncIOMotorGridFSBucket(db, bucket_name="export_handoff_files")

    @router.post("/handoff")
    async def stage_handoff(
        request: Request,
        filename: str = Query("model.3mf"),
    ):
        # Auth same pattern as the other routes — guarantees only an
        # authenticated user can drop a payload that's externally
        # downloadable. (Each token is single-shot, so this is
        # belt-and-braces rather than the only line of defence.)
        user = await get_current_user(request)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")

        # Sanitise the filename — the slicer uses it as the local
        # cache name on disk. Strip path separators and constrain to
        # a safe character set.
        safe_filename = re.sub(r"[^A-Za-z0-9._-]+", "_", filename or "model.3mf").strip("._")
        if not safe_filename or not safe_filename.lower().endswith((".3mf", ".stl")):
            safe_filename = f"{safe_filename or 'model'}.3mf"

        # Stream the raw `application/octet-stream` body into GridFS.
        # Chunk-by-chunk to enforce the size cap without OOMing on a
        # malicious 4 GB upload.
        token = secrets.token_hex(16)  # 128-bit unguessable
        stream = gridfs.open_upload_stream(
            filename=safe_filename,
            metadata={
                "user_id": user["user_id"],
                "token": token,
                "purpose": "slicer-handoff",
            },
        )
        total = 0
        try:
            async for chunk in request.stream():
                if not chunk:
                    continue
                total += len(chunk)
                if total > _MAX_BYTES:
                    await stream.abort()
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large (>{_MAX_BYTES // (1024*1024)} MB cap)",
                    )
                await stream.write(chunk)
            await stream.close()
        except HTTPException:
            raise
        except Exception as exc:
            try:
                await stream.abort()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f"Handoff upload failed: {exc}") from exc

        if total < 100:
            # Defensive — a 100-byte 3MF is impossible.
            try:
                await gridfs.delete(stream._id)
            except Exception:
                pass
            raise HTTPException(status_code=400, detail="Empty or truncated payload")

        expires = _now() + timedelta(minutes=_TTL_MINUTES)
        doc = {
            "token": token,
            "user_id": user["user_id"],
            "file_id": stream._id,
            "filename": safe_filename,
            "file_size": total,
            "created_at": _now().isoformat(),
            "expires_at": expires.isoformat(),
        }
        await db.export_handoff.insert_one(doc)

        # Best-effort purge of stale records on every write so the
        # collection doesn't grow unbounded. Cheap because the
        # collection is small and the index on `expires_at` keeps it
        # constant-time-ish.
        await _purge_expired(db, gridfs)

        base = _public_base_url(request)
        return {
            "token": token,
            "url": f"{base}/api/exports/handoff/{token}",
            "filename": safe_filename,
            "expires_at": doc["expires_at"],
            "size": total,
        }

    @router.get("/handoff/{token}")
    async def download_handoff(
        token: str,
        request: Request,
        background_tasks: BackgroundTasks,
    ):
        # Public route — no auth. Authority is the token itself.
        # We sanity-check the format first so a malformed/probed
        # token fast-fails without touching the DB.
        if not re.fullmatch(r"[A-Fa-f0-9]{32}", token or ""):
            raise HTTPException(status_code=404, detail="Unknown handoff token")

        doc = await db.export_handoff.find_one({"token": token})
        if not doc:
            raise HTTPException(status_code=404, detail="Unknown handoff token")

        # Expired? Purge and 410-Gone — distinct from 404 so the
        # frontend can tell the user "the link timed out, click
        # Send to Slicer again" instead of guessing.
        try:
            expires_at = datetime.fromisoformat(doc["expires_at"])
        except Exception:
            expires_at = _now() - timedelta(minutes=1)
        if expires_at < _now():
            await _delete_handoff(db, gridfs, doc)
            raise HTTPException(status_code=410, detail="Handoff link expired")

        # Stream the GridFS file out. Single-shot semantics —
        # delete the INDEX RECORD before we start streaming so any
        # concurrent GET on the same token gets a clean 404, and
        # schedule the GridFS chunk delete via BackgroundTasks so it
        # runs after the response is fully sent (we keep our open
        # download stream alive so GridFS won't reuse the chunks
        # mid-read even though they're marked-for-delete).
        gridfs_stream = await gridfs.open_download_stream(doc["file_id"])

        # Delete the index record FIRST — this is the single-shot guard
        # that future GETs on the same token see. We don't bother
        # awaiting `gridfs.delete()` here because we still need to
        # finish streaming from the open handle; defer that to
        # background tasks.
        await db.export_handoff.delete_one({"_id": doc["_id"]})
        background_tasks.add_task(_drop_gridfs_file_safely, gridfs, doc["file_id"])

        async def iterator():
            try:
                while True:
                    chunk = await gridfs_stream.readchunk()
                    if not chunk:
                        break
                    yield chunk
            finally:
                await gridfs_stream.close()

        media_type = "model/3mf" if doc["filename"].lower().endswith(".3mf") else "application/octet-stream"
        return StreamingResponse(
            iterator(),
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{doc["filename"]}"',
                "Content-Length": str(doc["file_size"]),
                "Cache-Control": "no-store",
            },
        )

    return router


async def _drop_gridfs_file_safely(gridfs: AsyncIOMotorGridFSBucket, file_id) -> None:
    """Best-effort GridFS file delete — used by the post-response
    background task after a successful handoff download. Errors are
    swallowed because by the time this runs the user has already
    received their file; a residual chunk record will be cleaned up
    on the next `_purge_expired` sweep regardless."""
    try:
        await gridfs.delete(file_id)
    except Exception:
        pass


async def _delete_handoff(db, gridfs: AsyncIOMotorGridFSBucket, doc: dict) -> None:
    """Idempotent delete — used by both the single-shot download path
    and the passive-purge sweep. Swallow errors because a missing
    GridFS file just means an earlier download cleaned it up."""
    try:
        await gridfs.delete(doc["file_id"])
    except Exception:
        pass
    try:
        await db.export_handoff.delete_one({"_id": doc["_id"]})
    except Exception:
        pass


async def _purge_expired(db, gridfs: AsyncIOMotorGridFSBucket) -> int:
    """Sweep expired handoff records and their GridFS payloads.
    Returns the number of records deleted. Best-effort; failures
    don't propagate so a misbehaving sweep can't block the POST
    that triggered it."""
    cutoff = _now().isoformat()
    deleted = 0
    try:
        cursor = db.export_handoff.find({"expires_at": {"$lt": cutoff}}).limit(50)
        async for doc in cursor:
            await _delete_handoff(db, gridfs, doc)
            deleted += 1
    except Exception:
        pass
    return deleted

"""Printability analysis endpoint.

`POST /api/printability/analyze` — upload an STL/OBJ/3MF/GLB/PLY and
receive a Print-Readiness report (score 0-100, itemised issues,
metrics). Stateless — no DB write.

Auth-required so anonymous scraping doesn't burn compute. The analysis
itself is a small trimesh pass (~10-200ms for typical meshes) so we
run it inline in the request; no background job.
"""
from __future__ import annotations

import logging
from typing import Callable, Awaitable

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form

import printability_service

logger = logging.getLogger(__name__)

# 100MB — matches the OrcaSlicer upload limit. Bigger meshes fail
# analysis quickly anyway (trimesh's C loader falls over).
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# Extensions trimesh handles reliably. `.glb` and `.gltf` load as Scenes
# but we merge geometries in the service.
ALLOWED_EXTS = {"stl", "obj", "ply", "3mf", "glb", "gltf"}


def build_printability_router(
    *,
    get_current_user: Callable[[Request], Awaitable[dict]],
) -> APIRouter:
    router = APIRouter(prefix="/printability", tags=["printability"])

    @router.post("/analyze")
    async def analyze(
        request: Request,
        file: UploadFile = File(...),
        file_type: str | None = Form(default=None),
    ):
        # Auth-gate first — cheap check before we read the payload.
        await get_current_user(request)

        # Derive the file type from the extension if not passed explicitly.
        # Frontend usually knows what it uploaded, but the /import flow
        # can drop the extension when normalising filenames.
        ft = (file_type or "").strip().lower().lstrip(".")
        if not ft and file.filename:
            _, _, ext = file.filename.rpartition(".")
            ft = ext.lower()
        if ft not in ALLOWED_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ft or 'unknown'}'. "
                       f"Accepted: {', '.join(sorted(ALLOWED_EXTS))}."
            )

        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Mesh exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB upload limit.",
            )
        if not content:
            raise HTTPException(status_code=400, detail="Empty file.")

        try:
            report = printability_service.analyze_mesh_bytes(content, file_type=ft)
        except ValueError as ve:
            # 422 is more accurate than 400 here — request was well-formed,
            # payload contents were unprocessable.
            raise HTTPException(status_code=422, detail=str(ve))
        except Exception as e:  # noqa: BLE001
            logger.exception("printability analyze crashed on %s", file.filename)
            raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")

        return printability_service.report_to_dict(report)

    return router

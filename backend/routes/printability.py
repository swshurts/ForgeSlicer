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
from fastapi.responses import Response

import printability_service
import mesh_optimize_service

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

    # ------------------- Iter-134 mesh-fix endpoints ---------------------
    # These consume the same upload shape as /analyze (multipart file +
    # optional file_type form field) but stream a decimated / based
    # STL back as the response body. Auth-gated identical to analyze.

    def _read_upload_and_type(file: UploadFile, file_type: str | None) -> tuple[bytes, str]:
        ft = (file_type or "").strip().lower().lstrip(".")
        if not ft and file.filename:
            _, _, ext = file.filename.rpartition(".")
            ft = ext.lower()
        if ft not in ALLOWED_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ft or 'unknown'}'. Accepted: {', '.join(sorted(ALLOWED_EXTS))}.",
            )
        return ft, ft  # placeholder — real read happens on the coroutine

    @router.post("/decimate")
    async def decimate(
        request: Request,
        file: UploadFile = File(...),
        preset: str = Form(...),
        file_type: str | None = Form(default=None),
    ):
        """Decimate a mesh to a print-intent preset. See
        ``mesh_optimize_service.DECIMATE_PRESETS`` for the tuning
        matrix. Returns a binary STL alongside before/after metrics
        in JSON-encoded ``X-Optimize-Meta`` and ``X-Optimize-Faces-*``
        headers — the frontend uses those to update the report card
        without a second request."""
        await get_current_user(request)
        ft = (file_type or "").strip().lower().lstrip(".")
        if not ft and file.filename:
            _, _, ext = file.filename.rpartition(".")
            ft = ext.lower()
        if ft not in ALLOWED_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ft or 'unknown'}'. Accepted: {', '.join(sorted(ALLOWED_EXTS))}.",
            )
        preset_key = (preset or "").strip().lower()
        if preset_key not in mesh_optimize_service.DECIMATE_PRESETS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown preset {preset_key!r}. Valid: {', '.join(mesh_optimize_service.DECIMATE_PRESETS)}.",
            )
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"Mesh exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.")
        if not content:
            raise HTTPException(status_code=400, detail="Empty file.")
        try:
            result = mesh_optimize_service.decimate_with_intent(content, preset_key, file_type=ft)
        except ValueError as ve:
            raise HTTPException(status_code=422, detail=str(ve))
        except Exception as e:  # noqa: BLE001
            logger.exception("decimate crashed on %s (preset=%s)", file.filename, preset_key)
            raise HTTPException(status_code=500, detail=f"Decimation failed: {e}")

        return Response(
            content=result["stl_bytes"],
            media_type="model/stl",
            headers={
                "X-Optimize-Preset": result["preset"],
                "X-Optimize-Preset-Label": result["preset_label"],
                "X-Optimize-Faces-Before": str(result["before"]["faces"]),
                "X-Optimize-Faces-After": str(result["after"]["faces"]),
                "X-Optimize-Reduction-Pct": str(result["reduction_pct"]),
                "Content-Disposition": f'attachment; filename="decimated_{preset_key}.stl"',
            },
        )

    @router.post("/add-base")
    async def add_base(
        request: Request,
        file: UploadFile = File(...),
        shape: str = Form("cylinder"),
        thickness_mm: float = Form(3.0),
        margin_mm: float = Form(2.0),
        file_type: str | None = Form(default=None),
    ):
        """Fuse a printable pad under an unstable AI mesh. See
        ``mesh_optimize_service.add_auto_base`` for parameter meanings
        and units. Response headers carry the metadata so the report
        card can update in-place."""
        await get_current_user(request)
        ft = (file_type or "").strip().lower().lstrip(".")
        if not ft and file.filename:
            _, _, ext = file.filename.rpartition(".")
            ft = ext.lower()
        if ft not in ALLOWED_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ft or 'unknown'}'. Accepted: {', '.join(sorted(ALLOWED_EXTS))}.",
            )
        shape_key = (shape or "").strip().lower()
        if shape_key not in ("cylinder", "rectangle"):
            raise HTTPException(status_code=400, detail=f"shape must be 'cylinder' or 'rectangle', got {shape_key!r}")
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"Mesh exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.")
        if not content:
            raise HTTPException(status_code=400, detail="Empty file.")
        try:
            result = mesh_optimize_service.add_auto_base(
                content,
                shape=shape_key,
                thickness_mm=thickness_mm,
                margin_mm=margin_mm,
                file_type=ft,
            )
        except ValueError as ve:
            raise HTTPException(status_code=422, detail=str(ve))
        except Exception as e:  # noqa: BLE001
            logger.exception("add_base crashed on %s (shape=%s)", file.filename, shape_key)
            raise HTTPException(status_code=500, detail=f"Add-base failed: {e}")

        return Response(
            content=result["stl_bytes"],
            media_type="model/stl",
            headers={
                "X-Optimize-Shape": result["shape"],
                "X-Optimize-Thickness-Mm": str(result["thickness_mm"]),
                "X-Optimize-Margin-Mm": str(result["margin_mm"]),
                "X-Optimize-Base-Footprint-Mm2": str(result["base_footprint_mm2"]),
                "X-Optimize-Faces-Before": str(result["before_faces"]),
                "X-Optimize-Faces-After": str(result["after_faces"]),
                "Content-Disposition": f'attachment; filename="based_{shape_key}.stl"',
            },
        )

    @router.get("/decimate-presets")
    async def decimate_presets(request: Request):
        """List available decimate presets so the UI can render them
        without hardcoding the tuning matrix. Auth-gated to match the
        rest of the router — anonymous access isn't a leak but it's
        also not useful."""
        await get_current_user(request)
        return {
            "presets": [
                {"key": k, "label": v["label"], "target_faces": v["target_faces"], "min_faces": v["min_faces"]}
                for k, v in mesh_optimize_service.DECIMATE_PRESETS.items()
            ],
        }

    @router.post("/thicken-walls")
    async def thicken_walls(
        request: Request,
        file: UploadFile = File(...),
        target_thickness_mm: float = Form(1.2),
        file_type: str | None = Form(default=None),
    ):
        """Selectively thicken walls thinner than ``target_thickness_mm``.
        See ``mesh_optimize_service.thicken_walls`` for the per-vertex
        ray-cast + normal-offset rationale. Only vertices in genuinely
        thin regions move; the overall silhouette is preserved."""
        await get_current_user(request)
        ft = (file_type or "").strip().lower().lstrip(".")
        if not ft and file.filename:
            _, _, ext = file.filename.rpartition(".")
            ft = ext.lower()
        if ft not in ALLOWED_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ft or 'unknown'}'. Accepted: {', '.join(sorted(ALLOWED_EXTS))}.",
            )
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"Mesh exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.")
        if not content:
            raise HTTPException(status_code=400, detail="Empty file.")
        try:
            result = mesh_optimize_service.thicken_walls(
                content, target_thickness_mm=target_thickness_mm, file_type=ft,
            )
        except ValueError as ve:
            raise HTTPException(status_code=422, detail=str(ve))
        except Exception as e:  # noqa: BLE001
            logger.exception("thicken_walls crashed on %s (target=%s)", file.filename, target_thickness_mm)
            raise HTTPException(status_code=500, detail=f"Thicken failed: {e}")

        return Response(
            content=result["stl_bytes"],
            media_type="model/stl",
            headers={
                "X-Optimize-Target-Mm": str(result["target_thickness_mm"]),
                "X-Optimize-Faces-Before": str(result["before_faces"]),
                "X-Optimize-Faces-After": str(result["after_faces"]),
                "X-Optimize-Thin-Verts-Fixed": str(result["thin_verts_fixed"]),
                "Content-Disposition": 'attachment; filename="thickened.stl"',
            },
        )

    return router

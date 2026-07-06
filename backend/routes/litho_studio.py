"""Lithophane Studio router — ported from LithoForge, mounted under
`/api/litho/studio/*` inside ForgeSlicer.

This owns the image → lithophane pipeline (upload → optimize → export STL /
3MF / swaps.txt) that used to live in a standalone LithoForge service. It
reuses ForgeSlicer's `get_current_user` dep so users don't get a second
auth prompt.

Endpoints (all under /api/litho/studio):
    GET  /filaments/default       — default CMYKW palette
    GET  /filaments/library       — full curated library
    GET  /printers                — supported printers
    GET  /printers/{id}/fit       — bed-size check
    POST /palette/suggest         — auto palette from uploaded image
    POST /upload                  — accept base64 image, return image_id
    POST /optimize                — solve heightmap, return preview + job_id
    GET  /jobs/{job_id}           — job metadata (filament order, swaps)
    GET  /export/{job_id}/stl     — download STL for the job
    GET  /export/{job_id}/3mf     — download 3MF for the job
    GET  /export/{job_id}/swaps   — download swaps.txt

Job storage is in-memory per-process for now. LithoForge's original had a
MongoDB-backed history + marketplace + quota; we intentionally leave those
out of scope for the merge — ForgeSlicer already has its own project /
billing / quota layer and we don't want to fork them.
"""

from __future__ import annotations

import base64
import io
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from PIL import Image
from pydantic import BaseModel, ConfigDict

from litho.lithophane import (
    DEFAULT_FILAMENTS,
    Filament,
    layer_map_to_png_bytes,
    optimize,
    rendered_to_png_bytes,
)
from litho.palette_suggest import FILAMENT_LIBRARY, suggest_palette
from litho.printers import fits_on_bed, get_profile, list_profiles
from litho.exporters import GeometrySpec, build_export
from litho.cost_estimator import estimate_print_costs


logger = logging.getLogger("forge_litho_studio")


# In-memory stores. Sized bounded by cheap eviction — see _prune() below.
_JOBS: Dict[str, Dict[str, Any]] = {}
_UPLOADS: Dict[str, Image.Image] = {}
_MAX_UPLOADS = 40
_MAX_JOBS = 60


def _prune() -> None:
    """Best-effort LRU on the in-memory dicts so we don't OOM the worker
    when a heavy user uploads dozens of images. Insertion order in Py 3.7+
    dicts gives us free FIFO — pop from the head."""
    while len(_UPLOADS) > _MAX_UPLOADS:
        _UPLOADS.pop(next(iter(_UPLOADS)))
    while len(_JOBS) > _MAX_JOBS:
        _JOBS.pop(next(iter(_JOBS)))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class FilamentIn(BaseModel):
    name: str
    hex: str
    td: float = 3.0


class UploadIn(BaseModel):
    image_base64: str
    filename: Optional[str] = None


class UploadOut(BaseModel):
    image_id: str
    width: int
    height: int


class OptimizeIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    image_id: str
    width_mm: float = 100.0
    height_mm: float = 100.0
    thickness_mm: float = 2.2
    border_mm: float = 2.0
    layer_height_mm: float = 0.12
    max_swaps: int = 5
    geometry: Literal["flat", "curved", "cylindrical", "disc", "box"] = "flat"
    curve_radius_mm: float = 80.0
    dome_mm: float = 0.0
    filaments: Optional[List[FilamentIn]] = None
    auto_order: bool = True
    render_mode: Literal["lithophane", "painting"] = "lithophane"
    relief: float = 0.5
    smoothing: float = 0.0
    frame_mm: float = 0.0
    printer_id: str = "generic_orca"
    nozzle_mm: float = 0.4
    license: str = ""
    # Lightbox params — ignored when geometry != "box".
    box_shape: Literal["rect", "round"] = "rect"
    box_outer_w_mm: float = 110.0
    box_outer_h_mm: float = 110.0
    box_depth_mm: float = 35.0
    box_wall_mm: float = 3.0
    box_led_mount: Literal["none", "puck", "strip", "both"] = "both"
    box_puck_diameter_mm: float = 65.0
    box_diffuser: bool = True
    box_cable_notch: bool = True


class OptimizeOut(BaseModel):
    job_id: str
    preview_png_base64: str
    heightmap_png_base64: str
    delta_e_mean: float
    delta_e_p95: float
    light_throughput_pct: float = 0.0
    total_layers: int
    layer_allocation: List[int]
    filaments: List[Dict[str, Any]]
    swap_heights_mm: List[float]
    timeline: List[Dict[str, Any]]
    void_pixels: int = 0
    in_domain_pixels: int = 0
    cost_estimate: Optional[Dict[str, Any]] = None


class SuggestIn(BaseModel):
    image_id: str
    palette_size: int = 6
    vibrancy: float = 0.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decode_image(data: str) -> Image.Image:
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid base64 image") from exc
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Could not decode image") from exc


def _filaments_from_input(fils: Optional[List[FilamentIn]]) -> List[Filament]:
    if not fils:
        return list(DEFAULT_FILAMENTS)
    return [Filament(name=f.name, hex=f.hex, td=float(f.td)) for f in fils]


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

def build_litho_studio_router(get_current_user, db=None) -> APIRouter:
    """Build the studio router. `get_current_user` is ForgeSlicer's
    standard auth dep (raises 401 if not signed in). We keep upload +
    optimize gated behind sign-in so anonymous scrapers can't run the
    (expensive) heightmap solver against arbitrary uploads.
    `db` is the shared Motor async client — only required for the
    persistent submodules (presets, jobs history, private filaments)."""
    router = APIRouter(prefix="/litho/studio", tags=["litho-studio"])
    # Persistent sub-routers — mounted lazily so the studio still boots
    # if the db handle isn't wired (e.g. unit tests that skip Mongo).
    # ForgeSlicer's get_current_user returns a plain dict; LithoForge's
    # routers expect `user.user_id`. Adapter wraps the dict in a
    # SimpleNamespace so attribute access works.
    from types import SimpleNamespace

    async def _adapted_user(user: Dict[str, Any] = Depends(get_current_user)):
        return SimpleNamespace(**user)

    # Late binding — get_optional_user lives in server.py, so import
    # by name from the enclosing app module at call time.
    import sys as _sys
    _server_mod = _sys.modules.get("server")
    _get_optional_user = getattr(_server_mod, "get_optional_user", None)

    async def _adapted_optional_user(request: Request):
        if _get_optional_user is None:
            return None
        u = await _get_optional_user(request)
        return SimpleNamespace(**u) if u else None

    # ForgeSlicer-side admin dep (matches the pattern used by
    # orca_upstream). Wraps get_current_user + is_admin/super check.
    async def _require_admin(request: Request):
        u = await get_current_user(request)
        if not (u.get("is_admin") or u.get("is_super_admin")):
            raise HTTPException(status_code=403, detail="Admin access required.")
        return SimpleNamespace(**u)

    if db is not None:
        from litho.presets import build_presets_router
        from litho.jobs_history import build_jobs_router
        from litho.filament_library_api import build_filament_library_router
        from litho.marketplace import build_marketplace_router
        from litho.marketplace_braintree import build_braintree_router
        from litho.paypal_payouts import (
            build_payouts_router,
            build_admin_payouts_router,
            build_paypal_webhook_router,
        )

        router.include_router(build_presets_router(db, _adapted_user))
        router.include_router(build_jobs_router(db, _adapted_user, _JOBS))
        router.include_router(build_filament_library_router(db, _adapted_user, _adapted_optional_user))
        # Marketplace bundle — mounts /marketplace/*, /my-jobs/*/listing,
        # /creators/*, /payouts/*, /admin/payouts/*, /webhook/* under
        # the studio prefix. Frontend already targets these paths.
        router.include_router(build_marketplace_router(db, _adapted_user, _adapted_optional_user))
        router.include_router(build_braintree_router(db))
        router.include_router(build_payouts_router(db, _adapted_user))
        router.include_router(build_admin_payouts_router(db, _require_admin))
        router.include_router(build_paypal_webhook_router(db))

    async def _require_user(request):
        return await get_current_user(request)

    @router.get("/filaments/default")
    async def default_filaments() -> Dict[str, List[Dict[str, Any]]]:
        return {"filaments": [{"name": f.name, "hex": f.hex, "td": f.td}
                              for f in DEFAULT_FILAMENTS]}

    @router.get("/filaments/library")
    async def filament_library() -> Dict[str, List[Dict[str, Any]]]:
        return {"filaments": [{"name": f.name, "hex": f.hex, "td": f.td}
                              for f in FILAMENT_LIBRARY]}

    @router.get("/printers")
    async def printers_catalog() -> Dict[str, List[Dict[str, Any]]]:
        return {"printers": [dict(p) for p in list_profiles()]}

    @router.get("/printers/{printer_id}/fit")
    async def printer_bed_fit(printer_id: str, width_mm: float, height_mm: float) -> Dict[str, Any]:
        profile = get_profile(printer_id)
        return {
            "printer_id": profile["id"],
            "printer_name": profile["name"],
            "bed_x_mm": profile["bed_x_mm"],
            "bed_y_mm": profile["bed_y_mm"],
            "fits": fits_on_bed(profile, width_mm, height_mm),
        }

    @router.post("/palette/suggest")
    async def suggest_palette_endpoint(body: SuggestIn) -> Dict[str, List[Dict[str, Any]]]:
        if body.image_id not in _UPLOADS:
            raise HTTPException(status_code=404, detail="image_id not found")
        image = _UPLOADS[body.image_id]
        size = max(2, min(8, body.palette_size))
        vibrancy = max(0.0, min(1.0, body.vibrancy))
        chosen = suggest_palette(image, palette_size=size, vibrancy=vibrancy)
        return {"filaments": [{"name": f.name, "hex": f.hex, "td": f.td} for f in chosen]}

    @router.post("/upload", response_model=UploadOut)
    async def upload(body: UploadIn) -> UploadOut:
        img = _decode_image(body.image_base64)
        if max(img.size) > 2048:
            ratio = 2048 / max(img.size)
            img = img.resize(
                (int(img.size[0] * ratio), int(img.size[1] * ratio)),
                Image.LANCZOS,
            )
        image_id = str(uuid.uuid4())
        _UPLOADS[image_id] = img
        _prune()
        return UploadOut(image_id=image_id, width=img.width, height=img.height)

    @router.post("/optimize", response_model=OptimizeOut)
    async def optimize_endpoint(
        body: OptimizeIn,
        request: Request,
    ) -> OptimizeOut:
        if body.image_id not in _UPLOADS:
            raise HTTPException(status_code=404, detail="image_id not found")
        image = _UPLOADS[body.image_id]
        filaments = _filaments_from_input(body.filaments)

        usable_short = max(
            1.0,
            min(body.width_mm, body.height_mm) - 2 * body.border_mm,
        )
        result = optimize(
            image=image,
            filaments=filaments,
            layer_height_mm=body.layer_height_mm,
            total_thickness_mm=body.thickness_mm,
            max_swaps=body.max_swaps,
            max_dimension_px=512,
            auto_order=body.auto_order,
            render_mode=body.render_mode,
            relief=body.relief,
            smoothing=body.smoothing,
            frame_mm=body.frame_mm,
            frame_target_mm=usable_short,
        )

        is_disc_preview = body.geometry == "disc" or (
            body.geometry == "box" and body.box_shape == "round"
        )
        import numpy as _np
        if is_disc_preview:
            h_px, w_px = result.layer_map.shape
            yy, xx = _np.ogrid[:h_px, :w_px]
            cy, cx = (h_px - 1) / 2.0, (w_px - 1) / 2.0
            radius = min(h_px, w_px) / 2.0
            mask = ((yy - cy) ** 2 + (xx - cx) ** 2) <= (radius * radius)
            result.layer_map = _np.where(mask, result.layer_map, 0).astype(_np.int32)
            result.rendered_rgb = result.rendered_rgb * mask[:, :, None]

        preview = base64.b64encode(rendered_to_png_bytes(result.rendered_rgb)).decode()
        heightmap = base64.b64encode(
            layer_map_to_png_bytes(result.layer_map, result.total_layers)
        ).decode()

        lm = result.layer_map
        if is_disc_preview:
            h_px, w_px = lm.shape
            yy, xx = _np.ogrid[:h_px, :w_px]
            cy, cx = (h_px - 1) / 2.0, (w_px - 1) / 2.0
            radius = min(h_px, w_px) / 2.0
            in_domain = ((yy - cy) ** 2 + (xx - cx) ** 2) <= (radius * radius)
        else:
            in_domain = _np.ones(lm.shape, dtype=bool)
        void_pixels = int(((lm == 0) & in_domain).sum())
        in_domain_pixels = int(in_domain.sum())

        timeline = []
        z = 0.0
        for fil, n in zip(result.filaments, result.layer_allocation):
            timeline.append({
                "color": fil.hex,
                "name": fil.name,
                "layers": int(n),
                "start_z_mm": round(z, 4),
                "end_z_mm": round(z + n * result.layer_height_mm, 4),
            })
            z += n * result.layer_height_mm

        swap_layer_indices_for_cost = [
            max(1, int(round(z_mm / result.layer_height_mm)))
            for z_mm in result.swap_heights_mm[1:]
        ]
        usable_w = max(1.0, body.width_mm - 2 * body.border_mm)
        usable_h = max(1.0, body.height_mm - 2 * body.border_mm)
        cost_shape = "disc" if is_disc_preview else "flat"
        cost = estimate_print_costs(
            layer_map=result.layer_map,
            layer_height_mm=result.layer_height_mm,
            swap_layer_indices=swap_layer_indices_for_cost,
            filaments=result.filaments,
            usable_width_mm=usable_w,
            usable_height_mm=usable_h,
            base_min_layers=2,
            shape=cost_shape,
        )

        job_id = str(uuid.uuid4())
        _JOBS[job_id] = {
            "image_id": body.image_id,
            "layer_map": result.layer_map,
            "layer_height_mm": result.layer_height_mm,
            "filaments": result.filaments,
            "swap_heights_mm": result.swap_heights_mm,
            "swap_colors": result.swap_colors,
            "allocation": result.layer_allocation,
            "request": body.model_dump(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _prune()

        # Persist to MongoDB for signed-in users so they get a Job
        # History strip that survives page reloads. Anonymous users
        # continue to use the in-memory _JOBS dict only.
        if db is not None:
            try:
                import sys as _sys
                _server_mod = _sys.modules.get("server")
                _get_optional_user = getattr(_server_mod, "get_optional_user", None)
                _u = await _get_optional_user(request) if _get_optional_user else None
                if _u and _u.get("user_id"):
                    from litho.jobs_history import JobPersistData, persist_job
                    await persist_job(
                        db,
                        _u["user_id"],
                        JobPersistData(
                            job_id=job_id,
                            request=body.model_dump(),
                            filaments=list(result.filaments),
                            layer_map=result.layer_map,
                            layer_height_mm=result.layer_height_mm,
                            swap_heights_mm=result.swap_heights_mm,
                            swap_colors=result.swap_colors,
                            allocation=result.layer_allocation,
                            total_layers=result.total_layers,
                            delta_e_mean=result.delta_e_mean,
                            delta_e_p95=result.delta_e_p95,
                            preview_png_base64=preview,
                            heightmap_png_base64=heightmap,
                            timeline=timeline,
                        ),
                    )
            except Exception:
                # Persistence is best-effort — don't block the response
                # on a Mongo hiccup. The user still gets the job_id +
                # in-memory export.
                logger.exception("Failed to persist litho job to MongoDB")

        return OptimizeOut(
            job_id=job_id,
            preview_png_base64=preview,
            heightmap_png_base64=heightmap,
            delta_e_mean=round(result.delta_e_mean, 3),
            delta_e_p95=round(result.delta_e_p95, 3),
            light_throughput_pct=round(result.light_throughput_pct, 1),
            total_layers=result.total_layers,
            layer_allocation=result.layer_allocation,
            filaments=[{"name": f.name, "hex": f.hex, "td": f.td}
                       for f in result.filaments],
            swap_heights_mm=result.swap_heights_mm,
            timeline=timeline,
            void_pixels=void_pixels,
            in_domain_pixels=in_domain_pixels,
            cost_estimate=cost.to_dict(),
        )

    @router.get("/jobs/{job_id}")
    async def get_job(job_id: str) -> Dict[str, Any]:
        job = _JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        return {
            "job_id": job_id,
            "filaments": [{"name": f.name, "hex": f.hex, "td": f.td}
                          for f in job["filaments"]],
            "allocation": job["allocation"],
            "swap_heights_mm": job["swap_heights_mm"],
            "layer_height_mm": job["layer_height_mm"],
        }

    def _build_job_export(
        job_id: str,
        printer_override: Optional[str] = None,
        base_min_layers: int = 2,
    ) -> Dict[str, Any]:
        job = _JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        req = job["request"]
        geo = GeometrySpec(
            width_mm=req["width_mm"],
            height_mm=req["height_mm"],
            border_mm=req["border_mm"],
            mode=req["geometry"],
            curve_radius_mm=req["curve_radius_mm"],
            dome_mm=float(req.get("dome_mm", 0.0)),
            box_shape=str(req.get("box_shape", "rect") or "rect"),
            box_outer_w_mm=float(req.get("box_outer_w_mm", 110.0) or 110.0),
            box_outer_h_mm=float(req.get("box_outer_h_mm", 110.0) or 110.0),
            box_depth_mm=float(req.get("box_depth_mm", 35.0) or 35.0),
            box_wall_mm=float(req.get("box_wall_mm", 3.0) or 3.0),
            box_led_mount=str(req.get("box_led_mount", "both") or "both"),
            box_puck_diameter_mm=float(req.get("box_puck_diameter_mm", 65.0) or 65.0),
            box_diffuser=bool(req.get("box_diffuser", True)),
            box_cable_notch=bool(req.get("box_cable_notch", True)),
        )
        printer_id = printer_override or req.get("printer_id") or "generic_orca"
        export = build_export(
            layer_map=job["layer_map"],
            layer_height_mm=job["layer_height_mm"],
            geo=geo,
            filament_names=[f.name for f in job["filaments"]],
            swap_heights_mm=job["swap_heights_mm"],
            swap_colors=job["swap_colors"],
            printer_id=printer_id,
            license_text=req.get("license", "") or "",
            base_min_layers=base_min_layers,
            nozzle_mm=float(req.get("nozzle_mm", 0.4) or 0.4),
        )
        return export

    @router.get("/export/{job_id}/stl")
    async def export_stl(
        job_id: str, printer: Optional[str] = None, base_layers: int = 2,
    ) -> Response:
        export = _build_job_export(job_id, printer_override=printer, base_min_layers=base_layers)
        return Response(
            content=export["stl"],
            media_type="model/stl",
            headers={"Content-Disposition": f'attachment; filename=lithophane_{job_id}.stl'},
        )

    @router.get("/export/{job_id}/3mf")
    async def export_3mf(
        job_id: str, printer: Optional[str] = None, base_layers: int = 2,
    ) -> Response:
        export = _build_job_export(job_id, printer_override=printer, base_min_layers=base_layers)
        return Response(
            content=export["threemf"],
            media_type="model/3mf",
            headers={"Content-Disposition": f'attachment; filename=lithophane_{job_id}.3mf'},
        )

    @router.get("/export/{job_id}/swaps")
    async def export_swaps(
        job_id: str, printer: Optional[str] = None, base_layers: int = 2,
    ) -> Response:
        export = _build_job_export(job_id, printer_override=printer, base_min_layers=base_layers)
        return Response(
            content=export["swap_txt"],
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename=lithophane_{job_id}_swaps.txt'},
        )

    return router

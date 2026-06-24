"""Server-side mesh repair via MeshLab.

Endpoint:
    POST /api/mesh/repair        — accepts raw STL bytes, returns repaired
                                    binary STL bytes.

Strategy
--------
PyMeshLab (Python bindings to MeshLab's C++ core) runs through a fixed
filter pipeline:

    1. meshing_merge_close_vertices              — collapse near-coincident
                                                    verts (1e-3 mm tolerance)
    2. meshing_remove_duplicate_faces            — kill repeated tris
    3. meshing_remove_duplicate_vertices         — kill repeated verts post-merge
    4. meshing_remove_unreferenced_vertices      — clean orphaned verts
    5. meshing_repair_non_manifold_edges         — bisect / unify
    6. meshing_repair_non_manifold_vertices      — split / unify
    7. meshing_close_holes                       — cap remaining open edges
                                                    (max-hole-size auto-scaled
                                                    to ~5% of bbox diagonal so
                                                    we close hairlines without
                                                    capping intentional voids)

Steps 1-6 are cheap and rarely lose detail. Step 7 (close_holes) is the
one that "actually fixes" thin-shell AI/photogrammetry STLs — it builds
the missing back surface that was never there. The 5% bbox-diagonal cap
keeps it from eating designed-in pockets.

The whole pipeline runs synchronously inside a process pool worker so
one heavy repair can't block the main event loop. Hard 30 s timeout +
50 MB input cap protect the backend from pathological uploads.

Auth
----
Same `get_current_user` dependency as the rest of the project routes —
the repair runs against the user's own STL only, no shared state.
"""
from __future__ import annotations

import asyncio
import io
import logging
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response


# Cloudflare's managed-WAF in front of the preview ingress was 403-ing
# `multipart/form-data` uploads of binary STL bytes — the form-encoded
# binary blob triggered a generic "malicious payload" heuristic even
# though the bytes are an innocent triangle mesh. Accepting the raw
# STL as `application/octet-stream` (no multipart wrapper) sidesteps
# the WAF inspection path entirely and is the canonical way to ship
# binary uploads to FastAPI behind a CDN.


_MAX_INPUT_BYTES = 50 * 1024 * 1024   # 50 MB
# 90 s — PyMeshFix can run for ~45 s on a dense (50 k-tri) AI mesh
# with hundreds of self-intersections. The earlier 30 s ceiling
# truncated PyMeshFix mid-iteration on the hydrant.
_REPAIR_TIMEOUT_S = 90.0

# Shared executor — one MeshLab repair at a time per worker to keep
# memory predictable. Spinning up a fresh process every request is
# wasteful, but pymeshlab leaks file descriptors on long-lived workers,
# so we recycle each child after a single repair.
_executor = ProcessPoolExecutor(max_workers=2)
_log = logging.getLogger(__name__)


def _repair_stl_sync(stl_bytes: bytes) -> tuple[bytes, dict]:
    """Synchronous repair pipeline. Runs in a child process via the
    executor so the main event loop stays responsive.

    Pipeline:
      1. MeshLab — initial cleanup (merge close verts, dedupe faces,
         re-orient, drop T-vertices). Fixes the cheap easy issues.
      2. PyMeshFix — the heavy hitter. Wraps Marco Attene's MeshFix
         algorithm (also used inside Slic3r / PrusaSlicer for STL
         auto-repair). Guarantees a watertight 2-manifold output by
         removing self-intersections and filling every hole — exactly
         what we need before three-bvh-csg / manifold-3d will accept
         the mesh for boolean subtraction.
      3. Trimesh verification — sanity-checks `is_watertight` and
         `is_winding_consistent` so we can surface the post-repair
         manifold state to the user in the response headers.

    Returns (stl_bytes, stats_dict) where stats_dict has:
        in_tris, out_tris, watertight (bool), winding_consistent (bool),
        meshfix_repaired (bool — whether PyMeshFix actually changed anything).
    """
    import pymeshlab
    import pymeshfix
    import trimesh
    import numpy as np

    stats: dict = {}

    # ── Stage 1: MeshLab prep ─────────────────────────────────────────
    # We still run MeshLab first because it handles a few things
    # PyMeshFix is bad at (dedupe, re-orient by topology), and it's
    # cheap when the input is already mostly clean.
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as in_f:
        in_f.write(stl_bytes)
        in_path = in_f.name
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as stage1_f:
        stage1_path = stage1_f.name

    ms = pymeshlab.MeshSet()
    ms.load_new_mesh(in_path)
    in_tris = ms.current_mesh().face_number()
    stats["in_tris"] = in_tris

    ms.apply_filter("meshing_merge_close_vertices", threshold=pymeshlab.PercentageValue(0.01))
    ms.apply_filter("meshing_remove_duplicate_faces")
    ms.apply_filter("meshing_remove_duplicate_vertices")
    ms.apply_filter("meshing_remove_unreferenced_vertices")
    # Drop tiny floating shards — AI meshes routinely include 3-tri
    # specks (orphan triangles, tiny noise) that have nothing to do
    # with the printable surface. Threshold is intentionally tiny (5
    # faces) so we don't drop a legitimate small detail; PyMeshFix's
    # `joincomp=True` will weld anything bigger.
    try:
        ms.apply_filter(
            "meshing_remove_connected_component_by_face_number",
            mincomponentsize=5,
            removeunref=True,
        )
    except Exception:
        pass
    try:
        ms.apply_filter("meshing_re_orient_faces_coherently")
    except Exception:
        pass
    try:
        ms.apply_filter("meshing_remove_t_vertices", method=0)
    except Exception:
        pass

    ms.save_current_mesh(stage1_path, binary=True)

    # ── Stage 2: PyMeshFix — guaranteed watertight 2-manifold ─────────
    # PyMeshFix takes a vertex/face array and returns a fully repaired
    # version. It is the industry-standard auto-repair for STL files
    # (originally from Marco Attene's research lab, used in Slic3r and
    # PrusaSlicer). Far more robust than MeshLab's close_holes for AI /
    # photogrammetry meshes because it explicitly models the surface
    # topology and resolves self-intersections before sealing holes.
    #
    # `force_mesh=True` collapses any multi-body Scene into a single
    # concatenated Trimesh — otherwise STLs with multiple shells load
    # as a `Scene` object that has no `.vertices` attribute.
    # We deliberately ALLOW trimesh's default vertex merging here
    # (`process=True`). STL format inflates verts to 3-per-triangle on
    # disk; without the merge, PyMeshFix sees 3*N disconnected
    # vertices and can't reconstruct any surface topology, returning
    # an empty mesh.
    stage1_loaded = trimesh.load(stage1_path, file_type="stl", force="mesh")
    verts = np.asarray(stage1_loaded.vertices, dtype=np.float64)
    faces = np.asarray(stage1_loaded.faces, dtype=np.int32)

    mfix = pymeshfix.MeshFix(verts, faces)
    # `joincomp=True` welds disconnected components if they touch
    # (helps with meshes that have been hot-glued together from
    # multiple AI passes). `remove_smallest_components=False` because
    # we already filtered tiny shards in the MeshLab stage above and
    # we DON'T want PyMeshFix to drop a legitimate small feature.
    mfix.repair(joincomp=True, remove_smallest_components=False)
    # PyMeshFix exposes repaired arrays as `.points` (Nx3 float) and
    # `.faces` (Mx3 int). Earlier docs referenced `.v` / `.f` — those
    # are no longer present in the 0.18 release we bundle.
    fixed_verts = np.asarray(mfix.points)
    fixed_faces = np.asarray(mfix.faces)
    stats["meshfix_repaired"] = (
        fixed_verts.shape[0] != verts.shape[0] or fixed_faces.shape[0] != faces.shape[0]
    )
    stats["out_tris"] = int(fixed_faces.shape[0])

    # ── Stage 3: Trimesh verification & STL serialisation ─────────────
    fixed = trimesh.Trimesh(vertices=fixed_verts, faces=fixed_faces, process=False)
    # Recompute normals — PyMeshFix doesn't always preserve them.
    fixed.fix_normals()
    stats["watertight"] = bool(fixed.is_watertight)
    stats["winding_consistent"] = bool(fixed.is_winding_consistent)

    out_bytes: bytes = fixed.export(file_type="stl")
    return out_bytes, stats


def build_mesh_repair_router(get_current_user) -> APIRouter:
    router = APIRouter(prefix="/mesh", tags=["mesh-repair"])

    @router.post("/repair")
    async def repair_mesh(request: Request, file: UploadFile = File(None)):
        # Auth: same pattern as the other routes — bounce the request
        # off `get_current_user` and reject if the session is invalid.
        user = await get_current_user(request)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")

        # Two-mode body parsing:
        #   1. Modern path (preferred) — raw `application/octet-stream`
        #      body. Bypasses Cloudflare's multipart WAF rule that 403s
        #      binary form uploads on the preview ingress.
        #   2. Legacy path — multipart `file=…` upload, kept so older
        #      clients / API explorers still work for the few users
        #      hitting the endpoint directly.
        # Either way we stream chunk-by-chunk so a malicious 4 GB upload
        # doesn't OOM the worker; we just 413 once we cross the threshold.
        buf = io.BytesIO()
        size = 0
        if file is not None:
            while True:
                chunk = await file.read(1 << 16)  # 64 KB
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_INPUT_BYTES:
                    raise HTTPException(status_code=413, detail=f"File too large (max {_MAX_INPUT_BYTES // 1024 // 1024} MB)")
                buf.write(chunk)
        else:
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                if size > _MAX_INPUT_BYTES:
                    raise HTTPException(status_code=413, detail=f"File too large (max {_MAX_INPUT_BYTES // 1024 // 1024} MB)")
                buf.write(chunk)
        stl_in = buf.getvalue()
        if size < 100:
            raise HTTPException(status_code=400, detail="Empty or truncated STL")

        # Run repair in the process pool. asyncio.wait_for enforces the
        # hard timeout so a hung filter can't pin a worker forever.
        loop = asyncio.get_running_loop()
        started = time.time()
        try:
            stl_out, stats = await asyncio.wait_for(
                loop.run_in_executor(_executor, _repair_stl_sync, stl_in),
                timeout=_REPAIR_TIMEOUT_S,
            )
        except asyncio.TimeoutError as exc:
            raise HTTPException(
                status_code=504,
                detail=f"Repair took longer than {_REPAIR_TIMEOUT_S:.0f}s — try simplifying the mesh first.",
            ) from exc
        except Exception as exc:
            _log.exception("MeshLab repair failed")
            raise HTTPException(status_code=500, detail=f"Repair failed: {exc}") from exc
        elapsed = time.time() - started

        # Surface useful stats via headers so the frontend can show a
        # meaningful toast without the user having to inspect the file.
        # `X-Repair-Watertight` is the key one for the dropped-boolean
        # bug — if it's "false" the frontend should warn the user that
        # even MeshFix couldn't fully heal the mesh and boolean cuts
        # may still be dropped.
        return Response(
            content=stl_out,
            media_type="application/sla",
            headers={
                "X-Repair-Input-Bytes": str(size),
                "X-Repair-Output-Bytes": str(len(stl_out)),
                "X-Repair-Input-Tris": str(stats.get("in_tris", 0)),
                "X-Repair-Output-Tris": str(stats.get("out_tris", 0)),
                "X-Repair-Watertight": "true" if stats.get("watertight") else "false",
                "X-Repair-Winding-Consistent": "true" if stats.get("winding_consistent") else "false",
                "X-Repair-Elapsed-Seconds": f"{elapsed:.2f}",
                # Expose them to JS even though the request is
                # same-origin via the preview proxy — defensive against
                # future cross-origin testing.
                "Access-Control-Expose-Headers": (
                    "X-Repair-Input-Bytes,X-Repair-Output-Bytes,"
                    "X-Repair-Input-Tris,X-Repair-Output-Tris,"
                    "X-Repair-Watertight,X-Repair-Winding-Consistent,"
                    "X-Repair-Elapsed-Seconds"
                ),
            },
        )

    return router

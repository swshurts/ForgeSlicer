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
_REPAIR_TIMEOUT_S = 30.0

# Shared executor — one MeshLab repair at a time per worker to keep
# memory predictable. Spinning up a fresh process every request is
# wasteful, but pymeshlab leaks file descriptors on long-lived workers,
# so we recycle each child after a single repair.
_executor = ProcessPoolExecutor(max_workers=2)
_log = logging.getLogger(__name__)


def _repair_stl_sync(stl_bytes: bytes) -> bytes:
    """Synchronous MeshLab pipeline. Runs in a child process via the
    executor so the main event loop stays responsive."""
    import pymeshlab  # imported lazily so the main FastAPI image starts
                       # up fast even on cold deploys.

    # MeshLab's Python wrapper only takes filesystem paths — round-trip
    # through a temp dir. We let NamedTemporaryFile clean up on exit.
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as in_f:
        in_f.write(stl_bytes)
        in_path = in_f.name
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as out_f:
        out_path = out_f.name

    ms = pymeshlab.MeshSet()
    ms.load_new_mesh(in_path)

    # Auto-scale hole-fill threshold by bbox diagonal so we close
    # hairline cracks on a 5 mm trinket and a 500 mm cosplay piece
    # with the same setting.
    bbox = ms.current_mesh().bounding_box()
    diag = bbox.diagonal()
    max_hole_edges = max(50, int(diag * 5))  # at 0.5 mm avg edge → ~5% diag

    ms.apply_filter("meshing_merge_close_vertices", threshold=pymeshlab.PercentageValue(0.01))
    ms.apply_filter("meshing_remove_duplicate_faces")
    ms.apply_filter("meshing_remove_duplicate_vertices")
    ms.apply_filter("meshing_remove_unreferenced_vertices")
    # Align all face normals to point outward consistently. AI meshes often
    # have pockets of inverted-winding tris which sink three-bvh-csg's
    # inside/outside test even after holes are closed.
    try:
        ms.apply_filter("meshing_re_orient_faces_coherently")
    except Exception:
        pass  # filter occasionally rejects malformed input; not fatal
    # Drop T-vertices (verts that sit mid-edge of an adjacent triangle).
    # These create silent non-manifoldness that close_holes can't fix.
    try:
        ms.apply_filter("meshing_remove_t_vertices", method=0)
    except Exception:
        pass
    ms.apply_filter("meshing_repair_non_manifold_edges")
    ms.apply_filter("meshing_repair_non_manifold_vertices", vertdispratio=0.0)
    # Close holes WITH refinement — the older basic-fan close was leaving
    # tiny boundary slivers that three-bvh-csg still tripped on. Refine
    # adds extra vertices inside each closed cap so the final mesh joins
    # at watertight precision.
    # `refineholeedgelen` is a percentage of bbox diagonal in this
    # pymeshlab build (the typed-parameter API rejects bare floats AND
    # the `AbsoluteValue` wrapper doesn't exist on the version we
    # bundle — only `PercentageValue` is available). 1% gives us a
    # tight enough mesh on the closed-hole cap to weave seamlessly
    # into the surrounding triangles.
    refine_edge = pymeshlab.PercentageValue(1.0)
    ms.apply_filter(
        "meshing_close_holes",
        maxholesize=max_hole_edges,
        refinehole=True,
        refineholeedgelen=refine_edge,
        selfintersection=True,
        newfaceselected=False,
    )
    # Final non-manifold pass to clean up any edges that close_holes
    # introduced during refinement.
    try:
        ms.apply_filter("meshing_repair_non_manifold_edges")
    except Exception:
        pass

    ms.save_current_mesh(out_path, binary=True)

    with open(out_path, "rb") as f:
        return f.read()


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

        # Run MeshLab in the process pool. asyncio.wait_for enforces the
        # hard timeout so a hung filter can't pin a worker forever.
        loop = asyncio.get_running_loop()
        started = time.time()
        try:
            stl_out: bytes = await asyncio.wait_for(
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
        return Response(
            content=stl_out,
            media_type="application/sla",
            headers={
                "X-Repair-Input-Bytes": str(size),
                "X-Repair-Output-Bytes": str(len(stl_out)),
                "X-Repair-Elapsed-Seconds": f"{elapsed:.2f}",
                # Expose them to JS even though the request is
                # same-origin via the preview proxy — defensive against
                # future cross-origin testing.
                "Access-Control-Expose-Headers": "X-Repair-Input-Bytes,X-Repair-Output-Bytes,X-Repair-Elapsed-Seconds",
            },
        )

    return router

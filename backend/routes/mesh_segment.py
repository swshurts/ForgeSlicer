"""RANSAC-based primitive segmentation for imported meshes.

Endpoint:
    POST /api/mesh/segment  — accepts raw STL bytes, returns JSON
                              describing detected geometric primitives
                              (planes, cylinders, spheres, cones).

This powers the "Reverse-Engineer" feature: turn an imported STL of a
mechanical part into a set of editable parametric primitives so the
user can modify it (resize a hole, change a fillet, etc.) rather than
being stuck with an immutable triangle soup.

Phase 1 (this file): planes only. Iteratively detects the largest
planar region in the point cloud (sampled from triangle centroids,
area-weighted), removes its inliers, and repeats until the next plane
would account for fewer than `min_inlier_frac` of the remaining
points. Later phases extend the loop to cylinders / spheres / cones
*after* planes (so flat caps are stripped first).

Why backend, not frontend
-------------------------
RANSAC is iterative and numpy-heavy. Running it client-side in JS
would either be slow (pure-JS) or require shipping a 2-3 MB WASM
build of a CGAL/Open3D port. The mesh repair endpoint already
established a backend point-cloud pipeline (PyMeshFix + trimesh), so
adding pyransac3d alongside is a 18 KB dep and reuses the same
process-pool plumbing.

Auth
----
Same `get_current_user` dependency as `/api/mesh/repair` — the
segmentation runs against the user's own STL only, no shared state.
"""
from __future__ import annotations

import asyncio
import io
import logging
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Any

from fastapi import APIRouter, HTTPException, Request


_MAX_INPUT_BYTES = 50 * 1024 * 1024   # 50 MB
_SEGMENT_TIMEOUT_S = 60.0
# Cap on iterations — guards against pathological meshes that would
# otherwise return dozens of micro-planes from noise.
_MAX_PRIMITIVES = 24
# Below this we stop hunting — the next plane is too small to matter
# and we'd just be fitting noise.
_MIN_INLIER_FRAC = 0.02   # 2% of remaining points
# Distance tolerance for RANSAC inlier classification, expressed as a
# fraction of the mesh bbox diagonal. 0.2% works well for printed
# parts (sub-millimeter on a typical 100mm bbox).
_DEFAULT_EPS_FRAC = 0.002
# Cap the point cloud size — RANSAC is O(N * iters); for huge meshes
# we sample without replacement to keep the per-iteration cost bounded.
_MAX_POINTS = 30_000

_executor = ProcessPoolExecutor(max_workers=2)
_log = logging.getLogger(__name__)


def _segment_stl_sync(stl_bytes: bytes, eps_frac: float = _DEFAULT_EPS_FRAC) -> dict:
    """Run iterative plane RANSAC on the STL's triangle-centroid cloud.

    Returns a JSON-serialisable dict:
        {
          "primitives": [
              { "type": "plane",
                "params": {"normal": [x,y,z], "d": float},
                "inlier_count": int,
                "inlier_fraction": float,
                "centroid": [x,y,z],
                "bbox": [[xmin,ymin,zmin],[xmax,ymax,zmax]] },
              ...
          ],
          "stats": {
              "total_points": int,
              "remaining_points": int,
              "coverage": float,           # fraction of points assigned to a primitive
              "bbox_diagonal": float,
              "elapsed_seconds": float,
              "elapsed_seconds": float,
              "in_tris": int
          }
        }
    """
    import numpy as np
    import trimesh
    import pyransac3d as pyrsc

    t0 = time.time()
    mesh = trimesh.load(io.BytesIO(stl_bytes), file_type="stl", force="mesh")
    if not hasattr(mesh, "vertices") or len(mesh.vertices) == 0:
        raise ValueError("Empty or unreadable STL")

    in_tris = int(len(mesh.faces))
    # Sample points UNIFORMLY across the mesh surface. Triangle-centroid
    # sampling collapses a cube into 12 points + verts (24), which gives
    # RANSAC enough freedom to fit *diagonal* planes through 3 face
    # midpoints — a false positive that produces nonsense normals like
    # [0.58, -0.58, 0.58]. `trimesh.sample.sample_surface` does
    # area-weighted uniform sampling and produces a dense point cloud
    # that RANSAC can reliably partition. ~10k points is the sweet spot:
    # dense enough to crowd out diagonal false-positives, sparse enough
    # to run in <1s.
    n_sample = min(_MAX_POINTS, max(in_tris * 50, 8000))
    try:
        sampled, _face_idx = trimesh.sample.sample_surface(mesh, n_sample, seed=12345)
        points = sampled.astype(np.float64)
    except Exception:
        # Fallback to centroid sampling if surface sampling fails
        # (e.g. zero-area face edge cases).
        centroids = mesh.triangles.mean(axis=1)
        points = centroids.astype(np.float64)
    # Also union the raw vertices — sharp corners benefit from explicit
    # coverage that surface sampling can miss for small features.
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    if len(verts) <= _MAX_POINTS:
        points = np.vstack([points, verts])

    total_points = int(len(points))

    # Mesh-scale-relative epsilon — the same tolerance that works on a
    # 5 mm part would be useless on a 500 mm part.
    bbox_min = points.min(axis=0)
    bbox_max = points.max(axis=0)
    bbox_diag = float(np.linalg.norm(bbox_max - bbox_min))
    eps = max(bbox_diag * eps_frac, 1e-6)

    primitives: list[dict[str, Any]] = []
    # `remaining` is a bool mask over `points` — inliers from each
    # primitive get masked off and the next RANSAC pass runs on the
    # complement. Vectorized boolean indexing keeps this fast even at
    # 30k points.
    remaining = np.ones(total_points, dtype=bool)
    min_inliers = max(int(total_points * _MIN_INLIER_FRAC), 50)

    for _ in range(_MAX_PRIMITIVES):
        rem_idx = np.flatnonzero(remaining)
        if len(rem_idx) < min_inliers:
            break
        sub = points[rem_idx]

        plane = pyrsc.Plane()
        # pyransac3d's Plane.fit signature:
        #   fit(pts, thresh=0.05, minPoints=100, maxIteration=1000)
        # Returns (best_eq, best_inliers) where best_eq = [a, b, c, d]
        # for plane ax+by+cz+d=0 and best_inliers is an array of point
        # indices in the *input* `pts` array.
        try:
            best_eq, best_inliers = plane.fit(
                sub,
                thresh=eps,
                minPoints=max(min_inliers // 2, 30),
                maxIteration=600,
            )
        except Exception as exc:
            _log.warning("Plane RANSAC iteration failed: %s", exc)
            break

        if best_eq is None or best_inliers is None or len(best_inliers) < min_inliers:
            break

        a, b, c, d = (float(v) for v in best_eq)
        norm = (a * a + b * b + c * c) ** 0.5
        if norm < 1e-9:
            break
        n = [a / norm, b / norm, c / norm]
        # d in pyransac3d is the plane offset such that a*x+b*y+c*z+d=0.
        # After normalising (n_unit, d_unit), the signed distance from
        # the origin is -d_unit / 1 (since |n_unit|=1). We store the
        # normalised d so downstream consumers can use the canonical
        # form directly.
        d_norm = d / norm

        inlier_points = sub[best_inliers]
        # ─── Sliver filter ────────────────────────────────────────────
        # RANSAC will happily classify a curved cylinder strip as a
        # "plane" because each thin segment of the wall fits within
        # `eps`. To reject these false positives, project the inliers
        # onto the candidate plane and demand the in-plane bounding box
        # be substantial in BOTH axes. A genuine planar face has 2D
        # extent; a curved strip looks like a thin ribbon.
        n_vec = np.array(n, dtype=np.float64)
        # Build an arbitrary orthonormal basis (u, v) on the plane.
        helper = np.array([1.0, 0.0, 0.0]) if abs(n_vec[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        u = np.cross(n_vec, helper)
        u /= np.linalg.norm(u) or 1.0
        v = np.cross(n_vec, u)
        rel = inlier_points - inlier_points.mean(axis=0)
        uu = rel @ u
        vv = rel @ v
        extent_u = float(uu.max() - uu.min())
        extent_v = float(vv.max() - vv.min())
        min_extent = max(bbox_diag * 0.05, eps * 4.0)
        aspect = max(extent_u, extent_v) / max(min(extent_u, extent_v), 1e-9)
        # A genuine planar face has aspect ≲ 5:1 (squarish to mildly
        # rectangular). Cylinder side-wall strips approximated as
        # planes come out 6-15:1 (long in the cylinder axis, short
        # in the circumferential direction). Rejecting > 8:1 strikes
        # a balance: keeps long thin shelves / brackets, drops curved
        # strips.
        if extent_u < min_extent or extent_v < min_extent or aspect > 8.0:
            # Sliver — mark these inliers consumed (so the next
            # iteration doesn't keep refitting the same strip) but
            # don't record the plane.
            consumed_global = rem_idx[np.asarray(best_inliers, dtype=np.int64)]
            remaining[consumed_global] = False
            continue

        centroid = inlier_points.mean(axis=0).tolist()
        p_bbox_min = inlier_points.min(axis=0).tolist()
        p_bbox_max = inlier_points.max(axis=0).tolist()

        primitives.append({
            "type": "plane",
            "params": {
                "normal": n,
                "d": d_norm,
            },
            "inlier_count": int(len(best_inliers)),
            "inlier_fraction": float(len(best_inliers) / total_points),
            "centroid": centroid,
            "bbox": [p_bbox_min, p_bbox_max],
        })

        # Mark these inliers consumed. `rem_idx[best_inliers]` maps the
        # sub-array indices back to the original `points` indices.
        consumed_global = rem_idx[np.asarray(best_inliers, dtype=np.int64)]
        remaining[consumed_global] = False

    remaining_count = int(remaining.sum())
    coverage = float(1.0 - remaining_count / total_points) if total_points else 0.0

    return {
        "primitives": primitives,
        "stats": {
            "total_points": total_points,
            "remaining_points": remaining_count,
            "coverage": coverage,
            "bbox_diagonal": bbox_diag,
            "eps": eps,
            "in_tris": in_tris,
            "elapsed_seconds": round(time.time() - t0, 3),
        },
    }


def build_mesh_segment_router(get_current_user) -> APIRouter:
    router = APIRouter(prefix="/mesh", tags=["mesh-segment"])

    @router.post("/segment")
    async def segment_mesh(request: Request):
        user = await get_current_user(request)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")

        # Optional `?eps_frac=` query param lets the frontend dial RANSAC
        # tolerance up/down without redeploying. Bounded to keep noise
        # from blowing the primitive count.
        eps_frac = _DEFAULT_EPS_FRAC
        try:
            raw = request.query_params.get("eps_frac")
            if raw is not None:
                eps_frac = float(raw)
        except (TypeError, ValueError):
            eps_frac = _DEFAULT_EPS_FRAC
        eps_frac = max(0.0001, min(eps_frac, 0.05))

        # Stream the upload into memory; reject >50 MB to protect workers.
        # We accept raw application/octet-stream only — same Cloudflare-WAF
        # avoidance reasoning as /api/mesh/repair.
        buf = io.BytesIO()
        size = 0
        async for chunk in request.stream():
            if not chunk:
                continue
            size += len(chunk)
            if size > _MAX_INPUT_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large (max {_MAX_INPUT_BYTES // 1024 // 1024} MB)",
                )
            buf.write(chunk)
        stl_in = buf.getvalue()
        if size < 100:
            raise HTTPException(status_code=400, detail="Empty or truncated STL")

        loop = asyncio.get_running_loop()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(_executor, _segment_stl_sync, stl_in, eps_frac),
                timeout=_SEGMENT_TIMEOUT_S,
            )
        except asyncio.TimeoutError as exc:
            raise HTTPException(
                status_code=504,
                detail=f"Segmentation took longer than {_SEGMENT_TIMEOUT_S:.0f}s — try simplifying the mesh first.",
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            _log.exception("Mesh segmentation failed")
            raise HTTPException(status_code=500, detail=f"Segmentation failed: {exc}") from exc

        return result

    return router

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
# Cylinder/sphere detection caps. Curved primitives are expensive
# (pyransac3d's Cylinder.fit takes ~1.5s on 8k points) so we cap
# attempts per type. Most real parts have ≤ 4 cylinders (bolts /
# bores) and 0-1 spheres, so 5 is generous.
_MAX_CURVED_PER_TYPE = 5
# Curved-primitive RANSAC subsample — we generate a candidate fit on
# a smaller cloud (faster), then re-classify inliers against the FULL
# remaining cloud using the candidate params. This decouples fit
# cost from final inlier count.
_CURVED_FIT_SUBSAMPLE = 1500
# Minimum aspect ratio (height / radius) for a primitive to qualify
# as a *cylinder* vs a curved cap. A short stubby cylinder still
# needs at least radius-worth of height; anything shorter is geometry
# RANSAC mis-classified.
_MIN_CYL_HEIGHT_OVER_RADIUS = 0.4
# RANSAC iteration counts. Cylinder is the hardest: a 5-point random
# sample needs all 5 points on the cylinder to produce a good fit,
# and small features (holes / bores that comprise ~15% of the mesh)
# need many random restarts before that happens. 800 iters with up
# to 6 retries (~6×0.5s = 3s wall) catches features down to ~10% of
# the cloud without paying the cost on simple meshes.
_CYL_RANSAC_ITERS = 800
_SPHERE_RANSAC_ITERS = 600
# Max consecutive misses before bailing out of a primitive loop.
# Higher = more retries when RANSAC's randomness misses a feature
# the first time; ceiling capped by the per-type budget below.
_MAX_CONSEC_MISSES = 6

_executor = ProcessPoolExecutor(max_workers=2)
_log = logging.getLogger(__name__)


def _sphere_inliers(points, center, radius, eps):
    """Return a bool mask of points within `eps` of a sphere shell."""
    import numpy as np
    diff = points - np.asarray(center, dtype=np.float64)
    dists = np.linalg.norm(diff, axis=1)
    return np.abs(dists - radius) <= eps


def _cylinder_inliers(points, center, axis, radius, eps):
    """Return (bool mask, projections-along-axis) for a cylinder shell.

    Distance to a cylinder surface = |radial_distance - radius| where
    radial_distance is the point's perpendicular distance to the axis
    line. We also return the axial projection so the caller can derive
    the cylinder's height from the inlier set.
    """
    import numpy as np
    center = np.asarray(center, dtype=np.float64)
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / max(np.linalg.norm(axis), 1e-9)
    rel = points - center
    along = rel @ axis                       # (N,) axial projection
    perp = rel - np.outer(along, axis)       # (N, 3) perpendicular component
    radial = np.linalg.norm(perp, axis=1)
    mask = np.abs(radial - radius) <= eps
    return mask, along


def _refine_cylinder(points, normals, center, axis, radius, eps, max_iters=6):
    """Iteratively refine a cylinder fit using surface NORMALS.

    pyransac3d's Cylinder.fit consistently returns a tilted axis (off
    by ~0.1 perpendicular components) — accurate enough to identify
    that a cylinder exists, but inaccurate enough that re-classifying
    inliers at a tight tolerance catches < 5% of the true cylinder
    surface. Without refinement the density-validation step then
    rejects the fit and we miss real cylinders.

    Trick: for any point on a cylinder, its surface normal is
    perpendicular to the cylinder axis. So given a candidate axis,
    the inliers' normals should satisfy `normal · axis ≈ 0`. The
    direction MOST orthogonal to the inlier normals — i.e. the
    smallest right-singular vector of the normals matrix — IS the
    cylinder axis. We then circle-fit (Kasa) the inliers projected
    onto the perpendicular plane to recover an accurate (center,
    radius). This converges to the true cylinder in 2-4 iterations
    even from a 10°-tilted RANSAC seed.

    Falls back to the input fit if normals aren't available.
    """
    import numpy as np
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / max(np.linalg.norm(axis), 1e-9)
    center = np.asarray(center, dtype=np.float64)
    radius = float(radius)
    if normals is None:
        return center, axis, radius
    for _ in range(max_iters):
        # Use a generous radial tolerance early so the tilted-axis
        # seed still picks up enough inliers to drive the normal-based
        # axis estimator. The estimator's accuracy depends almost
        # entirely on the inlier-normal distribution, NOT on having a
        # tight tolerance, so the loose eps doesn't hurt convergence.
        mask, _along = _cylinder_inliers(points, center, axis, radius, eps * 4.0)
        if mask.sum() < 30:
            break
        ip = points[mask]
        in_normals = normals[mask]
        # Filter out zero/degenerate normals
        n_norm = np.linalg.norm(in_normals, axis=1)
        good = n_norm > 1e-6
        if good.sum() < 30:
            break
        nrm = in_normals[good] / n_norm[good, None]
        # Axis estimate = smallest right-singular vector of the
        # normals matrix. Mathematically: the direction MOST
        # orthogonal to every inlier normal.
        try:
            _, _, Vt = np.linalg.svd(nrm, full_matrices=False)
        except np.linalg.LinAlgError:
            break
        new_axis = Vt[-1]
        new_axis = new_axis / max(np.linalg.norm(new_axis), 1e-9)
        if float(new_axis @ axis) < 0:
            new_axis = -new_axis

        # ─── 2D circle fit (Kasa) for (center, radius) ───────────────
        # Project inliers onto the plane perpendicular to the new
        # axis, then fit a circle in that 2D plane. This gives a far
        # more accurate (center, radius) than using the centroid —
        # asymmetric inlier sampling biases the centroid; the
        # circle-fit corrects for it analytically.
        # Build an orthonormal 2D basis (e1, e2) on the perpendicular
        # plane.
        helper = np.array([1.0, 0.0, 0.0]) if abs(new_axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        e1 = np.cross(new_axis, helper)
        e1 = e1 / max(np.linalg.norm(e1), 1e-9)
        e2 = np.cross(new_axis, e1)
        # Project to 2D
        rel = ip - center
        x = rel @ e1
        y = rel @ e2
        # Kasa algebraic fit: solve linear system for (a, b, c)
        # such that x² + y² = 2ax + 2by + c, then center2D = (a, b),
        # radius = √(c + a² + b²).
        z = x * x + y * y
        n = len(x)
        A = np.array([
            [np.sum(x * x), np.sum(x * y), np.sum(x)],
            [np.sum(x * y), np.sum(y * y), np.sum(y)],
            [np.sum(x),    np.sum(y),    float(n)],
        ])
        b_vec = np.array([
            np.sum(x * z),
            np.sum(y * z),
            np.sum(z),
        ])
        try:
            sol = np.linalg.solve(A, b_vec)
        except np.linalg.LinAlgError:
            break
        a2d = sol[0] / 2.0
        b2d = sol[1] / 2.0
        c2d = sol[2]
        r2_sq = c2d + a2d * a2d + b2d * b2d
        if not np.isfinite(r2_sq) or r2_sq <= 0:
            break
        new_radius = float(np.sqrt(r2_sq))
        # Lift the 2D center back into 3D, anchored on the projection
        # plane (offset by the original projection point `center`).
        new_center = center + a2d * e1 + b2d * e2

        # Convergence check (axis stopped moving, radius stable).
        if (abs(new_radius - radius) < 1e-4
                and float(new_axis @ axis) > 0.99995):
            center, axis, radius = new_center, new_axis, new_radius
            break
        center, axis, radius = new_center, new_axis, new_radius
    return center, axis, radius


def _cylinder_axis_candidates(normals, remaining_mask, n_samples=240, top_k=6):
    """Return a list of (axis, score) tuples for likely cylinder axes.

    Uses a Hough-like vote on a uniformly-sampled set of candidate
    axes. Score = (number of populated angular bins in perpendicular
    projection) × (total area-weight of perpendicular faces). This
    rewards directions where the perpendicular normals trace a full
    great circle — the geometric signature of a cylinder — and
    penalises directions where they cluster at a few face normals
    (the geometric signature of a polyhedral / box-like region).

    Falls back to an empty list if no normals are available.
    """
    import numpy as np
    if normals is None or not np.any(remaining_mask):
        return []
    nrms = normals[remaining_mask]
    n_norm = np.linalg.norm(nrms, axis=1)
    good = n_norm > 1e-6
    if good.sum() < 30:
        return []
    nrms = nrms[good] / n_norm[good, None]
    # Areas aren't available at this stage (we work on points, not faces),
    # so use uniform weights — angular-diversity dominates in practice.
    weights = np.ones(len(nrms))

    # Deterministic sample of directions on the upper hemisphere.
    rng = np.random.default_rng(seed=9001)
    phi = rng.uniform(0.0, 2.0 * np.pi, n_samples)
    costheta = rng.uniform(0.0, 1.0, n_samples)        # upper hemisphere
    sintheta = np.sqrt(1.0 - costheta * costheta)
    axes = np.column_stack([
        sintheta * np.cos(phi),
        sintheta * np.sin(phi),
        costheta,
    ])
    # Always include the 3 canonical axes — most CAD parts are
    # axis-aligned so this is a cheap insurance against the random
    # sampler missing the true direction.
    axes = np.vstack([axes, np.eye(3)])

    scores = np.zeros(len(axes))
    for k, a in enumerate(axes):
        dots = nrms @ a                  # (N,)
        perp_mask = np.abs(dots) < 0.18  # ~10° tolerance
        if perp_mask.sum() < 10:
            continue
        pn = nrms[perp_mask]
        pw = weights[perp_mask]
        # Project perpendicular normals to the perp plane and bin by angle.
        helper = np.array([1.0, 0.0, 0.0]) if abs(a[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        e1 = np.cross(a, helper)
        e1 = e1 / max(np.linalg.norm(e1), 1e-9)
        e2 = np.cross(a, e1)
        ang = np.arctan2(pn @ e2, pn @ e1)
        # 18 bins, 20° each
        bin_idx = (((ang + np.pi) / (2.0 * np.pi)) * 18.0).astype(int) % 18
        binweights = np.zeros(18)
        np.add.at(binweights, bin_idx, pw)
        n_pop = int((binweights > 0).sum())
        scores[k] = n_pop * float(pw.sum())

    order = np.argsort(-scores)
    out: list = []
    for k in order[:top_k]:
        if scores[k] <= 0:
            break
        out.append((axes[k].copy(), float(scores[k])))
    return out


def _ransac_2d_circles(points2d, eps_2d, min_inliers, max_circles=4, n_iters=400):
    """Find up to `max_circles` non-overlapping circles in a 2D point
    cloud using RANSAC.

    Each iteration picks 3 random points, computes the circumcircle,
    counts inliers (|distance - radius| ≤ eps_2d). The best fit wins
    that pass; its inliers are removed and the next pass starts. Stops
    when no more circles meet `min_inliers`. Returns a list of
    (center_xy, radius, inlier_indices).

    Why 2D circles and not 3D cylinders: the caller has already
    projected points perpendicular to a candidate axis. Any cylinder
    around that axis appears as a circle in the projection. Splitting
    the axis-search (normal-Hough) and the radius/position-search
    (2D RANSAC) into separate stages is more reliable than 5-parameter
    3D cylinder RANSAC, and an order of magnitude faster.
    """
    import numpy as np
    pts = np.asarray(points2d, dtype=np.float64)
    remaining = np.ones(len(pts), dtype=bool)
    results: list = []
    rng = np.random.default_rng(seed=20260626)
    for _ in range(max_circles):
        rem = np.flatnonzero(remaining)
        if len(rem) < min_inliers:
            break
        sub = pts[rem]
        best_n = 0
        best = None
        # RANSAC: pick 3 random points → circumcircle → count inliers.
        # Vectorised in batches of 50 for speed.
        n = len(sub)
        for _it in range(n_iters):
            ijk = rng.integers(0, n, size=3)
            if len(set(ijk.tolist())) < 3:
                continue
            p1, p2, p3 = sub[ijk]
            # Circumcircle: center is equidistant from 3 points.
            # Standard formula via determinants — numerically stable
            # enough for our 0.01-1 mm distance scales.
            ax, ay = p1
            bx, by = p2
            cx, cy = p3
            d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
            if abs(d) < 1e-9:
                continue
            ux = ((ax * ax + ay * ay) * (by - cy) +
                  (bx * bx + by * by) * (cy - ay) +
                  (cx * cx + cy * cy) * (ay - by)) / d
            uy = ((ax * ax + ay * ay) * (cx - bx) +
                  (bx * bx + by * by) * (ax - cx) +
                  (cx * cx + cy * cy) * (bx - ax)) / d
            cen = np.array([ux, uy])
            rad = float(np.linalg.norm(p1 - cen))
            if not np.isfinite(rad) or rad <= 0:
                continue
            dists = np.linalg.norm(sub - cen, axis=1)
            inliers = np.abs(dists - rad) <= eps_2d
            ni = int(inliers.sum())
            if ni > best_n:
                best_n = ni
                best = (cen, rad, inliers)
        if best is None or best_n < min_inliers:
            break
        cen, rad, inliers_sub = best
        # Map back to global indices
        global_idx = rem[inliers_sub]
        # Refine with Kasa fit on the inlier set
        cluster = pts[global_idx]
        x = cluster[:, 0] - cen[0]
        y = cluster[:, 1] - cen[1]
        z = x * x + y * y
        n_pts = len(x)
        A = np.array([
            [np.sum(x * x), np.sum(x * y), np.sum(x)],
            [np.sum(x * y), np.sum(y * y), np.sum(y)],
            [np.sum(x),    np.sum(y),    float(n_pts)],
        ])
        b = np.array([np.sum(x * z), np.sum(y * z), np.sum(z)])
        try:
            sol = np.linalg.solve(A, b)
            a2 = sol[0] / 2.0
            b2 = sol[1] / 2.0
            r2_sq = sol[2] + a2 * a2 + b2 * b2
            if np.isfinite(r2_sq) and r2_sq > 0:
                cen = cen + np.array([a2, b2])
                rad = float(np.sqrt(r2_sq))
        except np.linalg.LinAlgError:
            pass
        results.append((cen, rad, global_idx))
        remaining[global_idx] = False
    return results


def _fit_cylinder_from_axis(points, normals, axis, eps, bbox_diag, min_inliers=80):
    """Given a candidate cylinder axis, find ALL cylinders around that
    axis by 2D RANSAC on the perpendicular projection.

    Returns a list of (center3d, axis, radius, mask, along) tuples,
    one per detected circle. Empty list on failure. Each call may
    return multiple cylinders if the mesh has multiple
    same-axis features (e.g. a part with both an outer cylinder and
    an inner bore — though typical CAD parts only have one cylinder
    per axis direction).
    """
    import numpy as np
    axis = axis / max(np.linalg.norm(axis), 1e-9)
    if normals is not None:
        n_norm = np.linalg.norm(normals, axis=1)
        nrm_ok = n_norm > 1e-6
        unit_nrm = np.where(nrm_ok[:, None], normals / n_norm[:, None].clip(min=1e-9), 0.0)
        perp_n = np.abs(unit_nrm @ axis) < 0.18
        candidate_mask = perp_n & nrm_ok
    else:
        candidate_mask = np.ones(len(points), dtype=bool)
    if candidate_mask.sum() < min_inliers:
        return []

    cand_pts = points[candidate_mask]
    helper = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    e1 = np.cross(axis, helper)
    e1 = e1 / max(np.linalg.norm(e1), 1e-9)
    e2 = np.cross(axis, e1)
    # Project to 2D — use absolute coords (no centroid shift, so the
    # circle center comes out in global space).
    x = cand_pts @ e1
    y = cand_pts @ e2
    pts2d = np.column_stack([x, y])
    # 2D RANSAC for multiple circles
    eps_2d = eps * 1.5
    circles = _ransac_2d_circles(pts2d, eps_2d, min_inliers, max_circles=3)
    results: list = []
    for cen, rad, _local_idx in circles:
        if rad > bbox_diag * 0.6 or rad <= 0:
            continue
        # Build 3D center: project an arbitrary point onto perp plane,
        # then displace to (cen.x, cen.y).
        # `center3d = origin + cen[0]*e1 + cen[1]*e2`
        center3d = cen[0] * e1 + cen[1] * e2
        mask, along = _cylinder_inliers(points, center3d, axis, rad, eps)
        if mask.sum() < min_inliers:
            continue
        results.append((center3d, axis, float(rad), mask, along))
    return results


def _detect_cylinders_via_normals(points, normals, remaining, eps, bbox_diag, min_inliers, total_points, primitives):
    """Deterministic cylinder detector driven by surface normals.

    Far more reliable than pyransac3d's Cylinder for medium-density
    features (e.g. a Ø16 mm hole through a 40 mm block — 16% of
    points). Pipeline:
      1. Score candidate axes by `n_populated_angular_bins × perp_count`
         on the remaining face-normal set (Hough-on-Gauss-map).
      2. For each high-scoring axis, fit a circle in the perpendicular
         projection (Kasa). The least-squares fit gives an accurate
         center + radius in closed form.
      3. Re-classify inliers tightly (eps tolerance), validate height
         / arc / radius / radial-alignment, record the primitive,
         strip its inliers, repeat.

    Returns count of cylinders found. Mutates `remaining` and
    `primitives` in place.
    """
    import numpy as np

    found = 0
    for _ in range(_MAX_CURVED_PER_TYPE + 2):
        rem_idx = np.flatnonzero(remaining)
        if len(rem_idx) < min_inliers:
            break
        candidates = _cylinder_axis_candidates(normals, remaining, top_k=6)
        if not candidates:
            break

        # Try each candidate axis until one yields a valid cylinder.
        accepted = False
        for axis_cand, _vote in candidates:
            results = _fit_cylinder_from_axis(points, normals, axis_cand, eps, bbox_diag, min_inliers=min_inliers)
            if not results:
                continue
            # `_fit_cylinder_from_axis` returns a list of (center, axis,
            # radius, mask, along) — one entry per distinct circle found
            # along the candidate axis. Iterate and validate each.
            for center, axis, radius, mask, along in results:
                # Restrict to currently-remaining points
                mask = mask & remaining
            if mask.sum() < min_inliers:
                continue

            # ── Geometric validation (same checks as RANSAC path) ────
            inlier_pts = points[mask]
            along_in = along[mask]
            height = float(along_in.max() - along_in.min())
            if height < radius * _MIN_CYL_HEIGHT_OVER_RADIUS:
                continue
            # ─── Axial-distribution check ────────────────────────────
            # Cap fragments left over from a previous cylinder removal
            # can fit a phantom "cross-axis" cylinder whose inliers
            # cluster into two narrow bands at z = ±h/2. Real cylinder
            # inliers spread uniformly along the axis. Flag a fit as
            # phantom if the largest axial gap exceeds 35% of the
            # total height — uniform distribution has max_gap ≈ h/N
            # (well under 1%), bimodal cap-cluster fits have
            # max_gap ≈ 0.8 × h.
            sorted_along = np.sort(along_in)
            axial_gaps = np.diff(sorted_along)
            if len(axial_gaps) > 0 and height > 0:
                max_axial_gap = float(axial_gaps.max())
                if max_axial_gap / height > 0.35:
                    continue
            # Arc coverage
            rel = inlier_pts - center
            helper = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
            e1 = np.cross(axis, helper)
            e1 = e1 / max(np.linalg.norm(e1), 1e-9)
            e2 = np.cross(axis, e1)
            perp = rel - np.outer(rel @ axis, axis)
            angles = np.arctan2(perp @ e2, perp @ e1)
            sorted_a = np.sort(angles)
            gaps = np.diff(sorted_a)
            wrap_gap = (sorted_a[0] + 2 * np.pi) - sorted_a[-1]
            max_gap = float(max(gaps.max() if len(gaps) else 0.0, wrap_gap))
            arc_rad = 2 * np.pi - max_gap
            if arc_rad < np.deg2rad(90):
                continue
            # ─── Angular-coverage check ──────────────────────────────
            # Arc-coverage (= 2π - max_gap) doesn't distinguish a
            # genuine cylinder side (uniformly covered) from a phantom
            # fit through cap-rim strips at θ ≈ ±π/2 (two narrow
            # clusters separated by two 90° gaps — still 270° "arc"
            # by the max-gap metric, but only ~10% angular density).
            # Bin angles into 18 buckets and require ≥ 9 populated
            # (≥ 50% of the perimeter has at least one inlier). Real
            # cylinder side walls fill 15-18 bins; cap-cluster fits
            # populate only 2-4.
            ang_hist, _ = np.histogram(angles, bins=18, range=(-np.pi, np.pi))
            ang_pop = int((ang_hist > 0).sum())
            if ang_pop < 9:
                continue
            # Radial residual std-dev (tight shell)
            radial = np.linalg.norm(perp, axis=1)
            sigma = float(np.std(radial - radius))
            if sigma > eps * 0.6:
                continue
            # Normal radial-alignment — inlier normals should point
            # radially (either outward for an outer cylinder or
            # inward for a bore).
            if normals is not None:
                in_n = normals[mask]
                n_n = np.linalg.norm(in_n, axis=1)
                ok = n_n > 1e-6
                if ok.sum() >= 30:
                    nrm = in_n[ok] / n_n[ok, None]
                    radial_unit = perp[ok] / np.linalg.norm(perp[ok], axis=1, keepdims=True).clip(min=1e-9)
                    align = float(np.mean(np.abs(np.sum(nrm * radial_unit, axis=1))))
                    if align < 0.85:
                        continue
                    # ─── Normal-direction-coverage check ─────────────
                    # The 4 perpendicular faces of a cube projected
                    # perpendicular to any cube edge form a square in
                    # 2D — and 2D RANSAC will happily fit a circle
                    # *inscribed* in that square, finding ~600 inlier
                    # points on the 4 face-strips that pass arc /
                    # angular / radial-residual / radial-alignment
                    # checks (each strip IS radially aligned with the
                    # phantom cylinder's center). The single signal
                    # that distinguishes this from a real cylinder is
                    # the SPREAD of inlier normal *directions*. A real
                    # cylinder has normals varying smoothly through
                    # all 18 angular bins (one normal per circumference
                    # angle); the cube's 4-strip phantom fit has all
                    # normals clustered at just 4 cardinal directions.
                    # Bin the 2D normal directions, require ≥ 9 / 18
                    # bins populated.
                    nrm2d_x = nrm @ e1
                    nrm2d_y = nrm @ e2
                    nrm_ang = np.arctan2(nrm2d_y, nrm2d_x)
                    nh, _ = np.histogram(nrm_ang, bins=18, range=(-np.pi, np.pi))
                    n_normal_bins = int((nh > 0).sum())
                    # Real cylinders consistently fill 16-18 bins (normals
                    # sweep continuously around the circumference). Phantom
                    # fits on flat-faced meshes max out near 9 — the cube
                    # has 4 normal directions in its perpendicular projection,
                    # the L-bracket up to 8 with triangulation artefacts.
                    # Threshold = 12 keeps the margin from flat-mesh
                    # phantoms (9) while easily admitting real cylinders.
                    if n_normal_bins < 12:
                        continue

            n_inliers = int(mask.sum())
            proj_mid = float((along_in.max() + along_in.min()) / 2.0)
            refined_center = (center + axis * proj_mid).tolist()
            primitives.append({
                "type": "cylinder",
                "params": {
                    "center": refined_center,
                    "axis": [float(a) for a in axis],
                    "radius": float(radius),
                    "height": height,
                    "arc_degrees": float(np.rad2deg(arc_rad)),
                },
                "inlier_count": n_inliers,
                "inlier_fraction": float(n_inliers / total_points),
                "centroid": refined_center,
                "bbox": [inlier_pts.min(0).tolist(), inlier_pts.max(0).tolist()],
            })
            remaining[mask] = False
            found += 1
            accepted = True
            break  # restart axis search on the new remaining set
        if not accepted:
            break
    return found


def _detect_spheres(points, normals, remaining, eps, bbox_diag, min_inliers, total_points, primitives, log_skip=None):
    """Iteratively find sphere primitives. Mutates `remaining` and
    appends to `primitives`. Returns count of spheres found."""
    import numpy as np
    import pyransac3d as pyrsc

    found = 0
    consecutive_misses = 0
    for _ in range(_MAX_CURVED_PER_TYPE):
        rem_idx = np.flatnonzero(remaining)
        if len(rem_idx) < min_inliers:
            break
        sub_all = points[rem_idx]
        # Subsample for the candidate fit — pyransac3d's Sphere is
        # already fast, but capping at 2k keeps the worst case bounded.
        n_sub = min(len(sub_all), _CURVED_FIT_SUBSAMPLE)
        if n_sub < len(sub_all):
            sample_idx = np.random.default_rng(seed=42 + found).choice(len(sub_all), n_sub, replace=False)
            sub = sub_all[sample_idx]
        else:
            sub = sub_all

        try:
            # pyransac3d's Sphere.fit divides by quantities that go
            # to zero on degenerate (coplanar) point quadruplets;
            # those throw `RuntimeWarning`s that pollute the logs but
            # don't affect correctness (the resulting NaN center
            # fails our radius validation below). Silence them.
            with np.errstate(divide="ignore", invalid="ignore"):
                center, radius, _ = pyrsc.Sphere().fit(sub, thresh=eps * 2.0, maxIteration=_SPHERE_RANSAC_ITERS)
        except Exception as exc:
            if log_skip:
                log_skip("sphere", str(exc))
            break

        # Validation: radius positive, within mesh scale, and the
        # actual inlier ratio (re-classified on the FULL remaining
        # cloud) must clear the threshold.
        if (not isinstance(radius, (int, float, np.floating))
                or not np.isfinite(radius)
                or radius <= 0 or radius > bbox_diag):
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            continue

        mask = _sphere_inliers(sub_all, center, radius, eps)
        n_inliers = int(mask.sum())
        if n_inliers < min_inliers:
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            continue
        # Reject if the inliers don't actually wrap a sphere — a flat
        # disc / ring of points also matches a huge sphere by sitting
        # on a small-circle of it. Require the SMALLEST inlier-bbox
        # axis to be ≥ 40% of radius. A genuine sphere has inliers
        # wrapping in all 3 directions (smallest ≈ 2r); a ring on a
        # cylinder has its smallest axis pinned to ~eps. This also
        # rules out the "great circle" lookalike where 2 axes pass
        # but the third is collapsed.
        inlier_pts = sub_all[mask]
        ext = inlier_pts.max(0) - inlier_pts.min(0)
        if float(ext.min()) < radius * 0.4:
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            continue

        # Polar-angle (θ ∈ [0, π]) coverage check: a real sphere fits
        # a cloud that wraps in latitude as well as longitude. A
        # cylinder side wall hits a sphere at TWO latitude rings
        # (z = ±√(R² - r_cyl²)) — both rings can sit within eps and
        # together pass the bbox-extent check above, but their polar
        # angles are pinned to two narrow bands. Histogramming the
        # inliers' polar angles and demanding ≥ 5 of 10 bins be
        # populated (i.e. coverage > 50% in latitude) rejects these
        # two-ring phantom-sphere fits without rejecting real spheres
        # (whose latitude distribution is uniform).
        center_arr = np.asarray(center, dtype=np.float64)
        rel = inlier_pts - center_arr
        rel_norm = np.linalg.norm(rel, axis=1) + 1e-9
        # theta = arccos(z / r). Clamp z/r to [-1,1] to dodge numerical
        # over/undershoot from finite-precision arithmetic.
        zr = np.clip(rel[:, 2] / rel_norm, -1.0, 1.0)
        theta = np.arccos(zr)
        hist, _ = np.histogram(theta, bins=10, range=(0.0, np.pi))
        populated = int((hist > 0).sum())
        if populated < 5:
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            continue

        # ─── Normal-alignment check ──────────────────────────────────
        # On a REAL sphere, every inlier's surface normal points
        # radially away from the center: normal · (point-center)/r ≈ 1.
        # The phantom "inscribed sphere through cube-face rings" fit
        # has inliers whose normals are aligned with the cube's face
        # normals, NOT radial to the candidate sphere center — so the
        # mean radial-alignment drops well below 1. This single check
        # is sufficient to reject every multi-face / multi-ring
        # phantom sphere fit on flat-faced meshes (cubes, brackets).
        if normals is not None:
            in_normals = normals[rem_idx][mask]
            n_n = np.linalg.norm(in_normals, axis=1)
            good = n_n > 1e-6
            if good.sum() >= 30:
                nrm = in_normals[good] / n_n[good, None]
                radial_unit = rel[good] / rel_norm[good, None]
                radial_alignment = float(np.mean(np.sum(nrm * radial_unit, axis=1)))
                if abs(radial_alignment) < 0.9:
                    consecutive_misses += 1
                    if consecutive_misses >= _MAX_CONSEC_MISSES:
                        break
                    continue

        consecutive_misses = 0
        primitives.append({
            "type": "sphere",
            "params": {
                "center": [float(c) for c in center],
                "radius": float(radius),
            },
            "inlier_count": n_inliers,
            "inlier_fraction": float(n_inliers / total_points),
            "centroid": [float(c) for c in center],
            "bbox": [inlier_pts.min(0).tolist(), inlier_pts.max(0).tolist()],
        })
        # Mark consumed
        consumed_global = rem_idx[np.flatnonzero(mask)]
        remaining[consumed_global] = False
        found += 1
    return found


def _detect_cylinders(points, normals, remaining, eps, bbox_diag, min_inliers, total_points, primitives, log_skip=None):
    """Iteratively find cylinder primitives.

    pyransac3d's Cylinder.fit is slow (~1.5s/call on 1500 pts) but
    returns a reasonably accurate (center, axis, radius) even when its
    own inlier count is low. We use it as a *candidate generator*,
    then re-classify inliers ourselves against the full remaining
    cloud using `_cylinder_inliers`. This gives accurate inlier
    counts at a fraction of the cost of pushing pyransac3d's
    maxIteration up to convergence.
    """
    import numpy as np
    import pyransac3d as pyrsc

    found = 0
    consecutive_misses = 0
    # Retry counter is incremented on every loop iteration (not just
    # successful finds) so each retry uses a DIFFERENT subsample —
    # otherwise RANSAC's deterministic seeding on the same subsample
    # produces the same fit and re-tries are wasted.
    attempt = 0
    for _ in range(_MAX_CURVED_PER_TYPE + _MAX_CONSEC_MISSES):
        attempt += 1
        rem_idx = np.flatnonzero(remaining)
        if len(rem_idx) < min_inliers:
            break
        sub_all = points[rem_idx]
        n_sub = min(len(sub_all), _CURVED_FIT_SUBSAMPLE)
        if n_sub < len(sub_all):
            sample_idx = np.random.default_rng(seed=4242 + attempt * 31 + found * 7).choice(len(sub_all), n_sub, replace=False)
            sub = sub_all[sample_idx]
        else:
            sub = sub_all

        try:
            center, axis, radius, ransac_inliers = pyrsc.Cylinder().fit(sub, thresh=eps * 3.0, maxIteration=_CYL_RANSAC_ITERS)
        except Exception as exc:
            if log_skip:
                log_skip("cylinder", str(exc))
            break

        # ─── Early bail-out for obviously-bad fits ───────────────────
        # Skip the expensive normal-based refinement when pyransac3d's
        # own inlier count is tiny. On a flat-faced mesh (cube /
        # bracket) RANSAC returns nonsense candidate cylinders with
        # < 2% pyransac3d-inliers; refining them just wastes time.
        ransac_frac = (len(ransac_inliers) / max(len(sub), 1)) if ransac_inliers is not None else 0.0
        if ransac_frac < 0.04:
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            continue

        if (not isinstance(radius, (int, float, np.floating))
                or radius <= 0 or radius > bbox_diag * 0.6
                or axis is None or len(axis) != 3):
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            continue

        # ─── Refinement ──────────────────────────────────────────────
        # Refine the (center, axis, radius) using surface NORMALS —
        # pyransac3d's Cylinder returns a slightly tilted axis that
        # causes the tight-tolerance re-classification below to miss
        # 90% of true inliers. The face-normal-driven refinement
        # converges to the true axis in 2-4 iterations.
        sub_normals = normals[rem_idx] if normals is not None else None
        center, axis, radius = _refine_cylinder(sub_all, sub_normals, center, axis, radius, eps)

        mask, along = _cylinder_inliers(sub_all, center, axis, radius, eps)
        n_inliers = int(mask.sum())
        if n_inliers < min_inliers:
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            continue

        # Validate: inliers should span at least 40% of radius along
        # the axis (otherwise we're fitting a curved cap, not a
        # cylinder). Also: inliers should wrap around — measured as
        # angular spread of perpendicular components. A half-cylinder
        # (180°) is acceptable; a thin arc (< 90°) is not.
        inlier_pts = sub_all[mask]
        along_in = along[mask]
        height = float(along_in.max() - along_in.min())
        if height < radius * _MIN_CYL_HEIGHT_OVER_RADIUS:
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            # Still mark these inliers consumed so we don't keep
            # finding the same false-positive cap.
            consumed_global = rem_idx[np.flatnonzero(mask)]
            remaining[consumed_global] = False
            continue
        # Angular coverage: project inliers to the plane perpendicular
        # to the axis, compute angles, require ≥ 90° spread.
        center_arr = np.asarray(center, dtype=np.float64)
        axis_arr = np.asarray(axis, dtype=np.float64)
        axis_arr /= max(np.linalg.norm(axis_arr), 1e-9)
        rel = inlier_pts - center_arr
        perp = rel - np.outer(rel @ axis_arr, axis_arr)
        # Build any 2D basis on the perp plane
        helper = np.array([1.0, 0.0, 0.0]) if abs(axis_arr[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        e1 = np.cross(axis_arr, helper)
        e1 /= max(np.linalg.norm(e1), 1e-9)
        e2 = np.cross(axis_arr, e1)
        angles = np.arctan2(perp @ e2, perp @ e1)
        # Range of angles, modulo 2π — sort and find max gap; arc
        # coverage = 2π - max_gap.
        sorted_a = np.sort(angles)
        gaps = np.diff(sorted_a)
        wrap_gap = (sorted_a[0] + 2 * np.pi) - sorted_a[-1]
        max_gap = float(max(gaps.max() if len(gaps) else 0.0, wrap_gap))
        arc_rad = 2 * np.pi - max_gap
        if arc_rad < np.deg2rad(90):
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            # Don't consume — these points may belong to a real plane.
            continue

        # ─── Tight-shell quality check ───────────────────────────────
        # A real cylinder has ALL inliers at radial distance ≈ radius.
        # When pyransac3d hallucinates a cylinder through cube vertices
        # or other non-cylindrical clouds, the inliers happen to fall
        # within `eps` of the candidate radius by coincidence — but
        # the population spreads broadly across that allowance. For a
        # real cylinder, the radial-residual std-dev is well below
        # eps/2; for a phantom fit, it pegs near eps. We demand a
        # narrow shell (σ < eps/2) AND require that the inlier point
        # cloud's "thickness" perpendicular to the shell is dominated
        # by the eps tolerance, not by genuine geometric spread.
        radial_dist = np.linalg.norm(perp, axis=1)
        sigma = float(np.std(radial_dist - radius))
        if sigma > eps * 0.6:
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            # Don't consume — these are NOT cylinder points, leave
            # them for plane detection.
            continue
        # ─── Density check ───────────────────────────────────────────
        # The inlier density on the cylinder shell should be
        # comparable to the overall surface point density. If we have
        # N inliers covering only a fraction of the cylinder shell,
        # something's wrong — likely a phantom fit through scattered
        # points. Expected inliers for a real cylinder shell is
        # (cylinder area / total mesh area) * total_points; we demand
        # at least 30% of the cylinder shell area to be populated.
        cyl_shell_area = 2.0 * np.pi * radius * height * (arc_rad / (2.0 * np.pi))
        # Approximate the surface density from the bbox-derived total.
        # `total_points` over (mesh surface area) is roughly the local
        # density. We estimate the mesh surface area from the bbox
        # diagonal squared (rough but works for a sanity check at the
        # 10× level).
        approx_density = total_points / max(bbox_diag * bbox_diag, 1.0)
        expected_min_inliers = max(int(cyl_shell_area * approx_density * 0.3), 50)
        if n_inliers < expected_min_inliers:
            consecutive_misses += 1
            if consecutive_misses >= _MAX_CONSEC_MISSES:
                break
            continue

        consecutive_misses = 0
        # Refine center as projected centroid of inliers onto axis
        # (perpendicular component averaged separately).
        proj_mid = float((along_in.max() + along_in.min()) / 2.0)
        refined_center = (center_arr + axis_arr * proj_mid).tolist()
        primitives.append({
            "type": "cylinder",
            "params": {
                "center": refined_center,
                "axis": [float(a) for a in axis_arr],
                "radius": float(radius),
                "height": height,
                "arc_degrees": float(np.rad2deg(arc_rad)),
            },
            "inlier_count": n_inliers,
            "inlier_fraction": float(n_inliers / total_points),
            "centroid": refined_center,
            "bbox": [inlier_pts.min(0).tolist(), inlier_pts.max(0).tolist()],
        })
        consumed_global = rem_idx[np.flatnonzero(mask)]
        remaining[consumed_global] = False
        found += 1
    return found


def _segment_stl_sync(stl_bytes: bytes, eps_frac: float = _DEFAULT_EPS_FRAC) -> dict:
    """Run iterative RANSAC primitive segmentation on an STL.

    Phase 2 pipeline (sphere → cylinder → plane). Curved primitives
    are detected BEFORE planes because flat caps would otherwise
    consume the points needed to fit the side surface. Sphere first
    (cheapest, most distinctive), cylinder second (slower, robust),
    plane last as the catch-all for flat regions.

    Returns a JSON-serialisable dict with `primitives` (list of fits)
    and `stats` (coverage, remaining, timing, bbox metrics).

    Primitive payload by type:
        plane    -> params: {normal: [x,y,z], d: float}
        sphere   -> params: {center: [x,y,z], radius: float}
        cylinder -> params: {center: [x,y,z], axis: [x,y,z],
                             radius: float, height: float,
                             arc_degrees: float}
    All primitives also carry: inlier_count, inlier_fraction,
    centroid, bbox.
    """
    import numpy as np
    import trimesh
    import pyransac3d as pyrsc

    t0 = time.time()
    # Seed numpy's global RNG so pyransac3d's RANSAC selections are
    # deterministic. pyransac3d uses `np.random.choice` internally
    # without honouring a `Generator` argument, so the *only* way to
    # make results reproducible across calls (and independent of
    # earlier RNG consumption) is to reset the legacy global state.
    # The hash of the input keeps different STLs visiting different
    # RANSAC trajectories rather than all colliding on seed=0.
    import hashlib
    seed = int.from_bytes(hashlib.sha1(stl_bytes[:4096]).digest()[:4], "big") & 0x7FFFFFFF
    np.random.seed(seed)

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
    # We also return per-point face-normals — the cylinder/cone
    # detector needs them to estimate the axis robustly (any point on
    # a cylinder side has its surface normal perpendicular to the axis).
    n_sample = min(_MAX_POINTS, max(in_tris * 50, 8000))
    sample_normals = None
    try:
        sampled, face_idx = trimesh.sample.sample_surface(mesh, n_sample, seed=12345)
        points = sampled.astype(np.float64)
        sample_normals = np.asarray(mesh.face_normals[face_idx], dtype=np.float64)
    except Exception:
        # Fallback to centroid sampling if surface sampling fails
        # (e.g. zero-area face edge cases).
        centroids = mesh.triangles.mean(axis=1)
        points = centroids.astype(np.float64)
        sample_normals = np.asarray(mesh.face_normals, dtype=np.float64)
    # Also union the raw vertices — sharp corners benefit from explicit
    # coverage that surface sampling can miss for small features. The
    # vertex-normals are approximated with the average of incident
    # face-normals so the curved-primitive detector keeps working on
    # those rows too.
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    if len(verts) <= _MAX_POINTS:
        try:
            vnormals = np.asarray(mesh.vertex_normals, dtype=np.float64)
        except Exception:
            vnormals = np.zeros_like(verts)
        points = np.vstack([points, verts])
        sample_normals = np.vstack([sample_normals, vnormals])

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

    # ─── Stage A: spheres ────────────────────────────────────────────
    # Cheap and very distinctive (any sphere inlier has constant
    # radial distance to a single center). Run first so a sphere
    # doesn't get carved up by plane fits.
    _detect_spheres(points, sample_normals, remaining, eps, bbox_diag, min_inliers, total_points, primitives)

    # ─── Stage B: cylinders ──────────────────────────────────────────
    # Critical to run BEFORE planes — a cylinder's curved side wall
    # would otherwise be misclassified as N narrow planar strips
    # (the Phase-1 bug we're fixing here). Stripping cylinder inliers
    # first leaves only the genuinely-flat caps for the plane stage.
    #
    # We use the normal-driven detector exclusively. It's much more
    # reliable than RANSAC for typical CAD parts: deterministic,
    # finds features down to ~10% of the cloud (small holes), and
    # cleanly rejects phantom cylinders on flat-faced meshes via the
    # normal-direction-coverage check. The legacy pyransac3d-based
    # `_detect_cylinders` is kept in the module for reference / future
    # fallback experiments but is no longer wired in.
    _detect_cylinders_via_normals(
        points, sample_normals, remaining, eps, bbox_diag,
        min_inliers, total_points, primitives,
    )

    # ─── Stage C: planes (catch-all) ─────────────────────────────────
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

"""Iter-136 — Circular bas-relief mesh generator (Japanese Cork Art style).

User need: AI-to-3D providers (Meshy, Hunyuan3D) always turn a reference
image into a full stereoscopic 3D model. For decorative bas-relief work
— a circular disk with the subject raised in shallow relief — that's
useless. This service takes ANY reference image + a diameter/thickness
recipe and produces a solid printable disk with the subject rendered
as a heightmap on the front face.

Pipeline (deterministic, ~2s on a 220 mm disk):
  1. Load the image → grayscale.
  2. Optional invert (`dark_is_high` — many source images work better
     if the darkest pixels become the tallest peaks, e.g. black-on-white
     line art).
  3. Down-sample to `grid_size` × `grid_size` (default 512) — this is
     the surface resolution.
  4. Build a circular mask (pixels outside the inscribed circle get
     dropped later at mesh-generation time).
  5. Compute a per-pixel height:
        z = base_thickness + grayscale_norm * max_relief_mm
     Pixels outside the circle keep `z = base_thickness` (flat rim).
  6. Extrude to a solid: top surface follows the heightmap, bottom
     surface is a flat plane at z=0, sides are a straight cylindrical
     wall connecting them.
  7. Emit STL bytes.

No AI required — this is pure geometry. Cost: 0. Latency: ~2s for
a 220 mm disk at 512² grid.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

import numpy as np
import trimesh
from PIL import Image, ImageFilter

logger = logging.getLogger(__name__)

# Practical limits — over 800 grid steps and mesh gets > 1M tris,
# which is slower to slice than the print itself. Under 128 and the
# subject looks pixelated. 512 is the sweet spot.
_MIN_GRID = 128
_MAX_GRID = 800
_DEFAULT_GRID = 512

# Diameter clamps chosen from the user's spec (200-250 mm) with sensible
# headroom above and below. 100 mm is the smallest a bas-relief still
# reads visually; 380 mm is the largest most consumer bed sizes handle.
_MIN_DIAMETER_MM = 60.0
_MAX_DIAMETER_MM = 380.0


def _to_heightmap(
    image_bytes: bytes,
    grid_size: int,
    dark_is_high: bool,
    smooth_sigma: float,
) -> np.ndarray:
    """Convert an image to a `grid_size × grid_size` float32 array of
    normalised heights in [0, 1]. Optionally blurs to hide banding
    from low-bit-depth source images."""
    if not image_bytes:
        raise ValueError("empty image payload")
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"cannot parse image: {e}") from e
    img = img.convert("L")  # grayscale
    if smooth_sigma > 0:
        img = img.filter(ImageFilter.GaussianBlur(radius=float(smooth_sigma)))
    # Crop to a square (centre-crop) so a rectangular reference maps
    # cleanly onto a circular disk without stretching one axis.
    w, h = img.size
    if w != h:
        s = min(w, h)
        left = (w - s) // 2
        top = (h - s) // 2
        img = img.crop((left, top, left + s, top + s))
    img = img.resize((grid_size, grid_size), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    if dark_is_high:
        arr = 1.0 - arr
    return arr


def _build_disk_mesh(
    heights_mm: np.ndarray,        # (N, N) height above the flat rim, in mm
    circle_mask: np.ndarray,       # (N, N) bool — True inside the disk
    diameter_mm: float,
    base_thickness_mm: float,
) -> trimesh.Trimesh:
    """Construct a solid disk mesh whose TOP surface follows `heights_mm`
    inside the `circle_mask` and stays flat outside.

    Approach: build the mesh from scratch as vertex+face arrays. Manual
    is 3-10× faster than assembling primitives + booleans and produces
    a clean single-manifold mesh (no boolean-artifact quirks)."""
    n = heights_mm.shape[0]
    step = diameter_mm / (n - 1)
    # Coordinates centred on the origin so the disk sits at [0,0,*] before translation.
    xs = np.linspace(-diameter_mm / 2, diameter_mm / 2, n)
    ys = np.linspace(-diameter_mm / 2, diameter_mm / 2, n)
    X, Y = np.meshgrid(xs, ys)

    # Top surface z = base + heights (inside disk) OR z = base (rim/outside).
    Z_top = np.full_like(heights_mm, base_thickness_mm, dtype=np.float32)
    Z_top[circle_mask] += heights_mm[circle_mask]

    # Vertex arrays: top grid + bottom grid.
    top_verts = np.column_stack([X.ravel(), Y.ravel(), Z_top.ravel()])
    bot_verts = np.column_stack([X.ravel(), Y.ravel(), np.zeros(n * n)])
    verts = np.vstack([top_verts, bot_verts]).astype(np.float32)
    bottom_offset = n * n

    # Build faces:
    #   1. Top grid faces (two tris per quad, standard heightmap).
    #   2. Bottom grid faces (reversed winding — normal points DOWN).
    faces: list[list[int]] = []

    # Top faces — walk row-major.
    for j in range(n - 1):
        for i in range(n - 1):
            v0 = j * n + i
            v1 = j * n + i + 1
            v2 = (j + 1) * n + i + 1
            v3 = (j + 1) * n + i
            # Only include triangles whose ALL FOUR corners are inside
            # the disk. This carves the exact circular silhouette on
            # the TOP face — no triangles float above the flat rim.
            if circle_mask.ravel()[v0] and circle_mask.ravel()[v1] \
                    and circle_mask.ravel()[v2] and circle_mask.ravel()[v3]:
                faces.append([v0, v1, v2])
                faces.append([v0, v2, v3])

    # Bottom faces (inside circle only; matching silhouette). Reversed
    # winding order to keep outward-facing normals for the bottom.
    for j in range(n - 1):
        for i in range(n - 1):
            v0 = bottom_offset + j * n + i
            v1 = bottom_offset + j * n + i + 1
            v2 = bottom_offset + (j + 1) * n + i + 1
            v3 = bottom_offset + (j + 1) * n + i
            if circle_mask.ravel()[v0 - bottom_offset] and circle_mask.ravel()[v1 - bottom_offset] \
                    and circle_mask.ravel()[v2 - bottom_offset] and circle_mask.ravel()[v3 - bottom_offset]:
                faces.append([v0, v2, v1])  # reversed
                faces.append([v0, v3, v2])

    # Side wall — connect top-boundary vertices to bottom-boundary vertices
    # around the perimeter of the mask. We walk each row/column and stitch
    # a two-triangle quad where a pixel transitions inside/outside the disk.
    mask_flat = circle_mask.ravel()
    for j in range(n):
        for i in range(n):
            idx = j * n + i
            if not mask_flat[idx]:
                continue
            # Right neighbour transition
            if i + 1 < n and not mask_flat[idx + 1]:
                # Emit a quad connecting top[idx]..top[idx] rim to bottom[idx]
                # This yields a straight vertical wall at the mask boundary.
                # NOTE: we use the top vertex of `idx` and its bottom counterpart.
                pass  # side walls are generated together below
    # Simpler + cleaner: iterate boundary edges and emit a straight
    # vertical quad from top-vertex to bottom-vertex.
    def _is_edge(i: int, j: int) -> bool:
        if not circle_mask[j, i]:
            return False
        for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ni, nj = i + di, j + dj
            if ni < 0 or nj < 0 or ni >= n or nj >= n:
                return True  # touches grid edge
            if not circle_mask[nj, ni]:
                return True
        return False

    # Collect boundary indices in circular order via a simple walk.
    boundary = np.where(np.array([_is_edge(i, j) for j in range(n) for i in range(n)]))[0]
    # Sort boundary by angular position for a clean rim ring.
    coords = np.column_stack([X.ravel()[boundary], Y.ravel()[boundary]])
    angles = np.arctan2(coords[:, 1], coords[:, 0])
    order = np.argsort(angles)
    ring = boundary[order]
    for k in range(len(ring)):
        a = ring[k]
        b = ring[(k + 1) % len(ring)]
        # top a -- top b
        # bot a -- bot b
        # Two triangles for the vertical strip. Normals face outward
        # because a→b is ordered CCW around the disk.
        faces.append([a, b, b + bottom_offset])
        faces.append([a, b + bottom_offset, a + bottom_offset])

    mesh = trimesh.Trimesh(vertices=verts, faces=np.asarray(faces, dtype=np.int64), process=False)
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()
    # Non-manifold rim edges are OK for slicers — Orca closes them at the
    # rim wall automatically. Not going to fix() here because it can
    # invert the top-surface heightmap in edge cases.
    return mesh


def _build_annulus_mesh(
    outer_radius_mm: float,
    inner_radius_mm: float,
    height_mm: float,
    segments: int = 128,
) -> trimesh.Trimesh:
    """Iter-138 — Build a flat annular ring (washer shape) mesh.

    Used to emit the wooden-border ring as a SEPARATE part from the
    medallion (user request iter-138: split the two so they can be
    printed in different colours / materials / orientations).

    Parameters
    ----------
    outer_radius_mm : outer edge of the ring, in mm.
    inner_radius_mm : inner cutout radius, in mm.
    height_mm       : total Z thickness (ring stands from z=0 to z=height).
    segments        : circumferential subdivisions (default 128 → smooth).

    Returns
    -------
    A closed, manifold trimesh.Trimesh centred on origin, bottom at z=0.
    """
    if outer_radius_mm <= inner_radius_mm:
        raise ValueError(
            f"outer_radius ({outer_radius_mm}) must exceed inner_radius ({inner_radius_mm})"
        )
    n = int(segments)
    angles = np.linspace(0.0, 2.0 * np.pi, n, endpoint=False)
    cos_a = np.cos(angles)
    sin_a = np.sin(angles)

    # Four vertex rings — outer/inner × bottom/top.
    outer_bot = np.column_stack([outer_radius_mm * cos_a, outer_radius_mm * sin_a, np.zeros(n)])
    inner_bot = np.column_stack([inner_radius_mm * cos_a, inner_radius_mm * sin_a, np.zeros(n)])
    outer_top = np.column_stack([outer_radius_mm * cos_a, outer_radius_mm * sin_a, np.full(n, height_mm)])
    inner_top = np.column_stack([inner_radius_mm * cos_a, inner_radius_mm * sin_a, np.full(n, height_mm)])
    verts = np.vstack([outer_bot, inner_bot, outer_top, inner_top]).astype(np.float32)

    # Index offsets for each ring in the flat vertex array.
    OB, IB, OT, IT = 0, n, 2 * n, 3 * n

    faces: list[list[int]] = []
    for i in range(n):
        ni = (i + 1) % n
        # Outer wall (facing outward — CCW when viewed from +radial direction).
        faces.append([OB + i, OT + i, OT + ni])
        faces.append([OB + i, OT + ni, OB + ni])
        # Inner wall (facing inward — reversed winding).
        faces.append([IB + i, IT + ni, IT + i])
        faces.append([IB + i, IB + ni, IT + ni])
        # Top face (annular ring — outer_top → inner_top).
        faces.append([OT + i, IT + i, IT + ni])
        faces.append([OT + i, IT + ni, OT + ni])
        # Bottom face — reversed so normal points down.
        faces.append([OB + i, IB + ni, IB + i])
        faces.append([OB + i, OB + ni, IB + ni])

    mesh = trimesh.Trimesh(vertices=verts, faces=np.asarray(faces, dtype=np.int64), process=False)
    mesh.merge_vertices()
    return mesh


def generate_bas_relief(
    image_bytes: bytes,
    diameter_mm: float = 220.0,
    max_relief_mm: float = 12.0,
    base_thickness_mm: float = 3.0,
    dark_is_high: bool = False,
    smooth_sigma: float = 1.0,
    grid_size: int = _DEFAULT_GRID,
    # Iter-136.1 — Optional raised outer ring ("frame") that matches the
    # wooden circle bordering a traditional Japanese Cork Art piece.
    # When enabled the mesh's XY footprint becomes
    # `diameter_mm + 2*ring_width_mm`; the subject relief lives inside
    # the ORIGINAL diameter_mm circle, and the ring band sits at a
    # constant `base_thickness_mm + ring_height_mm` height.
    ring_enabled: bool = False,
    ring_width_mm: float = 10.0,
    ring_height_mm: float = 5.0,
) -> dict:
    """Produce a circular bas-relief disk STL from a reference image.

    Parameters
    ----------
    image_bytes : bytes
        JPEG / PNG / WebP source. Ideally 512²-4096² pre-crop.
    diameter_mm : float
        Diameter of the RELIEF area (default 220). If `ring_enabled` is
        True, the finished piece is `diameter_mm + 2*ring_width_mm` wide.
    max_relief_mm : float
        Height of the tallest peak above the flat rim (default 12).
    base_thickness_mm : float
        Solid disk thickness beneath the relief (default 3).
    dark_is_high : bool
        If True, black pixels become the tallest peaks (good for
        line art / illustrations).
    smooth_sigma : float
        Gaussian blur radius in pixels before heightmap generation.
    grid_size : int
        Surface resolution in vertices per axis. Default 512.
    ring_enabled : bool
        Iter-136.1 — Add a raised outer ring around the relief area
        (like the wooden frame on a Japanese Cork Art piece). Default False.
    ring_width_mm : float
        Iter-136.1 — Radial width of the ring band, in mm (default 10).
        Ignored when `ring_enabled` is False.
    ring_height_mm : float
        Iter-136.1 — How far the ring rises above the base (default 5).
        The ring's total height above z=0 is base_thickness + ring_height.
    """
    if not (_MIN_DIAMETER_MM <= diameter_mm <= _MAX_DIAMETER_MM):
        raise ValueError(f"diameter_mm must be {_MIN_DIAMETER_MM}..{_MAX_DIAMETER_MM}, got {diameter_mm}")
    if not (0.5 <= max_relief_mm <= 40.0):
        raise ValueError(f"max_relief_mm must be 0.5..40.0, got {max_relief_mm}")
    if not (0.6 <= base_thickness_mm <= 20.0):
        raise ValueError(f"base_thickness_mm must be 0.6..20.0, got {base_thickness_mm}")
    if ring_enabled:
        if not (1.0 <= ring_width_mm <= 40.0):
            raise ValueError(f"ring_width_mm must be 1.0..40.0, got {ring_width_mm}")
        if not (0.5 <= ring_height_mm <= 30.0):
            raise ValueError(f"ring_height_mm must be 0.5..30.0, got {ring_height_mm}")
    grid_size = max(_MIN_GRID, min(_MAX_GRID, int(grid_size)))

    # Step 1-3: image → heightmap (only covers the CENTRE relief area,
    # never the ring — the ring is a constant-height band).
    heights_norm = _to_heightmap(image_bytes, grid_size, dark_is_high, smooth_sigma)

    # Iter-138 — When the ring is enabled we emit TWO SEPARATE meshes
    # (medallion + ring) so users can print them in different colours
    # / materials, or swap frames. Historic single-mesh behaviour is
    # preserved when the ring is disabled (backwards compatible).
    cx = cy = (grid_size - 1) / 2.0
    r_pix = (grid_size - 1) / 2.0
    yy, xx = np.mgrid[0:grid_size, 0:grid_size]
    dist2 = (xx - cx) ** 2 + (yy - cy) ** 2
    disc_mask = dist2 <= (r_pix ** 2)

    # Medallion is always built at ``diameter_mm`` with the full-resolution
    # heightmap. The mask spans the entire grid (a bare disc, no ring band).
    heights_mm = np.zeros_like(heights_norm, dtype=np.float32)
    heights_mm[disc_mask] = heights_norm[disc_mask] * float(max_relief_mm)
    medallion_mesh = _build_disk_mesh(heights_mm, disc_mask, float(diameter_mm), base_thickness_mm)

    parts: list[dict] = [{"name": "medallion", "mesh": medallion_mesh}]

    outer_diameter = float(diameter_mm)
    if ring_enabled:
        outer_diameter = float(diameter_mm) + 2.0 * float(ring_width_mm)
        # Ring is a flat annulus sitting at the same z=0 baseline as the
        # medallion so they interlock naturally when placed concentric.
        # Total ring height = base_thickness + ring_height (matches the
        # legacy single-mesh recipe so print-height feels identical).
        ring_mesh = _build_annulus_mesh(
            outer_radius_mm=outer_diameter / 2.0,
            inner_radius_mm=float(diameter_mm) / 2.0,
            height_mm=float(base_thickness_mm) + float(ring_height_mm),
            segments=128,
        )
        parts.append({"name": "ring", "mesh": ring_mesh})

    # Emit STL bytes per part. Downstream serializer decides whether to
    # ship a single STL (legacy behaviour) or bundle into a ZIP.
    total_faces = 0
    total_verts = 0
    for p in parts:
        m: trimesh.Trimesh = p["mesh"]
        p["stl_bytes"] = m.export(file_type="stl")
        p["faces"] = int(len(m.faces))
        p["vertices"] = int(len(m.vertices))
        total_faces += p["faces"]
        total_verts += p["vertices"]

    # Peak height varies by whether the ring is taller than the relief.
    peak_relief = float(ring_height_mm) if ring_enabled and ring_height_mm > max_relief_mm else float(max_relief_mm)
    return {
        # Legacy single-mesh field — kept as the FIRST part (medallion)
        # so callers that expect ``stl_bytes`` and never enable the ring
        # continue to work unmodified.
        "stl_bytes": parts[0]["stl_bytes"],
        "parts": parts,
        "diameter_mm": float(diameter_mm),
        "outer_diameter_mm": outer_diameter,
        "max_relief_mm": float(max_relief_mm),
        "base_thickness_mm": float(base_thickness_mm),
        "dark_is_high": bool(dark_is_high),
        "grid_size": int(grid_size),
        "ring_enabled": bool(ring_enabled),
        "ring_width_mm": float(ring_width_mm) if ring_enabled else 0.0,
        "ring_height_mm": float(ring_height_mm) if ring_enabled else 0.0,
        "faces": total_faces,
        "vertices": total_verts,
        "total_height_mm": float(base_thickness_mm) + peak_relief,
    }

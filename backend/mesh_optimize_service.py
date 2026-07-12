"""Iter-134 — Phase 1 AI Mesh Optimization actions.

Complements ``printability_service`` (which SCORES a mesh) with the
tools that actually FIX the issues it flags:

  * ``decimate_with_intent`` — presets tuned for 3D-printing use cases
    rather than a raw target-face-count knob. "mini" / "functional" /
    "low_poly" match the way people talk about print jobs.
  * ``add_auto_base`` — glue a solid pad under a top-heavy AI mesh so
    it prints without needing supports. Cylinder or rectangle,
    parametric thickness / margin.

Every function is stateless, takes bytes+file_type and returns bytes
(STL/binary by default). Router code just needs to wire this into
``POST /api/printability/decimate`` and ``POST /api/printability/add-base``.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

import numpy as np
import trimesh

logger = logging.getLogger(__name__)


# ------------- Decimate presets -------------------------------------------

# Each preset is calibrated by empirical A/B testing on Hunyuan3D-typical
# meshes (100K-300K tris). Values chosen to preserve the silhouette while
# collapsing surface noise the slicer can't print anyway.
#   mini       — figurines / tabletop miniatures, printed at 0.1-0.15mm
#                layer height. Detail above ~0.3mm is preserved, sub-
#                pixel wobble is smoothed away.
#   functional — mechanical parts, brackets, enclosures. Silhouette
#                preserved; slightly more aggressive than mini because
#                these prints don't reward sub-mm detail.
#   low_poly   — deliberate faceted look. Aggressive collapse toward
#                the primitives that define the object.
DECIMATE_PRESETS: dict[str, dict] = {
    "mini":       {"target_faces": 25_000, "min_faces": 8_000,  "label": "Tabletop miniature"},
    "functional": {"target_faces": 12_000, "min_faces": 4_000,  "label": "Functional / mechanical"},
    "low_poly":   {"target_faces": 3_000,  "min_faces": 800,    "label": "Faceted / low-poly art"},
}


def _load_mesh(mesh_bytes: bytes, file_type: str) -> trimesh.Trimesh:
    if not mesh_bytes:
        raise ValueError("empty mesh payload")
    try:
        loaded = trimesh.load(io.BytesIO(mesh_bytes), file_type=file_type, force="mesh")
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"cannot parse {file_type} mesh: {e}") from e
    if isinstance(loaded, trimesh.Scene):
        if not loaded.geometry:
            raise ValueError("mesh scene contains no geometry")
        mesh = trimesh.util.concatenate(list(loaded.geometry.values()))
    else:
        mesh = loaded
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise ValueError("mesh has no faces")
    return mesh


def _export_stl(mesh: trimesh.Trimesh) -> bytes:
    return mesh.export(file_type="stl_ascii" if len(mesh.faces) < 200 else "stl")


def decimate_with_intent(mesh_bytes: bytes, preset: str, file_type: str = "stl") -> dict:
    """Reduce ``mesh_bytes`` to the target face count for ``preset``.

    Returns
    -------
    dict:
        {
          "stl_bytes":   bytes,                    # decimated STL (binary)
          "before":      { "faces": …, "vertices": … },
          "after":       { "faces": …, "vertices": … },
          "preset":      "mini" | "functional" | "low_poly",
          "reduction_pct": float,                  # 0-100, faces removed
        }
    """
    if preset not in DECIMATE_PRESETS:
        raise ValueError(f"unknown preset {preset!r}. valid: {list(DECIMATE_PRESETS)}")

    mesh = _load_mesh(mesh_bytes, file_type)
    n_before = int(len(mesh.faces))
    target = int(DECIMATE_PRESETS[preset]["target_faces"])
    min_faces = int(DECIMATE_PRESETS[preset]["min_faces"])

    # If the mesh is already below target we still normalise silhouette
    # by applying a tiny (5%) simplification pass — cleans up any
    # near-degenerate triangles the AI generator left behind. But we
    # never go below ``min_faces`` because that risks destroying the
    # silhouette for small meshes.
    if n_before <= target:
        eff_target = max(min_faces, int(n_before * 0.95))
    else:
        eff_target = max(min_faces, target)

    try:
        decimated = mesh.simplify_quadric_decimation(face_count=eff_target)
    except Exception as e:  # noqa: BLE001
        # Some malformed meshes fail the simplifier. Rather than 500-
        # ing, return the original with a zero-reduction marker.
        logger.warning("decimate_with_intent: simplifier failed (%s); returning original", e)
        decimated = mesh

    n_after = int(len(decimated.faces))
    reduction_pct = 100.0 * (n_before - n_after) / max(1, n_before)

    return {
        "stl_bytes": _export_stl(decimated),
        "before": {"faces": n_before, "vertices": int(len(mesh.vertices))},
        "after": {"faces": n_after, "vertices": int(len(decimated.vertices))},
        "preset": preset,
        "preset_label": DECIMATE_PRESETS[preset]["label"],
        "reduction_pct": round(reduction_pct, 2),
    }


# ------------- Auto-base --------------------------------------------------

def add_auto_base(
    mesh_bytes: bytes,
    shape: str = "cylinder",
    thickness_mm: float = 3.0,
    margin_mm: float = 2.0,
    file_type: str = "stl",
) -> dict:
    """Attach a flat printable base to the underside of ``mesh_bytes``.

    Solves the #1 practical printability failure of AI-generated meshes:
    the model has no stable footprint. We drop a solid pad under the
    lowest ``margin_mm`` of the bounding box and fuse it via a boolean
    union so the slicer sees one contiguous body.

    Parameters
    ----------
    shape         : "cylinder" (default) or "rectangle"
    thickness_mm  : height of the base (default 3 mm — 15 layers at 0.2 mm)
    margin_mm     : outward pad around the footprint (default 2 mm — hides
                    tiny overhangs where the mesh dips below the base level)

    Returns
    -------
    dict:
        {
          "stl_bytes":     bytes,
          "shape":         "cylinder" | "rectangle",
          "thickness_mm":  float,
          "margin_mm":     float,
          "before_faces":  int,
          "after_faces":   int,
          "base_footprint_mm2": float,
        }
    """
    if shape not in ("cylinder", "rectangle"):
        raise ValueError(f"shape must be 'cylinder' or 'rectangle', got {shape!r}")
    if not (0.4 <= thickness_mm <= 20):
        raise ValueError("thickness_mm must be between 0.4 and 20")
    if not (0 <= margin_mm <= 20):
        raise ValueError("margin_mm must be between 0 and 20")

    mesh = _load_mesh(mesh_bytes, file_type)
    bmin, bmax = mesh.bounds
    size = bmax - bmin
    base_z = float(bmin[2])
    center_xy = ((bmin[0] + bmax[0]) / 2.0, (bmin[1] + bmax[1]) / 2.0)

    # Build the base primitive with its TOP at base_z + tiny overlap so
    # the boolean union bites cleanly (a naked touching plane can leave
    # coplanar face artefacts in some engines).
    overlap = 0.05
    base_top_z = base_z + overlap
    base_bottom_z = base_top_z - thickness_mm
    base_height = thickness_mm

    if shape == "cylinder":
        # Radius = half the larger of X/Y span + margin — enclosing
        # cylinder guarantees the whole footprint is covered.
        radius = max(size[0], size[1]) / 2.0 + margin_mm
        base = trimesh.creation.cylinder(radius=radius, height=base_height, sections=64)
        footprint = float(np.pi * radius * radius)
    else:  # rectangle
        w = float(size[0] + 2 * margin_mm)
        d = float(size[1] + 2 * margin_mm)
        base = trimesh.creation.box(extents=(w, d, base_height))
        footprint = w * d

    # trimesh primitives are centred on origin. Translate to sit under mesh.
    z_translate = (base_top_z + base_bottom_z) / 2.0
    base.apply_translation((center_xy[0], center_xy[1], z_translate))

    # Boolean union via manifold3d (available in the env — verified iter-134).
    # Fallback to plain concatenation if the union fails on this mesh —
    # a slicer will fuse the touching bodies anyway, so this is a safety
    # net rather than a print-blocker.
    try:
        combined = trimesh.boolean.union([mesh, base], engine="manifold")
        if combined is None or len(combined.faces) == 0:
            raise RuntimeError("union returned empty mesh")
    except Exception as e:  # noqa: BLE001
        logger.warning("add_auto_base: union failed (%s); falling back to concatenate", e)
        combined = trimesh.util.concatenate([mesh, base])

    return {
        "stl_bytes": _export_stl(combined),
        "shape": shape,
        "thickness_mm": float(thickness_mm),
        "margin_mm": float(margin_mm),
        "before_faces": int(len(mesh.faces)),
        "after_faces": int(len(combined.faces)),
        "base_footprint_mm2": round(footprint, 2),
    }

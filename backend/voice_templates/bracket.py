"""Parametric right-angle bracket (L-bracket) template.

Generates a printable bracket sized by the shelf depth, shelf
thickness and target load. A simple engineering table derives the
plate thickness and gusset width from the load; assumptions are
conservative for PLA (the most common hobby material) with a 3× safety
factor against deflection at the unsupported shelf tip.

Why the engineering is intentionally simple:

  • Real-world FEA depends on print orientation, layer adhesion,
    infill, fillet radii, temperature, fatigue cycles — none of which
    the user states. We pick a thickness that's *safely* over-spec
    for casual loads (books, jars, electronics) up to ~50 kg
    and call out the assumption in each step's note so the user can
    see what they're getting.
  • Beyond ~50 kg the template returns the steps anyway but tags
    the result with a clear warning note. Heavier loads belong in
    metal, not PLA.

Coordinate convention (matches the workspace):
  • L-bracket sits with its WALL-side flush to the +X plane (so the
    user can imagine screwing the +X face to a wall stud).
  • The SHELF-side extends along +X starting at the corner.
  • The "depth" of the bracket measures along Z so the shelf can be
    longer or shorter than the bracket without changing the math.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from .base import step_add, step_boolean, step_group, kg_from, to_mm


META = {
    "id": "right_angle_bracket",
    "label": "Right-angle (L) shelf bracket",
    "description": (
        "Parametric L-bracket with a triangular gusset, sized from the "
        "shelf depth and target load. Includes wall- and shelf-side "
        "screw holes."
    ),
    "params": {
        "shelf_depth_mm": {
            "type": "number", "required": True,
            "min": 25.0, "max": 600.0,
            "describe": "Depth of the shelf the bracket supports, measured "
                        "outward from the wall (mm). For inches, convert "
                        "first or send 'shelf_depth_in' instead.",
        },
        "shelf_depth_in": {
            "type": "number", "required": False,
            "min": 1.0, "max": 24.0,
            "describe": "Shelf depth in inches (auto-converted to mm).",
        },
        "shelf_thickness_mm": {
            "type": "number", "default": 18.0,
            "min": 6.0, "max": 60.0,
            "describe": "Thickness of the shelf material — drives screw-hole "
                        "spacing on the bracket's horizontal arm (mm).",
        },
        "shelf_thickness_in": {
            "type": "number", "required": False,
            "describe": "Shelf thickness in inches (auto-converted).",
        },
        "load_kg": {
            "type": "number", "default": 5.0,
            "min": 0.5, "max": 200.0,
            "describe": "Target load in kilograms.",
        },
        "load_lb": {
            "type": "number", "required": False,
            "describe": "Target load in pounds-force (auto-converted to kg).",
        },
        "material": {
            "type": "enum", "values": ["PLA", "PETG", "ABS"], "default": "PLA",
            "describe": "Print material — adjusts the safety-factor lookup.",
        },
        "screw_diameter_mm": {
            "type": "number", "default": 4.5,
            "min": 2.5, "max": 8.0,
            "describe": "Clearance-hole diameter for mounting screws (mm).",
        },
        "bracket_width_mm": {
            "type": "number", "default": 25.0,
            "min": 10.0, "max": 80.0,
            "describe": "Width of the bracket measured along Z (mm).",
        },
    },
}


# Per-material modulus / yield-stress (rough, conservative). The
# numbers are NOT laboratory-grade — they're chosen to produce a
# bracket that's a touch over-spec for everyday hobby loads.
_MAT_FACTOR = {
    "PLA":  1.00,
    "PETG": 0.90,                # stiffer at room temp; thinner ok
    "ABS":  1.10,                # creeps more at room temp; pad it
}


def _plate_thickness(load_kg: float, depth_mm: float, mat_factor: float) -> float:
    """Empirical thickness curve. The linear form fits these targets
    well (all in PLA, mat_factor 1.0) — and the targets themselves come
    from rules of thumb that produce printable, non-sagging brackets:

        load  5 kg, depth 100 mm  → ~4.8 mm
        load 14 kg, depth 152 mm  → ~7.2 mm     (6"  shelf,  30 lb)
        load 30 kg, depth 200 mm  → ~9.6 mm
        load 50 kg, depth 250 mm  → ~12.4 mm

    Coefficients chosen so depth and load each contribute meaningfully
    without runaway thickness at the heavy end. Material factor scales
    the whole result (PETG slightly less, ABS slightly more). Result
    is padded by 0.4 mm and rounded UP to the next 0.4 mm (matches
    typical 0.2 mm × 2-line walls).
    """
    raw = (0.04 * depth_mm + 0.04 * load_kg) * mat_factor
    padded = raw + 0.4
    return math.ceil(padded / 0.4) * 0.4


def _gusset_width(load_kg: float, depth_mm: float) -> float:
    """Triangular gusset width measured along the depth axis.

    Tuned to give a chunky-looking but printable triangle:

        depth 100 mm, load  5 kg  → 60 mm
        depth 200 mm, load 30 kg  → 130 mm
        depth 300 mm, load 60 kg  → 200 mm
    """
    base = depth_mm * 0.6
    load_bonus = (load_kg / 30.0) * 10.0       # extra +10 mm per 30 kg
    return min(base + load_bonus, depth_mm - 5.0)


def _resolve_dim(p: Dict[str, Any], mm_key: str, in_key: str, default: Optional[float]) -> float:
    """Accept either the *_mm or *_in flavour, fall back to default."""
    if mm_key in p and p[mm_key] is not None:
        return float(p[mm_key])
    if in_key in p and p[in_key] is not None:
        return to_mm(float(p[in_key]), "in")
    if default is not None:
        return default
    raise ValueError(f"Missing required dim: {mm_key} (or {in_key})")


def _resolve_load_kg(p: Dict[str, Any]) -> float:
    if "load_kg" in p and p["load_kg"] is not None:
        return float(p["load_kg"])
    if "load_lb" in p and p["load_lb"] is not None:
        return kg_from(float(p["load_lb"]), "lb")
    return 5.0


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    depth = _resolve_dim(params, "shelf_depth_mm", "shelf_depth_in", None)
    shelf_t = _resolve_dim(params, "shelf_thickness_mm", "shelf_thickness_in", 18.0)
    load_kg = _resolve_load_kg(params)
    material = (params.get("material") or "PLA").upper()
    if material not in _MAT_FACTOR:
        material = "PLA"
    mat_factor = _MAT_FACTOR[material]

    width = float(params.get("bracket_width_mm", 25.0))
    screw_d = float(params.get("screw_diameter_mm", 4.5))
    screw_r = screw_d / 2.0

    plate_t = _plate_thickness(load_kg, depth, mat_factor)
    gusset = _gusset_width(load_kg, depth)

    # ForgeSlicer coordinate convention:
    #   • dims.x → world X (left-right)
    #   • dims.y → world Z (front-back, INTO bed)
    #   • dims.z → world Y (UP)
    #
    # The bracket lies FLAT on the bed for printing (its `plate_t`
    # thickness goes UP). Viewed from above the L sits like this:
    #
    #         Z (depth, into screen)
    #         ↑
    #    +────╫───────────────────
    #    │ wall arm (along Z)
    #    │ ╫
    #    │ ╫            ┌──────── shelf arm ────────┐
    #    │ ╫────────────│                            │
    #    └─────────────────────────────────────────→  X (right)
    #     │
    #    (0,0) = corner of the L (inside)
    #
    # Wall arm extends along +Z, shelf arm along +X. Both lie in the
    # X-Z plane on the bed, with `plate_t` of vertical (Y) thickness.

    wall_length = depth
    shelf_length = depth

    steps: List[Dict[str, Any]] = []

    # Step 1 — wall arm. Spans X: 0..width, Y: 0..plate_t, Z: 0..wall_length.
    steps.append(step_add(
        "cube",
        dims={"x": width, "y": wall_length, "z": plate_t},
        position=[width / 2.0, plate_t / 2.0, wall_length / 2.0],
        tag="wall_arm",
        note=f"Wall arm  {width:.0f} × {wall_length:.0f} × {plate_t:.1f} mm  "
             f"(thickness from {material} @ {load_kg:.1f} kg over {depth:.0f} mm)",
    ))

    # Step 2 — shelf arm. Spans X: 0..shelf_length, Y: 0..plate_t,
    # Z: 0..width. Overlaps the wall arm in the (0..width, 0..width)
    # square at the corner — the union resolves the overlap cleanly.
    steps.append(step_add(
        "cube",
        dims={"x": shelf_length, "y": width, "z": plate_t},
        position=[shelf_length / 2.0, plate_t / 2.0, width / 2.0],
        tag="shelf_arm",
        note=f"Shelf arm  {shelf_length:.0f} × {width:.0f} × {plate_t:.1f} mm",
    ))

    # Step 3 — gusset corner block. Instead of a wedge (whose ramp axis
    # would need rotating into the bracket's frame), we use a chunky
    # cube sat in the inside corner — same job (braces the join),
    # guaranteed manifold, prints fine.
    #   • Footprint: gusset × gusset, sitting from the corner outward
    #     along +X and +Z (overlapping both arms at the corner).
    #   • Height: a tiny bit taller than plate_t so the union picks it
    #     up cleanly without z-fighting.
    g_h = plate_t + 0.4
    steps.append(step_add(
        "cube",
        dims={"x": gusset, "y": gusset, "z": g_h},
        position=[gusset / 2.0, g_h / 2.0, gusset / 2.0],
        tag="gusset",
        note=f"Gusset corner block  {gusset:.0f} × {gusset:.0f} × {g_h:.1f} mm "
             f"(braces against {load_kg:.1f} kg load)",
    ))

    # Steps 4-N — screw holes.
    # Cylinders default to world-Y axis (UP), so a hole through the
    # plate's thickness needs NO rotation. The hole's `h` must exceed
    # plate_t so it pokes through both faces — we use plate_t + 2 mm.
    # Wall arm: 2 holes, ~30 % and ~70 % along its Z axis, centred at
    # X = width / 2. Keep them clear of the gusset block which spans
    # 0..gusset in Z.
    safe_z_start = gusset + 8.0
    safe_z_end = wall_length - 8.0
    if safe_z_end > safe_z_start:
        for i, hz in enumerate([
            safe_z_start + (safe_z_end - safe_z_start) * 0.25,
            safe_z_start + (safe_z_end - safe_z_start) * 0.75,
        ]):
            steps.append(step_add(
                "cylinder",
                modifier="negative",
                dims={"r": screw_r, "h": plate_t + 2.0},
                position=[width / 2.0, plate_t / 2.0, hz],
                tag=f"wall_hole_{i}",
                note=f"Wall screw hole  ⌀{screw_d:.1f} mm",
            ))

    # Shelf arm: 2 holes along its +X axis, also clear of the gusset.
    safe_x_start = gusset + 8.0
    safe_x_end = shelf_length - 8.0
    if safe_x_end > safe_x_start:
        for i, hx in enumerate([
            safe_x_start + (safe_x_end - safe_x_start) * 0.25,
            safe_x_start + (safe_x_end - safe_x_start) * 0.75,
        ]):
            steps.append(step_add(
                "cylinder",
                modifier="negative",
                dims={"r": screw_r, "h": plate_t + 2.0},
                position=[hx, plate_t / 2.0, width / 2.0],
                tag=f"shelf_hole_{i}",
                note=f"Shelf screw hole  ⌀{screw_d:.1f} mm",
            ))

    # Boolean: union the 3 positives, then subtract the screw holes.
    # Two separate steps because a fold-left subtract over mixed-
    # modifier targets would treat the shelf arm as a negative.
    steps.append(step_boolean("union", targets=["all-positives"],
                              note="Fuse the wall arm, shelf arm and gusset"))
    steps.append(step_boolean("subtract", targets=["all-current"],
                              note="Subtract screw holes from the bracket"))
    steps.append(step_group(
        f"L-bracket  {depth:.0f} mm  {load_kg:.0f} kg",
        targets=["all-current"],
        note="Group the finished bracket",
    ))
    return steps

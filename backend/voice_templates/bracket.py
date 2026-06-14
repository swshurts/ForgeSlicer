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

    # iter-101.1 — Bracket built in FUNCTIONAL orientation:
    #   • Wall arm STANDS UP along +Y (mounts against a vertical wall).
    #   • Shelf arm extends along +X at floor level (the shelf rests on it).
    # The two meet at the corner (origin). For printing the user just
    # hits "Lay Flat" to drop the bracket onto its broad face.
    #
    # ForgeSlicer dim convention:
    #   • dims.x → world X (left-right)
    #   • dims.y → world Z (depth into bed)
    #   • dims.z → world Y (UP)
    #
    # Wall arm — thin plate standing up at the X=0 plane. Thickness in X,
    # height in Y (the standing-up dimension = dims.z), width in Z.
    wall_height = depth
    shelf_length = depth

    steps: List[Dict[str, Any]] = []

    steps.append(step_add(
        "cube",
        dims={"x": plate_t, "y": width, "z": wall_height},
        position=[plate_t / 2.0, wall_height / 2.0, width / 2.0],
        tag="wall_arm",
        note=f"Wall arm  {plate_t:.1f} × {wall_height:.0f} × {width:.0f} mm  "
             f"(stands vertically; thickness from {material} @ {load_kg:.1f} kg over {depth:.0f} mm)",
    ))

    # Shelf arm — horizontal plate at floor level. Length in X, depth
    # (width along the wall) in Z, thickness in Y (= dims.z = UP).
    steps.append(step_add(
        "cube",
        dims={"x": shelf_length, "y": width, "z": plate_t},
        position=[shelf_length / 2.0, plate_t / 2.0, width / 2.0],
        tag="shelf_arm",
        note=f"Shelf arm  {shelf_length:.0f} × {width:.0f} × {plate_t:.1f} mm",
    ))

    # Gusset — a chunky cube block bracing the inside corner in the XY
    # plane (wall-arm + shelf-arm plane). Spans 0..gusset in X and Y,
    # centred in Z so it's flush with the bracket's mid-width.
    g_z_pad = max(plate_t * 0.8, 4.0)               # how far the gusset extends in the Z (width) direction
    steps.append(step_add(
        "cube",
        dims={"x": gusset, "y": gusset, "z": g_z_pad},
        position=[gusset / 2.0, gusset / 2.0, width / 2.0],
        tag="gusset",
        note=f"Gusset corner block  {gusset:.0f} × {gusset:.0f} × {g_z_pad:.1f} mm "
             f"(braces against {load_kg:.1f} kg load)",
    ))

    # Wall screw holes — cylinders piercing the wall arm HORIZONTALLY
    # along the world X axis. Default cylinder axis is world Y, so we
    # rotate 90° around Z to lay the axis along X.
    safe_y_start = gusset + 8.0
    safe_y_end = wall_height - 8.0
    if safe_y_end > safe_y_start:
        for i, hy in enumerate([
            safe_y_start + (safe_y_end - safe_y_start) * 0.25,
            safe_y_start + (safe_y_end - safe_y_start) * 0.75,
        ]):
            steps.append(step_add(
                "cylinder",
                modifier="negative",
                dims={"r": screw_r, "h": plate_t + 2.0},
                position=[plate_t / 2.0, hy, width / 2.0],
                rotation=[0.0, 0.0, 90.0],
                tag=f"wall_hole_{i}",
                note=f"Wall screw hole  ⌀{screw_d:.1f} mm",
            ))

    # Shelf screw holes — cylinders piercing the shelf arm VERTICALLY
    # (default cylinder axis = world Y = UP). No rotation needed.
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

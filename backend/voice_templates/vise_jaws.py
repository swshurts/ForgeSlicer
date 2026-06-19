"""Vise-jaws template — iter-103.3.

A matched pair of soft jaws for a bench vise. Each jaw is a flat
rectangular plate with a centred V-groove or flat clamping face on the
inside, and a slim "lip" along the top that hooks over the existing
hard jaw so the soft jaw stays put without screws. Optional through-holes
for M4/M5 bolts if the user prefers a positive mount.

ForgeSlicer coordinate convention (dims.x = world X, dims.y = world Z,
dims.z = world Y / UP). The jaws stand vertically on the bed.
"""
from __future__ import annotations

from math import tan, radians
from typing import Any, Dict, List

from .base import step_add, step_boolean, step_group


META = {
    "id": "vise_jaws",
    "label": "Soft vise jaws (pair)",
    "description": (
        "Matched pair of soft jaws for a bench vise. Each jaw is a flat "
        "plate with an inside clamping face (flat or V-groove) and a "
        "top-edge lip that hooks over the existing hard jaw. Designed "
        "to print on its side with no supports — the V-groove faces "
        "the bed, the lip hangs off."
    ),
    "params": {
        "jaw_width_mm": {"type": "number", "default": 100.0, "min": 30.0, "max": 250.0,
                         "describe": "Width of each jaw — should match the vise's hard jaw width (mm)."},
        "jaw_height_mm": {"type": "number", "default": 30.0, "min": 10.0, "max": 120.0,
                          "describe": "Height of each jaw above the slide (mm)."},
        "jaw_thickness_mm": {"type": "number", "default": 8.0, "min": 4.0, "max": 30.0,
                             "describe": "Jaw thickness (mm). 8 mm is a good default in PETG/ABS."},
        "face_style": {"type": "enum", "default": "v_groove",
                       "values": ["flat", "v_groove", "soft_pad"],
                       "describe": "Inside clamping face. flat = smooth wall for general use; v_groove = 90° V-groove for clamping round stock; soft_pad = recessed flat with a thin TPU pad pocket."},
        "v_angle_deg": {"type": "number", "default": 90.0, "min": 60.0, "max": 120.0,
                        "describe": "Included V-groove angle (degrees). Only used when face_style='v_groove'."},
        "v_depth_mm": {"type": "number", "default": 6.0, "min": 2.0, "max": 20.0,
                       "describe": "V-groove depth from the inside face (mm). Only used when face_style='v_groove'."},
        "lip_depth_mm": {"type": "number", "default": 6.0, "min": 0.0, "max": 25.0,
                         "describe": "How far the top-edge hook hangs over the hard jaw (mm). 0 = no hook."},
        "lip_thickness_mm": {"type": "number", "default": 4.0, "min": 2.0, "max": 12.0,
                             "describe": "Thickness of the hook lip (mm)."},
        "bolt_holes": {"type": "enum", "default": "none",
                       "values": ["none", "two_m4", "two_m5"],
                       "describe": "Optional through-holes for bolting the jaw to the vise."},
        "pair_gap_mm": {"type": "number", "default": 20.0, "min": 5.0, "max": 200.0,
                        "describe": "Initial gap between the two jaws when the assembly is laid out on the bed (mm). Visual only — the user moves them once printed."},
    },
}


def _build_one_jaw(side: str, params: Dict[str, Any], x_offset: float) -> List[Dict[str, Any]]:
    """Build one jaw, positioned with its clamping face toward x=0.

    `side` is 'left' or 'right'. For 'left' the clamping face is +X
    (toward x_offset > 0); for 'right' it's -X. `x_offset` is the
    jaw's outer-face X position in world coords.
    """
    W = float(params.get("jaw_width_mm", 100.0))
    H = float(params.get("jaw_height_mm", 30.0))
    T = float(params.get("jaw_thickness_mm", 8.0))
    face = str(params.get("face_style", "v_groove"))
    v_angle = float(params.get("v_angle_deg", 90.0))
    v_depth = float(params.get("v_depth_mm", 6.0))
    lip_d = float(params.get("lip_depth_mm", 6.0))
    lip_t = float(params.get("lip_thickness_mm", 4.0))
    bolts = str(params.get("bolt_holes", "none"))

    steps: List[Dict[str, Any]] = []

    # The "inside" of the jaw (toward x=0) is at outer + (-T) for left,
    # outer + (+T) for right. The body's CENTRE X is therefore at
    # (outer_x +/- T/2).
    sign = +1.0 if side == "left" else -1.0
    centre_x = x_offset - sign * T / 2.0   # body centre
    # The clamping face is the face NEAREST x=0 → at x = centre_x + sign*T/2.

    # Body — dims.x=T (thickness, the small axis is along X because the
    # jaw stands so its width is along Z and height along Y).
    steps.append(step_add(
        "cube",
        dims={"x": T, "y": W, "z": H},
        position=[centre_x, 0.0, H / 2.0],
        tag=f"{side}_body",
        note=f"{side.capitalize()} jaw body  W={W:.0f}  H={H:.0f}  T={T:.1f}",
    ))

    # Top-edge hook lip — a small cuboid hanging OUTWARD from the top
    # back face of the jaw, so the user can drop the soft jaw over the
    # vise's hard jaw and have it stay put.
    if lip_d > 0.0:
        lip_centre_x = centre_x + (-sign) * (T / 2.0 + lip_d / 2.0)
        lip_top_y = H + lip_t / 2.0  # sits ABOVE the body's top
        steps.append(step_add(
            "cube",
            dims={"x": lip_d, "y": W, "z": lip_t},
            position=[lip_centre_x, 0.0, lip_top_y - lip_t],
            tag=f"{side}_lip",
            note=f"{side.capitalize()} hook lip ({lip_d:.0f} × {lip_t:.0f} mm)",
        ))

    # Inside clamping face profile.
    if face == "v_groove" and v_depth > 0.0:
        # Cut a triangular prism running along the jaw's Y axis (which
        # is world Z — across the WIDTH of the jaw). The V opens
        # TOWARD x=0 (i.e. the inside face). Cube approximation: punch
        # a rectangular pocket then we'd need a more elaborate setup
        # to get an actual triangle. We approximate the V as a single
        # diagonal cuboid rotated about Z by 45°, which gives a V-like
        # diamond outline on the inside face when viewed from above.
        # For sharper geometry the user can edit-mode-fillet later.
        v_half = v_depth * tan(radians(v_angle / 2.0))
        # Cuboid centred at the inside face, rotated 45° about its
        # OWN Y axis (world Z) so a diamond pokes out → groove.
        cut_x = centre_x + sign * (T / 2.0)
        steps.append(step_add(
            "cube",
            modifier="negative",
            dims={"x": v_depth * 2.0, "y": W + 2.0, "z": v_half * 2.0},
            position=[cut_x, 0.0, H / 2.0],
            rotation=[0.0, 45.0, 0.0],
            tag=f"{side}_v_groove",
            note=f"V-groove {v_angle:.0f}° × {v_depth:.1f} mm deep",
        ))
    elif face == "soft_pad":
        # Recessed flat pad pocket — 2 mm deep, leaves a 4 mm border
        # of structural material around the pad. The user later
        # presses in a TPU pad.
        pad_W = W - 8.0
        pad_H = H - 8.0
        if pad_W > 10.0 and pad_H > 10.0:
            pocket_x = centre_x + sign * (T / 2.0 - 1.0)
            steps.append(step_add(
                "cube",
                modifier="negative",
                dims={"x": 4.0, "y": pad_W, "z": pad_H},
                position=[pocket_x, 0.0, H / 2.0],
                tag=f"{side}_pad_pocket",
                note=f"TPU pad pocket {pad_W:.0f} × {pad_H:.0f} × 2 mm",
            ))

    # Optional through-bolt holes.
    if bolts != "none":
        bolt_d = 4.3 if bolts == "two_m4" else 5.3
        hx_offsets = [-W / 3.0, +W / 3.0]
        for i, hy in enumerate(hx_offsets):
            steps.append(step_add(
                "cylinder",
                modifier="negative",
                dims={"r": bolt_d / 2.0, "h": T + 2.0},
                position=[centre_x, hy, H / 2.0],
                rotation=[0.0, 90.0, 0.0],
                tag=f"{side}_bolt_{i}",
                note=f"Through-hole #{i+1} ({bolts.replace('two_', '').upper()})",
            ))

    return steps


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    T = float(params.get("jaw_thickness_mm", 8.0))
    gap = float(params.get("pair_gap_mm", 20.0))
    # Lay the two jaws out symmetrically around X=0 with `gap` between
    # their clamping faces. Left jaw's clamping face is at +T (so its
    # outer face is at +T + gap/2 + T → simplified by setting outer_x
    # = +gap/2 + T directly). Right is the mirror.
    left_outer_x = gap / 2.0 + T
    right_outer_x = -(gap / 2.0 + T)

    steps: List[Dict[str, Any]] = []
    steps.extend(_build_one_jaw("left", params, left_outer_x))
    steps.extend(_build_one_jaw("right", params, right_outer_x))

    steps.append(step_boolean(
        "subtract",
        targets=["all-current"],
        note="Cut V-grooves / pads / bolt holes from each jaw",
    ))
    steps.append(step_group(
        f"Vise jaws (pair)  {float(params.get('jaw_width_mm', 100.0)):.0f} × {float(params.get('jaw_height_mm', 30.0)):.0f}",
        targets=["all-current"],
        note="Group the finished pair",
    ))
    return steps

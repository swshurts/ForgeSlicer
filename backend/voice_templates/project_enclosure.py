"""Project-enclosure template — iter-103.3.

A 5-sided open-top box (bottom + 4 walls) with configurable internal
volume, wall thickness, screw-post corners, optional ventilation slots
on the long walls, and a recessed PCB / board floor.

The body is built as ONE outer cube minus an inner cavity cube, then
the optional vents are punched through the walls and screw posts get
added back in the four corners. The lid is OUT OF SCOPE — most users
print a separate matching lid and snap it on.

ForgeSlicer coordinate convention (dims.x = world X, dims.y = world Z,
dims.z = world Y / UP).
"""
from __future__ import annotations

from typing import Any, Dict, List

from .base import step_add, step_boolean, step_group


META = {
    "id": "project_enclosure",
    "label": "Project enclosure (open-top box)",
    "description": (
        "5-sided box (bottom + 4 walls) sized to a user-defined "
        "interior volume, with optional vent slots on the long "
        "walls and screw posts in the four corners. Print the lid "
        "separately."
    ),
    "params": {
        "interior_x_mm": {"type": "number", "default": 120.0, "min": 30.0, "max": 600.0,
                          "describe": "Interior length (along world X) — pick the LONG side of the board / contents (mm)."},
        "interior_y_mm": {"type": "number", "default": 80.0, "min": 30.0, "max": 600.0,
                          "describe": "Interior depth (along world Z, the bed's front-back axis) (mm)."},
        "interior_z_mm": {"type": "number", "default": 40.0, "min": 15.0, "max": 300.0,
                          "describe": "Interior height (along world Y, UP). Includes any space above the tallest component (mm)."},
        "wall_mm": {"type": "number", "default": 2.5, "min": 1.0, "max": 8.0,
                    "describe": "Wall thickness (mm). 2.5 mm is a good default in PETG; bump to 3 mm for PLA or for rough handling."},
        "floor_mm": {"type": "number", "default": 3.0, "min": 1.5, "max": 8.0,
                     "describe": "Floor thickness (mm). Slightly thicker than the walls so screw posts have meat to bite into."},
        "corner_post_diameter_mm": {"type": "number", "default": 8.0, "min": 4.0, "max": 18.0,
                                    "describe": "Outer diameter of the four corner screw posts (mm). 0 = no posts. Each post gets a pilot hole for an M3 self-tapper."},
        "vent_slots": {"type": "enum", "default": "long_walls",
                       "values": ["none", "long_walls", "all_walls"],
                       "describe": "Where to punch ventilation slots. Slots are 5 mm wide × 30 mm tall, spaced 10 mm apart, centred vertically on the wall."},
        "fillet_outer_mm": {"type": "number", "default": 0.0, "min": 0.0, "max": 8.0,
                            "describe": "Optional outer corner radius (mm). Implemented as a per-edge fillet on the 4 vertical outer edges — kept 0 by default so the LLM doesn't pick a stylised default no one asked for."},
    },
}


def _add_vent_slots(steps, wall_axis, length_along_x, plate_T,
                    interior_x, interior_y, interior_z, wall, floor):
    """Punch a row of rectangular vent slots through ONE wall.

    `wall_axis` selects the wall:
        '+y' / '-y'  → long wall (face along world Z axis)
        '+x' / '-x'  → short wall (face along world X axis)

    Slots are 5 mm wide along the wall axis, 30 mm tall (or 60% of
    interior_z, whichever is smaller), centred vertically, spaced
    10 mm apart starting from the centre of the wall.
    """
    slot_w = 5.0
    slot_pitch = slot_w + 10.0
    slot_h = min(30.0, interior_z * 0.6)
    # How many slots fit, centred on the wall.
    usable = length_along_x - 20.0
    if usable <= slot_pitch:
        return
    n_slots = max(1, int(usable // slot_pitch))
    # Centre slot at x=0 (or z=0), step outward.
    total_span = (n_slots - 1) * slot_pitch
    start = -total_span / 2.0

    # World-space wall centre Y is floor + interior_z/2.
    cy = floor + interior_z / 2.0
    # Half-extent along the wall's normal — the slot must pierce
    # through the wall + 2 mm so the subtract is clean.
    pierce_depth = wall + 4.0

    for k in range(n_slots):
        along = start + k * slot_pitch
        if wall_axis in ("+y", "-y"):
            # Long wall: slot's WIDTH is along world X, pierce is along world Z.
            cz = (interior_y / 2.0 + wall / 2.0) * (1.0 if wall_axis == "+y" else -1.0)
            steps.append(step_add(
                "cube",
                modifier="negative",
                dims={"x": slot_w, "y": pierce_depth, "z": slot_h},
                position=[along, cz, cy],
                tag=f"vent_{wall_axis}_{k}",
                note=f"Vent slot {k+1} on {wall_axis} wall",
            ))
        else:
            # Short wall: slot's width is along world Z, pierce along world X.
            cx = (interior_x / 2.0 + wall / 2.0) * (1.0 if wall_axis == "+x" else -1.0)
            steps.append(step_add(
                "cube",
                modifier="negative",
                dims={"x": pierce_depth, "y": slot_w, "z": slot_h},
                position=[cx, along, cy],
                tag=f"vent_{wall_axis}_{k}",
                note=f"Vent slot {k+1} on {wall_axis} wall",
            ))


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    ix = float(params.get("interior_x_mm", 120.0))
    iy = float(params.get("interior_y_mm", 80.0))
    iz = float(params.get("interior_z_mm", 40.0))
    wall = float(params.get("wall_mm", 2.5))
    floor = float(params.get("floor_mm", 3.0))
    post_d = float(params.get("corner_post_diameter_mm", 8.0) or 0.0)
    vents = str(params.get("vent_slots", "long_walls") or "long_walls")
    fillet = float(params.get("fillet_outer_mm", 0.0) or 0.0)

    # Outer shell dims.
    ox = ix + 2 * wall
    oy = iy + 2 * wall
    oz = iz + floor  # only floor on bottom — open top

    steps: List[Dict[str, Any]] = []

    # Outer shell.
    plate_dims = {"x": ox, "y": oy, "z": oz}
    if fillet > 0.05:
        plate_dims["edgeRadius"] = fillet
        plate_dims["edgeStyle"] = "fillet"
    steps.append(step_add(
        "cube",
        dims=plate_dims,
        position=[0.0, 0.0, oz / 2.0],
        tag="shell",
        note=f"Outer shell  {ox:.0f} × {oy:.0f} × {oz:.0f} mm",
    ))

    # Interior void — sits ABOVE the floor and INSIDE the walls.
    steps.append(step_add(
        "cube",
        modifier="negative",
        dims={"x": ix, "y": iy, "z": iz + 0.5},   # +0.5 to break the open top cleanly
        position=[0.0, 0.0, floor + iz / 2.0 + 0.25],
        tag="cavity",
        note=f"Interior cavity  {ix:.0f} × {iy:.0f} × {iz:.0f} mm",
    ))

    # Vent slots.
    if vents != "none":
        _add_vent_slots(steps, "+y", ox, wall, ix, iy, iz, wall, floor)
        _add_vent_slots(steps, "-y", ox, wall, ix, iy, iz, wall, floor)
        if vents == "all_walls":
            _add_vent_slots(steps, "+x", oy, wall, ix, iy, iz, wall, floor)
            _add_vent_slots(steps, "-x", oy, wall, ix, iy, iz, wall, floor)

    # Corner screw posts — added AS POSITIVES (cylinders) AFTER the
    # main subtract so the cavity doesn't carve through them. We then
    # punch the pilot holes through the posts.
    if post_d > 0.0:
        # First main boolean: shell minus cavity minus vents.
        steps.append(step_boolean(
            "subtract",
            targets=["all-current"],
            note="Subtract cavity + vents from the shell",
        ))
        post_r = post_d / 2.0
        pilot_r = 1.25  # M3 self-tapper pilot
        inside_offset = post_r + wall * 0.5  # post sits TANGENT to the inner wall
        corners = [
            (-ix / 2.0 + inside_offset, -iy / 2.0 + inside_offset),
            (+ix / 2.0 - inside_offset, -iy / 2.0 + inside_offset),
            (-ix / 2.0 + inside_offset, +iy / 2.0 - inside_offset),
            (+ix / 2.0 - inside_offset, +iy / 2.0 - inside_offset),
        ]
        for i, (cx, cz) in enumerate(corners):
            post_h = iz
            steps.append(step_add(
                "cylinder",
                dims={"r": post_r, "h": post_h},
                position=[cx, cz, floor + post_h / 2.0],
                tag=f"post_{i}",
                note=f"Corner screw post #{i+1}  ⌀{post_d:.1f} × {post_h:.0f} mm",
            ))
            steps.append(step_add(
                "cylinder",
                modifier="negative",
                dims={"r": pilot_r, "h": post_h + 2.0},
                position=[cx, cz, floor + post_h / 2.0],
                tag=f"pilot_{i}",
                note="M3 pilot hole",
            ))
        steps.append(step_boolean(
            "union",
            targets=["all-current"],
            note="Fuse posts into the shell, then drill pilots",
        ))
    else:
        steps.append(step_boolean(
            "subtract",
            targets=["all-current"],
            note="Subtract cavity + vents from the shell",
        ))

    steps.append(step_group(
        f"Enclosure  {ix:.0f} × {iy:.0f} × {iz:.0f} mm",
        targets=["all-current"],
        note="Group the finished enclosure",
    ))
    return steps

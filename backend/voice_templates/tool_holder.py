"""Wall-mount tool holder template.

A flat-printed rack with N evenly-spaced holes sized for a given tool
diameter. Mounting strap at the top with 2 (or 3) screw holes for
attaching to a wall, pegboard, or 3D-printer enclosure side.

Voice trigger examples:
  • "Make a tool holder for 6 screwdrivers, 8 mm shafts"
  • "Wall rack for five 1 inch round files"

ForgeSlicer coordinate convention as elsewhere (z = UP).
"""
from __future__ import annotations

from typing import Any, Dict, List

from .base import step_add, step_boolean, step_group, to_mm


META = {
    "id": "tool_holder",
    "label": "Wall-mount tool holder",
    "description": (
        "Flat-printed rack with N evenly-spaced holes for tools (or pens, "
        "screwdrivers, files, drill bits). Top strap with screw holes "
        "mounts to a wall, pegboard, or enclosure side."
    ),
    "params": {
        "count": {"type": "number", "default": 6, "min": 1, "max": 40,
                  "describe": "Number of tool holes."},
        "tool_diameter_mm": {"type": "number", "default": 8.0,
                             "describe": "Tool-shaft diameter; the hole is sized at +1 mm clearance (mm)."},
        "tool_diameter_in": {"type": "number", "required": False,
                             "describe": "Tool shaft diameter in inches (auto-converted)."},
        "hole_spacing_mm": {"type": "number", "default": 22.0,
                            "describe": "Centre-to-centre spacing between tool holes (mm)."},
        "depth_mm": {"type": "number", "default": 40.0,
                     "describe": "Rack depth (how far the holes are inset from the strap) (mm)."},
        "thickness_mm": {"type": "number", "default": 5.0,
                         "describe": "Plate thickness (mm)."},
        "screw_diameter_mm": {"type": "number", "default": 4.5,
                              "describe": "Wall-mounting screw clearance diameter (mm)."},
    },
}


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    n = int(params.get("count", 6))
    if n < 1: n = 1
    if params.get("tool_diameter_in") is not None:
        tool_d = to_mm(float(params["tool_diameter_in"]), "in")
    else:
        tool_d = float(params.get("tool_diameter_mm", 8.0))
    spacing = float(params.get("hole_spacing_mm", 22.0))
    depth = float(params.get("depth_mm", 40.0))
    thickness = float(params.get("thickness_mm", 5.0))
    screw_d = float(params.get("screw_diameter_mm", 4.5))

    # Strap depth (top mounting band) is the smaller of 22 mm or
    # 35 % of total depth. Tool holes are centred in the LOWER region.
    strap_depth = min(22.0, depth * 0.35)
    hole_r = (tool_d + 1.0) / 2.0       # +1 mm clearance

    # Plate width = N * spacing + edge margin on each side. Edges margin
    # = max(8 mm, tool radius + 4 mm) so holes don't crash the edge.
    edge = max(8.0, hole_r + 4.0)
    plate_w = (n - 1) * spacing + 2 * edge if n > 1 else 2 * edge

    # Plate lies flat on the bed. dims.x = width, dims.y = depth (front-
    # back), dims.z = thickness (UP).
    steps: List[Dict[str, Any]] = []
    steps.append(step_add(
        "cube",
        dims={"x": plate_w, "y": depth, "z": thickness},
        position=[0.0, thickness / 2.0, 0.0],
        tag="plate",
        note=f"Rack plate {plate_w:.0f} × {depth:.0f} × {thickness:.1f} mm "
             f"(N={n} holes ⌀{hole_r*2:.1f} mm)",
    ))

    # Tool holes — cylinders piercing the plate vertically (default axis
    # = world Y). Centred in the LOWER region (away from the strap which
    # sits at -Z relative to the plate's Z-centre... we put strap at
    # back, holes at front for clarity).
    holes_z = depth / 2.0 - (depth - strap_depth) / 2.0     # forward of plate centre
    for i in range(n):
        x = -(n - 1) * spacing / 2.0 + i * spacing
        steps.append(step_add(
            "cylinder",
            modifier="negative",
            dims={"r": hole_r, "h": thickness + 2.0},
            position=[x, thickness / 2.0, holes_z],
            tag=f"hole_{i}",
            note=f"Tool hole #{i+1} (⌀{hole_r*2:.1f} mm)",
        ))

    # Strap screw holes — 2 holes at the back-strap, evenly spaced
    # along the plate width.
    strap_z = -depth / 2.0 + strap_depth / 2.0              # back band of the plate
    screw_positions_x = [-plate_w / 2.0 + edge, plate_w / 2.0 - edge] if n > 1 \
        else [0.0]
    for i, sx in enumerate(screw_positions_x):
        steps.append(step_add(
            "cylinder",
            modifier="negative",
            dims={"r": screw_d / 2.0, "h": thickness + 2.0},
            position=[sx, thickness / 2.0, strap_z],
            tag=f"mount_{i}",
            note=f"Wall mount screw hole ⌀{screw_d:.1f} mm",
        ))

    steps.append(step_boolean("subtract", targets=["all-current"],
                              note="Subtract tool holes & mount holes"))
    steps.append(step_group(
        f"Tool holder × {n} (⌀{tool_d:.1f} mm)",
        targets=["all-current"],
        note="Group the finished tool holder",
    ))
    return steps

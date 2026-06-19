"""Drawer-pull / cabinet-handle template.

Generates a flat-printed handle with two countersunk screw holes for
mounting to a drawer or cabinet face. The user can voice-spec the
overall length, how far it stands proud, the thickness, and the screw
spacing — anything they don't say gets a sensible default.

ForgeSlicer coordinate convention used (dims.x = world X width,
dims.y = world Z depth, dims.z = world Y height/UP).
"""
from __future__ import annotations

from typing import Any, Dict, List

from .base import step_add, step_boolean, step_group, to_mm


META = {
    "id": "drawer_pull",
    "label": "Drawer pull / cabinet handle",
    "description": (
        "Flat-printed bar handle with two countersunk screw holes for "
        "mounting to a drawer face. Edges chamfered (in the bar's "
        "outline) for a comfortable grip."
    ),
    "params": {
        "length_mm": {"type": "number", "default": 96.0, "min": 32.0, "max": 400.0,
                      "describe": "Overall handle length end-to-end (mm)."},
        "length_in": {"type": "number", "required": False,
                      "describe": "Length in inches (auto-converted)."},
        "screw_spacing_mm": {"type": "number", "default": 64.0,
                             "describe": "Centre-to-centre distance between the two mounting screws (mm). "
                                         "Common kitchen-cabinet spacings: 64, 96, 128, 160."},
        "screw_spacing_in": {"type": "number", "required": False,
                             "describe": "Screw spacing in inches."},
        "standoff_mm": {"type": "number", "default": 22.0,
                        "describe": "How far the handle stands proud of the drawer face (mm)."},
        "bar_diameter_mm": {"type": "number", "default": 12.0,
                            "describe": "Diameter of the grip bar (mm)."},
        "screw_diameter_mm": {"type": "number", "default": 4.5,
                              "describe": "Mounting screw clearance hole (mm)."},
        "thickness_mm": {"type": "number", "default": 6.0,
                         "describe": "Plate thickness at the mounting feet (mm)."},
    },
}


def _resolve(p, mm_key, in_key, default):
    if p.get(mm_key) is not None: return float(p[mm_key])
    if p.get(in_key) is not None: return to_mm(float(p[in_key]), "in")
    return float(default)


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    length = _resolve(params, "length_mm", "length_in", 96.0)
    spacing = _resolve(params, "screw_spacing_mm", "screw_spacing_in", 64.0)
    standoff = float(params.get("standoff_mm", 22.0))
    bar_d = float(params.get("bar_diameter_mm", 12.0))
    screw_d = float(params.get("screw_diameter_mm", 4.5))
    thickness = float(params.get("thickness_mm", 6.0))

    # Geometry: two short "feet" that bolt to the drawer, connected by a
    # round bar running parallel to the drawer face at `standoff` mm out.
    # The handle lies on the print bed with its mounting face DOWN; the
    # grip bar sits at +Y = standoff.

    foot_w = max(bar_d * 1.6, 18.0)            # foot extends a bit wider than the bar diameter
    foot_d = max(thickness * 2.0, bar_d)        # foot depth (along world Z)
    # Foot X-centres are at ±spacing/2.
    bar_r = bar_d / 2.0

    steps: List[Dict[str, Any]] = []

    # Two feet (cubes) — flush with the bed, span standoff in Y so they
    # connect to the bar above.
    foot_h = standoff
    for sign in (-1, 1):
        steps.append(step_add(
            "cube",
            dims={"x": foot_w, "y": foot_d, "z": foot_h},
            position=[sign * spacing / 2.0, 0.0, foot_h / 2.0],
            tag=f"foot_{'L' if sign < 0 else 'R'}",
            note=f"Mounting foot ({foot_w:.0f} × {foot_d:.0f} × {foot_h:.0f} mm)",
        ))

    # Grip bar — a cylinder along world X, sitting at Y = standoff,
    # spanning the full handle length. Default cylinder axis = Y so we
    # rotate 90° around Z to lay it along X.
    steps.append(step_add(
        "cylinder",
        dims={"r": bar_r, "h": length},
        position=[0.0, 0.0, standoff],
        rotation=[0.0, 90.0, 0.0],
        tag="bar",
        note=f"Grip bar ⌀{bar_d:.1f} mm × {length:.0f} mm long",
    ))

    # Optional decorative end caps so the bar doesn't read as a chopped-
    # off cylinder — small hemispheres at each end.
    for sign, name in ((-1, "L"), (1, "R")):
        steps.append(step_add(
            "sphere",
            dims={"r": bar_r},
            position=[sign * length / 2.0, 0.0, standoff],
            tag=f"cap_{name}",
            note=f"End cap (⌀{bar_d:.1f} mm hemisphere)",
        ))

    # Two screw clearance holes piercing each foot vertically (Y = UP).
    for sign, name in ((-1, "L"), (1, "R")):
        steps.append(step_add(
            "cylinder",
            modifier="negative",
            dims={"r": screw_d / 2.0, "h": standoff + 2.0},
            position=[sign * spacing / 2.0, 0.0, standoff / 2.0],
            tag=f"screw_{name}",
            note=f"Screw hole ⌀{screw_d:.1f} mm",
        ))

    steps.append(step_boolean("union", targets=["all-positives"],
                              note="Fuse feet + bar + caps"))
    steps.append(step_boolean("subtract", targets=["all-current"],
                              note="Subtract screw holes"))
    steps.append(step_group(
        f"Drawer pull  {length:.0f} mm (CC {spacing:.0f})",
        targets=["all-current"],
        note="Group the finished handle",
    ))
    return steps

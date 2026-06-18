"""Spool-spacer template — iter-103.

A short tube that snaps onto a filament spool's 50/52/55 mm hub and
adapts it to a smaller/larger spool holder shaft. Useful when a printer
ships with a slim hub and the user buys a refill spool with a different
core diameter, or vice versa.

Implemented as a cylindrical shell with optional small inner ribs
(printed as raised bumps along the inner wall) that grip the shaft.

ForgeSlicer coordinate convention used (dims.x = world X width,
dims.y = world Z depth, dims.z = world Y height/UP, cylinder default
axis = world Y).
"""
from __future__ import annotations

from math import cos, sin, pi
from typing import Any, Dict, List

from .base import step_add, step_boolean, step_group


META = {
    "id": "spool_spacer",
    "label": "Filament-spool spacer / hub adapter",
    "description": (
        "Short cylindrical shell that adapts a filament spool's hub "
        "diameter (50/52/55 mm typical) to a printer's spool-holder "
        "shaft. Optionally adds small inner ribs that grip the shaft "
        "without slop."
    ),
    "params": {
        "outer_diameter_mm": {"type": "number", "default": 52.0, "min": 20.0, "max": 120.0,
                              "describe": "Outside diameter — must match the spool's centre hole (mm). Most refill spools: 50, 52, or 55 mm."},
        "inner_diameter_mm": {"type": "number", "default": 22.0, "min": 6.0, "max": 80.0,
                              "describe": "Inside diameter — should be 0.4-0.8 mm larger than the printer's spool-holder shaft."},
        "length_mm": {"type": "number", "default": 60.0, "min": 10.0, "max": 200.0,
                      "describe": "Spacer length / spool-hub depth (mm). 60 mm matches a typical 1 kg spool."},
        "wall_mm": {"type": "number", "default": 1.8, "min": 0.8, "max": 8.0,
                    "describe": "If outer-inner gives a wall thinner than this, the inner diameter is reduced. Useful for thin walls (e.g. 0.8 mm vase mode)."},
        "rib_count": {"type": "number", "default": 0, "min": 0, "max": 12,
                      "describe": "Number of small grip ribs running along the inside of the bore (0 = smooth bore)."},
        "rib_height_mm": {"type": "number", "default": 0.6, "min": 0.2, "max": 3.0,
                          "describe": "How far each rib protrudes into the bore (mm)."},
        "rib_width_mm": {"type": "number", "default": 2.0, "min": 0.6, "max": 8.0,
                         "describe": "Rib width along the cylinder axis (mm)."},
        "end_flange_mm": {"type": "number", "default": 0.0, "min": 0.0, "max": 12.0,
                          "describe": "Optional flange at one end that prevents the spacer from sliding off the spool hub. 0 = no flange."},
        "flange_diameter_mm": {"type": "number", "default": 0.0, "min": 0.0, "max": 150.0,
                               "describe": "Outer diameter of the flange (mm). 0 = auto (outer + 6 mm)."},
    },
}


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    od = float(params.get("outer_diameter_mm", 52.0))
    id_ = float(params.get("inner_diameter_mm", 22.0))
    length = float(params.get("length_mm", 60.0))
    min_wall = float(params.get("wall_mm", 1.8))
    rib_n = max(0, int(params.get("rib_count", 0) or 0))
    rib_h = float(params.get("rib_height_mm", 0.6))
    rib_w = float(params.get("rib_width_mm", 2.0))
    flange_t = float(params.get("end_flange_mm", 0.0) or 0.0)
    flange_od_in = float(params.get("flange_diameter_mm", 0.0) or 0.0)

    # Enforce minimum wall.
    if (od - id_) / 2.0 < min_wall:
        id_ = max(2.0, od - 2.0 * min_wall)

    or_, ir = od / 2.0, id_ / 2.0
    half_len = length / 2.0

    steps: List[Dict[str, Any]] = []

    # Outer tube — cylinder along world Y.
    steps.append(step_add(
        "cylinder",
        dims={"r": or_, "h": length},
        position=[0.0, half_len, 0.0],
        tag="shell_outer",
        note=f"Outer shell ⌀{od:.1f} × {length:.0f} mm",
    ))

    # Bore — slightly longer than the shell so the subtract caps both ends.
    steps.append(step_add(
        "cylinder",
        modifier="negative",
        dims={"r": ir, "h": length + 2.0},
        position=[0.0, half_len, 0.0],
        tag="bore",
        note=f"Bore ⌀{id_:.1f} mm",
    ))

    # Grip ribs — small inward bumps spaced evenly around the bore.
    # Each rib is a small cube positioned tangent to the inner wall,
    # rib_h mm inside, rib_w mm wide along the cylinder axis (Y), and
    # 1.2 × rib_h mm tangential thickness so the print head doesn't
    # try to extrude a degenerate sliver.
    if rib_n > 0 and rib_h > 0.0:
        rib_tangential = rib_h * 1.4
        for k in range(rib_n):
            theta = (2.0 * pi * k) / rib_n
            # Rib centred radially at (ir - rib_h/2) — i.e. the rib's
            # OUTER face sits flush with the bore wall and its inner
            # face protrudes rib_h mm into the bore.
            r_centre = ir - rib_h / 2.0
            cx = r_centre * cos(theta)
            cz = r_centre * sin(theta)
            steps.append(step_add(
                "cube",
                dims={"x": rib_h * 1.05, "y": rib_w, "z": rib_tangential},
                position=[cx, half_len, cz],
                rotation=[0.0, theta * 180.0 / pi, 0.0],
                tag=f"rib_{k}",
                note=f"Grip rib {k + 1}/{rib_n}",
            ))

    # End flange — wider disc at the y=0 (bed) end.
    if flange_t > 0.0:
        f_od = flange_od_in if flange_od_in > 0.0 else (od + 6.0)
        steps.append(step_add(
            "cylinder",
            dims={"r": f_od / 2.0, "h": flange_t},
            position=[0.0, flange_t / 2.0, 0.0],
            tag="flange",
            note=f"End flange ⌀{f_od:.1f} × {flange_t:.1f} mm",
        ))

    steps.append(step_boolean("union", targets=["all-positives"], note="Fuse shell + flange + ribs"))
    steps.append(step_boolean("subtract", targets=["all-current"], note="Hollow the bore"))
    steps.append(step_group(
        f"Spool spacer  ⌀{od:.0f}/{id_:.0f} × {length:.0f}",
        targets=["all-current"],
        note="Spool-hub adapter",
    ))
    return steps

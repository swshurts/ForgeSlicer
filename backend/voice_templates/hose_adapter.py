"""Hose-adapter template — iter-103.3.

A barbed cylindrical adapter that connects two different hose IDs. The
default profile is a stepped tube: tube_A (matches hose A) → optional
flange → tube_B (matches hose B), with sawtooth barbs on each end to
grip the hose. A central through-bore the size of the smaller tube
keeps fluid flow continuous.

Implemented as a stack of cylinders (positives) UNION'd, then a single
through-bore cylinder subtracted. Barbs are short cylinder rings with
slightly larger outer diameter, stacked at the ends.

ForgeSlicer coordinate convention (dims.x = world X, dims.y = world Z,
dims.z = world Y / UP). Adapter sits vertically with hose-A end on
the bed.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .base import step_add, step_boolean, step_group


META = {
    "id": "hose_adapter",
    "label": "Hose adapter (barbed reducer)",
    "description": (
        "Barbed cylindrical adapter between two hoses of different "
        "inner diameter. Sawtooth barbs on each end grip the hose; "
        "the through-bore matches the smaller hose so flow stays "
        "continuous. Print upright."
    ),
    "params": {
        "hose_a_id_mm": {"type": "number", "default": 12.0, "min": 3.0, "max": 60.0,
                         "describe": "Inner diameter of hose A (mm). The barb's OUTER diameter at the tip will be slightly less to slip in; the next barb will be slightly larger to grip."},
        "hose_b_id_mm": {"type": "number", "default": 8.0, "min": 3.0, "max": 60.0,
                         "describe": "Inner diameter of hose B (mm). 8 = standard 1/4″ pneumatic; 12 = standard 1/2″ irrigation."},
        "wall_mm": {"type": "number", "default": 1.5, "min": 0.8, "max": 5.0,
                    "describe": "Wall thickness of the adapter tube (mm). 1.5 mm in PETG handles ~3 bar. Use 2 mm+ for higher pressure."},
        "section_a_length_mm": {"type": "number", "default": 18.0, "min": 8.0, "max": 80.0,
                                "describe": "Length of the hose-A end section (mm) — how far the hose slides on."},
        "section_b_length_mm": {"type": "number", "default": 18.0, "min": 8.0, "max": 80.0,
                                "describe": "Length of the hose-B end section (mm)."},
        "flange_thickness_mm": {"type": "number", "default": 0.0, "min": 0.0, "max": 10.0,
                                "describe": "Optional flange disc between the two sections (mm). 0 = smooth taper. Larger flange acts as a finger grip and a hose stop."},
        "flange_diameter_mm": {"type": "number", "default": 0.0, "min": 0.0, "max": 80.0,
                               "describe": "Flange outer diameter (mm). 0 = auto (max(hose_a_id, hose_b_id) + 8 mm)."},
        "barbs_per_section": {"type": "number", "default": 3, "min": 0, "max": 6,
                              "describe": "Number of sawtooth barbs per end. 0 = smooth tube; 2-3 is typical for good hose grip without making it too hard to slide on."},
        "barb_height_mm": {"type": "number", "default": 1.2, "min": 0.3, "max": 4.0,
                           "describe": "How far each barb sticks out beyond the tube OD (mm). 1.0-1.5 mm is the sweet spot for typical hoses."},
    },
}


def _build_section(steps, label, end_id, length, wall, barb_count, barb_h,
                   y_bottom):
    """One end of the adapter — a tube section plus `barb_count` barbs.

    `end_id` is the hose's INNER diameter we're targeting. The tube's
    OUTER diameter is end_id + 2*wall. The bore (subtracted later) is
    the SMALLER of the two ends' inner diameters.

    Returns the y-position of the SECTION TOP (where the next section
    starts).
    """
    od = end_id + 2.0 * wall
    tube_r = od / 2.0
    # Main tube.
    steps.append(step_add(
        "cylinder",
        dims={"r": tube_r, "h": length},
        position=[0.0, y_bottom + length / 2.0, 0.0],
        tag=f"tube_{label}",
        note=f"{label} tube  ⌀{od:.1f} × {length:.0f} mm",
    ))

    # Barbs — slightly larger cylinder rings, stacked along the tube.
    # We model each barb as a SHORT thicker cylinder slice. The bevel
    # is approximated by alternating big/small cylinders; print-time
    # smoothing softens the edges.
    if barb_count > 0:
        barb_r = tube_r + barb_h
        # Pack barbs evenly along the section, leaving the tip clean
        # (~2 mm) for easy hose entry.
        usable = length - 3.0
        pitch = usable / barb_count if barb_count > 0 else 0.0
        for k in range(barb_count):
            barb_centre_y = y_bottom + 1.5 + pitch * (k + 0.5)
            steps.append(step_add(
                "cylinder",
                dims={"r": barb_r, "h": min(2.0, pitch * 0.6)},
                position=[0.0, barb_centre_y, 0.0],
                tag=f"barb_{label}_{k}",
                note=f"Barb {k+1}/{barb_count} on {label}",
            ))

    return y_bottom + length


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    id_a = float(params.get("hose_a_id_mm", 12.0))
    id_b = float(params.get("hose_b_id_mm", 8.0))
    wall = float(params.get("wall_mm", 1.5))
    len_a = float(params.get("section_a_length_mm", 18.0))
    len_b = float(params.get("section_b_length_mm", 18.0))
    flange_t = float(params.get("flange_thickness_mm", 0.0) or 0.0)
    flange_d_in = float(params.get("flange_diameter_mm", 0.0) or 0.0)
    n_barbs = max(0, int(params.get("barbs_per_section", 3) or 0))
    barb_h = float(params.get("barb_height_mm", 1.2))

    steps: List[Dict[str, Any]] = []

    # Start with section A on the bed.
    top_after_a = _build_section(steps, "A", id_a, len_a, wall, n_barbs, barb_h, 0.0)

    # Flange (optional) between the two sections.
    if flange_t > 0.0:
        flange_d = flange_d_in if flange_d_in > 0.0 else max(id_a, id_b) + 8.0
        steps.append(step_add(
            "cylinder",
            dims={"r": flange_d / 2.0, "h": flange_t},
            position=[0.0, top_after_a + flange_t / 2.0, 0.0],
            tag="flange",
            note=f"Flange  ⌀{flange_d:.1f} × {flange_t:.1f} mm",
        ))
        top_after_a += flange_t

    # Section B.
    _build_section(steps, "B", id_b, len_b, wall, n_barbs, barb_h, top_after_a)

    # Through-bore — diameter equal to the SMALLER hose's ID so flow
    # stays continuous. Subtract from the union of all positives.
    bore_d = min(id_a, id_b)
    total_h = len_a + flange_t + len_b
    steps.append(step_add(
        "cylinder",
        modifier="negative",
        dims={"r": bore_d / 2.0, "h": total_h + 2.0},
        position=[0.0, total_h / 2.0, 0.0],
        tag="bore",
        note=f"Through-bore  ⌀{bore_d:.1f} mm",
    ))

    steps.append(step_boolean(
        "union",
        targets=["all-positives"],
        note="Fuse tube sections + barbs + flange",
    ))
    steps.append(step_boolean(
        "subtract",
        targets=["all-current"],
        note="Drill the through-bore",
    ))
    steps.append(step_group(
        f"Hose adapter  ⌀{id_a:.0f}→⌀{id_b:.0f} mm",
        targets=["all-current"],
        note="Group the finished adapter",
    ))
    return steps

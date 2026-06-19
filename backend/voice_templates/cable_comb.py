"""Cable-comb template — iter-103.

A flat rail with a row of evenly spaced fingers that organises a bundle
of cables (USB, monitor, network, audio) along a desk edge. Each finger
has a small "lip" / hook at the tip so cables don't lift out when
pulled. Designed to print flat with no supports — the lips face along
the bed.

ForgeSlicer coordinate convention used (dims.x = world X width,
dims.y = world Z depth, dims.z = world Y height/UP).
"""
from __future__ import annotations

from typing import Any, Dict, List

from .base import step_add, step_boolean, step_group, to_mm


META = {
    "id": "cable_comb",
    "label": "Cable comb",
    "description": (
        "Flat rail with a row of fingers that hold a desk-edge bundle "
        "of cables in place. Fingers have a small lip at the tip so "
        "cables stay seated. Prints flat with no supports."
    ),
    "params": {
        "slot_count": {"type": "number", "default": 6, "min": 2, "max": 24,
                       "describe": "Number of cable slots (gaps between fingers)."},
        "slot_width_mm": {"type": "number", "default": 8.0, "min": 3.0, "max": 30.0,
                          "describe": "Width of each cable slot at its mouth (mm) — pick the diameter of the THICKEST cable you'll route."},
        "finger_width_mm": {"type": "number", "default": 3.0, "min": 1.5, "max": 12.0,
                            "describe": "Thickness of each finger between slots (mm)."},
        "finger_height_mm": {"type": "number", "default": 14.0, "min": 6.0, "max": 60.0,
                             "describe": "How tall each finger stands above the spine (mm)."},
        "spine_height_mm": {"type": "number", "default": 4.0, "min": 2.0, "max": 20.0,
                            "describe": "Thickness of the flat baseplate the fingers sit on (mm)."},
        "spine_depth_mm": {"type": "number", "default": 22.0, "min": 10.0, "max": 80.0,
                           "describe": "Depth of the baseplate front-to-back (mm) — should be 2-3× cable diameter."},
        "lip_mm": {"type": "number", "default": 1.6, "min": 0.0, "max": 6.0,
                   "describe": "How far the tip of each finger overhangs the slot (mm). 0 = no lip / open comb."},
        "mount_holes": {"type": "enum", "default": "two",
                        "values": ["none", "two", "every-end"],
                        "describe": "Mounting screw holes through the spine."},
        "screw_diameter_mm": {"type": "number", "default": 4.0, "min": 2.0, "max": 8.0,
                              "describe": "Mounting screw clearance diameter (mm)."},
    },
}


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    n_slots = max(2, int(params.get("slot_count", 6)))
    slot_w = float(params.get("slot_width_mm", 8.0))
    finger_w = float(params.get("finger_width_mm", 3.0))
    finger_h = float(params.get("finger_height_mm", 14.0))
    spine_h = float(params.get("spine_height_mm", 4.0))
    spine_d = float(params.get("spine_depth_mm", 22.0))
    lip = float(params.get("lip_mm", 1.6))
    mount = str(params.get("mount_holes", "two") or "two")
    screw_d = float(params.get("screw_diameter_mm", 4.0))

    # Total comb length: (n_slots + 1) fingers + n_slots slots, plus a
    # half-finger of "end" material on each side so the outer slots
    # have a wall.
    n_fingers = n_slots + 1
    total_w = n_fingers * finger_w + n_slots * slot_w
    total_h = spine_h + finger_h          # world Y (up)
    total_d = spine_d                      # world Z (front-back)

    steps: List[Dict[str, Any]] = []

    # Spine — flat plate on the bed.
    steps.append(step_add(
        "cube",
        dims={"x": total_w, "y": total_d, "z": spine_h},
        position=[0.0, 0.0, spine_h / 2.0],
        tag="spine",
        note=f"Spine {total_w:.0f} × {spine_d:.0f} × {spine_h:.1f} mm",
    ))

    # Tall vertical wall above the spine. We'll subtract slot windows
    # from it to leave fingers behind. This is simpler and produces a
    # cleaner mesh than building n_fingers individual cube fingers.
    wall_y = spine_h + finger_h / 2.0
    steps.append(step_add(
        "cube",
        dims={"x": total_w, "y": total_d, "z": finger_h},
        position=[0.0, 0.0, wall_y],
        tag="wall",
        note=f"Finger wall {total_w:.0f} × {spine_d:.0f} × {finger_h:.0f} mm",
    ))

    # X position of slot k centre, k in [0..n_slots-1].
    # First finger left-edge at x = -total_w/2; first slot starts at
    # x = -total_w/2 + finger_w.
    left_edge = -total_w / 2.0
    for k in range(n_slots):
        # Slot k occupies x range:
        #   start = left_edge + (k+1)*finger_w + k*slot_w
        slot_start = left_edge + (k + 1) * finger_w + k * slot_w
        slot_cx = slot_start + slot_w / 2.0

        # Slot opening — punches downward from the top of the finger
        # wall, leaving (lip) mm of overhang at the very top if
        # lip > 0. Implemented by making the slot cutter shorter than
        # the wall by `lip` mm and offsetting its top to wall-top - lip.
        cutter_h = finger_h - max(0.0, min(lip, finger_h * 0.85))
        cutter_y = spine_h + cutter_h / 2.0 + max(0.0, lip)
        # The cutter EXTENDS to the very top by widening past it on
        # the +Y side; we want a CLOSED notch with the lip overhanging
        # the slot from above. To create the overhang, cut a slot of
        # width (slot_w) for height (cutter_h) starting at +spine_h,
        # then ALSO cut a wider notch above (slot_w + finger_w) for
        # the lip's outer chamfer-free shoulder height of `lip` mm
        # — actually simpler: just leave the lip as a flat overhang
        # by carving the slot up to wall-top - lip and the FULL
        # slot_w width keeps a `lip`-thick roof.
        steps.append(step_add(
            "cube",
            modifier="negative",
            dims={"x": slot_w, "y": spine_d + 2.0, "z": cutter_h},
            position=[slot_cx, 0.0, cutter_y],
            tag=f"slot_{k}",
            note=f"Slot {k + 1}/{n_slots} (⌀{slot_w:.0f} mm)",
        ))

    # Mounting screw holes through the spine.
    if mount != "none":
        # Screw X positions: "two" puts them ~10mm from each end,
        # "every-end" adds one through the very middle as well.
        margin = max(6.0, screw_d * 1.5)
        screw_xs = [left_edge + margin, -left_edge - margin]
        if mount == "every-end":
            screw_xs.append(0.0)
        # Centred Z on the spine.
        for i, sx in enumerate(screw_xs):
            steps.append(step_add(
                "cylinder",
                modifier="negative",
                dims={"r": screw_d / 2.0, "h": spine_h + 2.0},
                position=[sx, 0.0, spine_h / 2.0],
                tag=f"screw_{i}",
                note=f"Mount hole ⌀{screw_d:.1f} mm",
            ))

    steps.append(step_boolean("union", targets=["all-positives"], note="Fuse spine + wall"))
    steps.append(step_boolean("subtract", targets=["all-current"], note="Cut slots + screw holes"))
    steps.append(step_group(
        f"Cable comb  {n_slots} × {slot_w:.0f}mm",
        targets=["all-current"],
        note=f"{total_w:.0f} × {spine_d:.0f} × {total_h:.0f} mm",
    ))
    return steps

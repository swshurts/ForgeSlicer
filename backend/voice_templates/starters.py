"""Beginner Starter Templates — the "first-print" library.

These 12 builders back the BeginnerStarters cards on the landing page.
Unlike the heavy parametric brackets / enclosures (which expose 5-10
engineering knobs), starters intentionally take ZERO required params:
every value has a sensible default chosen for a first-time printer,
because the entire promise of the landing block is "click and design
something real". After the part lands in the workspace the user
edits dimensions with the gizmos / numeric inputs they're learning.

Each starter exports a SimpleNamespace-style object with META + build,
matching the convention used by every other template module so the
registry doesn't need to know they're co-located in one file.

Design choices kept consistent across all 12:
  • Origin is in the centre of the part's XY footprint, base at z=0.
  • Body uses 'cube' (rectangular prism via x/y/z dims) or 'cylinder'
    (r + h) — no text steps, since the executor's primitive list
    doesn't include a text glyph generator. The user adds text later
    from the workspace's Text tool.
  • All dimensions are millimetres.
"""
from __future__ import annotations

import math
from types import SimpleNamespace
from typing import Any, Dict, List

from .base import step_add, step_boolean, step_group


# ─── Helpers ───────────────────────────────────────────────────────
def _f(p: Dict[str, Any], key: str, default: float) -> float:
    """Float param with default; coerces strings ("12") gracefully."""
    v = p.get(key, default)
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _i(p: Dict[str, Any], key: str, default: int, lo: int = 1, hi: int = 50) -> int:
    v = p.get(key, default)
    try:
        n = int(v) if v is not None else default
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


# ─── 1. Keychain ───────────────────────────────────────────────────
# Round disc with a ring hole near one edge. Classic "first print".
def _build_keychain(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    diameter = _f(params, "diameter_mm", 35.0)
    thickness = _f(params, "thickness_mm", 4.0)
    ring_diameter = _f(params, "ring_diameter_mm", 5.5)
    r = diameter / 2.0
    ring_offset = r - ring_diameter   # ring sits inside the disc, just shy of the edge

    steps: List[Dict[str, Any]] = [
        step_add(
            "cylinder",
            dims={"r": r, "h": thickness},
            position=[0.0, 0.0, thickness / 2.0],
            tag="body",
            note=f"Keychain disc  ⌀{diameter:.0f} × {thickness:.1f} mm",
        ),
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": ring_diameter / 2.0, "h": thickness + 2.0},
            position=[ring_offset, 0.0, thickness / 2.0],
            tag="ring_hole",
            note=f"Key-ring hole  ⌀{ring_diameter:.1f} mm",
        ),
        step_boolean("subtract", targets=["all-current"],
                     note="Punch the ring hole through the disc"),
        step_group("Keychain", targets=["all-current"]),
    ]
    return steps


META_KEYCHAIN = {
    "id": "starter_keychain",
    "label": "Keychain (round)",
    "description": "Round disc with a key-ring hole. Add your text with the Text tool.",
    "params": {
        "diameter_mm": {"type": "number", "default": 35.0, "min": 20.0, "max": 80.0,
                        "describe": "Outer diameter of the disc (mm)."},
        "thickness_mm": {"type": "number", "default": 4.0, "min": 2.0, "max": 10.0,
                         "describe": "Disc thickness (mm)."},
        "ring_diameter_mm": {"type": "number", "default": 5.5, "min": 3.0, "max": 12.0,
                             "describe": "Diameter of the ring hole (mm)."},
    },
}


# ─── 2. Phone Stand ────────────────────────────────────────────────
# Angled cradle: a base block with an angled rest, plus a lip.
def _build_phone_stand(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    width = _f(params, "width_mm", 80.0)
    angle_deg = _f(params, "angle_deg", 65.0)
    rest_thickness = _f(params, "rest_thickness_mm", 6.0)
    rest_height = _f(params, "rest_height_mm", 110.0)
    base_depth = _f(params, "base_depth_mm", 80.0)
    base_height = _f(params, "base_height_mm", 8.0)
    lip_height = _f(params, "lip_height_mm", 12.0)
    lip_thickness = _f(params, "lip_thickness_mm", 6.0)

    steps: List[Dict[str, Any]] = [
        # Base slab on the table.
        step_add(
            "cube",
            dims={"x": width, "y": base_depth, "z": base_height},
            position=[0.0, 0.0, base_height / 2.0],
            tag="base",
            note=f"Base  {width:.0f} × {base_depth:.0f} × {base_height:.0f} mm",
        ),
        # Angled rest — rotates around X axis so it tilts back.
        step_add(
            "cube",
            dims={"x": width, "y": rest_thickness, "z": rest_height},
            position=[0.0, -base_depth / 6.0, base_height + rest_height / 2.0 * math.sin(math.radians(angle_deg))],
            rotation=[90.0 - angle_deg, 0.0, 0.0],
            tag="rest",
            note=f"Angled rest  {rest_height:.0f} mm tall @ {angle_deg:.0f}°",
        ),
        # Front lip — stops the phone sliding off.
        step_add(
            "cube",
            dims={"x": width, "y": lip_thickness, "z": lip_height},
            position=[0.0, base_depth / 2.0 - lip_thickness / 2.0, base_height + lip_height / 2.0],
            tag="lip",
            note=f"Phone lip  {lip_height:.0f} mm tall",
        ),
        step_boolean("union", targets=["all-positives"], note="Fuse stand"),
        step_group("Phone Stand", targets=["all-current"]),
    ]
    return steps


META_PHONE_STAND = {
    "id": "starter_phone_stand",
    "label": "Phone Stand",
    "description": "Angled phone cradle with a front lip. Tweak width and angle to suit your device.",
    "params": {
        "width_mm": {"type": "number", "default": 80.0, "min": 60.0, "max": 200.0,
                     "describe": "Stand width along X (mm); pick a touch wider than your phone."},
        "angle_deg": {"type": "number", "default": 65.0, "min": 45.0, "max": 80.0,
                      "describe": "Rest angle from horizontal (°)."},
        "rest_height_mm": {"type": "number", "default": 110.0, "min": 60.0, "max": 220.0,
                           "describe": "Rest height (mm)."},
    },
}


# ─── 3. Name Tag ───────────────────────────────────────────────────
# Flat plate with a pin-clip hole. Add text in the workspace.
def _build_name_tag(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    width = _f(params, "width_mm", 70.0)
    height = _f(params, "height_mm", 28.0)
    thickness = _f(params, "thickness_mm", 3.0)
    pin_diameter = _f(params, "pin_diameter_mm", 2.5)

    steps: List[Dict[str, Any]] = [
        step_add(
            "cube",
            dims={"x": width, "y": height, "z": thickness},
            position=[0.0, 0.0, thickness / 2.0],
            tag="plate",
            note=f"Name plate  {width:.0f} × {height:.0f} × {thickness:.1f} mm",
        ),
        # Two small holes for a pin-clip lanyard.
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": pin_diameter / 2.0, "h": thickness + 2.0},
            position=[-width / 2.0 + 4.0, 0.0, thickness / 2.0],
            tag="pin_left",
            note=f"Pin hole  ⌀{pin_diameter:.1f} mm",
        ),
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": pin_diameter / 2.0, "h": thickness + 2.0},
            position=[width / 2.0 - 4.0, 0.0, thickness / 2.0],
            tag="pin_right",
            note=f"Pin hole  ⌀{pin_diameter:.1f} mm",
        ),
        step_boolean("subtract", targets=["all-current"],
                     note="Punch pin holes"),
        step_group("Name Tag", targets=["all-current"]),
    ]
    return steps


META_NAME_TAG = {
    "id": "starter_name_tag",
    "label": "Name Tag",
    "description": "Flat name-plate with pin-clip holes. Add your name with the Text tool.",
    "params": {
        "width_mm": {"type": "number", "default": 70.0, "min": 40.0, "max": 150.0,
                     "describe": "Plate width (mm)."},
        "height_mm": {"type": "number", "default": 28.0, "min": 20.0, "max": 60.0,
                      "describe": "Plate height (mm)."},
    },
}


# ─── 4. Plant Marker ───────────────────────────────────────────────
# Tag with a sharp spike to push into soil.
def _build_plant_marker(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    tag_w = _f(params, "tag_width_mm", 40.0)
    tag_h = _f(params, "tag_height_mm", 22.0)
    thickness = _f(params, "thickness_mm", 2.5)
    spike_h = _f(params, "spike_height_mm", 60.0)
    spike_w = _f(params, "spike_width_mm", 8.0)

    steps: List[Dict[str, Any]] = [
        # Top tag panel.
        step_add(
            "cube",
            dims={"x": tag_w, "y": thickness, "z": tag_h},
            position=[0.0, 0.0, spike_h + tag_h / 2.0],
            tag="tag",
            note=f"Tag panel  {tag_w:.0f} × {tag_h:.0f} mm",
        ),
        # Spike — narrows by virtue of being a cube + cone subtractions
        # would be over-engineering; a slim cube is fine for soil push-in.
        step_add(
            "cube",
            dims={"x": spike_w, "y": thickness, "z": spike_h},
            position=[0.0, 0.0, spike_h / 2.0],
            tag="spike",
            note=f"Soil spike  {spike_w:.0f} mm wide × {spike_h:.0f} mm tall",
        ),
        step_boolean("union", targets=["all-positives"], note="Fuse marker"),
        step_group("Plant Marker", targets=["all-current"]),
    ]
    return steps


META_PLANT_MARKER = {
    "id": "starter_plant_marker",
    "label": "Plant Marker",
    "description": "Tag with a spike. Stack a dozen for an entire herb garden.",
    "params": {
        "tag_width_mm": {"type": "number", "default": 40.0, "min": 25.0, "max": 80.0,
                         "describe": "Top tag width (mm)."},
        "spike_height_mm": {"type": "number", "default": 60.0, "min": 30.0, "max": 120.0,
                            "describe": "Soil-spike length (mm)."},
    },
}


# ─── 5. Cable Clip ─────────────────────────────────────────────────
# C-shape: a block with a cylindrical bore and a slot opening on top.
def _build_cable_clip(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    cable_d = _f(params, "cable_diameter_mm", 6.0)
    width = _f(params, "width_mm", 14.0)
    wall = _f(params, "wall_mm", 3.0)
    slot = _f(params, "slot_mm", max(2.0, cable_d * 0.65))

    inner_r = cable_d / 2.0
    outer_r = inner_r + wall
    body_side = outer_r * 2.0

    steps: List[Dict[str, Any]] = [
        step_add(
            "cube",
            dims={"x": body_side, "y": width, "z": body_side},
            position=[0.0, 0.0, outer_r],
            tag="body",
            note=f"Clip body  {body_side:.1f} × {width:.0f} × {body_side:.1f} mm",
        ),
        # Bore for the cable.
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": inner_r, "h": width + 2.0},
            position=[0.0, 0.0, outer_r],
            rotation=[90.0, 0.0, 0.0],
            tag="bore",
            note=f"Cable bore  ⌀{cable_d:.1f} mm",
        ),
        # Slot opening on top so the cable snaps in.
        step_add(
            "cube",
            modifier="negative",
            dims={"x": slot, "y": width + 2.0, "z": outer_r + 2.0},
            position=[0.0, 0.0, outer_r + (outer_r + 2.0) / 2.0],
            tag="slot",
            note=f"Snap slot  {slot:.1f} mm wide",
        ),
        step_boolean("subtract", targets=["all-current"], note="Carve bore + slot"),
        step_group("Cable Clip", targets=["all-current"]),
    ]
    return steps


META_CABLE_CLIP = {
    "id": "starter_cable_clip",
    "label": "Cable Clip",
    "description": "Snap-on clip for desk cables. Adjust the inner diameter to your wire bundle.",
    "params": {
        "cable_diameter_mm": {"type": "number", "default": 6.0, "min": 2.0, "max": 25.0,
                              "describe": "Cable bundle diameter (mm)."},
        "width_mm": {"type": "number", "default": 14.0, "min": 6.0, "max": 30.0,
                     "describe": "Clip width along the cable (mm)."},
    },
}


# ─── 6. Mini Organizer Tray ────────────────────────────────────────
# Grid of pockets carved into a slab.
def _build_organizer_tray(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    cols = _i(params, "cols", 3, 1, 8)
    rows = _i(params, "rows", 2, 1, 8)
    pocket_w = _f(params, "pocket_width_mm", 28.0)
    pocket_d = _f(params, "pocket_depth_mm", 28.0)
    pocket_z = _f(params, "pocket_depth_z_mm", 15.0)
    wall = _f(params, "wall_mm", 3.0)
    floor = _f(params, "floor_mm", 2.0)

    outer_x = cols * pocket_w + (cols + 1) * wall
    outer_y = rows * pocket_d + (rows + 1) * wall
    outer_z = pocket_z + floor

    steps: List[Dict[str, Any]] = [
        step_add(
            "cube",
            dims={"x": outer_x, "y": outer_y, "z": outer_z},
            position=[0.0, 0.0, outer_z / 2.0],
            tag="shell",
            note=f"Tray shell  {outer_x:.0f} × {outer_y:.0f} × {outer_z:.0f} mm",
        ),
    ]

    # Pocket negatives.
    start_x = -outer_x / 2.0 + wall + pocket_w / 2.0
    start_y = -outer_y / 2.0 + wall + pocket_d / 2.0
    for r in range(rows):
        for c in range(cols):
            cx = start_x + c * (pocket_w + wall)
            cy = start_y + r * (pocket_d + wall)
            steps.append(step_add(
                "cube",
                modifier="negative",
                dims={"x": pocket_w, "y": pocket_d, "z": pocket_z + 0.5},
                position=[cx, cy, floor + (pocket_z + 0.5) / 2.0],
                tag=f"pocket_{r}_{c}",
                note=f"Pocket {r + 1}-{c + 1}",
            ))

    steps.append(step_boolean("subtract", targets=["all-current"],
                              note=f"Carve {rows * cols} pockets"))
    steps.append(step_group("Organizer Tray", targets=["all-current"]))
    return steps


META_ORGANIZER_TRAY = {
    "id": "starter_organizer_tray",
    "label": "Mini Organizer Tray",
    "description": "Grid of pockets in a slab. Choose rows/cols and pocket size.",
    "params": {
        "cols": {"type": "number", "default": 3, "min": 1, "max": 8,
                 "describe": "Number of pockets along X."},
        "rows": {"type": "number", "default": 2, "min": 1, "max": 8,
                 "describe": "Number of pockets along Y."},
        "pocket_width_mm": {"type": "number", "default": 28.0, "min": 10.0, "max": 80.0,
                            "describe": "Each pocket's width (mm)."},
        "pocket_depth_mm": {"type": "number", "default": 28.0, "min": 10.0, "max": 80.0,
                            "describe": "Each pocket's depth (mm)."},
    },
}


# ─── 7. Replacement Knob ───────────────────────────────────────────
# Cylinder + smaller cylinder shaft bore.
def _build_replacement_knob(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    top_d = _f(params, "top_diameter_mm", 30.0)
    base_d = _f(params, "base_diameter_mm", 24.0)
    height = _f(params, "height_mm", 18.0)
    shaft_d = _f(params, "shaft_diameter_mm", 6.0)
    shaft_depth = _f(params, "shaft_depth_mm", 12.0)

    steps: List[Dict[str, Any]] = [
        # Two stacked cylinders for the tapered look.
        step_add(
            "cylinder",
            dims={"r": base_d / 2.0, "h": height * 0.4},
            position=[0.0, 0.0, height * 0.4 / 2.0],
            tag="base",
            note=f"Knob base  ⌀{base_d:.1f} × {height * 0.4:.1f} mm",
        ),
        step_add(
            "cylinder",
            dims={"r": top_d / 2.0, "h": height * 0.6},
            position=[0.0, 0.0, height * 0.4 + height * 0.6 / 2.0],
            tag="cap",
            note=f"Knob cap  ⌀{top_d:.1f} × {height * 0.6:.1f} mm",
        ),
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": shaft_d / 2.0, "h": shaft_depth + 0.5},
            position=[0.0, 0.0, shaft_depth / 2.0 - 0.25],
            tag="shaft_bore",
            note=f"Shaft bore  ⌀{shaft_d:.1f} × {shaft_depth:.1f} mm",
        ),
        step_boolean("union", targets=["tag:base", "tag:cap"], note="Fuse knob"),
        step_boolean("subtract", targets=["all-current"], note="Bore shaft hole"),
        step_group("Replacement Knob", targets=["all-current"]),
    ]
    return steps


META_REPLACEMENT_KNOB = {
    "id": "starter_replacement_knob",
    "label": "Replacement Knob",
    "description": "Two-tier knob with a shaft bore. Common for ovens, drawers, cabinets.",
    "params": {
        "top_diameter_mm": {"type": "number", "default": 30.0, "min": 15.0, "max": 60.0,
                            "describe": "Top cap diameter (mm)."},
        "shaft_diameter_mm": {"type": "number", "default": 6.0, "min": 3.0, "max": 16.0,
                              "describe": "Shaft bore diameter (mm)."},
    },
}


# ─── 8. Simple Bracket ─────────────────────────────────────────────
# Lightweight L bracket. Lighter than the heavy 'right_angle_bracket'
# template — fewer holes, simpler geometry, much faster to print.
def _build_simple_bracket(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    arm_length = _f(params, "arm_length_mm", 50.0)
    width = _f(params, "width_mm", 20.0)
    thickness = _f(params, "thickness_mm", 4.0)
    screw_d = _f(params, "screw_diameter_mm", 4.0)
    screw_r = screw_d / 2.0

    steps: List[Dict[str, Any]] = [
        # Wall arm — stands up along Z.
        step_add(
            "cube",
            dims={"x": thickness, "y": width, "z": arm_length},
            position=[thickness / 2.0, width / 2.0, arm_length / 2.0],
            tag="wall_arm",
            note=f"Wall arm  {arm_length:.0f} × {width:.0f} mm",
        ),
        # Shelf arm — lays flat.
        step_add(
            "cube",
            dims={"x": arm_length, "y": width, "z": thickness},
            position=[arm_length / 2.0, width / 2.0, thickness / 2.0],
            tag="shelf_arm",
            note=f"Shelf arm  {arm_length:.0f} × {width:.0f} mm",
        ),
        # One screw hole per arm.
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": screw_r, "h": thickness + 2.0},
            position=[thickness / 2.0, width / 2.0, arm_length - 10.0],
            rotation=[0.0, 90.0, 0.0],
            tag="wall_hole",
            note=f"Wall screw hole  ⌀{screw_d:.1f} mm",
        ),
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": screw_r, "h": thickness + 2.0},
            position=[arm_length - 10.0, width / 2.0, thickness / 2.0],
            tag="shelf_hole",
            note=f"Shelf screw hole  ⌀{screw_d:.1f} mm",
        ),
        step_boolean("union", targets=["tag:wall_arm", "tag:shelf_arm"], note="Fuse arms"),
        step_boolean("subtract", targets=["all-current"], note="Punch screw holes"),
        step_group("Simple Bracket", targets=["all-current"]),
    ]
    return steps


META_SIMPLE_BRACKET = {
    "id": "starter_simple_bracket",
    "label": "Simple Bracket",
    "description": "Right-angle L bracket with two screw holes. A lighter cousin of the engineered shelf bracket.",
    "params": {
        "arm_length_mm": {"type": "number", "default": 50.0, "min": 25.0, "max": 150.0,
                          "describe": "Length of each arm (mm)."},
        "thickness_mm": {"type": "number", "default": 4.0, "min": 2.0, "max": 10.0,
                         "describe": "Bracket thickness (mm)."},
    },
}


# ─── 9. Cookie Cutter ──────────────────────────────────────────────
# Hollow ring — outer cylinder minus inner cylinder.
def _build_cookie_cutter(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    outer_d = _f(params, "outer_diameter_mm", 60.0)
    wall = _f(params, "wall_mm", 1.6)
    height = _f(params, "height_mm", 18.0)

    outer_r = outer_d / 2.0
    inner_r = outer_r - wall

    steps: List[Dict[str, Any]] = [
        step_add(
            "cylinder",
            dims={"r": outer_r, "h": height},
            position=[0.0, 0.0, height / 2.0],
            tag="outer",
            note=f"Outer wall  ⌀{outer_d:.0f} × {height:.0f} mm",
        ),
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": inner_r, "h": height + 2.0},
            position=[0.0, 0.0, height / 2.0],
            tag="inner",
            note=f"Inner bore  ⌀{inner_r * 2.0:.1f} mm",
        ),
        step_boolean("subtract", targets=["all-current"], note="Hollow it out"),
        step_group("Cookie Cutter", targets=["all-current"]),
    ]
    return steps


META_COOKIE_CUTTER = {
    "id": "starter_cookie_cutter",
    "label": "Cookie Cutter",
    "description": "Round outline cutter. Swap the outer cylinder for any 2D polygon to make custom shapes.",
    "params": {
        "outer_diameter_mm": {"type": "number", "default": 60.0, "min": 30.0, "max": 150.0,
                              "describe": "Outer diameter (mm)."},
        "wall_mm": {"type": "number", "default": 1.6, "min": 0.8, "max": 3.0,
                    "describe": "Cutting-edge wall thickness (mm)."},
    },
}


# ─── 10. Toy Wheel ─────────────────────────────────────────────────
# Disc with an axle bore.
def _build_toy_wheel(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    outer_d = _f(params, "outer_diameter_mm", 28.0)
    thickness = _f(params, "thickness_mm", 8.0)
    axle_d = _f(params, "axle_diameter_mm", 3.0)
    hub_d = _f(params, "hub_diameter_mm", 10.0)

    steps: List[Dict[str, Any]] = [
        step_add(
            "cylinder",
            dims={"r": outer_d / 2.0, "h": thickness},
            position=[0.0, 0.0, thickness / 2.0],
            tag="tyre",
            note=f"Tyre  ⌀{outer_d:.0f} × {thickness:.1f} mm",
        ),
        # Inner hub is slightly thicker — fakes a hubcap profile.
        step_add(
            "cylinder",
            dims={"r": hub_d / 2.0, "h": thickness + 1.5},
            position=[0.0, 0.0, (thickness + 1.5) / 2.0],
            tag="hub",
            note=f"Hub  ⌀{hub_d:.1f} mm",
        ),
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": axle_d / 2.0, "h": thickness + 4.0},
            position=[0.0, 0.0, thickness / 2.0],
            tag="axle_bore",
            note=f"Axle bore  ⌀{axle_d:.1f} mm",
        ),
        step_boolean("union", targets=["tag:tyre", "tag:hub"], note="Fuse tyre + hub"),
        step_boolean("subtract", targets=["all-current"], note="Bore the axle"),
        step_group("Toy Wheel", targets=["all-current"]),
    ]
    return steps


META_TOY_WHEEL = {
    "id": "starter_toy_wheel",
    "label": "Toy Wheel",
    "description": "Replacement wheel with axle bore. Tweak diameter and bore to match the toy.",
    "params": {
        "outer_diameter_mm": {"type": "number", "default": 28.0, "min": 10.0, "max": 80.0,
                              "describe": "Outer tyre diameter (mm)."},
        "axle_diameter_mm": {"type": "number", "default": 3.0, "min": 1.5, "max": 10.0,
                             "describe": "Axle bore diameter (mm)."},
    },
}


# ─── 11. Desk Hook ─────────────────────────────────────────────────
# Inverted-U clamp-on hook for a desk edge.
def _build_desk_hook(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    desk_t = _f(params, "desk_thickness_mm", 25.0)
    width = _f(params, "width_mm", 20.0)
    wall = _f(params, "wall_mm", 5.0)
    hook_drop = _f(params, "hook_drop_mm", 35.0)
    hook_in = _f(params, "hook_in_mm", 20.0)

    outer_top_w = desk_t + 2 * wall
    top_h = wall

    steps: List[Dict[str, Any]] = [
        # Top horizontal — sits on the desk surface.
        step_add(
            "cube",
            dims={"x": outer_top_w, "y": width, "z": top_h},
            position=[0.0, 0.0, desk_t + top_h / 2.0],
            tag="top",
            note=f"Top brace  {outer_top_w:.1f} × {width:.0f} × {top_h:.1f} mm",
        ),
        # Back wall — sits behind the desk edge.
        step_add(
            "cube",
            dims={"x": wall, "y": width, "z": desk_t + top_h},
            position=[-(desk_t / 2.0 + wall / 2.0), 0.0, (desk_t + top_h) / 2.0],
            tag="back",
            note=f"Back wall {wall:.1f} mm",
        ),
        # Front wall — sits in front of the desk edge.
        step_add(
            "cube",
            dims={"x": wall, "y": width, "z": desk_t + top_h + hook_drop},
            position=[(desk_t / 2.0 + wall / 2.0), 0.0, (desk_t + top_h + hook_drop) / 2.0 - hook_drop],
            tag="front",
            note=f"Front wall {wall:.1f} mm + {hook_drop:.0f} mm drop",
        ),
        # The hook tongue — sticks out forward at the bottom.
        step_add(
            "cube",
            dims={"x": hook_in, "y": width, "z": wall},
            position=[(desk_t / 2.0 + wall + hook_in / 2.0), 0.0, -hook_drop + wall / 2.0],
            tag="hook",
            note=f"Hook tongue {hook_in:.0f} mm",
        ),
        step_boolean("union", targets=["all-positives"], note="Fuse hook"),
        step_group("Desk Hook", targets=["all-current"]),
    ]
    return steps


META_DESK_HOOK = {
    "id": "starter_desk_hook",
    "label": "Desk Hook",
    "description": "Clamp-on hook for a desk edge. No drilling — slides over the top.",
    "params": {
        "desk_thickness_mm": {"type": "number", "default": 25.0, "min": 10.0, "max": 60.0,
                              "describe": "Thickness of your desk top (mm)."},
        "width_mm": {"type": "number", "default": 20.0, "min": 10.0, "max": 50.0,
                     "describe": "Hook width along the desk edge (mm)."},
    },
}


# ─── 12. Wall Spacer ───────────────────────────────────────────────
# Stand-off washer: cylinder with a clearance hole.
def _build_wall_spacer(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    od = _f(params, "outer_diameter_mm", 14.0)
    bore = _f(params, "bore_diameter_mm", 4.5)
    height = _f(params, "height_mm", 8.0)

    steps: List[Dict[str, Any]] = [
        step_add(
            "cylinder",
            dims={"r": od / 2.0, "h": height},
            position=[0.0, 0.0, height / 2.0],
            tag="body",
            note=f"Spacer body  ⌀{od:.1f} × {height:.1f} mm",
        ),
        step_add(
            "cylinder",
            modifier="negative",
            dims={"r": bore / 2.0, "h": height + 2.0},
            position=[0.0, 0.0, height / 2.0],
            tag="bore",
            note=f"Through-bore  ⌀{bore:.1f} mm",
        ),
        step_boolean("subtract", targets=["all-current"], note="Drill through-bore"),
        step_group("Wall Spacer", targets=["all-current"]),
    ]
    return steps


META_WALL_SPACER = {
    "id": "starter_wall_spacer",
    "label": "Wall Spacer",
    "description": "Stand-off washer to hang frames or shelves a known distance off a wall.",
    "params": {
        "outer_diameter_mm": {"type": "number", "default": 14.0, "min": 8.0, "max": 30.0,
                              "describe": "Outer diameter (mm)."},
        "bore_diameter_mm": {"type": "number", "default": 4.5, "min": 2.5, "max": 12.0,
                             "describe": "Screw clearance bore (mm)."},
        "height_mm": {"type": "number", "default": 8.0, "min": 3.0, "max": 50.0,
                      "describe": "Stand-off height — the gap from the wall (mm)."},
    },
}


# ─── Registry ──────────────────────────────────────────────────────
# Each starter is exposed as a module-like SimpleNamespace so the
# voice_templates __init__ registry treats it the same way as the
# heavier brackets / enclosures.
STARTER_MODULES = [
    SimpleNamespace(META=META_KEYCHAIN, build=_build_keychain),
    SimpleNamespace(META=META_PHONE_STAND, build=_build_phone_stand),
    SimpleNamespace(META=META_NAME_TAG, build=_build_name_tag),
    SimpleNamespace(META=META_PLANT_MARKER, build=_build_plant_marker),
    SimpleNamespace(META=META_CABLE_CLIP, build=_build_cable_clip),
    SimpleNamespace(META=META_ORGANIZER_TRAY, build=_build_organizer_tray),
    SimpleNamespace(META=META_REPLACEMENT_KNOB, build=_build_replacement_knob),
    SimpleNamespace(META=META_SIMPLE_BRACKET, build=_build_simple_bracket),
    SimpleNamespace(META=META_COOKIE_CUTTER, build=_build_cookie_cutter),
    SimpleNamespace(META=META_TOY_WHEEL, build=_build_toy_wheel),
    SimpleNamespace(META=META_DESK_HOOK, build=_build_desk_hook),
    SimpleNamespace(META=META_WALL_SPACER, build=_build_wall_spacer),
]

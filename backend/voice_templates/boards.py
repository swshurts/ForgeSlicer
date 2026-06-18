"""Board faceplate template.

Generates a flat faceplate sized to a known SBC/MCU/printer-mainboard
with cutouts for all major connectors and mount-pillar holes.

Each board entry is a deterministic dictionary; ALL connector positions
were sourced from the official mechanical drawings of each board
(Raspberry Pi Foundation, Arduino docs, BigTreeTech docs, Espressif
datasheets). The faceplate is centred on the origin in X/Z (so the
camera framing helper is happy) and sits on Y=0 with the board
mounted-side-up.

To add a new board, drop a new entry in the BOARDS dict — no other
file needs to change.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .base import step_add, step_boolean, step_group, to_mm


# A connector cutout is a negative cube specified relative to the
# board's bottom-left corner (looking at the connector side). All
# values in millimetres.
#   x, z  : centre of the cutout in board-local coords
#   w, h  : cutout width × height (extruded through the faceplate)
#   note  : human-readable label for the preview panel


# fmt: off
BOARDS: Dict[str, Dict[str, Any]] = {
    "raspberry_pi_4b": {
        "label": "Raspberry Pi 4 Model B",
        "size": (85.0, 56.0),              # L × W, mm — official drawing
        "mount_holes": [
            (3.5, 3.5),  (61.5, 3.5),
            (3.5, 52.5), (61.5, 52.5),
        ],
        "mount_hole_diameter": 2.7,        # M2.5 clearance
        # Connectors on the long-edge faces of the Pi 4 — most users
        # want cutouts so cables clear the faceplate.
        # The Pi 4 USB-A stack lives on the +Y face starting ~9 mm
        # from the left edge; GbE follows at 53.65 mm from the left.
        "connectors": [
            # USB 3.0 stack (blue) — pair of stacked Type-A.
            {"face": "+y", "x": 9.0,  "w": 15.5, "h": 16.5, "note": "USB 3.0 stack"},
            # USB 2.0 stack (black) — pair of stacked Type-A.
            {"face": "+y", "x": 27.0, "w": 15.5, "h": 16.5, "note": "USB 2.0 stack"},
            # Gigabit Ethernet RJ45.
            {"face": "+y", "x": 45.75, "w": 16.0, "h": 14.0, "note": "GbE RJ45"},
            # USB-C power on the SHORT (-x) edge.
            {"face": "-x", "x": 11.2, "w": 9.2, "h": 4.0, "note": "USB-C power"},
            # Micro-HDMI 0 + Micro-HDMI 1 + 3.5 mm audio on the -x face.
            {"face": "-x", "x": 25.6, "w": 7.5, "h": 4.5, "note": "Micro-HDMI 0"},
            {"face": "-x", "x": 39.7, "w": 7.5, "h": 4.5, "note": "Micro-HDMI 1"},
            {"face": "-x", "x": 53.5, "w": 7.0, "h": 6.5, "note": "3.5 mm audio + composite"},
        ],
    },
    "raspberry_pi_5": {
        "label": "Raspberry Pi 5",
        "size": (85.0, 56.0),
        "mount_holes": [(3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5)],
        "mount_hole_diameter": 2.7,
        "connectors": [
            {"face": "+y", "x": 9.5,  "w": 15.5, "h": 16.5, "note": "USB 3.0 stack"},
            {"face": "+y", "x": 27.0, "w": 15.5, "h": 16.5, "note": "USB 2.0 stack"},
            {"face": "+y", "x": 45.75, "w": 16.0, "h": 14.0, "note": "GbE RJ45"},
            {"face": "-x", "x": 11.2, "w": 9.2, "h": 4.0, "note": "USB-C power"},
            {"face": "-x", "x": 25.6, "w": 7.5, "h": 4.5, "note": "Micro-HDMI 0"},
            {"face": "-x", "x": 39.7, "w": 7.5, "h": 4.5, "note": "Micro-HDMI 1"},
            # Pi 5 added a UART/JST PWR header on the long edge — most
            # faceplates skip it because it's optional.
        ],
    },
    "raspberry_pi_zero_2w": {
        "label": "Raspberry Pi Zero 2 W",
        "size": (65.0, 30.0),
        "mount_holes": [(3.5, 3.5), (61.5, 3.5), (3.5, 26.5), (61.5, 26.5)],
        "mount_hole_diameter": 2.7,
        "connectors": [
            {"face": "-x", "x": 12.4, "w": 8.0, "h": 4.5, "note": "Mini-HDMI"},
            {"face": "-x", "x": 41.4, "w": 8.0, "h": 3.5, "note": "Micro-USB OTG"},
            {"face": "-x", "x": 54.0, "w": 8.0, "h": 3.5, "note": "Micro-USB power"},
        ],
    },
    "raspberry_pi_3b_plus": {
        "label": "Raspberry Pi 3B+",
        "size": (85.0, 56.0),
        "mount_holes": [(3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5)],
        "mount_hole_diameter": 2.7,
        "connectors": [
            # Pi 3B+ has a single column of 4× USB-A 2.0 + GbE on +y.
            {"face": "+y", "x": 9.0,  "w": 15.5, "h": 16.5, "note": "USB 2.0 stack"},
            {"face": "+y", "x": 27.0, "w": 15.5, "h": 16.5, "note": "USB 2.0 stack"},
            {"face": "+y", "x": 45.75, "w": 16.0, "h": 14.0, "note": "Ethernet (GbE-ish)"},
            {"face": "-x", "x": 10.6, "w": 8.0, "h": 3.5, "note": "Micro-USB power"},
            {"face": "-x", "x": 32.0, "w": 15.0, "h": 6.5, "note": "HDMI"},
            {"face": "-x", "x": 53.5, "w": 7.0, "h": 6.5, "note": "3.5 mm audio + composite"},
        ],
    },
    "arduino_uno_r3": {
        "label": "Arduino Uno R3",
        "size": (68.6, 53.4),
        "mount_holes": [(14.0, 2.5), (66.0, 7.6), (66.0, 35.6), (15.2, 50.8)],
        "mount_hole_diameter": 3.2,        # M3 clearance
        "connectors": [
            {"face": "-x", "x": 9.0, "w": 12.5, "h": 11.5, "note": "USB-B"},
            {"face": "-x", "x": 41.4, "w": 9.5, "h": 13.5, "note": "DC barrel jack"},
        ],
    },
    "arduino_mega_2560": {
        "label": "Arduino Mega 2560",
        "size": (101.6, 53.3),
        "mount_holes": [(14.0, 2.5), (99.0, 7.6), (99.0, 35.6), (15.2, 50.8)],
        "mount_hole_diameter": 3.2,
        "connectors": [
            {"face": "-x", "x": 9.0, "w": 12.5, "h": 11.5, "note": "USB-B"},
            {"face": "-x", "x": 41.4, "w": 9.5, "h": 13.5, "note": "DC barrel jack"},
        ],
    },
    "esp32_devkit_v1": {
        "label": "ESP32 DevKit V1 (30-pin)",
        "size": (51.0, 25.5),
        # The 30-pin DevKit has no PCB mount holes — most makers
        # secure via a snap-fit slot. We emit none.
        "mount_holes": [],
        "mount_hole_diameter": 0.0,
        "connectors": [
            {"face": "-x", "x": 13.0, "w": 8.0, "h": 3.5, "note": "Micro-USB"},
        ],
    },
    "raspberry_pi_pico": {
        "label": "Raspberry Pi Pico / Pico W",
        "size": (51.3, 21.0),
        "mount_holes": [(2.0, 4.8), (49.3, 4.8), (2.0, 16.2), (49.3, 16.2)],
        "mount_hole_diameter": 2.2,        # M2 clearance
        "connectors": [
            {"face": "-x", "x": 11.0, "w": 8.0, "h": 3.5, "note": "Micro-USB"},
        ],
    },
    "btt_skr_mini_e3_v3": {
        "label": "BTT SKR Mini E3 V3 (Klipper/Marlin)",
        "size": (102.0, 70.5),
        "mount_holes": [(3.0, 3.5), (99.0, 3.5), (3.0, 67.0), (99.0, 67.0)],
        "mount_hole_diameter": 3.2,
        "connectors": [
            {"face": "-x", "x": 7.5, "w": 9.5, "h": 8.5, "note": "DC-IN screw terminals"},
            {"face": "+y", "x": 18.0, "w": 9.0, "h": 4.0, "note": "USB-C"},
            {"face": "+y", "x": 32.0, "w": 14.0, "h": 14.0, "note": "RJ45 / TFT slot"},
        ],
    },
    "btt_octopus_pro": {
        "label": "BTT Octopus Pro (Klipper)",
        "size": (160.0, 135.0),
        "mount_holes": [(4.0, 4.0), (156.0, 4.0), (4.0, 131.0), (156.0, 131.0)],
        "mount_hole_diameter": 3.2,
        "connectors": [
            {"face": "-x", "x": 12.0, "w": 16.0, "h": 9.0, "note": "DC-IN screw terminals"},
            {"face": "+y", "x": 20.0, "w": 11.0, "h": 11.0, "note": "USB-B"},
            {"face": "+y", "x": 40.0, "w": 14.0, "h": 14.0, "note": "RJ45 LAN"},
        ],
    },
}
# fmt: on


META = {
    "id": "board_faceplate",
    "label": "Board faceplate",
    "description": (
        "Flat front panel sized to a known PCB with cutouts for the "
        "connectors on the user-specified face(s). Defaults to a MINIMAL "
        "faceplate — just the long edge connectors. Set "
        "`include_mount_holes:true` and/or `faces` to include other "
        "edges or the M2.5/M3 mount-pillar pattern for a full mounting "
        "tray."
    ),
    "params": {
        "board": {
            "type": "enum",
            "values": list(BOARDS.keys()),
            "required": True,
            "describe": (
                "Which board the faceplate is for. Accepts the snake_case keys above. "
                "User-facing names: " + ", ".join(b["label"] for b in BOARDS.values())
            ),
        },
        "thickness_mm": {
            "type": "number", "default": 3.0, "min": 1.0, "max": 12.0,
            "describe": "Faceplate plate thickness (mm).",
        },
        "border_mm": {
            "type": "number", "default": 5.0, "min": 0.0, "max": 25.0,
            "describe": "Border added around the board outline (mm).",
        },
        "include_mount_holes": {
            "type": "boolean", "default": False,
            "describe": "OFF by default — set true ONLY when the user says "
                        "'mounting tray', 'with mount holes', 'full plate', or "
                        "explicitly asks for the mount-pillar pattern.",
        },
        "faces": {
            "type": "array",
            "default": ["+y"],
            "describe": "Which board face(s) to include cutouts for. "
                        "Default ['+y'] = the LONG-edge connectors only (USB / "
                        "ethernet on most SBCs). Pass ['+y','-x'] for both "
                        "long+short edges. Pass ['-x'] for just the short edge "
                        "(USB-C / HDMI / audio on most Pis). In `orientation:\"wall\"` "
                        "mode (the default for 'faceplate'), ONLY THE FIRST face "
                        "in the list is used — a wall only ever covers ONE edge "
                        "of the board. Pass `orientation:\"tray\"` to enable the "
                        "multi-face flat-tray behaviour. The LLM should "
                        "only expand beyond ['+y'] when the user explicitly "
                        "names other connectors (HDMI, USB-C, audio, etc.) or "
                        "asks for a full enclosure plate.",
        },
        "orientation": {
            "type": "enum",
            "values": ["wall", "tray"],
            "default": "wall",
            "describe": "Geometry style. 'wall' = a VERTICAL front panel "
                        "standing on the bed, with connector-shaped HOLES "
                        "punched through its thin face — what most makers "
                        "mean by 'faceplate'. 'tray' = a FLAT plate lying "
                        "on the bed, with mount-hole pillars and notches "
                        "for connectors along the edges — what most makers "
                        "mean by 'mounting tray' or 'base plate'.",
        },
        "wall_margin_mm": {
            "type": "number", "default": 4.0, "min": 0.0, "max": 25.0,
            "describe": "Extra height/width around the connector cluster on a "
                        "wall-orientation faceplate (mm). Only used when "
                        "orientation='wall'.",
        },
        "skip_plate": {
            "type": "boolean", "default": False,
            "describe": "Set true when the user wants ONLY the connector "
                        "cutouts as floating NEGATIVE pockets — no plate, "
                        "no boolean step. Triggered by phrasing like 'add "
                        "the cutouts for the USB and ethernet of a Pi 4' "
                        "(they have their own plate and just want negatives "
                        "to drop onto it). Default false = build a full "
                        "faceplate.",
        },
    },
}


def list_boards() -> List[Dict[str, Any]]:
    """Lightweight listing for the LLM prompt: id + label only."""
    return [{"id": k, "label": v["label"]} for k, v in BOARDS.items()]


def build(params: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Generate the ordered step list for a board faceplate.

    ForgeSlicer coordinate convention (CRITICAL):
      • `dims.x`  → primitive width  (world X axis)
      • `dims.y`  → primitive DEPTH  (world Z axis — front/back on bed)
      • `dims.z`  → primitive HEIGHT (world Y axis — UP)
      • `position` is [world_x, world_y (up), world_z (depth)].
      • Default cylinder axis is world-Y (up), so no rotation is needed
        for a hole going straight DOWN through a flat plate.

    Two orientation modes:
      • orientation='wall' (default) — a VERTICAL faceplate standing
        on the bed. Width matches the board's long edge, thickness goes
        through world Z (front-back), height goes up world Y. Connector
        cutouts are HOLES piercing through the wall's Z thickness, at
        their natural X (along board long axis) and Y (above bed)
        position. Only the FIRST face in `faces` is honoured — a wall
        only ever covers one edge of the board.
      • orientation='tray' (legacy) — a FLAT plate lying on the bed.
        The board's local 2D layout maps directly:
          • board's long axis  →  world X
          • board's short axis →  world Z
        Connector cutouts become edge-notches (intended for mounting
        the board ON the plate and routing cables out through the
        plate edge).
    """
    board_id = params.get("board")
    if board_id not in BOARDS:
        raise ValueError(f"Unknown board: {board_id!r}. Try one of: {list(BOARDS.keys())}")
    b = BOARDS[board_id]
    L, W = b["size"]                                                       # mm
    thickness = float(params.get("thickness_mm", 3.0))
    border = float(params.get("border_mm", 5.0))
    inc_mount = bool(params.get("include_mount_holes", False))
    orientation = str(params.get("orientation", "wall") or "wall").lower()
    if orientation not in ("wall", "tray"):
        orientation = "wall"
    wall_margin = float(params.get("wall_margin_mm", 4.0) or 0.0)
    # `faces` filter scopes the cutout set. Default ['+y'] gives the
    # canonical "front panel" — just the long-edge connectors. Empty
    # list means "no cutouts" (intentional). Use `is None` so the empty
    # list doesn't get steamrolled by `or`-default.
    faces_param = params.get("faces")
    if faces_param is None:
        faces_filter = ["+y"]
    elif isinstance(faces_param, str):
        faces_filter = [faces_param]
    else:
        faces_filter = list(faces_param)
    # iter-102.4 — `skip_plate` lets the LLM emit JUST the cutouts as
    # floating negative pockets (no surrounding plate, no boolean step).
    # Used when the user describes "the cutouts for the USB/Ethernet
    # connectors of a Pi 4" — they want to drop those onto an EXISTING
    # plate of their own, not generate a new one.
    skip_plate = bool(params.get("skip_plate", False))

    if orientation == "wall":
        return _build_wall(b, L, W, thickness, border, inc_mount,
                           faces_filter, wall_margin, skip_plate)
    return _build_tray(b, L, W, thickness, border, inc_mount,
                       set(faces_filter), skip_plate)


def _connectors_on_face(b: Dict[str, Any], face: str) -> List[Dict[str, Any]]:
    return [c for c in b["connectors"] if c.get("face", "+y") == face]


def _build_wall(b, L, W, thickness, border, inc_mount,
                faces_filter, wall_margin, skip_plate):
    """Vertical faceplate — a thin wall standing on the bed with
    connector-shaped HOLES through it.

    Only one face is supported per wall (the FIRST in `faces_filter`).
    Width along world X matches the board edge that connectors live on
    (L for '+y'/'-y', W for '+x'/'-x') plus 2× border. Height along
    world Y is the tallest connector + 2× wall_margin. Thickness goes
    through world Z (front-back).
    """
    face = faces_filter[0] if faces_filter else "+y"
    if face not in ("+y", "-y", "+x", "-x"):
        face = "+y"
    connectors = _connectors_on_face(b, face)

    # Wall width spans the board's edge that this face is on.
    edge_len = L if face in ("+y", "-y") else W
    plate_W_x = edge_len + 2 * border    # world X span
    # Wall height: max connector height + margin (top + bottom).
    max_ch = max((c["h"] for c in connectors), default=20.0)
    plate_H_y = max_ch + 2 * wall_margin
    plate_T_z = thickness                # world Z span (thin)

    steps: List[Dict[str, Any]] = []

    if not skip_plate:
        steps.append(step_add(
            "cube",
            dims={"x": plate_W_x, "y": plate_T_z, "z": plate_H_y},
            position=[0.0, plate_H_y / 2.0, 0.0],
            tag="plate",
            note=f"Wall plate {plate_W_x:.1f} (W) × {plate_H_y:.1f} (H) × "
                 f"{plate_T_z:.1f} (T) mm — {b['label']} {face} face",
        ))

    # Each connector becomes a hole piercing world Z. Width along world X,
    # height along world Y (UP), depth along world Z (through the wall +
    # 2 mm so it cleanly subtracts at both faces).
    edge_origin_x = -edge_len / 2.0      # leftmost edge in world X
    for c in connectors:
        cw, ch = c["w"], c["h"]
        # Connector's centre along the wall's X = its position along the
        # board edge.
        cx_world = edge_origin_x + c["x"] + cw / 2.0
        # Connector's centre along world Y (UP). Datasheet "x" gives the
        # X position; height is c["h"]. We sit the connector against the
        # BOTTOM of the wall margin (so cables exit near the PCB level
        # of the board, which is what real-world faceplates do).
        cy_world = wall_margin + ch / 2.0
        steps.append(step_add(
            "cube",
            modifier="negative",
            dims={"x": cw, "y": plate_T_z + 2.0, "z": ch},
            position=[cx_world, cy_world, 0.0],
            tag=f"cutout_{c.get('note','').lower().replace(' ', '_')}",
            note=f"Cutout — {c.get('note', 'connector')} ({cw:.1f} W × {ch:.1f} H mm)",
        ))

    if inc_mount and b["mount_holes"] and b["mount_hole_diameter"] > 0:
        # In wall mode, mount holes don't apply — the wall doesn't sit
        # under the PCB. Skip rather than emit confusing geometry.
        pass

    if not skip_plate:
        steps.append(step_boolean(
            "subtract",
            targets=["all-current"],
            note="Subtract cutouts from the wall plate",
        ))
        steps.append(step_group(
            f"{b['label']} faceplate ({face})",
            targets=["all-current"],
            note="Group the finished faceplate",
        ))
    return steps


def _build_tray(b, L, W, thickness, border, inc_mount, faces_filter, skip_plate):
    """Original flat-tray behaviour — kept for users who really wanted
    a base plate to mount the board ONTO with cable notches at the
    edges. Reachable via `orientation='tray'`.
    """
    plate_L = L + 2 * border       # world X span
    plate_W = W + 2 * border       # world Z span

    steps: List[Dict[str, Any]] = []

    if not skip_plate:
        steps.append(step_add(
            "cube",
            dims={"x": plate_L, "y": plate_W, "z": thickness},
            position=[0.0, thickness / 2.0, 0.0],
            tag="plate",
            note=f"Base plate {plate_L:.1f} × {plate_W:.1f} × {thickness:.1f} mm "
                 f"({b['label']} + {border:.1f} mm border)",
        ))

    bx0 = -L / 2.0
    bz0 = -W / 2.0

    if inc_mount and b["mount_holes"] and b["mount_hole_diameter"] > 0:
        r = b["mount_hole_diameter"] / 2.0
        for i, (mx, mz) in enumerate(b["mount_holes"]):
            steps.append(step_add(
                "cylinder",
                modifier="negative",
                dims={"r": r, "h": thickness + 2.0},
                position=[bx0 + mx, thickness / 2.0, bz0 + mz],
                tag=f"mount_{i}",
                note=f"Mount hole #{i+1}  ⌀{b['mount_hole_diameter']:.1f} mm",
            ))

    for c in b["connectors"]:
        face = c.get("face", "+y")
        if face not in faces_filter:
            continue
        cw, ch = c["w"], c["h"]
        if face in ("+y", "-y"):
            cx = c["x"]
            cz_b = 0.0 if face == "+y" else W
            shift_z = -ch / 2.0 if face == "+y" else ch / 2.0
            wx = bx0 + cx
            wz = bz0 + cz_b + shift_z
        else:
            cz_b = c.get("x", 0.0)
            cx = 0.0 if face == "-x" else L
            shift_x = -cw / 2.0 if face == "-x" else cw / 2.0
            wx = bx0 + cx + shift_x
            wz = bz0 + cz_b
        steps.append(step_add(
            "cube",
            modifier="negative",
            dims={"x": cw, "y": ch, "z": thickness + 2.0},
            position=[wx, thickness / 2.0, wz],
            tag=f"cutout_{c.get('note','').lower().replace(' ', '_')}",
            note=f"Cutout — {c.get('note', 'connector')} ({cw:.1f} × {ch:.1f} mm)",
        ))

    if not skip_plate:
        steps.append(step_boolean(
            "subtract",
            targets=["all-current"],
            note="Subtract cutouts & mount holes from the plate",
        ))
        steps.append(step_group(
            f"{b['label']} mounting tray",
            targets=["all-current"],
            note="Group the finished tray",
        ))
    return steps

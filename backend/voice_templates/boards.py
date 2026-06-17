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
                        "(USB-C / HDMI / audio on most Pis). The LLM should "
                        "only expand beyond ['+y'] when the user explicitly "
                        "names other connectors (HDMI, USB-C, audio, etc.) or "
                        "asks for a full enclosure plate.",
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

    The plate lies flat on the bed in the world X-Z plane, with its
    thickness going up along Y. The board's local 2D layout (the
    rectangle the connectors live on) maps:
      • board's long axis  →  world X
      • board's short axis →  world Z
    """
    board_id = params.get("board")
    if board_id not in BOARDS:
        raise ValueError(f"Unknown board: {board_id!r}. Try one of: {list(BOARDS.keys())}")
    b = BOARDS[board_id]
    L, W = b["size"]                                                       # mm
    thickness = float(params.get("thickness_mm", 3.0))
    border = float(params.get("border_mm", 5.0))
    inc_mount = bool(params.get("include_mount_holes", False))
    # `faces` filter scopes the cutout set. Default ['+y'] gives the
    # canonical "front panel" — just the long-edge connectors. Empty
    # list means "no cutouts" (intentional). Use `is None` so the empty
    # list doesn't get steamrolled by `or`-default.
    faces_param = params.get("faces")
    if faces_param is None:
        faces_filter = {"+y"}
    elif isinstance(faces_param, str):
        faces_filter = {faces_param}
    else:
        faces_filter = set(faces_param)
    # iter-102.4 — `skip_plate` lets the LLM emit JUST the cutouts as
    # floating negative pockets (no surrounding plate, no boolean step).
    # Used when the user describes "the cutouts for the USB/Ethernet
    # connectors of a Pi 4" — they want to drop those onto an EXISTING
    # plate of their own, not generate a new one.
    skip_plate = bool(params.get("skip_plate", False))

    plate_L = L + 2 * border       # world X span
    plate_W = W + 2 * border       # world Z span

    steps: List[Dict[str, Any]] = []

    # Step 1: the base plate. `dims.z` is the THICKNESS (up axis).
    # Position Y = thickness / 2 places the bottom on the bed. Skipped
    # entirely when `skip_plate` is set — the user wants raw negatives
    # to apply to their own scene geometry.
    if not skip_plate:
        steps.append(step_add(
            "cube",
            dims={"x": plate_L, "y": plate_W, "z": thickness},
            position=[0.0, thickness / 2.0, 0.0],
            tag="plate",
            note=f"Base plate {plate_L:.1f} × {plate_W:.1f} × {thickness:.1f} mm "
                 f"({b['label']} + {border:.1f} mm border)",
        ))

    # Board-local (mx, mz) corner is at world (-L/2, -W/2) on the plate.
    bx0 = -L / 2.0
    bz0 = -W / 2.0

    # Step group 2: mount holes (negative cylinders piercing through Y).
    # Default cylinder axis is world Y, so no rotation. Height = plate +
    # 2 mm so the hole pokes cleanly through.
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

    # Step group 3: connector cutouts (negative cubes piercing through Y).
    # The cutout is positioned at the BOARD EDGE the connector exits
    # from, then shifted OUTWARD by half its own dim so it sits flush
    # with the PLATE's outer edge (a centred-on-edge cutout would leave
    # half a slot in the border and look "inset"). For long-edge
    # connectors we shift along world Z; for short-edge connectors we
    # shift along world X.
    if inc_conn := True:
        for c in b["connectors"]:
            face = c.get("face", "+y")
            # iter-101.3 — skip connectors on faces the user didn't ask for.
            if face not in faces_filter:
                continue
            cw, ch = c["w"], c["h"]
            if face in ("+y", "-y"):
                # Connector lives on a LONG edge.
                cx = c["x"]                                          # along board long axis
                cz_b = 0.0 if face == "+y" else W                    # at top or bottom of W
                # Shift along world Z so cutout is flush with plate edge.
                shift_z = -ch / 2.0 if face == "+y" else ch / 2.0
                wx = bx0 + cx
                wz = bz0 + cz_b + shift_z
            else:
                # Connector on a SHORT edge.
                cz_b = c.get("x", 0.0)                               # along board short axis
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

    # Step final: boolean-subtract all negatives from the plate (one
    # positive + many negatives means a single fold-left subtract is
    # exactly right), then group the result. Skipped when there's no
    # plate to subtract from.
    if not skip_plate:
        steps.append(step_boolean(
            "subtract",
            targets=["all-current"],
            note="Subtract cutouts & mount holes from the plate",
        ))
        steps.append(step_group(
            f"{b['label']} faceplate",
            targets=["all-current"],
            note="Group the finished faceplate",
        ))
    return steps

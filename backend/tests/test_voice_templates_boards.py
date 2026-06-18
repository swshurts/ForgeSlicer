"""Regression tests for voice_templates.boards.

Locks down the two behaviours the user has stumbled into during normal
voice use:
    1. "Create a faceplate for a RPI4" must produce a VERTICAL wall (not
       a flat tray with edge notches). Iter-103.1 fixed this by adding
       an `orientation` param that defaults to 'wall'.
    2. The legacy flat-tray output is still reachable via
       `orientation: 'tray'` for users who really want a mounting tray.
"""
from __future__ import annotations

import pytest

from voice_templates import expand


def _by_op(steps, op):
    return [s for s in steps if s.get("op") == op]


def _adds(steps):
    return [s for s in steps if s.get("op") in (None, "add") and s.get("type")]


# ── Wall mode (the new default) ─────────────────────────────────────


def test_pi4_default_is_wall_orientation():
    steps = expand("board_faceplate", {"board": "raspberry_pi_4b"})
    adds = _adds(steps)
    plate = adds[0]
    # The plate stands UP: thin Z (thickness through front-back),
    # tall Y (height), wide X.
    d = plate["dims"]
    assert d["x"] > d["y"], "wall plate should be wider than it is thick"
    assert d["z"] > d["y"], "wall plate should be taller than it is thick"
    # Plate centred on the bed in Y at half its height (sits on Y=0).
    assert plate["position"][1] == pytest.approx(d["z"] / 2.0)


def test_pi4_wall_cutouts_pierce_through_thickness():
    steps = expand("board_faceplate", {"board": "raspberry_pi_4b"})
    negs = [s for s in _adds(steps) if s.get("modifier") == "negative"]
    # 3 default-face (+y) connectors → 3 cutouts.
    assert len(negs) == 3
    plate = _adds(steps)[0]
    plate_thickness = plate["dims"]["y"]
    for cut in negs:
        # The cutout's depth (dims.y) must be slightly larger than the
        # plate's thickness so the subtract cleans through both faces.
        assert cut["dims"]["y"] > plate_thickness
        # The cutout's WIDTH and HEIGHT must each be smaller than the
        # plate's width and height (it has to fit through the wall).
        assert cut["dims"]["x"] < plate["dims"]["x"]
        assert cut["dims"]["z"] < plate["dims"]["z"]
        # The cutout sits centred at Z=0 (same plane as the wall).
        assert cut["position"][2] == pytest.approx(0.0)


def test_pi4_wall_cutout_y_position_above_bed():
    """Each cutout should be entirely above the bed (Y > 0) so it doesn't
    cut into the floor when the wall is dropped onto the printer plate."""
    steps = expand("board_faceplate", {"board": "raspberry_pi_4b"})
    negs = [s for s in _adds(steps) if s.get("modifier") == "negative"]
    for cut in negs:
        cy = cut["position"][1]
        ch = cut["dims"]["z"]
        # Bottom of the cutout (in world Y).
        bottom = cy - ch / 2.0
        assert bottom >= 0.0, f"cutout bottom {bottom} dips below bed"


def test_pi4_wall_width_matches_long_edge_plus_border():
    """Default face is +y, so wall width should be L (85) + 2*border (5)."""
    steps = expand("board_faceplate", {"board": "raspberry_pi_4b", "border_mm": 5.0})
    plate = _adds(steps)[0]
    assert plate["dims"]["x"] == pytest.approx(85.0 + 10.0)


# ── Tray mode (legacy) ──────────────────────────────────────────────


def test_pi4_tray_orientation_lies_flat():
    steps = expand("board_faceplate", {"board": "raspberry_pi_4b", "orientation": "tray"})
    plate = _adds(steps)[0]
    d = plate["dims"]
    # Tray: thin in Y (thickness UP), wide in X, deep in Z.
    assert d["z"] < d["x"] and d["z"] < d["y"]
    assert plate["position"][1] == pytest.approx(d["z"] / 2.0)


def test_pi4_tray_mount_holes_when_requested():
    steps = expand("board_faceplate", {
        "board": "raspberry_pi_4b",
        "orientation": "tray",
        "include_mount_holes": True,
    })
    cyls = [s for s in _adds(steps) if s.get("type") == "cylinder"]
    assert len(cyls) == 4, "Pi 4 has 4 mount holes"


# ── Misc behaviour preserved across orientations ────────────────────


def test_skip_plate_emits_only_negatives():
    """`skip_plate` works the same in both orientations — emits cutouts
    only, no plate, no boolean step."""
    for orientation in ("wall", "tray"):
        steps = expand("board_faceplate", {
            "board": "raspberry_pi_4b",
            "orientation": orientation,
            "skip_plate": True,
        })
        # No plate.
        assert all(s.get("modifier") != "positive" for s in _adds(steps))
        # No subtract / group steps.
        assert not _by_op(steps, "subtract")


def test_wall_only_uses_first_face():
    """Wall mode is constrained to a single face — passing ['+y','-x']
    should NOT produce cutouts for the -x connectors (those have
    different Y coordinates that don't make sense on the same wall)."""
    steps = expand("board_faceplate", {
        "board": "raspberry_pi_4b",
        "faces": ["+y", "-x"],
    })
    negs = [s for s in _adds(steps) if s.get("modifier") == "negative"]
    # Only the 3 connectors on the +y face are honoured.
    assert len(negs) == 3

"""Test the voice template registry + builders."""
import math

import pytest

from voice_templates import TEMPLATES, expand, list_templates, prompt_descriptions
from voice_templates.base import kg_from, to_mm


# ---------------- unit helpers ----------------

def test_to_mm_handles_inches_and_feet():
    assert math.isclose(to_mm(1, "in"), 25.4, rel_tol=1e-6)
    assert math.isclose(to_mm(2, "inches"), 50.8, rel_tol=1e-6)
    assert math.isclose(to_mm(1, "ft"), 304.8, rel_tol=1e-6)


def test_kg_from_handles_lbs_and_oz():
    assert math.isclose(kg_from(1, "lb"), 0.4535924, rel_tol=1e-6)
    assert math.isclose(kg_from(16, "oz"), 0.4535923, rel_tol=1e-3)


def test_to_mm_rejects_garbage_unit():
    with pytest.raises(ValueError):
        to_mm(1, "furlong")


# ---------------- registry ----------------

def test_registry_lists_both_templates():
    ids = {t["id"] for t in list_templates()}
    assert {"board_faceplate", "right_angle_bracket"} <= ids


def test_prompt_descriptions_includes_every_template():
    s = prompt_descriptions()
    assert "board_faceplate" in s
    assert "right_angle_bracket" in s
    # Mentions the board catalogue ids
    assert "raspberry_pi_4b" in s


# ---------------- board faceplate ----------------

def test_board_faceplate_pi4_expands_to_plate_holes_cutouts_and_subtract():
    steps = expand("board_faceplate", {"board": "raspberry_pi_4b"})
    # Plate + 4 mount holes + N connector cutouts + 1 boolean + 1 group.
    actions = [s["action"] for s in steps]
    assert actions[0] == "add"
    assert steps[0]["tag"] == "plate"
    # Last two steps are boolean + group.
    assert actions[-2] == "boolean"
    assert actions[-1] == "group"
    # At least 4 mount holes + several connector cutouts.
    negatives = [s for s in steps if s.get("action") == "add" and s.get("modifier") == "negative"]
    assert len(negatives) >= 4 + 5  # mount holes + key Pi 4 connectors


def test_board_faceplate_unknown_board_raises():
    with pytest.raises(ValueError):
        expand("board_faceplate", {"board": "totally_fake_board"})


def test_board_faceplate_can_disable_mount_holes_and_cutouts():
    steps = expand("board_faceplate", {
        "board": "raspberry_pi_4b",
        "include_mount_holes": False,
        "include_connector_cutouts": False,
    })
    # Plate + boolean + group only (no negatives).
    negatives = [s for s in steps if s.get("action") == "add" and s.get("modifier") == "negative"]
    assert negatives == []


def test_board_faceplate_thickness_and_border_affect_plate_dims():
    steps = expand("board_faceplate", {
        "board": "raspberry_pi_4b",
        "thickness_mm": 4.0,
        "border_mm": 8.0,
    })
    plate = steps[0]
    assert math.isclose(plate["dims"]["y"], 4.0)
    # Pi 4B is 85 × 56; +2 × 8 = 101 × 72 plate.
    assert math.isclose(plate["dims"]["x"], 101.0)
    assert math.isclose(plate["dims"]["z"], 72.0)


# ---------------- right-angle bracket ----------------

def test_bracket_imperial_inputs_convert_to_mm():
    """6 inch deep, 1 inch thick shelf, 30 lb load — the user's
    actual phrasing from the iter-100.9 prompt."""
    steps = expand("right_angle_bracket", {
        "shelf_depth_in": 6,
        "shelf_thickness_in": 1,
        "load_lb": 30,
    })
    # depth is 6 in = 152.4 mm — wall arm height + shelf arm length
    # should both reflect that.
    wall = next(s for s in steps if s.get("tag") == "wall_arm")
    shelf = next(s for s in steps if s.get("tag") == "shelf_arm")
    assert math.isclose(wall["dims"]["y"], 152.4, rel_tol=1e-3)
    assert math.isclose(shelf["dims"]["x"], 152.4, rel_tol=1e-3)
    # Plate thickness should land in the 5–10 mm band for this load.
    plate_t = wall["dims"]["x"]
    assert 4.5 <= plate_t <= 10.0, f"plate_t={plate_t}"


def test_bracket_includes_gusset_and_screw_holes():
    steps = expand("right_angle_bracket", {
        "shelf_depth_mm": 150,
        "shelf_thickness_mm": 18,
        "load_kg": 10,
    })
    tags = {s.get("tag") for s in steps if s.get("tag")}
    assert "gusset" in tags
    # Two wall-side + two shelf-side screw holes minimum.
    wall_holes = [t for t in tags if t.startswith("wall_hole_")]
    shelf_holes = [t for t in tags if t.startswith("shelf_hole_")]
    assert len(wall_holes) >= 2
    assert len(shelf_holes) >= 2
    # Boolean(s) + group end the list.
    actions = [s["action"] for s in steps]
    # Bracket template emits TWO booleans (union positives, subtract negs)
    # to get the CSG sequence right with mixed modifiers.
    assert actions[-1] == "group"
    assert "boolean" in actions[-3:]


def test_bracket_plate_thickness_scales_with_load_and_depth():
    """Heavier load + longer shelf must produce a thicker plate."""
    light = expand("right_angle_bracket", {"shelf_depth_mm": 100, "load_kg": 5})
    heavy = expand("right_angle_bracket", {"shelf_depth_mm": 250, "load_kg": 50})
    light_t = next(s for s in light if s.get("tag") == "wall_arm")["dims"]["x"]
    heavy_t = next(s for s in heavy if s.get("tag") == "wall_arm")["dims"]["x"]
    assert heavy_t > light_t + 2.0


def test_bracket_material_petg_is_thinner_than_abs():
    """PETG factor < ABS factor — same load should give a slightly
    thinner PETG plate than ABS at the same depth."""
    petg = expand("right_angle_bracket", {"shelf_depth_mm": 200, "load_kg": 20, "material": "PETG"})
    abs_ = expand("right_angle_bracket", {"shelf_depth_mm": 200, "load_kg": 20, "material": "ABS"})
    petg_t = next(s for s in petg if s.get("tag") == "wall_arm")["dims"]["x"]
    abs_t = next(s for s in abs_ if s.get("tag") == "wall_arm")["dims"]["x"]
    assert abs_t >= petg_t


def test_bracket_default_load_when_omitted():
    """If the user doesn't state a load, build should still succeed
    with a sensible default."""
    steps = expand("right_angle_bracket", {"shelf_depth_mm": 100})
    assert steps  # non-empty
    wall = next(s for s in steps if s.get("tag") == "wall_arm")
    # Default load 5 kg + depth 100 mm → plate_t around 5 mm.
    assert 3.5 <= wall["dims"]["x"] <= 7.0

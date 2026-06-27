"""Backend tests for the 12 beginner starter templates.

Verifies POST /api/voice/expand-template returns non-empty steps for
each starter_* template id used by the BeginnerStarters landing block.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")
ENDPOINT = f"{BASE_URL}/api/voice/expand-template"

STARTER_IDS = [
    "starter_keychain",
    "starter_phone_stand",
    "starter_name_tag",
    "starter_plant_marker",
    "starter_cable_clip",
    "starter_organizer_tray",
    "starter_replacement_knob",
    "starter_simple_bracket",
    "starter_cookie_cutter",
    "starter_toy_wheel",
    "starter_desk_hook",
    "starter_wall_spacer",
]


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.mark.parametrize("template_id", STARTER_IDS)
def test_expand_template_starter(api, template_id):
    """Each starter id expands to a non-empty steps list."""
    r = api.post(ENDPOINT, json={"template_id": template_id, "params": {}}, timeout=30)
    assert r.status_code == 200, f"{template_id} -> {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "steps" in data, f"{template_id}: missing 'steps' in response: {data}"
    assert isinstance(data["steps"], list), f"{template_id}: steps not a list"
    assert len(data["steps"]) > 0, f"{template_id}: empty steps list"
    # Verify each step has an action (the step schema uses "action": "add"/"boolean"/...)
    for step in data["steps"]:
        assert isinstance(step, dict), f"{template_id}: step not dict: {step}"
        assert "action" in step, f"{template_id}: step missing action: {step}"


def test_expand_template_unknown_id(api):
    """Unknown template id should error (not silently return empty)."""
    r = api.post(ENDPOINT, json={"template_id": "starter_does_not_exist", "params": {}}, timeout=15)
    assert r.status_code in (400, 404, 422, 500), f"unknown id returned {r.status_code}"

"""Backend tests for ForgeSlicer voice command endpoint + regression sanity
checks for /api/gallery, /api/components, /api/printers.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # fall back to reading /app/frontend/.env directly so this works headless
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
            break
BASE_URL = (BASE_URL or "").rstrip("/")


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _post_voice(api, transcript):
    return api.post(f"{BASE_URL}/api/voice/command", json={"transcript": transcript}, timeout=60)


# ---------- Voice command tests ----------
class TestVoiceCommand:
    def test_add_cube_with_dims(self, api):
        r = _post_voice(api, "add a cube to the drawing that has the following dimensions: x=252mm, y=6mm, and z=44mm")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["action"] == "add"
        raw = d["raw"]
        assert raw.get("type") == "cube"
        assert raw.get("modifier", "positive") == "positive"
        dims = raw.get("dims", {})
        assert dims.get("x") == 252
        assert dims.get("y") == 6
        assert dims.get("z") == 44

    def test_translate_right(self, api):
        r = _post_voice(api, "move selected 10 millimeters to the right")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["action"] == "translate"
        assert d["raw"].get("delta", {}).get("x") == 10

    def test_rotate_y(self, api):
        r = _post_voice(api, "rotate 90 degrees on Y")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["action"] == "rotate"
        assert d["raw"].get("delta", {}).get("y") == 90

    def test_boolean_subtract(self, api):
        r = _post_voice(api, "subtract")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["action"] == "boolean"
        assert d["raw"].get("op") == "subtract"

    def test_delete(self, api):
        r = _post_voice(api, "delete it")
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "delete"

    def test_export_stl(self, api):
        r = _post_voice(api, "export STL")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["action"] == "export"
        assert (d["raw"].get("format") or "").lower() == "stl"

    def test_save_component_dialog(self, api):
        r = _post_voice(api, "save as component")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["action"] == "open"
        assert d["raw"].get("dialog") == "save_component"

    def test_nonsense_returns_unknown_not_500(self, api):
        r = _post_voice(api, "purple monkey dishwasher")
        assert r.status_code == 200, r.text
        assert r.json()["action"] == "unknown"

    def test_empty_transcript_returns_400(self, api):
        r = api.post(f"{BASE_URL}/api/voice/command", json={"transcript": ""}, timeout=30)
        assert r.status_code == 400, r.text


# ---------- Regression sanity ----------
class TestRegression:
    def test_gallery_list(self, api):
        r = api.get(f"{BASE_URL}/api/gallery", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_components_list(self, api):
        r = api.get(f"{BASE_URL}/api/components", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_printers_list(self, api):
        r = api.get(f"{BASE_URL}/api/printers", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_root_ok(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=20)
        assert r.status_code == 200
        assert "ForgeSlicer" in r.json().get("message", "")

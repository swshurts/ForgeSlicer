"""
Smoke tests for the OrcaSlicer engine endpoints.

We don't actually slice anything here — the real CLI takes ~10s on a
20mm cube and would make the test suite slow + flaky if Orca isn't yet
installed (steady-state during development). Instead we verify the
request/response contract:

  • status endpoint ALWAYS returns 200 with a sensible payload
  • slice endpoint returns 503 with a clear message when the engine
    is missing, so the UI can fall back to the built-in slicer
"""

import base64
import os

import requests


BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def test_orca_status_returns_well_formed_payload():
    r = requests.get(f"{API}/slice/orca/status", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # Required keys present regardless of whether Orca is installed.
    for key in ("installed", "arch", "source", "build_in_progress"):
        assert key in data, f"missing key: {key}"
    assert isinstance(data["installed"], bool)
    assert isinstance(data["arch"], str) and data["arch"]
    # Status is informational, never throws — even on missing install we
    # get a 200 with a `detail` string the UI can show.
    if not data["installed"]:
        assert data.get("detail"), "status should explain why the engine isn't available"


def test_orca_slice_returns_503_when_engine_missing():
    """While OrcaSlicer isn't compiled yet (the steady state during
    feature development) the slice endpoint should hand back a clean
    HTTP 503 with a message the frontend can show. Once Orca lands,
    this test changes meaning — it'll only run when the engine is
    actually missing on this host. We skip it conditionally so a
    successful production install doesn't make CI red."""
    status = requests.get(f"{API}/slice/orca/status", timeout=15).json()
    if status.get("installed"):
        # Production / dev env where the engine is already installed — we
        # don't try to slice in this test (too slow); see the integration
        # test for that.
        return
    payload = {
        "stl_base64": base64.b64encode(b"fake stl bytes").decode(),
        "printer_profile": {},
        "process_profile": {},
        "filament_profile": {},
    }
    r = requests.post(f"{API}/slice/orca/slice", json=payload, timeout=15)
    assert r.status_code == 503, r.text
    detail = r.json().get("detail", "")
    assert "not installed" in detail.lower() or "orca" in detail.lower()

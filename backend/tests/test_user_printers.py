"""
Integration tests for the per-user custom printers feature (iter-72).

Tests hit the live running backend over HTTP (same pattern as
test_local_auth.py / test_orca_arm64_slice.py) — that avoids the
motor/asyncio event-loop issues that bite TestClient when the
ASGI app already has a Mongo connection bound to a different loop.

Covers:
  - `build_profile_from_user_printer` helper produces the expected
    minimal-printer-profile shape (unit, no HTTP).
  - CRUD endpoints under /api/me/printers (auth required).
  - Field-level validation (gcode_flavor whitelist, build-vol bounds).
  - The slice endpoint accepts `user_printer_id` and produces 202 on
    happy path, 404 for unknown / not-owned, 401 anonymous.
"""

import os
import secrets
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routes.user_printers import build_profile_from_user_printer  # noqa: E402


BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- Unit tests for the profile-builder helper ----------

def test_build_profile_from_user_printer_shape():
    """The helper must emit the same keys frontend's PRINTER_PROFILES
    table uses, so the existing slice path handles it without
    special cases."""
    doc = {
        "name": "SV06 Plus Ace",
        "printer_model": "Sovol SV06 Plus Ace",
        "nozzle_diameter": 0.4,
        "build_x_mm": 300, "build_y_mm": 300, "build_z_mm": 340,
        "gcode_flavor": "klipper",
        "max_speed_x": 500, "max_speed_y": 500,
        "max_speed_z": 12, "max_speed_e": 60,
        "retraction_length": 0.8, "retraction_speed": 40,
        "start_gcode": "G28", "end_gcode": "M84",
    }
    out = build_profile_from_user_printer(doc)
    assert out["printer_model"] == "Sovol SV06 Plus Ace"
    assert out["nozzle_diameter"] == [0.4]
    assert out["printable_area"] == ["0x0", "300x0", "300x300", "0x300"]
    assert out["printable_height"] == 340
    assert out["gcode_flavor"] == "klipper"
    assert out["machine_max_speed_x"] == [500]
    assert out["retraction_length"] == [0.8]
    assert out["machine_start_gcode"] == "G28"
    assert out["machine_end_gcode"] == "M84"


def test_build_profile_falls_back_to_name_when_model_missing():
    """`printer_model` is optional; helper should fall back to `name`."""
    doc = {
        "name": "Custom Klipper",
        "nozzle_diameter": 0.6,
        "build_x_mm": 200, "build_y_mm": 200, "build_z_mm": 200,
        "gcode_flavor": "klipper",
    }
    out = build_profile_from_user_printer(doc)
    assert out["printer_model"] == "Custom Klipper"
    assert out["printer_variant"] == "0.6"


# ---------- HTTP integration tests ----------

@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture()
def authed_session(db):
    """Mint a fresh user + session row directly in Mongo (sync pymongo,
    no event-loop conflict) and return a requests.Session pre-loaded
    with the session cookie."""
    user_id = f"test_up_user_{uuid.uuid4().hex[:8]}"
    session_token = f"test_up_st_{secrets.token_urlsafe(16)}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@test.example.com",
        "name": "User Printers Test",
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (now + timedelta(days=1)).isoformat(),
        "created_at": now.isoformat(),
    })
    sess = requests.Session()
    sess.cookies.set("session_token", session_token, domain=BASE_URL.split("//", 1)[-1].split("/")[0])
    yield sess, user_id
    # Cleanup
    db.users.delete_one({"user_id": user_id})
    db.user_sessions.delete_one({"session_token": session_token})
    db.user_printers.delete_many({"user_id": user_id})


def _valid_payload(name="My Printer"):
    return {
        "name": name,
        "printer_model": "Custom Klipper",
        "nozzle_diameter": 0.4,
        "build_x_mm": 300, "build_y_mm": 300, "build_z_mm": 340,
        "gcode_flavor": "klipper",
        "max_speed_x": 500, "max_speed_y": 500,
        "max_speed_z": 12, "max_speed_e": 60,
        "retraction_length": 0.8, "retraction_speed": 40,
        "start_gcode": "", "end_gcode": "", "notes": "",
    }


def test_list_requires_auth():
    r = requests.get(f"{API}/me/printers", timeout=10)
    assert r.status_code == 401, r.text


def test_create_and_list(authed_session):
    sess, _ = authed_session
    # Empty list initially
    r = sess.get(f"{API}/me/printers", timeout=10)
    assert r.status_code == 200, r.text
    assert r.json() == []
    # Create one
    r = sess.post(f"{API}/me/printers", json=_valid_payload("SV06 Plus Ace"), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "SV06 Plus Ace"
    assert body["printer_id"]
    assert body["created_at"]
    pid = body["printer_id"]
    # List shows it
    r = sess.get(f"{API}/me/printers", timeout=10)
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["printer_id"] == pid


def test_get_404_for_unknown_printer(authed_session):
    sess, _ = authed_session
    r = sess.get(f"{API}/me/printers/{uuid.uuid4()}", timeout=10)
    assert r.status_code == 404


def test_update_and_delete(authed_session):
    sess, _ = authed_session
    r = sess.post(f"{API}/me/printers", json=_valid_payload("X"), timeout=10)
    pid = r.json()["printer_id"]
    new_payload = _valid_payload("X v2")
    new_payload["nozzle_diameter"] = 0.6
    r = sess.put(f"{API}/me/printers/{pid}", json=new_payload, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "X v2"
    assert r.json()["nozzle_diameter"] == 0.6
    r = sess.delete(f"{API}/me/printers/{pid}", timeout=10)
    assert r.status_code == 200
    assert r.json()["deleted"] == 1
    r = sess.get(f"{API}/me/printers/{pid}", timeout=10)
    assert r.status_code == 404


def test_validation_bounds(authed_session):
    """Tight numeric bounds — typos and malicious payloads shouldn't
    poison a slice."""
    sess, _ = authed_session
    payload = _valid_payload()
    payload["build_x_mm"] = 99999   # > 1000 cap
    r = sess.post(f"{API}/me/printers", json=payload, timeout=10)
    assert r.status_code == 422


def test_invalid_gcode_flavor_rejected(authed_session):
    sess, _ = authed_session
    payload = _valid_payload()
    payload["gcode_flavor"] = "nonexistent"
    r = sess.post(f"{API}/me/printers", json=payload, timeout=10)
    assert r.status_code == 400
    assert "gcode_flavor" in r.json()["detail"]


def test_slice_unknown_user_printer_returns_404(authed_session):
    """Unknown `user_printer_id` → synchronous 404, not deferred."""
    sess, _ = authed_session
    # Probe the engine status first — if Orca isn't installed on this
    # host the slice endpoint short-circuits with 503 before the
    # user-printer resolver runs, which would mask the test intent.
    status = requests.get(f"{API}/slice/orca/status", timeout=10).json()
    if not status.get("installed"):
        pytest.skip("OrcaSlicer not installed on this host; resolver path not reachable.")
    import base64
    payload = {
        "stl_base64": base64.b64encode(b"fake").decode(),
        "user_printer_id": str(uuid.uuid4()),
        "printer_profile": {}, "process_profile": {}, "filament_profile": {},
    }
    r = sess.post(f"{API}/slice/orca/slice", json=payload, timeout=15)
    assert r.status_code == 404, r.text
    assert "Custom printer" in r.json()["detail"]


def test_slice_user_printer_requires_auth():
    """Anonymous slice with `user_printer_id` → 401."""
    status = requests.get(f"{API}/slice/orca/status", timeout=10).json()
    if not status.get("installed"):
        pytest.skip("OrcaSlicer not installed on this host.")
    import base64
    payload = {
        "stl_base64": base64.b64encode(b"fake").decode(),
        "user_printer_id": str(uuid.uuid4()),
        "printer_profile": {}, "process_profile": {}, "filament_profile": {},
    }
    r = requests.post(f"{API}/slice/orca/slice", json=payload, timeout=15)
    assert r.status_code == 401, r.text
    assert "sign-in" in r.json()["detail"].lower()


def test_slice_with_owned_user_printer_returns_202(authed_session):
    """Happy path — owned `user_printer_id` resolves, slice spawns
    as a background task, POST returns 202."""
    sess, _ = authed_session
    status = requests.get(f"{API}/slice/orca/status", timeout=10).json()
    if not status.get("installed"):
        pytest.skip("OrcaSlicer not installed on this host.")
    r = sess.post(f"{API}/me/printers", json=_valid_payload("Slice Test"), timeout=10)
    pid = r.json()["printer_id"]
    import base64
    payload = {
        "stl_base64": base64.b64encode(b"fake").decode(),
        "user_printer_id": pid,
        "process_profile": {}, "filament_profile": {},
    }
    r = sess.post(f"{API}/slice/orca/slice", json=payload, timeout=15)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "accepted"
    assert body["engine"] == "orca"

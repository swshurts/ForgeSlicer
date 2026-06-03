"""Iter-83: Shared Profile Library integration tests.

Verifies the publish → browse → clone → unpublish lifecycle works
end-to-end over HTTP, plus the unauth-friendly browse path and
clone counter increments.

Test scaffolding mirrors test_user_printers.py (which is the closest
relative — same auth + collection + cleanup pattern).
"""
import os
import secrets
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


def _make_session(db, label: str = ""):
    """Create a fresh user + session row and return (Session, user_id)."""
    user_id = f"test_sp_{label}_{uuid.uuid4().hex[:8]}"
    token = f"test_sp_st_{secrets.token_urlsafe(16)}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@test.example.com",
        "name": f"SP Test {label}",
        "display_name": f"Shared {label}",
        "created_at": now.isoformat(),
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": (now + timedelta(days=1)).isoformat(),
        "created_at": now.isoformat(),
    })
    sess = requests.Session()
    sess.cookies.set("session_token", token, domain=BASE_URL.split("//", 1)[-1].split("/")[0])
    return sess, user_id


@pytest.fixture()
def author(db):
    sess, uid = _make_session(db, "author")
    yield sess, uid
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.user_printers.delete_many({"user_id": uid})


@pytest.fixture()
def consumer(db):
    sess, uid = _make_session(db, "consumer")
    yield sess, uid
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.user_printers.delete_many({"user_id": uid})


def _valid_payload(name="SV06 Plus Ace"):
    return {
        "name": name,
        "printer_model": "Sovol SV06 Plus Ace",
        "nozzle_diameter": 0.4,
        "build_x_mm": 300, "build_y_mm": 300, "build_z_mm": 340,
        "gcode_flavor": "klipper",
        "max_speed_x": 500, "max_speed_y": 500,
        "max_speed_z": 12, "max_speed_e": 60,
        "retraction_length": 0.8, "retraction_speed": 40,
        "start_gcode": "START_PRINT",
        "end_gcode":   "END_PRINT",
        "notes": "Klipper macros from my klippy.cfg",
    }


# ---------------- Publish / unpublish ----------------

def test_browse_anonymous_ok():
    """Browsing the library doesn't require auth."""
    r = requests.get(f"{API}/shared-printers", timeout=10)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_publish_unpublish_roundtrip(author):
    """Owner can publish, the printer appears in the public list,
    then unpublish removes it. clone_count is preserved."""
    sess, uid = author
    # Create a printer
    r = sess.post(f"{API}/me/printers", json=_valid_payload(), timeout=10)
    assert r.status_code == 200, r.text
    pid = r.json()["printer_id"]
    # Not in public list initially
    r = requests.get(f"{API}/shared-printers", params={"printer_model": "Sovol SV06 Plus Ace"}, timeout=10)
    assert all(s["printer_id"] != pid for s in r.json())
    # Publish
    r = sess.post(f"{API}/me/printers/{pid}/publish", timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["published"] is True
    # Appears in public list with display_name "Shared author"
    r = requests.get(f"{API}/shared-printers", params={"printer_model": "Sovol SV06 Plus Ace"}, timeout=10)
    found = [s for s in r.json() if s["printer_id"] == pid]
    assert len(found) == 1, found
    assert found[0]["start_gcode"] == "START_PRINT"
    assert found[0]["published_by_display"] == "Shared author"
    assert found[0]["clone_count"] == 0
    # Unpublish
    r = sess.post(f"{API}/me/printers/{pid}/unpublish", timeout=10)
    assert r.status_code == 200
    # Public list no longer contains it
    r = requests.get(f"{API}/shared-printers", params={"printer_model": "Sovol SV06 Plus Ace"}, timeout=10)
    assert all(s["printer_id"] != pid for s in r.json())


def test_publish_404_for_other_users_printer(author, consumer):
    """A user can't publish someone else's printer."""
    sess_a, _ = author
    sess_c, _ = consumer
    r = sess_a.post(f"{API}/me/printers", json=_valid_payload("Author's"), timeout=10)
    pid = r.json()["printer_id"]
    # Consumer tries to publish author's printer.
    r = sess_c.post(f"{API}/me/printers/{pid}/publish", timeout=10)
    assert r.status_code == 404


def test_publish_unauthenticated():
    r = requests.post(f"{API}/me/printers/{uuid.uuid4()}/publish", timeout=10)
    assert r.status_code == 401


# ---------------- Clone ----------------

def test_clone_copies_into_caller_namespace(author, consumer, db):
    """Cloning a shared printer creates a copy in the consumer's
    user_printers, with start/end g-code preserved and a credit
    line appended to notes."""
    sess_a, author_uid = author
    sess_c, consumer_uid = consumer
    # Author publishes
    r = sess_a.post(f"{API}/me/printers", json=_valid_payload("Author Klipper Tuned"), timeout=10)
    pid = r.json()["printer_id"]
    r = sess_a.post(f"{API}/me/printers/{pid}/publish", timeout=10)
    assert r.status_code == 200
    # Consumer clones
    r = sess_c.post(f"{API}/shared-printers/{pid}/clone", timeout=10)
    assert r.status_code == 200, r.text
    cloned_pid = r.json()["printer_id"]
    assert r.json()["cloned_from"] == pid
    assert "(Shared)" in r.json()["name"]
    # Cloned doc lives in consumer's library
    r = sess_c.get(f"{API}/me/printers/{cloned_pid}", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["start_gcode"] == "START_PRINT"
    assert body["end_gcode"] == "END_PRINT"
    assert "Cloned from @Shared author" in body["notes"]
    # Source's clone_count incremented
    r = requests.get(f"{API}/shared-printers/{pid}", timeout=10)
    assert r.json()["clone_count"] == 1


def test_clone_404_if_not_published(author, consumer):
    """Can't clone a private printer."""
    sess_a, _ = author
    sess_c, _ = consumer
    r = sess_a.post(f"{API}/me/printers", json=_valid_payload(), timeout=10)
    pid = r.json()["printer_id"]
    # Not published — cloning should 404.
    r = sess_c.post(f"{API}/shared-printers/{pid}/clone", timeout=10)
    assert r.status_code == 404


def test_clone_requires_auth(author):
    sess_a, _ = author
    r = sess_a.post(f"{API}/me/printers", json=_valid_payload(), timeout=10)
    pid = r.json()["printer_id"]
    sess_a.post(f"{API}/me/printers/{pid}/publish", timeout=10)
    # Anonymous clone attempt.
    r = requests.post(f"{API}/shared-printers/{pid}/clone", timeout=10)
    assert r.status_code == 401


# ---------------- Filter ----------------

def test_browse_filter_by_printer_model(author, db):
    """The ?printer_model query param exact-matches."""
    sess, _ = author
    # Publish two printers, different models.
    p_a = _valid_payload("A")
    p_a["printer_model"] = "Make A"
    p_b = _valid_payload("B")
    p_b["printer_model"] = "Make B"
    r_a = sess.post(f"{API}/me/printers", json=p_a, timeout=10)
    pid_a = r_a.json()["printer_id"]
    r_b = sess.post(f"{API}/me/printers", json=p_b, timeout=10)
    pid_b = r_b.json()["printer_id"]
    sess.post(f"{API}/me/printers/{pid_a}/publish", timeout=10)
    sess.post(f"{API}/me/printers/{pid_b}/publish", timeout=10)
    # Filter by Make A
    r = requests.get(f"{API}/shared-printers", params={"printer_model": "Make A"}, timeout=10)
    ids = [s["printer_id"] for s in r.json()]
    assert pid_a in ids
    assert pid_b not in ids


# ---------------- Flag ----------------

def test_flag_increments_count(author, consumer, db):
    sess_a, _ = author
    sess_c, _ = consumer
    r = sess_a.post(f"{API}/me/printers", json=_valid_payload(), timeout=10)
    pid = r.json()["printer_id"]
    sess_a.post(f"{API}/me/printers/{pid}/publish", timeout=10)
    # Flag twice from the consumer account.
    for _ in range(2):
        r = sess_c.post(f"{API}/shared-printers/{pid}/flag", timeout=10)
        assert r.status_code == 200
    r = requests.get(f"{API}/shared-printers/{pid}", timeout=10)
    assert r.json()["flag_count"] == 2

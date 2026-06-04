"""Iter-90 — tests for admin moderation of shared printers AND the
community upstream-profile suggestion flow.

We seed test rows directly in MongoDB so we don't depend on the live
publish flow firing during the test. Every test cleans up after itself
so the suite can re-run without accumulating debris.
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


def _mint_session(db, *, is_admin: bool):
    user_id = f"test_iter90_{'admin' if is_admin else 'user'}_{uuid.uuid4().hex[:8]}"
    session_token = f"test_st_{secrets.token_urlsafe(16)}"
    now = datetime.now(timezone.utc)
    user_doc = {
        "user_id": user_id,
        "email": f"{user_id}@test.example.com",
        "name": "Test User",
        "created_at": now.isoformat(),
    }
    if is_admin:
        user_doc["is_admin"] = True
    db.users.insert_one(user_doc)
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (now + timedelta(days=1)).isoformat(),
        "created_at": now.isoformat(),
    })
    sess = requests.Session()
    sess.cookies.set("session_token", session_token, domain=BASE_URL.split("//", 1)[-1].split("/")[0])
    return sess, user_id, session_token


@pytest.fixture()
def admin_session(db):
    sess, uid, tok = _mint_session(db, is_admin=True)
    yield sess, uid
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": tok})


@pytest.fixture()
def user_session(db):
    sess, uid, tok = _mint_session(db, is_admin=False)
    yield sess, uid
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_one({"session_token": tok})


# ---------- Shared-printer moderation ----------

def test_moderation_endpoints_admin_only():
    for path in (
        "/admin/shared-printers/flagged",
        "/admin/shared-printers/recent",
    ):
        r = requests.get(f"{API}{path}", timeout=10)
        assert r.status_code == 401, f"{path} should require auth"


def test_moderation_endpoints_reject_non_admin(user_session):
    sess, _ = user_session
    r = sess.get(f"{API}/admin/shared-printers/flagged", timeout=10)
    assert r.status_code == 403


def test_moderation_lists_flagged(admin_session, db):
    sess, _ = admin_session
    pid = f"mod-test-{uuid.uuid4().hex[:8]}"
    db.user_printers.insert_one({
        "printer_id": pid,
        "user_id": "synthetic_owner",
        "name": "Flagged Test Printer",
        "is_public": True,
        "flag_count": 3,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "build_x": 220, "build_y": 220, "build_z": 250,
    })
    try:
        r = sess.get(f"{API}/admin/shared-printers/flagged", timeout=10)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert any(p["printer_id"] == pid for p in rows)
    finally:
        db.user_printers.delete_one({"printer_id": pid})


def test_moderation_clear_flags(admin_session, db):
    sess, _ = admin_session
    pid = f"mod-clear-{uuid.uuid4().hex[:8]}"
    db.user_printers.insert_one({
        "printer_id": pid, "user_id": "synthetic_owner",
        "name": "Will-be-cleared", "is_public": True,
        "flag_count": 4, "published_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        r = sess.post(f"{API}/admin/shared-printers/{pid}/clear-flags", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["flag_count"] == 0
        # Audit row created.
        audit = db.admin_actions.find_one({"action": "shared_printer_clear_flags", "target_id": pid})
        assert audit is not None
        # DB row reflects the clear.
        doc = db.user_printers.find_one({"printer_id": pid})
        assert doc["flag_count"] == 0
        assert doc.get("flags_cleared_by") is not None
    finally:
        db.user_printers.delete_one({"printer_id": pid})
        db.admin_actions.delete_many({"target_id": pid})


def test_moderation_unpublish_keeps_row(admin_session, db):
    sess, _ = admin_session
    pid = f"mod-unpub-{uuid.uuid4().hex[:8]}"
    db.user_printers.insert_one({
        "printer_id": pid, "user_id": "synthetic_owner",
        "name": "Will-be-unpubbed", "is_public": True, "flag_count": 8,
        "published_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        r = sess.post(f"{API}/admin/shared-printers/{pid}/unpublish", timeout=10)
        assert r.status_code == 200, r.text
        doc = db.user_printers.find_one({"printer_id": pid})
        assert doc["is_public"] is False
        # Flag count preserved (audit history matters).
        assert doc["flag_count"] == 8
        assert doc.get("moderated_by") is not None
    finally:
        db.user_printers.delete_one({"printer_id": pid})
        db.admin_actions.delete_many({"target_id": pid})


def test_moderation_delete_removes_row(admin_session, db):
    sess, _ = admin_session
    pid = f"mod-del-{uuid.uuid4().hex[:8]}"
    db.user_printers.insert_one({
        "printer_id": pid, "user_id": "synthetic_owner",
        "name": "Spam Printer", "is_public": True, "flag_count": 99,
        "published_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        r = sess.delete(f"{API}/admin/shared-printers/{pid}", timeout=10)
        assert r.status_code == 200, r.text
        assert db.user_printers.find_one({"printer_id": pid}) is None
        # Audit row preserves the snapshot.
        audit = db.admin_actions.find_one({"action": "shared_printer_delete", "target_id": pid})
        assert audit is not None
        assert audit["snapshot"]["printer_id"] == pid
    finally:
        db.user_printers.delete_one({"printer_id": pid})
        db.admin_actions.delete_many({"target_id": pid})


# ---------- Community upstream-profile suggestions ----------

def test_submit_suggestion_unauth():
    r = requests.post(f"{API}/upstream-suggestions",
                      json={"printer_name": "Test"}, timeout=10)
    assert r.status_code == 401


def test_submit_suggestion_happy_path(user_session, db):
    sess, uid = user_session
    payload = {
        "printer_name": "Bambu Lab P1S",
        "vendor": "Bambu",
        "upstream_url": "https://github.com/SoftFever/OrcaSlicer/blob/main/resources/profiles/Bambu/machine/Bambu Lab P1S 0.4 nozzle.json",
        "notes": "Most popular Bambu model right now.",
    }
    r = sess.post(f"{API}/upstream-suggestions", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"]
    assert body["printer_name"] == "Bambu Lab P1S"
    assert body["status"] == "open"
    assert body["submitted_by"] == uid
    try:
        # Mine endpoint returns this row.
        r2 = sess.get(f"{API}/upstream-suggestions/mine", timeout=10)
        assert r2.status_code == 200
        mine = r2.json()
        assert any(s["id"] == body["id"] for s in mine)
    finally:
        db.orca_upstream_suggestions.delete_many({"submitted_by": uid})


def test_submit_suggestion_rate_limit(user_session, db):
    sess, uid = user_session
    # Pre-seed 5 open suggestions for this user. The 6th must fail.
    now = datetime.now(timezone.utc).isoformat()
    for i in range(5):
        db.orca_upstream_suggestions.insert_one({
            "id": uuid.uuid4().hex,
            "submitted_at": now,
            "submitted_by": uid,
            "submitter_email": f"{uid}@test.example.com",
            "status": "open",
            "printer_name": f"Pre-seeded {i}",
            "vendor": None, "notes": None, "upstream_url": None,
            "resolved_by": None, "resolved_at": None, "resolution_notes": None,
        })
    try:
        r = sess.post(f"{API}/upstream-suggestions",
                      json={"printer_name": "Should fail"}, timeout=10)
        assert r.status_code == 429, r.text
        assert "5 open suggestions" in r.json().get("detail", "")
    finally:
        db.orca_upstream_suggestions.delete_many({"submitted_by": uid})


def test_admin_can_resolve_suggestion(admin_session, user_session, db):
    user_sess, uid = user_session
    admin_sess, _ = admin_session
    r = user_sess.post(f"{API}/upstream-suggestions",
                       json={"printer_name": "ToBeResolved"}, timeout=10)
    assert r.status_code == 200
    sid = r.json()["id"]
    try:
        r2 = admin_sess.post(f"{API}/admin/orca-upstream/suggestions/{sid}/resolve",
                             json={"notes": "Merged in iter-90"}, timeout=10)
        assert r2.status_code == 200, r2.text
        doc = db.orca_upstream_suggestions.find_one({"id": sid})
        assert doc["status"] == "resolved"
        assert doc["resolution_notes"] == "Merged in iter-90"
        assert doc["resolved_by"] is not None
        # Trying to re-resolve fails with 404 (already not open).
        r3 = admin_sess.post(f"{API}/admin/orca-upstream/suggestions/{sid}/resolve",
                             json={"notes": "no-op"}, timeout=10)
        assert r3.status_code == 404
    finally:
        db.orca_upstream_suggestions.delete_many({"submitted_by": uid})


def test_admin_can_reject_suggestion(admin_session, user_session, db):
    user_sess, uid = user_session
    admin_sess, _ = admin_session
    r = user_sess.post(f"{API}/upstream-suggestions",
                       json={"printer_name": "ToBeRejected"}, timeout=10)
    sid = r.json()["id"]
    try:
        r2 = admin_sess.post(f"{API}/admin/orca-upstream/suggestions/{sid}/reject",
                             json={"notes": "Duplicate"}, timeout=10)
        assert r2.status_code == 200
        doc = db.orca_upstream_suggestions.find_one({"id": sid})
        assert doc["status"] == "rejected"
    finally:
        db.orca_upstream_suggestions.delete_many({"submitted_by": uid})


def test_admin_list_suggestions_admin_only(user_session):
    sess, _ = user_session
    r = sess.get(f"{API}/admin/orca-upstream/suggestions", timeout=10)
    assert r.status_code == 403

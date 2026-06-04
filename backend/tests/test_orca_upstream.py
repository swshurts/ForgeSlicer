"""Tests for the iter-85 OrcaSlicer upstream sync feature.

Covers:
  - Unit: MACHINE_PATH_RE / SKIP_PATTERNS classify upstream tree paths
    correctly (smoke).
  - Unit: _parse_quickfields extracts the build-volume / nozzle / flavour
    from a realistic OrcaSlicer machine JSON.
  - Integration: admin auth gate (401 unauth, 403 non-admin) on every
    /api/admin/orca-upstream/* endpoint.
  - Integration: /api/synced-printers is public, returns merged docs.
  - Integration: merge flow promotes a hand-seeded delta into
    bundled_synced_printers.

We deliberately do NOT exercise the real GitHub fetch in these tests —
that's a network side-effect and would make the suite flaky. The unit
helpers cover the parsing logic that drives the sync.
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

from orca_upstream import MACHINE_PATH_RE, SKIP_PATTERNS, _parse_quickfields  # noqa: E402


BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- Unit tests ----------

def test_machine_path_re_matches_real_examples():
    """Sanity-check the path filter — every upstream entry that should
    be considered must match, and the rest must not."""
    assert MACHINE_PATH_RE.match("resources/profiles/Creality/machine/Creality Ender-3 V3 SE 0.4 nozzle.json")
    assert MACHINE_PATH_RE.match("resources/profiles/Voron/machine/Voron 2.4 350 0.4 nozzle.json")
    # Negative cases: process / filament / non-machine paths.
    assert not MACHINE_PATH_RE.match("resources/profiles/Voron/process/0.20mm Standard.json")
    assert not MACHINE_PATH_RE.match("resources/profiles/Voron/filament/Voron PLA Generic.json")
    assert not MACHINE_PATH_RE.match("resources/profiles/Voron.json")
    assert not MACHINE_PATH_RE.match("README.md")


def test_skip_patterns_filters_abstract_profiles():
    """Common / abstract bases shouldn't be considered for merging —
    they're only useful as parents in the `inherits` chain."""
    assert SKIP_PATTERNS.search("fdm_machine_common")
    assert SKIP_PATTERNS.search("Creality_common")
    # Real printers must NOT match.
    assert not SKIP_PATTERNS.search("Bambu Lab P1S 0.4 nozzle")
    assert not SKIP_PATTERNS.search("Voron 2.4 350 0.4 nozzle")


def test_parse_quickfields_extracts_build_volume_and_nozzle():
    profile = {
        "type": "machine",
        "name": "Test Printer 0.4",
        "nozzle_diameter": ["0.4"],
        "printable_area": ["0x0", "300x0", "300x300", "0x300"],
        "printable_height": "340",
        "gcode_flavor": "Klipper",
    }
    fields = _parse_quickfields(profile)
    assert fields["nozzle_diameter"] == 0.4
    assert fields["build_x_mm"] == 300
    assert fields["build_y_mm"] == 300
    assert fields["build_z_mm"] == 340
    assert fields["gcode_flavor"] == "klipper"


def test_parse_quickfields_tolerates_missing_or_malformed():
    """Quickfield extraction must never raise — bad upstream JSON
    should yield an empty (or partial) result, not crash sync."""
    assert _parse_quickfields({}) == {}
    assert _parse_quickfields({"nozzle_diameter": "n/a"}) == {}
    weird = _parse_quickfields({"printable_area": ["garbage"]})
    assert "build_x_mm" not in weird and "build_y_mm" not in weird


def test_parse_quickfields_multi_nozzle_string():
    """Upstream machine_model abstracts list every nozzle the model
    supports as a semicolon-delimited string. The smallest one is
    the canonical default — that's what most variants ship with."""
    profile = {
        "type": "machine_model",
        "name": "Voron 2.4 Common",
        "nozzle_diameter": "0.4;0.6;0.8",
        "printable_area": ["0x0", "350x0", "350x350", "0x350"],
        "printable_height": "300;500",
        "gcode_flavor": "klipper",
    }
    fields = _parse_quickfields(profile)
    assert fields["nozzle_diameter"] == 0.4   # smallest of the set
    assert fields["build_x_mm"] == 350
    assert fields["build_y_mm"] == 350
    assert fields["build_z_mm"] == 300        # smallest Z = conservative
    assert fields["gcode_flavor"] == "klipper"


def test_parse_quickfields_multi_nozzle_list_of_strings():
    """OrcaSlicer's bundled abstracts sometimes use a list-of-strings
    instead of a single semicolon-delimited string. Same intent —
    pick the smallest nozzle as the canonical value."""
    fields = _parse_quickfields({
        "nozzle_diameter": ["0.4", "0.6", "0.8"],
        "printable_height": 250,
    })
    assert fields["nozzle_diameter"] == 0.4
    assert fields["build_z_mm"] == 250


# ---------- HTTP integration tests ----------

@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture()
def authed_admin_session(db):
    """Mint a fresh admin user + session row and yield a requests.Session
    with the cookie. is_admin=True so the upstream endpoints accept it."""
    user_id = f"test_orcaup_admin_{uuid.uuid4().hex[:8]}"
    session_token = f"test_up_st_{secrets.token_urlsafe(16)}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@test.example.com",
        "name": "Orca Upstream Admin",
        "is_admin": True,
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
    db.users.delete_one({"user_id": user_id})
    db.user_sessions.delete_one({"session_token": session_token})


@pytest.fixture()
def authed_plain_session(db):
    """Non-admin user — used to verify the auth gate kicks back 403
    even with a valid session."""
    user_id = f"test_orcaup_plain_{uuid.uuid4().hex[:8]}"
    session_token = f"test_up_st_{secrets.token_urlsafe(16)}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": user_id,
        "email": f"{user_id}@test.example.com",
        "name": "Plain User",
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
    db.users.delete_one({"user_id": user_id})
    db.user_sessions.delete_one({"session_token": session_token})


def test_upstream_endpoints_reject_anonymous():
    """All /admin/orca-upstream/* routes are admin-only. Anonymous
    callers must get 401 (the upstream auth helper raises 401 before
    the admin check fires)."""
    assert requests.get(f"{API}/admin/orca-upstream/deltas", timeout=10).status_code == 401
    assert requests.post(f"{API}/admin/orca-upstream/sync", timeout=10).status_code == 401


def test_upstream_endpoints_reject_non_admin(authed_plain_session):
    sess, _ = authed_plain_session
    r = sess.get(f"{API}/admin/orca-upstream/deltas", timeout=10)
    assert r.status_code == 403, r.text


def test_synced_printers_is_public():
    """The public read endpoint must NOT require auth — slicer popovers
    consume it for every visitor."""
    r = requests.get(f"{API}/synced-printers", timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_admin_can_list_pending_deltas(authed_admin_session, db):
    """Seed a pending delta directly in Mongo and verify it surfaces
    in the admin's pending list."""
    sess, _ = authed_admin_session
    seed_path = f"resources/profiles/TestVendor/machine/Synthetic Printer 0.4 nozzle.json"
    seed_id = uuid.uuid4().hex
    seed_sha = secrets.token_hex(20)
    db.orca_upstream_deltas.insert_one({
        "id": seed_id,
        "path": seed_path,
        "vendor": "TestVendor",
        "name": "Synthetic Printer 0.4 nozzle",
        "kind": "new",
        "prev_sha": None,
        "new_sha": seed_sha,
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
    })
    try:
        r = sess.get(f"{API}/admin/orca-upstream/deltas?status=pending", timeout=10)
        assert r.status_code == 200, r.text
        ids = [d["id"] for d in r.json()]
        assert seed_id in ids
    finally:
        db.orca_upstream_deltas.delete_one({"id": seed_id})


def test_merge_promotes_cached_json_to_synced_printers(authed_admin_session, db):
    """End-to-end: seed a delta + cache row, hit /merge, verify a doc
    landed in bundled_synced_printers AND that /api/synced-printers
    returns it for anonymous callers."""
    sess, _ = authed_admin_session
    seed_path = f"resources/profiles/MergeTest/machine/MergeProbe {uuid.uuid4().hex[:6]}.json"
    seed_id = uuid.uuid4().hex
    seed_sha = secrets.token_hex(20)
    sample_profile = {
        "type": "machine",
        "name": "MergeProbe Test Printer",
        "nozzle_diameter": ["0.4"],
        "printable_area": ["0x0", "220x0", "220x220", "0x220"],
        "printable_height": "250",
        "gcode_flavor": "marlin2",
    }
    now = datetime.now(timezone.utc).isoformat()
    db.orca_upstream_deltas.insert_one({
        "id": seed_id, "path": seed_path,
        "vendor": "MergeTest", "name": "MergeProbe Test Printer",
        "kind": "new", "prev_sha": None, "new_sha": seed_sha,
        "detected_at": now, "status": "pending",
    })
    db.orca_upstream_cache.insert_one({
        "path": seed_path, "vendor": "MergeTest",
        "name": "MergeProbe Test Printer", "sha": seed_sha,
        "raw_json": sample_profile, "fetched_at": now,
    })
    try:
        r = sess.post(f"{API}/admin/orca-upstream/deltas/{seed_id}/merge", timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        merged_id = body["merged_doc_id"]
        # Public endpoint should now expose it.
        public = requests.get(f"{API}/synced-printers", timeout=10).json()
        ids = [p["id"] for p in public]
        assert merged_id in ids
        promoted = next(p for p in public if p["id"] == merged_id)
        assert promoted["vendor"] == "MergeTest"
        assert promoted["nozzle_diameter"] == 0.4
        assert promoted["build_x_mm"] == 220
        assert promoted["build_z_mm"] == 250
        assert promoted["gcode_flavor"] == "marlin2"
        # Delta should now be marked merged.
        delta_doc = db.orca_upstream_deltas.find_one({"id": seed_id})
        assert delta_doc["status"] == "merged"
        # Idempotency — re-merging is a no-op.
        r2 = sess.post(f"{API}/admin/orca-upstream/deltas/{seed_id}/merge", timeout=10)
        assert r2.status_code == 200
        assert r2.json().get("already_merged") is True
    finally:
        db.orca_upstream_deltas.delete_one({"id": seed_id})
        db.orca_upstream_cache.delete_one({"path": seed_path})
        db.bundled_synced_printers.delete_one({"source_path": seed_path})


def test_dismiss_marks_delta_dismissed(authed_admin_session, db):
    sess, _ = authed_admin_session
    seed_id = uuid.uuid4().hex
    db.orca_upstream_deltas.insert_one({
        "id": seed_id, "path": "resources/profiles/X/machine/Y.json",
        "vendor": "X", "name": "Y", "kind": "new",
        "prev_sha": None, "new_sha": "deadbeef",
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
    })
    try:
        r = sess.post(f"{API}/admin/orca-upstream/deltas/{seed_id}/dismiss", timeout=10)
        assert r.status_code == 200, r.text
        delta = db.orca_upstream_deltas.find_one({"id": seed_id})
        assert delta["status"] == "dismissed"
        # Dismissing again returns 404 (no longer pending).
        r2 = sess.post(f"{API}/admin/orca-upstream/deltas/{seed_id}/dismiss", timeout=10)
        assert r2.status_code == 404
    finally:
        db.orca_upstream_deltas.delete_one({"id": seed_id})


# ---------- Iter-88: Digest endpoint tests ----------


def test_digest_state_endpoint_admin_only(authed_plain_session):
    """Non-admin must not see digest state — 403."""
    sess, _ = authed_plain_session
    r = sess.get(f"{API}/admin/orca-upstream/digest/state", timeout=10)
    assert r.status_code == 403


def test_digest_state_endpoint_unauth():
    """Anonymous request → 401, before the admin check runs."""
    r = requests.get(f"{API}/admin/orca-upstream/digest/state", timeout=10)
    assert r.status_code == 401


def test_digest_state_endpoint_returns_state(authed_admin_session, db):
    """Admin GET /digest/state returns the singleton row, or a default
    when no row exists yet."""
    sess, _ = authed_admin_session
    # Clear any prior state for a clean baseline.
    db.orca_upstream_digest_state.delete_one({"_id": "singleton"})
    r = sess.get(f"{API}/admin/orca-upstream/digest/state", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "last_sent_at" in body
    assert body["last_sent_at"] is None


def test_digest_send_now_returns_counts(authed_admin_session, db):
    """The send-now route bypasses the weekly cooldown. It MUST always
    return 200 with a counts dict — either {sent, failed, new, changed}
    or {sent:0, skipped:'<reason>'}. In a test env where Resend isn't
    configured, sends will fail silently with `msg_id=None` → counted
    as failed, NOT as sent. Either response shape is acceptable here;
    we just verify the route's contract."""
    sess, _ = authed_admin_session
    r = sess.post(f"{API}/admin/orca-upstream/digest/send-now", timeout=45)
    assert r.status_code == 200, r.text
    body = r.json()
    # Either we report counts (sent/failed/new/changed) or we explicitly
    # skip (no-changes / no-admins). Both shapes are valid contract.
    assert "sent" in body
    if "skipped" in body:
        assert body["skipped"] in ("no-changes", "no-admins")
    else:
        # When the route DID try to send, the counts dict must have the
        # full four-key shape.
        for k in ("sent", "failed", "new", "changed"):
            assert k in body, f"missing key {k}: {body}"


def test_digest_send_now_admin_only():
    r = requests.post(f"{API}/admin/orca-upstream/digest/send-now", timeout=10)
    assert r.status_code == 401


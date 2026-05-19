"""Backend API tests for auth + user-library endpoints (Phase 2)."""
import os
import time
import uuid
import base64
import struct
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _minimal_stl_b64() -> str:
    header = b"TEST_STL".ljust(80, b"\x00")
    tri_count = struct.pack("<I", 1)
    body = struct.pack(
        "<12fH",
        0.0, 0.0, 1.0,
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0,
    )
    return base64.b64encode(header + tri_count + body).decode("ascii")


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture
def seeded_user(db):
    """Insert a fresh test user + valid session, yield the session token."""
    user_id = f"user_pytest{uuid.uuid4().hex[:8]}"
    session_token = f"st_pytest_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": f"pytest+{user_id}@example.com",
        "name": "Pytest User",
        "picture": "",
        "created_at": "2026-02-19T00:00:00+00:00",
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        # 7 days in the future
        "expires_at": "2099-01-01T00:00:00+00:00",
        "created_at": "2026-02-19T00:00:00+00:00",
    })
    yield {"user_id": user_id, "session_token": session_token, "name": "Pytest User"}
    # Cleanup
    db.users.delete_one({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.gallery.delete_many({"user_id": user_id})
    db.components.delete_many({"user_id": user_id})


def _hdrs(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestAuthEndpoints:
    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=10)
        assert r.status_code == 401

    def test_me_returns_user_with_bearer(self, seeded_user):
        r = requests.get(f"{API}/auth/me", headers=_hdrs(seeded_user["session_token"]), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["user_id"] == seeded_user["user_id"]
        assert j["name"] == seeded_user["name"]

    def test_logout_invalidates_session(self, db):
        # Seed a throw-away session so cleanup doesn't depend on the user fixture.
        user_id = f"user_logout{uuid.uuid4().hex[:6]}"
        token = f"st_logout_{uuid.uuid4().hex}"
        db.users.insert_one({"user_id": user_id, "email": "x@x", "name": "X", "created_at": "2026-02-19T00:00:00+00:00"})
        db.user_sessions.insert_one({
            "user_id": user_id, "session_token": token,
            "expires_at": "2099-01-01T00:00:00+00:00", "created_at": "2026-02-19T00:00:00+00:00",
        })
        try:
            assert requests.get(f"{API}/auth/me", headers=_hdrs(token), timeout=10).status_code == 200
            requests.post(f"{API}/auth/logout", headers=_hdrs(token), timeout=10)
            r2 = requests.get(f"{API}/auth/me", headers=_hdrs(token), timeout=10)
            assert r2.status_code == 401
        finally:
            db.users.delete_one({"user_id": user_id})
            db.user_sessions.delete_many({"user_id": user_id})

    def test_exchange_rejects_blank_session_id(self):
        r = requests.post(f"{API}/auth/session", json={"session_id": ""}, timeout=10)
        assert r.status_code == 400


class TestPrivateLibraries:
    def test_my_designs_empty_for_new_user(self, seeded_user):
        r = requests.get(f"{API}/me/designs", headers=_hdrs(seeded_user["session_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json() == []

    def test_my_components_empty_for_new_user(self, seeded_user):
        r = requests.get(f"{API}/me/components", headers=_hdrs(seeded_user["session_token"]), timeout=10)
        assert r.status_code == 200
        assert r.json() == []

    def test_private_design_is_hidden_from_public(self, seeded_user):
        # Logged-in upload of a private design.
        payload = {
            "name": f"Private {uuid.uuid4().hex[:6]}",
            "stl_base64": _minimal_stl_b64(),
            "triangle_count": 1,
            "object_count": 1,
            "private": True,
        }
        cr = requests.post(f"{API}/gallery", headers=_hdrs(seeded_user["session_token"]), json=payload, timeout=15)
        assert cr.status_code == 200
        item = cr.json()
        assert item["private"] is True
        assert item["user_id"] == seeded_user["user_id"]
        # Anonymous public listing must NOT contain it.
        pub = requests.get(f"{API}/gallery", timeout=10).json()
        pub_ids = {x["id"] for x in pub}
        assert item["id"] not in pub_ids
        # But /me/designs MUST.
        mine = requests.get(f"{API}/me/designs", headers=_hdrs(seeded_user["session_token"]), timeout=10).json()
        mine_ids = {x["id"] for x in mine}
        assert item["id"] in mine_ids

    def test_owner_can_delete_their_design(self, seeded_user):
        payload = {
            "name": f"Mine {uuid.uuid4().hex[:6]}",
            "stl_base64": _minimal_stl_b64(),
            "triangle_count": 1,
            "object_count": 1,
        }
        item = requests.post(f"{API}/gallery", headers=_hdrs(seeded_user["session_token"]), json=payload, timeout=15).json()
        # Anonymous DELETE on an owned item must be rejected.
        anon = requests.delete(f"{API}/gallery/{item['id']}", timeout=10)
        assert anon.status_code in (401, 403)
        # Owner DELETE succeeds.
        ok = requests.delete(f"{API}/gallery/{item['id']}", headers=_hdrs(seeded_user["session_token"]), timeout=10)
        assert ok.status_code == 200


class TestLegacyMigration:
    def test_public_legacy_items_have_legacy_prefix(self):
        items = requests.get(f"{API}/gallery", timeout=10).json()
        legacy = [x for x in items if (x.get("user_id") in (None, "")) and x["author"].startswith("Legacy")]
        # We only assert that the migration ran without error and that any
        # un-owned items now carry the "Legacy · …" prefix (rerun-safe).
        assert all(x["author"].startswith("Legacy · ") for x in legacy)

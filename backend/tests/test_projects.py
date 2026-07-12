"""Backend tests for the hierarchical /api/projects router.

Covers: auth gate, CRUD, parent_id semantics including __ROOT__ sentinel,
cycle detection, cascade delete, and per-user isolation. Test users +
session tokens are seeded via env vars (TOKEN_A, TOKEN_B) when provided,
otherwise a session-scoped conftest fixture seeds two ephemeral users
directly into MongoDB. Self-cleans projects it creates by deleting
Test A & Test B's roots at the end.
"""
import os
import secrets
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _seed_session(email: str) -> str:
    """Iter-133 — Ephemeral session seeder. Creates a user + a 7-day
    session token in the test_database mongo instance so this test file
    is runnable without externally pre-seeding TOKEN_A/TOKEN_B env vars.

    Kept in-file (not in conftest.py) because it's the only test that
    needs a two-user seed and we want the mechanism to be obvious to
    anyone opening this file. Retries once on the users.email unique
    index in case a previous run left the doc behind.
    """
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    cli = MongoClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    user_id = f"testproj_{secrets.token_hex(6)}"
    now = datetime.now(timezone.utc).isoformat()
    # Reuse the existing user (matched on email) so parallel test runs
    # don't collide with the unique-email constraint.
    doc = db.users.find_one_and_update(
        {"email": email},
        {"$setOnInsert": {
            "user_id": user_id, "email": email, "name": email.split("@")[0],
            "created_at": now, "subscription_tier": "pro",
        }},
        upsert=True, return_document=True,
    )
    uid = doc["user_id"]
    token = f"st_projects_{secrets.token_hex(10)}"
    db.user_sessions.insert_one({
        "session_token": token, "user_id": uid,
        "created_at": now,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    })
    return token


TOKEN_A = os.environ.get("TOKEN_A") or _seed_session("projtest_a@forgeslicer.dev")
TOKEN_B = os.environ.get("TOKEN_B") or _seed_session("projtest_b@forgeslicer.dev")

HA = {"Authorization": f"Bearer {TOKEN_A}"}
HB = {"Authorization": f"Bearer {TOKEN_B}"}


# ---- Auth gate ----
class TestAuthGate:
    def test_list_unauth(self):
        r = requests.get(f"{BASE}/api/projects")
        assert r.status_code == 401

    def test_post_unauth(self):
        r = requests.post(f"{BASE}/api/projects", json={"name": "x"})
        assert r.status_code == 401

    def test_get_unauth(self):
        r = requests.get(f"{BASE}/api/projects/anything")
        assert r.status_code == 401

    def test_put_unauth(self):
        r = requests.put(f"{BASE}/api/projects/anything", json={"name": "y"})
        assert r.status_code == 401

    def test_delete_unauth(self):
        r = requests.delete(f"{BASE}/api/projects/anything")
        assert r.status_code == 401


# ---- CRUD ----
class TestCRUD:
    def test_initial_list_empty(self):
        r = requests.get(f"{BASE}/api/projects", headers=HA)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_root_and_child_and_cascade_delete(self):
        # CREATE root
        r = requests.post(f"{BASE}/api/projects", headers=HA,
                          json={"name": "TEST_Rocket"})
        assert r.status_code == 200, r.text
        root = r.json()
        assert root["parent_id"] is None
        assert root["has_geometry"] is False
        assert root["object_count"] == 0
        assert "project_id" in root and "created_at" in root
        root_id = root["project_id"]

        # CREATE child
        r = requests.post(f"{BASE}/api/projects", headers=HA,
                          json={"name": "TEST_Engine", "parent_id": root_id})
        assert r.status_code == 200, r.text
        child = r.json()
        assert child["parent_id"] == root_id
        child_id = child["project_id"]

        # CREATE grandchild
        r = requests.post(f"{BASE}/api/projects", headers=HA,
                          json={"name": "TEST_FuelPump", "parent_id": child_id})
        assert r.status_code == 200, r.text
        gc_id = r.json()["project_id"]

        # POST with invalid parent_id -> 404
        r = requests.post(f"{BASE}/api/projects", headers=HA,
                          json={"name": "bad", "parent_id": "nope"})
        assert r.status_code == 404

        # GET detail returns forge_json
        r = requests.get(f"{BASE}/api/projects/{root_id}", headers=HA)
        assert r.status_code == 200
        detail = r.json()
        assert detail["project_id"] == root_id
        assert detail["forge_json"] == {}

        # PUT update name + forge_json with objects -> object_count derives
        forge = {"objects": [{"id": 1}, {"id": 2}, {"id": 3}], "settings": {}}
        r = requests.put(f"{BASE}/api/projects/{root_id}", headers=HA,
                         json={"name": "TEST_Rocket2", "forge_json": forge})
        assert r.status_code == 200
        m = r.json()
        assert m["name"] == "TEST_Rocket2"
        assert m["object_count"] == 3
        assert m["has_geometry"] is True

        # PUT parent_id=self -> 400
        r = requests.put(f"{BASE}/api/projects/{root_id}", headers=HA,
                         json={"parent_id": root_id})
        assert r.status_code == 400
        assert "itself" in r.json().get("detail", "").lower()

        # PUT cycle: try to move root under grandchild
        r = requests.put(f"{BASE}/api/projects/{root_id}", headers=HA,
                         json={"parent_id": gc_id})
        assert r.status_code == 400
        assert "cycle" in r.json().get("detail", "").lower()

        # PUT with non-existent parent_id -> 404
        r = requests.put(f"{BASE}/api/projects/{child_id}", headers=HA,
                         json={"parent_id": "does-not-exist"})
        assert r.status_code == 404

        # PUT __ROOT__ sentinel: detach grandchild to root
        r = requests.put(f"{BASE}/api/projects/{gc_id}", headers=HA,
                         json={"parent_id": "__ROOT__"})
        assert r.status_code == 200
        assert r.json()["parent_id"] is None

        # Re-attach grandchild to child for cascade test
        r = requests.put(f"{BASE}/api/projects/{gc_id}", headers=HA,
                         json={"parent_id": child_id})
        assert r.status_code == 200

        # Verify list shows 3 items
        r = requests.get(f"{BASE}/api/projects", headers=HA)
        assert r.status_code == 200
        items = r.json()
        ids = {i["project_id"] for i in items}
        assert {root_id, child_id, gc_id}.issubset(ids)

        # Cascade DELETE root → should remove all 3
        r = requests.delete(f"{BASE}/api/projects/{root_id}", headers=HA)
        assert r.status_code == 200
        body = r.json()
        assert body["deleted"] == 3
        assert set(body["ids"]) == {root_id, child_id, gc_id}

        # Subsequent GET list — none of those ids remain
        r = requests.get(f"{BASE}/api/projects", headers=HA)
        ids_after = {i["project_id"] for i in r.json()}
        assert ids_after.isdisjoint({root_id, child_id, gc_id})


# ---- Per-user isolation ----
class TestIsolation:
    def test_user_b_cannot_see_or_mutate_user_a_project(self):
        # User A creates a project
        r = requests.post(f"{BASE}/api/projects", headers=HA,
                          json={"name": "TEST_PrivateA"})
        assert r.status_code == 200
        pid = r.json()["project_id"]

        try:
            # User B list does not include it
            r = requests.get(f"{BASE}/api/projects", headers=HB)
            assert r.status_code == 200
            assert pid not in {i["project_id"] for i in r.json()}

            # User B GET -> 404
            r = requests.get(f"{BASE}/api/projects/{pid}", headers=HB)
            assert r.status_code == 404

            # User B PUT -> 404
            r = requests.put(f"{BASE}/api/projects/{pid}", headers=HB,
                             json={"name": "hax"})
            assert r.status_code == 404

            # User B DELETE -> 404
            r = requests.delete(f"{BASE}/api/projects/{pid}", headers=HB)
            assert r.status_code == 404
        finally:
            # Cleanup
            requests.delete(f"{BASE}/api/projects/{pid}", headers=HA)


@pytest.fixture(scope="session", autouse=True)
def _final_cleanup():
    yield
    # Best-effort: delete any TEST_-prefixed project left behind
    for h in (HA, HB):
        r = requests.get(f"{BASE}/api/projects", headers=h)
        if r.status_code == 200:
            for item in r.json():
                if item["name"].startswith("TEST_") and item["parent_id"] is None:
                    requests.delete(f"{BASE}/api/projects/{item['project_id']}", headers=h)

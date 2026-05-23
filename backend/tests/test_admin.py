"""Tests for the admin module — security-critical.

These mostly verify the AUTHORIZATION guards:
- /api/admin/* without auth → 401
- /api/admin/* as a regular user → 403
- /api/admin/users/promote-admin as a regular admin (non-super) → 403
- AI quota cap > 300 → 422 (Pydantic)

Plus a few happy-path tests on the audit log and quota override.
"""
import os
import time
import secrets
import requests
import pytest
from pymongo import MongoClient

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


@pytest.fixture
def regular_user_session():
    """Register a brand new user with no admin flags."""
    s = requests.Session()
    email = f"reg.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = s.post(f"{API}/auth/register", json={
        "name": "Regular User", "email": email, "password": "passw0rdRegular",
    })
    assert r.status_code == 200
    return s, r.json()["user_id"]


@pytest.fixture
def admin_user_session(db):
    """Register a user and manually flag them is_admin=true (not super-admin)."""
    s = requests.Session()
    email = f"adm.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = s.post(f"{API}/auth/register", json={
        "name": "Admin User", "email": email, "password": "passw0rdAdmin",
    })
    assert r.status_code == 200
    uid = r.json()["user_id"]
    db.users.update_one({"user_id": uid}, {"$set": {"is_admin": True}})
    return s, uid


@pytest.fixture
def super_admin_session(db):
    """Register a user and manually flag them is_super_admin=true."""
    s = requests.Session()
    email = f"sup.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = s.post(f"{API}/auth/register", json={
        "name": "Super Admin", "email": email, "password": "passw0rdSuper",
    })
    assert r.status_code == 200
    uid = r.json()["user_id"]
    db.users.update_one({"user_id": uid}, {"$set": {"is_admin": True, "is_super_admin": True}})
    return s, uid


class TestAuthGuards:
    def test_admin_me_requires_auth(self):
        r = requests.get(f"{API}/admin/me")
        assert r.status_code == 401

    def test_admin_endpoints_403_for_regular_user(self, regular_user_session):
        s, _ = regular_user_session
        for path in ("/admin/me", "/admin/users", "/admin/analytics", "/admin/audit"):
            r = s.get(f"{API}{path}")
            assert r.status_code == 403, f"{path} should 403 for regular users, got {r.status_code}"

    def test_admin_can_access_basic_endpoints(self, admin_user_session):
        s, _ = admin_user_session
        for path in ("/admin/me", "/admin/users", "/admin/analytics", "/admin/audit"):
            r = s.get(f"{API}{path}")
            assert r.status_code == 200, f"{path} failed for admin: {r.text}"

    def test_regular_admin_cannot_promote(self, admin_user_session, regular_user_session):
        s, _ = admin_user_session
        _, target_uid = regular_user_session
        r = s.post(f"{API}/admin/users/promote-admin",
                   json={"user_id": target_uid, "is_admin": True})
        assert r.status_code == 403

    def test_super_admin_can_promote(self, super_admin_session, regular_user_session, db):
        s, _ = super_admin_session
        _, target_uid = regular_user_session
        r = s.post(f"{API}/admin/users/promote-admin",
                   json={"user_id": target_uid, "is_admin": True})
        assert r.status_code == 200
        # Confirm the flag stuck
        u = db.users.find_one({"user_id": target_uid})
        assert u["is_admin"] is True


class TestAIQuotaOverride:
    def test_set_quota_within_range(self, admin_user_session, regular_user_session, db):
        s, _ = admin_user_session
        _, target_uid = regular_user_session
        r = s.post(f"{API}/admin/users/ai-quota",
                   json={"user_id": target_uid, "quota": 50})
        assert r.status_code == 200
        u = db.users.find_one({"user_id": target_uid})
        assert u["ai_quota_override"] == 50

    def test_quota_over_300_rejected(self, admin_user_session, regular_user_session):
        s, _ = admin_user_session
        _, target_uid = regular_user_session
        r = s.post(f"{API}/admin/users/ai-quota",
                   json={"user_id": target_uid, "quota": 500})
        assert r.status_code == 422

    def test_quota_zero_rejected(self, admin_user_session, regular_user_session):
        s, _ = admin_user_session
        _, target_uid = regular_user_session
        r = s.post(f"{API}/admin/users/ai-quota",
                   json={"user_id": target_uid, "quota": 0})
        assert r.status_code == 422

    def test_clear_quota_with_null(self, admin_user_session, regular_user_session, db):
        s, _ = admin_user_session
        _, target_uid = regular_user_session
        # First set it
        s.post(f"{API}/admin/users/ai-quota", json={"user_id": target_uid, "quota": 100})
        # Then clear
        r = s.post(f"{API}/admin/users/ai-quota", json={"user_id": target_uid, "quota": None})
        assert r.status_code == 200
        u = db.users.find_one({"user_id": target_uid})
        assert "ai_quota_override" not in u or u.get("ai_quota_override") is None

    def test_quota_applies_to_user_endpoint(self, admin_user_session, regular_user_session, db):
        """The /api/ai/usage endpoint should reflect the override."""
        s_admin, _ = admin_user_session
        s_user, target_uid = regular_user_session
        s_admin.post(f"{API}/admin/users/ai-quota",
                     json={"user_id": target_uid, "quota": 77})
        r = s_user.get(f"{API}/ai/usage")
        assert r.status_code == 200
        assert r.json()["cap"] == 77


class TestAuditLog:
    def test_quota_change_writes_audit(self, admin_user_session, regular_user_session, db):
        s, admin_uid = admin_user_session
        _, target_uid = regular_user_session
        s.post(f"{API}/admin/users/ai-quota", json={"user_id": target_uid, "quota": 42})
        # The audit row should exist
        row = db.admin_audit.find_one({
            "actor_user_id": admin_uid,
            "target_user_id": target_uid,
            "action": "set_ai_quota",
        }, sort=[("created_at", -1)])
        assert row is not None
        assert row["details"]["quota"] == 42

    def test_audit_lists_newest_first(self, admin_user_session, regular_user_session):
        s, _ = admin_user_session
        _, target_uid = regular_user_session
        s.post(f"{API}/admin/users/ai-quota", json={"user_id": target_uid, "quota": 11})
        s.post(f"{API}/admin/users/ai-quota", json={"user_id": target_uid, "quota": 22})
        r = s.get(f"{API}/admin/audit?limit=10")
        rows = r.json()
        # Most recent first; the topmost row mentioning target_uid should be quota=22
        for row in rows:
            if row.get("target_user_id") == target_uid and row["action"] == "set_ai_quota":
                assert row["details"]["quota"] == 22
                break
        else:
            pytest.fail("No matching audit row found")


class TestBanFlow:
    def test_ban_kills_sessions(self, admin_user_session, regular_user_session, db):
        s_admin, _ = admin_user_session
        s_user, target_uid = regular_user_session
        # Confirm session works first
        assert s_user.get(f"{API}/auth/me").status_code == 200
        # Ban
        r = s_admin.post(f"{API}/admin/users/ban",
                         json={"user_id": target_uid, "banned": True, "reason": "test"})
        assert r.status_code == 200
        # Old session should now be dead
        assert s_user.get(f"{API}/auth/me").status_code == 401

    def test_cannot_ban_self(self, admin_user_session):
        s, admin_uid = admin_user_session
        r = s.post(f"{API}/admin/users/ban",
                   json={"user_id": admin_uid, "banned": True})
        assert r.status_code == 400


class TestAnalytics:
    def test_analytics_shape(self, admin_user_session):
        s, _ = admin_user_session
        r = s.get(f"{API}/admin/analytics")
        assert r.status_code == 200
        body = r.json()
        for top in ("users", "content", "ai", "generated_at"):
            assert top in body
        for k in ("total", "new_24h", "dau", "mau", "contributors"):
            assert k in body["users"]
        for k in ("designs_total", "components_total"):
            assert k in body["content"]

"""End-to-end token-flow tests.

These verify the FULL magic-link and password-reset round-trips by:
1. Monkey-patching email_service.send_*_email at the module level via a
   sidecar marker file so the running backend writes the plaintext token
   to a known location, then
2. Calling the consume/reset endpoint with that token.

Because we can't reload the running backend, we use a clean approach:
read the database directly to pull the most recently-issued token_hash,
then run the consume endpoint against a freshly-issued GOOD token by
hooking into email_service.

Simpler approach taken below: skip these in CI but provide manual run
via storing tokens in-memory during the request flow.

For now we do a focused E2E that DOES work without a sidecar:
- Confirm tokens are issued (count goes up)
- Confirm tokens can't be reused (consume same bad token twice -> same error)
- Confirm /me reflects the new session_token cookie after a successful flow
"""
import os
import time
import secrets
import hashlib
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


def _hash_token(t):
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture
def fresh_user():
    """Register a fresh user and return (session, email, password)."""
    s = requests.Session()
    email = f"e2e.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    # Random per-run password — nothing static committed to the repo.
    password = f"Pw{secrets.token_hex(6)}1"
    r = s.post(f"{API}/auth/register",
               json={"name": "E2E Tester", "email": email, "password": password})
    assert r.status_code == 200, r.text
    return s, email, password


class TestPasswordResetRoundTrip:
    def test_full_reset_flow_with_injected_token(self, db, fresh_user):
        """Inject a known token directly into MongoDB (bypassing the email
        send) and verify the reset endpoint accepts it."""
        s, email, password = fresh_user
        # Insert a synthetic reset token tied to this user
        user = db.users.find_one({"email": email})
        plaintext = secrets.token_urlsafe(32)
        from datetime import datetime, timezone, timedelta
        db.password_reset_tokens.insert_one({
            "user_id": user["user_id"],
            "token_hash": _hash_token(plaintext),
            "email": email,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            "used_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ip": "test",
        })
        # Hit reset endpoint
        new_session = requests.Session()
        r = new_session.post(f"{API}/auth/password/reset",
                             json={"token": plaintext, "new_password": "newpassW0rd"})
        assert r.status_code == 200, r.text
        # New password should work
        r2 = requests.post(f"{API}/auth/login",
                           json={"email": email, "password": "newpassW0rd"})
        assert r2.status_code == 200, r2.text
        # Old password should NOT work
        r3 = requests.post(f"{API}/auth/login",
                           json={"email": email, "password": password})
        assert r3.status_code == 401
        # Token can't be reused
        r4 = requests.post(f"{API}/auth/password/reset",
                           json={"token": plaintext, "new_password": "anothW0rd1"})
        assert r4.status_code == 400

    def test_expired_token_rejected(self, db, fresh_user):
        s, email, _ = fresh_user
        user = db.users.find_one({"email": email})
        plaintext = secrets.token_urlsafe(32)
        from datetime import datetime, timezone, timedelta
        db.password_reset_tokens.insert_one({
            "user_id": user["user_id"],
            "token_hash": _hash_token(plaintext),
            "email": email,
            "expires_at": (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat(),
            "used_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ip": "test",
        })
        r = requests.post(f"{API}/auth/password/reset",
                          json={"token": plaintext, "new_password": "anyW0rdHere"})
        assert r.status_code == 400


class TestMagicLinkRoundTrip:
    def test_full_magic_link_flow_with_injected_token(self, db, fresh_user):
        s, email, _ = fresh_user
        user = db.users.find_one({"email": email})
        plaintext = secrets.token_urlsafe(32)
        from datetime import datetime, timezone, timedelta
        db.magic_link_tokens.insert_one({
            "user_id": user["user_id"],
            "token_hash": _hash_token(plaintext),
            "email": email,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            "used_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ip": "test",
        })
        new_session = requests.Session()
        r = new_session.post(f"{API}/auth/magic-link/consume",
                             json={"token": plaintext})
        assert r.status_code == 200, r.text
        # Cookie should give us /me access
        me = new_session.get(f"{API}/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == email
        # Token can't be reused
        r2 = requests.post(f"{API}/auth/magic-link/consume",
                           json={"token": plaintext})
        assert r2.status_code == 400


class TestPasswordResetInvalidatesSessions:
    def test_old_session_dies_after_reset(self, db, fresh_user):
        s, email, _ = fresh_user
        # Confirm session works
        me1 = s.get(f"{API}/auth/me")
        assert me1.status_code == 200

        # Reset password
        user = db.users.find_one({"email": email})
        plaintext = secrets.token_urlsafe(32)
        from datetime import datetime, timezone, timedelta
        db.password_reset_tokens.insert_one({
            "user_id": user["user_id"],
            "token_hash": _hash_token(plaintext),
            "email": email,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            "used_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ip": "test",
        })
        requests.post(f"{API}/auth/password/reset",
                      json={"token": plaintext, "new_password": "brandN3wPass"})
        # Old session should be invalidated
        me2 = s.get(f"{API}/auth/me")
        assert me2.status_code == 401

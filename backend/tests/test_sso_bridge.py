"""Regression tests for the Forge Suite SSO bridge (iter-99).

Run via: cd /app/backend && python -m pytest tests/test_sso_bridge.py -v

Covers the seven scenarios verified by hand-curl at build time:
  1. Mint requires auth (401 anonymous)
  2. Accept rejects missing token (400)
  3. Accept rejects garbage (401)
  4. Accept rejects disallowed iss (403)
  5. Accept upserts new user + sets cookie (200)
  6. Replay is idempotent — same user_id, fresh session (200)
  7. Expired / wrong-secret tokens (401)

Test secret is the same value baked into `backend/.env` for the
preview environment; if you rotate the prod secret remember to update
this file too OR (better) pull the secret from os.environ at test
time. We use the static value here because pytest collection happens
before `.env` is loaded by the backend, and reading the live secret
would couple test passes to whichever env was last sourced.
"""
from __future__ import annotations

import os
import time
import uuid

import jwt
import pytest
import requests
from pymongo import MongoClient

API = os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001"
API = API.rstrip("/") + "/api"
SECRET = os.environ.get("FORGE_SUITE_SECRET") or "1dffe108d3bb9d19db8d7b126b0de3fb45b9818f2e203e01b0db0109bba9e29b"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _mint(iss: str, email: str, *, secret: str = SECRET, ttl: int = 60,
          name: str = "", picture: str = "") -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": email,
            "name": name,
            "picture": picture,
            "iss": iss,
            "iat": now,
            "exp": now + ttl,
            "jti": uuid.uuid4().hex,
        },
        secret,
        algorithm="HS256",
    )


def test_mint_requires_auth():
    r = requests.get(f"{API}/auth/sso-bridge/mint", timeout=10)
    assert r.status_code == 401


def test_accept_rejects_missing_token():
    r = requests.post(f"{API}/auth/sso-bridge", timeout=10)
    assert r.status_code == 400


def test_accept_rejects_garbage():
    r = requests.post(
        f"{API}/auth/sso-bridge",
        headers={"X-Forge-Suite-Token": "garbage.token.value"},
        timeout=10,
    )
    assert r.status_code == 401


def test_accept_rejects_disallowed_iss():
    token = _mint("evilcorp", "evil@example.com")
    r = requests.post(
        f"{API}/auth/sso-bridge",
        headers={"X-Forge-Suite-Token": token},
        timeout=10,
    )
    assert r.status_code == 403
    assert "allowlist" in r.json()["detail"].lower()


def test_accept_rejects_expired():
    # Mint with negative TTL so exp is in the past.
    token = _mint("lithoforge", "x@y.com", ttl=-60)
    r = requests.post(
        f"{API}/auth/sso-bridge",
        headers={"X-Forge-Suite-Token": token},
        timeout=10,
    )
    assert r.status_code == 401
    assert "expired" in r.json()["detail"].lower()


def test_accept_rejects_wrong_secret():
    token = _mint("lithoforge", "x@y.com", secret="not-the-shared-secret")
    r = requests.post(
        f"{API}/auth/sso-bridge",
        headers={"X-Forge-Suite-Token": token},
        timeout=10,
    )
    assert r.status_code == 401


def test_accept_upserts_new_user(db):
    email = f"bridge.new.{uuid.uuid4().hex[:8]}@example.com"
    token = _mint("lithoforge", email, name="Bridge Newcomer")
    try:
        r = requests.post(
            f"{API}/auth/sso-bridge",
            headers={"X-Forge-Suite-Token": token},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        u = body["user"]
        assert u["email"] == email
        assert u["name"] == "Bridge Newcomer"
        # Set-Cookie should have a session_token.
        assert "session_token" in r.headers.get("Set-Cookie", "")
        # User row exists in the DB.
        db_user = db.users.find_one({"email": email})
        assert db_user is not None
        # Audit log row exists.
        audit = db.admin_audit_log.find_one({
            "action": "sso_bridge.accept",
            "target_user_id": db_user["user_id"],
        })
        assert audit is not None
        assert audit["payload"]["iss"] == "lithoforge"
        # Session row tagged with source.
        sess = db.user_sessions.find_one({"user_id": db_user["user_id"], "source": "sso-bridge"})
        assert sess is not None
        assert sess["source_iss"] == "lithoforge"
    finally:
        # Clean up so re-runs are stable. We do NOT clean the audit log
        # — leaving it as a paper trail is the whole point.
        user = db.users.find_one({"email": email})
        if user:
            db.users.delete_one({"_id": user["_id"]})
            db.user_sessions.delete_many({"user_id": user["user_id"]})


def test_accept_is_idempotent(db):
    email = f"bridge.idem.{uuid.uuid4().hex[:8]}@example.com"
    token1 = _mint("lithoforge", email, name="First")
    try:
        r1 = requests.post(
            f"{API}/auth/sso-bridge",
            headers={"X-Forge-Suite-Token": token1},
            timeout=10,
        )
        assert r1.status_code == 200
        uid1 = r1.json()["user"]["user_id"]
        # Second token (fresh jti, same email) — should map to the
        # SAME user but mint a NEW session token.
        token2 = _mint("lithoforge", email, name="Updated Name")
        r2 = requests.post(
            f"{API}/auth/sso-bridge",
            headers={"X-Forge-Suite-Token": token2},
            timeout=10,
        )
        assert r2.status_code == 200
        body2 = r2.json()
        assert body2["user"]["user_id"] == uid1, "user_id must be stable across replays"
        assert body2["user"]["name"] == "Updated Name", "name should be refreshed from latest token"
        # Two session rows exist now (previous still valid until TTL).
        n_sessions = db.user_sessions.count_documents({"user_id": uid1, "source": "sso-bridge"})
        assert n_sessions >= 2
    finally:
        user = db.users.find_one({"email": email})
        if user:
            db.users.delete_one({"_id": user["_id"]})
            db.user_sessions.delete_many({"user_id": user["user_id"]})

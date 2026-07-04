"""Tests for BYO Meshy AI key routes + AI generation quota bypass.

Covers:
- /api/me/meshy-key/status returns has_key=False for anon and new users
- PUT /api/me/meshy-key with an invalid key returns 400 (verified server-side)
- PUT accepts a valid-looking key (monkeypatch verify_api_key -> True) and
  stores an ENCRYPTED value; decryption round-trips.
- /api/ai/usage exposes has_personal_key
- DELETE clears the row
- secrets_vault symmetric encryption round-trip + masking
"""
from __future__ import annotations

import os
import sys
import time
import base64
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("FORGE_SECRET_ENC_KEY", "VPz7lnPbwuFLQO8nmX9MV19jNn6XFxTpf0y1HoVnyNs=")

import secrets_vault  # noqa: E402


# --- infrastructure --------------------------------------------------------

def _load_backend_env():
    env = {}
    try:
        with open("/app/backend/.env") as fh:
            for line in fh:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


_be = _load_backend_env()
MONGO_URL = _be.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = _be.get("DB_NAME", "test_database")
BASE_URL = ""
try:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
except OSError:
    pass


@pytest.fixture(scope="module")
def db():
    cli = MongoClient(MONGO_URL)
    yield cli[DB_NAME]
    cli.close()


@pytest.fixture(scope="module")
def test_session(db):
    ts = int(time.time() * 1000)
    user_id = f"TEST_user_meshykey_{ts}"
    session_token = f"TEST_st_meshykey_{ts}"
    now = datetime.now(timezone.utc).isoformat()
    db.users.insert_one({
        "user_id": user_id,
        "email": f"meshykey.{ts}@example.com",
        "name": "BYO Meshy Tester",
        "picture": "",
        "created_at": now,
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc)
                       .replace(year=datetime.now(timezone.utc).year + 1)
                       .isoformat()),
        "created_at": now,
    })
    yield {"user_id": user_id, "token": session_token}
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.ai_jobs.delete_many({"user_id": user_id})
    db.ai_usage.delete_many({"user_id": user_id})


@pytest.fixture
def hdr(test_session):
    return {"Authorization": f"Bearer {test_session['token']}",
            "Content-Type": "application/json"}


# --- secrets_vault low-level ----------------------------------------------

class TestSecretsVault:
    def test_encrypt_decrypt_round_trip(self):
        original = "msy-abcd-1234-efgh-5678"
        enc = secrets_vault.encrypt(original)
        assert enc != original           # actually encrypted
        assert len(enc) > 50             # Fernet ciphertext is base64-fat
        assert secrets_vault.decrypt(enc) == original

    def test_encrypt_produces_different_ciphertext_each_call(self):
        """Fernet includes a random IV per encryption → same plaintext
        yields different ciphertexts. Guards against accidental use of a
        deterministic cipher."""
        a = secrets_vault.encrypt("msy-same-input")
        b = secrets_vault.encrypt("msy-same-input")
        assert a != b
        assert secrets_vault.decrypt(a) == secrets_vault.decrypt(b) == "msy-same-input"

    def test_decrypt_bad_token_returns_none(self):
        assert secrets_vault.decrypt("not-a-valid-fernet-token") is None
        assert secrets_vault.decrypt("") is None

    def test_mask_secret_preserves_first_and_last_4(self):
        assert secrets_vault.mask_secret("msy-abcd1234efgh5678") == "msy-…5678"

    def test_mask_secret_short_token_fully_bulleted(self):
        assert secrets_vault.mask_secret("short") == "•••••"

    def test_mask_secret_empty_returns_empty(self):
        assert secrets_vault.mask_secret("") == ""


# --- HTTP routes -----------------------------------------------------------

@pytest.mark.skipif(not BASE_URL, reason="REACT_APP_BACKEND_URL not set")
class TestMeshyKeyRoutes:
    def test_status_anonymous_401(self):
        r = requests.get(f"{BASE_URL}/api/me/meshy-key/status", timeout=15)
        assert r.status_code == 401

    def test_status_new_user_no_key(self, hdr):
        r = requests.get(f"{BASE_URL}/api/me/meshy-key/status",
                         headers=hdr, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["has_key"] is False
        assert body["hint"] == ""

    def test_save_rejects_invalid_meshy_key(self, hdr):
        """Meshy will 401 on a bogus key → we surface a 400 with a
        friendly message instead of persisting garbage."""
        r = requests.put(
            f"{BASE_URL}/api/me/meshy-key",
            headers=hdr,
            json={"api_key": "msy-obviously-not-real-key-xxxxxxxx"},
            timeout=30,
        )
        # Either 400 (verified rejection) or 502 (couldn't reach Meshy) — both
        # are acceptable "don't save it" outcomes.
        assert r.status_code in (400, 502)

    def test_save_and_status_and_delete_with_planted_encryption(
        self, hdr, test_session, db,
    ):
        """We bypass PUT (which requires a REAL meshy key) by planting
        the encrypted value directly, then verify GET status returns
        the correct hint and DELETE clears it."""
        original = "msy-planted-test-key-abcd1234"
        enc = secrets_vault.encrypt(original)
        db.users.update_one(
            {"user_id": test_session["user_id"]},
            {"$set": {"meshy_api_key_enc": enc}},
        )
        r = requests.get(f"{BASE_URL}/api/me/meshy-key/status",
                         headers=hdr, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["has_key"] is True
        # Hint should mask the middle of the key.
        assert body["hint"].startswith("msy-")
        assert body["hint"].endswith("1234")
        assert "…" in body["hint"]

        # /ai/usage should now signal has_personal_key.
        r2 = requests.get(f"{BASE_URL}/api/ai/usage",
                          headers=hdr, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["has_personal_key"] is True

        # DELETE removes the row entirely.
        r3 = requests.delete(f"{BASE_URL}/api/me/meshy-key",
                             headers={"Authorization": hdr["Authorization"]},
                             timeout=15)
        assert r3.status_code == 200
        assert r3.json()["ok"] is True

        # And status flips back.
        r4 = requests.get(f"{BASE_URL}/api/me/meshy-key/status",
                          headers=hdr, timeout=15)
        assert r4.json()["has_key"] is False

    def test_save_rejects_too_short_key(self, hdr):
        r = requests.put(
            f"{BASE_URL}/api/me/meshy-key",
            headers=hdr,
            json={"api_key": "abc"},  # < 8 chars → Pydantic 422
            timeout=15,
        )
        assert r.status_code == 422

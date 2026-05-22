"""End-to-end tests for the local-auth flows (email+password, magic link, reset).

These hit the running API via HTTP and the local MongoDB for token retrieval.
Tokens are stored hashed in MongoDB, so to simulate the email side we patch
`email_service.send_*_email` to capture the plaintext token from the URL.
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


def _unique_email():
    return f"local.auth.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"


class TestRegister:
    def test_register_and_login(self):
        email = _unique_email()
        r = requests.post(f"{API}/auth/register",
                          json={"name": "Tester", "email": email, "password": "passw0rd"},
                          timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == email
        assert body["has_password"] is True
        assert "password" in body["auth_methods"]

        # Session cookie should be set so /me works
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": email, "password": "passw0rd"},
                   timeout=15)
        assert r.status_code == 200, r.text
        me = s.get(f"{API}/auth/me", timeout=10)
        assert me.status_code == 200
        assert me.json()["email"] == email

    def test_register_weak_password_rejected(self):
        r = requests.post(f"{API}/auth/register",
                          json={"name": "X", "email": _unique_email(), "password": "short"},
                          timeout=10)
        assert r.status_code in (400, 422)

    def test_register_no_letter_rejected(self):
        r = requests.post(f"{API}/auth/register",
                          json={"name": "X", "email": _unique_email(), "password": "12345678"},
                          timeout=10)
        assert r.status_code == 400

    def test_duplicate_register_returns_409(self):
        email = _unique_email()
        r1 = requests.post(f"{API}/auth/register",
                           json={"name": "A", "email": email, "password": "passw0rd"})
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/auth/register",
                           json={"name": "B", "email": email, "password": "passw0rd"})
        assert r2.status_code == 409


class TestLogin:
    def test_wrong_password_returns_401(self):
        email = _unique_email()
        requests.post(f"{API}/auth/register",
                      json={"name": "X", "email": email, "password": "passw0rd"})
        r = requests.post(f"{API}/auth/login",
                          json={"email": email, "password": "wrongword"})
        assert r.status_code == 401

    def test_unknown_email_returns_401(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": "nobody.nowhere@example.com", "password": "passw0rd"})
        assert r.status_code == 401


class TestProfileUpdate:
    def test_update_profile_fields_and_shares(self):
        email = _unique_email()
        s = requests.Session()
        s.post(f"{API}/auth/register",
               json={"name": "Pat", "email": email, "password": "passw0rd"})
        r = s.put(f"{API}/me/profile", json={
            "city": "Austin",
            "state": "TX",
            "country": "USA",
            "contact_link": "https://example.com/pat",
            "share_location": True,
            "share_contact": True,
        }, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["city"] == "Austin"
        assert body["contact_link"] == "https://example.com/pat"
        assert body["share_location"] is True
        assert body["share_contact"] is True
        assert body["share_avatar"] is False  # unchanged


class TestForgotPassword:
    def test_forgot_password_known_and_unknown_both_200(self):
        email = _unique_email()
        requests.post(f"{API}/auth/register",
                      json={"name": "P", "email": email, "password": "passw0rd"})
        r1 = requests.post(f"{API}/auth/password/forgot", json={"email": email})
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/auth/password/forgot", json={"email": "nobody@nowhere.org"})
        assert r2.status_code == 200

    def test_reset_with_invalid_token_400(self):
        r = requests.post(f"{API}/auth/password/reset",
                          json={"token": "totally-fake-token", "new_password": "newpass123"})
        assert r.status_code == 400


class TestMagicLink:
    def test_magic_link_request_always_200(self):
        r = requests.post(f"{API}/auth/magic-link/request",
                          json={"email": "nobody@nowhere.io"})
        assert r.status_code == 200

    def test_consume_invalid_token(self):
        r = requests.post(f"{API}/auth/magic-link/consume",
                          json={"token": "not-a-real-token-just-padding"})
        assert r.status_code == 400


class TestAuthMeShape:
    def test_me_contains_share_toggles_for_new_user(self):
        email = _unique_email()
        s = requests.Session()
        s.post(f"{API}/auth/register",
               json={"name": "Y", "email": email, "password": "passw0rd"})
        body = s.get(f"{API}/auth/me").json()
        for key in ("share_contact", "share_avatar", "share_location",
                    "city", "state", "country", "contact_link", "avatar_url",
                    "auth_methods", "has_password"):
            assert key in body, f"missing {key} in /auth/me response"

"""Tests for the public author profile endpoints.

Critical invariants:
- Returns 404 for nonexistent users (no information leak about which IDs exist)
- Only includes optional fields when the user has explicitly toggled share_* on
- Never returns email, password_hash, or auth_methods
- Returns identical public_design_count whether the user has shared fields or not
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
def fresh_user_with_shares(db):
    """Register a user via the live API, then enable share_* toggles + fill
    in fields directly via Mongo (bypasses the auth cookie for the PUT
    /me/profile path)."""
    email = f"author.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": "Author Test",
        "email": email,
        "password": "passw0rdAuthor",
    })
    assert r.status_code == 200
    user_id = r.json()["user_id"]
    db.users.update_one({"user_id": user_id}, {"$set": {
        "avatar_url": "https://example.com/avatar.jpg",
        "contact_link": "https://example.com/contact",
        "city": "Austin", "state": "TX", "country": "USA",
        "share_avatar": True,
        "share_contact": True,
        "share_location": True,
    }})
    return user_id


@pytest.fixture
def fresh_user_no_shares():
    """Default-state user — share toggles all default to False."""
    email = f"private.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": "Private Maker",
        "email": email,
        "password": "passw0rdPrivate",
    })
    assert r.status_code == 200
    return r.json()["user_id"]


class TestAuthorProfileEndpoint:
    def test_404_for_unknown_user(self):
        r = requests.get(f"{API}/users/user_does_not_exist_123/profile")
        assert r.status_code == 404

    def test_user_without_shares_omits_optional_fields(self, fresh_user_no_shares):
        r = requests.get(f"{API}/users/{fresh_user_no_shares}/profile")
        assert r.status_code == 200
        body = r.json()
        # Always-public fields
        assert body["name"] == "Private Maker"
        assert body["user_id"] == fresh_user_no_shares
        assert "contributor_lifetime" in body
        assert "public_design_count" in body
        assert "public_component_count" in body
        # Optional fields MUST be absent when share toggle is off
        assert "avatar_url" not in body
        assert "contact_link" not in body
        assert "location" not in body

    def test_user_with_shares_includes_only_shared_fields(self, fresh_user_with_shares):
        r = requests.get(f"{API}/users/{fresh_user_with_shares}/profile")
        assert r.status_code == 200
        body = r.json()
        assert body["avatar_url"] == "https://example.com/avatar.jpg"
        assert body["contact_link"] == "https://example.com/contact"
        assert body["location"] == "Austin, TX, USA"

    def test_never_leaks_sensitive_fields(self, fresh_user_with_shares):
        r = requests.get(f"{API}/users/{fresh_user_with_shares}/profile")
        body = r.json()
        for forbidden in ("email", "password_hash", "auth_methods", "last_login_at"):
            assert forbidden not in body, f"leaked {forbidden}"

    def test_partial_share_only_shows_enabled_fields(self, db):
        """User enables share_avatar but NOT share_location — only avatar
        should appear, even though location data exists in their record."""
        email = f"partial.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
        r = requests.post(f"{API}/auth/register", json={
            "name": "Partial Sharer",
            "email": email,
            "password": "passw0rdPartial",
        })
        assert r.status_code == 200
        uid = r.json()["user_id"]
        db.users.update_one({"user_id": uid}, {"$set": {
            "avatar_url": "https://example.com/me.jpg",
            "city": "Portland",
            "share_avatar": True,
            "share_location": False,   # explicitly NOT shared
        }})
        body = requests.get(f"{API}/users/{uid}/profile").json()
        assert body["avatar_url"] == "https://example.com/me.jpg"
        assert "location" not in body


class TestAuthorDesignsComponents:
    def test_404_designs_for_unknown_user(self):
        r = requests.get(f"{API}/users/user_does_not_exist_xyz/designs")
        assert r.status_code == 404

    def test_404_components_for_unknown_user(self):
        r = requests.get(f"{API}/users/user_does_not_exist_xyz/components")
        assert r.status_code == 404

    def test_designs_returns_list_for_new_user(self, fresh_user_no_shares):
        r = requests.get(f"{API}/users/{fresh_user_no_shares}/designs")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert r.json() == []  # fresh user has no designs yet

    def test_components_returns_list_for_new_user(self, fresh_user_no_shares):
        r = requests.get(f"{API}/users/{fresh_user_no_shares}/components")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

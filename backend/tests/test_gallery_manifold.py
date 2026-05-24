"""Backend tests for the Manifold-verified gallery badge.

The field flows from the worker (where manifold-3d successfully merged the
scene) through the upload payload, into MongoDB, and back out on the GET
listings. These tests guarantee the API contract — silent regression on
this field would mean every newly-shared design loses its quality signal.
"""
import os
import pytest
import requests


BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
).rstrip("/")
API = f"{BASE_URL}/api"


def _make_session():
    """Register a fresh user and return their auth cookie jar."""
    import time, uuid
    s = requests.Session()
    email = f"manifest.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
    r = s.post(
        f"{API}/auth/register",
        json={"name": "Manifold Tester", "email": email, "password": "passw0rdMM"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return s


def _post_item(sess: requests.Session, manifold_verified: bool, private: bool = False):
    r = sess.post(
        f"{API}/gallery",
        json={
            "name": f"Manifold test {'on' if manifold_verified else 'off'}",
            "description": "",
            "stl_base64": "AAAA",   # minimal placeholder, slicing is not exercised here
            "thumbnail_base64": "",
            "triangle_count": 12,
            "object_count": 1,
            "license": "cc-by-4.0",
            "material": "pla",
            "manifold_verified": manifold_verified,
            "private": private,
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_create_and_list_with_manifold_verified_true():
    sess = _make_session()
    created = _post_item(sess, manifold_verified=True)
    assert created["manifold_verified"] is True

    # Public listing exposes the flag
    r = requests.get(f"{API}/gallery", timeout=15)
    assert r.status_code == 200
    listed = next((x for x in r.json() if x["id"] == created["id"]), None)
    assert listed is not None
    assert listed["manifold_verified"] is True


def test_default_manifold_verified_is_false():
    sess = _make_session()
    # Caller omits the field entirely → backend defaults to False
    r = sess.post(
        f"{API}/gallery",
        json={
            "name": "Default Manifold",
            "stl_base64": "AAAA",
            "triangle_count": 4,
        },
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["manifold_verified"] is False


def test_manifold_verified_persists_in_my_designs():
    sess = _make_session()
    created = _post_item(sess, manifold_verified=True, private=True)
    r = sess.get(f"{API}/me/designs", timeout=15)
    assert r.status_code == 200
    mine = r.json()
    target = next((x for x in mine if x["id"] == created["id"]), None)
    assert target is not None
    assert target["manifold_verified"] is True

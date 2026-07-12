"""Iter-135 targeted regression tests.

Covers three surfaces:

1. HTTP-level exercise of ``POST /api/printability/decimate`` and
   ``POST /api/printability/add-base`` through the public ingress. We
   generate a ~4 000-triangle icosphere STL locally with trimesh, POST
   it, and assert:

     * status 200 + binary STL body
     * X-Optimize-* metadata headers are present
     * ``Access-Control-Expose-Headers`` names each X-Optimize-* header
       (so ``fetch(...).headers.get(...)`` can read them in the browser)

2. Refactor-safety: admin pricing round-trip using extracted
   ``_serialize_pricing_row`` / ``_build_pricing_override`` helpers.
   Verifies GET works for super-admin, PUT works, PUT rejects
   early_amount > amount with 400, and rejects unknown package with
   400.

3. Refactor-safety: register endpoint's extracted
   ``_attach_password_to_google_account`` — insert a Google-only user
   row (no password_hash), then hit ``/api/auth/register`` with the
   same email and confirm status 200 + password_hash is now set (=
   attach path took, not the 409 duplicate path).
"""
from __future__ import annotations

import io
import os
import secrets
import struct
import time

import pytest
import requests
import trimesh
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------
@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def user_session():
    """A regular authenticated user for the printability endpoints (auth-gated)."""
    s = requests.Session()
    email = f"iter135.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = s.post(
        f"{API}/auth/register",
        json={"name": "Iter135 User", "email": email, "password": "passw0rdIter"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return s, r.json()["user_id"], email


@pytest.fixture(scope="module")
def super_admin_session(db):
    s = requests.Session()
    email = f"iter135sup.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = s.post(
        f"{API}/auth/register",
        json={"name": "Iter135 Sup", "email": email, "password": "passw0rdSuper"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    uid = r.json()["user_id"]
    db.users.update_one(
        {"user_id": uid}, {"$set": {"is_admin": True, "is_super_admin": True}}
    )
    return s, uid


@pytest.fixture(scope="module")
def sphere_stl_bytes() -> bytes:
    """~5 120-triangle icosphere STL — well over the 1 000-face
    ``min_faces`` on every decimate preset so the reduction actually
    happens."""
    mesh = trimesh.creation.icosphere(subdivisions=4, radius=15.0)
    buf = io.BytesIO()
    mesh.export(buf, file_type="stl")
    return buf.getvalue()


def _stl_triangle_count(stl_bytes: bytes) -> int:
    # Binary STL: 80-byte header, then uint32 triangle count.
    assert len(stl_bytes) >= 84
    return struct.unpack("<I", stl_bytes[80:84])[0]


# ---------------------------------------------------------------------
# 1. Printability endpoints — decimate + add-base
# ---------------------------------------------------------------------
class TestPrintabilityDecimate:
    def test_decimate_returns_stl_and_optimize_headers(
        self, user_session, sphere_stl_bytes
    ):
        s, _uid, _email = user_session
        files = {"file": ("input.stl", sphere_stl_bytes, "model/stl")}
        data = {"preset": "functional", "file_type": "stl"}
        r = s.post(f"{API}/printability/decimate", files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        # Binary STL response
        assert r.content[:5] != b"<html" and len(r.content) > 100
        # Metadata headers
        assert r.headers.get("X-Optimize-Preset") == "functional"
        assert r.headers.get("X-Optimize-Preset-Label")
        faces_before = int(r.headers.get("X-Optimize-Faces-Before", "0"))
        faces_after = int(r.headers.get("X-Optimize-Faces-After", "0"))
        red_pct = float(r.headers.get("X-Optimize-Reduction-Pct", "0"))
        assert faces_before > 0
        assert 0 < faces_after < faces_before
        assert red_pct > 0
        # STL body must line up with X-Optimize-Faces-After
        assert _stl_triangle_count(r.content) == faces_after

    def test_decimate_bad_preset_400(self, user_session, sphere_stl_bytes):
        s, *_ = user_session
        r = s.post(
            f"{API}/printability/decimate",
            files={"file": ("input.stl", sphere_stl_bytes, "model/stl")},
            data={"preset": "nope-preset", "file_type": "stl"},
            timeout=30,
        )
        assert r.status_code == 400
        assert "preset" in r.text.lower()

    def test_decimate_requires_auth(self, sphere_stl_bytes):
        r = requests.post(
            f"{API}/printability/decimate",
            files={"file": ("input.stl", sphere_stl_bytes, "model/stl")},
            data={"preset": "functional", "file_type": "stl"},
            timeout=30,
        )
        assert r.status_code == 401


class TestPrintabilityAddBase:
    def test_add_base_cylinder_returns_stl_and_headers(
        self, user_session, sphere_stl_bytes
    ):
        s, *_ = user_session
        files = {"file": ("input.stl", sphere_stl_bytes, "model/stl")}
        data = {
            "shape": "cylinder",
            "thickness_mm": "3.0",
            "margin_mm": "2.0",
            "file_type": "stl",
        }
        r = s.post(f"{API}/printability/add-base", files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        assert len(r.content) > 100
        assert r.headers.get("X-Optimize-Shape") == "cylinder"
        assert float(r.headers.get("X-Optimize-Thickness-Mm", "0")) == pytest.approx(3.0)
        assert float(r.headers.get("X-Optimize-Margin-Mm", "0")) == pytest.approx(2.0)
        assert float(r.headers.get("X-Optimize-Base-Footprint-Mm2", "0")) > 0
        assert int(r.headers.get("X-Optimize-Faces-Before", "0")) > 0
        assert int(r.headers.get("X-Optimize-Faces-After", "0")) > 0

    def test_add_base_bad_shape_400(self, user_session, sphere_stl_bytes):
        s, *_ = user_session
        r = s.post(
            f"{API}/printability/add-base",
            files={"file": ("input.stl", sphere_stl_bytes, "model/stl")},
            data={"shape": "triangle", "file_type": "stl"},
            timeout=30,
        )
        assert r.status_code == 400
        assert "shape" in r.text.lower()


class TestOptimizeCORSExpose:
    """CORS must expose the X-Optimize-* headers so the frontend's
    ``fetch(...).headers.get('X-Optimize-Faces-After')`` returns the
    value (otherwise the browser hides them and the client reads null).
    """

    def test_expose_headers_lists_all_optimize_headers(
        self, user_session, sphere_stl_bytes
    ):
        s, *_ = user_session
        # Preflight-style request — the real POST will also emit the
        # Access-Control-Expose-Headers header when Origin is set.
        # We hit the actual POST and check the response headers.
        headers = {
            "Origin": "https://forgeslicer.com",
        }
        r = s.post(
            f"{API}/printability/decimate",
            files={"file": ("input.stl", sphere_stl_bytes, "model/stl")},
            data={"preset": "functional", "file_type": "stl"},
            headers=headers,
            timeout=60,
        )
        assert r.status_code == 200
        expose = (r.headers.get("Access-Control-Expose-Headers") or "").lower()
        for name in (
            "x-optimize-preset",
            "x-optimize-preset-label",
            "x-optimize-faces-before",
            "x-optimize-faces-after",
            "x-optimize-reduction-pct",
            "x-optimize-shape",
            "x-optimize-thickness-mm",
            "x-optimize-margin-mm",
            "x-optimize-base-footprint-mm2",
        ):
            assert name in expose, f"missing {name!r} in Access-Control-Expose-Headers: {expose!r}"


# ---------------------------------------------------------------------
# 2. Pricing endpoint refactor safety
# ---------------------------------------------------------------------
class TestPricingRefactor:
    def test_get_pricing_returns_catalog_for_super_admin(self, super_admin_session):
        s, _uid = super_admin_session
        r = s.get(f"{API}/admin/pricing", timeout=30)
        assert r.status_code == 200, r.text
        catalog = r.json()
        assert isinstance(catalog, dict) and catalog, "empty pricing catalog"
        # Every row should carry the serialized `sold` count injected by
        # _serialize_pricing_row.
        for pid, pkg in catalog.items():
            assert "amount" in pkg, f"missing amount on {pid}: {pkg}"
            assert "sold" in pkg, f"_serialize_pricing_row didn't inject sold on {pid}: {pkg}"

    def test_get_pricing_403_for_non_super_admin(self):
        anon = requests.Session()
        r = anon.get(f"{API}/admin/pricing", timeout=30)
        # Unauth = 401; regular-admin would be 403. Both mean "the
        # super-admin gate is doing its job".
        assert r.status_code in (401, 403), r.text

    def test_put_pricing_rejects_early_over_regular(self, super_admin_session):
        s, _uid = super_admin_session
        # Grab a real package id from the catalog so we don't 400 on
        # unknown-pid before the early>amount check runs.
        cat = s.get(f"{API}/admin/pricing", timeout=30).json()
        pid = next(iter(cat.keys()))
        body = {
            "packages": {
                pid: {"amount": 10.00, "early_amount": 99.99, "early_limit": 5}
            }
        }
        r = s.put(f"{API}/admin/pricing", json=body, timeout=30)
        assert r.status_code == 400, r.text
        assert "early" in r.text.lower()

    def test_put_pricing_rejects_unknown_package(self, super_admin_session):
        s, _uid = super_admin_session
        body = {"packages": {"totally-not-a-real-package": {"amount": 1.0}}}
        r = s.put(f"{API}/admin/pricing", json=body, timeout=30)
        assert r.status_code == 400
        assert "unknown" in r.text.lower() or "package" in r.text.lower()

    def test_put_pricing_happy_path_persists(self, super_admin_session):
        s, _uid = super_admin_session
        before = s.get(f"{API}/admin/pricing", timeout=30).json()
        pid = next(iter(before.keys()))
        original_amount = float(before[pid]["amount"])
        new_amount = round(original_amount + 0.55, 2)
        body = {"packages": {pid: {"amount": new_amount}}}
        r = s.put(f"{API}/admin/pricing", json=body, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # Verify GET reflects the change.
        after = s.get(f"{API}/admin/pricing", timeout=30).json()
        assert float(after[pid]["amount"]) == pytest.approx(new_amount)
        # Restore the original amount so we leave state clean.
        s.put(
            f"{API}/admin/pricing",
            json={"packages": {pid: {"amount": original_amount}}},
            timeout=30,
        )


# ---------------------------------------------------------------------
# 3. Register endpoint's _attach_password_to_google_account
# ---------------------------------------------------------------------
class TestAttachPasswordToGoogleAccount:
    def test_register_attaches_password_to_google_only_row(self, db):
        # Seed a Google-only user (no password_hash) directly in Mongo.
        email = f"iter135.google.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
        uid = f"user_google_{secrets.token_hex(6)}"
        db.users.insert_one(
            {
                "user_id": uid,
                "email": email,
                "name": "Google Only",
                "picture": "",
                "created_at": "2026-01-01T00:00:00Z",
                # NOTE: intentionally no password_hash — this simulates
                # a user who signed in via Google OAuth first.
            }
        )
        try:
            r = requests.post(
                f"{API}/auth/register",
                json={"name": "New Name", "email": email, "password": "passw0rdAttach"},
                timeout=30,
            )
            assert r.status_code == 200, r.text
            # The attach helper should have written a password_hash onto
            # the SAME user row (not created a duplicate).
            rows = list(db.users.find({"email": email}))
            assert len(rows) == 1, f"attach path duplicated the user row: {rows}"
            row = rows[0]
            assert row["user_id"] == uid, "attach path replaced user_id — regression"
            assert row.get("password_hash"), "password_hash was not attached"
            assert row["password_hash"].startswith("$2b$"), (
                f"password_hash not bcrypt: {row['password_hash'][:10]}..."
            )
            # Re-registering now must 409 (password_hash already set).
            r2 = requests.post(
                f"{API}/auth/register",
                json={"name": "Again", "email": email, "password": "passw0rdAttach2"},
                timeout=30,
            )
            assert r2.status_code == 409, r2.text
        finally:
            db.users.delete_many({"email": email})
            db.user_sessions.delete_many({"user_id": uid})

    def test_register_fresh_email_creates_new_user(self):
        email = f"iter135.fresh.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
        r = requests.post(
            f"{API}/auth/register",
            json={"name": "Fresh Person", "email": email, "password": "passw0rdFresh"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("user_id")
        assert body.get("email") == email

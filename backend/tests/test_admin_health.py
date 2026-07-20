"""Tests for the /admin/health endpoints introduced in iter-148.

Covers:
- /api/admin/regenerate-thumbnails      (POST — kicks off worker)
- /api/admin/regenerate-thumbnails/status (GET — polling)
- /api/admin/ai-errors                  (GET — recent failures + rates)
- thumbnail_service.render_stl_thumbnail (unit tests)

All admin endpoints share the same auth gate as the rest of /api/admin/*,
so we spot-check auth via a regular-user session and rely on
test_admin.py's exhaustive gate coverage for the deeper cases.
"""
import base64
import io
import os
import secrets
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests
import trimesh
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
    s = requests.Session()
    email = f"reg.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = s.post(f"{API}/auth/register", json={
        "name": "Regular User", "email": email, "password": "passw0rdRegular",
    })
    assert r.status_code == 200
    return s, r.json()["user_id"]


@pytest.fixture
def admin_session(db):
    s = requests.Session()
    email = f"adm.{int(time.time()*1000)}.{secrets.token_hex(3)}@example.com"
    r = s.post(f"{API}/auth/register", json={
        "name": "Admin", "email": email, "password": "passw0rdAdmin",
    })
    assert r.status_code == 200
    uid = r.json()["user_id"]
    db.users.update_one({"user_id": uid}, {"$set": {"is_admin": True}})
    return s, uid


@pytest.fixture
def real_stl_b64():
    """A minimal, valid STL body that the renderer can actually parse."""
    m = trimesh.creation.icosphere(subdivisions=2)
    buf = io.BytesIO()
    m.export(buf, file_type="stl")
    return base64.b64encode(buf.getvalue()).decode()


class TestAuthGates:
    def test_status_requires_auth(self):
        r = requests.get(f"{API}/admin/regenerate-thumbnails/status")
        assert r.status_code == 401

    def test_start_requires_auth(self):
        r = requests.post(f"{API}/admin/regenerate-thumbnails")
        assert r.status_code == 401

    def test_ai_errors_requires_auth(self):
        r = requests.get(f"{API}/admin/ai-errors")
        assert r.status_code == 401

    def test_status_forbidden_for_regular_user(self, regular_user_session):
        s, _ = regular_user_session
        r = s.get(f"{API}/admin/regenerate-thumbnails/status")
        assert r.status_code == 403

    def test_ai_errors_forbidden_for_regular_user(self, regular_user_session):
        s, _ = regular_user_session
        r = s.get(f"{API}/admin/ai-errors")
        assert r.status_code == 403


class TestRegenerateThumbnails:
    def test_status_returns_shape(self, admin_session):
        s, _ = admin_session
        r = s.get(f"{API}/admin/regenerate-thumbnails/status")
        assert r.status_code == 200
        body = r.json()
        for k in ("status", "total", "processed", "regenerated", "skipped_no_stl", "errors"):
            assert k in body
        assert body["status"] in ("idle", "running", "done", "error")

    def test_regenerates_missing_thumbnail(self, admin_session, db, real_stl_b64):
        s, _ = admin_session
        # Seed a component missing a thumbnail but with a real STL body.
        item_id = f"iter148-thumb-{int(time.time()*1000)}-{secrets.token_hex(3)}"
        db.components.insert_one({
            "id": item_id,
            "name": "iter148 seed",
            "author": "test",
            "description": "",
            "stl_base64": real_stl_b64,
            "thumbnail_base64": "",
            "triangle_count": 320,
            "object_count": 1,
            "downloads": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "user_id": None,
            "private": True,
            "license": "cc-by-4.0",
            "material": "pla",
            "manifold_verified": True,
            "category": "misc",
            "tags": [],
        })
        try:
            r = s.post(f"{API}/admin/regenerate-thumbnails")
            assert r.status_code == 200
            # Poll for completion (bounded — worker is fast).
            for _ in range(30):
                time.sleep(0.5)
                status = s.get(f"{API}/admin/regenerate-thumbnails/status").json()
                if status["status"] in ("done", "error"):
                    break
            assert status["status"] == "done", status
            doc = db.components.find_one({"id": item_id})
            assert doc is not None
            assert len(doc.get("thumbnail_base64") or "") > 500, "thumbnail should have been rendered"
        finally:
            db.components.delete_one({"id": item_id})


class TestAIErrors:
    def test_returns_shape(self, admin_session):
        s, _ = admin_session
        r = s.get(f"{API}/admin/ai-errors", params={"limit": 5})
        assert r.status_code == 200
        body = r.json()
        for k in ("recent_failures", "failed_24h", "total_24h",
                  "failure_rate_24h_pct", "failed_7d", "total_7d",
                  "failure_rate_7d_pct"):
            assert k in body

    def test_counts_seeded_failure(self, admin_session, db):
        s, _ = admin_session
        job_id = f"iter148-fail-{int(time.time()*1000)}"
        now_iso = datetime.now(timezone.utc).isoformat()
        db.ai_jobs.insert_one({
            "job_id": job_id,
            "user_id": "iter148-owner",
            "kind": "text-to-3d",
            "provider": "fal",
            "status": "FAILED",
            "error": "iter148: seeded upstream failure",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        try:
            r = s.get(f"{API}/admin/ai-errors", params={"limit": 20})
            body = r.json()
            assert any(f["job_id"] == job_id for f in body["recent_failures"])
            assert body["failed_24h"] >= 1
            assert body["failure_rate_24h_pct"] >= 0.0
        finally:
            db.ai_jobs.delete_one({"job_id": job_id})


class TestThumbnailService:
    def test_renders_png(self, real_stl_b64):
        from thumbnail_service import render_stl_thumbnail
        png_b64 = render_stl_thumbnail(real_stl_b64)
        raw = base64.b64decode(png_b64)
        assert raw[:8] == b"\x89PNG\r\n\x1a\n"
        assert len(raw) > 1000

    def test_rejects_empty(self):
        from thumbnail_service import render_stl_thumbnail
        with pytest.raises(ValueError):
            render_stl_thumbnail("")

    def test_helpers(self):
        from thumbnail_service import has_usable_stl, is_missing_thumbnail
        assert is_missing_thumbnail({}) is True
        assert is_missing_thumbnail({"thumbnail_base64": ""}) is True
        assert is_missing_thumbnail({"thumbnail_base64": "x" * 300}) is False
        assert has_usable_stl({}) is False
        assert has_usable_stl({"stl_base64": "x" * 600}) is True

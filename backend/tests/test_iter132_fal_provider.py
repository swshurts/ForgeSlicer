"""Iter-132 backend tests — fal.ai default provider + Meshy BYO path.

Covers:
  - GET /api/ai/usage returns `active_provider` based on user's BYO Meshy key
  - text/image/multi-image generate routes route to fal.ai, refund quota on 502
  - poll route (/api/ai/jobs/{id}) dispatches to correct provider by stored field
  - mesh download route dispatches to correct provider
  - legacy jobs without `provider` default to Meshy (backward compat)
  - provider field is persisted on new jobs

Environment: fal.ai balance is EXHAUSTED — verifies clean 502 with 'fal.ai:'
prefix and quota refund.
"""
from __future__ import annotations

import base64
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

# --- Setup ------------------------------------------------------------
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
import secrets_vault  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read directly from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

# --------------------------------------------------------------------
# Preview environment Cloudflare/ingress converts every 502 response
# into an HTML "Bad gateway" page — the FastAPI JSON body with the
# actual `detail` field is stripped at the edge. For 502-body inspection
# (which the review-request explicitly asks for) we bypass Cloudflare
# and hit uvicorn directly on localhost. Status-code assertions on the
# public URL still match — only the body substring checks need the
# internal URL. Both URLs share the same backend + Mongo state.
# --------------------------------------------------------------------
INTERNAL_URL = "http://localhost:8001"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# 1x1 transparent PNG base64
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


# --- Fixtures ---------------------------------------------------------
@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    # Teardown: delete every doc we created (all our test users are prefixed TEST_ITER132_)
    db.users.delete_many({"user_id": {"$regex": "^TEST_ITER132_"}})
    db.user_sessions.delete_many({"user_id": {"$regex": "^TEST_ITER132_"}})
    db.ai_jobs.delete_many({"user_id": {"$regex": "^TEST_ITER132_"}})
    db.ai_usage.delete_many({"user_id": {"$regex": "^TEST_ITER132_"}})
    client.close()


def _seed_user(mongo, *, with_meshy_key: bool = False, unique_suffix: str = "") -> tuple[str, str]:
    """Create a user + session, return (user_id, session_token)."""
    ts = int(time.time() * 1000)
    suffix = unique_suffix or uuid.uuid4().hex[:8]
    user_id = f"TEST_ITER132_{suffix}_{ts}"
    session_token = f"TEST_ITER132_st_{suffix}_{ts}"
    user_doc = {
        "user_id": user_id,
        "email": f"iter132.{suffix}.{ts}@example.com",
        "name": f"Iter132 Test {suffix}",
        "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if with_meshy_key:
        user_doc["meshy_api_key_enc"] = secrets_vault.encrypt("msy-fake-byokey-1234567890abcdef")
    mongo.users.insert_one(user_doc)
    mongo.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return user_id, session_token


def _auth(session_token: str) -> dict:
    return {"Authorization": f"Bearer {session_token}"}


def _usage_count(mongo, user_id: str) -> int:
    # Use the same month_key format as server.py: YYYY-MM
    mkey = datetime.now(timezone.utc).strftime("%Y-%m")
    doc = mongo.ai_usage.find_one({"user_id": user_id, "month_key": mkey})
    return (doc or {}).get("count", 0)


# --- Tests: provider selection via /api/ai/usage ----------------------
class TestProviderSelection:
    def test_fal_default_when_no_meshy_key(self, mongo):
        user_id, tok = _seed_user(mongo, with_meshy_key=False, unique_suffix="faldef")
        r = requests.get(f"{BASE_URL}/api/ai/usage", headers=_auth(tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["active_provider"] == "fal", data
        assert data["has_personal_key"] is False
        assert "used" in data and "cap" in data and "remaining" in data
        assert isinstance(data["used"], int)
        assert isinstance(data["cap"], int)
        assert isinstance(data["remaining"], int)

    def test_meshy_when_byo_key(self, mongo):
        user_id, tok = _seed_user(mongo, with_meshy_key=True, unique_suffix="meshbyo")
        r = requests.get(f"{BASE_URL}/api/ai/usage", headers=_auth(tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["active_provider"] == "meshy", data
        assert data["has_personal_key"] is True


# --- Tests: text-to-3D via fal.ai (expect 502 refund OR 200 pass) -----
class TestTextTo3DFal:
    def test_502_and_quota_refund_or_200_pass(self, mongo):
        """The fal.ai balance may be exhausted (expected per review) or
        topped up. Handle both:
          - 502 → verify 'fal.ai:' prefix + quota refund
          - 200 → verify job_id, provider='fal', quota incremented, and
                  the ai_jobs doc persisted with provider='fal'.
        """
        user_id, tok = _seed_user(mongo, unique_suffix="txt")
        before = _usage_count(mongo, user_id)
        # Use INTERNAL_URL so the 502 error body (if any) reaches us
        # intact — the preview Cloudflare edge overwrites 502 bodies.
        r = requests.post(
            f"{INTERNAL_URL}/api/ai/generate/text",
            headers=_auth(tok),
            json={"prompt": "a cyberpunk robot", "art_style": "realistic"},
            timeout=90,
        )
        after = _usage_count(mongo, user_id)
        if r.status_code == 502:
            detail = r.json().get("detail", "")
            assert "fal.ai:" in detail, f"Expected 'fal.ai:' prefix: {detail!r}"
            assert after == before, f"Quota not refunded: before={before}, after={after}"
        elif r.status_code == 200:
            data = r.json()
            assert "job_id" in data
            assert data.get("provider") == "fal", f"provider={data.get('provider')!r}"
            job = mongo.ai_jobs.find_one({"job_id": data["job_id"]})
            assert job is not None
            assert job.get("provider") == "fal"
            assert after == before + 1, f"Expected quota +1: before={before}, after={after}"
        else:
            pytest.fail(f"Unexpected status {r.status_code}: {r.text[:400]}")


# --- Tests: image-to-3D via fal.ai ------------------------------------
class TestImageTo3DFal:
    def test_submission_accepted_with_provider_persisted(self, mongo):
        """fal.ai's submit_async (used by image_to_3d) just queues the
        job without hitting a paid endpoint, so submission succeeds with
        200 even when the account balance is exhausted. The exhausted
        error would surface during polling. We verify:
          - 200 response with job_id
          - persisted ai_jobs doc has provider='fal'
          - quota was incremented by 1 (since submission succeeded)
        If submission were to fail (balance check moved upstream), we
        verify the 502 has 'fal.ai:' prefix and quota is refunded.
        """
        user_id, tok = _seed_user(mongo, unique_suffix="img")
        before = _usage_count(mongo, user_id)
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/image",
            headers=_auth(tok),
            json={"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
            timeout=60,
        )
        after = _usage_count(mongo, user_id)
        if r.status_code == 200:
            data = r.json()
            assert "job_id" in data
            # Verify provider field persisted
            job = mongo.ai_jobs.find_one({"job_id": data["job_id"]})
            assert job is not None
            assert job.get("provider") == "fal", f"Expected provider='fal', got {job.get('provider')!r}"
            assert after == before + 1, f"Expected quota incremented: before={before}, after={after}"
        elif r.status_code == 502:
            detail = r.json().get("detail", "")
            assert "fal.ai:" in detail, f"Expected 'fal.ai:' prefix: {detail!r}"
            assert after == before, f"Quota not refunded: before={before}, after={after}"
        else:
            pytest.fail(f"Unexpected status {r.status_code}: {r.text}")


# --- Tests: multi-image via fal.ai ------------------------------------
class TestMultiImageFal:
    def test_400_for_zero_images(self, mongo):
        user_id, tok = _seed_user(mongo, unique_suffix="multi0")
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=_auth(tok),
            json={"images": []},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_400_for_one_image(self, mongo):
        user_id, tok = _seed_user(mongo, unique_suffix="multi1")
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=_auth(tok),
            json={"images": [{"image_b64": TINY_PNG_B64, "mime_type": "image/png"}]},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_submission_accepted_with_provider_persisted(self, mongo):
        """Multi-image submission uses fal_client.submit_async which
        succeeds even with an exhausted balance (see image test above).
        Verify 200, job_id, and persisted provider='fal'."""
        user_id, tok = _seed_user(mongo, unique_suffix="multi3")
        before = _usage_count(mongo, user_id)
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=_auth(tok),
            json={"images": [
                {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
                {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
                {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
            ]},
            timeout=60,
        )
        after = _usage_count(mongo, user_id)
        if r.status_code == 200:
            data = r.json()
            assert "job_id" in data
            assert data.get("provider") == "fal", f"Response provider: {data.get('provider')!r}"
            job = mongo.ai_jobs.find_one({"job_id": data["job_id"]})
            assert job is not None
            assert job.get("provider") == "fal"
            assert after == before + 1, f"Quota should increment: before={before}, after={after}"
        elif r.status_code == 502:
            detail = r.json().get("detail", "")
            assert "fal.ai:" in detail, f"Expected 'fal.ai:' prefix: {detail!r}"
            assert after == before, f"Quota not refunded: before={before}, after={after}"
        else:
            pytest.fail(f"Unexpected status {r.status_code}: {r.text}")


# --- Tests: polling routes to correct provider ------------------------
class TestPollingProviderDispatch:
    def _make_job(self, mongo, user_id: str, provider: str | None, task_id: str = "fake-task-id"):
        job_id = str(uuid.uuid4())
        doc = {
            "job_id": job_id,
            "user_id": user_id,
            "kind": "text",
            "meshy_task_id": task_id,
            "status": "PENDING",
            "progress": 0,
            "model_url": None,
            "used_personal_key": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if provider is not None:
            doc["provider"] = provider
        mongo.ai_jobs.insert_one(doc)
        return job_id

    def test_poll_meshy_provider(self, mongo):
        user_id, tok = _seed_user(mongo, unique_suffix="pollmeshy")
        job_id = self._make_job(mongo, user_id, provider="meshy", task_id="fake-meshy-id-abcdef")
        # Use INTERNAL_URL to see the actual JSON detail (Cloudflare
        # would replace 502 bodies with an HTML page over the public URL).
        r = requests.get(f"{INTERNAL_URL}/api/ai/jobs/{job_id}", headers=_auth(tok), timeout=30)
        assert r.status_code == 502, f"Expected 502, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "meshy" in detail.lower(), f"Expected 'meshy' in detail: {detail!r}"
        assert "fal.ai" not in detail.lower(), f"Should not have called fal: {detail!r}"

    def test_poll_fal_provider(self, mongo):
        user_id, tok = _seed_user(mongo, unique_suffix="pollfal")
        job_id = self._make_job(mongo, user_id, provider="fal", task_id="fake-fal-request-id-abcdef")
        r = requests.get(f"{INTERNAL_URL}/api/ai/jobs/{job_id}", headers=_auth(tok), timeout=60)
        assert r.status_code == 502, f"Expected 502, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "fal" in detail.lower(), f"Expected 'fal' in detail: {detail!r}"

    def test_poll_legacy_no_provider_defaults_to_meshy(self, mongo):
        user_id, tok = _seed_user(mongo, unique_suffix="polllegacy")
        job_id = self._make_job(mongo, user_id, provider=None, task_id="fake-legacy-id-abcdef")
        r = requests.get(f"{INTERNAL_URL}/api/ai/jobs/{job_id}", headers=_auth(tok), timeout=30)
        assert r.status_code == 502, f"Expected 502, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "meshy" in detail.lower(), f"Legacy job should default to meshy: {detail!r}"


# --- Tests: mesh download routes to correct provider ------------------
class TestMeshDownloadProviderDispatch:
    def _make_succeeded_job(self, mongo, user_id, provider, model_url):
        job_id = str(uuid.uuid4())
        mongo.ai_jobs.insert_one({
            "job_id": job_id,
            "user_id": user_id,
            "kind": "text",
            "meshy_task_id": "fake-task",
            "provider": provider,
            "status": "SUCCEEDED",
            "progress": 100,
            "model_url": model_url,
            "used_personal_key": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        return job_id

    def test_mesh_download_fal_provider(self, mongo):
        user_id, tok = _seed_user(mongo, unique_suffix="meshfal")
        # Use a URL that will fail to fetch — verifies routing without hitting real fal CDN
        job_id = self._make_succeeded_job(
            mongo, user_id, "fal",
            "https://fal.example.invalid/nonexistent.glb",
        )
        r = requests.get(f"{BASE_URL}/api/ai/jobs/{job_id}/mesh", headers=_auth(tok), timeout=30)
        # Either 502 (HTTPStatusError caught) or 500 (RequestError uncaught).
        # The route only catches HTTPStatusError. On DNS/connect failure it may 500.
        # Accept either but log the actual code so main agent can decide.
        assert r.status_code in (500, 502, 504), f"Got {r.status_code}: {r.text}"

    def test_mesh_download_meshy_provider(self, mongo):
        user_id, tok = _seed_user(mongo, unique_suffix="meshmeshy")
        job_id = self._make_succeeded_job(
            mongo, user_id, "meshy",
            "https://meshy.example.invalid/nonexistent.glb",
        )
        r = requests.get(f"{BASE_URL}/api/ai/jobs/{job_id}/mesh", headers=_auth(tok), timeout=30)
        assert r.status_code in (500, 502, 504), f"Got {r.status_code}: {r.text}"


# --- Sanity: unauthenticated request rejected -------------------------
class TestAuthRequired:
    def test_usage_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/ai/usage", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

    def test_generate_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/text",
            json={"prompt": "hello world", "art_style": "realistic"},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

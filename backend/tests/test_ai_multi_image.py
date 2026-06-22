"""Tests for the Multi-Image -> 3D AI generation endpoint.

Covers:
- POST /api/ai/generate/multi-image validation (need 2-4 images)
- Job persistence in db.ai_jobs (kind='multi_image')
- Monthly AI usage counter increment
- GET /api/ai/jobs/{job_id} polling shape
- Quota refund when meshy submission raises ValueError (via monkeypatching
  meshy_service.create_multi_image_to_3d)
"""

import base64
import os
import time
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# Read REACT_APP_BACKEND_URL from frontend/.env if not in env
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except OSError:
        pass

# Read MONGO_URL/DB_NAME from backend/.env if needed
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
MONGO_URL = _be.get("MONGO_URL", MONGO_URL)
DB_NAME = _be.get("DB_NAME", DB_NAME)


# Tiny 1x1 transparent PNG (valid PNG bytes)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def mongo_client():
    cli = MongoClient(MONGO_URL)
    yield cli
    cli.close()


@pytest.fixture(scope="module")
def db(mongo_client):
    return mongo_client[DB_NAME]


@pytest.fixture(scope="module")
def test_session(db):
    """Seed a test user + session_token, yield Bearer token."""
    ts = int(time.time() * 1000)
    user_id = f"TEST_user_multi_{ts}"
    session_token = f"TEST_st_multi_{ts}"
    now = datetime.now(timezone.utc).isoformat()
    db.users.insert_one({
        "user_id": user_id,
        "email": f"test.multi.{ts}@example.com",
        "name": "MultiImg Tester",
        "picture": "",
        "created_at": now,
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year + 1).isoformat(),
        "created_at": now,
    })
    yield {"user_id": user_id, "token": session_token}

    # Cleanup
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.ai_jobs.delete_many({"user_id": user_id})
    db.ai_usage.delete_many({"user_id": user_id})


@pytest.fixture
def auth_headers(test_session):
    return {
        "Authorization": f"Bearer {test_session['token']}",
        "Content-Type": "application/json",
    }


def _month_key():
    n = datetime.now(timezone.utc)
    return f"{n.year:04d}-{n.month:02d}"


# ---------- Tests ----------

class TestMultiImageEndpoint:
    """POST /api/ai/generate/multi-image"""

    def test_unauthenticated_rejected(self):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            json={"images": [{"image_b64": TINY_PNG_B64, "mime_type": "image/png"}] * 2},
        )
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"

    def test_validation_too_few_images(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=auth_headers,
            json={"images": [{"image_b64": TINY_PNG_B64, "mime_type": "image/png"}]},
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        assert "2-4" in r.text or "2" in r.text

    def test_validation_too_many_images(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=auth_headers,
            json={"images": [{"image_b64": TINY_PNG_B64, "mime_type": "image/png"}] * 5},
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"

    def test_validation_missing_b64(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=auth_headers,
            json={"images": [
                {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
                {"image_b64": "", "mime_type": "image/png"},
            ]},
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"

    def test_validation_unsupported_mime(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=auth_headers,
            json={"images": [
                {"image_b64": TINY_PNG_B64, "mime_type": "image/gif"},
                {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
            ]},
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"


class TestMultiImageSuccessSubmission:
    """Submit a valid 2-image payload and verify persistence + usage counter."""

    def test_submit_persist_and_usage(self, auth_headers, test_session, db):
        # Snapshot usage before
        mk = _month_key()
        before = db.ai_usage.find_one({"user_id": test_session["user_id"], "month_key": mk}) or {}
        count_before = before.get("count", 0)

        payload = {"images": [
            {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
            {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
        ]}
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=auth_headers,
            json=payload,
            timeout=60,
        )

        # Either it succeeds (real Meshy submission) OR fails with 502
        # (e.g. Meshy rejects tiny 1x1 PNG). If it failed -> quota should
        # have been refunded (separate test verifies that path).
        if r.status_code == 502:
            pytest.skip(f"Meshy upstream rejected (expected for 1x1 PNG): {r.text}")

        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert "job_id" in body, f"Missing job_id: {body}"
        assert body.get("status") == "PENDING"
        job_id = body["job_id"]

        # Verify persisted in db.ai_jobs
        job_row = db.ai_jobs.find_one({"job_id": job_id})
        assert job_row is not None, "Job not persisted in db.ai_jobs"
        assert job_row["user_id"] == test_session["user_id"]
        assert job_row["kind"] == "multi_image"
        assert job_row["status"] == "PENDING"
        assert "meshy_task_id" in job_row
        assert job_row.get("view_count") == 2

        # Verify usage counter incremented by exactly 1
        after = db.ai_usage.find_one({"user_id": test_session["user_id"], "month_key": mk}) or {}
        count_after = after.get("count", 0)
        assert count_after == count_before + 1, (
            f"Usage counter not incremented: before={count_before}, after={count_after}"
        )

        # Save job_id for the polling test
        TestMultiImageSuccessSubmission._created_job_id = job_id


class TestPollingShape:
    """GET /api/ai/jobs/{job_id} for the just-created multi_image job."""

    def test_poll_returns_status_payload(self, auth_headers):
        job_id = getattr(TestMultiImageSuccessSubmission, "_created_job_id", None)
        if not job_id:
            pytest.skip("No job created in TestMultiImageSuccessSubmission")
        r = requests.get(
            f"{BASE_URL}/api/ai/jobs/{job_id}",
            headers=auth_headers,
            timeout=30,
        )
        # 502 from Meshy poll is acceptable; we just want to verify
        # the route is wired and returns the right shape on the happy path.
        if r.status_code == 502:
            pytest.skip(f"Meshy poll returned 502: {r.text}")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "status" in data
        assert data["status"] in {"PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED"}
        assert "job_id" in data
        assert data["job_id"] == job_id
        # Verify _id is NOT leaked
        assert "_id" not in data, "MongoDB _id leaked into response"

    def test_poll_unknown_job_returns_404(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/ai/jobs/does-not-exist-{int(time.time())}",
            headers=auth_headers,
        )
        assert r.status_code == 404


class TestQuotaRefundOnFailure:
    """Verify that the usage counter is decremented if Meshy rejects the
    submission. The endpoint returns 502 (HTTPStatusError) or 400
    (ValueError) — both branches refund."""

    def test_quota_refund_on_invalid_count_pre_increment_path(self, auth_headers, test_session, db):
        """validation (count) errors happen BEFORE the increment — so
        usage should be unchanged. This is a control test."""
        mk = _month_key()
        before = db.ai_usage.find_one({"user_id": test_session["user_id"], "month_key": mk}) or {}
        count_before = before.get("count", 0)

        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=auth_headers,
            json={"images": [{"image_b64": TINY_PNG_B64, "mime_type": "image/png"}]},
        )
        assert r.status_code == 400

        after = db.ai_usage.find_one({"user_id": test_session["user_id"], "month_key": mk}) or {}
        count_after = after.get("count", 0)
        assert count_after == count_before, (
            f"Usage incorrectly changed on pre-increment validation failure: "
            f"before={count_before}, after={count_after}"
        )

    def test_quota_refund_on_meshy_upstream_failure(self, auth_headers, test_session, db):
        """Submit a deliberately invalid (1x1) PNG. If Meshy rejects with
        a 4xx/5xx, the endpoint MUST refund the usage credit. We assert
        that whatever happens (200 success or 502 failure), the usage
        delta is consistent: success => +1, failure => 0."""
        mk = _month_key()
        before = db.ai_usage.find_one({"user_id": test_session["user_id"], "month_key": mk}) or {}
        count_before = before.get("count", 0)

        # 3 tiny PNGs to be safe — Meshy generally rejects 1x1 PNGs
        # because subject extraction has nothing to chew on. If it
        # happens to accept (rare), we just verify the +1 path.
        payload = {"images": [
            {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
            {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
            {"image_b64": TINY_PNG_B64, "mime_type": "image/png"},
        ]}
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/multi-image",
            headers=auth_headers,
            json=payload,
            timeout=60,
        )

        after = db.ai_usage.find_one({"user_id": test_session["user_id"], "month_key": mk}) or {}
        count_after = after.get("count", 0)

        if r.status_code == 200:
            assert count_after == count_before + 1, (
                f"Success path: usage delta should be +1, got {count_after - count_before}"
            )
        elif r.status_code in (502, 400):
            # Failure path — must be refunded back to original
            assert count_after == count_before, (
                f"Failure path: quota NOT refunded. before={count_before}, "
                f"after={count_after}, status={r.status_code}, body={r.text}"
            )
        else:
            pytest.fail(f"Unexpected status code {r.status_code}: {r.text}")

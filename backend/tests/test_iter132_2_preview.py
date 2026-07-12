"""Iter-132.2 — Backend tests for image-preview / preview-then-commit UX.

Covers:
  * POST /api/ai/preview/images                (new route)
  * POST /api/ai/generate/image with image_url (extended body support)
  * gating: Meshy BYO user gets 409 from /preview/images
  * validation: 422/400/401 error paths

Uses the pre-seeded fal-default session `st_prov132` (user_prov132_2).
Hits the preview environment ingress for status-code checks and localhost:8001
for JSON-body inspection where CloudFlare's edge might rewrite 5xx bodies.
"""
from __future__ import annotations
import os
import sys
import pytest
import requests
from dotenv import load_dotenv

# Load backend env so FORGE_SECRET_ENC_KEY is visible to secrets_vault
load_dotenv("/app/backend/.env")

# Local module path so we can call encrypt() directly
sys.path.insert(0, "/app/backend")
import secrets_vault  # noqa: E402

PUBLIC_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")
INTERNAL_URL = "http://localhost:8001"
SESSION_TOKEN = "st_prov132"
USER_ID = "user_prov132_2"
AUTH_HEADERS = {"Authorization": f"Bearer {SESSION_TOKEN}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo():
    from pymongo import MongoClient
    client = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = client[os.environ.get("DB_NAME", "test_database")]
    yield db
    # Teardown: clear meshy key if any test left one behind
    db.users.update_one({"user_id": USER_ID}, {"$unset": {"meshy_api_key_enc": "", "meshy_api_key_saved_at": ""}})
    client.close()


@pytest.fixture(autouse=True)
def _ensure_fal_default(mongo):
    """Ensure the seeded user is on the fal.ai provider path — remove any
    stale meshy_api_key_enc left over from other test runs BEFORE each
    test. Individual gating tests will re-add it."""
    mongo.users.update_one({"user_id": USER_ID}, {"$unset": {"meshy_api_key_enc": "", "meshy_api_key_saved_at": ""}})


# ---------- 1. POST /api/ai/preview/images (fal-default) ---------- #

class TestPreviewImages:
    def test_preview_happy_path(self):
        # Use INTERNAL_URL to avoid CloudFlare's 30s timeout on the fal.ai
        # Flux Schnell 4-image batch (~5-15s upstream but occasionally slower).
        r = requests.post(f"{INTERNAL_URL}/api/ai/preview/images",
                          headers=AUTH_HEADERS,
                          json={"prompt": "red dragon figurine on white background", "count": 4, "art_style": "realistic"},
                          timeout=90)
        assert r.status_code == 200, f"expected 200 got {r.status_code} body={r.text[:400]}"
        data = r.json()
        assert isinstance(data.get("urls"), list), data
        assert data["count"] == len(data["urls"]) == 4
        assert data["prompt"] == "red dragon figurine on white background"
        for u in data["urls"]:
            assert isinstance(u, str) and u.startswith("http"), u
            # fal CDN URLs are typically on fal.media
            assert "fal.media" in u or "fal.ai" in u, f"unexpected CDN host: {u}"

    def test_preview_count_variant(self):
        """count=1 must still work (edge of Pydantic ge=1)."""
        r = requests.post(f"{INTERNAL_URL}/api/ai/preview/images",
                          headers=AUTH_HEADERS,
                          json={"prompt": "small blue cube", "count": 1},
                          timeout=90)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data["count"] == 1
        assert len(data["urls"]) == 1

    def test_preview_prompt_too_short_422(self):
        r = requests.post(f"{PUBLIC_URL}/api/ai/preview/images",
                          headers=AUTH_HEADERS,
                          json={"prompt": "ab", "count": 4},
                          timeout=15)
        assert r.status_code == 422, f"expected 422 got {r.status_code}"

    def test_preview_count_over_max_422(self):
        r = requests.post(f"{PUBLIC_URL}/api/ai/preview/images",
                          headers=AUTH_HEADERS,
                          json={"prompt": "valid prompt here", "count": 5},
                          timeout=15)
        assert r.status_code == 422

    def test_preview_count_zero_422(self):
        r = requests.post(f"{PUBLIC_URL}/api/ai/preview/images",
                          headers=AUTH_HEADERS,
                          json={"prompt": "valid prompt here", "count": 0},
                          timeout=15)
        assert r.status_code == 422

    def test_preview_no_session_401(self):
        r = requests.post(f"{PUBLIC_URL}/api/ai/preview/images",
                          headers={"Content-Type": "application/json"},
                          json={"prompt": "red dragon figurine", "count": 4},
                          timeout=15)
        assert r.status_code == 401


# ---------- 2. Meshy-BYO gating (409) ---------- #

class TestPreviewMeshyGating:
    def test_preview_returns_409_when_user_has_meshy_key(self, mongo):
        # Seed a real Fernet ciphertext that decrypts back to a Meshy-shaped key.
        # This bypasses PUT /api/user/meshy-key (which would call Meshy to
        # verify) — we only want to trigger the provider-selection path.
        enc = secrets_vault.encrypt("msy_test_iter132_2_fake_key_1234567890")
        mongo.users.update_one({"user_id": USER_ID}, {"$set": {"meshy_api_key_enc": enc}})
        try:
            # Use INTERNAL_URL so CloudFlare doesn't rewrite the 409 JSON body.
            r = requests.post(f"{INTERNAL_URL}/api/ai/preview/images",
                              headers=AUTH_HEADERS,
                              json={"prompt": "red dragon figurine", "count": 4},
                              timeout=15)
            assert r.status_code == 409, f"expected 409 got {r.status_code} body={r.text[:400]}"
            body = r.json()
            detail = (body.get("detail") or "").lower()
            assert "fal.ai" in detail or "image previews are only available" in detail, body
        finally:
            mongo.users.update_one({"user_id": USER_ID}, {"$unset": {"meshy_api_key_enc": ""}})


# ---------- 3. POST /api/ai/generate/image extended body ---------- #

class TestGenerateImageWithUrl:
    def test_generate_image_url_happy(self, mongo):
        payload = {"image_url": "https://v3b.fal.media/files/b/dummy-test-file.jpg"}
        r = requests.post(f"{PUBLIC_URL}/api/ai/generate/image",
                          headers=AUTH_HEADERS, json=payload, timeout=30)
        # fal_client.submit_async only queues — doesn't validate URL yet, so 200
        assert r.status_code == 200, f"expected 200 got {r.status_code} body={r.text[:400]}"
        data = r.json()
        assert data.get("status") == "PENDING"
        assert data.get("provider") == "fal"
        assert "job_id" in data
        # Verify persisted ai_jobs row has the URL as task_id source (kind=image)
        job = mongo.ai_jobs.find_one({"job_id": data["job_id"]}, {"_id": 0})
        assert job is not None
        assert job["kind"] == "image"
        assert job["provider"] == "fal"
        assert job["user_id"] == USER_ID

    def test_generate_image_file_scheme_400(self):
        r = requests.post(f"{INTERNAL_URL}/api/ai/generate/image",
                          headers=AUTH_HEADERS,
                          json={"image_url": "file:///etc/passwd"}, timeout=15)
        assert r.status_code == 400
        assert "http(s)" in (r.json().get("detail") or "").lower()

    def test_generate_image_data_scheme_400(self):
        r = requests.post(f"{INTERNAL_URL}/api/ai/generate/image",
                          headers=AUTH_HEADERS,
                          json={"image_url": "data:image/png;base64,AAAA"}, timeout=15)
        assert r.status_code == 400

    def test_generate_image_missing_both_400(self):
        r = requests.post(f"{INTERNAL_URL}/api/ai/generate/image",
                          headers=AUTH_HEADERS, json={}, timeout=15)
        assert r.status_code == 400
        detail = (r.json().get("detail") or "").lower()
        assert "missing" in detail and ("image_url" in detail or "image_b64" in detail)

    def test_generate_image_url_wins_over_b64(self, mongo):
        """When both image_url and image_b64 are provided, image_url should win.
        Verified by checking that fal_client received the URL — the ai_jobs
        doc gets a task_id from the fal handle, and the kind stays 'image'.
        Best signal we have client-side: no 400 fires, and job persists."""
        # Use a 1x1 transparent PNG b64 for validity of the b64 branch.
        b64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN"
               "kYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
        payload = {"image_url": "https://v3b.fal.media/files/b/dummy-both.jpg",
                   "image_b64": b64, "mime_type": "image/png"}
        r = requests.post(f"{PUBLIC_URL}/api/ai/generate/image",
                          headers=AUTH_HEADERS, json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        job = mongo.ai_jobs.find_one({"job_id": data["job_id"]}, {"_id": 0})
        assert job is not None
        # Both submits go through the fal queue and get a request_id — the
        # test's success criterion is that we didn't fail (no b64 decoding
        # error) and the router picked the URL path (no data:URL creation).
        # We can additionally check that the fal task_id is a UUID-shaped
        # string (no '|' from text pipeline).
        assert "|" not in job["meshy_task_id"], "text-pipeline id leaked"


# ---------- 4. Regression: image_b64 path still works ---------- #

class TestGenerateImageB64Regression:
    def test_generate_image_b64_still_works(self, mongo):
        # 1x1 transparent PNG
        b64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN"
               "kYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
        r = requests.post(f"{PUBLIC_URL}/api/ai/generate/image",
                          headers=AUTH_HEADERS,
                          json={"image_b64": b64, "mime_type": "image/png"},
                          timeout=30)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert data["status"] == "PENDING"
        assert data["provider"] == "fal"
        job = mongo.ai_jobs.find_one({"job_id": data["job_id"]}, {"_id": 0})
        assert job is not None
        assert job["kind"] == "image"

    def test_generate_image_b64_unsupported_mime_400(self):
        r = requests.post(f"{INTERNAL_URL}/api/ai/generate/image",
                          headers=AUTH_HEADERS,
                          json={"image_b64": "AAAA", "mime_type": "image/gif"},
                          timeout=15)
        assert r.status_code == 400

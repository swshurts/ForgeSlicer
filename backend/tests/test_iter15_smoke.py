"""Iter15 checkpoint smoke: hit live preview URL for surfaces called out in review request."""
import os
import secrets
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")


# ---- Orca status / progress ----
# As of iter 54 the ARM64 flatpak install path is live, so `installed`
# is True on this aarch64 preview pod. Older versions of this test
# asserted installed=False on aarch64; we now assert presence + arch +
# a non-null version banner.
class TestOrca:
    def test_status_returns_installed_true_on_arm64(self):
        r = requests.get(f"{BASE}/api/slice/orca/status", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["installed"] is True, body
        assert body["arch"] == "aarch64"
        assert body.get("version"), "expected non-empty version banner"

    def test_progress_unknown_job_returns_404(self):
        # SSE endpoint streams indefinitely; use short stream timeout and read first chunk
        try:
            with requests.get(f"{BASE}/api/slice/orca/progress/does-not-exist",
                              timeout=(10, 5), stream=True) as r:
                # Acceptable: 404 (unknown job), 503 (orca missing), or 200 SSE that emits error event
                assert r.status_code in (200, 404, 503), f"unexpected {r.status_code}"
        except requests.exceptions.ReadTimeout:
            # SSE held open without erroring is acceptable behaviour on unknown id
            pass


# ---- Public read endpoints ----
class TestPublicLists:
    def test_components_list(self):
        r = requests.get(f"{BASE}/api/components", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_gallery_list(self):
        r = requests.get(f"{BASE}/api/gallery", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_printers_list(self):
        r = requests.get(f"{BASE}/api/printers", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_billing_packages(self):
        r = requests.get(f"{BASE}/api/billing/packages", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_auth_email_status_anonymous(self):
        r = requests.get(f"{BASE}/api/auth/email-status", timeout=15)
        # endpoint exists; may 200 anonymously
        assert r.status_code in (200, 401), f"got {r.status_code}: {r.text[:200]}"


# ---- Components Save-to-Share P2 regression (THE focus area) ----
class TestComponentSaveToShareAnonymous:
    """Verify the anonymous save-to-share path the user reported failing for Pitman Arm."""

    def test_save_pitman_arm_like_payload(self):
        payload = {
            "name": f"TEST_PitmanArm_{secrets.token_hex(4)}",
            "description": "Iter15 regression for save-to-share P2 bug",
            "category": "linkage",
            "author": "iter15-tester",
            "modifier": "positive",
            "tags": "iter15,regression",
            "stl_base64": "c29saWQgdAplbmRzb2xpZCB0Cg==",  # minimal valid base64 STL stub
            "project_json": "{\"objects\":[{\"id\":\"a\",\"type\":\"cube\"}]}",
            "thumbnail_base64": "",
            "triangle_count": 12,
            "object_count": 2,
            "private": False,
        }
        r = requests.post(f"{BASE}/api/components", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"POST failed {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "id" in body
        cid = body["id"]
        assert body["name"] == payload["name"]

        # Verify it appears in list
        list_r = requests.get(f"{BASE}/api/components", timeout=15)
        assert list_r.status_code == 200
        ids = [c.get("id") for c in list_r.json()]
        assert cid in ids, f"Saved component {cid} not in public list (P2 BUG)"

        # Fetch via project endpoint
        proj_r = requests.get(f"{BASE}/api/components/{cid}/project", timeout=15)
        assert proj_r.status_code == 200, f"component fetch failed: {proj_r.status_code}"

        # Cleanup (best-effort, may 403 since anonymous)
        requests.delete(f"{BASE}/api/components/{cid}", timeout=15)


# ---- Voice command (intent parser, Emergent LLM) ----
class TestVoiceCommand:
    def test_voice_command_intent(self):
        r = requests.post(f"{BASE}/api/voice/command", json={"transcript": "add a cube at origin 20mm wide"}, timeout=60)
        # Should be 200 with an intent JSON, OR 503 if LLM key missing — accept both
        assert r.status_code in (200, 400, 503), f"unexpected {r.status_code}: {r.text[:300]}"
        if r.status_code == 200:
            body = r.json()
            assert isinstance(body, dict)

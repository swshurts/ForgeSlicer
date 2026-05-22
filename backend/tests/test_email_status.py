"""Tests for the /api/auth/email-status endpoint."""
import os
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


class TestEmailStatus:
    def test_endpoint_returns_expected_shape(self):
        r = requests.get(f"{API}/auth/email-status", timeout=10)
        assert r.status_code == 200
        body = r.json()
        for key in ("configured", "healthy", "message", "last_error", "last_success_at"):
            assert key in body, f"missing {key}"
        assert isinstance(body["configured"], bool)
        assert isinstance(body["healthy"], bool)

    def test_endpoint_is_publicly_accessible(self):
        # No auth required — signing-in users need to see this.
        r = requests.get(f"{API}/auth/email-status", timeout=10)
        assert r.status_code == 200
        # And no sensitive details leak: no API keys, no full stack traces.
        body = r.json()
        message = (body.get("message") or "").lower()
        assert "re_" not in message
        assert "resend" not in message  # we say "email delivery", not "Resend"

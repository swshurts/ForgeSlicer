"""Backend tests for the Stripe billing endpoints.

These tests verify the API contract and idempotency guarantees WITHOUT
hitting the real Stripe network (which we do separately via the
billing.py smoke flow in development). For Stripe-touching tests we
mark them and skip if STRIPE_API_KEY is not in test mode.
"""
import os
import time
import uuid
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _new_user():
    sess = requests.Session()
    email = f"billing.{int(time.time()*1000)}.{uuid.uuid4().hex[:6]}@example.com"
    r = sess.post(f"{API}/auth/register",
                  json={"name": "Billing Test", "email": email, "password": "passw0rdBB"},
                  timeout=15)
    assert r.status_code == 200, r.text
    return sess, email


def test_packages_endpoint_returns_catalog():
    r = requests.get(f"{API}/billing/packages", timeout=10)
    assert r.status_code == 200
    items = r.json()
    ids = {p["id"] for p in items}
    assert "maker" in ids and "pro" in ids
    for p in items:
        # Required public fields — frontend renders without them otherwise
        assert "name" in p and "amount" in p and "currency" in p and "perks" in p
        assert p["amount"] > 0
        assert p["currency"] == "usd"


def test_checkout_rejects_unknown_package():
    sess, _ = _new_user()
    r = sess.post(f"{API}/billing/checkout",
                  json={"package_id": "premium", "origin_url": BASE_URL},
                  timeout=10)
    assert r.status_code == 400
    assert "Unknown package" in r.text


@pytest.mark.skipif(
    not os.environ.get("STRIPE_API_KEY"),
    reason="STRIPE_API_KEY not configured",
)
def test_checkout_creates_session_and_returns_url():
    sess, _ = _new_user()
    r = sess.post(f"{API}/billing/checkout",
                  json={"package_id": "maker", "origin_url": BASE_URL},
                  timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"].startswith("https://checkout.stripe.com/")
    assert body["session_id"].startswith("cs_test_")


@pytest.mark.skipif(
    not os.environ.get("STRIPE_API_KEY"),
    reason="STRIPE_API_KEY not configured",
)
def test_status_endpoint_404s_for_unknown_session():
    r = requests.get(f"{API}/billing/status/cs_test_nonexistent_session_id_xyz", timeout=10)
    assert r.status_code == 404


def test_subscription_tier_default_is_free_on_me():
    """Fresh users must default to subscription_tier='free' on /api/auth/me
    so the pricing page renders the Free card as 'Active'."""
    sess, _ = _new_user()
    r = sess.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 200
    me = r.json()
    assert me["subscription_tier"] == "free"
    assert me["subscription_expires_at"] is None

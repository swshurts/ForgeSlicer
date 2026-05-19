"""
P1 batch tests for ForgeSlicer Component Library:
- new `verified:false` default field on POST/GET /api/components
- 9 new categories accepted + falls back to misc for unknown
- POST /api/components/{cid}/verify returns 403 when ADMIN_EMAILS env unset
- list order behaviour
"""
import os
import base64
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if BASE_URL is None:
    # Read from frontend/.env directly (backend test runs in same container)
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

API = f"{BASE_URL}/api"
STL_B64 = base64.b64encode(b"solid x\nendsolid x\n").decode()


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------- verified default ----------------
class TestVerifiedField:
    def test_create_component_defaults_verified_false(self, client):
        payload = {
            "name": "TEST_iter11_verified_default",
            "author": "TesterA",
            "description": "d",
            "modifier": "positive",
            "category": "mechanical",
            "tags": "iter11,verified",
            "stl_base64": STL_B64,
        }
        r = client.post(f"{API}/components", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "verified" in data
        assert data["verified"] is False
        assert data["name"] == payload["name"]
        # cleanup
        client.delete(f"{API}/components/{data['id']}")

    def test_list_components_returns_verified_field(self, client):
        # Seed one to ensure non-empty
        seed = client.post(f"{API}/components", json={
            "name": "TEST_iter11_listfield",
            "author": "TesterB",
            "description": "",
            "modifier": "positive",
            "category": "misc",
            "tags": "",
            "stl_base64": STL_B64,
        })
        assert seed.status_code == 200
        sid = seed.json()["id"]
        try:
            r = client.get(f"{API}/components")
            assert r.status_code == 200
            items = r.json()
            assert len(items) >= 1
            for it in items:
                assert "verified" in it, f"verified missing on {it.get('id')}"
                assert isinstance(it["verified"], bool)
            # Find our seeded item and check verified=False
            mine = [i for i in items if i["id"] == sid]
            assert mine and mine[0]["verified"] is False
        finally:
            client.delete(f"{API}/components/{sid}")


# ---------------- expanded categories ----------------
NEW_CATEGORIES = [
    "fasteners", "electronics", "brackets", "hinges", "gears",
    "decorative", "organizers", "miniatures", "structural",
]


class TestExpandedCategories:
    @pytest.mark.parametrize("cat", NEW_CATEGORIES)
    def test_each_new_category_accepted(self, client, cat):
        r = client.post(f"{API}/components", json={
            "name": f"TEST_iter11_cat_{cat}",
            "author": "TesterC",
            "description": "",
            "modifier": "positive",
            "category": cat,
            "tags": "",
            "stl_base64": STL_B64,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["category"] == cat
        client.delete(f"{API}/components/{d['id']}")

    def test_unknown_category_falls_back_to_misc(self, client):
        r = client.post(f"{API}/components", json={
            "name": "TEST_iter11_cat_bogus",
            "author": "TesterD",
            "description": "",
            "modifier": "positive",
            "category": "totallybogus_xyz",
            "tags": "",
            "stl_base64": STL_B64,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["category"] == "misc"
        client.delete(f"{API}/components/{d['id']}")

    def test_legacy_categories_still_accepted(self, client):
        for cat in ("mechanical", "rack", "mounting", "misc"):
            r = client.post(f"{API}/components", json={
                "name": f"TEST_iter11_legacy_{cat}",
                "author": "TesterE",
                "description": "",
                "modifier": "positive",
                "category": cat,
                "tags": "",
                "stl_base64": STL_B64,
            })
            assert r.status_code == 200
            d = r.json()
            assert d["category"] == cat
            client.delete(f"{API}/components/{d['id']}")


# ---------------- /verify gate ----------------
class TestVerifyEndpointGate:
    def test_verify_returns_403_when_admin_emails_unset(self, client):
        # First create a component
        r = client.post(f"{API}/components", json={
            "name": "TEST_iter11_verify_gate",
            "author": "TesterF",
            "description": "",
            "modifier": "positive",
            "category": "misc",
            "tags": "",
            "stl_base64": STL_B64,
        })
        assert r.status_code == 200
        cid = r.json()["id"]
        try:
            # Hit verify with no auth — should be 403 with "Admin allowlist not configured"
            vr = client.post(f"{API}/components/{cid}/verify")
            assert vr.status_code == 403, f"expected 403, got {vr.status_code}: {vr.text}"
            body = vr.json()
            detail = body.get("detail", "")
            assert "Admin allowlist" in detail or "admin" in detail.lower() or "allowlist" in detail.lower(), \
                f"unexpected detail: {detail!r}"
        finally:
            client.delete(f"{API}/components/{cid}")

    def test_verify_gate_even_with_bearer_token(self, client):
        # Seed a session via Mongo would be heavier; here we just send a bearer
        # token that doesn't resolve. The endpoint should still 403 because the
        # allowlist check happens before the auth check.
        r = client.post(f"{API}/components", json={
            "name": "TEST_iter11_verify_gate_bearer",
            "author": "TesterG",
            "description": "",
            "modifier": "positive",
            "category": "misc",
            "tags": "",
            "stl_base64": STL_B64,
        })
        cid = r.json()["id"]
        try:
            vr = client.post(
                f"{API}/components/{cid}/verify",
                headers={"Authorization": "Bearer st_doesnotexist"},
            )
            assert vr.status_code == 403, f"expected 403 (allowlist not configured), got {vr.status_code}: {vr.text}"
        finally:
            client.delete(f"{API}/components/{cid}")


# ---------------- regression: verify sort order ----------------
class TestListSortContainsVerifiedField:
    def test_list_components_has_verified_field_on_every_item(self, client):
        r = client.get(f"{API}/components")
        assert r.status_code == 200
        items = r.json()
        for it in items:
            assert "verified" in it
            assert isinstance(it["verified"], bool)

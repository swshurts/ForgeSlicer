# Tests for iteration 12: license round-trip on /api/gallery + /api/components.
# Verifies: explicit license persists, omitted license defaults to cc-by-4.0,
# and GET listings always include a `license` field.
import base64
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
STL_B64 = base64.b64encode(b"solid x\nendsolid x\n").decode()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- /api/gallery license round-trip ----------
class TestGalleryLicense:
    def test_gallery_post_with_agpl_license_roundtrips(self, session):
        tag = f"TEST_iter12_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": tag,
            "author": "TEST_author",
            "primitives": [{"type": "cube", "op": "positive"}],
            "stl_base64": STL_B64,
            "license": "agpl-3.0",
        }
        r = session.post(f"{API}/gallery", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["license"] == "agpl-3.0"
        assert body["name"] == tag
        item_id = body["id"]

        # GET listing — verify persisted
        rl = session.get(f"{API}/gallery")
        assert rl.status_code == 200
        items = rl.json()
        found = next((i for i in items if i["id"] == item_id), None)
        assert found is not None, "Created gallery item missing from listing"
        assert found["license"] == "agpl-3.0"

    def test_gallery_post_without_license_defaults_to_cc_by_4(self, session):
        payload = {
            "name": f"TEST_iter12_default_{uuid.uuid4().hex[:6]}",
            "author": "TEST_author",
            "primitives": [{"type": "cube", "op": "positive"}],
            "stl_base64": STL_B64,
        }
        r = session.post(f"{API}/gallery", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["license"] == "cc-by-4.0"

    def test_gallery_get_every_item_has_license_field(self, session):
        r = session.get(f"{API}/gallery")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        # Every item must have a license (legacy items default to cc-by-4.0)
        missing = [i.get("id") for i in items if "license" not in i or not i["license"]]
        assert not missing, f"Items without license field: {missing[:5]}"


# ---------- /api/components license round-trip ----------
class TestComponentsLicense:
    def test_components_post_with_mit_license_roundtrips(self, session):
        tag = f"TEST_iter12_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": tag,
            "author": "TEST_author",
            "primitives": [{"type": "cube", "op": "positive"}],
            "stl_base64": STL_B64,
            "category": "mechanical",
            "license": "mit",
        }
        r = session.post(f"{API}/components", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["license"] == "mit"
        cid = body["id"]

        rl = session.get(f"{API}/components")
        assert rl.status_code == 200
        items = rl.json()
        found = next((i for i in items if i["id"] == cid), None)
        assert found is not None
        assert found["license"] == "mit"

    def test_components_post_without_license_defaults_to_cc_by_4(self, session):
        payload = {
            "name": f"TEST_iter12_default_{uuid.uuid4().hex[:6]}",
            "author": "TEST_author",
            "primitives": [{"type": "cube", "op": "positive"}],
            "stl_base64": STL_B64,
            "category": "mechanical",
        }
        r = session.post(f"{API}/components", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["license"] == "cc-by-4.0"

    def test_components_get_every_item_has_license_field(self, session):
        r = session.get(f"{API}/components")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        missing = [i.get("id") for i in items if "license" not in i or not i["license"]]
        assert not missing, f"Components without license field: {missing[:5]}"

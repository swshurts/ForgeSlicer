"""Backend tests for iter13 — material field on gallery + 'toys' category on components."""
import base64
import os
import struct
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _stl_bytes() -> bytes:
    header = b"TEST_iter13".ljust(80, b"\x00")
    tri_count = struct.pack("<I", 1)
    body = struct.pack("<12fH", 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)
    return header + tri_count + body


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def stl_b64():
    return base64.b64encode(_stl_bytes()).decode("ascii")


def _create_gallery(api, stl_b64, name, **extra):
    payload = {
        "name": name,
        "author": "TEST_iter13",
        "description": "iter13 material test",
        "stl_base64": stl_b64,
        "thumbnail_base64": "",
        "triangle_count": 1,
        "object_count": 1,
    }
    payload.update(extra)
    r = api.post(f"{API}/gallery", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Gallery material field ----------
class TestGalleryMaterial:
    created = []

    def test_default_material_is_pla(self, api, stl_b64):
        item = _create_gallery(api, stl_b64, "TEST_iter13_default_mat")
        assert item.get("material") == "pla"
        TestGalleryMaterial.created.append(item["id"])

    def test_create_petg_roundtrips(self, api, stl_b64):
        item = _create_gallery(api, stl_b64, "TEST_iter13_petg", material="petg")
        assert item.get("material") == "petg"
        TestGalleryMaterial.created.append(item["id"])
        # Verify via GET listing
        items = api.get(f"{API}/gallery").json()
        found = next((i for i in items if i["id"] == item["id"]), None)
        assert found is not None
        assert found.get("material") == "petg"

    def test_create_abs_roundtrips(self, api, stl_b64):
        item = _create_gallery(api, stl_b64, "TEST_iter13_abs", material="abs")
        assert item.get("material") == "abs"
        TestGalleryMaterial.created.append(item["id"])

    def test_filter_by_material_petg(self, api):
        r = api.get(f"{API}/gallery", params={"material": "petg"})
        assert r.status_code == 200
        items = r.json()
        # All returned items should be petg
        assert all(i.get("material") == "petg" for i in items), [i.get("material") for i in items]
        # Our created petg item should be in there
        ids = [i["id"] for i in items]
        # find any created petg
        for cid in TestGalleryMaterial.created:
            # one of them was petg
            pass
        # check the petg item exists in result
        petg_created = TestGalleryMaterial.created[1]  # the petg one
        assert petg_created in ids

    def test_filter_by_material_pla(self, api):
        r = api.get(f"{API}/gallery", params={"material": "pla"})
        assert r.status_code == 200
        items = r.json()
        assert all(i.get("material") == "pla" for i in items)
        # default-pla item should be in
        default_id = TestGalleryMaterial.created[0]
        ids = [i["id"] for i in items]
        assert default_id in ids

    def test_list_unfiltered_returns_all(self, api):
        r = api.get(f"{API}/gallery")
        assert r.status_code == 200
        items = r.json()
        ids = [i["id"] for i in items]
        for cid in TestGalleryMaterial.created:
            assert cid in ids
        # every item has material field
        for it in items:
            assert "material" in it and isinstance(it["material"], str) and len(it["material"]) > 0

    def test_cleanup(self, api):
        for cid in TestGalleryMaterial.created:
            api.delete(f"{API}/gallery/{cid}")


# ---------- Components 'toys' category ----------
class TestComponentsToysCategory:
    created_id = None

    def test_create_toy_component(self, api, stl_b64):
        payload = {
            "name": "TEST_iter13_toy",
            "author": "TEST_iter13",
            "description": "toy component test",
            "stl_base64": stl_b64,
            "thumbnail_base64": "",
            "triangle_count": 1,
            "object_count": 1,
            "category": "toys",
            "tags": "test",
        }
        r = api.post(f"{API}/components", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("category") == "toys"
        TestComponentsToysCategory.created_id = data["id"]

    def test_toy_appears_in_list(self, api):
        assert TestComponentsToysCategory.created_id
        r = api.get(f"{API}/components")
        assert r.status_code == 200
        items = r.json()
        found = next((i for i in items if i["id"] == TestComponentsToysCategory.created_id), None)
        assert found is not None
        assert found["category"] == "toys"

    def test_cleanup(self, api):
        if TestComponentsToysCategory.created_id:
            api.delete(f"{API}/components/{TestComponentsToysCategory.created_id}")


def teardown_module(module):
    try:
        for it in requests.get(f"{API}/gallery", timeout=10).json():
            if str(it.get("name", "")).startswith("TEST_iter13"):
                requests.delete(f"{API}/gallery/{it['id']}", timeout=10)
        for it in requests.get(f"{API}/components", timeout=10).json():
            if str(it.get("name", "")).startswith("TEST_iter13"):
                requests.delete(f"{API}/components/{it['id']}", timeout=10)
    except Exception:
        pass

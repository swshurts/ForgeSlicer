"""Backend API tests for ForgeSlicer gallery CRUD endpoints."""
import base64
import os
import struct
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")
# fallback also pulled from frontend/.env in fixture if needed
API = f"{BASE_URL}/api"


def _build_minimal_stl_bytes() -> bytes:
    """Construct a minimal valid binary STL with 1 triangle."""
    header = b"TEST_STL".ljust(80, b"\x00")
    tri_count = struct.pack("<I", 1)
    # normal + 3 vertices + attr byte count
    body = struct.pack("<12fH",
                       0.0, 0.0, 1.0,
                       0.0, 0.0, 0.0,
                       1.0, 0.0, 0.0,
                       0.0, 1.0, 0.0,
                       0)
    return header + tri_count + body


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def stl_b64():
    return base64.b64encode(_build_minimal_stl_bytes()).decode("ascii")


# ---------- Root ----------
class TestRoot:
    def test_api_root(self, api):
        r = api.get(f"{API}/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "message" in data
        assert data.get("version") == "1.0.0"


# ---------- Gallery CRUD ----------
class TestGalleryCrud:
    created_ids = []

    def test_create_gallery_item(self, api, stl_b64):
        payload = {
            "name": "TEST_Cube_Model",
            "author": "TEST_Tester",
            "description": "TEST design from pytest",
            "stl_base64": stl_b64,
            "thumbnail_base64": "",
            "triangle_count": 1,
            "object_count": 1,
        }
        r = api.post(f"{API}/gallery", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data["author"] == payload["author"]
        assert data["triangle_count"] == 1
        assert data["object_count"] == 1
        assert data["downloads"] == 0
        assert isinstance(data["id"], str) and len(data["id"]) > 0
        # stl_base64 should NOT be returned (response_model strips it)
        assert "stl_base64" not in data
        TestGalleryCrud.created_ids.append(data["id"])

    def test_list_gallery_contains_created(self, api):
        assert TestGalleryCrud.created_ids, "No item created earlier"
        r = api.get(f"{API}/gallery")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        ids = [i["id"] for i in items]
        for cid in TestGalleryCrud.created_ids:
            assert cid in ids
        # Ensure stl payload not leaked in list
        for it in items:
            assert "stl_base64" not in it

    def test_download_gallery_stl(self, api, stl_b64):
        cid = TestGalleryCrud.created_ids[0]
        r = api.get(f"{API}/gallery/{cid}/download")
        assert r.status_code == 200
        assert "attachment" in r.headers.get("Content-Disposition", "").lower()
        # Should equal what we encoded
        expected = base64.b64decode(stl_b64)
        assert r.content == expected

    def test_download_increments_counter(self, api):
        cid = TestGalleryCrud.created_ids[0]
        # one more download
        api.get(f"{API}/gallery/{cid}/download")
        r = api.get(f"{API}/gallery")
        item = next((i for i in r.json() if i["id"] == cid), None)
        assert item is not None
        assert item["downloads"] >= 2

    def test_download_404_on_missing(self, api):
        r = api.get(f"{API}/gallery/nonexistent-id-xyz/download")
        assert r.status_code == 404

    def test_delete_gallery_item(self, api):
        cid = TestGalleryCrud.created_ids[0]
        r = api.delete(f"{API}/gallery/{cid}")
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        # verify gone
        r2 = api.get(f"{API}/gallery/{cid}/download")
        assert r2.status_code == 404
        TestGalleryCrud.created_ids.pop(0)

    def test_delete_missing_returns_404(self, api):
        r = api.delete(f"{API}/gallery/nonexistent-id-xyz")
        assert r.status_code == 404


class TestRemixLineage:
    """Verify remix_of / remix_count increment when a remix is uploaded."""
    parent_id = None
    remix_id = None

    def _create(self, api, stl_b64, **extra):
        payload = {
            "name": "TEST_Remix_Parent",
            "author": "TEST_Tester",
            "description": "remix parent",
            "stl_base64": stl_b64,
            "thumbnail_base64": "",
            "triangle_count": 1,
            "object_count": 1,
        }
        payload.update(extra)
        r = api.post(f"{API}/gallery", json=payload)
        assert r.status_code == 200, r.text
        return r.json()

    def test_create_parent(self, api, stl_b64):
        parent = self._create(api, stl_b64, name="TEST_Remix_Parent")
        assert parent["remix_count"] == 0
        assert parent["remix_of"] in (None, "")
        TestRemixLineage.parent_id = parent["id"]

    def test_create_remix_increments_parent(self, api, stl_b64):
        assert TestRemixLineage.parent_id, "parent must exist"
        remix = self._create(
            api, stl_b64,
            name="TEST_Remix_Child",
            remix_of=TestRemixLineage.parent_id,
        )
        assert remix["remix_of"] == TestRemixLineage.parent_id
        TestRemixLineage.remix_id = remix["id"]
        # Pull parent from list and check counter incremented
        items = api.get(f"{API}/gallery").json()
        parent = next((i for i in items if i["id"] == TestRemixLineage.parent_id), None)
        assert parent is not None, "Parent should still exist"
        assert parent["remix_count"] >= 1

    def test_cleanup(self, api):
        for cid in (TestRemixLineage.remix_id, TestRemixLineage.parent_id):
            if cid:
                api.delete(f"{API}/gallery/{cid}")


# ---------- Cleanup ----------
def teardown_module(module):
    """Clean up any remaining TEST_ items just in case."""
    try:
        r = requests.get(f"{API}/gallery", timeout=10)
        for it in r.json():
            if str(it.get("name", "")).startswith("TEST_"):
                requests.delete(f"{API}/gallery/{it['id']}", timeout=10)
    except Exception:
        pass

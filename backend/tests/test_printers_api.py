"""Backend tests for community printer CRUD endpoints."""
import os
import pytest
import requests

def _load_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    if not url:
        raise RuntimeError("REACT_APP_BACKEND_URL not set")
    return url.rstrip("/")

BASE_URL = _load_url()
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestPrintersCrud:
    created = []

    def test_create_printer(self, api):
        payload = {
            "brand": "TEST_Brand",
            "name": "TEST_Printer_X1",
            "submitter": "TEST_User",
            "build_x": 256.0,
            "build_y": 256.0,
            "build_z": 256.0,
            "max_nozzle_temp": 300,
            "max_bed_temp": 110,
            "default_nozzle": 0.4,
            "default_print_speed": 200,
            "notes": "TEST notes",
        }
        r = api.post(f"{API}/printers", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["brand"] == "TEST_Brand"
        assert d["name"] == "TEST_Printer_X1"
        assert d["submitter"] == "TEST_User"
        assert d["build_x"] == 256.0
        assert d["max_nozzle_temp"] == 300
        assert d["uses"] == 0
        assert isinstance(d["id"], str) and len(d["id"]) > 0
        TestPrintersCrud.created.append(d["id"])

    def test_list_printers(self, api):
        r = api.get(f"{API}/printers")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        ids = [i["id"] for i in items]
        for cid in TestPrintersCrud.created:
            assert cid in ids
        # no Mongo _id leakage
        for it in items:
            assert "_id" not in it

    def test_use_increments(self, api):
        cid = TestPrintersCrud.created[0]
        r1 = api.post(f"{API}/printers/{cid}/use")
        assert r1.status_code == 200
        assert r1.json().get("ok") is True
        r2 = api.post(f"{API}/printers/{cid}/use")
        assert r2.status_code == 200
        # verify counter
        items = api.get(f"{API}/printers").json()
        item = next((i for i in items if i["id"] == cid), None)
        assert item is not None
        assert item["uses"] >= 2

    def test_use_404(self, api):
        r = api.post(f"{API}/printers/nonexistent-xyz/use")
        assert r.status_code == 404

    def test_upvote_increments(self, api):
        cid = TestPrintersCrud.created[0]
        before = api.get(f"{API}/printers").json()
        before_votes = next(i["votes"] for i in before if i["id"] == cid)
        r = api.post(f"{API}/printers/{cid}/upvote")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("votes") == before_votes + 1
        # Second upvote should also bump.
        r2 = api.post(f"{API}/printers/{cid}/upvote")
        assert r2.json().get("votes") == before_votes + 2

    def test_upvote_404(self, api):
        r = api.post(f"{API}/printers/nonexistent-xyz/upvote")
        assert r.status_code == 404

    def test_list_sort_order_top_voted_first(self, api):
        """Top-voted printers should appear ahead of newer zero-vote ones."""
        # Add a fresh zero-vote printer so we have a comparison.
        payload = {
            "brand": "TEST_BrandZero",
            "name": "TEST_Printer_Zero",
            "submitter": "TEST_User",
            "build_x": 200.0, "build_y": 200.0, "build_z": 200.0,
            "max_nozzle_temp": 260, "max_bed_temp": 100,
            "default_nozzle": 0.4, "default_print_speed": 100,
            "notes": "",
        }
        zero = api.post(f"{API}/printers", json=payload).json()
        TestPrintersCrud.created.append(zero["id"])
        items = api.get(f"{API}/printers").json()
        idx_voted = next(i for i, it in enumerate(items) if it["id"] == TestPrintersCrud.created[0])
        idx_zero = next(i for i, it in enumerate(items) if it["id"] == zero["id"])
        # voted (>=2) should rank ahead of zero-vote
        assert idx_voted < idx_zero

    def test_delete_printer(self, api):
        cid = TestPrintersCrud.created[0]
        r = api.delete(f"{API}/printers/{cid}")
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        # verify gone
        items = api.get(f"{API}/printers").json()
        assert all(i["id"] != cid for i in items)
        TestPrintersCrud.created.pop(0)

    def test_delete_404(self, api):
        r = api.delete(f"{API}/printers/nonexistent-xyz")
        assert r.status_code == 404


def teardown_module(module):
    try:
        r = requests.get(f"{API}/printers", timeout=10)
        for it in r.json():
            if str(it.get("brand", "")).startswith("TEST_") or str(it.get("name", "")).startswith("TEST_"):
                requests.delete(f"{API}/printers/{it['id']}", timeout=10)
    except Exception:
        pass

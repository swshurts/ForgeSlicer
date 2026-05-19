"""Extra coverage: private components flow, anonymous regressions, author override."""
import os
import uuid
import base64
import struct
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _stl_b64():
    h = b"TEST".ljust(80, b"\x00")
    return base64.b64encode(h + struct.pack("<I", 1) + struct.pack(
        "<12fH", 0,0,1, 0,0,0, 1,0,0, 0,1,0, 0
    )).decode()


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture
def seeded_user(db):
    uid = f"user_extra{uuid.uuid4().hex[:8]}"
    tok = f"st_extra_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": uid, "email": f"x+{uid}@test", "name": "Extra User",
        "picture": "", "created_at": "2026-02-19T00:00:00+00:00",
    })
    db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": "2099-01-01T00:00:00+00:00", "created_at": "2026-02-19T00:00:00+00:00",
    })
    yield {"user_id": uid, "token": tok, "name": "Extra User"}
    db.users.delete_one({"user_id": uid})
    db.user_sessions.delete_many({"user_id": uid})
    db.gallery.delete_many({"user_id": uid})
    db.components.delete_many({"user_id": uid})


def _h(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# Private components private-library semantics
class TestPrivateComponents:
    def test_private_component_hidden_and_in_me(self, seeded_user):
        payload = {
            "name": f"PrivComp {uuid.uuid4().hex[:5]}",
            "stl_base64": _stl_b64(),
            "triangle_count": 1, "modifier": "positive",
            "dimensions": {"x":1,"y":1,"z":1},
            "private": True,
        }
        cr = requests.post(f"{API}/components", headers=_h(seeded_user["token"]), json=payload, timeout=15)
        assert cr.status_code == 200
        item = cr.json()
        assert item["private"] is True
        assert item["user_id"] == seeded_user["user_id"]
        # Public anonymous listing must NOT contain it.
        pub = requests.get(f"{API}/components", timeout=10).json()
        assert item["id"] not in {x["id"] for x in pub}
        # /me/components must contain it.
        mine = requests.get(f"{API}/me/components", headers=_h(seeded_user["token"]), timeout=10).json()
        assert item["id"] in {x["id"] for x in mine}

    def test_logged_in_author_overrides_payload(self, seeded_user):
        # User submits explicit author "spoofed" — backend should overwrite with profile name.
        payload = {
            "name": f"Owned {uuid.uuid4().hex[:5]}",
            "stl_base64": _stl_b64(),
            "triangle_count": 1, "object_count": 1,
            "author": "spoofed",
        }
        cr = requests.post(f"{API}/gallery", headers=_h(seeded_user["token"]), json=payload, timeout=15).json()
        assert cr["author"] == seeded_user["name"]
        assert cr["user_id"] == seeded_user["user_id"]


# Anonymous regression coverage
class TestAnonymousRegression:
    def test_gallery_anonymous_listing(self):
        r = requests.get(f"{API}/gallery", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_components_anonymous_listing(self):
        r = requests.get(f"{API}/components", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_printers_anonymous_listing(self):
        r = requests.get(f"{API}/printers", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_anonymous_gallery_post_uses_free_text_author(self):
        payload = {
            "name": f"Anon {uuid.uuid4().hex[:5]}",
            "stl_base64": _stl_b64(),
            "triangle_count": 1, "object_count": 1,
            "author": "Anon Tester",
        }
        r = requests.post(f"{API}/gallery", json=payload, timeout=15)
        assert r.status_code == 200
        item = r.json()
        assert item["author"] == "Anon Tester"
        assert item.get("user_id") in (None, "")
        # Clean
        requests.delete(f"{API}/gallery/{item['id']}", timeout=10)

    def test_me_endpoints_require_auth(self):
        assert requests.get(f"{API}/me/designs", timeout=10).status_code == 401
        assert requests.get(f"{API}/me/components", timeout=10).status_code == 401

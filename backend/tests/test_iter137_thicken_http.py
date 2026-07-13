"""Iter-137 — HTTP integration tests for /api/printability/thicken-walls.

Exercises the review-request assertions at the wire level:
  - POST /thicken-walls with a thin 20x20x0.5 STL + offset_mm=0.5:
      * 200 + STL body
      * X-Optimize-Offset-Mm=0.5
      * X-Optimize-Faces-Before / -After / -Pre-Decimated headers present
      * output STL parses and bbox grew by ~1 mm/axis
      * /printability/analyze on the thickened STL no longer flags thin_walls
  - Bad offset_mm (0.0, 10.0) → 422
  - Unsupported extension (.xyz) → 400
  - Empty body → 400
  - Auth-gated: no session token → 401/403
  - Existing /decimate, /add-base, /decimate-presets, /analyze still work
"""
from __future__ import annotations

import io
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
import trimesh
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("FORGE_SECRET_ENC_KEY", "VPz7lnPbwuFLQO8nmX9MV19jNn6XFxTpf0y1HoVnyNs=")


def _load_be_env():
    env = {}
    try:
        with open("/app/backend/.env") as fh:
            for line in fh:
                s = line.strip()
                if "=" in s and not s.startswith("#"):
                    k, v = s.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


_be = _load_be_env()
MONGO_URL = _be.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = _be.get("DB_NAME", "test_database")

BASE_URL = ""
try:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
except OSError:
    pass


def _thin_plate_stl_bytes() -> bytes:
    m = trimesh.creation.box(extents=(20, 20, 0.5))
    buf = io.BytesIO()
    m.export(buf, file_type="stl")
    return buf.getvalue()


def _cube_stl_bytes() -> bytes:
    m = trimesh.creation.box(extents=(20, 20, 20))
    buf = io.BytesIO()
    m.export(buf, file_type="stl")
    return buf.getvalue()


@pytest.fixture(scope="module")
def api_session():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    cli = MongoClient(MONGO_URL)
    db = cli[DB_NAME]
    ts = int(time.time() * 1000)
    user_id = f"TEST_thk_{ts}"
    token = f"TEST_st_thk_{ts}"
    now = datetime.now(timezone.utc).isoformat()
    db.users.insert_one({
        "user_id": user_id,
        "email": f"thk.{ts}@example.com",
        "name": "Thicken Tester",
        "picture": "",
        "created_at": now,
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": now,
    })
    yield {"user_id": user_id, "token": token}
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    cli.close()


@pytest.mark.skipif(not BASE_URL, reason="REACT_APP_BACKEND_URL not set")
class TestThickenWallsHTTP:
    def _headers(self, session):
        return {"Authorization": f"Bearer {session['token']}"}

    def test_thin_plate_thickens_and_bbox_grows(self, api_session):
        stl = _thin_plate_stl_bytes()
        r = requests.post(
            f"{BASE_URL}/api/printability/thicken-walls",
            headers=self._headers(api_session),
            files={"file": ("thin.stl", stl, "model/stl")},
            data={"offset_mm": "0.5", "file_type": "stl"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("X-Optimize-Offset-Mm", "").startswith("0.5"), r.headers
        assert r.headers.get("X-Optimize-Faces-Before") is not None
        assert r.headers.get("X-Optimize-Faces-After") is not None
        assert r.headers.get("X-Optimize-Pre-Decimated") in ("0", "1")
        body = r.content
        assert len(body) > 100, "STL body too small"
        # Confirm output STL loads back
        reloaded = trimesh.load(io.BytesIO(body), file_type="stl", force="mesh")
        assert isinstance(reloaded, trimesh.Trimesh)
        bmin, bmax = reloaded.bounds
        size = bmax - bmin
        # Bbox should have grown roughly 2*offset per axis (~1 mm per side)
        assert size[0] > 20.5, f"X grew only {size[0] - 20} mm"
        assert size[1] > 20.5, f"Y grew only {size[1] - 20} mm"
        assert size[2] > 1.0, f"Z is {size[2]} — expected ~1.5 mm"

    def test_thickened_output_clears_thin_walls_via_analyze(self, api_session):
        stl = _thin_plate_stl_bytes()
        r = requests.post(
            f"{BASE_URL}/api/printability/thicken-walls",
            headers=self._headers(api_session),
            files={"file": ("thin.stl", stl, "model/stl")},
            data={"offset_mm": "0.5", "file_type": "stl"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        thickened = r.content
        # Verify analyze on the thickened STL: thin_walls should be gone.
        r2 = requests.post(
            f"{BASE_URL}/api/printability/analyze",
            headers=self._headers(api_session),
            files={"file": ("thickened.stl", thickened, "model/stl")},
            data={"file_type": "stl"},
            timeout=60,
        )
        assert r2.status_code == 200, r2.text
        codes = {i["code"] for i in r2.json().get("issues", [])}
        assert "thin_walls" not in codes, f"thin_walls still present: {codes}"

    @pytest.mark.parametrize("bad_offset", ["0.0", "10.0", "-0.1"])
    def test_rejects_bad_offset(self, api_session, bad_offset):
        stl = _thin_plate_stl_bytes()
        r = requests.post(
            f"{BASE_URL}/api/printability/thicken-walls",
            headers=self._headers(api_session),
            files={"file": ("thin.stl", stl, "model/stl")},
            data={"offset_mm": bad_offset, "file_type": "stl"},
            timeout=30,
        )
        assert r.status_code == 422, f"expected 422 for offset={bad_offset}, got {r.status_code}: {r.text}"

    def test_rejects_unsupported_extension(self, api_session):
        r = requests.post(
            f"{BASE_URL}/api/printability/thicken-walls",
            headers=self._headers(api_session),
            files={"file": ("bad.xyz", b"not-a-mesh", "application/octet-stream")},
            data={"offset_mm": "0.5"},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_empty_body_returns_400(self, api_session):
        r = requests.post(
            f"{BASE_URL}/api/printability/thicken-walls",
            headers=self._headers(api_session),
            files={"file": ("empty.stl", b"", "model/stl")},
            data={"offset_mm": "0.5", "file_type": "stl"},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_requires_auth(self):
        stl = _thin_plate_stl_bytes()
        r = requests.post(
            f"{BASE_URL}/api/printability/thicken-walls",
            files={"file": ("thin.stl", stl, "model/stl")},
            data={"offset_mm": "0.5", "file_type": "stl"},
            timeout=30,
        )
        assert r.status_code in (401, 403), f"expected 401/403 unauthenticated, got {r.status_code}"


# --------------------- Regression on sibling endpoints ------------------------
@pytest.mark.skipif(not BASE_URL, reason="REACT_APP_BACKEND_URL not set")
class TestPrintabilityRegression:
    def _headers(self, session):
        return {"Authorization": f"Bearer {session['token']}"}

    def test_analyze_still_works(self, api_session):
        r = requests.post(
            f"{BASE_URL}/api/printability/analyze",
            headers=self._headers(api_session),
            files={"file": ("cube.stl", _cube_stl_bytes(), "model/stl")},
            data={"file_type": "stl"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "score" in body and "issues" in body

    def test_decimate_presets_still_works(self, api_session):
        r = requests.get(
            f"{BASE_URL}/api/printability/decimate-presets",
            headers=self._headers(api_session),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert "presets" in r.json()

    def test_decimate_still_works(self, api_session):
        # Use a mid-poly sphere so decimation actually has something to remove.
        sphere = trimesh.creation.icosphere(subdivisions=4)
        buf = io.BytesIO()
        sphere.export(buf, file_type="stl")
        r = requests.post(
            f"{BASE_URL}/api/printability/decimate",
            headers=self._headers(api_session),
            files={"file": ("s.stl", buf.getvalue(), "model/stl")},
            data={"preset": "low_poly", "file_type": "stl"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("X-Optimize-Faces-Before") is not None
        assert r.headers.get("X-Optimize-Faces-After") is not None

    def test_add_base_still_works(self, api_session):
        sphere = trimesh.creation.icosphere(subdivisions=3)
        buf = io.BytesIO()
        sphere.export(buf, file_type="stl")
        r = requests.post(
            f"{BASE_URL}/api/printability/add-base",
            headers=self._headers(api_session),
            files={"file": ("s.stl", buf.getvalue(), "model/stl")},
            data={"shape": "cylinder", "thickness_mm": "3.0", "margin_mm": "2.0", "file_type": "stl"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("X-Optimize-Shape") == "cylinder"

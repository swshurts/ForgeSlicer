"""Extended HTTP integration tests for /api/printability/analyze.

Adds explicit assertions for the review-request items that the base
suite covers implicitly:
  - Clean 20mm STL cube via HTTP → score>=80, verdict='ready',
    metrics.is_watertight=True, metrics.triangle_count=12,
    metrics.has_flat_base=True.
  - Non-watertight mesh via HTTP → contains an issue with
    code='non_watertight', severity='critical', fix_action='auto_clean'.
"""
from __future__ import annotations

import io
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
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


def _cube_20mm_stl_bytes() -> bytes:
    m = trimesh.creation.box(extents=(20, 20, 20))
    m.apply_translation([0, 0, 10])
    return m.export(file_type="stl")


def _cube_missing_top_stl_bytes() -> bytes:
    m = trimesh.creation.box(extents=(20, 20, 20))
    m.apply_translation([0, 0, 10])
    top_face_mask = m.face_normals[:, 2] > 0.9
    keep = np.where(~top_face_mask)[0]
    m2 = trimesh.Trimesh(vertices=m.vertices, faces=m.faces[keep], process=False)
    return m2.export(file_type="stl")


@pytest.fixture(scope="module")
def api_session():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    cli = MongoClient(MONGO_URL)
    db = cli[DB_NAME]
    ts = int(time.time() * 1000)
    user_id = f"TEST_prtx_{ts}"
    token = f"TEST_st_prtx_{ts}"
    now = datetime.now(timezone.utc).isoformat()
    db.users.insert_one({
        "user_id": user_id,
        "email": f"prtx.{ts}@example.com",
        "name": "PRTX Tester",
        "picture": "",
        "created_at": now,
    })
    db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": (
            datetime.now(timezone.utc).replace(
                year=datetime.now(timezone.utc).year + 1
            )
        ).isoformat(),
        "created_at": now,
    })
    yield {"user_id": user_id, "token": token}
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    cli.close()


@pytest.mark.skipif(not BASE_URL, reason="REACT_APP_BACKEND_URL not set")
class TestPrintabilityHTTPClean:
    def test_clean_cube_full_field_assertions(self, api_session):
        r = requests.post(
            f"{BASE_URL}/api/printability/analyze",
            headers={"Authorization": f"Bearer {api_session['token']}"},
            files={"file": ("cube.stl", _cube_20mm_stl_bytes(), "model/stl")},
            data={"file_type": "stl"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Score & verdict
        assert body["score"] >= 80, f"expected score>=80, got {body['score']}"
        assert body["verdict"] == "ready", body["verdict"]
        # Metrics
        m = body["metrics"]
        assert m["is_watertight"] is True
        assert m["triangle_count"] == 12
        assert m["has_flat_base"] is True
        assert isinstance(m["bbox_size_mm"], list) and len(m["bbox_size_mm"]) == 3
        # Issues array present (may be empty for clean cube)
        assert isinstance(body["issues"], list)


@pytest.mark.skipif(not BASE_URL, reason="REACT_APP_BACKEND_URL not set")
class TestPrintabilityHTTPNonWatertight:
    def test_broken_cube_returns_non_watertight_critical(self, api_session):
        stl = _cube_missing_top_stl_bytes()
        r = requests.post(
            f"{BASE_URL}/api/printability/analyze",
            headers={"Authorization": f"Bearer {api_session['token']}"},
            files={"file": ("broken.stl", stl, "model/stl")},
            data={"file_type": "stl"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        codes = {i["code"] for i in body["issues"]}
        assert "non_watertight" in codes, f"issues={codes}"
        nw = next(i for i in body["issues"] if i["code"] == "non_watertight")
        assert nw["severity"] == "critical"
        assert nw["fix_action"] == "auto_clean"
        # Metric should also reflect the non-watertight state
        assert body["metrics"]["is_watertight"] is False

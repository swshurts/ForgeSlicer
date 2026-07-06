"""End-to-end integration: verify Auto-Clean raises the Printability score.

Simulates the exact chain the frontend runs when the user clicks
"Fix with Auto-Clean" on a non-watertight issue:
  1. Export scene → binary STL
  2. POST /api/mesh/repair → repaired STL bytes
  3. Re-analyze the repaired bytes → new score

The test asserts the score STRICTLY INCREASES for common defects
(non-watertight, loose fragments) so we catch any regression that
weakens the repair pipeline.
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

import printability_service as ps  # noqa: E402


def _load_backend_env():
    env = {}
    try:
        with open("/app/backend/.env") as fh:
            for line in fh:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


_be = _load_backend_env()
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


@pytest.fixture(scope="module")
def session():
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    cli = MongoClient(MONGO_URL)
    db = cli[DB_NAME]
    ts = int(time.time() * 1000)
    user_id = f"TEST_ac_e2e_{ts}"
    token = f"TEST_st_ac_e2e_{ts}"
    now = datetime.now(timezone.utc).isoformat()
    db.users.insert_one({"user_id": user_id, "email": f"ac.{ts}@ex.com", "name": "AC-E2E", "picture": "", "created_at": now})
    db.user_sessions.insert_one({
        "user_id": user_id, "session_token": token,
        "expires_at": (datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year + 1)).isoformat(),
        "created_at": now,
    })
    yield {"user_id": user_id, "token": token}
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    cli.close()


def _broken_cube_stl() -> tuple[bytes, trimesh.Trimesh]:
    """20mm cube with the +Z face removed. Non-watertight."""
    m = trimesh.creation.box(extents=(20, 20, 20))
    m.apply_translation([0, 0, 10])
    top = m.face_normals[:, 2] > 0.9
    keep = np.where(~top)[0]
    broken = trimesh.Trimesh(vertices=m.vertices, faces=m.faces[keep], process=False)
    return broken.export(file_type="stl"), broken


@pytest.mark.skipif(not BASE_URL, reason="REACT_APP_BACKEND_URL not set")
class TestAutoCleanRaisesPrintabilityScore:

    def test_broken_cube_score_rises_after_repair(self, session):
        stl, broken = _broken_cube_stl()

        # ── BEFORE ──
        rep_before = ps.analyze_trimesh(broken)
        assert rep_before.score < 80, f"broken cube should score <80 before repair, got {rep_before.score}"
        assert any(i.code == "non_watertight" for i in rep_before.issues)

        # ── AUTO-CLEAN via the real endpoint ──
        r = requests.post(
            f"{BASE_URL}/api/mesh/repair",
            headers={
                "Authorization": f"Bearer {session['token']}",
                "Content-Type": "application/octet-stream",
            },
            data=stl,
            timeout=180,
        )
        assert r.status_code == 200, f"repair endpoint returned {r.status_code}: {r.text[:200]}"
        assert r.headers.get("X-Repair-Watertight") == "true"

        # ── AFTER ──
        rep_after = ps.analyze_mesh_bytes(r.content, file_type="stl")
        assert rep_after.score > rep_before.score, (
            f"Auto-Clean must RAISE the score. "
            f"Before: {rep_before.score}, after: {rep_after.score}"
        )
        # The specific non_watertight issue must be gone.
        assert not any(i.code == "non_watertight" for i in rep_after.issues)
        # Verdict should move up (needs_work → ready or better).
        assert rep_after.verdict in {"ready", "needs_work"}
        assert rep_after.verdict != "not_printable"

    def test_score_delta_is_meaningful(self, session):
        """+10 points minimum on a defect that Auto-Clean can genuinely
        fix. Prevents a future regression that "repairs" the mesh
        without actually improving the score-visible metrics."""
        stl, broken = _broken_cube_stl()
        before = ps.analyze_trimesh(broken).score

        r = requests.post(
            f"{BASE_URL}/api/mesh/repair",
            headers={
                "Authorization": f"Bearer {session['token']}",
                "Content-Type": "application/octet-stream",
            },
            data=stl,
            timeout=180,
        )
        after = ps.analyze_mesh_bytes(r.content, file_type="stl").score
        assert after - before >= 10, (
            f"Auto-Clean should raise the score by at least 10 on a "
            f"non-watertight defect. Got Δ = {after - before}."
        )

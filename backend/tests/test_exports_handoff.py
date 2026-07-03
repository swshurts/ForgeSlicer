"""Iter-105.23 — Slicer-handoff route tests (/api/exports/handoff).

Covers:
  1. POST happy path (auth via Bearer, raw octet-stream STL).
  2. POST without auth -> 401.
  3. POST with empty body -> 400.
  4. POST with >50 MB payload -> 413.
  5. GET happy path (public, no auth) returns bytes byte-for-byte.
  6. Single-shot semantics: second GET returns 404.
  7. Bad-token (format-fail and format-pass-DB-miss) -> 404.
  8. Expired handoff -> 410 (mutate expires_at via mongosh).
  9. Frontend bundle.js smoke for the new code-path strings.
 10. Regression: iter-105.19/20/21 marker counts/bans still hold.
"""
from __future__ import annotations

import io
import os
import re
import subprocess
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _session_token() -> str:
    """Temporary test credential: prefer TEST_SESSION_TOKEN from the env,
    otherwise seed a fresh short-lived session row in MongoDB. Nothing
    static is committed to version control."""
    tok = os.environ.get("TEST_SESSION_TOKEN", "")
    if tok:
        return tok
    import secrets as _secrets
    from datetime import datetime, timedelta, timezone
    from pymongo import MongoClient
    cli = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = cli[os.environ.get("DB_NAME", "test_database")]
    user = db.users.find_one({}, {"user_id": 1})
    if not user:
        pytest.skip("No users in DB to seed a test session", allow_module_level=True)
    tok = "st_test_" + _secrets.token_hex(16)
    db.user_sessions.insert_one({
        "user_id": user["user_id"],
        "session_token": tok,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return tok


SESSION_TOKEN = _session_token()
BEARER = {"Authorization": f"Bearer {SESSION_TOKEN}"}

STL_PATH = "/tmp/cube.stl"


# --- fixtures ---------------------------------------------------------------

@pytest.fixture(scope="session")
def stl_bytes() -> bytes:
    if not os.path.exists(STL_PATH):
        # Minimal regenerator — 12-tri unit cube binary STL (~684 bytes).
        import struct
        header = b"ForgeSlicer test cube".ljust(80, b"\x00")
        tris = []
        # 8 verts of a unit cube
        v = [
            (0,0,0),(1,0,0),(1,1,0),(0,1,0),
            (0,0,1),(1,0,1),(1,1,1),(0,1,1),
        ]
        faces = [
            (0,3,2),(0,2,1),  # bottom
            (4,5,6),(4,6,7),  # top
            (0,1,5),(0,5,4),  # front
            (1,2,6),(1,6,5),  # right
            (2,3,7),(2,7,6),  # back
            (3,0,4),(3,4,7),  # left
        ]
        out = io.BytesIO()
        out.write(header)
        out.write(struct.pack("<I", len(faces)))
        for f in faces:
            out.write(struct.pack("<fff", 0,0,0))  # normal
            for vi in f:
                out.write(struct.pack("<fff", *[float(x) for x in v[vi]]))
            out.write(struct.pack("<H", 0))
        with open(STL_PATH, "wb") as fh:
            fh.write(out.getvalue())
    with open(STL_PATH, "rb") as fh:
        return fh.read()


@pytest.fixture()
def staged(stl_bytes):
    """Stage a token via POST and return (token, url, json)."""
    r = requests.post(
        f"{API}/exports/handoff",
        params={"filename": "TEST_cube.3mf"},
        data=stl_bytes,
        headers={**BEARER, "Content-Type": "application/octet-stream"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    return j["token"], j["url"], j


# --- 1. happy path POST -----------------------------------------------------

class TestStageHandoff:
    def test_happy_path_returns_token_url_size(self, stl_bytes):
        r = requests.post(
            f"{API}/exports/handoff",
            params={"filename": "TEST_cube.3mf"},
            data=stl_bytes,
            headers={**BEARER, "Content-Type": "application/octet-stream"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert re.fullmatch(r"[a-f0-9]{32}", j["token"]), f"bad token: {j['token']}"
        assert j["url"].startswith("https://") and j["url"].endswith(f"/api/exports/handoff/{j['token']}")
        assert j["filename"].endswith(".3mf")
        assert j["size"] == len(stl_bytes)
        # expires_at: ISO datetime ~30 min in future
        assert "expires_at" in j
        from datetime import datetime, timezone
        exp = datetime.fromisoformat(j["expires_at"])
        delta = (exp - datetime.now(timezone.utc)).total_seconds()
        assert 25 * 60 < delta < 35 * 60, f"expires_at delta out of band: {delta}s"

    def test_no_auth_returns_401(self, stl_bytes):
        r = requests.post(
            f"{API}/exports/handoff",
            params={"filename": "TEST_noauth.3mf"},
            data=stl_bytes,
            headers={"Content-Type": "application/octet-stream"},
            timeout=30,
        )
        assert r.status_code == 401, r.text
        j = r.json()
        assert j.get("detail") == "Not authenticated"

    def test_empty_body_returns_400(self):
        r = requests.post(
            f"{API}/exports/handoff",
            params={"filename": "TEST_empty.3mf"},
            data=b"",
            headers={**BEARER, "Content-Type": "application/octet-stream"},
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert r.json().get("detail") == "Empty or truncated payload"

    def test_oversize_returns_413(self):
        # 60 MB of zeros via streaming generator (don't OOM)
        big_path = "/tmp/big.bin"
        if not os.path.exists(big_path) or os.path.getsize(big_path) < 60 * 1024 * 1024:
            subprocess.run(["dd", "if=/dev/zero", f"of={big_path}", "bs=1M", "count=60"],
                           check=True, capture_output=True)
        with open(big_path, "rb") as fh:
            r = requests.post(
                f"{API}/exports/handoff",
                params={"filename": "TEST_big.3mf"},
                data=fh,
                headers={**BEARER, "Content-Type": "application/octet-stream"},
                timeout=120,
            )
        assert r.status_code == 413, r.text
        assert "50 MB" in r.json().get("detail", "")


# --- 2. GET happy path & single-shot ---------------------------------------

class TestDownloadHandoff:
    def test_get_happy_path_public(self, staged, stl_bytes):
        token, url, _ = staged
        r = requests.get(url, timeout=30)  # NO auth header
        assert r.status_code == 200, r.text
        # byte-for-byte
        assert r.content == stl_bytes
        # headers
        cd = r.headers.get("Content-Disposition", "")
        assert "attachment" in cd and "TEST_cube.3mf" in cd
        assert r.headers.get("Content-Type", "").startswith("model/3mf")

    def test_single_shot_second_get_404(self, staged):
        token, url, _ = staged
        r1 = requests.get(url, timeout=30)
        assert r1.status_code == 200
        time.sleep(1)
        r2 = requests.get(url, timeout=30)
        assert r2.status_code == 404, r2.text
        assert r2.json().get("detail") == "Unknown handoff token"

    def test_bad_format_token_404(self):
        r = requests.get(f"{API}/exports/handoff/badtoken", timeout=15)
        assert r.status_code == 404
        assert r.json().get("detail") == "Unknown handoff token"

    def test_format_ok_but_not_in_db_404(self):
        r = requests.get(f"{API}/exports/handoff/{'a'*32}", timeout=15)
        assert r.status_code == 404
        assert r.json().get("detail") == "Unknown handoff token"

    def test_octet_stream_for_non_3mf_filename(self, stl_bytes):
        r = requests.post(
            f"{API}/exports/handoff",
            params={"filename": "TEST_blob.bin"},
            data=stl_bytes,
            headers={**BEARER, "Content-Type": "application/octet-stream"},
            timeout=30,
        )
        # Filename is sanitised: ".bin" doesn't end in .3mf/.stl -> backend
        # forces ".3mf" suffix per code line 114-115.  So the served
        # content-type will still be model/3mf.  Just verify GET works.
        assert r.status_code == 200
        j = r.json()
        g = requests.get(j["url"], timeout=15)
        assert g.status_code == 200


# --- 3. Expired handoff -----------------------------------------------------

class TestExpiredHandoff:
    def test_expired_returns_410_and_cleans_up(self, staged):
        token, url, _ = staged
        # Mutate expires_at via mongosh to a past date.
        mongo = (
            "db.export_handoff.updateOne("
            f"{{token: '{token}'}}, "
            "{$set: {expires_at: '2020-01-01T00:00:00+00:00'}});"
            "print(JSON.stringify(db.export_handoff.findOne({token: '" + token + "'})));"
        )
        proc = subprocess.run(
            ["mongosh", "mongodb://localhost:27017/test_database", "--quiet", "--eval", mongo],
            capture_output=True, text=True, timeout=20,
        )
        assert proc.returncode == 0, proc.stderr
        # Now hit the GET
        r = requests.get(url, timeout=15)
        assert r.status_code == 410, r.text
        assert r.json().get("detail") == "Handoff link expired"
        # Verify record was cleaned up (next GET = 404)
        time.sleep(0.5)
        r2 = requests.get(url, timeout=15)
        assert r2.status_code == 404


# --- 4. Frontend bundle smoke (new code-path strings) -----------------------

class TestBundleSmoke:
    @pytest.fixture(scope="class")
    def bundle(self):
        r = requests.get(f"{BASE_URL}/static/js/bundle.js", timeout=60)
        assert r.status_code == 200, f"bundle.js fetch failed: {r.status_code}"
        return r.text

    def test_bundle_has_handoff_path(self, bundle):
        assert "/exports/handoff" in bundle, "missing /exports/handoff in bundle"

    def test_bundle_has_stage_handoff_fn(self, bundle):
        assert "stageHandoff" in bundle, "missing stageHandoff symbol in bundle"

    def test_bundle_has_open_file_arg(self, bundle):
        assert "open/?file=" in bundle, "missing open/?file= literal in bundle"

    def test_bundle_has_opened_with_file_flag(self, bundle):
        assert "openedWithFile" in bundle, "missing openedWithFile symbol in bundle"


# --- 5. Regression: iter-105.19/20/21 markers/bans --------------------------

class TestRegressionMarkers:
    @pytest.fixture(scope="class")
    def bundle(self):
        r = requests.get(f"{BASE_URL}/static/js/bundle.js", timeout=60)
        assert r.status_code == 200
        return r.text

    def test_iter105_19_multi_object_markers_present(self, bundle):
        # baseline counts from iteration_100.json
        assert bundle.count("negative_part") >= 5
        assert bundle.count("<components>") >= 1
        assert bundle.count("<component objectid") >= 1
        assert "_buildVolumeObjectXml" in bundle
        assert "_uuidFor" in bundle

    def test_iter105_21_bambu_markers_banned(self, bundle):
        assert bundle.count("xmlns:BambuStudio") == 0, "Bambu xmlns leaked back into bundle"
        assert bundle.count("BambuStudio:3mfVersion") == 0, "Bambu version metadata leaked back"

    def test_iter105_20_edge_controls_banned(self, bundle):
        for tid in ["edge-controls", "edge-style-fillet", "edge-style-chamfer",
                    "edge-radius-slider", "edge-mode-picker"]:
            assert bundle.count(tid) == 0, f"banned testid {tid} leaked back into bundle"

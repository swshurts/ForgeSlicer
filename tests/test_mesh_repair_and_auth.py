"""Regression tests for iteration 105.15 fixes:

1. POST /api/mesh/repair — raw application/octet-stream body
2. POST /api/mesh/repair — legacy multipart fallback
3. POST /api/mesh/repair — unauthenticated 401 (both modes)
4. POST /api/auth/session — invalid session probe returns 401 in ~6s
5. GET  /api/auth/me — bearer token returns user payload in <2s
"""
import os
import struct
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

SESSION_TOKEN = "st_test_f9cb48812e2d4f29bd73d7bfef69aa1d"
AUTH_HEADERS = {"Authorization": f"Bearer {SESSION_TOKEN}"}


def _make_cube_stl() -> bytes:
    """12-triangle unit cube — 684 bytes binary STL."""
    # 8 vertices of a unit cube
    v = [
        (0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
        (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1),
    ]
    # 12 triangles (face index pairs)
    tris = [
        # bottom (-z)
        ((0, 0, -1), v[0], v[2], v[1]), ((0, 0, -1), v[0], v[3], v[2]),
        # top (+z)
        ((0, 0, 1),  v[4], v[5], v[6]), ((0, 0, 1),  v[4], v[6], v[7]),
        # front (-y)
        ((0, -1, 0), v[0], v[1], v[5]), ((0, -1, 0), v[0], v[5], v[4]),
        # back (+y)
        ((0, 1, 0),  v[3], v[6], v[2]), ((0, 1, 0),  v[3], v[7], v[6]),
        # left (-x)
        ((-1, 0, 0), v[0], v[4], v[7]), ((-1, 0, 0), v[0], v[7], v[3]),
        # right (+x)
        ((1, 0, 0),  v[1], v[2], v[6]), ((1, 0, 0),  v[1], v[6], v[5]),
    ]
    out = bytearray(b"\x00" * 80)
    out += struct.pack("<I", len(tris))
    for n, a, b, c in tris:
        out += struct.pack("<3f", *n)
        out += struct.pack("<3f", *a)
        out += struct.pack("<3f", *b)
        out += struct.pack("<3f", *c)
        out += struct.pack("<H", 0)
    return bytes(out)


@pytest.fixture(scope="module")
def cube_stl():
    return _make_cube_stl()


# ---------------- /api/auth/me (bearer fast path) ----------------
class TestAuthMe:
    def test_auth_me_bearer_under_2s(self):
        t0 = time.time()
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=AUTH_HEADERS, timeout=10)
        elapsed = time.time() - t0
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "user_id" in data
        assert "email" in data
        assert "name" in data
        assert elapsed < 2.0, f"auth/me took {elapsed:.2f}s (>2s)"


# ---------------- /api/auth/session timeout behaviour ----------------
class TestAuthSessionTimeout:
    def test_invalid_session_returns_401_fast(self):
        t0 = time.time()
        r = requests.post(
            f"{BASE_URL}/api/auth/session",
            json={"session_id": "probe-invalid"},
            timeout=45,
        )
        elapsed = time.time() - t0
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:300]}"
        # Should NOT hang for the full 45s — backend retry budget is ~6s
        assert elapsed < 20.0, f"session probe took {elapsed:.2f}s (expected <20)"
        try:
            detail = r.json().get("detail", "")
        except Exception:
            detail = r.text
        assert detail, "401 response missing detail"


# ---------------- /api/mesh/repair — unauthenticated ----------------
class TestMeshRepairUnauthenticated:
    def test_raw_body_no_auth_returns_401(self, cube_stl):
        r = requests.post(
            f"{BASE_URL}/api/mesh/repair",
            data=cube_stl,
            headers={"Content-Type": "application/octet-stream"},
            timeout=30,
        )
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"
        assert r.json().get("detail") == "Not authenticated"

    def test_multipart_no_auth_returns_401(self, cube_stl):
        r = requests.post(
            f"{BASE_URL}/api/mesh/repair",
            files={"file": ("cube.stl", cube_stl, "application/sla")},
            timeout=30,
        )
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"
        assert r.json().get("detail") == "Not authenticated"


# ---------------- /api/mesh/repair — raw body (modern path) ----------------
class TestMeshRepairRawBody:
    def test_raw_octet_stream_returns_repaired_stl(self, cube_stl):
        r = requests.post(
            f"{BASE_URL}/api/mesh/repair",
            data=cube_stl,
            headers={**AUTH_HEADERS, "Content-Type": "application/octet-stream"},
            timeout=60,
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text[:300]}"
        assert len(r.content) >= 400, f"repaired STL too small: {len(r.content)} bytes"
        # Headers added by the repair endpoint
        assert "X-Repair-Input-Bytes" in r.headers
        assert "X-Repair-Output-Bytes" in r.headers
        assert "X-Repair-Elapsed-Seconds" in r.headers
        assert int(r.headers["X-Repair-Input-Bytes"]) == len(cube_stl)
        assert int(r.headers["X-Repair-Output-Bytes"]) == len(r.content)
        # Binary STL: 80-byte header + 4-byte uint32 ntri
        ntri = struct.unpack("<I", r.content[80:84])[0]
        assert ntri >= 12, f"repaired mesh only has {ntri} triangles"


# ---------------- /api/mesh/repair — multipart (legacy) ----------------
class TestMeshRepairMultipart:
    def test_multipart_file_upload_returns_repaired_stl(self, cube_stl):
        r = requests.post(
            f"{BASE_URL}/api/mesh/repair",
            files={"file": ("cube.stl", cube_stl, "application/sla")},
            headers=AUTH_HEADERS,
            timeout=60,
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text[:300]}"
        assert len(r.content) >= 400, f"repaired STL too small: {len(r.content)} bytes"
        assert "X-Repair-Output-Bytes" in r.headers
        ntri = struct.unpack("<I", r.content[80:84])[0]
        assert ntri >= 12

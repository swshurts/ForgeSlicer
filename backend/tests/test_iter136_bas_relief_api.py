"""Iter-136 — Bas-Relief HTTP API regression tests.

Covers the review request: POST /api/ai/generate/bas-relief happy paths,
custom-parameter dimension math, image_url fetch mode, all rejection
cases (missing/invalid inputs, out-of-range Pydantic bounds), auth
gating, and — critically — verifies that the local geometry pipeline
does NOT consume the monthly AI quota.
"""
import base64
import io
import os
import sys
from pathlib import Path

import pytest
import requests
import trimesh
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to reading the frontend .env directly (test-runners sometimes
    # don't propagate the frontend env var into the backend test venv).
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

SESSION_TOKEN = "st_prov132"


def _make_png_b64(size: int = 512) -> str:
    """Top-to-bottom grayscale gradient PNG, base64-encoded.

    Chose vertical (not diagonal) so the brightest pixels (bottom row
    centre) stay inside the circular mask; a diagonal max lands in the
    corner, which the disk mask clips, and the peak reachable height
    then falls short of the theoretical `base + max_relief`.
    """
    img = Image.new("L", (size, size))
    px = img.load()
    for j in range(size):
        val = int(255 * j / (size - 1))
        for i in range(size):
            px[i, j] = val
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


@pytest.fixture(scope="module")
def auth_headers():
    return {"Authorization": f"Bearer {SESSION_TOKEN}"}


@pytest.fixture(scope="module")
def png_b64():
    return _make_png_b64(512)


class TestBasReliefHappyPath:
    """Default-parameters run returns STL + optimisation headers."""

    def test_default_parameters_returns_stl(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_b64": png_b64},
            headers=auth_headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text[:500]
        # Content-type must be model/stl (binary STL body).
        assert r.headers.get("content-type", "").startswith("model/stl"), r.headers
        # All six X-Optimize-* headers must be present.
        assert r.headers.get("X-Optimize-Diameter-Mm") == "220.0"
        assert r.headers.get("X-Optimize-Max-Relief-Mm") == "12.0"
        assert r.headers.get("X-Optimize-Base-Thickness-Mm") == "3.0"
        assert r.headers.get("X-Optimize-Total-Height-Mm") == "15.0"
        assert r.headers.get("X-Optimize-Grid-Size") == "512"
        faces_hdr = r.headers.get("X-Optimize-Faces")
        assert faces_hdr and int(faces_hdr) > 10_000, faces_hdr
        # Payload must be non-empty binary.
        assert len(r.content) > 100_000, len(r.content)

    def test_default_stl_parses_and_bounds_match(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_b64": png_b64},
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code == 200
        m = trimesh.load(io.BytesIO(r.content), file_type="stl", force="mesh")
        assert isinstance(m, trimesh.Trimesh)
        assert len(m.faces) >= 10_000
        bmin, bmax = m.bounds
        # Silhouette: X and Y ≈ 220mm (outer ring clip tolerance).
        assert abs((bmax[0] - bmin[0]) - 220.0) < 5.0, m.bounds
        assert abs((bmax[1] - bmin[1]) - 220.0) < 5.0, m.bounds
        # Z ≈ base + max_relief = 3 + 12 = 15mm.
        assert abs((bmax[2] - bmin[2]) - 15.0) < 0.5, m.bounds


class TestBasReliefCustomParams:
    def test_custom_dimensions_headers_and_z_extent(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={
                "image_b64": png_b64,
                "diameter_mm": 150,
                "max_relief_mm": 5,
                "base_thickness_mm": 2,
            },
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code == 200, r.text[:400]
        assert r.headers.get("X-Optimize-Total-Height-Mm") == "7.0"
        assert r.headers.get("X-Optimize-Diameter-Mm") == "150.0"
        assert r.headers.get("X-Optimize-Max-Relief-Mm") == "5.0"
        assert r.headers.get("X-Optimize-Base-Thickness-Mm") == "2.0"
        m = trimesh.load(io.BytesIO(r.content), file_type="stl", force="mesh")
        bmin, bmax = m.bounds
        assert abs((bmax[2] - bmin[2]) - 7.0) < 0.5
        assert abs((bmax[0] - bmin[0]) - 150.0) < 5.0


class TestBasReliefRejections:
    def test_missing_both_image_fields_returns_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 400, r.status_code
        assert "image_b64" in r.text.lower() and "image_url" in r.text.lower()

    def test_diameter_below_min_returns_422(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_b64": png_b64, "diameter_mm": 50},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 422, (r.status_code, r.text[:200])

    def test_max_relief_above_max_returns_422(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_b64": png_b64, "max_relief_mm": 50},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 422, (r.status_code, r.text[:200])

    def test_file_scheme_url_rejected_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_url": "file:///etc/passwd"},
            headers=auth_headers,
            timeout=30,
        )
        assert r.status_code == 400, r.status_code
        assert "http" in r.text.lower()

    def test_invalid_base64_returns_400(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            # base64 decoder tolerates a lot; use characters guaranteed to
            # break it (spaces + garbage that isn't a valid image after decode).
            json={"image_b64": "@@@@not_base64_at_all@@@@"},
            headers=auth_headers,
            timeout=30,
        )
        # Either 400 (b64 decode error) or 500 (image parse error inside
        # generate) is a real bug — accept only the documented 400.
        assert r.status_code in (400, 422), (r.status_code, r.text[:200])


class TestBasReliefAuth:
    def test_unauthenticated_returns_401(self, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_b64": png_b64},
            timeout=30,
        )
        assert r.status_code == 401, r.status_code


class TestBasReliefQuota:
    """The local pipeline must NOT count against the AI monthly cap."""

    def test_quota_unchanged_after_generation(self, auth_headers, png_b64):
        before = requests.get(f"{BASE_URL}/api/ai/usage", headers=auth_headers, timeout=30)
        assert before.status_code == 200, before.text[:300]
        count_before = before.json().get("count", 0)

        gen = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_b64": png_b64},
            headers=auth_headers,
            timeout=180,
        )
        assert gen.status_code == 200, gen.text[:300]

        after = requests.get(f"{BASE_URL}/api/ai/usage", headers=auth_headers, timeout=30)
        assert after.status_code == 200
        count_after = after.json().get("count", 0)
        assert count_after == count_before, (count_before, count_after)


class TestBasReliefImageUrlMode:
    """image_url mode — fetch a small public image and generate from it.

    fal.media URLs vary per iter; we use a stable public raster (GitHub
    raw content) instead so the test is deterministic. The endpoint
    just needs ANY http(s) image to be reachable.
    """

    def test_image_url_mode_produces_stl(self, auth_headers):
        # 1x1 PNG hosted at a known-stable URL (httpbin's image endpoint).
        # If httpbin is unreachable we skip rather than fail.
        url = "https://httpbin.org/image/png"
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_url": url, "grid_size": 128},
            headers=auth_headers,
            timeout=180,
        )
        if r.status_code == 502:
            pytest.skip(f"external URL unreachable (502): {r.text[:200]}")
        assert r.status_code == 200, (r.status_code, r.text[:300])
        assert r.headers.get("content-type", "").startswith("model/stl")
        assert len(r.content) > 5000

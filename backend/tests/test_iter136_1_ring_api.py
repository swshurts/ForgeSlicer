"""Iter-136.1 — Frame-Ring HTTP API regression tests.

Verifies the new `ring_enabled` / `ring_width_mm` / `ring_height_mm`
Pydantic fields on POST /api/ai/generate/bas-relief, the new response
headers (X-Optimize-Ring-*, X-Optimize-Outer-Diameter-Mm), the outer-
diameter growth math (D + 2*rw), the total-height rule when ring is
taller than the relief, all validation rejections, AND that
out-of-range ring params are accepted when ring_enabled=false.
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
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

SESSION_TOKEN = "st_prov132"


def _make_png_b64(size: int = 256) -> str:
    """Top-to-bottom grayscale gradient PNG."""
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
    return _make_png_b64(256)


class TestRingEnabled:
    """ring_enabled=true, D=200, rw=10, rh=5 → outer=220, all headers set."""

    def test_ring_extends_outer_diameter_and_headers(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={
                "image_b64": png_b64,
                "diameter_mm": 200,
                "ring_enabled": True,
                "ring_width_mm": 10,
                "ring_height_mm": 5,
                "grid_size": 192,
            },
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code == 200, r.text[:400]
        # Ring headers
        assert r.headers.get("X-Optimize-Ring-Enabled") == "1", r.headers
        assert r.headers.get("X-Optimize-Ring-Width-Mm") == "10.0"
        assert r.headers.get("X-Optimize-Ring-Height-Mm") == "5.0"
        # Outer diameter = 200 + 2*10 = 220
        assert r.headers.get("X-Optimize-Outer-Diameter-Mm") == "220.0"
        # Inner (relief) diameter unchanged
        assert r.headers.get("X-Optimize-Diameter-Mm") == "200.0"
        # Parse STL — XY extents should be ~220 mm
        m = trimesh.load(io.BytesIO(r.content), file_type="stl", force="mesh")
        bmin, bmax = m.bounds
        assert abs((bmax[0] - bmin[0]) - 220.0) < 5.0, m.bounds
        assert abs((bmax[1] - bmin[1]) - 220.0) < 5.0, m.bounds


class TestRingDisabled:
    """Default (ring_enabled=false) — headers report 0/false, outer=inner."""

    def test_ring_disabled_by_default(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={"image_b64": png_b64, "diameter_mm": 200, "grid_size": 192},
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code == 200
        assert r.headers.get("X-Optimize-Ring-Enabled") == "0"
        # Outer == inner when ring is off
        assert r.headers.get("X-Optimize-Outer-Diameter-Mm") == "200.0"
        assert r.headers.get("X-Optimize-Diameter-Mm") == "200.0"
        # Service normalises ring dims to 0 when disabled
        assert r.headers.get("X-Optimize-Ring-Width-Mm") == "0.0"
        assert r.headers.get("X-Optimize-Ring-Height-Mm") == "0.0"
        # Mesh XY ≈ 200 mm (unchanged from iter-136 default)
        m = trimesh.load(io.BytesIO(r.content), file_type="stl", force="mesh")
        bmin, bmax = m.bounds
        assert abs((bmax[0] - bmin[0]) - 200.0) < 5.0
        assert abs((bmax[1] - bmin[1]) - 200.0) < 5.0


class TestRingTallerThanRelief:
    """When ring_height > max_relief, total height uses ring_height."""

    def test_ring_taller_than_relief_wins_total_height(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={
                "image_b64": png_b64,
                "diameter_mm": 200,
                "max_relief_mm": 5,
                "base_thickness_mm": 3,
                "ring_enabled": True,
                "ring_width_mm": 8,
                "ring_height_mm": 10,
                "grid_size": 128,
            },
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code == 200, r.text[:400]
        # total = base(3) + ring_height(10) = 13 (not base + max_relief = 8)
        assert r.headers.get("X-Optimize-Total-Height-Mm") == "13.0"


class TestRingValidation:
    """Pydantic bounds — ring_width ge=1 le=40; ring_height ge=0.5 le=30."""

    @pytest.mark.parametrize("rw", [0.5, 50])
    def test_bad_ring_width_returns_422(self, auth_headers, png_b64, rw):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={
                "image_b64": png_b64,
                "ring_enabled": True,
                "ring_width_mm": rw,
            },
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 422, (r.status_code, r.text[:300])

    @pytest.mark.parametrize("rh", [0.1, 40])
    def test_bad_ring_height_returns_422(self, auth_headers, png_b64, rh):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={
                "image_b64": png_b64,
                "ring_enabled": True,
                "ring_height_mm": rh,
            },
            headers=auth_headers,
            timeout=60,
        )
        assert r.status_code == 422, (r.status_code, r.text[:300])


class TestRingParamsIgnoredWhenDisabled:
    """Out-of-range ring_width/ring_height accepted (=422 from Pydantic).

    NOTE from the review request: 'when ring_enabled=false, out-of-range
    ring_width / ring_height values should still be accepted (they're
    ignored). Verify a request with ring_enabled=false + ring_width_mm=0.5
    returns 200.'

    Pydantic-level bounds on ring_width_mm are `ge=1, le=40`, which means
    Pydantic will reject rw=0.5 regardless of ring_enabled UNLESS the
    field-level validator is conditional. Test what actually happens
    and report the actual behaviour.
    """

    def test_disabled_ring_accepts_oor_width(self, auth_headers, png_b64):
        r = requests.post(
            f"{BASE_URL}/api/ai/generate/bas-relief",
            json={
                "image_b64": png_b64,
                "ring_enabled": False,
                "ring_width_mm": 0.5,
                "grid_size": 128,
            },
            headers=auth_headers,
            timeout=60,
        )
        # Review request expects 200. If Pydantic rejects because the
        # bounds aren't conditional on ring_enabled, this fails with 422
        # and the assertion message surfaces the exact status.
        assert r.status_code == 200, (
            f"ring_enabled=false with rw=0.5 rejected: {r.status_code} {r.text[:200]}"
        )

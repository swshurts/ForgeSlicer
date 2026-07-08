"""iter-136 behaviour lock: exercise the live /api/litho/studio pipeline
end-to-end (upload → optimize) on both flat and disc geometries and
confirm the refactored cost_estimator still produces a non-empty
`cost_estimate` dict with all expected keys and positive values.

This is a spot-check against real byte-for-byte behaviour drift, complementary
to the 11 unit-level behaviour-lock tests in test_cost_estimator_refactor.py.
"""

from __future__ import annotations

import base64
import io
import os

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
).rstrip("/")
API = f"{BASE_URL}/api"
TEST_SESSION_TOKEN = "st_test_litho_1783361464350"  # noqa: S105


@pytest.fixture(scope="module")
def client() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {TEST_SESSION_TOKEN}"})
    s.cookies.set("session_token", TEST_SESSION_TOKEN)
    return s


def _gradient_png_b64(size: int = 100) -> str:
    img = Image.new("L", (size, size), 0)
    px = img.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = int(255 * (x + y) / (2 * size))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


@pytest.fixture(scope="module")
def image_id(client):
    r = client.post(
        f"{API}/litho/studio/upload",
        json={"image_base64": _gradient_png_b64(100), "filename": "grad.png"},
        timeout=60,
    )
    assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:300]}"
    return r.json()["image_id"]


def _optimize(client, image_id, geometry: str) -> dict:
    payload = {
        "image_id": image_id,
        "width_mm": 100.0,
        "height_mm": 100.0,
        "thickness_mm": 2.4,
        "border_mm": 2.0,
        "layer_height_mm": 0.12,
        "max_swaps": 4,
        "geometry": geometry,
    }
    r = client.post(f"{API}/litho/studio/optimize", json=payload, timeout=120)
    assert r.status_code == 200, f"optimize failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _assert_cost_shape(cost: dict) -> None:
    # OptimizeOut.cost_estimate schema per litho.cost_estimator.CostEstimate.to_dict
    for key in (
        "total_time_minutes",
        "total_weight_g",
        "total_length_mm",
        "total_cost_usd",
        "total_volume_mm3",
        "per_filament",
    ):
        assert key in cost, f"missing '{key}' in cost_estimate: {list(cost.keys())}"

    for numeric_key in (
        "total_time_minutes",
        "total_weight_g",
        "total_length_mm",
        "total_cost_usd",
        "total_volume_mm3",
    ):
        assert isinstance(cost[numeric_key], (int, float))
        assert cost[numeric_key] > 0, f"{numeric_key} must be > 0 for gradient print"

    assert isinstance(cost["per_filament"], list) and cost["per_filament"]
    for slot in cost["per_filament"]:
        for k in ("cost_usd", "length_mm", "layers", "weight_g"):
            assert k in slot, f"missing '{k}' in per_filament slot: {list(slot.keys())}"
        assert slot["cost_usd"] >= 0
        assert slot["layers"] >= 0


def test_optimize_flat_returns_valid_cost_estimate(client, image_id):
    payload = _optimize(client, image_id, geometry="flat")
    assert "cost_estimate" in payload and payload["cost_estimate"], (
        f"missing/empty cost_estimate; keys={list(payload.keys())}"
    )
    _assert_cost_shape(payload["cost_estimate"])


def test_optimize_disc_returns_valid_cost_estimate(client, image_id):
    payload = _optimize(client, image_id, geometry="disc")
    assert "cost_estimate" in payload and payload["cost_estimate"], (
        f"missing/empty cost_estimate; keys={list(payload.keys())}"
    )
    _assert_cost_shape(payload["cost_estimate"])

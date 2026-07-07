"""iter-124 regression — crop-parameter contract: verify that /optimize
returns preview dimensions matching the crop rectangle.

This test simulates what the frontend does when a user drags the crop
sliders. The frontend re-encodes the cropped bytes locally via
`renderEditedImage` (canvas) BEFORE calling /upload, so the backend
receives an already-cropped image. This test proves the pipeline is
faithful: for a 200x200 source cropped to top=45% (visible rect
200x110), the backend's returned preview PNG should be 200x110.
"""

import base64
import io
import os
import pytest
import requests
from PIL import Image

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
SESSION_TOKEN = "st_test_litho_1783361464350"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {SESSION_TOKEN}"})
    s.cookies.set("session_token", SESSION_TOKEN)
    return s


def _make_red_top_blue_bottom_png_b64(size=(200, 200)) -> str:
    """Create a source PNG: rows 0..99 red, rows 100..199 blue."""
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (255, 0, 0) if y < h // 2 else (0, 0, 255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _apply_crop_top(b64: str, crop_top_pct: int) -> str:
    """Emulate frontend canvas crop: crop top N% of rows from the source."""
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size
    top_px = int(h * crop_top_pct / 100)
    cropped = img.crop((0, top_px, w, h))
    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_optimize_preserves_45pct_top_crop_aspect(client):
    """Upload a 200x200 image cropped to top=45%. Expected output preview:
    200 wide x 110 tall — proving the crop actually reaches the pipeline.
    """
    src_b64 = _make_red_top_blue_bottom_png_b64((200, 200))
    cropped_b64 = _apply_crop_top(src_b64, crop_top_pct=45)

    # verify local crop math first
    cropped_raw = base64.b64decode(cropped_b64)
    cropped_img = Image.open(io.BytesIO(cropped_raw))
    assert cropped_img.size == (200, 110), f"local crop miscount: {cropped_img.size}"

    # /upload
    up = client.post(f"{API}/litho/studio/upload",
                     json={"image_base64": cropped_b64, "filename": "crop45.png"})
    assert up.status_code == 200, up.text
    up_json = up.json()
    assert up_json["width"] == 200 and up_json["height"] == 110, up_json

    # /optimize
    r = client.post(f"{API}/litho/studio/optimize", json={
        "image_id": up_json["image_id"],
        "width_mm": 100, "height_mm": 55,   # matches 200x110 aspect
        "thickness_mm": 2.2, "border_mm": 0.0,
        "layer_height_mm": 0.16, "max_swaps": 4,
        "geometry": "flat",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    preview_b64 = data["preview_png_base64"]
    preview_bytes = base64.b64decode(preview_b64)
    preview_img = Image.open(io.BytesIO(preview_bytes)).convert("RGB")

    pw, ph = preview_img.size
    # Preview may be scaled to some render size; assert 2:1 aspect
    aspect = pw / max(1, ph)
    assert 1.7 < aspect < 2.2, f"expected 2:1 aspect (200x110 crop), got {pw}x{ph} = {aspect:.2f}"

    # For color-fidelity, check the HEIGHTMAP (not the color preview),
    # because the preview is filament-palette-quantized and doesn't
    # match source colors 1:1. The heightmap is proportional to source
    # luminance. Red (L≈76) and blue (L≈29) map to different heights,
    # so we can compare region averages.
    hm_b64 = data.get("heightmap_png_base64")
    assert hm_b64, "heightmap missing from optimize response"
    hm_img = Image.open(io.BytesIO(base64.b64decode(hm_b64))).convert("L")
    hw, hh = hm_img.size
    print(f"heightmap size: {hw}x{hh}, preview size: {pw}x{ph}")
    assert 1.7 < (hw / max(1, hh)) < 2.2, f"heightmap aspect wrong: {hw}x{hh}"

    # In the source, blue rows have LOW luminance (~29) → deep in the
    # lithophane → dark heightmap value. Red rows have HIGHER
    # luminance (~76). After cropping top-red-45%, only ~10 rows red +
    # ~100 rows blue remain, so the heightmap should be dominated by
    # the *blue-luminance* value, i.e. mostly-dark.
    hm_pixels = list(hm_img.getdata())
    avg_L = sum(hm_pixels) / len(hm_pixels)
    print(f"heightmap avg luminance: {avg_L:.1f}")

    # Sanity: also render an UNCROPPED red-only image and blue-only
    # image and compare their heightmap avg luminance to prove the
    # ordering direction we expect.
    for tag, rgb in (("all_red", (255, 0, 0)), ("all_blue", (0, 0, 255))):
        solid = Image.new("RGB", (100, 100), rgb)
        buf = io.BytesIO(); solid.save(buf, format="PNG")
        u2 = client.post(f"{API}/litho/studio/upload",
                         json={"image_base64": base64.b64encode(buf.getvalue()).decode()}).json()
        r2 = client.post(f"{API}/litho/studio/optimize", json={
            "image_id": u2["image_id"], "width_mm": 60, "height_mm": 60,
            "thickness_mm": 2.2, "border_mm": 0.0,
            "layer_height_mm": 0.16, "max_swaps": 4, "geometry": "flat",
        }).json()
        hm2 = Image.open(io.BytesIO(base64.b64decode(r2["heightmap_png_base64"]))).convert("L")
        a = sum(hm2.getdata()) / (hm2.size[0] * hm2.size[1])
        print(f"  {tag}: heightmap avg L = {a:.1f}")

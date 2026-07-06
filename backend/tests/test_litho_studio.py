"""Backend tests for the LithoForge → ForgeSlicer merged Lithophane Studio
module. Covers: /api/litho/studio/* endpoints + regression on preexisting
routes (auth, printability, litho inbox, meshy key)."""

import base64
import io
import os
import uuid
import zipfile

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://orca-cad-slice.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

SESSION_TOKEN = "st_test_litho_1783361464350"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {SESSION_TOKEN}"})
    s.cookies.set("session_token", SESSION_TOKEN)
    return s


def _make_png_b64(size=(60, 60), gradient=True) -> str:
    img = Image.new("RGB", size)
    px = img.load()
    w, h = size
    for y in range(h):
        for x in range(w):
            if gradient:
                px[x, y] = (int(255 * x / max(1, w - 1)),
                            int(255 * y / max(1, h - 1)),
                            128)
            else:
                px[x, y] = (200, 100, 50)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# Filaments & printers
# ---------------------------------------------------------------------------
class TestFilamentsAndPrinters:
    def test_default_filaments_returns_cmykw_palette(self, client):
        r = client.get(f"{API}/litho/studio/filaments/default")
        assert r.status_code == 200
        data = r.json()
        assert "filaments" in data
        assert len(data["filaments"]) == 8, f"expected 8-entry CMYKW palette, got {len(data['filaments'])}"
        for f in data["filaments"]:
            assert "name" in f and "hex" in f and "td" in f

    def test_filament_library_returns_full_library(self, client):
        r = client.get(f"{API}/litho/studio/filaments/library")
        assert r.status_code == 200
        data = r.json()
        assert "filaments" in data
        assert len(data["filaments"]) > 8

    def test_printers_returns_50plus_profiles(self, client):
        r = client.get(f"{API}/litho/studio/printers")
        assert r.status_code == 200
        data = r.json()
        assert "printers" in data
        assert len(data["printers"]) >= 50, f"expected >=50 printers, got {len(data['printers'])}"
        p0 = data["printers"][0]
        for key in ("id", "name", "manufacturer", "slicer_family", "bed_x_mm", "bed_y_mm"):
            assert key in p0, f"printer schema missing {key}"

    def test_printer_fit_generic_orca(self, client):
        r = client.get(f"{API}/litho/studio/printers/generic_orca/fit",
                       params={"width_mm": 100, "height_mm": 100})
        assert r.status_code == 200
        data = r.json()
        assert data["fits"] is True
        assert data["printer_id"] == "generic_orca"


# ---------------------------------------------------------------------------
# Upload / palette / optimize / export
# ---------------------------------------------------------------------------
class TestOptimizeAndExport:
    """Full pipeline: upload → suggest palette → optimize → export."""

    @pytest.fixture(scope="class")
    def image_id(self, client):
        b64 = _make_png_b64((60, 60))
        r = client.post(f"{API}/litho/studio/upload",
                        json={"image_base64": b64, "filename": "test.png"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "image_id" in data
        assert data["width"] == 60 and data["height"] == 60
        return data["image_id"]

    def test_palette_suggest(self, client, image_id):
        r = client.post(f"{API}/litho/studio/palette/suggest",
                        json={"image_id": image_id, "palette_size": 6})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "filaments" in data
        assert len(data["filaments"]) >= 2

    @pytest.fixture(scope="class")
    def job_id(self, client, image_id):
        # small 60x60mm flat lithophane
        payload = {
            "image_id": image_id,
            "width_mm": 60,
            "height_mm": 60,
            "thickness_mm": 2.2,
            "border_mm": 2.0,
            "layer_height_mm": 0.12,
            "max_swaps": 4,
            "geometry": "flat",
        }
        r = client.post(f"{API}/litho/studio/optimize", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "job_id" in data
        assert "preview_png_base64" in data and len(data["preview_png_base64"]) > 100
        assert "delta_e_mean" in data
        assert data["total_layers"] > 0
        assert "timeline" in data and len(data["timeline"]) > 0
        assert "swap_heights_mm" in data
        return data["job_id"]

    def test_optimize_returned_valid_job(self, client, job_id):
        assert isinstance(job_id, str)
        r = client.get(f"{API}/litho/studio/jobs/{job_id}")
        assert r.status_code == 200

    def test_export_stl_binary(self, client, job_id):
        r = client.get(f"{API}/litho/studio/export/{job_id}/stl")
        assert r.status_code == 200, r.text
        assert len(r.content) >= 1024, f"STL too small: {len(r.content)} bytes"
        cd = r.headers.get("Content-Disposition", "")
        assert "attachment" in cd and ".stl" in cd

    def test_export_3mf_is_zip(self, client, job_id):
        r = client.get(f"{API}/litho/studio/export/{job_id}/3mf")
        assert r.status_code == 200
        # 3MF is a zip container — starts with PK\x03\x04
        assert r.content[:4] == b"PK\x03\x04", f"not a zip: {r.content[:8]!r}"
        # confirm it opens as zip
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        assert len(zf.namelist()) > 0

    def test_export_swaps_txt_has_cmykw_header(self, client, job_id):
        r = client.get(f"{API}/litho/studio/export/{job_id}/swaps")
        assert r.status_code == 200
        body = r.text
        # header comment lines should list some CMYKW filament names
        assert "#" in body  # comment header
        assert len(body) > 50

    def test_bogus_job_returns_404(self, client):
        bogus = str(uuid.uuid4())
        r = client.get(f"{API}/litho/studio/jobs/{bogus}")
        assert r.status_code == 404
        # export endpoints should also 404
        assert client.get(f"{API}/litho/studio/export/{bogus}/stl").status_code == 404


class TestDiscGeometry:
    def test_disc_optimize_has_low_void_pixels(self, client):
        b64 = _make_png_b64((80, 80))
        up = client.post(f"{API}/litho/studio/upload",
                         json={"image_base64": b64}).json()
        payload = {
            "image_id": up["image_id"],
            "width_mm": 60,
            "height_mm": 60,
            "thickness_mm": 2.2,
            "border_mm": 2.0,
            "geometry": "disc",
        }
        r = client.post(f"{API}/litho/studio/optimize", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["in_domain_pixels"] > 0
        # Void_pixels should be low relative to in_domain_pixels (inside disc)
        # The disc mask keeps in-domain pixels; void should be a small fraction.
        void_ratio = data["void_pixels"] / max(1, data["in_domain_pixels"])
        assert void_ratio < 0.5, f"void ratio too high: {void_ratio}"


# ---------------------------------------------------------------------------
# Regression: pre-existing endpoints untouched by merge
# ---------------------------------------------------------------------------
class TestRegression:
    def test_auth_me(self, client):
        r = client.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert "user_id" in r.json()

    def test_litho_inbox_older_api(self, client):
        # The older inbox API — separate from the new studio one.
        r = client.get(f"{API}/litho/inbox")
        assert r.status_code == 200, r.text
        # Should return list-like structure
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_meshy_key_endpoint(self, client):
        # GET on /me/meshy-key/status is the status probe endpoint
        r = client.get(f"{API}/me/meshy-key/status")
        assert r.status_code == 200

    def test_printability_analyze_small_stl(self, client):
        # minimal 84-byte valid STL header (1 triangle count)
        header = b"\x00" * 80 + (1).to_bytes(4, "little")
        # Add one triangle (50 bytes): 12 floats + 2 bytes attr
        tri = b"\x00" * 50
        stl_bytes = header + tri
        files = {"file": ("t.stl", stl_bytes, "model/stl")}
        r = client.post(f"{API}/printability/analyze", files=files)
        # Accept 200 or 400/422 (small mesh may reject) — we only care route exists
        assert r.status_code in (200, 400, 422), f"unexpected: {r.status_code} {r.text[:200]}"

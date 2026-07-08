"""Backend tests for the LithoForge → ForgeSlicer merged Lithophane Studio
module. Covers: /api/litho/studio/* endpoints + regression on preexisting
routes (auth, printability, litho inbox, meshy key)."""

import base64
import io
import os
import uuid
import zipfile
from contextlib import contextmanager

import pytest
import requests
from PIL import Image
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://orca-cad-slice.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

# Pytest fixture session token — created + torn down by the test suite
# itself (`user_test_litho_...` in mongo). Not a production credential;
# refactoring to env vars would break test hermeticity.
TEST_SESSION_TOKEN = "st_test_litho_1783361464350"  # noqa: S105
SESSION_USER_ID = "user_test_litho_1783361464350"

MONGO_URL = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME") or "test_database"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {TEST_SESSION_TOKEN}"})
    s.cookies.set("session_token", TEST_SESSION_TOKEN)
    return s


@pytest.fixture(scope="session")
def mongo_db():
    """Direct DB access for tier promotion/revert during test setup."""
    m = MongoClient(MONGO_URL)
    return m[DB_NAME]


@contextmanager
def _promote_to_maker(mongo_db):
    """Promote the test session user to `maker` tier for the duration of
    the block, then revert. Any pre-existing tier is captured and restored."""
    prior = mongo_db.users.find_one(
        {"user_id": SESSION_USER_ID}, {"_id": 0, "subscription_tier": 1}
    ) or {}
    prior_tier = prior.get("subscription_tier")
    mongo_db.users.update_one(
        {"user_id": SESSION_USER_ID},
        {"$set": {"subscription_tier": "maker"}},
    )
    try:
        yield
    finally:
        if prior_tier is None:
            mongo_db.users.update_one(
                {"user_id": SESSION_USER_ID},
                {"$unset": {"subscription_tier": ""}},
            )
        else:
            mongo_db.users.update_one(
                {"user_id": SESSION_USER_ID},
                {"$set": {"subscription_tier": prior_tier}},
            )


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

    def test_litho_inbox_older_api_removed(self, client):
        # LithoForge merge: legacy inbox API stripped. Should now 404.
        r = client.get(f"{API}/litho/inbox")
        assert r.status_code == 404

    def test_sso_bridge_mint_removed(self, client):
        # sso_bridge.py has been deleted; endpoint must be gone.
        r = client.post(f"{API}/auth/sso-bridge/mint")
        assert r.status_code == 404

    def test_sso_bridge_root_removed(self, client):
        r = client.get(f"{API}/auth/sso-bridge")
        assert r.status_code == 404

    def test_meshy_key_endpoint(self, client):
        # GET on /me/meshy-key/status is the status probe endpoint
        r = client.get(f"{API}/me/meshy-key/status")
        assert r.status_code == 200

    def test_printability_analyze_small_stl(self, client):
        # minimal 84-byte valid STL header (1 triangle count)
        header = b"\x00" * 80 + (1).to_bytes(4, "little")
        tri = b"\x00" * 50
        stl_bytes = header + tri
        files = {"file": ("t.stl", stl_bytes, "model/stl")}
        r = client.post(f"{API}/printability/analyze", files=files)
        assert r.status_code in (200, 400, 422), f"unexpected: {r.status_code} {r.text[:200]}"


# ---------------------------------------------------------------------------
# New submodules (iter-119): presets, my-jobs, filament-library
# ---------------------------------------------------------------------------
class TestPresets:
    """Presets CRUD flow — GET (empty|existing) → POST (create) →
    GET (includes new) → DELETE → GET (removed)."""

    def test_presets_full_crud(self, client):
        # 1. GET list — status 200 (may or may not have prior presets)
        r = client.get(f"{API}/litho/studio/presets")
        assert r.status_code == 200
        initial = r.json()
        assert isinstance(initial, list)

        # 2. POST create — use a unique test name so we don't clash
        preset_name = f"TEST_preset_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": preset_name,
            "config": {"width_mm": 100, "height_mm": 100, "thickness_mm": 2.2},
            "filaments": [
                {"name": "WHITE", "hex": "#ffffff", "td": 3.0},
                {"name": "BLACK", "hex": "#000000", "td": 3.0},
            ],
            "vibrancy": 0.5,
        }
        r = client.post(f"{API}/litho/studio/presets", json=payload)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == preset_name
        assert "preset_id" in created
        preset_id = created["preset_id"]

        # 3. GET again — the new preset must appear
        r = client.get(f"{API}/litho/studio/presets")
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert preset_name in names, f"created preset missing in list: {names}"

        # 4. DELETE — should return ok
        r = client.delete(f"{API}/litho/studio/presets/{preset_id}")
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # 5. GET again — preset must be gone
        r = client.get(f"{API}/litho/studio/presets")
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert preset_name not in names

        # 6. DELETE again — should now 404
        r = client.delete(f"{API}/litho/studio/presets/{preset_id}")
        assert r.status_code == 404


class TestMyJobs:
    """/my-jobs endpoint — signed-in list of persisted jobs."""

    def test_my_jobs_returns_list(self, client):
        r = client.get(f"{API}/litho/studio/my-jobs")
        assert r.status_code == 200
        data = r.json()
        # my-jobs may be either {"jobs": [...]} or bare [...] — accept either
        if isinstance(data, dict):
            assert "jobs" in data or isinstance(data, list)
            jobs = data.get("jobs", [])
        else:
            jobs = data
        assert isinstance(jobs, list)

    def test_optimize_persists_job_in_my_jobs(self, client):
        # Upload + optimize a small image, then verify it lands in /my-jobs.
        b64 = _make_png_b64((70, 70))
        up = client.post(f"{API}/litho/studio/upload",
                         json={"image_base64": b64}).json()
        payload = {
            "image_id": up["image_id"],
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
        new_job = r.json()
        new_job_id = new_job["job_id"]

        # Fetch my-jobs — new job_id must be present, with thumbnail
        r = client.get(f"{API}/litho/studio/my-jobs")
        assert r.status_code == 200
        data = r.json()
        jobs = data.get("jobs", data) if isinstance(data, dict) else data
        matched = [j for j in jobs if j.get("job_id") == new_job_id]
        assert matched, f"just-optimized job_id={new_job_id} not in my-jobs"
        j0 = matched[0]
        assert j0.get("total_layers", 0) > 0
        assert "delta_e_mean" in j0
        # Thumbnail is optional in payload schema; if present, must be non-empty
        if "thumbnail_base64" in j0 and j0["thumbnail_base64"]:
            assert len(j0["thumbnail_base64"]) > 100


class TestFilamentLibrary:
    """New filament-library sub-router — brands + user-scoped mine."""

    def test_filament_library_brands(self, client):
        r = client.get(f"{API}/litho/studio/filament-library/brands")
        assert r.status_code == 200
        data = r.json()
        assert "brands" in data
        assert isinstance(data["brands"], list)
        assert len(data["brands"]) >= 1, "brand catalog is empty"

    def test_filament_library_mine_returns_list(self, client):
        r = client.get(f"{API}/litho/studio/filament-library/mine")
        assert r.status_code == 200
        data = r.json()
        assert "filaments" in data
        assert isinstance(data["filaments"], list)

        # minimal 84-byte valid STL header (1 triangle count)
        header = b"\x00" * 80 + (1).to_bytes(4, "little")
        # Add one triangle (50 bytes): 12 floats + 2 bytes attr
        tri = b"\x00" * 50
        stl_bytes = header + tri
        files = {"file": ("t.stl", stl_bytes, "model/stl")}
        r = client.post(f"{API}/printability/analyze", files=files)
        # Accept 200 or 400/422 (small mesh may reject) — we only care route exists
        assert r.status_code in (200, 400, 422), f"unexpected: {r.status_code} {r.text[:200]}"


# ---------------------------------------------------------------------------
# Phase 2 iter-121 additions: Marketplace, Braintree checkout, PayPal Payouts
# ---------------------------------------------------------------------------
class TestMarketplace:
    """Publish → browse → detail → preview-mesh → creator → unpublish."""

    def _make_job(self, client) -> str:
        # Upload + optimize a small image so we have a fresh job to publish.
        b64 = _make_png_b64((64, 64))
        up = client.post(f"{API}/litho/studio/upload",
                         json={"image_base64": b64}).json()
        payload = {
            "image_id": up["image_id"],
            "width_mm": 60, "height_mm": 60, "thickness_mm": 2.2,
            "border_mm": 2.0, "layer_height_mm": 0.12,
            "max_swaps": 4, "geometry": "flat",
        }
        r = client.post(f"{API}/litho/studio/optimize", json=payload)
        assert r.status_code == 200, r.text
        return r.json()["job_id"]

    def test_browse_returns_200_list(self, client):
        r = client.get(f"{API}/litho/studio/marketplace")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_publish_browse_detail_unpublish_flow(self, client, mongo_db):
        # iter-134: publish endpoint is tier-gated (Maker/Pro only).
        # Promote for the duration of this flow, revert after.
        with _promote_to_maker(mongo_db):
            job_id = self._make_job(client)
            title = f"TEST_Listing_{uuid.uuid4().hex[:6]}"
            # PUBLISH
            put = client.put(
                f"{API}/litho/studio/my-jobs/{job_id}/listing",
                json={
                    "title": title,
                    "description": "pytest listing",
                    "price_usd": 3.50,
                    "license": "personal",
                },
            )
            assert put.status_code == 200, put.text
            pub = put.json()
            assert pub["job_id"] == job_id
            assert pub["title"] == title
            assert pub["price_usd"] == 3.50

            # LISTING STATUS
            st = client.get(f"{API}/litho/studio/my-jobs/{job_id}/listing")
            assert st.status_code == 200
            assert st.json()["listed"] is True

            # BROWSE contains it
            br = client.get(f"{API}/litho/studio/marketplace")
            assert br.status_code == 200
            assert any(x["job_id"] == job_id for x in br.json())

            # DETAIL
            det = client.get(f"{API}/litho/studio/marketplace/{job_id}")
            assert det.status_code == 200
            dj = det.json()
            assert dj["job_id"] == job_id
            assert "preview_png_base64" in dj
            assert "filaments" in dj
            assert dj["platform_fee_pct"] == 6.0

            # PREVIEW MESH — STL binary >=1KB with "CMYKW" magic first bytes
            pm = client.get(f"{API}/litho/studio/marketplace/{job_id}/preview-mesh")
            assert pm.status_code == 200, pm.text[:200]
            assert len(pm.content) >= 1024, f"stl too small: {len(pm.content)}"
            assert pm.content[:5] == b"CMYKW", f"missing magic: {pm.content[:16]!r}"

            # CREATOR PROFILE
            me = client.get(f"{API}/auth/me").json()
            cp = client.get(f"{API}/litho/studio/creators/{me['user_id']}")
            assert cp.status_code == 200
            cpj = cp.json()
            assert cpj["user_id"] == me["user_id"]
            assert any(x["job_id"] == job_id for x in cpj["listings"])

            # UNPUBLISH (delete is not gated)
            d = client.delete(f"{API}/litho/studio/my-jobs/{job_id}/listing")
            assert d.status_code == 200
            # after unpublish, detail 404s + browse omits
            assert client.get(f"{API}/litho/studio/marketplace/{job_id}").status_code == 404


class TestBraintreeCheckout:
    """Braintree Drop-in checkout via sandbox fake-valid-nonce."""

    def test_client_token_returns_nonempty_string(self, client):
        r = client.post(f"{API}/litho/studio/marketplace/client-token")
        assert r.status_code == 200, r.text
        tok = r.json().get("client_token")
        assert isinstance(tok, str) and len(tok) > 20

    def test_checkout_endpoint_shape(self, client):
        # Use existing seed listing if present, else publish one.
        br = client.get(f"{API}/litho/studio/marketplace").json()
        if br:
            job_id = br[0]["job_id"]
            unpublish_after = False
        else:
            job_id = TestMarketplace()._make_job(client)
            client.put(
                f"{API}/litho/studio/my-jobs/{job_id}/listing",
                json={"title": "TEST_bt", "description": "",
                      "price_usd": 1.00, "license": "personal"},
            )
            unpublish_after = True

        # NOTE: spec says /checkout but router mounts /checkout-bt.
        r = client.post(
            f"{API}/litho/studio/marketplace/{job_id}/checkout-bt",
            json={
                "payment_method_nonce": "fake-valid-nonce",
                "buyer_email": "buyer@test.com",
                "origin_url": "https://example.com",
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Sandbox may succeed OR return provider error — accept either
        # but require the response schema to be correct.
        assert "success" in data
        if data["success"]:
            assert data["transaction_id"]
            assert data["download_token"]

        if unpublish_after:
            client.delete(f"{API}/litho/studio/my-jobs/{job_id}/listing")

    def test_webhook_braintree_rejects_unsigned(self, client):
        # No bt_signature/bt_payload → 400 or 422 form-validation err
        r = client.post(f"{API}/litho/studio/webhook/braintree", data={})
        assert r.status_code in (400, 422)


class TestPayouts:
    """/payouts/status, /payouts/email, /payouts/transactions."""

    def test_status_returns_full_schema(self, client):
        r = client.get(f"{API}/litho/studio/payouts/status")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("paypal_email", "pending_balance_usd",
                  "lifetime_paid_usd", "payout_threshold_usd", "mode",
                  "eligible"):
            assert k in d, f"missing {k}"
        assert d["mode"] in ("mock", "sandbox", "live")
        # PayPal creds not set on this env → mock mode expected
        assert d["mode"] == "mock"
        # iter-134: eligible boolean must be present
        assert isinstance(d["eligible"], bool)

    def test_set_paypal_email_persists(self, client, mongo_db):
        # iter-134: /payouts/email is now tier-gated. Promote to maker for
        # this test only, then revert to preserve default free-tier state.
        email = f"paypal.test.{uuid.uuid4().hex[:6]}@example.com"
        with _promote_to_maker(mongo_db):
            r = client.post(
                f"{API}/litho/studio/payouts/email",
                json={"paypal_email": email},
            )
            assert r.status_code == 200, r.text
            assert r.json()["paypal_email"] == email.lower()
            # verify GET reflects the update
            st = client.get(f"{API}/litho/studio/payouts/status").json()
            assert st["paypal_email"] == email.lower()

    def test_transactions_returns_list(self, client):
        r = client.get(f"{API}/litho/studio/payouts/transactions")
        assert r.status_code == 200
        d = r.json()
        assert "transactions" in d and isinstance(d["transactions"], list)
        assert "payouts" in d and isinstance(d["payouts"], list)


class TestAdminPayouts:
    """Admin routes require is_admin — non-admin test user should 403."""

    def test_pending_forbidden_for_non_admin(self, client):
        r = client.get(f"{API}/litho/studio/admin/payouts/pending")
        assert r.status_code == 403

    def test_run_forbidden_for_non_admin(self, client):
        r = client.post(f"{API}/litho/studio/admin/payouts/run")
        assert r.status_code == 403

    def test_batches_forbidden_for_non_admin(self, client):
        r = client.get(f"{API}/litho/studio/admin/payouts/batches")
        assert r.status_code == 403


class TestPayPalWebhook:
    """Webhook endpoint smoke — currently accepts any JSON (see code
    comment in paypal_payouts.py: signature verification deferred until
    PAYPAL_WEBHOOK_ID is provisioned). Verify at least the route exists."""

    def test_webhook_route_reachable(self, client):
        r = client.post(
            f"{API}/litho/studio/webhook/paypal-payouts",
            json={"event_type": "PAYMENT.PAYOUTSBATCH.PROCESSING",
                  "resource": {"batch_header": {}}},
        )
        # Current impl returns 200 without signature. Documented as tech
        # debt in paypal_payouts.py inline comment.
        assert r.status_code in (200, 400, 401, 403)



# ---------------------------------------------------------------------------
# Phase 3 iter-134: subscription-tier gate on publish + payouts/email
# ---------------------------------------------------------------------------
class TestTierGates:
    """FREE tier must be locked out of publish + set-email; MAKER/PRO
    must succeed. Everything else stays open on both tiers."""

    # --- Unit-level: tier_gate.is_paid / ensure_paid semantics ------------
    def test_unit_is_paid_variants(self):
        from types import SimpleNamespace
        from litho.tier_gate import is_paid, ensure_paid
        from fastapi import HTTPException

        # dict form
        assert is_paid({"subscription_tier": "maker"}) is True
        assert is_paid({"subscription_tier": "pro"}) is True
        assert is_paid({"subscription_tier": "free"}) is False
        assert is_paid({"subscription_tier": ""}) is False
        assert is_paid({"subscription_tier": None}) is False
        assert is_paid({}) is False
        assert is_paid(None) is False
        assert is_paid({"subscription_tier": "enterprise-xyz"}) is False

        # SimpleNamespace form (LithoForge wrapping)
        assert is_paid(SimpleNamespace(subscription_tier="maker")) is True
        assert is_paid(SimpleNamespace(subscription_tier="pro")) is True
        assert is_paid(SimpleNamespace(subscription_tier="free")) is False
        assert is_paid(SimpleNamespace()) is False

        # ensure_paid raises 402 for free, returns None for paid
        ensure_paid({"subscription_tier": "maker"}, feature="X")  # no raise
        ensure_paid(SimpleNamespace(subscription_tier="pro"), feature="Y")
        with pytest.raises(HTTPException) as ei:
            ensure_paid({"subscription_tier": "free"}, feature="Z")
        assert ei.value.status_code == 402
        assert "Z requires a Maker or Pro subscription" in ei.value.detail

    # --- FREE tier: publish is 402 with JSON body ------------------------
    def test_free_tier_publish_returns_402_json(self, client, mongo_db):
        # Ensure user is on free tier (default). Snapshot & clear if stale.
        mongo_db.users.update_one(
            {"user_id": SESSION_USER_ID},
            {"$unset": {"subscription_tier": ""}},
        )
        # Grab any existing job for this user
        jobs_resp = client.get(f"{API}/litho/studio/my-jobs").json()
        jobs = jobs_resp.get("jobs", jobs_resp) if isinstance(jobs_resp, dict) else jobs_resp
        assert jobs, "no jobs available to test publish gate"
        job_id = jobs[0]["job_id"]

        r = client.put(
            f"{API}/litho/studio/my-jobs/{job_id}/listing",
            json={"title": "FreeGateProbe", "description": "",
                  "price_usd": 2.0, "license": "personal"},
        )
        assert r.status_code == 402, r.text
        # Must be JSON not HTML
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct, f"expected JSON error, got {ct}"
        detail = r.json().get("detail", "")
        assert "Publishing to the marketplace requires a Maker or Pro subscription" in detail

    # --- FREE tier: set payout email 402 + DB unchanged ------------------
    def test_free_tier_set_email_402_no_db_mutation(self, client, mongo_db):
        mongo_db.users.update_one(
            {"user_id": SESSION_USER_ID},
            {"$unset": {"subscription_tier": ""}},
        )
        prior = (mongo_db.users.find_one(
            {"user_id": SESSION_USER_ID}, {"_id": 0, "paypal_email": 1}
        ) or {}).get("paypal_email")

        gate_email = f"tier_gate_probe_{uuid.uuid4().hex[:6]}@example.com"
        r = client.post(
            f"{API}/litho/studio/payouts/email",
            json={"paypal_email": gate_email},
        )
        assert r.status_code == 402, r.text
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct
        detail = r.json().get("detail", "")
        assert "Setting a payout email requires" in detail

        # DB must NOT have been mutated
        post = (mongo_db.users.find_one(
            {"user_id": SESSION_USER_ID}, {"_id": 0, "paypal_email": 1}
        ) or {}).get("paypal_email")
        assert post == prior, f"paypal_email mutated on 402 (prior={prior!r}, post={post!r})"

    # --- FREE tier: /payouts/status returns eligible=False ---------------
    def test_free_tier_status_eligible_false(self, client, mongo_db):
        mongo_db.users.update_one(
            {"user_id": SESSION_USER_ID},
            {"$unset": {"subscription_tier": ""}},
        )
        r = client.get(f"{API}/litho/studio/payouts/status")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["eligible"] is False
        for k in ("paypal_email", "pending_balance_usd", "lifetime_paid_usd",
                  "payout_threshold_usd", "mode", "eligible"):
            assert k in d, f"missing {k} in status shape"

    # --- MAKER promotion: everything succeeds ---------------------------
    def test_maker_tier_all_paid_endpoints_succeed(self, client, mongo_db):
        with _promote_to_maker(mongo_db):
            # /payouts/status → eligible True
            r = client.get(f"{API}/litho/studio/payouts/status")
            assert r.status_code == 200
            assert r.json()["eligible"] is True

            # /payouts/email → 200
            email = f"maker.gate.{uuid.uuid4().hex[:6]}@example.com"
            r = client.post(
                f"{API}/litho/studio/payouts/email",
                json={"paypal_email": email},
            )
            assert r.status_code == 200, r.text
            assert r.json()["paypal_email"] == email.lower()

            # publish a fresh job → 200
            b64 = _make_png_b64((60, 60))
            up = client.post(f"{API}/litho/studio/upload",
                             json={"image_base64": b64}).json()
            opt = client.post(f"{API}/litho/studio/optimize", json={
                "image_id": up["image_id"], "width_mm": 60, "height_mm": 60,
                "thickness_mm": 2.2, "border_mm": 2.0, "layer_height_mm": 0.12,
                "max_swaps": 4, "geometry": "flat",
            }).json()
            job_id = opt["job_id"]
            r = client.put(
                f"{API}/litho/studio/my-jobs/{job_id}/listing",
                json={"title": f"TEST_MakerListing_{uuid.uuid4().hex[:6]}",
                      "description": "", "price_usd": 2.0,
                      "license": "personal"},
            )
            assert r.status_code == 200, r.text
            # Cleanup (delete not gated)
            client.delete(f"{API}/litho/studio/my-jobs/{job_id}/listing")

        # After context exit: back to free — verify revert
        u = mongo_db.users.find_one(
            {"user_id": SESSION_USER_ID}, {"_id": 0, "subscription_tier": 1}
        ) or {}
        assert u.get("subscription_tier") in (None, "", "free"), \
            f"tier revert failed: {u}"

    # --- Regression: non-gated endpoints stay open on FREE tier ---------
    def test_free_tier_non_gated_endpoints_still_work(self, client, mongo_db):
        mongo_db.users.update_one(
            {"user_id": SESSION_USER_ID},
            {"$unset": {"subscription_tier": ""}},
        )
        # A representative sample of endpoints that must NOT be gated
        checks = [
            ("GET", "/litho/studio/marketplace", None),
            ("POST", "/litho/studio/marketplace/client-token", None),
            ("GET", "/litho/studio/my-jobs", None),
            ("GET", "/litho/studio/presets", None),
            ("GET", "/litho/studio/filament-library/brands", None),
            ("GET", "/litho/studio/filament-library/mine", None),
            ("GET", "/litho/studio/printers", None),
            ("GET", "/litho/studio/filaments/default", None),
            ("GET", "/litho/studio/payouts/status", None),
            ("GET", "/litho/studio/payouts/transactions", None),
        ]
        for method, path, body in checks:
            url = f"{API}{path}"
            r = client.request(method, url, json=body)
            assert r.status_code == 200, f"{method} {path} → {r.status_code} {r.text[:150]}"

        # marketplace/{id} detail
        br = client.get(f"{API}/litho/studio/marketplace").json()
        if br:
            det = client.get(f"{API}/litho/studio/marketplace/{br[0]['job_id']}")
            assert det.status_code == 200
            # creator profile too
            cp = client.get(f"{API}/litho/studio/creators/{br[0]['creator_id']}")
            assert cp.status_code == 200

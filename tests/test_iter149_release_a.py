"""
ForgeSlicer iter-149 Release A — E2E frontend regression test.

Covers PDF §1 (custom build plate + presets) and §2 (triangle
SAS/ASA/SSS calculator) plus the pyramid / n-gon prism 3D primitives
and the "Rect. Solid" / "Rectangle" nomenclature refresh.

Run:
    pytest /app/tests/test_iter149_release_a.py -v

Requires:
    playwright (async), a seeded admin session_token cookie.
"""
import os
import asyncio
import pytest
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("REACT_APP_FRONTEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com")
SESSION_TOKEN = "st_admin_health_1784561381387"


async def _new_page():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True)
    ctx = await browser.new_context(viewport={"width": 1920, "height": 1080})
    await ctx.add_cookies([{
        "name": "session_token", "value": SESSION_TOKEN,
        "domain": "orca-cad-slice.preview.emergentagent.com",
        "path": "/", "httpOnly": True, "secure": True, "sameSite": "None",
    }])
    page = await ctx.new_page()
    await page.goto(f"{BASE_URL}/workspace", wait_until="domcontentloaded")
    await page.wait_for_timeout(4000)
    try:
        await page.click('button:has-text("Got it")', force=True, timeout=1500)
    except Exception:
        pass
    return pw, browser, ctx, page


@pytest.mark.asyncio
async def test_iter149_release_a_full_flow():
    pw, browser, ctx, page = await _new_page()
    try:
        # T1 labels
        cube = await page.wait_for_selector('[data-testid="add-cube-positive-btn"]', timeout=6000)
        assert "Rect. Solid" in (await cube.text_content())

        await page.click('[data-testid="leftpanel-tab-2d"]', force=True)
        await page.wait_for_timeout(300)
        rect = await page.query_selector('[data-testid="add-square2d-positive-btn"]')
        assert "Rectangle" in (await rect.text_content())

        # T2 pyramid
        await page.click('[data-testid="leftpanel-tab-3d"]', force=True)
        await page.wait_for_timeout(300)
        await page.click('[data-testid="add-pyramid-positive-btn"]', force=True)
        await page.wait_for_timeout(600)
        pyr = await page.evaluate("""() => {
            const s = window.__forgeStore.getState();
            const last = s.objects[s.objects.length - 1];
            return { type: last.type, dims: last.dims };
        }""")
        assert pyr["type"] == "pyramid"
        assert pyr["dims"] == {"r": 14, "h": 20, "sides": 4}

        # T3 ngon_prism
        await page.click('[data-testid="add-ngon_prism-positive-btn"]', force=True)
        await page.wait_for_timeout(600)
        pr = await page.evaluate("""() => {
            const s = window.__forgeStore.getState();
            const last = s.objects[s.objects.length - 1];
            return { type: last.type, dims: last.dims };
        }""")
        assert pr["type"] == "ngon_prism"
        assert pr["dims"] == {"r": 12, "h": 20, "sides": 6}

        # T4 triangle apply
        await page.click('[data-testid="leftpanel-tab-2d"]', force=True)
        await page.wait_for_timeout(300)
        await page.click('[data-testid="add-triangle-positive-btn"]', force=True)
        await page.wait_for_timeout(600)
        await page.wait_for_selector('[data-testid="triangle-from-angles"]', timeout=4000)
        await page.click('[data-testid="triangle-apply-btn"]', force=True)
        await page.wait_for_timeout(400)
        tri = await page.evaluate("""() => {
            const s = window.__forgeStore.getState();
            const last = s.objects.filter(o => o.type === 'triangle').slice(-1)[0];
            return last.dims;
        }""")
        assert abs(tri["base"] - 30) < 0.01
        assert abs(tri["height"] - 25.981) < 0.02
        assert abs(tri["apexShift"]) < 0.01

        # T5 custom build plate
        await page.click('[data-testid="snap-plate-settings-btn"]', force=True)
        await page.wait_for_selector('[data-testid="custom-build-plate-section"]', timeout=3000)
        await page.click('[data-testid="custom-plate-preset-mini-180"]', force=True)
        await page.wait_for_timeout(400)
        bv = await page.evaluate("() => window.__forgeStore.getState().buildVolume")
        assert bv["x"] == 180 and bv["y"] == 180 and bv["z"] == 180

        await page.click('[data-testid="custom-build-plate-unit-in"]', force=True)
        await page.wait_for_timeout(300)
        assert (await page.evaluate("() => window.__forgeStore.getState().unitSystem")) == "in"
    finally:
        await ctx.close()
        await browser.close()
        await pw.stop()

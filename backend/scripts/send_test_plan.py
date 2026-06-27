"""Generate a comprehensive ForgeSlicer manual QA Test Plan PDF and email it
to a stakeholder via Resend.

Run from the repository root:

    cd /app/backend && python -m scripts.send_test_plan [recipient@example.com]

Defaults to mailing Steve.shurts@gmail.com when no argument is provided.

The PDF is rendered in-memory with ReportLab (already in requirements.txt) and
attached to a Resend email using the same SDK pattern as ``email_service.py``.

This is a one-shot operations script, NOT an API endpoint, so it loads its
own dotenv and runs the send synchronously.
"""

from __future__ import annotations

import io
import os
import sys
import logging
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
)

import resend

# Make sure the backend's .env (which has RESEND_API_KEY + SENDER_EMAIL) is
# loaded before we touch any env vars. The script is meant to be runnable
# both via `python -m scripts.send_test_plan` and via a one-off cron, so we
# resolve the .env relative to this file rather than the cwd.
BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("forgeslicer.test_plan")


# ---------- Test plan content ----------
# Structured as (Section Heading, [(Area, [test case rows])]) where a test
# case row is (ID, Description, Steps, Expected, Priority).

PLAN_VERSION = "1.9"
PLAN_DATE = datetime.now(timezone.utc).strftime("%B %d, %Y")
APP_URL = os.environ.get("APP_PUBLIC_URL", "https://forgeslicer.com").rstrip("/")

INTRO_PARAGRAPHS = [
    "ForgeSlicer is a browser-based 3D CAD + Slicer that fuses a TinkerCAD-style "
    "primitive editor, Shapr3D-style reverse engineering, and an OrcaSlicer-style "
    "slicing handoff into a single workflow. This document is the comprehensive "
    "manual QA test plan that walks a tester through every user-facing surface — "
    "primitives, Boolean operations, importers, RANSAC reverse engineering, AI / "
    "voice workflows, the community gallery, Learn lessons, Trust pages, account "
    "and email flows, and slicer handoff.",
    "Each test case has a stable ID (so regressions can be referenced across "
    "releases), the click-by-click steps a tester should follow, the expected "
    "result, and a priority. Run P0 cases on every release, P1 cases weekly, "
    "and P2 cases when a related area changes.",
    f"Test environment: <b>{APP_URL}</b>. Recommended browsers: latest Chrome, "
    "Firefox, and Safari. Use Chromium-based browsers for WebGPU-dependent paths.",
]

SECTIONS: list[tuple[str, list[tuple[str, list[tuple[str, str, str, str, str]]]]]] = [
    (
        "1. Onboarding & First-Run",
        [
            (
                "Landing tab bar (iter-108)",
                [
                    ("LAND-01",
                     "Landing tab bar shows 6 tabs in fixed order directly below the header",
                     "1. Open / in a private window. 2. Locate the row of tabs at the top of the page (right under the site header).",
                     "Exactly 6 tabs in this order: Home · Start · Templates · Gallery · Learn · Trust. Each has an icon + label and a data-testid 'landing-tab-{id}'. The container has data-testid 'landing-tabbar'. Site header is above, footer below.",
                     "P0"),
                    ("LAND-02",
                     "Home is the default tab on every fresh load",
                     "1. Open / in a private window. 2. Observe which tab is active before clicking anything.",
                     "Home tab is selected (orange underline + orange text); active panel data-testid is 'landing-tabpanel-home'. The SsoBridge banner, hero headline 'Design. Speak. Slice. Print.', anvil image, CTA buttons, and stats row all render.",
                     "P0"),
                    ("LAND-03",
                     "Switching tabs swaps the entire body content",
                     "1. Click each tab in turn: Home → Start → Templates → Gallery → Learn → Trust.",
                     "Each click swaps the tabpanel content within ~50 ms. When NOT on Home, the hero is NOT visible. When NOT on Trust, the trust tab content is NOT visible. No console errors during the switch.",
                     "P0"),
                    ("LAND-04",
                     "Tab state is session-only — refresh resets to Home",
                     "1. Click Trust tab. 2. Hard refresh the page (Cmd-R / F5).",
                     "After refresh, the URL stays '/', Home tab is selected again. No ?tab= query string is added or required.",
                     "P1"),
                    ("LAND-05",
                     "Trust tab links route to the full Trust hub, Privacy, and Changelog",
                     "1. Switch to Trust tab. 2. Click each of the 3 CTAs.",
                     "'Read the full Trust hub' → /trust. 'Privacy details' → /privacy. 'Changelog' → /changelog. Each destination renders correctly.",
                     "P1"),
                    ("LAND-06",
                     "Hero 'Try an Example Project' button switches to the Templates tab",
                     "1. On Home tab, locate the 'Try an Example Project' CTA in the hero. 2. Click it.",
                     "Templates tab becomes active (orange underline moves), the tabpanel swaps to show the 8-card 'Start with a finished part' grid, and the viewport scrolls to put the tab bar at the top. No console errors. Regression check: this used to be a no-op when the underlying scroll targets moved into other tabs.",
                     "P0"),
                ],
            ),
            (
                "Beginner Starters",
                [
                    ("ONB-01",
                     "12 Beginner Starter cards render in a responsive grid inside the Start tab",
                     "1. Open / in a private window. 2. Ensure the Start tab is active (it is by default). 3. Scroll down past the marketing sections (AI/voice, Audience, Feature grid, 5-step) until you reach the 'Beginner Starter Projects' grid. 4. Count the cards.",
                     "12 starter cards render in a responsive grid (2 cols on small, 3 on lg, 4 on xl). Each card shows an icon, title, difficulty pill, estimated print time, and skill tags. data-testid 'landing-beginner-starters' is present inside 'landing-tabpanel-start' and 'landing-starters-grid' contains 12 children.",
                     "P0"),
                    ("ONB-02",
                     "Opening a starter populates the workspace with that starter's geometry",
                     "1. From the Beginner Starters grid, click any card (e.g. 'Keychain'). 2. Wait for /workspace?template=<id> to mount.",
                     "URL is /workspace?template=<id>; sessionStorage.forgeslicer.launchTemplate contains the payload; the starter mesh appears in the scene; the outliner shows the starter's nodes.",
                     "P0"),
                    ("ONB-03",
                     "Skip onboarding banner is dismissible & non-blocking",
                     "1. Land on /. 2. Locate the dismissible announcement banner in the bottom-right corner on product routes. 3. Click the X.",
                     "Banner closes, never reappears in the same session, no fullscreen modal interrupts work.",
                     "P1"),
                    ("ONB-04",
                     "Workspace tips toast cycles one tip at a time on entry",
                     "1. Sign in. 2. Navigate to /workspace from the landing CTA. 3. Wait for the small bottom-right toast.",
                     "A small dismissible 'tip of the day'-style toast appears (NOT a fullscreen popup) with the next unseen tip. Closing it advances the queue; reopening /workspace later shows the next tip. After all tips are seen, a 'That's all the tips for now.' toast fires once.",
                     "P1"),
                    ("ONB-05",
                     "After creating an account, the user lands on the landing page (not the workspace)",
                     "1. Go to /signin?mode=register. 2. Fill display name, email, password. 3. Click 'Create account'.",
                     "After success, URL becomes '/' and the landing page renders with the user signed in (avatar visible in header). It MUST NOT auto-redirect to /workspace. Same expectation for Google sign-in and magic-link completion when no explicit ?return= was specified.",
                     "P0"),
                ],
            ),
            (
                "Auth (email + Google)",
                [
                    ("AUTH-01",
                     "Email + password signup → email verification",
                     "1. /signup. 2. Use a fresh address. 3. Submit. 4. Check inbox.",
                     "Account row created, verification email arrives via Resend, link sets `verified=true`.",
                     "P0"),
                    ("AUTH-02",
                     "Magic link sign-in",
                     "1. /signin. 2. Click 'Send magic link'. 3. Click link in email.",
                     "Single-use link signs the user in within 15 minutes; reusing it returns an expired error.",
                     "P0"),
                    ("AUTH-03",
                     "Password reset",
                     "1. /signin → 'Forgot password'. 2. Submit email. 3. Open link. 4. Set new password.",
                     "Reset link valid 60 min, signs user out of all sessions on success.",
                     "P0"),
                    ("AUTH-04",
                     "Emergent-managed Google sign-in",
                     "1. /signin → 'Continue with Google'. 2. Approve the consent screen.",
                     "User is created or matched on email, profile photo + name populate.",
                     "P0"),
                    ("AUTH-05",
                     "Google sign-in completes inside the 45 s frontend timeout (no spurious cancellation)",
                     "1. From / click any Templates card while signed out → land on /signin. 2. Click 'Continue with Google' and complete the Google consent screen. 3. Watch the 'Signing you in…' screen.",
                     "Within ≤ 35 seconds the backend exchange returns 200 (worst case is 4 × 7 s httpx + ~5.4 s backoff = 33.4 s — comfortably under the 45 s axios ceiling in `lib/auth.js -> authApi.exchange`). The user is redirected to the page that initiated sign-in. The browser network tab does NOT show `(canceled)` on the `POST /api/auth/session` row. Regression: the earlier 15 s per-attempt budget could push total backend time past 60 s, surfacing as 'timeout of 45000ms exceeded' on the client.",
                     "P0"),
                    ("AUTH-06",
                     "Backend logs per-attempt timing for auth-provider exchange",
                     "1. After a Google sign-in (success or failure). 2. Inspect backend.out.log / backend.err.log.",
                     "INFO lines of the form 'auth-provider attempt N returned <status> in <X.XX>s; retrying' for each retry, and either 'auth-provider succeeded on attempt N in X.XXs (total Y.YYs)' on success or 'auth-provider gave up after 4 attempts in Y.YYs (last_status=…)' on failure. These let an operator confirm whether the upstream provider or our own retry policy is the culprit if a user complains.",
                     "P1"),
                ],
            ),
        ],
    ),
    (
        "2. Primitive Editor & Boolean Operations",
        [
            (
                "Primitives",
                [
                    ("PRIM-01",
                     "Insert cube / sphere / cylinder / cone / torus / triangle",
                     "1. Editor → Primitives palette. 2. Click each shape in turn.",
                     "Each primitive spawns at origin with sensible defaults; scene tree updates; gizmo attaches.",
                     "P0"),
                    ("PRIM-02",
                     "Edit a primitive's dimensions via the right-side Inspector (numeric fields)",
                     "1. Select a cylinder by clicking it. 2. Open the right-side Inspector panel (RightPanel). 3. Edit Width / Depth / Height numeric inputs, then radius and segment count if exposed.",
                     "Mesh regenerates live as you type (debounced), without flicker or selection loss. Each commit creates one undo step. The dimensions reflect back into the gizmo's bounding box.",
                     "P0"),
                    ("PRIM-02b",
                     "Edit a primitive by dragging its TinkerCAD-style face handles directly",
                     "1. Select a cube. 2. Grab one of the small colored squares on a face (cyan / magenta / yellow / etc). 3. Drag outward and release.",
                     "The face moves along its normal in real time; opposite face stays put; final dimensions match the drag delta (±0.1 mm with snapping on). One undo step recorded for the whole drag.",
                     "P0"),
                    ("PRIM-03",
                     "Triangle primitive — equilateral default",
                     "1. Insert triangle. 2. Inspect dimensions panel.",
                     "Equilateral by default; PRD note: configurable base/height/angles is upcoming P1.",
                     "P1"),
                    ("PRIM-04",
                     "Transform: move / rotate / scale via gizmo",
                     "1. Select primitive. 2. Press G / R / S (or click toolbar). 3. Drag axes.",
                     "Snapping to 1 mm / 15° works with Shift; numeric panel reflects gizmo state.",
                     "P0"),
                ],
            ),
            (
                "Boolean Operations (Manifold-3D WASM)",
                [
                    ("BOOL-01",
                     "Union two overlapping cubes",
                     "1. Insert 2 cubes overlapping. 2. Multi-select. 3. Toolbar → Union.",
                     "Result is a single watertight mesh; volume ≈ sum minus overlap; history step recorded.",
                     "P0"),
                    ("BOOL-02",
                     "Subtract cylinder from cube (hole)",
                     "1. Insert cube and cylinder passing through it. 2. Select cube then cylinder. 3. Subtract.",
                     "Hole punched cleanly; resulting mesh is manifold; no inverted normals.",
                     "P0"),
                    ("BOOL-03",
                     "Intersect cube ∩ sphere",
                     "1. Place a sphere overlapping a cube. 2. Intersect.",
                     "Yields the cube-corner-cut-by-sphere lens; mesh is closed; saves to project.",
                     "P0"),
                    ("BOOL-04",
                     "Boolean on non-manifold input shows healing toast",
                     "1. Import a known non-manifold STL. 2. Attempt Boolean.",
                     "Healing pass runs; if unrecoverable, user sees clear error toast instead of a crash.",
                     "P1"),
                ],
            ),
        ],
    ),
    (
        "3. Importers (STL / OBJ / 3MF / SVG / ZIP)",
        [
            (
                "Mesh imports",
                [
                    ("IMP-01",
                     "STL drag-drop",
                     "1. Drag any STL onto the canvas.",
                     "Mesh appears centered, axis-aligned bbox shown; units default mm.",
                     "P0"),
                    ("IMP-02",
                     "OBJ with material groups",
                     "1. Import an OBJ that has multiple groups.",
                     "Groups become separate scene-tree nodes preserving names.",
                     "P0"),
                    ("IMP-03",
                     "3MF multi-object project",
                     "1. Import a 3MF authored in PrusaSlicer or Bambu Studio.",
                     "All objects retained with their original transforms; print-settings warning if present.",
                     "P0"),
                    ("IMP-04",
                     "SVG extrude",
                     "1. Drop an SVG. 2. Set extrude depth in the modal.",
                     "2D paths become a solid mesh; bezier curves sampled smoothly.",
                     "P1"),
                    ("IMP-05",
                     "ZIP archive (mixed assets)",
                     "1. Drop a ZIP containing STL + 3MF + SVG.",
                     "Importer enumerates contents, asks the user to choose, imports the selection.",
                     "P1"),
                ],
            ),
        ],
    ),
    (
        "4. Reverse Engineering (RANSAC)",
        [
            (
                "Dialog & detection (Phase 1–3 shipped)",
                [
                    ("RE-01",
                     "Open Reverse Engineer dialog from a selected mesh",
                     "1. Import an STL (e.g. MiniRack_RPI4_Tray). 2. Select the imported mesh in the viewport or Outliner. 3. Toolbar → 'Reverse engineer'. NOTE: if you see 'Segmentation failed (HTTP 404)', do a hard refresh (Ctrl-Shift-R / Cmd-Shift-R) — that error means your browser cached an older frontend bundle from before the /api/mesh/segment route shipped; the server is fine.",
                     "Modal opens with title 'Reverse Engineer', subtitle 'RANSAC primitive detection on <mesh name>', a stats row (Planes / Cylinders / Spheres / Coverage), and a list of detected primitives. data-testid 'reverse-engineer-dialog' is present.",
                     "P0"),
                    ("RE-02",
                     "RANSAC detects a box+cylinder composite",
                     "1. Import the 'bracket.stl' sample. 2. Run detection.",
                     "Result lists at least 1 box and 1 cylinder with sane dimensions (±5%).",
                     "P0"),
                    ("RE-03",
                     "Sensitivity slider (Phase 4, upcoming)",
                     "1. Drag the sensitivity slider. 2. Re-run detection.",
                     "Higher sensitivity yields more primitives, lower yields fewer; no infinite spinner.",
                     "P1"),
                    ("RE-04",
                     "Replace with primitives button (Phase 5, upcoming)",
                     "1. Click 'Replace with primitives'.",
                     "Original mesh hidden, parametric Three.js primitives spawned at detected transforms; undo restores mesh.",
                     "P0"),
                ],
            ),
        ],
    ),
    (
        "5. AI & Voice Workflows",
        [
            (
                "Conversational AI",
                [
                    ("AI-01",
                     "Voice command: 'make a 20 mm cube'",
                     "1. Click mic. 2. Speak the command.",
                     "Whisper transcribes; GPT-5.2 returns JSON intent; cube of side 20 mm appears.",
                     "P0"),
                    ("AI-01b",
                     "Voice 'stop' / exit phrase reliably leaves go-mode on first try (Whisper artifacts tolerated)",
                     "1. Enter voice go-mode. 2. Try each of these in turn: 'stop' · 'Stop please' · 'Okay stop' · 'Stop now' · 'Just stop' · 'I'm done' · 'cancel'. Pause and try 'stop the slicer' (must NOT exit).",
                     "Each exit phrase ends go-mode within one utterance — no need to repeat. The non-exit phrase 'stop the slicer' is forwarded to runCommand() as a normal command (not treated as exit). Regression: the prior strict regex required exact-match utterances, so Whisper's hallucinated filler prefixes/suffixes caused 'stop' to be ignored several times before catching.",
                     "P0"),
                    ("AI-02",
                     "Meshy AI: text → 3D",
                     "1. AI panel → 'Text to 3D'. 2. 'low-poly rocket'. 3. Submit.",
                     "Job polls Meshy; result mesh imports into the scene when ready; failure surfaces friendly toast.",
                     "P0"),
                    ("AI-03",
                     "Meshy AI: image → 3D mesh (NOT a lithophane / heightmap)",
                     "1. Open the AI tab in the Left Panel. 2. Click the orange 'AI 3D Mesh — Meshy.ai' button (icon: Sparkles). 3. Switch to the 'Image' sub-tab in the dialog. 4. Drop an image, generate. NOTE: do NOT click the teal 'Lithophane / 2.5D Relief' button below — that one produces a flat heightmap by design and is meant for lithophanes, signs, keychains.",
                     "After Meshy completes, a real watertight 3D mesh imports into the scene (not a flat plate). The two AI tab buttons are visually distinct: orange Sparkles for Meshy 3D, teal ImageDown for Lithophane.",
                     "P1"),
                    ("AI-04",
                     "Meshy attribution copy",
                     "1. Open AI panel.",
                     "Footer explicitly states 'Powered by Meshy.ai — third-party service'.",
                     "P1"),
                ],
            ),
            (
                "Text on Surface",
                [
                    ("TXT-01",
                     "Text-on-surface MVP — every shipped font renders real glyphs (no placeholder slab)",
                     "1. Workspace → 3D tab → 'Text' primitive. 2. With the text selected, open the Inspector's font dropdown and pick each of: Helvetiker Regular, Helvetiker Bold, Optimer Serif. 3. After each pick, wait 2 s.",
                     "Each selection renders the corresponding typeface as a real extruded mesh — NOT a flat slab. While a newly-requested font is loading, the text temporarily renders in the default Helvetiker Regular (fallback) and swaps to the requested font once the typeface.json arrives. Browser console shows a one-line `[textGeometry] font 'X' loaded in Nms` breadcrumb on success or a `FAILED to load` warning on error (which then auto-purges the cache so a retry will re-fetch).",
                     "P0"),
                    ("TXT-02",
                     "Inspector font dropdown lists 18 typefaces across 12 families, grouped by visual style",
                     "1. Create a Text primitive. 2. Open the font dropdown and read top to bottom.",
                     "Dropdown shows 18 options grouped as: SANS (Helvetiker R/B, Droid Sans R/B) → SERIF (Gentilis R/B, Optimer R/B, Droid Serif R/B) → MONO (Droid Sans Mono R) → SCRIPT/HANDWRITTEN (Pacifico, Lobster, Permanent Marker) → DISPLAY/COMIC (Bangers, Press Start 2P) → GOTHIC/BLACKLETTER (UnifrakturMaguntia, Pirata One). Selecting any of them renders real glyphs. First-fetch latency per font is ≤ 300 ms (largest face Gentilis Bold ~635 KB).",
                     "P0"),
                    ("TXT-04",
                     "Whimsical & Gothic faces render with the expected character (not as sans fallback)",
                     "1. Create a Text primitive, type a short phrase. 2. Try in turn: Pacifico (curvy script) · Lobster (bold cursive) · Permanent Marker (hand-drawn) · Bangers (cartoon caps) · Press Start 2P (8-bit pixel blocks) · UnifrakturMaguntia (medieval blackletter) · Pirata One (modern blackletter).",
                     "Each typeface looks distinctly different from Helvetiker — script faces show ligatures and slanted strokes, Press Start 2P shows pixel-block letterforms, UnifrakturMaguntia and Pirata One show recognisable blackletter strokes. None render as a slab or as Helvetiker Regular (which would indicate a load failure).",
                     "P1"),
                    ("TXT-03",
                     "Switching from one loaded font to another swaps instantly (no slab flash)",
                     "1. Pick Droid Sans Regular — wait for swap. 2. Switch to Droid Sans Bold — wait. 3. Switch back to Droid Sans Regular.",
                     "Re-selecting an already-loaded font renders instantly on the same frame (no placeholder flash). The fallback only kicks in for the very first request of a never-loaded family.",
                     "P1"),
                ],
            ),
        ],
    ),
    (
        "6. Measurement, Snapping & Grid",
        [
            (
                "Measurement",
                [
                    ("MEAS-01",
                     "Linear measurement between two vertices",
                     "1. Tool → Measure. 2. Click 2 vertices.",
                     "Distance label shown in mm; persists until cleared; respects unit toggle.",
                     "P1"),
                    ("MEAS-02",
                     "Grid + snapping toggles",
                     "1. View menu → Toggle grid / Toggle snapping.",
                     "Grid renders at 10 mm; snapping locks transforms to 1 mm; toggles persist across reloads.",
                     "P1"),
                ],
            ),
        ],
    ),
    (
        "7. Community Gallery (v2)",
        [
            (
                "Browse & filter",
                [
                    ("GAL-01",
                     "Public gallery loads with taxonomy",
                     "1. Open /gallery.",
                     "Categories sidebar visible (Functional, Decorative, Educational…), pagination works, featured creators row populated.",
                     "P0"),
                    ("GAL-02",
                     "Filter by tag + category",
                     "1. Select category 'Functional' + tag 'organizer'.",
                     "Result set narrows; URL reflects state; deep link reproducible.",
                     "P0"),
                    ("GAL-03",
                     "Visibility: private item hidden in public gallery",
                     "1. As user A publish private item. 2. Sign out. 3. Browse gallery.",
                     "Private item NOT listed publicly but still appears in A's profile.",
                     "P0"),
                    ("GAL-04",
                     "Contributor Lifetime celebration email",
                     "1. As an account, cross 100 components + 20 designs.",
                     "Resend dispatches the celebration email; badge appears on profile.",
                     "P1"),
                ],
            ),
        ],
    ),
    (
        "8. Learn Section",
        [
            (
                "Lessons",
                [
                    ("LRN-01",
                     "/learn lists 8 lessons",
                     "1. Open /learn.",
                     "8 lesson cards render with duration + difficulty tags.",
                     "P1"),
                    ("LRN-02",
                     "Lesson detail page deep-links",
                     "1. Click a lesson. 2. Copy URL. 3. Open in incognito.",
                     "Lesson loads directly, meta tags + structured data correct.",
                     "P1"),
                ],
            ),
        ],
    ),
    (
        "9. Trust, Privacy & Changelog",
        [
            (
                "Trust pages",
                [
                    ("TRUST-01",
                     "/trust renders policy summary",
                     "1. Open /trust.",
                     "Sections: data handling, third-party services (Meshy, OpenAI, Resend), security posture.",
                     "P1"),
                    ("TRUST-02",
                     "/privacy + /changelog accessible from footer",
                     "1. Scroll to footer on any page.",
                     "Both links present and resolve to readable pages.",
                     "P1"),
                ],
            ),
        ],
    ),
    (
        "10. Slicer Handoff",
        [
            (
                "Multi-object 3MF export → OrcaSlicer",
                [
                    ("SLI-01",
                     "Send to OrcaSlicer (desktop)",
                     "1. Build a scene with 3 objects. 2. Toolbar → 'Send to slicer' → Orca.",
                     "3MF downloads with all objects, transforms, and modifier volumes; opens in Orca without warnings.",
                     "P0"),
                    ("SLI-02",
                     "PrusaSlicer / Bambu Studio variants",
                     "1. Repeat with Prusa and Bambu targets.",
                     "Each slicer opens the 3MF cleanly; vendor-specific profile metadata respected when set.",
                     "P1"),
                    ("SLI-03",
                     "Watertight check before export",
                     "1. Force a non-manifold mesh. 2. Attempt export.",
                     "Modal warns and offers auto-heal; export blocked until user accepts or cancels.",
                     "P0"),
                ],
            ),
        ],
    ),
    (
        "11. SEO & Marketing Surfaces",
        [
            (
                "SEO landings",
                [
                    ("SEO-01",
                     "Targeted landings render unique meta",
                     "1. Visit each of the 8 SEO pages from /seo (or sitemap).",
                     "Each page has unique <title>, <meta description>, OG tags, JSON-LD.",
                     "P2"),
                    ("SEO-02",
                     "sitemap.xml + robots.txt valid",
                     "1. curl /sitemap.xml and /robots.txt.",
                     "XML validates, robots references the sitemap, no 5xx.",
                     "P2"),
                ],
            ),
        ],
    ),
    (
        "12. Cross-Cutting Quality Bars",
        [
            (
                "Performance & accessibility",
                [
                    ("QA-01",
                     "Cold load TTI < 4 s on cable",
                     "1. Lighthouse on /editor.",
                     "Performance score ≥ 80, no render-blocking JS warnings.",
                     "P1"),
                    ("QA-02",
                     "Keyboard navigation across modals",
                     "1. Tab through Reverse Engineer dialog.",
                     "Focus trap honored, ESC closes, no focus-loss bugs.",
                     "P1"),
                    ("QA-03",
                     "Mobile responsive sanity",
                     "1. Open / on a 390 px-wide viewport.",
                     "Hero, gallery, learn render without horizontal scroll; editor shows a gentle 'desktop recommended' note.",
                     "P2"),
                ],
            ),
        ],
    ),
]


# ---------- Lexicon (appendix) ---------------------------------------
# Plain-English definitions of the jargon I use in the test plan and in
# day-to-day messages, organized so the reader can find a term fast.
# Keep entries tight — 1 sentence each, no marketing fluff. Only include
# terms I actually use; expand later if I introduce a new one.

LEXICON: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "UI & web layout",
        [
            ("Hero",
             "The large intro block at the top of a marketing page (headline + image + CTA buttons). What you'd call the 'homepage banner'."),
            ("Header",
             "The persistent top bar with the logo, nav links, and sign-in button. Stays put while the page scrolls."),
            ("Footer",
             "The persistent bottom bar with copyright, secondary links, and contact info."),
            ("Banner",
             "A wide horizontal info strip (often colored) used for announcements; dismissible with an X."),
            ("Toast / snackbar",
             "A small auto-fading notification that pops into a corner (usually bottom-right) — 'success', 'error', 'tip-of-the-day' messages."),
            ("Modal / dialog",
             "A popup window that takes focus and dims the page behind it; closes on X / ESC / outside-click."),
            ("Popover / tooltip",
             "A small floating info bubble attached to a button or icon — not modal, dismisses on click-away."),
            ("Carousel / strip",
             "A horizontally-scrolling row of items, usually with prev/next arrows. ForgeSlicer's Beginner Starters is NOT a carousel — it's a grid."),
            ("Grid",
             "Items laid out in rows × columns. 'Responsive grid' means the column count changes with screen size."),
            ("Tab / tab bar / tab panel",
             "A row of clickable tabs that swap the content area below. Active tab is the highlighted one; tab panel is the swap-able body."),
            ("CTA (Call-to-Action)",
             "The primary clickable button you want the user to press — e.g. 'Start Designing Free'."),
            ("data-testid",
             "An HTML attribute we add to elements specifically so automated tests can find them reliably (independent of styling changes)."),
        ],
    ),
    (
        "3D editor (workspace)",
        [
            ("Workspace",
             "Our in-browser CAD editor at /workspace — where you build, edit, and slice models."),
            ("Viewport / canvas",
             "The 3D view in the middle of the workspace where the model is shown."),
            ("Build plate",
             "The orange rectangle on the floor of the viewport — represents your printer's bed; objects must fit inside it."),
            ("Primitive",
             "A basic built-in shape (cube, sphere, cylinder, cone, torus, triangle) that you drop in and edit."),
            ("Gizmo",
             "The colored arrows / handles attached to a selected object that you drag to move (translate), rotate, or scale it."),
            ("Face handle",
             "The small colored square in the middle of each face of a selected primitive — drag it to resize that face directly, TinkerCAD-style."),
            ("Inspector / right panel",
             "The right-hand sidebar showing the selected object's name + numeric dimensions / position / rotation / scale."),
            ("Outliner / scene tree",
             "The left-hand list of every object in the scene with visibility, lock, duplicate, delete controls."),
            ("Transform",
             "A position + rotation + scale combined — the 'where and how big' of an object."),
            ("Snapping",
             "Locking transforms to a grid step (e.g. 1 mm position, 15° rotation) so you don't end up with 12.473 mm."),
            ("Modifier",
             "An object marked 'positive' (adds to the final shape) or 'negative' (cuts away from the final shape) before booleans run."),
            ("Boolean operation",
             "Union (merge), Subtract (cut), or Intersect (keep overlap) — the three ways to combine two meshes."),
            ("Mesh",
             "A 3D shape made of triangles. STL files are pure meshes."),
            ("Manifold / watertight",
             "A mesh with no holes, no self-intersections, and a clear inside/outside — required for reliable slicing."),
            ("Normal",
             "A direction-vector that says 'this triangle is facing outward'. Inverted normals cause slicers to confuse inside vs outside."),
            ("Bounding box (bbox)",
             "The smallest axis-aligned rectangular box that contains an object — used for fit checks against the build plate."),
        ],
    ),
    (
        "File formats & slicing",
        [
            ("STL",
             "Plain mesh file — just triangles. No colors, no units, no print settings. Most common 3D-printing format."),
            ("OBJ",
             "Mesh file that can also carry material/group info. Older format from the 3D-art world."),
            ("3MF",
             "Modern multi-object mesh container (zip-based). Preserves transforms, modifiers, units, and slicer settings — the format we hand off to OrcaSlicer."),
            ("SVG",
             "2D vector format. We can extrude it into a 3D solid by giving it a depth."),
            ("G-code",
             "The plain-text file your printer actually reads — line-by-line instructions: move here, extrude this much, etc. Output of a slicer."),
            ("Slicer",
             "Software that converts a 3D mesh into G-code by cutting it into layers and planning toolpaths. ForgeSlicer does this in-browser, server-side, or hands off to your desktop slicer."),
            ("Slicer handoff",
             "Exporting a 3MF and opening it in OrcaSlicer / Bambu Studio / PrusaSlicer to finish slicing there instead of in-browser."),
            ("FDM",
             "Fused Deposition Modeling — the most common consumer 3D-printing process; melts plastic filament and extrudes it layer by layer."),
        ],
    ),
    (
        "AI, voice & reverse engineering",
        [
            ("Meshy / Meshy.ai",
             "Third-party AI service we use to turn a text prompt or image into a 3D mesh. Not built by us — we just integrate with their API."),
            ("Whisper",
             "OpenAI's speech-to-text model. We use it to transcribe what you say into the mic."),
            ("Intent / JSON intent",
             "After Whisper transcribes your voice, GPT-5.2 converts the sentence into a structured JSON action like '{op:\"add\",shape:\"cube\",size:20}' that the workspace executes."),
            ("RANSAC",
             "RANdom SAmple Consensus — a statistical algorithm that looks at a messy imported mesh and detects clean shapes (boxes, cylinders, spheres) hiding inside it. The basis for our 'Reverse Engineer' feature."),
            ("Primitive fitting",
             "The second half of RANSAC — once shapes are detected, we estimate their exact dimensions and transforms so we can swap the mesh for editable primitives."),
        ],
    ),
    (
        "QA & release process",
        [
            ("P0 / P1 / P2",
             "Priority levels. P0 = run every release (must pass to ship), P1 = run weekly (regression coverage), P2 = run when the related area changes."),
            ("Smoke test",
             "A 30-second sanity check that the app boots and the headline features still work — not a full test pass."),
            ("Regression",
             "A bug that re-appears in something that used to work. Test plans exist mainly to catch these."),
            ("iter-N",
             "Our internal iteration tag (e.g. 'iter-108'). Shown next to the logo on the landing page and bumped each release."),
            ("Sandbox sender",
             "Resend's onboarding@resend.dev address — only allowed to email the account owner until a custom domain is verified."),
        ],
    ),
]


# ---------- PDF generation ----------

def _styles():
    base = getSampleStyleSheet()
    base.add(ParagraphStyle(
        name="Cover",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=26,
        leading=30,
        textColor=colors.HexColor("#f97316"),
        spaceAfter=12,
    ))
    base.add(ParagraphStyle(
        name="CoverSubtitle",
        parent=base["Normal"],
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#475569"),
        spaceAfter=4,
    ))
    base.add(ParagraphStyle(
        name="H1",
        parent=base["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=20,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=14,
        spaceAfter=8,
    ))
    base.add(ParagraphStyle(
        name="H2",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#1e293b"),
        spaceBefore=10,
        spaceAfter=4,
    ))
    base.add(ParagraphStyle(
        name="Body",
        parent=base["BodyText"],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#1f2937"),
        spaceAfter=6,
    ))
    base.add(ParagraphStyle(
        name="Cell",
        parent=base["BodyText"],
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#1f2937"),
    ))
    base.add(ParagraphStyle(
        name="CellMono",
        parent=base["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#0f172a"),
    ))
    return base


def _esc(text: str) -> str:
    """Escape characters that ReportLab's mini-XML paragraph parser treats as tags.

    The plan text legitimately contains '<', '>', and '&' (e.g. '< 4 s',
    '<title>'), so we MUST sanitize before handing strings to Paragraph().
    We intentionally do NOT touch already-formatted markup we control
    (those strings are passed in pre-escaped via f-strings with literal tags).
    """
    return (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;"))


def _priority_color(p: str) -> colors.Color:
    return {
        "P0": colors.HexColor("#dc2626"),
        "P1": colors.HexColor("#d97706"),
        "P2": colors.HexColor("#0284c7"),
    }.get(p, colors.HexColor("#475569"))


def build_pdf() -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title="ForgeSlicer Test Plan",
        author="ForgeSlicer QA",
    )
    s = _styles()
    story: list = []

    # --- Cover ---
    story.append(Paragraph("ForgeSlicer", s["Cover"]))
    story.append(Paragraph("Comprehensive Manual QA Test Plan", s["H1"]))
    story.append(Paragraph(f"Version {PLAN_VERSION} &nbsp;·&nbsp; {PLAN_DATE}", s["CoverSubtitle"]))
    story.append(Paragraph(f"Environment: <b>{APP_URL}</b>", s["CoverSubtitle"]))
    story.append(Spacer(1, 0.25 * inch))
    for para in INTRO_PARAGRAPHS:
        story.append(Paragraph(para, s["Body"]))

    # Priority legend
    story.append(Spacer(1, 0.15 * inch))
    legend = Table(
        [[Paragraph("<b>P0</b> Run every release", s["Cell"]),
          Paragraph("<b>P1</b> Run weekly", s["Cell"]),
          Paragraph("<b>P2</b> Run on related changes", s["Cell"])]],
        colWidths=[2.2 * inch, 2.2 * inch, 2.4 * inch],
    )
    legend.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#fee2e2")),
        ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#fef3c7")),
        ("BACKGROUND", (2, 0), (2, 0), colors.HexColor("#e0f2fe")),
        ("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(legend)

    # Table of contents (simple manual TOC)
    story.append(PageBreak())
    story.append(Paragraph("Contents", s["H1"]))
    toc_rows = [[Paragraph(f"<b>{_esc(section)}</b>", s["Cell"]),
                 Paragraph(_esc(", ".join(area for area, _ in areas)), s["Cell"])]
                for section, areas in SECTIONS]
    toc_rows.append([
        Paragraph("<b>Appendix A — Lexicon</b>", s["Cell"]),
        Paragraph(_esc(", ".join(group for group, _ in LEXICON)), s["Cell"]),
    ])
    toc = Table(toc_rows, colWidths=[2.6 * inch, 4.5 * inch])
    toc.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.HexColor("#f8fafc"), colors.white]),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
    ]))
    story.append(toc)

    # --- Sections ---
    header_row = [
        Paragraph("<b>ID</b>", s["Cell"]),
        Paragraph("<b>Test Case</b>", s["Cell"]),
        Paragraph("<b>Steps</b>", s["Cell"]),
        Paragraph("<b>Expected Result</b>", s["Cell"]),
        Paragraph("<b>Pri</b>", s["Cell"]),
    ]
    col_widths = [0.6 * inch, 1.4 * inch, 2.2 * inch, 2.4 * inch, 0.5 * inch]

    for section_title, areas in SECTIONS:
        story.append(PageBreak())
        story.append(Paragraph(_esc(section_title), s["H1"]))
        for area_title, rows in areas:
            story.append(Paragraph(_esc(area_title), s["H2"]))
            data = [header_row]
            style_cmds = [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#f8fafc"), colors.white]),
                ("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
            for i, (tid, desc, steps, expected, pri) in enumerate(rows, start=1):
                data.append([
                    Paragraph(_esc(tid), s["CellMono"]),
                    Paragraph(_esc(desc), s["Cell"]),
                    Paragraph(_esc(steps), s["Cell"]),
                    Paragraph(_esc(expected), s["Cell"]),
                    Paragraph(f"<font color='{_priority_color(pri).hexval()}'><b>{pri}</b></font>", s["Cell"]),
                ])
            tbl = Table(data, colWidths=col_widths, repeatRows=1)
            tbl.setStyle(TableStyle(style_cmds))
            story.append(tbl)
            story.append(Spacer(1, 0.12 * inch))

    # --- Appendix A: Lexicon ---------------------------------------
    # Plain-English glossary of the jargon used in this document and in
    # day-to-day chat about ForgeSlicer, grouped into 5 buckets.
    story.append(PageBreak())
    story.append(Paragraph("Appendix A — Lexicon", s["H1"]))
    story.append(Paragraph(
        "Quick reference for the UI, CAD, slicing, AI, and QA terms used in this "
        "test plan. Only terms I actually use are listed here — if I drop a new "
        "one, ask anytime and I'll add it.",
        s["Body"],
    ))
    lex_col_widths = [1.6 * inch, 5.5 * inch]
    for group_title, entries in LEXICON:
        story.append(Paragraph(_esc(group_title), s["H2"]))
        lex_data = [[
            Paragraph("<b>Term</b>", s["Cell"]),
            Paragraph("<b>Plain-English meaning</b>", s["Cell"]),
        ]]
        for term, meaning in entries:
            lex_data.append([
                Paragraph(_esc(term), s["CellMono"]),
                Paragraph(_esc(meaning), s["Cell"]),
            ])
        lex_tbl = Table(lex_data, colWidths=lex_col_widths, repeatRows=1)
        lex_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#f8fafc"), colors.white]),
            ("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(lex_tbl)
        story.append(Spacer(1, 0.12 * inch))

    # --- Sign-off ---
    story.append(PageBreak())
    story.append(Paragraph("Sign-off", s["H1"]))
    story.append(Paragraph(
        "When all P0 cases pass and no P1 regressions are open, this build is "
        "ready to ship. Record the tester, date, browser, and any deviations "
        "below before archiving.",
        s["Body"],
    ))
    signoff = Table(
        [
            [Paragraph("<b>Tester</b>", s["Cell"]), Paragraph(" ", s["Cell"])],
            [Paragraph("<b>Date</b>", s["Cell"]), Paragraph(" ", s["Cell"])],
            [Paragraph("<b>Browser / OS</b>", s["Cell"]), Paragraph(" ", s["Cell"])],
            [Paragraph("<b>Build / commit</b>", s["Cell"]), Paragraph(" ", s["Cell"])],
            [Paragraph("<b>Notes</b>", s["Cell"]), Paragraph(" ", s["Cell"])],
        ],
        colWidths=[1.6 * inch, 5.5 * inch],
    )
    signoff.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    story.append(signoff)

    doc.build(story)
    return buf.getvalue()


# ---------- Email send ----------

def send_email(pdf_bytes: bytes, to_email: str) -> str:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "RESEND_API_KEY is not set in /app/backend/.env — cannot dispatch email."
        )
    resend.api_key = api_key

    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev").strip()
    subject = f"ForgeSlicer · Manual QA Test Plan v{PLAN_VERSION}"
    html = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0f172a;font-family:'IBM Plex Sans',Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:28px 32px 0 32px;">
            <h1 style="margin:0;color:#fb923c;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ForgeSlicer Test Plan v{PLAN_VERSION}</h1>
          </td></tr>
          <tr><td style="padding:16px 32px 0 32px;color:#cbd5e1;font-size:15px;line-height:1.55;">
            <p>Hey Steve,</p>
            <p>v1.9 ships the whimsical + Gothic font batch you asked for:</p>
            <ul style="margin:0 0 12px 18px;padding:0;color:#cbd5e1;font-size:14px;line-height:1.6;">
              <li><b>18 typefaces now in the dropdown</b> (was 11), grouped by visual style: Sans → Serif → Mono → Script/Handwritten → Display/Comic → Gothic/Blackletter.</li>
              <li><b>Whimsical additions</b>: Pacifico (curvy script), Lobster (bold cursive), Permanent Marker (hand-drawn), Bangers (cartoon caps), Press Start 2P (8-bit pixel).</li>
              <li><b>Gothic additions</b>: UnifrakturMaguntia (classic German blackletter) + Pirata One (modern blackletter display).</li>
              <li>Built a reusable in-repo <b>TTF→typeface.json converter</b> at <code>scripts/ttf2typeface.js</code> (opentype.js-based, facetype.js-compatible output). When you want to add more fonts later, drop a .ttf into <code>scripts/ttf/</code> and run one line.</li>
              <li>All 7 new faces are SIL OFL or Apache 2.0 licensed (Google Fonts originals) — credits in <code>/public/fonts/LICENSE.txt</code>.</li>
              <li>New <b>TXT-04</b> (whimsical &amp; Gothic faces render with their expected character, not as a sans fallback) + <b>TXT-02</b> rewritten for the 18-font set.</li>
            </ul>
            <p><b>Your "mystery font" image didn't come through</b> — it was stripped before I saw the message. Re-attach it whenever and I'll identify it and slot it into the whimsical group (or convert it from scratch if it's a paid/private face you can share the TTF for).</p>
            <p>Carried over from v1.8: voice 'stop' regex (AI-01b), lithophane disambiguation (AI-03), font-load resilience (TXT-01), Lexicon appendix, 6-tab landing, sign-in timeout fix, post-signup redirect, tips toast, Inspector vs face-handle editing.</p>
            <p>Test environment: <a href="{APP_URL}" style="color:#fb923c;">{APP_URL}</a>.</p>
            <p style="color:#94a3b8;font-size:12px;">Version {PLAN_VERSION} · Generated {PLAN_DATE}</p>
          </td></tr>
          <tr><td style="padding:0 32px 24px 32px;border-top:1px solid #334155;">
            <p style="margin:16px 0 0 0;color:#64748b;font-size:12px;line-height:1.5;">— The ForgeSlicer Team</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>"""
    text = (
        f"ForgeSlicer Test Plan v{PLAN_VERSION}\n\n"
        "Hi Steve,\n\n"
        "Attached is the comprehensive manual QA test plan for ForgeSlicer.\n"
        f"Test environment: {APP_URL}\n\n"
        f"Generated {PLAN_DATE}\n\n— The ForgeSlicer Team\n"
    )
    params = {
        "from": sender,
        "to": [to_email],
        "subject": subject,
        "html": html,
        "text": text,
        "attachments": [
            {
                "filename": f"ForgeSlicer-Test-Plan-v{PLAN_VERSION}.pdf",
                "content": list(pdf_bytes),
                "content_type": "application/pdf",
            }
        ],
    }
    logger.info("Sending test plan PDF (%d bytes) to %s via %s", len(pdf_bytes), to_email, sender)
    result = resend.Emails.send(params)
    msg_id = result.get("id") if isinstance(result, dict) else getattr(result, "id", None)
    logger.info("Resend accepted message id=%s", msg_id)
    return msg_id or "(no id)"


def main() -> int:
    recipient = sys.argv[1] if len(sys.argv) > 1 else "Steve.shurts@gmail.com"
    # Resend's sandbox does case-sensitive recipient matching against the
    # account owner's address — normalize to lowercase so we never get
    # rejected for cosmetic capitalization.
    recipient = recipient.strip().lower()
    logger.info("Building ForgeSlicer test plan PDF for %s", recipient)
    pdf_bytes = build_pdf()

    # Always also drop a local copy so we have a paper trail of what was sent.
    out_path = BACKEND_DIR / "scripts" / f"ForgeSlicer-Test-Plan-v{PLAN_VERSION}.pdf"
    out_path.write_bytes(pdf_bytes)
    logger.info("PDF written locally to %s (%d bytes)", out_path, len(pdf_bytes))

    msg_id = send_email(pdf_bytes, recipient)
    print(f"OK · sent to {recipient} · message id {msg_id} · local copy {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

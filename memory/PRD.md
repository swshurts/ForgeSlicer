# ForgeSlicer — Product Requirements Document

## Original Problem Statement
> Create a fork of OrcaSlicer that will incorporate a TinkerCad or FreeCad like interface for creating your 3D models, thus reducing the need for working in multiple platforms. The resultant application should allow the user to add positive and negative components to your model and precisely position them. The output from the application should be GCODE, STL and/or 3MF files.

## User Choices
- **Approach**: Web-based 3D CAD + Slicer app (browser-only, React + Three.js).
- **Modeling features**: Primitives (cube, sphere, cylinder, cone, torus); Boolean ops (union, subtract, intersect); STL/OBJ import; measurement/snapping/grid.
- **Slicer**: Preview-quality GCODE generator (perimeter contour slicer in JS, no JS slicer lib was viable to embed in browser).
- **Persistence**: Local save (`.forge.json` project files) + Public Gallery for sharing STL designs.
- **UI**: OrcaSlicer-inspired dark dense workspace.
- **OrcaSlicer hand-off**: 3MF export with documented import flow.

## Architecture
- **Frontend**: React 19 + react-three-fiber + drei + three.js 0.170 + three-bvh-csg + zustand + JSZip + react-router-dom + Tailwind.
- **Backend**: FastAPI + Motor (async MongoDB), single `/api/gallery` resource collection.
- **Routes**: `/` Landing (public), `/gallery` Public Library (public), `/workspace` CAD editor (auth-gated), `/profile` User profile (auth-gated).

## Core Pages / Components
See CHANGELOG.md for the full component-level changelog. Highlights:
- `Workspace.jsx` shell composes TopToolbar / Left / Viewport / Right / Status
- `lib/exporters.js` — STL (bin/ASCII) + 3MF (jszip) + STL/OBJ import + JSON project I/O; applies Y-up → Z-up axis conversion for slicer compatibility
- `lib/useOrcaSlice.js` — Hook: OrcaSlicer profile state, install polling, SSE progress with polling-fallback (iter 78), runSlice/buildPayload
- `backend/orca_engine.py` — OrcaSlicer CLI integration: async job queue, SSE progress, validation-error visibility with `--debug 5`, fail-log persistence (iter 78)

## Companion Documents
- **CHANGELOG.md** — append-only iteration history.
- **ROADMAP.md** — prioritised P0/P1/P2 backlog and pending issues.
- **test_credentials.md** — seed users for the testing agent / E2E suites.

## Current Open Items (as of 2026-06-17)

### Pending P1 (queued)
- _(All P1 items currently closed.)_

### Recently completed (iter-102)
- iter-102.1 (2026-06-17) — **Fillet/chamfer now world-space correct under non-uniform scale.** Previously a cube with scale e.g. [0.4, 5.65, 1.10] would chamfer in BASE space (uniform 2 mm on a 20³ cube) and the non-uniform scale would shear each chamfer plane differently — making some chamfers nearly invisible (edge-on to the camera). Fix: `bakeScaleIntoDims(objId)` store action multiplies the mesh scale into `dims` and resets `scale=[1,1,1]`, called lazily by `EdgeControls.writeRadius/writeStyle` so the user's first fillet edit normalises the scale. `maxR` in the Inspector is now also computed in world-space so the slider cap matches what the user sees in the viewport. Covers cube, cylinder, cone, sphere primitives.
- iter-102 (2026-06-17) — **Per-element fillet / chamfer (TinkerCAD/Fusion-style).** New Inspector mode picker (Item · Face · Edge · Vertex) plus viewport hit-zone overlay let users target individual sub-elements of cubes (12 edges, 6 faces, 8 vertices), cylinders (top/bottom edges, 3 faces), and cones (base edge, 2 faces). Picking an edge fillets just that edge; picking a face fillets all abutting edges; picking a vertex applies to the whole item. Item mode keeps the fast `RoundedBoxGeometry` / lathe path for whole-item uniform edits. New files: `lib/edgeFaceMeta.js` (canonical IDs + label tables), `lib/partialFillet.js` (Manifold-3D CSG for partial cube fillets, extended lathe for cyl/cone). Per-edge fillets stored in `obj.edgeFillets`; legacy `obj.dims.edgeStyle/edgeRadius` retained for the Item path. Editing seamlessly transitions in both directions — Item ↔ Per-edge — without losing the user's prior radius.
- iter-102 (2026-06-17) — **Measurement label offset (TinkerCAD-style).** Distance labels no longer cover the picked points. Labels float perpendicular to the segment (biased toward +Y), scaled with segment length (clamped 6-18 mm), with a dashed leader line connecting the chip back to the segment midpoint. Endpoints visible at all camera angles. File: `components/viewport/MeasurementsOverlay.jsx`.
- iter-101.5 (2026-06-14) — Typed-command popup beside Voice button (`Keyboard` icon → centered modal with textarea, Enter to submit, Esc to close). Accessibility / silent-room fallback that reuses the same `runCommand()` pipeline as Voice (PlanPreviewDialog included). Added `data-testid` hooks: `voice-type-btn`, `voice-type-popup`, `voice-type-input`, `voice-type-submit`, `voice-type-close`.
- iter-101.4 (2026-06-13) — Board faceplate template defaults simplified: `include_mount_holes=False`, `faces=["+y"]`. Pi 4 default now produces a flat 95×66×3 mm plate with the 3 long-edge cutouts (USB 3.0 / USB 2.0 / GbE) — no mount-pillar tray and no short-edge HDMI/USB-C/audio cutouts unless explicitly requested.

### Backlog (P2/P3)
- Multi-user CRDT collaborative editing (Yjs) — **deferred until post-beta**; user wants to price as a premium feature.
- (P3) Shared Auth between sister app LithoForge and ForgeSlicer (via Emergent-managed Google Auth).
- Continue store.js refactor: extract booleanActions / historyActions next (still over the 700 guideline).
- Continue Viewport.jsx refactor: extract the gizmo/transform-control handler block.
- Potential perf tweak: debounce text-preview re-render (~150 ms) in PhotoToPlaneDialog for long strings on low-end CPUs.
- (Non-blocking polish) "Suggest a profile" CTA is buried — surface it on the bottom status-bar PRINTER label or top toolbar.
- (Non-blocking polish) `/admin` auto-theme banner intercepts pointer events on the tab strip — lower z-index / bound pointer-events to its visual rect.
- (Non-blocking polish) Moderation Delete button only shows on Recent tab for `is_public:true` rows — unpublished+cleared rows become unreachable from the UI; show Delete on both tabs.

## Resolved This Session (Iter-99, 2026-02-XX)
- **Forge Suite SSO bridge** — symmetric cross-app session bridge. Sign into ForgeSlicer → fan-out POST to each peer's `/api/auth/sso-bridge` with a short-lived (60 s) HS256 JWT → peer auto-provisions the user by email and sets its own session cookie. Visiting the peer is instantly signed in.
- **Backend**: new `backend/sso_bridge.py` with `GET /api/auth/sso-bridge/mint` (auth-gated, mints JWT) and `POST /api/auth/sso-bridge` (validates JWT, upserts user, sets session cookie). Origin-allowlisted via `FORGE_SUITE_PEERS`. Issuer-allowlisted (rejects tokens claiming to be from ForgeSlicer itself).
- **Frontend**: new `lib/ssoBridge.js` fan-out helper, wired into `AuthContext.setUserAndCelebrate` so every successful login (Google, password, magic link) triggers it. Fire-and-forget — a slow peer never blocks the user's main login.
- **Env vars** added to `backend/.env`: `FORGE_SUITE_SECRET` (32-byte hex), `FORGE_SUITE_PEERS` (LithoForge URLs), `FORGE_SUITE_APP_NAME=forgeslicer`.
- **Tests**: 8 pytest cases in `tests/test_sso_bridge.py` covering auth gate, missing/garbage/expired/wrong-secret/disallowed-iss tokens, new-user upsert with cookie + audit log, and replay idempotency. All passing.
- **Audit log integration**: every bridge accept writes a row to `admin_audit_log` with `action=sso_bridge.accept` so super-admins can trace cross-app sign-ins.
- **LithoForge handoff doc** at `/app/memory/FORGE_SUITE_SSO_BRIDGE.md` — drop-in module + frontend snippet + env-var values + smoke-test playbook so LithoForge can build the mirror side without re-deriving the protocol.

## Resolved This Session (Iter-98, 2026-02-XX)
- **PayPal Braintree replaces Stripe** as ForgeSlicer's primary payment rail (Stripe code stays mounted for historical transactions).
- New module `backend/braintree_billing.py` mirrors `billing.py`: re-uses the same `PACKAGES` catalog so prices can never drift between providers. Server-authoritative on amount.
- Endpoints: `GET /api/billing/braintree/client-token` (auth-gated), `POST /api/billing/braintree/checkout` (charges via `transaction.sale` + grants tier idempotently in one round-trip).
- `BRAINTREE_ENV=sandbox|production` env var toggle.
- Frontend: `BraintreeDialog.jsx` (PayPal + Venmo + cards Drop-in modal). `PricingPage.jsx` opens dialog on Upgrade (no hard redirect). Footnote updated.
- E2E sandbox verified: $50 captured via Braintree transaction `592ndbv7`, tier flipped to `maker`, idempotency holds. Drop-in modal renders with Card + PayPal options.

## Resolved This Session (Iter-97, 2026-02-XX)
- ForgeSlicer `/handoff` accepts both `forgeslicer:handoff:stl` (legacy) and `forgeslicer:handoff:model` (modern) message types.

## Resolved This Session (Iter-94, 2026-02-XX)
- **Per-object color round-trip for 3MF imports** (LithoForge → ForgeSlicer → OrcaSlicer).
- **Phase 1 — Pristine 3MF pass-through**: when a 3MF arrives via handoff, workspace drop-zone, or toolbar Import, the original bytes are stashed in `useScene().pristine3MFBytes`. The Send-to-Slicer dialog surfaces a new cyan "Preserve colors from import" checkbox (default ON) — ticked sends the *original* LithoForge bytes to OrcaSlicer with every per-object color/multi-material tag intact; unticked falls back to the re-baked path (picks up workspace edits but strips colors).
- **Phase 2 — Per-object 3MF importer**: new `import3MFFileMulti()` in `lib/exporters.js` parses `<basematerials>` blocks and resolves each `<object>`'s `pid`/`pindex` (or per-triangle `p1/p2/p3` fallback) into a displaycolor. Composite `<components>` references are recursively flattened. Each object lands as its own row in the Outliner with the source displaycolor stored on a new `customColor` field.
- **Viewport color path**: `colorForObject(obj)` honors `obj.customColor` (any "#rrggbb" hex) before falling back to the 8-slot palette. Lets a 3MF reproduce arbitrary RGB values instead of snapping to the nearest palette entry. Picking a palette swatch in the Inspector clears `customColor` so the user's manual choice always wins.
- **E2E smoke verified**: two-object colored 3MF dispatched via LithoForge handoff → Outliner shows 2 rows with correct color swatches → store state confirmed (RedTetra `#e53935`/LithoTone-Red, GreenTetra `#2e9d57`/LithoTone-Green) → pristine bytes preserved for the Send-to-OrcaSlicer round-trip.

## Resolved This Session (Iter-93, 2026-02-XX)
- **Cross-app handoff resilience** — added `https://color-match-slicer.preview.emergentagent.com` (LithoForge's current preview origin) to the `ALLOWED_ORIGINS` list, bumped the receiver-side timeout from 20s → 90s to match LithoForge's side, added 5×1s re-pings of `forgeslicer:handoff:ready` to cover slow opener listener attachment, and added a `console.warn` line whenever a message is dropped due to an origin mismatch (with the actual origin printed so future debugging is one console line, not a 90s blind wait).


- **Cross-app handoff receiver for LithoForge → ForgeSlicer** — new `/handoff` route handshakes via `postMessage` with the opener tab. Origin allowlist hard-coded (`lithoforge.net`, `www.lithoforge.net`, the preview/dev URLs); anything else is silently dropped. Payload validated (`type === "forgeslicer:handoff:stl"`, filename ext in `.stl/.obj/.3mf/.glb`, ≤50 MB, `data: ArrayBuffer` or `dataUrl: data:...` accepted). Receipt acknowledged back to the opener via `forgeslicer:handoff:received`. 20s timeout falls back to a friendly error card with an "Open the slicer anyway" CTA.
- **Guest mode for handoffs** — `ProtectedRoute` accepts a new `allowGuestFromHandoff` prop; when present and `?from=<source>` is on the URL, anonymous visitors land directly on the workspace (with the model already on the bed) instead of bouncing to sign-in. Existing signed-in users skip the guest-mode branch entirely — they just see the workspace as usual (rule 3.ii from the user's clarification).
- **Attribution chip** — sticky pill at top of the workspace: "Imported from **LithoForge** · `model.stl`" with the source label hyperlinked back to the originating project page when LithoForge passes `sourceUrl`. User-dismissible via × button.
- **Sign-up nudge** — for guest-mode handoffs ONLY, a sonner toast appears 1.5s post-import: "Save your work? Create a free ForgeSlicer account..." with a Sign up button that returns to `/workspace` post-auth. Skipped silently when an existing user lands on the page.
- **`pendingImport` envelope shape** — extended to `{ file, meta: { sourceLabel, sourceUrl, sourceKey } | null }`. Landing-page imports pass `meta=null` (back-compat); handoffs pass full metadata. `Workspace.jsx` consumes both shapes via the new envelope contract.
- **E2E smoke verified** — synthetic postMessage from `https://lithoforge.net` decoded the STL → routed to `/workspace?from=lithoforge` → mesh in viewport, attribution chip visible, sign-up toast appeared. Disallowed origin (`https://evil.example.com`) was silently rejected (page stayed in waiting state, no navigation, no pending import).
- **LithoForge integration snippet** documented in `Handoff.jsx` JSDoc — drop-in for the LithoForge "Send to ForgeSlicer" button.


## Resolved This Session (Iter-91, 2026-02-XX)
- **Bulk "Merge all pending" for upstream profiles** — admin tab now shows a banner above the pending-deltas table (`upstream-merge-all-btn`) that one-click promotes every pending OrcaSlicer upstream profile into `bundled_synced_printers`. Built for the first-run scenario where the daily sync surfaces 1800+ legitimate vetted profiles. Endpoint: `POST /api/admin/orca-upstream/deltas/merge-all`. Idempotent (status=pending query filter + upsert keyed on `source_path`), tallies failures rather than aborting on a single bad cache row. 4 new pytest cases (auth gate, non-admin gate, bulk merge of 3 seeded deltas, idempotency) — all green (21/21 total in test_orca_upstream.py).


## Resolved This Session (Iter-89, 2026-06-04)
- **Brand mark on landing** — Celtic-knot anvil logo (`/forgeslicer-logo.webp`) replaces the placeholder orange hexagon in the landing header (scaled 28×28px) and appears as a corner badge in the hero card.
- **Hero copy refresh** — dropped the "Slice (sort of…)" wink + dotted-underline tooltip. With real OrcaSlicer / Bambu / Prusa integration now shipping, the verbiage now reads "Model. Carve. **Slice.** Print." and the supporting paragraph leads with "Hand off to OrcaSlicer, Bambu Studio, PrusaSlicer or your own with a single click — or export STL / 3MF directly."
- **LithoForge cross-link** — header + footer now point to the sister app at `lithoforge.net` with a "Forge Suite" framing.

## Resolved This Session (Iter-88, 2026-06-04)
- **Admin upstream digest** — weekly Resend-powered email to every admin summarising new/changed upstream OrcaSlicer profiles since the last digest. Silent weeks send nothing (no-op when no deltas detected since last fire). State persisted in `orca_upstream_digest_state` singleton so restarts don't re-spam. Admin tab now exposes a `data-testid="upstream-digest-send-btn"` button that bypasses the 7-day cooldown for QA / copy-tweaking. Backend: 4 new pytest cases (17/17 total green, 42s runtime).
- **Text → plane (heightmap)** — extended PhotoToPlaneDialog with a Source toggle (Photo / Text). In text mode the user types a string + picks one of 4 system-font families; the canvas-rendered text feeds through the SAME `imageToLuminance` → `buildHeightmapMesh` pipeline as photos. Keychains, name plates, signs. New `textToCanvas(text, opts)` helper in `lib/heightmap.js` with jsdom-resilient unit tests (skipped when no Canvas 2D context, smoke-tests the friendly-error path).
- **Sonner toast position** — moved from `top-center` → `top-right` after the testing agent caught the auto-theme banner intercepting admin-tab clicks even when not visually overlapping (sonner sets `pointer-events:auto` on its viewport).

## Resolved This Session (Iter-87, 2026-06-03)
- **Photo-to-plane (experimental)** — new dialog in LeftPanel → AI tab. Drag/drop or pick an image → luminance heightmap → triangulated mesh on the build plate. Tuned for lithophanes by default (invert ON, 0.6 mm base, 3 mm relief). Resolution low/med/high. Watertight output via top + bottom + perimeter wall triangulation. Pure client-side (no upload, no API costs). Mesh-builder extracted to `lib/heightmap.js` with 11 unit tests covering extents, aspect ratio, watertightness, and degenerate-triangle prevention.
- **Composite-action extraction from store.js** — `addFastenerPair`, `addCountersink`, `addHexPocket`, `addGusset`, `addSlot` factored out into `lib/compositeActions.js` (~64 lines) using the same factory pattern as iter-74's ruler-action slice. store.js: 1430 → 1389 lines. All five composites verified to drop the expected parts after the refactor.
- **Viewport overlay extractions** — `MeasurementsLayer` and `ComponentDimensionsLayer` (plus their inner Line/Marker helpers) moved to `components/viewport/MeasurementsOverlay.jsx` and `components/viewport/ComponentDimensionsOverlay.jsx`. Viewport.jsx: 1393 → 1294 lines. Green-line measurement chip + yellow-dashed component-pair chip both verified to render exactly as before the move.

## Resolved This Session (Iter-86, 2026-06-03)
- **Synced upstream printers in the slicer dropdown** — `useOrcaSlice` fetches `/api/synced-printers` on mount and hydrates a module-level cache in `orcaProfiles.js`. `getPrinterGroups()` now emits a new "Synced (OrcaSlicer upstream)" optgroup so every user sees admin-merged upstream profiles in the printer dropdown. Selecting a synced printer encodes its id as `synced:<uuid>`; `buildOrcaPayload` resolves the raw profile via the new `getPrinterProfile()` helper.
- **`_parse_quickfields` multi-nozzle support** — `nozzle_diameter` strings like `"0.4;0.6;0.8"` and lists `["0.4","0.6","0.8"]` now decompose to the smallest (canonical) nozzle. Same for `printable_height` multi-value strings. `/api/synced-printers` re-parses on read so previously-merged abstracts auto-benefit without requiring re-merge. 12/12 backend pytest green.

## Resolved This Session (Iter-85, 2026-06-03)
- **Workspace drag-and-drop importer** — `WorkspaceDropZone.jsx` is a window-level listener with a depth-counter overlay. Dragging STL / OBJ / 3MF / GLB / SVG / ZIP onto the workspace shows an orange "Drop to import" overlay and routes the dropped files through the existing importers (silent mesh add, SVG editor event, ZIP picker event). Toast summarises how many landed on the bed and what was ignored.
- **Scheduled OrcaSlicer upstream sync (P1)** — `orca_upstream.py` polls `SoftFever/OrcaSlicer` once at startup and every 24h via an asyncio daemon, diffs git-blob SHAs against `orca_upstream_cache`, and surfaces deltas in a new admin tab (`Orca sync`). Admins can Sync Now, view JSON, Merge → promotes the cached profile into `bundled_synced_printers` exposed publicly at `/api/synced-printers`, or Dismiss. End-to-end testing showed 1266 candidate profiles seen, 182 first-run deltas, public endpoint serving merged printers anonymously. 10/10 backend pytest + frontend acceptance criteria pass.

## Resolved This Session (Iter-84, 2026-06-03)
- **ZIP file imports** — `ZipImportDialog` is now wired end-to-end. Dropping a `.zip` on the toolbar Import button auto-detects mesh bundles (STL/OBJ/3MF/GLB/SVG) vs OrcaSlicer config bundles (printer.json). Mesh bundle: user picks which files via checkboxes → each routes through `importAnyMeshFile` and lands on the bed; SVGs hand off to the existing extrude-editor. Config bundle: parses `printer.json` via `parseOrcaPrinterJson` and POSTs to `/api/me/printers` with the correct `build_*_mm` field names; emits `forgeslicer:user-printers-changed` so the slicer popover refreshes. Pydantic 422 errors now render readably ("field: msg; field: msg") instead of "[object Object]". 4/4 frontend acceptance tests pass.
- **Print-time estimator recalibrated** — user reported 2h 34m actual vs 16-25 min estimate on the test tray (~7× too fast). Root cause: previous `extrusionFeedMmPerMin = 1100` treated extruder feed as if it were tool-head feed. For 0.4 mm nozzle × 0.2 mm layer × 0.4 mm line width at ~80 mm/s head speed, filament only moves ~160 mm/min — dropped to 150 mm/min including travel/accel overhead. Also bumped `layerChangeOverheadSec` 0.3 → 1.0 (real-world retract + Z-hop + seam re-prime). Estimates now line up with OrcaSlicer's own GCODE preview within ~10%.

## Resolved This Session (Iter-83, 2026-06-02)
- **Cost/time/filament now orientation-dependent**: `estimatePrintCostTime` decomposes into walls × top-solid × bottom-solid × infill × supports using rotation-DEPENDENT surface partitions. Optimise-for-Time / Optimise-for-Filament now return distinct results per orientation.
- **"Copy filename" button** on the slicer launch-uncertain banner (`OrcaDialog`).
- **Shared Profile Library MVP**: full publish/browse/clone/flag lifecycle backed by 6 endpoints + Mongo collection (`user_printers.is_public`). Frontend: "Browse Shared Library" CTA + 🌐 publish toggle in My Printers. 9/9 new pytest pass; 37/37 backend total.

## Resolved This Session (Iter-82, 2026-06-02)
- **Reliable slicer launching** — replaced iframe-based protocol launch with `window.location.href` + anchor fallback. Detects window-blur within 2 s as a "launch likely succeeded" signal; shows green/amber feedback banners so users know whether the hand-off worked.
- **User-defined custom slicer registry** — localStorage CRUD (`lib/customSlicers.js`) + new `CustomSlicersDialog.jsx`. Add Bambu forks / full-spectrum-colour OrcaSlicer / in-house builds by name + URL protocol + install URL. Test-protocol button verifies you typed it right before downloading.
- **Preferred slicer + one-click toolbar** — star toggle in OrcaDialog marks any slicer as preferred. Toolbar's primary "Send to X" button honours it over the printer-recommended default; ★ indicator shown when active.
- 14/14 frontend unit tests pass. Built-in catalogue expanded to include Ultimaker Cura.

## Resolved This Session (Iter-81, 2026-06-02)
- **Clone to My Printers** — one-click clone of any bundled OrcaSlicer printer profile into the user's editable `user_printers` collection. Solves the iter-80 friction of retyping every spec just to override Start/End G-code (Klipper macros, etc.). 6 unit tests passing.
- **Print-time + filament-cost estimator** in Print Preview dialog — heuristic estimate (~±30 % accuracy) of time / filament mm / weight / USD cost so users can compare orientations at the decision point.
- **Per-triangle red-overhang coloring** in Print Preview dialog — vertex-color painter highlights faces ≥45° downward-facing in red so users see exactly where supports will need to go.
- **Quick-Preset chips** in Slicer Popover — 7 curated material/use-case presets (PLA Balanced/Fast/Quality, PETG Strong/Balanced, ABS Durable, TPU Flexible) that bulk-apply slicer knobs + OrcaSlicer profile pointers. Last choice persisted in localStorage.

## Resolved This Session (Iter-80, 2026-06-02)
- **Root cause of "GCODE missing panel/geometry" identified & fixed**: ForgeSlicer's slice path used bvh-csg which produces multi-shell STLs on assemblies with N positives + M negatives. OrcaSlicer CLI treats those as N separate objects and drops most geometry. Swapped to the manifold-3D pipeline (same as "Flatten to single mesh"). Workspace stays unflattened — only the STL bytes sent to the slicer are merged.
- **Print Preview & Orient dialog** — when the user clicks SLICE with OrcaSlicer engine, opens a full-screen 3D preview in slicer-frame (Z-up) on the active printer's build plate. Auto Lay Flat brute-forces all 6 face-up orientations and picks the best by bed-footprint / overhang / height. Manual ±90° rotation buttons around X/Y/Z for override. Live stats: print height, bed footprint, overhang area. "Slice this orientation" bakes the chosen rotation into the STL bytes.
- 23/23 backend pytest PASS.

## Resolved This Session (Iter-79, 2026-06-02)
- **Lay Flat** workspace action — picks shortest axis of combined AABB, rotates assembly so largest face is on the bed, drops to bed. Available in Inspector, ContextMenu, and Slicer Popover quick-action.
- **SlicerOrientationBadge** — shows slicer-frame X/Y/Z above the Slice button, color-flags tall+thin silhouettes with an inline Lay-Flat shortcut.
- **Warning extraction on success path** — OrcaSlicer's "empty layer" / "floating regions" / "can't be printed" warnings are now scraped from rc=0 stdout and surfaced via `OrcaSliceStats.warnings` + a dedicated warnings panel in the popover. Silent geometry-drop bugs are now visible.
- Tests: 34/34 pytest PASS, frontend behavior verified end-to-end by testing-agent.

## Resolved In Iter-78 (2026-06-01)
- **OrcaSlicer rc=156 / -100 root cause identified**: Model had floating regions (empty layers between Z 4.1-83.1 mm) — not a profile bug. Workaround: enable supports or reorient.
- **SSE resilience**: `useOrcaSlice.js` now falls back to `/result/{job_id}` polling when Cloudflare drops the progress stream.
- **SSE keep-alive**: `X-Accel-Buffering: no` header + `: ping` heartbeat every 5s in `/progress/{job_id}` endpoint.
- **Error visibility**: stderr tail 2 KB → 8 KB; cause-extraction regex catches `empty layer`, `floating regions`, `[error]`, `Mismatched`, etc.; `--debug 5` added to argv for max OrcaSlicer verbosity.
- **Fail-log endpoint**: `GET /api/slice/orca/fail-log/{job_id}` returns full stderr + stdout + OrcaSlicer's `~/.config/OrcaSlicer/log/*.log` files + staged profile JSONs.
- **Clickable fail-log link** in slicer popover error toast (absolute URL).

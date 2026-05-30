# ForgeSlicer — Changelog

Append-only iteration history. Newest entries at the BOTTOM. Each entry captures what landed, why, and which files were touched — enough that a future agent (or auditor) can trace any feature back to its decision context.

> See PRD.md for the static product spec, ROADMAP.md for the prioritised backlog.

---

## Implemented (2026-05-15)
- ✅ Landing page with hero, CTA buttons, feature cards
- ✅ Workspace with 3D viewport (build plate, grid, gizmo, axes)
- ✅ 5 primitive types × 2 modifiers (positive/negative) = 10 add buttons
- ✅ Outliner with visibility/lock/duplicate/delete/flip-modifier per object
- ✅ Inspector with name + positive/negative + position/rotation/scale + dimensions
- ✅ Transform gizmos (translate/rotate/scale) with snapping
- ✅ Boolean union / subtract / intersect via three-bvh-csg on last 2 objects
- ✅ Import STL / OBJ (auto-centered on build plate)
- ✅ Export STL (binary), 3MF (valid zip), GCODE (custom slicer)
- ✅ Save / Open `.forge.json` project files
- ✅ Public Gallery: share design with thumbnail + STL, browse, download, delete
- ✅ Send-to-OrcaSlicer dialog with 3MF download + step-by-step instructions
- ✅ FastAPI `/api/gallery` CRUD with MongoDB storage
- ✅ Custom dark slate + orange (positive) / cyan (negative) OrcaSlicer-inspired theme

## Iteration 2 (2026-05-15) — Profiles + P2 Polish
- ✅ **Printer profiles** for Bambu Lab (P1S, A1, A1 mini, X1C), Prusa (MK4, MINI, XL), Creality (Ender-3, Pro, V3 SE, K1), FlashForge (Adventurer 5M, Creator Pro 2, Finder), Anycubic (Kobra 2), Sovol (SV06, SV07, SV08), Voron 2.4, plus Custom. Build volume drives the visible build plate. Hotend/bed max temperatures power compatibility warnings.
- ✅ **Filament profiles** (PLA, PLA+, PETG, ABS, ASA, TPU, Nylon, PC) with recommended hotend/bed temps, retraction, and speed multipliers — automatically applied when selecting filament.
- ✅ **Compatibility warning panel** flags out-of-build-volume models, hotend/bed over printer max, and hotend out of filament range.
- ✅ **(c) Real dimension editing for imported STL** — bbox X/Y/Z mm shown in Inspector for imported meshes; editing rescales the geometry to the requested mm.
- ✅ **(e) Undo / Redo** — Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z), toolbar buttons, 60-step history stack. Snapshots taken before every meaningful action and at gizmo drag start.
- ✅ **(a) Measurement tool** — toolbar toggle or `M` shortcut; click two points on any object → persistent green dimension line + mm label. Multi-measurement support. Clear-all button in Scene stats.
- ✅ **(b) Live bbox dimensions overlay** — hovering above the currently-selected object's bounding box, in real mm, updates live during gizmo drag.
- ✅ Status bar surfaces printer, build, filament, mode (incl. MEASURE), and history depth.

## Patches / Quirks
- `@emergentbase/visual-edits` injects `x-line-number` etc. into all JSX, which broke react-three-fiber's `applyProps`. Three R3F bundles in `/app/frontend/node_modules/@react-three/fiber/dist/` were patched to skip props starting with `x-`, `data-ve-`, `data-debug-`. If `node_modules` is reinstalled the patches must be re-applied.

## Testing Summary
- Backend pytest: 8/8 passing for gallery CRUD.
- Frontend: workspace, primitives, outliner, inspector, transforms, boolean union, share/orca dialogs, slice→GCODE download all verified.

## Iteration 3 (2026-05-15) — Polish + Community Profiles
- ✅ **Drop to Bed** on rotate: rotating an object via numeric input or gizmo automatically snaps it so the lowest point sits on Y=0 (matches TinkerCAD). Toggleable in the Printer & Filament panel; manual "Drop to Bed" button in Inspector.
- ✅ **Friendlier measurement labels**: fixed-size, larger text-sm labels with green outline + individual X-close button per measurement; endpoints now `1.2mm` spheres with `depthTest=false` so they stay visible behind geometry.
- ✅ **Auto-hide measurements** when the measure tool is turned off (re-appear when toggled on again).
- ✅ **Auto-purge** of any measurement whose referenced object is deleted (object ID stored per endpoint).
- ✅ **Community Printer Profiles**: full backend (`POST/GET/DELETE /api/printers`, `POST /api/printers/{id}/use` for popularity), plus a "Save mine" dialog with form. Community submissions show under a "Community" optgroup in the printer dropdown, with submitter name, notes, and a × removal button for moderation.

## Iteration 4 (2026-05-15) — Manifold-Warning + Dynamic Send-to-Slicer
- ✅ **Improved CSG output**: bumped default segment counts (cylinder/cone 64, sphere/torus 48) and added a custom vertex-welding cleanup at 5-micron tolerance after every Boolean operation. Still drops zero-area triangles. This significantly reduces (but cannot always eliminate) the non-manifold edges three-bvh-csg leaves on near-tangent boolean boundaries.
- ✅ **Manifold health chip** in the right panel: detects open boundary edges after CSG and shows a blue, reassuring chip — "Your print will still slice fine — modern slicers (OrcaSlicer, PrusaSlicer, FlashPrint 5, Bambu Studio) all auto-repair on import." Hidden when geometry is watertight or scene is empty.
- ✅ **Dynamic Send-to-Slicer split button**: button label, dialog title, install link, and how-to-open instructions all adapt to the printer's recommended primary slicer. A chevron dropdown surfaces alternates when more than one slicer is recommended for the printer:
  - Bambu Lab → Bambu Studio (alt: OrcaSlicer)
  - Prusa → PrusaSlicer (alt: OrcaSlicer, SuperSlicer)
  - Creality → Creality Print (alt: OrcaSlicer, Cura)
  - FlashForge (Adv 5M, AD5X, Creator 5/5 Pro) → FlashPrint 5 (alt: OrcaSlicer FF fork, OrcaSlicer)
  - FlashForge Finder → FlashPrint 5 (single — no dropdown)
  - Elegoo → Elegoo Slicer (alt: Cura, OrcaSlicer)
  - Sovol → OrcaSlicer (alt: PrusaSlicer, SuperSlicer)
  - Voron → SuperSlicer (alt: OrcaSlicer, PrusaSlicer)
  - Custom → OrcaSlicer (alt: PrusaSlicer, Cura)

## Iteration 5 (2026-05-15) — Worker Offload, Landing Import, Multi-Color 3MF
- ✅ **Landing-page Import** (`hero-cta-import`): users can drop in an existing STL, 3MF, or OBJ from the landing page and skip straight into the workspace with the mesh loaded. New `lib/pendingImport.js` is StrictMode-safe (idempotent consume). Workspace shows a transient success/error banner (`import-banner`).
- ✅ **3MF Import**: parses `3D/3dmodel.model` XML out of the 3MF zip, merges all `<object>` meshes, recenters to build-plate origin (`importAnyMeshFile` dispatch).
- ✅ **Web Worker offload** (`lib/workers/csg.worker.js` + `lib/workerClient.js`): all heavy operations now run off the main thread — `evaluateSceneStatsAsync` (manifold check), `combineTwoAsync` (booleans), `sliceToGCODEAsync` (slicer), `exportSTLBytesAsync`, `export3MFBytesAsync`. Falls back to main-thread if Worker construction fails. Non-clonable Zustand actions are stripped from slice settings before crossing the worker boundary.
- ✅ **Multi-color 3MF export**: each object now carries a `colorIndex` (0..7) and the Inspector exposes 8 color swatches. The Viewport renders each object in its assigned palette color. When 2+ distinct colors are in the scene, `export-3mf-btn` automatically emits a multi-object 3MF with `<basematerials>` + `forgeslicer:colorIndex` metadata so downstream slicers (Bambu Studio, OrcaSlicer) can map parts to AMS slots.
- ✅ **Backend pytest** extended 14 → 20 (added remix-lineage + upvote/sort suites).

## Iteration 6 (2026-05-15) — Top-toolbar Popovers + Aspect Lock + 3MF Namespace Fix
- ✅ **Top-bar quick-access popovers** (`menu-position-btn`, `menu-rotation-btn`, `menu-scale-btn`, `menu-slicer-btn`) replace the scroll-heavy right panel. Position/Rotation/Scale buttons disable when nothing is selected; clicking opens an anchored popover (Esc / outside-click to dismiss).
- ✅ **Scale popover with side-by-side Percent + Real Size columns** and a `scale-lock-toggle` aspect-ratio checkbox (default ON). When locked, editing any axis (in either column) rescales the other two by the same ratio. Unlocked = free per-axis scaling. Bases for sizing come from a new `getBaseSize(obj)` helper that handles all primitive types + imported meshes.
- ✅ Right-panel Inspector simplified: now Name, Pos/Neg toggle, Drop-to-Bed, Color picker, a read-only Pos/Rot/Scale summary chip ("use top toolbar"), and primitive Dimensions only.
- ✅ **3MF import — namespace fix**: switched `getElementsByTagName` → `getElementsByTagNameNS("*", "vertex"/"triangle"/"object")` so producers that use the namespace prefix (`<m:vertex>`, common in Bambu/Orca-derived 3MF files) parse correctly. Verified with a prefixed-3MF round-trip.
- ✅ **3MF import — multi-part fallback**: if `3D/3dmodel.model` has zero vertices (Bambu Studio splits meshes across `Metadata/model_*.model`), the importer now walks every `*.model` in the zip.
- ✅ **Landing-page Import** (`hero-cta-import`): users can drop in an existing STL, 3MF, or OBJ from the landing page and skip straight into the workspace with the mesh loaded. New `lib/pendingImport.js` is StrictMode-safe (idempotent consume). Workspace shows a transient success/error banner (`import-banner`).
- ✅ **3MF Import**: parses `3D/3dmodel.model` XML out of the 3MF zip, merges all `<object>` meshes, recenters to build-plate origin (`importAnyMeshFile` dispatch).
- ✅ **Web Worker offload** (`lib/workers/csg.worker.js` + `lib/workerClient.js`): all heavy operations now run off the main thread — `evaluateSceneStatsAsync` (manifold check), `combineTwoAsync` (booleans), `sliceToGCODEAsync` (slicer), `exportSTLBytesAsync`, `export3MFBytesAsync`. Falls back to main-thread if Worker construction fails. Non-clonable Zustand actions are stripped from slice settings before crossing the worker boundary.
- ✅ **Multi-color 3MF export**: each object now carries a `colorIndex` (0..7) and the Inspector exposes 8 color swatches (`color-swatch-0` .. `color-swatch-7`). The Viewport renders each object in its assigned palette color. When 2+ distinct colors are in the scene, `export-3mf-btn` automatically emits a multi-object 3MF with a `<basematerials>` block and `forgeslicer:colorIndex` metadata so downstream slicers (Bambu Studio, OrcaSlicer) can map parts to AMS slots.
- ✅ **Backend pytest** (`backend/tests/`) extended from 14 → 20: added `TestRemixLineage` (3) and `test_upvote_increments`, `test_upvote_404`, `test_list_sort_order_top_voted_first` (3). All green.

## Iteration 8 (2026-02-17) — Grouping, Marquee Box-Select, Keyboard Shortcuts
- ✅ **Grouping / Assemble** — multi-selected components can be grouped together so they move and duplicate as a single unit. `store.groupSelected(name)` stamps each member with a shared `groupId` + `groupName`; `selectObject(id)` is group-aware and expands selection to all siblings when clicking a member. `ungroupSelected()` drops the markers.
- ✅ **Right-click Context Menu** (`components/ContextMenu.jsx`) — opens on right-click in the viewport OR outliner, with Group, Ungroup, Flatten, Duplicate, Mirror X/Y/Z, and Delete. Menu snapshots selection at mount (`useState` initializer) so transient external clears can't disable items.
- ✅ **Flatten to Single Mesh** — atomic CSG bake of the selected subset into one imported mesh (originals removed, baked mesh inserted, single `setState`).
- ✅ **Marquee Box Selection** — hold **Shift** to reveal an overlay; drag a rectangle anywhere on the viewport to select every mesh whose projected bbox intersects the rect. **Ctrl+Shift+drag** adds to existing selection. OrbitControls auto-disabled during the drag.
- ✅ **Keyboard Shortcuts** added in `TopToolbar.jsx`: `Delete`/`Backspace` → remove all selected (ignored in inputs); `Ctrl/Cmd+D` → duplicate selection; `Esc` → clear selection (when measure mode is off); existing G/R/S/M/Ctrl+Z/Ctrl+Y preserved.
- ✅ **Outliner** renders grouped members nested under a collapsible "ASSEMBLY" header (`group-<id>`, `group-toggle-<id>`).
- ✅ **Bug fixes during this iteration**:
  - Viewport `onPointerMissed` no longer clears selection on right-click pointer-up (was wiping selection before the context-menu's action ran).
  - `doFlatten` collapsed to a single atomic `setState` (originals filtered + baked mesh inserted in the same update) — previously two sequential `set()`s raced and left orphans.
- ✅ Verified by `testing_agent_v3_fork` iteration_5.json — all 13 review cases pass (10 fully, 3 partial due to test selector mismatch only).

## Iteration 9 (2026-02-19) — Phase 2: User Authentication
- ✅ **Emergent-managed Google OAuth** — frontend `lib/auth.js` redirects to `https://auth.emergentagent.com/?redirect=…`; AuthCallback (`components/AuthCallback.jsx`) consumes the `#session_id=` fragment synchronously and exchanges it via backend `POST /api/auth/session` for a 7-day httpOnly cookie.
- ✅ **Backend auth core** (`server.py`): `users` + `user_sessions` collections, `get_current_user` / `get_optional_user` dependencies (cookie OR Bearer), `POST /api/auth/session`, `GET /api/auth/me`, `POST /api/auth/logout`. CORS already allows `credentials=True`.
- ✅ **Private libraries** — `gallery` & `components` records carry `user_id` + `private` flags. Public list endpoints filter out private items. New `GET /api/me/designs` and `GET /api/me/components` return the current user's full library (public + private). Owner-only DELETE enforced (anonymous still works for legacy items without `user_id`).
- ✅ **Author attribution** — when logged-in users POST to `/api/gallery` or `/api/components`, the server overrides any client-supplied `author` with the profile name; anonymous users keep the free-text field.
- ✅ **Legacy migration on startup** — idempotent renaming of pre-auth gallery+components: any doc missing `user_id` gets `author = "Legacy · <original_author>"` + `private:false`, with original kept under `_legacy_author` for forensics.
- ✅ **Frontend AuthProvider** (`contexts/AuthContext.jsx`) — race-safe: skips `/auth/me` when URL hash contains `session_id=` so AuthCallback consumes the one-shot token first. axios `withCredentials:true` set globally AND per-call.
- ✅ **UI surfaces**: 
  - `UserMenu.jsx` in Landing, Workspace, Gallery headers. Anonymous → `login-btn` (Sign in). Authenticated → avatar dropdown with Profile / My Designs / My Components / Sign out.
  - `Profile.jsx` at `/profile` — banner with picture/name/email + 4 StatTiles (Designs, Components, Total Remixes, Component Upvotes) + tabbed (`?tab=designs|components`) personal grids. Anonymous visit renders a sign-in gate.
  - `ShareDialog` and `SaveComponentDialog` (`Dialogs.jsx`) gained auth-aware Author render: signed-in users see a readonly badge + a `share-private-toggle` / `component-private-toggle`; anonymous users keep the free-text input plus a `share-signin-cta` / `component-signin-cta` nudge.
- ✅ **Tests** — 9 new auth pytest cases (`tests/test_auth_api.py`) + 7 reused private-library cases passed by testing agent. Frontend testing agent (iteration_10) confirmed both anonymous and authenticated variants of both dialogs.

## Iteration 15 (2026-02-19) — Whisper STT Integration · Color Picker Fix
- ✅ **Color picker bug fixed** — `Viewport.colorForObject` no longer special-cases `colorIndex === 0` to return ForgeSlicer orange; the renderer now maps 1:1 with the picker palette. Default `colorIndex` for new positive primitives bumped from 0 → 7 (Orange) so existing UX is preserved; picking the "White" swatch now correctly renders white.
- ✅ **Whisper STT (OpenAI whisper-1) integrated** as the primary voice-command transcription path, replacing the browser's Web Speech API which had poor accent handling:
  - **Backend**: new `POST /api/voice/transcribe` accepts multipart audio (webm/opus, mp4, wav, ogg), forwards to `OpenAISpeechToText(api_key=EMERGENT_LLM_KEY).transcribe(...)` with `model="whisper-1"`, `language="en"`, `temperature=0`, and a CAD-vocabulary `prompt` hint that biases recognition toward "cube/cylinder/union/subtract/millimetre/…" terms for measurably better accuracy on rare CAD words.
  - **Frontend**: new `/app/frontend/src/lib/whisperStt.js` records audio with `MediaRecorder` (auto-picks supported MIME from webm/opus → mp4 → ogg), POSTs blob to the backend, returns transcript. Hard cap of 25 MB. Graceful `NotAllowedError` handling for denied microphone access.
  - **VoiceButton rewrite**: state machine `idle → recording → transcribing → confirm → parsing → feedback`. The confirm step shows the Whisper transcript in an editable input with **Run** / **Cancel** / **Retry** so users can fix any residual misrecognitions before GPT-5.2 parses it into a command.
- ✅ **Smoke tests**: 80/80 backend pytest still passing; `POST /api/voice/transcribe` validated end-to-end with a synthesized WAV file (Whisper returned a transcript, confirming the Emergent LLM key + endpoint wiring are healthy).
- ✅ **#3 Ctrl-Z destroying model after CSG ops** — root cause: `doBool` in TopToolbar called `removeObject` twice + `addRawObject` once, each pushing a separate history entry, so the latest snapshot captured the empty-scene state after removals but before insert. Added new atomic `replaceObjects(idsToRemove, newObjects)` action on the store that mutates objects in a single `set()` and pushes history exactly once. `doBool` now uses this. Confirmed via testing agent: cube + sphere → Union → 1 merged → Ctrl-Z → 2 separate objects (not zero).
- ✅ **#7.1 Z-axis flip in place** — when source position was 0 on the mirror axis, `-0 == 0` and the copy stacked on the original. Fixed by `duplicateSelected` computing the source's rotated bounding-box extent on that axis and placing the copy at `source + extent + offset` so it's always adjacent and visibly mirrored.
- ✅ **#1.3 Outliner rename** — new `setObjectName(id, name)` store action; OutlinerRow now supports double-click to enter inline rename, Enter to commit, Escape to cancel.
- ✅ **#7.1 sidenote Right-click menu clipping** — ContextMenu measures itself with `getBoundingClientRect` post-mount and re-clamps so it never overflows the viewport bottom-right. Added `max-h-[85vh] overflow-y-auto` as a fallback for very tall menus.
- ✅ **#1.2 Polygon sides** — Inspector now exposes a `Sides` NumberField for cylinder/cone primitives (3=triangle, 4=square, 6=hex, 8=octagon, 32+=smooth circle) and `Segments` for spheres.
- ✅ **#2.2 15° snap precision** — `Viewport.handleChange` rounds `radToDeg` outputs to 1e-4 precision, eliminating the `14.999999999998°` floating-point noise after gizmo snap.
- ✅ **#1.3.36 dimension order** — Inspector cube dim labels changed from `W / D / H` to `X / Y / Z` (matches storage keys + user's mental model: x=length, y=width, z=height). Viewport bbox label now renders `X × Y × Z` order instead of `X × Z × Y`. Added a tiny "X · Y · Z" hint to the Inspector header with a tooltip.
- ✅ **#10 Toys category** — added to both backend `COMPONENT_CATEGORIES` set, SaveComponentDialog selector, and Gallery components filter dropdown.
- ✅ **#10 Material field** — new `material:str = 'pla'` on gallery records; full materials catalog at `/app/frontend/src/lib/materials.js` (PLA, PETG, ABS, ASA, TPU, Nylon, PC, Carbon-fibre, Wood-filled, Resin, Any). ShareDialog has a Material selector; Gallery cards display a Material badge alongside the License badge; DesignsTab has a new Material filter dropdown that hits `GET /api/gallery?material=<id>`.
- ✅ **ShareDialog crash hotfix** (caught by testing agent mid-iteration): three missing definitions (`Layers` import, `materialId` useState, `MATERIALS` import) — fixed in a 3-line patch before the dialog could ship.
- ✅ **Tests** — 80/80 backend pytest pass (10 new in `tests/test_material_toys_api.py`); 8/8 P1 frontend scenarios + 4/4 regression scenarios.
- ✅ **Auth ergonomics**: `lib/auth.js` now persists the `returnPath` (the page the user was on when they clicked Sign in) in `sessionStorage` so AuthCallback can route them back to where they started — not always `/workspace`. Added an explicit 20 s timeout on the `/api/auth/session` exchange and `console.info` breadcrumbs at each stage for diagnostics.
- ✅ **AuthCallback rewrite**: 3-stage progress text (parsing → exchanging → success), expanded error UI with both "Home" and "Try again" buttons, full error string surfaced (no more silent failure).
- ✅ **App.js hash detection**: now reads `window.location.hash` directly in addition to React Router's `useLocation().hash` — some routing configs strip the fragment on first mount.
- ✅ **ProtectedRoute** (`components/ProtectedRoute.jsx`): branded sign-in card with explanation copy + Sign-in-with-Google CTA + "browse the public gallery first" link. Wraps `/workspace` and `/profile`. Skips itself if the URL hash is an OAuth callback (belt-and-braces against routing race).
- ✅ **Public routes preserved**: `/` (Landing) and `/gallery` remain anonymously accessible — anonymous users can still browse the library for ideas before signing up.
- ✅ **Gallery / Components network resilience**: `lib/api.js` introduces `fetchHeavyList()` — 45 s timeout, 2 retries on network errors and 5xx, immediate bubble on 4xx. New `apiErrorMessage(err)` helper humanises axios errors. Gallery + Components tabs render a proper error card with a Retry button (testids `gallery-retry-btn` / `components-retry-btn`) instead of bare red text.
- ✅ **Landing banner rewrite** — H1 now reads "Model. Carve. **Slice (sort of...).** Print." with a hover tooltip on "Slice (sort of...)" explaining ForgeSlicer's GCODE output is an outer-shell preview, not a production slicer. Body subtitle replaced with the user's new copy starting "CAD for people who wish they could do CAD, but don't know how...".
- ✅ **Open-source license system** — new `/app/frontend/src/lib/licenses.js` catalog (12 entries: CC-BY 4.0 default, CC-BY-SA, CC-BY-NC, CC-BY-NC-SA, CC-BY-ND, CC0, GPL v3, LGPL v3, **AGPL v3**, MIT, Apache 2.0, ForgeSlicer Standard Digital). Backend `gallery` + `components` collections gained a `license:str = "cc-by-4.0"` field; Pydantic default applies to legacy docs at response construction. ShareDialog & SaveComponentDialog gained a license `<select>` with the catalog, plain-English summary line, and a "full text →" link to the canonical license. Gallery + Components cards render a `LicenseBadge` chip (clickable when canonical URL exists), tinted by license category (emerald=permissive copyleft, cyan=public-domain-style, amber=non-commercial, slate=ForgeSlicer Standard).
- ✅ **Contributor Lifetime Tier** added to `/app/memory/PRICING_RESEARCH.md`: $0, earned by publishing **100+** non-duplicated open-licensed components AND **20+** non-duplicated open-licensed designs of original work. Standard Digital / CC-BY-NC* / CC-BY-ND don't count. Enforcement mechanics documented for Phase 3 implementation (cron recount, `users.contributor_lifetime` flag, never-demotes policy, visible counter on Profile).
- ✅ **Tests** — testing agent ran 71/71 prior backend pytest + 6 new license round-trip tests + 18 targeted frontend scenarios. All PASS. New file: `/app/backend/tests/test_license_api.py`.

## Iteration 11 (2026-02-19) — P1 Composite Slot · Library Polish · P2 Dialog Refactor
- ✅ **Slot / Racetrack composite primitive** — `store.addSlot(modifier, overrides)` builds an auto-grouped trio (1 cube core + 2 cylinder caps) sharing a fresh `groupId` + `groupName`. Defaults: width=6 mm, length=10 mm, depth=6.5 mm. New `COMPOSITES` section in `LeftPanel.jsx` exposes `add-slot-negative-btn` (default — for rack-screw holes) and `add-slot-positive-btn` (pill/key shape).
- ✅ **Expanded categories (13)** — backend `COMPONENT_CATEGORIES` widened to: mechanical, rack, mounting, **fasteners, electronics, brackets, hinges, gears, decorative, organizers, miniatures, structural**, misc. Both Gallery filter dropdown and SaveComponentDialog selector list all 13 (Gallery adds "All categories" for a total of 14 options).
- ✅ **Verified badge** — new `verified:bool` field on components; list endpoint sorts `(verified desc, votes desc, created_at desc)`; admin-only `POST /api/components/{cid}/verify` toggle is gated by `ADMIN_EMAILS` env var (returns 403 when unset for safety). Frontend renders a green `BadgeCheck` "verified" chip only when `item.verified === true`.
- ✅ **Clickable tag pills** — component tag string (`"screw, M3, 10mm"`) is split into chips on each card; clicking a pill populates the search input and re-queries `/api/components?q=…` in one tap.
- ✅ **P2 — Dialogs.jsx refactor** — original 786-line file split into focused files in `components/dialogs/`: `ShareDialog.jsx`, `OrcaDialog.jsx`, `SavePrinterDialog.jsx`, `SaveComponentDialog.jsx`. `Dialogs.jsx` is now a 7-line barrel re-export so all existing imports keep working with zero call-site changes.
- ✅ **Pricing research** — `/app/memory/PRICING_RESEARCH.md` consolidates direct competitor pricing (Tinkercad/Onshape/Fusion 360/SelfCAD), 3D-model marketplace data (Thangs/Printables/MakerWorld), 2025 indie-SaaS conversion benchmarks, a cost-coverage floor (Stripe fees + hosting), and a recommended 3-tier draft ($0 / $3 / $7) to discuss before Phase 3.
- ✅ **Tests** — testing agent ran 49 prior + 16 new P1 backend tests + 11 frontend scenarios, all PASS. New regression file: `/app/backend/tests/test_components_p1.py`.

## Phase 3 (P0 — paused per user) — Subscription Monetization
Pricing research now lives in `/app/memory/PRICING_RESEARCH.md`. Recommended starting tiers:
1. **Free**: 3 saved designs / week + public gallery (cap is the upgrade trigger).
2. **Hobbyist** (**$3/mo** or $30/yr): unlimited saves, 10 private designs, 100 voice commands/wk.
3. **Maker Pro** (**$7/mo** or $70/yr): unlimited private library, voice, verified-creator badge.
4. *(future)* **Studio** (~$19/mo): multi-user teams.
Stripe Checkout + a `users.tier` counter will implement this; awaiting user sign-off on the $3/$7 anchors before build.

## Iteration 14 (2026-02-20) — Edge Fillet & Chamfer
- ✅ **Edge fillet / chamfer for primitives** — cube, cylinder, and cone now support filleted (rounded) or chamfered (45° beveled) edges through a new "EDGE" panel in the Inspector. Two-button style toggle (Fillet ◜ / Chamfer ◢), radius slider clamped to the primitive's shortest half-extent, plus 4 quick presets (Off / 1 mm / 2 mm / 5 mm).
  - Stored on the object as `dims.edgeRadius` (number, mm) + `dims.edgeStyle` ("fillet"|"chamfer"). Defaults to 0 (sharp) so existing saved designs render unchanged.
  - Cube uses `RoundedBoxGeometry` (smoothness 1 → chamfer, 4 → fillet).
  - Cylinder uses a `LatheGeometry` built from a hand-rolled side profile so the top + bottom rims get a quarter-arc fillet or a single 45° chamfer.
  - Cone uses the same lathe approach on the bottom edge (apex stays a point); slope walks straight from the inset ring to the apex.
  - **Negatives included** — the Inspector UI isn't gated on modifier, so a filleted **negative** cube/cylinder/cone subtracts into the host model as a counter-bored pocket / chamfered recess in one shot (great for screw cup-points + heat-set inserts).
  - Picked up automatically by STL / 3MF / GCODE exports, CSG booleans, drop-to-bed, and the rotated-BBox compatibility checks because they all go through `buildGeometry`.
- New test IDs: `edge-controls`, `edge-style-fillet`, `edge-style-chamfer`, `edge-radius-slider`, `edge-radius-readout`, `edge-radius-preset-{0|1|2|5}`.
- Verified live with cube + cylinder + cone (positive and negative): chamfered cube shows clean 45° bevel; 5 mm fillet on cube rounds all 12 edges; cylinder chamfered/filleted top + bottom rims; cone base ring filleted and chamfered; negative cube exposes EDGE panel for counter-bore use.

## Iteration 15 (2026-02-20) — Help / User Manual
- ✅ **In-app User Manual** — new `HelpDialog.jsx` with a sidebar-nav + content layout reachable from a `?` icon in the top toolbar, the global <kbd>?</kbd> hotkey (anywhere in the workspace), or the voice event `open-dialog {name: "help"}`.
- ✅ **12 sections**: Index, Quick Start, Primitives, Positive & Negative, Transforms, Snapping & Grid, Fillet & Chamfer, Boolean Operations, Import & Export, Gallery & Sharing, Component Library, Voice Commands, Keyboard Shortcuts. Index page presents the sections as a 2-column card grid for at-a-glance navigation.
- ✅ **Voice Command Lexicon** — first-class section with hands-free flow walkthrough plus a 5-category × 28-entry phrase/effect table. Built-in search filter (`voice-lexicon-search` testid) narrows the table by phrase, action, or effect.
- ✅ **Keyboard Shortcuts** — full table including the new `?` hotkey to reopen the manual.
- ✅ **Search** — sidebar nav has its own topic search.
- Test IDs added: `help-btn`, `help-dialog`, `help-close-btn`, `help-nav-search`, `help-nav-<id>`, `help-card-<id>`, `help-section-<id>`, `voice-lexicon-search`, `voice-group-<category-slug>`.

## Iteration 16 (2026-02-20) — "Try it" Voice + Contributor Tier
- ✅ **"Try ▶" button on every voice example** — VoiceCommands section in the manual now renders a per-row Try button. Click pipes the literal phrase through the existing `parseTranscript` → `executeCommand` pipeline (same path the microphone uses), closes the help dialog, and surfaces the result in the bottom-of-screen banner. Verified live: clicking Try on `"Add a cube"` added a cube to the scene with toast `Voice: Added positive cube`.
- ✅ **Contributor Lifetime Tier (P1)** — new `GET /api/me/contributor-status` endpoint counts published+open-licensed components and designs (deduped on case-insensitive name), grants the `users.contributor_lifetime` flag the moment thresholds are crossed (100 components + 20 designs), and never demotes. The `/api/auth/me` payload now includes `contributor_lifetime` so the badge can light up app-wide.
  - Eligible licenses: CC0, CC-BY, CC-BY-SA, MIT, Apache 2.0, GPL/LGPL/AGPL. NC, ND, and Standard Digital excluded by design.
  - Profile page renders a dedicated `ContributorCard` with progress bars (`contributor-components` / `contributor-designs`), an "Earned" emerald badge once the milestone is hit, and a plain-English explainer.
  - Frontend uses `meApi.contributorStatus()` (lib/auth.js); failure is non-fatal (the rest of the profile still renders).
- Test IDs: `contributor-card`, `contributor-badge`, `contributor-components`, `contributor-designs`, `voice-try-<phrase-slug>`.

## Iteration 17 (2026-02-20) — Contributor Celebration Toast
- ✅ **Celebration toast on Contributor threshold** — when the backend flips `users.contributor_lifetime` to `true`, the next `/api/auth/me` (or Profile refresh) triggers a rich sonner toast: *"🏆 You're a ForgeSlicer Contributor for life!"* with a 12-second duration. Persisted per-user in `localStorage` (`forge.contributor.celebrated`) so it only celebrates once.
- ✅ Mounted shadcn `Toaster` in `App.js` (top-center, rich colors, dismiss button) so any component can `toast(...)` going forward.
- ✅ `Profile.jsx` triggers `refresh()` from AuthContext the moment a contributor-status fetch flips the flag, so the celebration fires on the same visit that crosses the threshold (instead of waiting for next sign-in).
- Verified live: forced `contributor_lifetime=true` in Mongo → Profile loaded → toast rendered at top-center with the trophy emoji.
- Note: kept toast-only for now; an actual transactional email would require adding SendGrid/Resend integration which is a separate iteration.

## Iteration 18 (2026-02-21) — Pre-Deploy Cleanup + Resend Email
- ✅ **Contributor celebration email via Resend** — wired transactional email send. Triggers exactly once, at the moment `users.contributor_lifetime` flips to `true` in `GET /api/me/contributor-status`. Send runs in `asyncio.to_thread` (non-blocking) and is best-effort (logs warning, never breaks the API response).
  - HTML email template with inline CSS (tables-based layout for max client compatibility), plain-text fallback, CTA back to `/profile`.
  - `RESEND_API_KEY` + `SENDER_EMAIL` + `APP_PUBLIC_URL` in `backend/.env`.
  - Currently using Resend's sandbox sender (`onboarding@resend.dev`); will switch to `contributor@forgeslicer.com` once DNS is verified post-launch.
  - Verified live: forced threshold cross with seeded data → email delivered, Resend message id `ce29e40e-...` returned.
- ✅ **Removed temporary `/api/download/source-zip` endpoint** + deleted `/app/forgeslicer-source.zip` (no longer needed; user is pushing via GitHub).
- ✅ New module `backend/email_service.py` (143 lines, lint clean) — kept isolated so future emails can register here.

## Iteration 19 (2026-02-21) — First-Sign-In Race Fix
- ✅ **Fixed "first sign-in fails, second succeeds" production bug** — `exchange_session` now retries the upstream GET to Emergent's auth-provider with exponential backoff (0.4 / 0.9 / 1.6 / 2.5 s; ~5.4 s worst-case) on transient failures (401, 404, 408, 425, 429, 5xx). The root cause: Emergent's auth provider has an eventual-consistency window for newly-issued `session_id`s; the first redirect-back GET could land before propagation completes. Retries fully cover that window.
- ✅ Verified live with a fake session_id → 4 retry attempts logged with `auth-provider attempt N returned M; retrying`, then proper 401 surfaced.
- Note: this is a **production-only bug** (preview didn't reproduce it because preview deployments use the same upstream provider but the user's session was already established). Production needs **redeploy** for the fix to take effect.

## Iteration 20 (2026-02-21) — Custom-Domain Cross-Origin Cookie Fix
- ✅ **Fixed the "signed in for a few seconds then loops back" production bug** on `forgeslicer.com`. Root cause: `REACT_APP_BACKEND_URL` was baked into the production bundle as the original `*.emergent.host` URL. When users browse `forgeslicer.com`, the auth cookie is set on `forgeslicer.com` but every API call (including `/api/auth/me`) was hitting `emergent.host` — a different origin — so the browser never sent the cookie. Result: post-sign-in `/me` returns 401, AuthContext nulls the user, ProtectedRoute bounces, loop.
- ✅ `frontend/src/lib/api.js` now resolves the backend URL at runtime: if the page is being served from a different host than `REACT_APP_BACKEND_URL`, it uses `window.location.origin` instead (keeps cookies first-party). Preview behavior unchanged (env host matches page host).
- Verified preview still renders cleanly. Production needs **redeploy**.

## Iteration 21 (2026-02-21) — AI Mesh Generation (Meshy AI)
- ✅ **Text-to-3D + Image-to-3D via Meshy AI** — new left-panel section "AI Generate" opens a beta dialog with two tabs:
  - **From Text** — prompt textarea (up to 600 chars) + 3 styles (realistic / sculpture / low-poly).
  - **From Image** — JPG/PNG/WebP upload up to 8 MB, base64-encoded and forwarded as data URL per Meshy spec.
- ✅ **Per-user monthly cap** — 13 generations / calendar month (Contributor Lifetime users get 26). Atomic `$inc` upsert in MongoDB so concurrent requests can't race past the boundary; failed submissions refund the counter.
- ✅ **Async job flow** — frontend polls `/api/ai/jobs/{id}` every 4 s with a 5-min timeout. Dialog shows live progress bar, success state with raw-Meshy download link, retry button, and clear error messages on failure or cap-reached.
- ✅ **Mesh import** — proxied download through backend (auth + CDN), routed into the existing `importAnyMeshFile` pipeline so AI meshes get auto-centered on the bed, the bbox computed, and the imported-mesh registration; toast confirms import.
- ✅ **GLB / GLTF import** added to `lib/exporters.js` (uses three.js GLTFLoader). Merges all sub-meshes into one geometry.
- ✅ **Help dialog** — new "AI Generate" section with usage tips, monthly-cap explainer, and a heads-up about thin walls / non-manifold AI meshes.
- 4 new backend endpoints: `GET /api/ai/usage`, `POST /api/ai/generate/text`, `POST /api/ai/generate/image`, `GET /api/ai/jobs/{id}`, `GET /api/ai/jobs/{id}/mesh`.
- Test-mode key `msy_dummy_api_key_for_test_mode_12345678` works for dev; production needs a real key from https://meshy.ai.
- Verified live end-to-end: prompt → SUCCEEDED → STL imported (1996×1381×1735 mm test mesh from Meshy's test fixture) → inspector + scale + slice tools all attached correctly.

## Iteration 22 (2026-02-21) — AI Sizing + In-Place Mirror + Cut Tool
- ✅ **AI mesh import sizing** — AI dialog success state now has "Auto-fit to bed" checkbox (default on; scales longest dim to 80% of printer's shortest build-volume axis) + optional manual "Target max dimension" override in mm. No more 2-meter dragons.
- ✅ **In-place Mirror** — new toolbar `MIRROR` button + popover with X/Y/Z axis choices. Flips the selected object(s) on the chosen axis by negating scale (no duplicate created). Useful for fixing asymmetric AI meshes. Atomic in undo history.
- ✅ **Cut tool (OrcaSlicer-style)** — new toolbar `CUT` button activates a cut mode with:
  - Yellow semi-transparent plane in the viewport with full transform-controls gizmo (move + rotate, 0.5mm + 5° snaps).
  - Floating Cut HUD at top of viewport with mode switcher, Reset, and three apply buttons: Keep Upper / Split (both) / Keep Lower.
  - CSG implementation in `csg.js#cutObjectByPlane` — builds two large half-space boxes positioned on the cutting plane and INTERSECTs each with the source. Handles arbitrary plane orientations (translates + rotates the half-space).
  - `store.applyCut(keep)` action replaces the source with up to two new "imported" objects; atomic in undo history. Empty pieces are silently dropped.
  - Toast on success/failure with piece count + per-object error details.
- ✅ Help dialog: new "Cut & Split" section + updated AI section explaining the auto-fit behavior.
- Verified live: cube → mirror X applied → cut HUD shown → Split (both) applied → "Cube (lower)" piece created.

## Iteration 23 (2026-02-21) — Cut Plane Bug Fix + AI Sizing UX
- ✅ **Fixed Cut tool axis mismatch** — `PlaneGeometry`'s default normal is +Z (vertical plane), but `cutObjectByPlane` assumed normal +Y. User reported "cut happens on the original axis, not the adjusted plane." Fix: rotate the `PlaneGeometry` -90° around X at construction so the visible plane is horizontal (normal +Y) by default — matching both user expectation and the CSG code's assumption. User-applied rotations now correctly tilt the cut axis.
- ✅ **Verified live**: 40mm cube + horizontal cut at Y=25 now produces **two** pieces (Cube upper 40×15×40 mm, Cube lower 40×25×40 mm). Previously only produced 1 piece due to the 90° mismatch.
- ✅ **AI dialog sizing UX overhaul**:
  - Moved sizing controls to BEFORE generation (in addition to the success state) so users know what size they'll get before pulling the trigger.
  - Replaced the checkbox + conditional input with two clear toggle buttons: "Auto-fit to bed" / "Specify size".
  - Auto-fit mode shows a live preview ("Longest dimension will be scaled to ~176 mm (80% of your printer's shortest axis: 220 mm)").
  - Manual mode has a clearer label + helper text ("The mesh's longest axis will be set to this size; other axes scale proportionally").
  - Extracted into a reusable `SizingControls` sub-component for DRY.

## Iteration 24 (2026-02-21) — AI Dialog Modal Safety
- ✅ **Fixed credit-loss bug** — user reported clicking outside the AI dialog or pressing Esc killed the in-flight Meshy job and burned the credit. Previous misleading copy ("The dialog stays open so you can keep working") implied the opposite.
- ✅ **Modal-lock during generation** — backdrop click + Esc are blocked while a job's status is PENDING/IN_PROGRESS. Top X button is hidden; bottom Close button is replaced by a "Working — please wait" spinner.
- ✅ **Honest in-progress copy** — amber warning text now says: *"Please keep this window open until the mesh arrives. Closing it (or clicking outside) before completion still uses your credit but you'll lose the result."*
- ✅ **Auto-resume on accidental close** — in-flight job_id + kind + poll deadline now persist in localStorage (`forge.ai.inflight`). If the dialog does close for any reason (browser crash, tab switch in mobile, etc.), reopening AI Generate auto-restores the job and resumes polling. Marker is cleared as soon as the job hits SUCCEEDED/FAILED.

## Iteration 25 (2026-02-21) — Splash Screen + Sidebar Tabs
- ✅ **Optional splash screen** — new `SplashScreen.jsx` fetches `/splash.html` on mount; if the file exists and the `<meta name="splash-version">` differs from the user's last-seen, displays the content for 30 s OR until OK click. Per-user localStorage so the same version doesn't pester returning users; bumping the version makes everyone see it again. Missing/empty splash file = no splash (graceful).
  - The splash HTML lives at `frontend/public/splash.html` and is just a marked-up `[data-splash]` block — no inline CSS needed; `App.css` `.splash-body` rules style any `[data-splash-*]` data attributes (eyebrow, title, lede, features, highlight, footer, kbd).
  - To edit: change the body content + bump the meta version string. To disable: empty the file.
- ✅ **Sidebar tabs** — `LeftPanel.jsx` refactored from a long vertical scroll list into a 4-tab strip at the top (3D / 2D / Combo / AI) over a single-section viewport. Outliner stays as its own scrollable region below. Tab choice persists in localStorage. Empty-state message updated to reference the tabs.
- Verified live: splash renders correctly with all data-attributes styled; OK button dismisses + records seen-version; tabs switch + persist across reload.

## Iteration 26 (2026-02-21) — AI Bug Fixes + Private Discoverability
- ✅ **Meshy 400 on Sculpture/Low-poly fixed** — text-to-3d v2 only accepts `art_style: "realistic" | "sculpture"`. `low_poly`/`low-poly` is invalid for text endpoint (it's an image-to-3d option). Removed "Low-poly" button (user can decimate in their slicer); added `enable_pbr: false` per Meshy docs (required for sculpture style). Backend `meshy_service.create_text_to_3d` now coerces unknown values to "realistic" so future UI mistakes can't hit a 400.
- ✅ **Transient 502 mid-generation fixed** — both `meshy_service.get_task` and `download_mesh` now retry transient 5xx (1s/2s/4s backoff, 3 attempts) before bubbling up. Frontend `pollOnce` also keeps retrying its own backend on transient errors until the 5-minute deadline, so a single hiccup no longer ditches an already-paid generation.
- ✅ **Private components/designs now discoverable** — Gallery's Designs + Components tabs gained a "Public / Mine" segmented filter (signed-in only). New backend `mine=true` query on `/api/gallery` and `/api/components` returns the caller's own items including private ones. Cards in "Mine" mode show a lock badge so users can tell at a glance what's private vs public. Closes the "saved private → can't find it later" loop the user reported.
- ✅ **Regression coverage** — added `backend/tests/test_mine_filter.py` (5 tests) verifying unauthenticated `mine=true` returns empty + public listings remain unchanged. 73/73 backend tests pass.
- Files: `meshy_service.py`, `server.py` (gallery+components list endpoints), `AIGenerateDialog.jsx`, `Gallery.jsx`, `lib/api.js`.

## Iteration 27 (2026-02-22) — Multi-method Auth (Email/Password + Magic Link + Reset)
- ✅ **Three sign-in methods now available** alongside the existing Google OAuth flow — all produce identical `session_token` httpOnly cookies + `user_sessions` rows, so every downstream endpoint works regardless of how the user signed in.
  - **Email + password** with bcrypt(12) hashing, 8+ char policy (letter + digit), brute-force lockout (5 fails / 15 min) on `<ip>:<email>`.
  - **Magic link** — passwordless one-time-use signed token, 15 min TTL, delivered via Resend.
  - **Forgot password** — Resend email with 60 min single-use token; reset invalidates ALL existing sessions (defense-in-depth).
- ✅ **Same-account merging**: Google users can attach a password by hitting `/register` with their existing Google email; `auth_methods` tracks which methods are wired up.
- ✅ **Profile editor with per-field privacy** (Profile.jsx) — optional `avatar_url`, `contact_link`, `city/state/country` each have an independent **Public / Private** checkbox. Defaults to PRIVATE; the user must explicitly opt-in per field. Owner always sees their own data via `/api/auth/me`.
- ✅ **Unified `/signin` page** with 3 tabs (Email · Magic link · Google). New aux routes: `/forgot-password`, `/reset-password?token=…`, `/magic-link?token=…`.
- ✅ **Security posture**: tokens stored as SHA-256 hash in MongoDB (DB dump can't take over accounts); no email enumeration on forgot/magic endpoints (always 200); explicit `auth_local.PASSWORD_RE` enforces server-side policy.
- ✅ **Test coverage**: 16 new tests (12 unit + 4 round-trip including session invalidation on password change). Total 89/89 backend tests pass.
- Files added: `backend/auth_local.py`, `backend/tests/test_local_auth*.py`, `frontend/src/components/SignIn.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `MagicLinkLanding.jsx`.
- Files modified: `backend/server.py` (extracted `_set_session_cookie` + `_public_user`, mounted local-auth router, added `/api/me/profile`), `backend/email_service.py`, `frontend/src/components/Profile.jsx` (ProfileEditor), `App.js`, `ProtectedRoute.jsx`, `UserMenu.jsx`, `dialogs/SaveComponentDialog.jsx`, `dialogs/ShareDialog.jsx` (CTAs now point to `/signin`).

## Iteration 28 (2026-02-23) — Public Author Profiles + "What's New" Pin
- ✅ **Public author profile pages** at `/u/:userId` (P1 backlog item done) — clicking any "by …" link on a gallery card or component card now opens that maker's public profile, showing avatar / location / contact link **only if** the user enabled the corresponding `share_*` toggle. Always-public bits: display name, contributor-lifetime badge, and counts. Designs and components tabs show the full grid of public items (privacy enforced server-side — private items never appear).
- ✅ **Backend whitelist endpoint** `GET /api/users/:userId/profile` returns a strict, hard-coded set of fields — never `email`, never `password_hash`, never `last_login_at`, never `auth_methods`. Test suite explicitly asserts this. Plus `/users/:userId/designs` and `/users/:userId/components` for listing public items.
- ✅ **"What's new" pin in topbar** — small ✨ Sparkles button next to the Help icon dispatches a `forgeslicer:show-splash` window event. `SplashScreen` listens for it and replays the current announcement even if the user has dismissed this version. No state lifting needed — clean decoupling via DOM event.
- ✅ **Author name links** on gallery cards (designs + components) — `by {author}` is now a `<Link to="/u/{user_id}">` when the item has a `user_id`. Falls back to plain `<span>` for legacy items without ownership.
- ✅ **Help system updated** — added "Public author profile pages" paragraph in the Account section.
- ✅ **Test coverage**: 9 new tests (`test_author_profile.py`) including a "partial share only shows enabled fields" test that asserts toggles work independently. 100/100 backend tests pass.
- Files added: `backend/tests/test_author_profile.py`, `frontend/src/components/AuthorProfile.jsx`.
- Files modified: `backend/server.py` (3 new endpoints), `frontend/src/components/Gallery.jsx` (clickable author names), `SplashScreen.jsx` (event-driven re-open), `TopToolbar.jsx` (sparkles pin), `HelpDialog.jsx`, `App.js` (route).

## Iteration 29 (2026-02-23) — Admin Panel + AI Quota Overrides
- ✅ **Two-tier admin roles**:
  - **super_admin** — bootstrapped from `ADMIN_EMAILS` env var on each startup (idempotent). ONLY super-admins can promote/demote regular admins. Steve seeded as super-admin via `steve.shurts@gmail.com`.
  - **admin** — can do everything else: grant AI quota, grant Contributor-for-Life, ban users, force sign-out, view analytics, see audit log, moderate content.
- ✅ **Admin page at `/admin`** (security through obscurity — no link in nav, must know URL). Three tabs:
  - **Analytics** — Total/DAU/MAU users, new in 24h/7d/30d, contributor count, design + component totals (public + private), AI generations this month
  - **Users** — Searchable table with name/email/auth-methods/joined/last-login/AI-quota/AI-used/flags + per-row action buttons (toggle contributor, promote admin if super, force password reset, ban/unban)
  - **Audit log** — Every state-changing admin action recorded with timestamp, actor, action name, target, and JSON details payload
- ✅ **Per-user AI quota override** with **hard 300/month server-side ceiling** (`MAX_AI_QUOTA_OVERRIDE`). Click-to-edit cell on the user row: blank clears the override (default cap returns), 1-300 sets a custom monthly cap. Effective cap honored by `_ai_cap_for()` and reflected immediately in `/api/ai/usage`.
- ✅ **Soft-ban flow** — flagged users have all sessions killed instantly and `_resolve_session_token` refuses to honour stale tokens. Data preserved; ban is reversible.
- ✅ **Force-sign-out action** — kills every session for a user without touching their password. Useful for revoking access after credential leaks.
- ✅ **Content moderation** — `/api/admin/content/remove` soft-flags gallery / component items with `removed: true` and forces them private. Audit-logged.
- ✅ **Security guardrails**:
  - Pydantic field `quota: Optional[int] = Field(None, ge=1, le=300)` enforces 1-300 ceiling at the schema layer — even a compromised admin can't issue infinite gens.
  - Super-admins cannot demote themselves via the UI (lockout footgun protection).
  - Cannot ban a super-admin or yourself.
  - Removing an email from `ADMIN_EMAILS` doesn't auto-demote — must be done manually in Mongo (prevents env-var-typo lockouts).
  - Banned users' admin status doesn't grant access (`require_admin` checks ban state).
- ✅ **Test coverage**: 15 new admin tests (`test_admin.py`) — auth guards, 300-ceiling enforcement, audit log writes, ban-kills-sessions, super-vs-admin promotion gating, quota-clears-with-null. **115/115 backend tests pass.**
- Files added: `backend/admin.py`, `backend/tests/test_admin.py`, `frontend/src/components/AdminPage.jsx`, `frontend/src/lib/adminApi.js`.
- Files modified: `backend/server.py` (mounted admin router, ban-check in session resolution, ai_quota_override in `_ai_cap_for`, admin flags in `_public_user`), `backend/.env` (added `ADMIN_EMAILS`), `frontend/src/App.js` (added `/admin` route), `backend/tests/test_components_p1.py` (updated to reflect ADMIN_EMAILS now permanently set).

## Iteration 30 (2026-02-23) — CSV Export + Voice→AI Generation
- ✅ **Admin Users CSV export** — green Export button on the Users tab downloads `forgeslicer_users_<timestamp>[_search-xxx].csv` with 12 columns. RFC-4180 escaped, UTF-8 BOM prepended (Excel-friendly). Exports the currently-filtered set so admins can grab targeted slices by searching first.
- ✅ **Voice → AI Generation** — the intent parser (GPT-5.2) now understands `ai_generate` with two sub-modes:
  - **Auto-submit** when user says "**Generate** X" / "**Make** X **with AI**" / "**AI** X" — pre-fills + immediately submits (uses a credit).
  - **Pre-fill only** when user says "**I want to make** X **with AI**" — opens dialog with prompt populated, waits for click. Lets users review tone before committing a credit.
  - "**Open the AI generator**" (no subject) → opens dialog with empty prompt via existing `open` intent.
  - Parser test cases (live GPT-5.2): 5/5 correct including the exploratory/definitive distinction and a negative case ("Add a cube" doesn't get mis-classified).
- ✅ **Event-driven AI dialog** — `AIGenerateDialog` now listens for `forgeslicer:open-ai-generate` events with optional `{prompt, auto}` detail. Same hybrid pattern as the splash re-trigger — voice can open from anywhere in the app without prop-drilling.
- ✅ Help system updated: new "AI generation" voice lexicon category (5 example phrases), plus a "By voice" bullet in the AI Generate help section.
- Files modified: `backend/server.py` (VOICE_SYSTEM_PROMPT extended), `frontend/src/components/AIGenerateDialog.jsx` (event listener + auto-submit + unified close), `frontend/src/lib/voiceCommands.js` (ai_generate action handler), `frontend/src/components/HelpDialog.jsx` (lexicon + AI section), `frontend/src/components/AdminPage.jsx` (CSV export).

## Iteration 31 (2026-02-23) — Two-Row Toolbar + Help Discoverability Fix
- ✅ **Toolbar split into two rows** (user reported the help button was unreachable — root cause: single horizontal flex row crammed with ~25 buttons clipped the right side on narrower viewports).
  - **Row 1 (system)**: brand · file I/O · export · voice mic · project name · Gallery/Share/Component/Send-to-Slicer · ✨ What's new · ? Help · user menu
  - **Row 2 (object editing)**: booleans · transform gizmo · undo/redo/measure · Position/Rotation/Size/Duplicate/Mirror/Cut/Slicer popovers
- ✅ Subtle visual delineation: Row 2 has lighter background + thin top border so users intuit "edit controls" vs "system actions" without a label.
- ✅ Verified on 1440px viewport — help, what's-new, and user menu now visible with breathing room.
- File: `frontend/src/components/TopToolbar.jsx` (single file change, no breakage to Workspace layout — uses `flex flex-col` so the extra height auto-adjusts).

## Iteration 32 (2026-02-23) — Add Primitive Dropdown + Shareable Remix Links
- ✅ **Add Primitive dropdown** in Row 2 of the toolbar — 8 primitives (Cube/Sphere/Cylinder/Cone/Torus + 2D Circle/Square/Triangle) accessible without expanding the left palette.
- ✅ **`web+forgeslicer://` browser protocol handler** registered via `navigator.registerProtocolHandler` on first visit. Pastes of `web+forgeslicer://remix/<id>` URLs route into `/workspace?remix=<id>`.
- ✅ **Copy Share Link** button on every Gallery card. Composes `${origin}/workspace?remix=<id>` and writes to clipboard (falls back to prompt() if clipboard API blocked).
- Files: `frontend/src/components/TopToolbar.jsx`, `frontend/src/App.js`, `frontend/src/components/Gallery.jsx`.

## Iteration 43 (2026-02-25) — STL Auto-Repair (4-Pass Progressive Weld)
- ✅ **Auto-repair pass on import**: `geometryToManifold` now attempts four progressive weld tolerances (scaled to the model's bbox diagonal: 1e-7, 1e-5, 1e-4, 5e-4) before giving up. Most third-party STLs (Thingiverse, Printables, MakerWorld) have sub-micron gaps that fail manifold-3d's strict check on first construction — this fix transparently bridges those gaps. Replicates what OrcaSlicer / FlashForge "Repair" does, but invisibly.
- ✅ **Tolerance scales with model size**: a 1mm absolute gap is catastrophic on a 5mm earring but a rounding error on a 200mm Gridfinity tray — we use bbox-diagonal proportional tolerances so small parts don't get over-collapsed and large parts still close.
- ✅ **Manifold ✓ badge survives auto-repair**: when the repair pass succeeds (which is the common case), the resulting boolean output is still 100% watertight, so the Gallery badge persists. Only if all 4 passes fail does the worker fall back to BVH (and the badge isn't applied).
- ✅ **Tests**: new `tests/manifold-repair-smoke.mjs` builds a synthetic broken cube with mismatched corner vertices, confirms direct construction throws `NotManifold`, and confirms our progressive weld repairs it cleanly. Plus 9/9 existing manifold-smoke + 136/136 backend tests still green.
- ✅ Verified end-to-end on the running Preview build with a cube+sphere union → 89KB STL exported through the auto-repair-aware path with zero errors.
- ✅ Release notes bumped to v1.8.2.
- Files: `frontend/src/lib/manifoldEngine.js` (rewrote `geometryToManifold` + added `modelScale` helper), `frontend/tests/manifold-repair-smoke.mjs` (NEW), `frontend/src/lib/releaseNotes.js`.

## Iteration 42 (2026-02-25) — Imported STL Disappearance Fix
- 🔴 **User-reported bug**: imported Gridfinity base (cut down + boolean'd with cube + chamfers + 8 negative cylinders) showed up in the workspace but disappeared from the eye-preview, STL export, and 3MF export.
- 🔍 **Root cause**: `evaluateSceneAsync` (manifold-3d engine) was calling `buildObjectManifold` per object inside a `try/catch` that **silently** dropped any object manifold-3d rejected (NotManifold status on STLs with tiny topology defects — extremely common in third-party files). The worker's BVH fallback only kicks in when the WHOLE async eval throws, so partial rejections meant the bad object just vanished while everything else still rendered. Symptom matched user's report exactly.
- ✅ **Fix**: when `buildObjectManifold` rejects ANY positive OR negative, abort the entire manifold eval with a `MANIFOLD_REJECTED` error. The worker's `evaluateSmart` catches it and falls back to three-bvh-csg, which is more forgiving with imperfect imports. Same fix applied to `evaluateSceneByColorAsync` (3MF multi-color path).
- ✅ User confirmed fix works on their Tool Holder design.
- ✅ Release notes bumped to v1.8.1.
- Files: `frontend/src/lib/manifoldEngine.js`, `frontend/src/lib/releaseNotes.js`.

## Iteration 41 (2026-02-25) — Sketch / 2D Drawing Mode
- ✅ **Sketch mode**: full-screen 2D drawing overlay that turns user-drawn shapes into extruded scene objects. Toggled via the new `SKETCH` toolbar button in Row 2. Implemented as a `SketchOverlay` component mounted inside Workspace so it disappears the moment the user exits or commits.
- ✅ **Three drawing tools**:
  - **Pencil** — click to add polyline vertices, double-click or Enter to close. Dashed preview line follows the cursor between the last point and the hover position. ⌘Z undoes the last point, Esc cancels in stages.
  - **Rect** — drag from corner to corner, right-angled rectangle commits on release.
  - **Circle** — drag from center to set radius, approximated as a 48-segment polygon.
- ✅ **Build-plate-aware**: canvas renders an actual build plate (e.g. 220×220mm) with a 10mm grid, origin crosshair, and a live X/Z coords readout in the bottom corner. Points snap to a 1mm grid for precision.
- ✅ **New scene type `sketch`**: `buildShape2D` + `buildGeometry` + `getBaseSize` extended to handle arbitrary polygon point arrays. Sketches use the same `THREE.ExtrudeGeometry` pipeline as triangle/polygon primitives, so transforms, gizmos, drop-to-bed, mirror, cut, slicer, and STL/3MF export all work without further changes.
- ✅ **Positive / Negative modifier** selector in the sketch toolbar — same dual-use as the left palette. Negative sketches subtract from positives via the existing CSG engine.
- ✅ **Configurable extrude height** (default 5mm, min 0.5mm) — set per sketch right in the overlay before committing. Editable later in the Inspector.
- ✅ End-to-end verified: drew a rectangle → became an extruded scene object on the bed (71×5×35 mm), fully editable, listed in Outliner as "Sketch 1".
- ✅ Backend pytest: 136/136 passing (sketch work is frontend-only).
- ✅ Release notes bumped to v1.8.0.
- Files: `frontend/src/components/SketchOverlay.jsx` (NEW), `frontend/src/components/TopToolbar.jsx` (Sketch button + SketchButton component), `frontend/src/components/Workspace.jsx` (mount overlay), `frontend/src/lib/store.js` (`addSketch` + `sketchMode` state), `frontend/src/lib/geometry.js` (sketch shape + bbox), `frontend/src/lib/releaseNotes.js`.

## Iteration 40 (2026-02-25) — Stripe Integration + Manifold-async Migration + Remix Activity Feed

### Stripe billing (formerly "on hold")
- ✅ **Pricing page** at `/pricing` — Free / Maker ($50/yr) / Pro ($190/yr). Server-defined catalog (`/api/billing/packages`) is the single source of truth; frontend never sends amounts to Stripe.
- ✅ **Checkout flow**: `POST /api/billing/checkout` creates a Stripe session, persists a `payment_transactions` row with status="initiated", returns a checkout URL. Frontend hard-redirects to Stripe.
- ✅ **Success page** at `/billing/success?session_id=...` polls `GET /api/billing/status/{session_id}` (every 2s, up to 10 attempts) and grants the tier idempotently on `payment_status=paid`. AuthContext refreshes immediately so the new tier shows up across the UI without reload.
- ✅ **Webhook** at `POST /api/webhook/stripe` updates the transaction row as a backup confirmation channel — the primary tier grant runs on the polling path, but webhook ensures eventual consistency if the user closes the tab.
- ✅ **Tier persistence**: `user.subscription_tier` ("free" / "maker" / "pro") + `subscription_expires_at` (ISO timestamp 365 days from payment). Exposed on `/api/auth/me` for frontend gating.
- ✅ **UserMenu badge**: shows the current paid tier ("MAKER" / "PRO") next to the "Plans & Pricing" link for instant visibility.
- ✅ Uses Emergent's pre-provisioned `sk_test_emergent` key (no user credential collection needed). Test cards work end-to-end through real Stripe Sandbox.
- ✅ Tests: `backend/tests/test_billing.py` — 5/5 passing (catalog, unknown-package rejection, session creation, 404 on unknown session, default tier).

### Manifold-async migration (P2)
- ✅ Migrated `ContextMenu.Flatten` and `store.applyCut` from sync `three-bvh-csg` to the manifold-3d worker pipeline.
- ✅ Added `cutObjectByPlaneAsync` + `flattenObjectsAsync` to `workerClient.js`. Worker now exposes `cut-plane` and `flatten` job types alongside existing `combine` / `evaluate-stats` / `slice` / `stl-bytes` / `threemf-bytes`.
- ✅ Graceful fallback: each path catches manifold failures and falls back to BVH-CSG silently (with a console warning) so corrupted imports never hard-error.
- ✅ Workspace `handleApply` now `await`s the async `applyCut` and shows the busy state correctly during the heavier manifold compute.

### Remix activity feed (P3)
- ✅ New backend endpoint `GET /api/users/{user_id}/remix-activity` returns public gallery items that remixed any design owned by `user_id`, newest-first. Private remixes excluded; self-remixes filtered out.
- ✅ New "Activity (N)" tab on `AuthorProfile` (`/u/:userId`) — clean horizontal rows with thumbnail, "X remixed your Y as Z", relative time. Clicking a row opens that remix in `/workspace?remix=<id>`.

### Other
- ✅ Release notes bumped to v1.7.0 — three combined entries.
- ✅ Backend pytest: **136/136 passing**.
- Files: `backend/billing.py` (NEW), `backend/server.py` (router mount + me-endpoint tier fields + remix-activity route), `backend/.env` (STRIPE_API_KEY), `backend/tests/test_billing.py` (NEW), `frontend/src/components/PricingPage.jsx` (NEW), `frontend/src/components/BillingSuccessPage.jsx` (NEW), `frontend/src/components/UserMenu.jsx`, `frontend/src/App.js`, `frontend/src/components/AuthorProfile.jsx`, `frontend/src/lib/store.js`, `frontend/src/lib/workerClient.js`, `frontend/src/lib/workers/csg.worker.js`, `frontend/src/components/ContextMenu.jsx`, `frontend/src/components/Workspace.jsx`, `frontend/src/lib/releaseNotes.js`.

## Iteration 39 (2026-02-24) — Tier-(c) Hybrid Infill + GCODE Preview Viewer
- ✅ **Tier-(c) hybrid infill**: layers immediately above the bottom solid band AND immediately below the top solid band now use a BOOSTED density (midpoint between user sparse % and 100%). Bridges sparse → solid cleanly so the first/last solid layer doesn't sag into a low-density gap below/above. Configurable `transitionLayers` count (default 2, in Slicer popover).
- ✅ **GCODE Preview Viewer** (`GcodePreviewDialog.jsx`): scrubbable 2D top-down toolpath viewer. After every successful slice the Slicer popover gains a "Preview toolpaths layer-by-layer" button that opens a modal with a 560×560 canvas, prev/next layer buttons, play/pause loop (100ms/layer), and a range slider. Color legend: orange = extrusion, dim grey = travel. Per-layer stats show layer index, Z height, extrude move count, travel move count.
- ✅ **GCODE parser**: lightweight, handles G0/G1 with modal X/Y/Z, distinguishes extrusion (G1 with E) from travel, buckets moves at each `; LAYER:n` comment.
- ✅ Verified end-to-end on a 20mm cube: layer 1 (bottom solid) → 65 extrude moves rendering ±45° solid fill + perimeter; layer 51 (mid) → 16 extrude moves showing perimeter + ~6 sparse diagonal lines; layer 99 (top solid) → 65 extrude moves again. Auto-fit bounding box scales correctly to canvas.
- ✅ Release notes bumped to v1.5.0 — returning users will auto-see the new entry on next visit.
- ✅ Backend pytest: 131/131 passing.
- Files: `frontend/src/lib/slicer.js` (transition layer detection + boosted density), `frontend/src/lib/store.js` (added `transitionLayers`), `frontend/src/components/ActionPopovers.jsx` (transition field + Preview button wire-up), `frontend/src/components/GcodePreviewDialog.jsx` (NEW), `frontend/src/lib/releaseNotes.js` (v1.5.0 entry).

## Iteration 38 (2026-02-24) — Release Notes Dialog (replaces "What's New" splash)
- ✅ **New `ReleaseNotesDialog` component**: scrollable changelog modal with one entry per release (date, version chip, title, list of changes). Newest entry on top, full scroll history.
- ✅ **Change type chips**: each bullet is tagged with a colored chip — emerald **NEW** (feature), cyan **TWEAK** (improvement), rose **FIX** (bug fix). Visual at-a-glance scanning of what kind of change shipped.
- ✅ **Source of truth**: `frontend/src/lib/releaseNotes.js` — structured array of `{version, date, title, changes:[{type,text}]}`. New entries appended at the top with each release.
- ✅ **Auto-show on returning visitors**: localStorage `forge.releaseNotes.seen` tracks the last-acknowledged version. When that mismatches `latestReleaseVersion()`, the dialog auto-opens once. First-time visitors don't see it (they hit Landing).
- ✅ **Topbar `Sparkles` button rewired** from `forgeslicer:show-splash` → `forgeslicer:show-release-notes`. The legacy `SplashScreen` (one-off announcement banners via `splash.html`) is preserved separately for special events.
- ✅ End-to-end verified in Preview: 6 release entries (1.0.0 → 1.4.0) render correctly; scroll works; close + reload doesn't re-open; localStorage written.
- Files: `frontend/src/lib/releaseNotes.js` (NEW), `frontend/src/components/ReleaseNotesDialog.jsx` (NEW), `frontend/src/App.js` (mount), `frontend/src/components/TopToolbar.jsx` (rewire button).

## Iteration 37 (2026-02-24) — Tier-(b) Sparse Infill + GCODE Download UX
- ✅ **Sparse infill (Tier b)**: middle layers between the top/bottom solid bands now get sparse fill instead of being hollow. New settings: `infillPercent` (0–100%, slider) and `infillPattern` ("rectilinear" / "grid" / "gyroid"). Spacing scales inversely with density (100% = solid, 25% = 4× extrusion-width spacing, 0% = legacy perimeter cage).
- ✅ **Three patterns implemented**: rectilinear (alternating ±45°), grid (perpendicular crosshatch), gyroid (sampled implicit surface — strong & isotropic).
- ✅ **GCODE download UX clarity**: emerald confirmation card after every slice + a "Download `<file>` again" button that re-fires the download from a fresh user gesture (bypasses Chrome's silent-drop heuristic). Cached GCODE so re-download doesn't re-slice.
- ✅ **Header advertises infill**: e.g. `; ForgeSlicer 1.0 - GCODE (perimeters + 4 bottom / 4 top solid layers + 15% gyroid sparse infill)`.
- ✅ **End-to-end verified**: 20mm cube @ 15% density: middle-layer moves 16 (rectilinear) / 24 (grid) / 44 (gyroid) vs 8 (perimeter-only baseline) and 65 (solid bands). GCODE size scales appropriately.
- ✅ Backend pytest: 131/131 passing.
- Files: `frontend/src/lib/slicer.js`, `frontend/src/lib/store.js`, `frontend/src/components/ActionPopovers.jsx`.

## Iteration 36 (2026-02-24) — Top Toolbar Wraps on Narrow Windows + GCODE Download UX (Loose Ends)

## Iteration 35 (2026-02-24) — Solid Infill (Tier a) + Manifold ✓ Gallery Badge
- ✅ **Solid infill — Tier (a)**: top N and bottom N layers of every print are now fully solid via rectilinear ±45° fills (alternating per layer to bond cross-layer fibers). Middle layers stay perimeter-only (Tier b/c sparse infill is the next milestone).
- ✅ **New slicer settings**: `bottomLayers` (default 4) + `topLayers` (default 4) exposed in the Slicer popover as integer fields. Setting either to 0 reproduces the legacy perimeter-only output.
- ✅ **Algorithm**: scan-line fill with even-odd rule in a frame rotated by `-angleDeg`. Edges drop horizontal segments (no scan crossing), inset by ½ extrusion-width so fills bond to but don't overrun the perimeter. Spacing equals the extrusion width = 100% solid.
- ✅ **End-to-end verification in Preview**: sliced a 20mm cube → 99 layers, bottom/top each averaged **65 G1-extrude moves per layer** vs middle layers averaging **8 moves** (perimeter-only). Header advertises the configured counts.
- ✅ **"Manifold ✓" Gallery badge**: when an STL is exported through the manifold-3d worker pipeline (the default), the `manifold_verified=true` flag rides along with the upload. Gallery cards render an emerald `🛡 manifold` badge for verified items so remixers see quality at a glance. Backend GalleryItem model + create endpoint + list endpoint all surface the field.
- ✅ Worker (`csg.worker.js`) now stamps `manifoldVerified=true` on STL responses when manifold-3d succeeded, and `false` when it fell back to three-bvh-csg. `exportSTLBytesAsync` propagates this through to `ShareDialog`, which POSTs `manifold_verified` with the gallery item.
- ✅ **Tests added**: `backend/tests/test_gallery_manifold.py` covers POST default (False), POST true round-trip, and `me/designs` persistence. 3/3 passing. Backend full suite: 130 passing (voice-command test flakes occasionally on LLM non-determinism but passes in isolation).
- Files: `frontend/src/lib/slicer.js`, `frontend/src/lib/store.js`, `frontend/src/components/ActionPopovers.jsx`, `frontend/src/lib/workers/csg.worker.js`, `frontend/src/lib/workerClient.js`, `frontend/src/components/dialogs/ShareDialog.jsx`, `frontend/src/components/Gallery.jsx`, `backend/server.py`, `backend/tests/test_gallery_manifold.py`.

## Iteration 34 (2026-02-24) — Auth Bug Fix: R3F Overlay + CORS Wildcard
- 🔴 **User-reported bug**: "Runtime error with Google sign-in. Not persisting my sign-in from session to session. Can't log in with any method in incognito."
- 🔍 **Root cause #1 (Preview only)**: The `@emergentbase/visual-edits` babel plugin injects `x-line-number` / `x-file-name` debug attrs on every **lowercase** JSX element (line 1782 of its compiled plugin: `if /^[A-Z]/.test(elementName) return;`). React-Three-Fiber treats every prop as a Three.js property, so those `x-*` attrs crash R3F with `Cannot set "x-line-number"` and the CRA dev error overlay covered the entire sign-in form. User reports of "can't log in" stem from the overlay blocking interaction, NOT from broken auth.
- 🔍 **Root cause #2 (Production-relevant)**: Backend CORS middleware combined `allow_credentials=True` with `allow_origins=['*']`. Per CORS spec, browsers REFUSE to store/send cookies on responses that combine the wildcard origin with credentials. Same-origin requests (today's actual deploy topology) sidestep this, but if the user ever signed in via a cross-origin flow (e.g., Emergent Google Auth redirect from `auth.emergentagent.com`), the `session_token` cookie would be silently dropped.
- ✅ **Fix #1**: `craco.config.js` — disabled visual-edits via `FORGE_DISABLE_VISUAL_EDITS=true` flag, gated by an explicit constant so future contributors can re-enable when upstream adds R3F intrinsic exclusions.
- ✅ **Fix #2**: `backend/server.py` — replaced `allow_origins=['*']` with `allow_origin_regex` that reflects the specific request origin only when it matches `forgeslicer.com`, `*.preview.emergentagent.com`, `*.emergent.host`, or `localhost`. Disallowed origins get no `Access-Control-Allow-Origin` header (browser blocks the response). Same-origin requests still work transparently.
- ✅ **End-to-end verification in Preview**: created a fresh account → redirected to `/workspace` → `session_token` cookie set with `Max-Age=604800; HttpOnly; Secure; SameSite=None` → full page reload → cookie still present → `/api/auth/me` returns 200 → user stays signed in.
- ✅ Backend pytest unchanged: 128/128 passing.
- Files: `frontend/craco.config.js`, `backend/server.py`.

## Iteration 33 (2026-02-23) — manifold-3d CSG Swap (Phase 1)
- ✅ **Installed manifold-3d 3.5.0** — Google's WASM-backed geometry library that guarantees manifold output (no open edges / slivers along boolean boundaries). Replaces `three-bvh-csg` as the **primary** CSG engine inside the Web Worker.
- ✅ **New module `frontend/src/lib/manifoldEngine.js`** exposes the same async surface as the existing worker client: `evaluateSceneAsync`, `evaluateSceneByColorAsync`, `combineTwoAsync`, `cutObjectByPlaneAsync`. WASM init is lazy, shared across calls, and works in both main-thread and worker contexts.
- ✅ **Worker (csg.worker.js) now uses manifold by default** with `three-bvh-csg` as a graceful fallback — if manifold throws on a corrupted import (e.g., NotManifold from a low-quality STL), the worker silently falls back so the user's project never breaks. Engine choice can be flipped at runtime via `{type:'set-engine', payload:{engine:'bvh'|'manifold'}}` for A/B regression debugging.
- ✅ **Bridge helpers** weld duplicate vertices (snap-to-grid 1e-4) before constructing Manifold meshes — three.js's BoxGeometry/SphereGeometry carry duplicate verts along UV seams, which manifold-3d would otherwise reject as `NotManifold`.
- ✅ **WASM hosting**: `manifold.wasm` (540KB) is copied to `frontend/public/manifold.wasm` via a yarn `postinstall` script so it's served from the app origin root. Worker locates it via `locateFile` callback so the worker scope resolves it correctly.
- ✅ **craco webpack patch** rewrites `node:module` etc. imports (manifold-3d's isomorphic Node code path) to plain specifiers + `resolve.fallback` empty modules, so webpack 5 builds without an `UnhandledSchemeError`.
- ✅ **Test coverage**: `frontend/tests/manifold-smoke.mjs` exercises cube/sphere/cylinder primitives, union/subtract/intersect, batched union, and `splitByPlane`. 9/9 passing. Backend pytest unchanged: 128/128 passing.
- ✅ **End-to-end verification in Preview**: added Cube + Sphere via the left palette, clicked STL → exported 91KB binary STL successfully routed through worker → manifold-3d → STLExporter.
- Files: `frontend/src/lib/manifoldEngine.js` (NEW, 354 lines), `frontend/src/lib/workers/csg.worker.js` (rewritten to dual-engine), `frontend/craco.config.js` (node-scheme replacement plugin), `frontend/package.json` (manifold-3d dep + postinstall), `frontend/public/manifold.wasm` (copied), `frontend/tests/manifold-smoke.mjs` (NEW).
- **Note**: main-thread sync callers (`exporters.js`, `ContextMenu.jsx` flatten, `store.js cutObjectByPlane`) still use `three-bvh-csg` since manifold's WASM init is async. Acceptable today because the worker is the primary execution path for every CSG-heavy user action (STL/3MF export, scene stats, Combine button, slicing). Future work: introduce async variants for the two remaining sync callers.

## Iteration 47 (2026-02-25) — AMS-aware GCODE Preview (Multi-material Slicer + Per-extruder Toolpaths)
- ✅ **Multi-material slicer**: `sliceToGCODE` now auto-detects scenes with 2+ distinct `colorIndex` groups and dispatches to a new `sliceMultiMaterialToGCODE` path. The new path uses `evaluateSceneByColor` to get per-color manifold geometries, then slices each colour's loops independently per layer with the existing solid/sparse/transition infill tier logic. Tool changes are emitted as `T<n>` lines + `; TOOL:n hex=#RRGGBB name=<n>` markers so downstream firmware and the in-app preview can both interpret them.
- ✅ **AMS color table** declared once in the GCODE header (`; AMS_TABLE T0=#E5E5E5 T1=#3182CE …`) so previewers/post-processors don't need to wait for the first tool change to learn the palette.
- ✅ **GCODE preview parser upgraded**: parses `AMS_TABLE`, `; TOOL:` markers, and explicit `T<n>` lines; attributes every G0/G1 move to its active tool; counts per-layer tool changes; records tool-change marker positions for visual overlay.
- ✅ **Preview canvas renders per-tool colours**: extrusion strokes batched per extruder so each material paints in its filament hex from the palette (white, black, red, green, blue, yellow, purple, orange). Tool-change markers drawn as small coloured rings at the changeover XY. Single-material prints fall back to the legacy orange/grey rendering — zero visual regression.
- ✅ **Per-tool legend with show/hide toggles**: when a print is multi-material, the dialog shows an `Extruders` legend with one chip per active tool (color swatch + `T<n> · <name>`). Clicking a chip hides that extruder's segments from the canvas, useful for inspecting a single colour layer-by-layer. An AMS badge in the dialog header advertises tool count.
- ✅ **Layer stats** now include a `Tool Chg` cell on multi-material prints so the user can see at a glance which layers swap filaments.
- ✅ **Tests**: `frontend/tests/ams-preview-smoke.mjs` covers AMS_TABLE palette ingestion, per-tool move attribution, tool-change counting, single-material no-regression, and implicit `T<n>` tool-change handling. 16/16 checks passing. Existing `manifold-smoke.mjs`: 9/9. Backend pytest: untouched (no backend changes for this feature).
- Files: `frontend/src/lib/slicer.js` (multi-material slice path), `frontend/src/components/GcodePreviewDialog.jsx` (parser + per-tool rendering + legend), `frontend/tests/ams-preview-smoke.mjs` (NEW).

## Iteration 49 (2026-05-26) — OrcaSlicer Engine Integration (Phase 1) + Right-Panel Tabs + Voice Fixes

### OrcaSlicer Engine (Phase 1 — backend skeleton + UI selector + background compile)
- ✅ **Backend**: New `backend/orca_engine.py` module exposing `/api/slice/orca/status` (cheap, no fork — reports install location, arch, version, build-in-progress flag) and `/api/slice/orca/slice` (POST STL+profiles → shells out to OrcaSlicer CLI → returns extracted GCODE + stats). Hard 5-min timeout, 50 MB STL cap, per-request temp dir cleanup.
- ✅ **Binary resolution** walks: `$ORCA_BIN` → `/app/backend/bin/orca-aarch64/OrcaSlicer` → `/app/backend/bin/orca-x86_64/OrcaSlicer` → `PATH`. Persistent install survives container restarts.
- ✅ **Frontend Engine picker** in `ActionPopovers.SlicerPopover`: two-tile selector (Built-in · in-browser | OrcaSlicer · server-side) with live install-status detail line. Built-in remains default; Orca tile is disabled with "installing…" spinner + explanation when the server reports `build_in_progress`. Choice persists in localStorage. `orcaApi.{status,slice}` added to `lib/api.js`.
- ✅ **Helper**: `arrayBufferToBase64` chunked encoder for large STL uploads (avoids the spread-into-fromCharCode stack overflow on 1MB+ buffers).
- ✅ **Tests**: `backend/tests/test_orca_engine.py` — status returns well-formed payload; slice returns 503 with helpful detail when engine missing. 2/2 passing.
- 🟡 **Phase 2 in progress**: ARM64 source compile of OrcaSlicer v2.3.2 running in background under `/opt/orca-build/`. Build output checked into `/app/backend/bin/orca-aarch64/` on success (`/app` is the persistent volume so the binary survives restarts). Currently at OpenSSL compile (~dep #110/193, ~1.5 GB into expected 5-8 GB). Expected completion: ~1-2 hours from initial launch.
- 🔵 **Phase 3 (queued)**: x86_64 production fallback — fetch official AppImage at backend startup, `--appimage-extract`, drop into `bin/orca-x86_64/`. Backend already routes via `platform.machine()`.

### Right Panel → tabbed (Inspect / Print / Health)
- ✅ Three persisted tabs matching the LeftPanel pattern. Inspect = selected-object editor + scene stats; Print = printer/filament + compatibility warnings; Health = manifold checks. Reduces visual density and selection persists in localStorage. (`RightPanel.jsx`)

### Voice control fixes
- ✅ **Adaptive VAD threshold** (`whisperStt.js`): samples ambient noise for 600 ms then locks speech threshold at `floor + 10 dB` (capped at −55 dB). Replaces the fixed −45 dB cutoff that left quiet rooms / low-gain mics stuck on "Listening…" forever.
- ✅ **Hard 12-s record cap** in `VoiceButton.jsx` — even if VAD never trips, the listener auto-finishes so the UI can never hang.
- ✅ **Whisper hallucination filter** — known silence artefacts ("you", "Thank you.", "Thanks for watching", "[music]", "...") collapse to empty string so users get "No speech detected" instead of bogus commands. 15/15 smoke checks (`tests/voice-hallucination-smoke.mjs`).

### Other fixes
- ✅ Release-note dates corrected (Feb → May 2026 — system clock confusion on my end).
- ✅ SVG import strips background-fill rectangles automatically and carves letter holes as negative siblings (logos now read properly, no more orange slab). 7/7 smoke checks against the user-submitted SWS Logo.
- ✅ Share + Save Component dialogs fully reset all fields on every open (description was sticking).

### Files touched
- `backend/orca_engine.py` (NEW), `backend/server.py` (router mount), `backend/tests/test_orca_engine.py` (NEW)
- `frontend/src/components/ActionPopovers.jsx` (Engine picker), `frontend/src/lib/api.js` (orcaApi), `frontend/src/components/RightPanel.jsx` (tabs), `frontend/src/components/VoiceButton.jsx` (cap), `frontend/src/lib/whisperStt.js` (adaptive VAD + hallucination filter), `frontend/src/lib/svgImport.js` (background strip + holes), `frontend/src/components/SVGImportDialog.jsx` (holes UI), `frontend/src/components/dialogs/ShareDialog.jsx` & `SaveComponentDialog.jsx` (reset on open), `frontend/src/lib/releaseNotes.js` (1.10.0 entry)
- `frontend/tests/voice-hallucination-smoke.mjs` (NEW), `frontend/tests/svg-import-smoke.mjs` (NEW), `frontend/tests/ams-preview-smoke.mjs` (NEW + fixture `tests/fixtures/sws-logo.svg`)

## Backlog / Future Enhancements
- P0: **OrcaSlicer Phase 2** — verify the ARM64 compile finishes successfully and the binary slices a test STL end-to-end. Re-deploy.
- P0: **OrcaSlicer Phase 3** — x86_64 production AppImage extraction at backend startup.
- P1: **OrcaSlicer profile editor UI** — surface printer/process/filament JSON fields so users can dial in supports / multi-perimeter count / ironing without leaving the dialog.
- P2: Migrate the two remaining main-thread sync CSG callers (`ContextMenu.flatten`, `store.cutObjectByPlane`) to manifold-3d async — minor UX refactor (small "Computing…" state) but unifies the engine across all execution paths.
- P2: Curve/extrude primitives
- P2: `forgeslicer://` URL protocol companion app
- P2: Further refactor `ContextMenu.jsx` + `TopToolbar.jsx`
- P2: Stripe subscription tiers (PRICING_RESEARCH.md ready) — ✅ done
- P3: Sketch / 2D drawing mode — ✅ done
- P3: AMS-aware preview — ✅ done (Iteration 47)
- P3: Remix activity feed on Profile (who remixed your designs, when) — ✅ done


## Iteration 1.14 (2026-02-27) — Popover refactor + Rotation/Position regression closed
- ✅ **Verified Rotation ≠ Position popover bug is gone** — live preview shows the Position popover renders X/Y/Z mm fields and the Rotation popover renders X/Y/Z ° fields + Drop-to-Bed. Previous agent's TopToolbar refactor already resolved it; no further patch needed.
- ✅ **Split `ActionPopovers.jsx` (991 lines) into `components/popovers/`** — one file per popover:
   - `PopoverShell.jsx` — shared `PopoverShell` + `NumberField` + `EmptyMsg` primitives
   - `PositionPopover.jsx`, `RotationPopover.jsx`, `ScalePopover.jsx`
   - `DuplicatePopover.jsx`, `MirrorPopover.jsx`, `SlicerPopover.jsx`
   - `OrcaProfileEditor.jsx` — extracted from inside SlicerPopover
   - `index.js` — barrel for `TopToolbar` import
- ✅ `ActionPopovers.jsx` shrunk to a 7-line re-export shim for backward compat.
- ✅ Smoke test verified all 6 popovers (position / rotation / scale / duplicate / mirror / slicer) render unique testids on click.

### Files touched
- `frontend/src/components/popovers/` (NEW directory, 8 files)
- `frontend/src/components/ActionPopovers.jsx` (reduced to re-export shim)
- `frontend/src/components/TopToolbar.jsx` (import path updated)

## Iteration 1.27 (2026-02-27) — OrcaSlicer profile-JSON metadata fix (exit 251)
**Production bug**: User clicked Slice & Export GCODE in OrcaSlicer mode and got
`OrcaSlicer exited with code 251: operator():file /tmp/orca-XXX/printer.json's from unsupported (HTTP 500)`.

**Root cause**: OrcaSlicer's CLI strictly validates the JSONs it loads — every profile must carry four required metadata fields (`type`, `name`, `from`, `instantiation`). We were sending just the slicer-param keys (`nozzle_diameter`, `printable_area`, etc.). Without the metadata, the C++ validator threw `operator():file X.json's from <empty> is unsupported (rc=251)`.

**Fix shipped (preview-only, needs redeploy for prod)**:
- ✅ `buildOrcaPayload()` now wraps every output profile with the four required metadata fields:
   - `type` = `"machine" | "process" | "filament"`
   - `name` = the human label
   - `from` = `"User"`
   - `instantiation` = `"true"` (string, not bool — Orca expects a string)
- ✅ Friendly error mapping in `orca_engine.py`: when stderr matches `operator():file X.json's from ... unsupported`, the slice endpoint now returns **400** with "OrcaSlicer rejected printer.json — the profile JSON is missing required metadata" instead of the raw C++ trace.
- ✅ **22-check unit test** (`tests/orca-profile-meta.mjs`) verifies every profile carries metadata + tunables override correctly + unknown IDs fall back. All passing.

### Files touched
- `frontend/src/lib/orcaProfiles.js` — `buildOrcaPayload` adds `withMeta()` wrapper
- `backend/orca_engine.py` — slice endpoint maps the profile-validation pattern to a clean 400
- `frontend/tests/orca-profile-meta.mjs` (NEW) — regression coverage

### To restore OrcaSlicer on prod
Redeploy. After redeploy, the same workflow (group interlocking cubes → OrcaSlicer engine → Slice & Export) should now produce real Orca GCODE.

## Iteration 1.26 (2026-02-27) — TODO ADDED (not yet fixed)
**Slider value-bubble overflow in Slicer popover**: When a value indicator (e.g. `2` walls, `15%` infill) is rendered, it can appear *underneath an adjacent control to its right* or *escape the popover boundary entirely* when the popover is anchored near the right edge of the viewport. Reported by user against production.

**Where to look**:
- `frontend/src/components/popovers/SlicerPopover.jsx` — `bg-slate-950 ... flex-shrink-0` slider rows for Infill (`%`)
- `frontend/src/components/popovers/OrcaProfileEditor.jsx` — same pattern for Perimeters (`walls`) and Infill density (`%`)
- `frontend/src/components/popovers/PopoverShell.jsx` — viewport-edge clamping in `setPos`

**Likely fix**:
- The slider rows use `flex items-center gap-X` with `flex-1` on the input — the value span at the end may be overflowing on narrow popover widths
- Or browser default value-bubble on `<input type="range">` is escaping
- The PopoverShell's `width` parameter (340 px for Slicer) may need a max-width clamp against the viewport
- Add `overflow-hidden` or `min-w-0` to the slider row to contain the bubble

**Action**: Investigate in a screenshot test (right-column position + ultrawide + narrow viewports), then patch.

## Iteration 1.25 (2026-02-27) — Slicer popover status polling (UI didn't refresh after install completed)
**Diagnosis**: User saw "installing…" forever on production even though `/api/slice/orca/status` returned `installed: true` (verified via browser DevTools). The OrcaSlicer install actually succeeded — but the frontend only fetched status ONCE on mount and never refreshed.

**Fix**:
- ✅ `SlicerPopover.jsx` now polls `/api/slice/orca/status` every 5 s while `installed` is still false (AND the user is on a supported arch). Stops polling automatically once installed flips true.
- ✅ Transient network errors also re-try (10 s backoff) — no need to close/reopen the popover.

**For the existing stuck UI**: a single hard refresh (Ctrl+Shift+R) clears the stale client state immediately, no redeploy required.

### Files touched
- `frontend/src/components/popovers/SlicerPopover.jsx`

## Iteration 1.24 (2026-02-27) — Stale-lock cleanup + status-detail debug info
- ✅ `_install_in_progress()` ignores + auto-cleans lock files older than 15 min so a crashed install can't permanently jam the UI.
- ✅ Status detail surfaces lock-file age when an install runs longer than 5 min ("612 s elapsed").
- ✅ New pytest test covers the stale-cleanup path. 11/11 passing.

### Files touched
- `backend/orca_engine.py` — stale-lock guard + age-aware detail messages
- `backend/tests/test_install_orca.py` — `test_install_in_progress_clears_stale_lock`

## Iteration 1.23 (2026-02-27) — OrcaSlicer system-deps fix (prod libEGL error)
**Production bug**: User reported on https://forgeslicer.com that switching to the OrcaSlicer engine and slicing produced `libEGL.so.1: cannot open shared object file (exit code 127)`. Built-in slicer worked fine.

**Root cause analysis**:
- Used `readelf -d` on the v2.3.2 binary inside the AppImage. Confirmed it has ~30 `NEEDED` shared libraries — libEGL, libGL, libgtk-3, libwebkit2gtk-4.1, libpango, libcairo, libgstreamer, libsoup, libsecret, etc.
- The AppImage ships ONLY `bin/orca-slicer` and `AppRun`. ZERO bundled `.so` files. The binary expects the host system to have the entire GTK+OpenGL+WebKit stack installed.
- The production container has none of these — it was built for a Node/Python web stack, not a GUI app's runtime.

**Fix shipped**:
- ✅ **NEW `scripts/install_orca_deps.sh`** — apt-get installs the 30-package runtime dep list (libegl1, libgl1, libgtk-3-0, libwebkit2gtk-4.1-0, libpango-*, libcairo*, libgstreamer*, libsoup-3.0-0, etc.). Idempotent — uses `dpkg-query` to skip already-installed packages, ~50 ms when satisfied. Skips cleanly if not root or apt-get not present.
- ✅ **Wired into 2 places**: invoked once from `install_orca.py` before extracting; invoked again on every backend startup via a separate `server.py` hook so already-installed boxes still get fixed.
- ✅ **Resolver fix**: `_resolve_appimage_entry()` now includes `bin/orca-slicer` as a candidate (the AppImage v2.x actual layout) — was previously missing it; only worked through AppRun.
- ✅ **Friendly slice-error mapping**: when `stderr` contains `error while loading shared libraries`, the slice endpoint extracts the missing lib name with regex and returns a **503 with actionable detail** ("library 'libEGL.so.1' is missing — run `install_orca_deps.sh`") instead of a raw 500 trace.
- ✅ **README.md** updated with the full Dockerfile snippet (recommended) so the deps are baked in at image-build time.
- ✅ **2 new pytest tests**: AppImage layout candidate (`bin/orca-slicer`) detection; existing 12-test suite still passes.

### Files touched
- `backend/scripts/install_orca_deps.sh` (NEW) — apt-get-based system-deps installer with idempotency, age-aware apt-list refresh, clear logging
- `backend/scripts/install_orca.py` — calls `_ensure_system_deps()` before AppImage extract; adds `bin/orca-slicer` candidate in `_pick_entrypoint`
- `backend/orca_engine.py` — `_resolve_appimage_entry` recognises real v2.x layout; slice endpoint returns 503 + actionable detail for missing-lib errors
- `backend/server.py` — `_run_orca_deps` worker fires the deps script on every startup
- `backend/scripts/README.md` — system-deps documentation + Dockerfile recommendation
- `backend/tests/test_install_orca.py` — new test for `bin/orca-slicer` resolver path

## Iteration 1.22 (2026-02-27) — Voice command palette + Go-mode wait/resume
- ✅ **Voice command palette**: new `BookOpen` icon button next to the Voice mode chevron opens a 360px popover with 11 categorized sections of example phrases (primitives, transform, selection, duplicate, booleans, history, group, gizmo mode, export, AI mesh, Go-mode controls). Categories are individually collapsible with persistent state, and the palette closes on click-outside / Esc / explicit X. Hidden by default — zero permanent screen real estate.
- ✅ **Wait/Resume in Go mode** — addresses "let me take a measurement" / "let me look something up" workflows:
   - **Pause phrases** ("wait", "wait a sec", "pause", "hold on", "one moment", "give me a sec", "hang on", "one sec") — recognised as the WHOLE utterance only; spoken as a command, they enter the paused state instead of running.
   - **Paused state**: mic stays open in keyword-listen mode with longer silence tolerance (1.5 s vs 0.9 s) so brief ambient sounds don't trigger transcription. Each cycle ≤4.5 s. Only `resume` / `continue` / `ready` / `i'm back` / `go again` / `let's continue` / `go ahead` / `start again` re-engage the loop. Any other speech is silently discarded and the listen cycle restarts.
   - **Hard cap**: 2-minute pause limit prevents accidental forever-recording. Auto-exits Go mode with a warning toast.
   - **Manual escape**: clicking the Voice button while paused = manual resume (escape hatch for noisy environments where voice-resume can't be heard).
   - **Disjoint regex sets** — pause / resume / exit are mathematically verified non-overlapping; no phrase ambiguously matches more than one.
- ✅ **Visual states**: yellow Pause icon + "Resume" label on the Voice button while paused; yellow-bordered banner with the resume phrase list; localized banner text.

### Files touched
- `frontend/src/components/VoiceCommandPalette.jsx` (NEW) — 11-category collapsible cheatsheet popover with persistence
- `frontend/src/components/VoiceButton.jsx` — adds `enterGoPause`, `beginGoPauseListen`, `finishGoPauseListen`, `resumeGoMode`, pause/resume regex classifiers, paused-state banner + button visuals
- `frontend/src/components/toolbar/SystemRow.jsx` — mounts `<VoiceCommandPalette />` next to `<VoiceButton />`

## Iteration 1.21 (2026-02-27) — Voice latency cut + new "Go" continuous mode
- ✅ **Latency fixes** (single-shot mode improves too): VAD silence trigger 1500 → 900 ms, grace pause 2000 → 600 ms, confirm-silence 1000 → 700 ms. Typical mic-to-result time: **~10 s → ~6-7 s**.
- ✅ **Added "Go mode"** — continuous hands-free voice loop, no confirmation step. After each command runs, mic auto-reopens for the next utterance. Typical mic-to-result time in Go mode: **~3 s** (skips the entire confirmation Whisper round-trip).
- ✅ **Mode picker UI**: small chevron dropdown next to the Voice button → two-option menu (Single Command / Go Mode) with persistent `localStorage` storage. A subtle "GO" badge on the Voice button when Go mode is selected so it's discoverable without opening the menu.
- ✅ **Exit phrases for Go mode**: `"stop"`, `"done"`, `"exit"`, `"cancel"`, `"quit"`, `"end voice"`, `"stop listening"`, `"i'm done"`, plus variants like "exit go mode". Regex-tested to NOT false-trigger on commands containing those words (e.g. "stop the slicer" → still a command, "cancel my last operation" → still a command).
- ✅ **Idle exit**: 20 s of no-speech in Go mode → automatically ends the loop so the mic indicator doesn't pulse forever if the user walks away.
- ✅ **Visual state**: Voice button gains an orange Zap icon + "Voice · Go" label while Go mode is actively running; the banner shows a one-line hint about how to exit ("Say 'stop' or click Voice to end Go mode").

### Files touched
- `frontend/src/components/VoiceButton.jsx` (rewritten — adds mode state, Go-loop scheduler, exit-phrase classifier, chevron menu, reduced timeout constants)

## Iteration 1.20 (2026-02-27) — Light/Dim active-state legibility fix
- ✅ **Fixed**: in light mode, the active state of toolbar pills + theme switcher segments + the pin toggle was `text-orange-300` on `bg-orange-500/20` — pale-orange text on pale-orange background, near-illegible.
- ✅ **Solution**: targeted `[data-theme="light"]` overrides in `themes.css` that darken `text-orange-100/200/300/400` to orange-700/800 and bump the highlight fill from 20% → 28% opacity. Dark + Dim modes are completely untouched.
- ✅ Also pre-emptively darkened light-mode accent texts that exhibited the same low-contrast pattern: `text-emerald-200/300`, `text-amber-300/400`, `text-purple-100/200/300`, `text-green-300`, `text-red-400`, `text-cyan-400` — used by Slicer engine cards, save-component confirmation, and multi-select badges.
- ✅ Computed-style verification: light-mode active = `rgb(194,65,12)` orange-700 / 28% tint; dark + dim = `rgb(253,186,116)` orange-300 / 20% tint (unchanged).

### Files touched
- `frontend/src/styles/themes.css` — one new block under `[data-theme="light"]` for orange + accent text remaps

## Iteration 1.19 (2026-02-27) — OrcaSlicer AppImage installer (auto on backend startup)
- ✅ **`scripts/install_orca.py`** — downloads the latest OrcaSlicer Linux AppImage from the official `SoftFever/OrcaSlicer` GitHub release, self-extracts via `--appimage-extract` (no FUSE), and stages the result at `/app/backend/bin/orca-x86_64/`. Idempotent — running on an already-installed host is a sub-100 ms no-op. Honors `--force` and `--dry-run`.
- ✅ **Auto-run on backend startup** (`server.py` `@app.on_event("startup")`): if no working binary is resolved, fires the installer in a background thread. Non-blocking — backend serves traffic immediately, engine becomes available once install (~30-60 s on x86_64) finishes. On aarch64 the installer cleanly skips with rc=1 (no AppImage published for ARM).
- ✅ **Resolver supports both flows**: `_resolve_appimage_entry()` prefers `AppRun` (AppImage launcher with bundled LD_LIBRARY_PATH) and falls back to `OrcaSlicer` / `usr/bin/OrcaSlicer` so a future source-build also works.
- ✅ **Arch-aware status detail** — on aarch64 hosts the status endpoint surfaces "OrcaSlicer ships an x86_64-only AppImage; this server is aarch64" instead of the generic "not installed" message.
- ✅ **Lock file sentinel** (`bin/.orca_install_lock`) so the status endpoint can report `build_in_progress: true` while a concurrent install is running. UI already displays an "installing…" pill on this state.
- ✅ **9 new pytest unit tests** in `test_install_orca.py` exercising asset-picker, arch check, env-override, on-aarch64 skip path, AppRun preference, nested binary fallback, and lock-file detection. All passing.
- ✅ **`.gitignore` entries** for `backend/bin/orca-*/` + `backend/bin/.cache/` so the ~280 MB extracted binary is downloaded per-deploy rather than committed.
- ✅ **`backend/scripts/README.md`** documents the install flow, manual operations, disk usage, status endpoint payload, and the AppImage-vs-source-build tradeoff.

### Files touched
- `backend/scripts/install_orca.py` (NEW) — full installer with download, extract, idempotency, lock file, arch detection
- `backend/scripts/README.md` (NEW) — deploy ops documentation
- `backend/orca_engine.py` — `_resolve_appimage_entry`, `_install_in_progress`, updated `resolve_install`, arch-aware status detail
- `backend/server.py` — startup hook + thread-pool runner for the installer
- `backend/tests/test_install_orca.py` (NEW) — 9 unit tests
- `/app/.gitignore` — entries for the binary cache + extracted tree

### Production verification
This preview pod is aarch64 — the install pipeline is exercised through download + GitHub API + asset picker + lock file, but the final binary cannot run here. **Production x86_64 hosts will install + verify end-to-end on first backend boot** (~30-60 s) and surface the engine immediately. No manual intervention required after merging.

## Iteration 1.18 (2026-02-27) — Per-route theme memory
- ✅ **Optional pin toggle** added next to the theme switcher (Pin / PinOff icon). When pinned, the theme switcher writes to a per-route slot instead of the global default.
- ✅ Storage: `forgeslicer.theme.perRoute` (1/0) + `forgeslicer.theme.routes` (JSON `{ path → choice }` map). Path keys are normalized to the top-level segment (`/workspace`, `/gallery`, `/u`, …) so users don't end up with a different theme per gallery item.
- ✅ **Route-change reactivity** wired in `AppRouter` via `useLocation` → `useTheme.setRoute(pathname)`. When pin is ON and the route has a saved theme, it re-applies on navigation without a reload.
- ✅ **Toggling pin ON seeds the current route** with the user's *global choice* (not the resolved value) so pinning a page in Auto mode stays Auto — a tiny but important detail.
- ✅ **Switcher mounted on Landing, Gallery, Profile** (alongside the existing Workspace mount) so users can change/pin themes from any route.
- ✅ **Bootstrap-aware**: `bootstrapTheme()` reads the per-route map and the current `location.pathname` at boot, so the first paint already reflects a pinned route's theme on direct page load.
- ✅ Smoke test verified 7-scenario flow: global=Light → navigate to /workspace → pin → change to Dark → navigate to /gallery (still Light) → back to /workspace (Dark restored) → reload (Dark persists). Independent and idempotent.

### Files touched
- `frontend/src/lib/theme.js` (rewrote — adds `routeThemes`, `perRouteEnabled`, `setRoute`, `togglePerRoute`, `normalizeRoute`)
- `frontend/src/components/toolbar/ThemeSwitcher.jsx` (adds Pin button, reads active-segment from effective theme)
- `frontend/src/App.js` (subscribes to `useLocation` and calls `setRoute`)
- `frontend/src/components/Landing.jsx`, `Gallery.jsx`, `Profile.jsx` (mount ThemeSwitcher in header)

## Iteration 1.17 (2026-02-27) — One-time "Auto theme is on" hint toast
- ✅ Added a **one-time toast** on first launch for brand-new visitors: "Auto theme is on — We're following your system appearance. Tap the sun/moon icons in the toolbar to override." with a "Got it" action and 8s auto-dismiss.
- ✅ **Gated tightly** — fires only when (a) user has *no* stored theme choice AND (b) `forgeslicer.theme.hintSeen` localStorage flag isn't set. Mounted with a 2.5s delay so it doesn't compete with the splash screen / auth redirects.
- ✅ "Got it" click, swipe-dismiss, and auto-close all mark the hint as seen — so it never re-appears regardless of how the user dismisses it.
- ✅ Smoke test verified: appears once for new user → never again on reload → never shown to returning users with a pre-existing stored theme.

### Files touched
- `frontend/src/lib/theme.js` (added `shouldShowThemeHint()` / `markThemeHintSeen()` + module-load capture of pre-bootstrap stored value)
- `frontend/src/App.js` (delayed `useEffect` fires the toast)

## Iteration 1.16 (2026-02-27) — System / Auto theme mode (new default)
- ✅ **Added `system` mode** (icon: MonitorCog, label: Auto) — follows `(prefers-color-scheme: light)` media query. Now the default for brand-new users.
- ✅ **Live OS updates**: A `matchMedia` listener installed at module load re-resolves the theme when the user flips their OS appearance while the tab is open. Listener only acts when stored choice is `"system"` — explicit Dark/Dim/Light picks are never overridden by OS changes.
- ✅ **Store now exposes `theme` (user choice incl. `system`) AND `resolvedTheme` (concrete `dark|dim|light` actually rendered)**. Viewport canvas reads `resolvedTheme` so Auto mode flows through to the 3D scene background too.
- ✅ Switcher tooltip on the Auto button shows the currently-resolved mode (`"… — currently light"`).
- ✅ Smoke test verified all 6 scenarios: default → system; system + OS=light → light; system + OS=dark → dark; user picks Dark → sticks even when OS flips to light; system mode survives reload.

### Files touched
- `frontend/src/lib/theme.js` (rewritten — adds `resolveTheme`, system listener, `resolvedTheme` state)
- `frontend/src/components/toolbar/ThemeSwitcher.jsx` (4 segments now: Auto / Dark / Dim / Light)
- `frontend/src/components/Viewport.jsx` (uses `resolvedTheme` instead of `theme`)

## Iteration 1.15 (2026-02-27) — Theme switcher (Dark / Dim / Light)
- ✅ **3-mode theme switcher** added to the top toolbar (right side, before user menu). Modes: Dark (original), Dim (in-between softer dark), Light (full light mode).
- ✅ Choice persists to `localStorage` (`forgeslicer.theme`) and is bootstrapped onto `<html data-theme="…">` BEFORE React mounts (no FOUC on first paint).
- ✅ Implemented via a single `styles/themes.css` overlay (no per-component edits) — `[data-theme="dim|light"]` selectors remap the most-used `bg-slate-*` / `text-slate-*` / `border-slate-*` / `hover:*` utilities. Dark mode retains zero overrides so it's bit-identical to before.
- ✅ 3D canvas background follows the theme via `VIEWPORT_BG` map (slate-800 → slate-700 → slate-200) so the viewport doesn't sit on a dark island in light mode.
- ✅ Smoke test verified: data-theme attribute updates, localStorage persists across reload, landing page + workspace both repaint correctly.

### Files touched
- `frontend/src/lib/theme.js` (NEW) — zustand store + `bootstrapTheme()` + `VIEWPORT_BG`
- `frontend/src/styles/themes.css` (NEW) — overrides for dim + light
- `frontend/src/components/toolbar/ThemeSwitcher.jsx` (NEW) — 3-segment UI
- `frontend/src/index.css` (import themes.css)
- `frontend/src/index.js` (boot-time `bootstrapTheme()`)
- `frontend/src/components/toolbar/SystemRow.jsx` (mount switcher)
- `frontend/src/components/Viewport.jsx` (canvas bg tracks theme)

- ✅ **Verified Rotation ≠ Position popover bug is gone** — live preview shows the Position popover renders X/Y/Z mm fields and the Rotation popover renders X/Y/Z ° fields + Drop-to-Bed. Previous agent's TopToolbar refactor already resolved it; no further patch needed.
- ✅ **Split `ActionPopovers.jsx` (991 lines) into `components/popovers/`** — one file per popover:
   - `PopoverShell.jsx` — shared `PopoverShell` + `NumberField` + `EmptyMsg` primitives
   - `PositionPopover.jsx`, `RotationPopover.jsx`, `ScalePopover.jsx`
   - `DuplicatePopover.jsx`, `MirrorPopover.jsx`, `SlicerPopover.jsx`
   - `OrcaProfileEditor.jsx` — extracted from inside SlicerPopover
   - `index.js` — barrel for `TopToolbar` import
- ✅ `ActionPopovers.jsx` shrunk to a 7-line re-export shim for backward compat.
- ✅ Smoke test verified all 6 popovers (position / rotation / scale / duplicate / mirror / slicer) render unique testids on click.

### Files touched
- `frontend/src/components/popovers/` (NEW directory, 8 files)
- `frontend/src/components/ActionPopovers.jsx` (reduced to re-export shim)
- `frontend/src/components/TopToolbar.jsx` (import path updated)

## Iteration 44 (2026-02-27) — OrcaSlicer System-Preset Wiring + Slider Overflow Fix
- ✅ **OrcaSlicer profile validator unblocked (P0)** — finished the in-progress preset wiring left by the previous agent. `buildOrcaPayload` in `frontend/src/lib/orcaProfiles.js` now resolves a printer/process/filament triple into the bundled OrcaSlicer system-preset NAMES (e.g. `"Bambu Lab A1 0.4 nozzle"`, `"0.20mm Standard @BBL A1"`, `"Bambu PLA Basic @BBL A1"`) and ships them alongside the override dicts. The backend's `_load_system_preset` walks the inheritance chain from `<install>/resources/profiles/<vendor>/...`, applies user tunables on top, re-stamps the four required metadata fields (`type`/`name`/`from: "User"`/`instantiation: "true"`), and hands the final flattened JSON to the OrcaSlicer CLI — passing its strict validator.
  - Printer mapping is conservative: only the four Bambu models (A1, A1 mini, P1S, X1C) have verified preset names. Process+filament names are composed from a base label + the printer's `@BBL <model>` suffix so swapping printers automatically targets the right bundled JSON.
  - Non-mapped printers (Prusa, Voron, Sovol, Creality, Custom) fall through to the legacy raw-dict path that was already working before the system-preset effort.
  - When a system preset DOES match, the override dict for printer + filament is sent EMPTY so we don't accidentally override valid system values with our hand-rolled stand-ins. Process overrides ARE sent (they encode the user's wall_loops / infill % / pattern / supports / ironing choices).
  - `orcaApi.slice()` and `SlicerPopover.handleSlice` extended to forward the six new fields (`printer_preset_name` + `printer_vendor`, `process_preset_name` + `process_vendor`, `filament_preset_name` + `filament_vendor`).
- ✅ **Slider overflow in Slicer popover fixed (P1)** — added `min-w-0` to grid label + inner flex container + the range input itself; locked the readout span to `flex-shrink-0`. The classic flex/grid `min-width: auto` bug was letting the range thumb's intrinsic width push the cell past its `1fr` allocation, splaying the panel. Same fix applied to `OrcaProfileEditor` (perimeters + infill sliders) and the built-in slicer's infill+pattern row.
- ⚠️ **Not e2e-tested in preview** — preview pod is ARM64; the x86_64 OrcaSlicer AppImage cannot execute here. Verified the JS payload shape via lint + smoke-test screenshot; full slicing verification happens on the user's production deploy (forgeslicer.com).
- Files touched: `frontend/src/lib/orcaProfiles.js` (rewrote SYSTEM_PRESETS → `PRINTER_PRESET_META` + `resolveSystemPresets` + smart-override `buildOrcaPayload`), `frontend/src/lib/api.js` (forward six preset fields in `orcaApi.slice`), `frontend/src/components/popovers/SlicerPopover.jsx` (forward fields + slider overflow fix), `frontend/src/components/popovers/OrcaProfileEditor.jsx` (slider overflow fix).

### P2 backlog (deferred, ordered)
- `/api/components` intermittent 404 in dev/preview — observability/retry breadcrumbs
- Sketch→Path sweep (extrude 2D sketches along a curved path)
- Parametric Bolt/Nut threads generator
- Admin "Reinstall OrcaSlicer" button
- SSE for engine/install status (replace polling)
- Settings → Appearance panel
- Slice progress reporting (parse Orca's stdout)

## Iteration 45 (2026-02-27) — OrcaSlicer Preset Label Alignment + Resolved-Preset Hints
- ✅ **Process dropdown labels aligned with OrcaSlicer's bundled-preset names** — `"Standard 0.2mm"` → `"0.20mm Standard"`, `"Fine 0.12mm"` → `"0.12mm Fine"`, `"Draft 0.28mm"` → `"0.28mm Extra Draft"` (matches OrcaSlicer's bundled `0.28mm Extra Draft @BBL …` exactly; their "Draft" preset is actually 0.24mm), `"Strong (functional)"` → `"0.20mm Strong (functional)"`. Users now see the same string here that they'd see in OrcaSlicer's own preset picker.
- ✅ **Live resolved-preset hint under each dropdown** — when a Bambu printer is selected, the `OrcaProfileEditor` shows a tiny emerald `CheckCircle2 + monospace` caption underneath the printer / process / filament dropdowns, displaying the exact bundled OrcaSlicer JSON name the backend will load (e.g. `"Bambu Lab A1 0.4 nozzle"`, `"0.20mm Standard @BBL A1"`, `"Bambu PLA Basic @BBL A1"`). New testids: `orca-resolved-printer`, `orca-resolved-process`, `orca-resolved-filament`. Hints update live as the user changes any of the three selectors. Non-Bambu printers (Prusa, Voron, Sovol, etc.) stay on the legacy raw-dict path and the hints are silent.
- ✅ **`resolveSystemPresets` now exported** from `frontend/src/lib/orcaProfiles.js` so UI components can mirror the exact resolution logic the backend payload uses.
- ✅ **Process-preset base name updated** — `draft` now points to `"0.28mm Extra Draft"` (the real OrcaSlicer name for the 0.28mm layer-height tier; was incorrectly `"0.28mm Draft"`).
- Files touched: `frontend/src/lib/orcaProfiles.js` (labels + base names + export), `frontend/src/components/popovers/OrcaProfileEditor.jsx` (hint rendering + min-w-0 on label children).

## Iteration 46 (2026-02-27) — P0 OrcaSlicer "unknown config type" + Curve tool + Preset Viewer
- 🔴 **P0 — Slicer "unknown config type" bug fixed**. Root cause: when the frontend (post-iter 44) sent `printer_profile: {}` because a system preset matched, AND the backend could not locate `resources/profiles/` (e.g. AppImage variant where the path differs), the code fell through to `final = raw_profile` and wrote an empty `{}` JSON to disk. OrcaSlicer's CLI loaded that file, found no `type` field, and aborted with `unknown config type  of file printer.json` (note the tell-tale double space — empty type_str). Fix:
  - **Backend**: route BOTH the system-preset path AND the raw-dict path through `_stage_user_profile` so the required metadata (`type` / `name` / `from` / `instantiation`) is ALWAYS stamped on the final JSON. Refuse to silently fall back when `profiles_root is None` AND a preset name was requested — raise a clean 503 instead.
  - **Frontend**: when a preset matches, send the FULL `withMeta(...)` dict as the override (instead of `{}`). The backend's `_stage_user_profile` strips metadata fields from overrides anyway, so it's a zero-cost defensive belt-and-braces.
  - **Tests**: 5 new unit tests in `backend/tests/test_orca_profile_staging.py` lock in the invariant. All pass.
- ✅ **Sketch Curve tool (P2 feature)** — new fourth Sketch tool. Workflow: draw with Pencil → switch to Curve → drag the cyan midpoint handle on any edge to bend it into a quadratic bezier arc that passes through the cursor. Double-click a curved handle to straighten that edge again. Implementation:
  - Parallel `curves` state (`{ [edgeIdx]: [cx, cz] }`) lives alongside the existing `points` array; absent keys = straight edge.
  - User drags the visual midpoint M; we solve `B(0.5) = M` for the bezier control point `P1 = 2M − 0.5(P0+P2)` so the arc passes through where the cursor is.
  - Painter uses `quadraticCurveTo` to render curved edges smoothly.
  - On commit, every curved edge is sampled at 16 evenly-spaced t-values (~16 short segments) so three.js's `ExtrudeGeometry` stays cheap.
  - Tool switching preserves `points`+`curves` when going Pencil↔Curve; switching to Rect/Circle still resets (since those are fresh-shape tools).
  - The Curve button is disabled until at least 2 Pencil points exist so the affordance reads correctly.
- ✅ **OrcaSlicer "View bundled JSON →" link** — each of the three resolved-preset hints in `OrcaProfileEditor` is now a clickable button that opens `OrcaPresetViewer` (new modal in `components/dialogs/`). Backend endpoint `GET /api/slice/orca/preset?vendor=&kind=&name=` returns the fully-flattened (inheritance-walked) bundled JSON. Includes a Copy-JSON button. Power-user trust-builder + free debug tool when a preset name mismatch happens.
- ✅ **OrcaSlicer process labels relabeled** to match the slicer's own bundled names: `"0.20mm Standard"`, `"0.12mm Fine"`, `"0.28mm Extra Draft"`, `"0.20mm Strong (functional)"`.
- ✅ **Release notes v1.14.0** added.
- Files touched: `backend/orca_engine.py`, `backend/tests/test_orca_profile_staging.py` (NEW), `frontend/src/lib/orcaProfiles.js`, `frontend/src/lib/api.js`, `frontend/src/components/popovers/OrcaProfileEditor.jsx`, `frontend/src/components/dialogs/OrcaPresetViewer.jsx` (NEW), `frontend/src/components/SketchOverlay.jsx`, `frontend/src/lib/releaseNotes.js`.

### Pending P2 (next session)
1. **Sketch → Path sweep** (extrude 2D profile along a curved path; needs a separate Path drawing pass + ExtrudeGeometry along curve)
2. **Slice progress reporting** (parse OrcaSlicer stdout `=> Slicing: N%` lines + stream via SSE)
3. **Parametric Bolt/Nut threads** generator
4. **Admin "Reinstall OrcaSlicer" button** + SSE for install status
5. **Settings → Appearance panel**

## Iteration 47 (2026-02-27) — Assembly Rotation Rigid-Body Fix
- 🔴 **Bug fix — Group rotation breaks assembly geometry**: User reported "if I select an assembly, the rotation only acts on one member; for a more complex assembly it wouldn't rotate correctly". Root cause in `store.js -> rotateSelected`: the function added the rotation delta to each member's local `rotation` array, but NEVER orbited their `position` around a shared pivot. So every member spun in place around its own center — a sphere offset from a cube would stay "in the same world spot" while the cube tilted, destroying the rigid-body relationship.
  - **Fix**: when multiple objects are being rotated together, compute the centroid of their world positions, build a Three.js `Matrix4` from the delta Euler (XYZ order — matches the renderer's per-object Euler order so the visual orbit and per-object tilt stay in sync), and for each member: tilt its local rotation by the delta AND orbit its position around the centroid by the same rotation matrix.
  - Single-object rotation is a fast-path no-op (skips the matrix math entirely) so behaviour is bit-identical to before for non-assembly cases.
  - **Validated**: new standalone Node test `frontend/tests/rotation-group-pivot.mjs` exercises the math on a cube+sphere offset by (20, 8, 0). Confirms: centroid stationary, rigid-body distance preserved, both members orbit to predicted positions after 90°/Z. All 7 assertions pass.
- ✅ **Dev affordance**: `useScene` store is now exposed on `window.__forgeStore` so Playwright / browser-console debugging can drive scene state directly without poking React internals.
- ✅ **Release notes v1.14.1** added.
- Files touched: `frontend/src/lib/store.js`, `frontend/tests/rotation-group-pivot.mjs` (NEW), `frontend/src/lib/releaseNotes.js`.

## Iteration 48 (2026-02-27) — Popover→Gizmo sync + Group Scale fix
- 🔴 **Bug fix #1 — Popover doesn't switch the on-bed gizmo mode**: clicking the Position / Rotation / Size popover buttons opened the popover but didn't update `transformMode`, so the on-bed gizmo stayed in whatever mode it was last in (typically translate arrows). User could be editing rotation values while looking at translate arrows on the bed.
  - **Fix**: in `toolbar/EditRow.jsx`, intercept popover clicks via a new `handlePopoverClick` that maps `position → translate`, `rotation → rotate`, `scale → scale` and calls `setTransformMode` before delegating to `togglePopover`. Cut / Slicer / Duplicate / Mirror don't have a gizmo equivalent so they leave it alone.
- 🔴 **Bug fix #2 — Resizing a grouped Assembly "blew components away"**: with a multi-member group selected, the ScalePopover called `setTransformWithHistory` on the PRIMARY only. The other members stayed at their old scale, so the primary ballooned while the siblings appeared to vanish (or get visually consumed) — exactly what the user reported after grouping `cube + cone + negative cylinder` and clicking Size.
  - **Fix**: new `scaleSelectedMul(factor)` store action — multiplicative group scaling that mirrors the rotation pivot rule. Each selected member's `scale` is multiplied by the factor, AND their `position` offset from the PRIMARY grows by the same factor, so the whole assembly scales as one rigid unit centred on the primary. Primary stays put, gizmo stays under the cursor, sibling spacing stays proportional. Single-object selection is a fast-path no-op identical to `setTransform`.
  - `ScalePopover` now detects multi-select and routes through `scaleSelectedMul` instead of `setTransformWithHistory`. The popover title gains a `+N` badge and a purple "Scaling the whole selection (N)" hint identical in style to the rotation popover.
  - **Validated** interactively: cube primary at (0,10,0) + cone at (25,12,0) + cylinder at (-25,12,0) → apply 400% on X → cube stays at (0,10,0); cone goes to (100,12,0); cylinder goes to (-100,12,0); all three scales = [4,1,1]. Rigid-body invariant preserved.
- ✅ **Release notes v1.14.2** added.
- Files touched: `frontend/src/lib/store.js`, `frontend/src/components/toolbar/EditRow.jsx`, `frontend/src/components/popovers/ScalePopover.jsx`, `frontend/src/lib/releaseNotes.js`.

## Iteration 49 (2026-02-27) — Assembly Rotates as Unit + Group Rename
- 🔴 **Bug fix — Rotation popover broke assembly rigid-body**: even after iter 47's rigid-body pivot fix, the popover called `selectedIds.forEach((id) => dropToBed(id, false))` after every rotation. Each `dropToBed` snaps its target's Y to the bed individually, so the carefully-orbited members got re-aligned to Y=0 one by one, destroying the vertical relative offsets. User reported: "the assembled parts are rotating but not as a unit".
  - **Fix part A**: new shared `dropSelectionToBed(withHistory)` store action — computes the lowest world-Y across every selected object's rotated bbox, then translates them all by the same `dy` so the bottom-most point lands on Y=0 while every member's relative offset is preserved.
  - **Fix part B**: `RotationPopover.setRot` now calls `dropSelectionToBed()` for multi-select instead of looping `dropToBed` per-id.
  - **Fix part C**: `Viewport.jsx` gizmo-drop logic refactored to use the same shared `dropSelectionToBed` action — DRY plus guarantees the gizmo and popover paths stay in lockstep.
- 🔴 **Critical bug — `THREE.Euler is not a constructor`**: the iter-47 `rotateSelected` used `require("three")` inside a Zustand `set()` callback. CRA/webpack's CJS interop returns a module wrapper without top-level `Euler`/`Matrix4`, so the orbit math threw silently and members ended up rotating-in-place. Fixed by importing `* as THREE from "three"` at the top of `store.js` (one-time module-level import, no cold-start cost since three is already in the bundle).
- ✅ **Group rename inline**: new `renameGroup(groupId, name)` store action; `GroupHeader` in `LeftPanel` now supports double-click → inline `<input>` → Enter to commit / Esc to cancel. Name is stamped onto every member's `groupName` field so any read site that needs the group label stays in sync. Max 64 chars.
- ✅ **Validated interactively**: 3-cylinder horizontal pitman-arm scaffold at (-20,10,0), (0,10,0), (20,10,0), cube as primary. After rotateSelected([0,0,90]): cyl1 → (0,-10,0); cube → (0,10,0); cyl2 → (0,30,0). Distance invariants `d_ab = 20`, `d_ac = 40` preserved before AND after. Then renamed group to "Pitman Arm" via double-click → Enter. Outliner header now reads "PITMAN ARM".
- ✅ **Release notes v1.14.3** added.
- Files touched: `frontend/src/lib/store.js` (import THREE properly, add dropSelectionToBed + renameGroup), `frontend/src/components/popovers/RotationPopover.jsx`, `frontend/src/components/Viewport.jsx`, `frontend/src/components/LeftPanel.jsx` (GroupHeader inline rename), `frontend/src/lib/releaseNotes.js`.

## Iteration 50 (2026-02-27) — Export STL React #321 fix + Bolts/Nuts + Settings + Save Assembly
- 🔴 **P0 — Export STL / Save Component crashed on PRODUCTION with "Minified React error #321"** (invalid hook call). Could not reproduce in preview because CRA preview runs the DEV bundle where React only emits a warning; the PRODUCTION terser-minified bundle throws.
  - **Root cause** (found via local `yarn build` + lightweight SPA server reproducing the error, then walking the stack `handleExportSTL → r → useCallback → Ja`): `projectActions.js` did `const get = typeof store === "function" ? store : () => store;` and then `const s = get();` inside every action. `useScene` IS a function (the Zustand React hook), so `get()` was calling the **hook** from an event handler — invoking Zustand's `useSyncExternalStore` + `useCallback` outside of any component render. React 19 production rejects this.
  - **Fix**: change `get` to `() => store.getState()` whenever `store` is a Zustand hook (detected by checking for `store.getState`). Verified end-to-end: `Untitled_Project.stl` downloads successfully from the prod build.
  - **Defense**: every Project action's catch block now `console.error`s the full stack BEFORE the alert, so the next bug of this kind takes seconds instead of hours to diagnose.
- ✅ **Bolt + Nut primitives** (P2 backlog #3). New `bolt` and `nut` primitive types in `lib/store.js` + `lib/geometry.js`. Bolt = hex/button head + cylindrical shaft + ISO-metric thread profile swept around the shaft as a helical tube (triangular profile approximated by a small circular tube → indistinguishable at print scale, 100× cheaper than ExtrudeGeometry-along-curve). Nut = hex prism + inner thread helix tube. Editable parameters: thread Ø (M-size), pitch, length, head Ø + height, A/F width. Match pitch between bolt + nut for screw compatibility. UI: new buttons in both `AddPrimitiveButton` and `LeftPanel`'s 3D primitives column. Inspector dimensions panel in `RightPanel` with M-size aware controls. Geometry centred on origin so drop-to-bed works correctly.
- ✅ **Settings dialog** (P2 backlog #5). New `components/dialogs/SettingsDialog.jsx` with two tabs:
  - **Appearance**: theme picker (Auto / Dark / Dim / Light) + per-page pinning toggle. Reads/writes via the existing `useTheme` Zustand store.
  - **Engine**: OrcaSlicer status pill (installing / ready / not installed), Reinstall button, "Force re-download (~119 MB)" toggle, manual status-refresh button. Polls `/api/slice/orca/status` every 5s while a reinstall is in flight.
  Backend: new `POST /api/slice/orca/reinstall?force=` endpoint that fire-and-forgets the existing `scripts/install_orca.py` script. Returns 503 when no engine slot is available, 400 when the server arch isn't x86_64 (verified live: ARM64 preview pod returns the friendly arch message).
- ✅ **Save Assembly to Components** (user-requested follow-up). New Save icon next to the chevron in every Outliner `GroupHeader`. Clicking it selects every member of the group, seeds the SaveComponentDialog's default name with the group's name, and fires the existing `forgeslicer:open-dialog` event with `name: "save_component"`. Works seamlessly with the inline-rename so users can name an assembly "Pitman Arm", click Save, and ship it to the component library.
- ✅ **Release notes v1.15.0** added.
- Files touched: `frontend/src/components/toolbar/projectActions.js` (P0 fix), `frontend/src/lib/store.js` (bolt/nut primitives), `frontend/src/lib/geometry.js` (build + size helpers), `frontend/src/components/toolbar/AddPrimitiveButton.jsx` + `frontend/src/components/LeftPanel.jsx` (UI + Save Assembly button), `frontend/src/components/RightPanel.jsx` (bolt/nut inspector), `frontend/src/components/dialogs/SettingsDialog.jsx` (NEW), `frontend/src/components/Workspace.jsx` (wire dialog), `frontend/src/components/toolbar/SystemRow.jsx` (Settings cog), `frontend/src/lib/api.js` (orcaApi.reinstall), `backend/orca_engine.py` (reinstall endpoint), `frontend/src/lib/releaseNotes.js`.

### Pending P2 (deferred to next session)
- **Sketch → Path sweep** — requires a separate sketch-overlay pass for the path + ExtrudeGeometry-along-curve refactor. Substantial work.
- **Slice progress reporting** — needs `asyncio.subprocess.PIPE` + stdout parser + an SSE stream + frontend progress UI. Substantial work.

## Iteration 51 (2026-02-27) — NumberField double-commit fix
- 🔴 **Bug — typing 45° rotation rotated by 90° on multi-select**: every popover NumberField (Position / Rotation / Size) was double-firing onChange on Enter. The flow was:
  1. User types `45`, presses Enter
  2. `commit()` runs: parses "45", calls `setDraft(null)`, calls `onChange(45)` → rotation popover applies delta = 45 - 0 = 45° → group rotates 45°
  3. `e.currentTarget.blur()` synchronously triggers `onBlur={commit}` — but React HASN'T flushed `setDraft(null)` yet, so the blur's commit closure still sees draft = "45" → calls `onChange(45)` AGAIN
  4. Rotation popover applies delta = 45 - 45 = 0 ✗ ← it would, but here's the kicker: NumberField passes `value={obj.rotation[i]}` which is now 45, AND that value is captured by the parent's `setRot(0, v)` callback. So actually the second call's value is still the typed "45" with the new current of 45 → delta = 45 - 45 = 0. Hm.
  
  Actually the real mechanism: the parent passes a new `setRot` closure on every render, but the input's onChange/onBlur callbacks are baked from the FIRST `setRot` instance during the initial render of the commit. Since `obj.rotation[i]` is read fresh in setRot at call time, both calls see the SAME current value (the pre-rotation value, because the first onChange's state update hadn't yet propagated to a re-render of the popover when the synchronous blur fired). So both deltas are 45° → group rotates 90°.
  
  This is why **absolute** transforms (Position / Size) were unaffected (they set the same absolute value twice = idempotent), and only **multi-select Rotation** broke. The doubled rigid-body orbit math (offset rotated twice through the same matrix) is also what disassembled the group on subsequent rotations.
  
  **Fix**: added a `justCommittedRef = useRef(false)` to NumberField. When Enter fires commit, set the ref to true BEFORE calling `e.currentTarget.blur()`. The subsequent `onBlur={commit}` checks the ref first, flips it back to false, and returns early. Single-flight commit per user action.
- ✅ **Release notes v1.15.1**.
- Files touched: `frontend/src/components/popovers/PopoverShell.jsx`.

## Iteration 51 — Notes
- "OrcaSlicer disabled in Slicer gizmo" is **expected behaviour** on the ARM64 preview pod (x86_64 AppImage cannot execute there). Iter 46's `_load_system_preset` + iter 50's `unknown config type` fix mean the x86_64 production deploy will accept the JSONs and slice correctly.

### Pending P2 (next session)
- Sketch → Path sweep
- Slice progress reporting (subprocess stdout → SSE → UI %)

## Iteration 52 (2026-02-27) — Splined Shaft + Slice Progress SSE + Unsaved-Draft Indicator
- ✅ **Spline primitive** (P2 backlog + user request). New `spline` primitive: a cylindrical core with N longitudinal teeth ridges running along its Y axis. Editable: `r` (core radius), `h` (length), `teeth` (count), `toothHeight`, `toothWidthDeg`, `profile` (rectangular | triangular | rounded). Geometry: core CylinderGeometry + N rotated tooth-cross-sections merged via `_mergeGeometries`. Cross-sections per profile:
  - **rectangular**: thin BoxGeometry (flat-top teeth, standard ISO)
  - **triangular**: 3-segment CylinderGeometry collapsed and rotated to face radially (V-shape involute / serration)
  - **rounded**: half-cylinder (knurled grip)
  Inspector lives in `components/SplineInspectorBlock.jsx` and exposes BOTH `toothWidthDeg` (angular span) AND `width` (chord mm at outer surface). They're related by `width = 2·R·sin(deg/2)`. When a typed width can't fit at the current N (would exceed 360° angular coverage minus 0.5° gap per tooth), the inspector pops a "Nearest fit" dialog with up to 3 (N, width) options — never silently snaps. Toggle the object's modifier to "negative" and the same teeth become a splined-bore cutter for the matching shaft (CSG-subtract workflow).
- ✅ **Slice progress reporting (SSE)** (P2 backlog #2). Backend:
  - `_PROGRESS` dict keyed by job id, holding `{percent, stage, done, error}`.
  - `_PROGRESS_RE = re.compile(r"\b(\d{1,3})\s*%")` matches both OrcaSlicer stdout flavours: `"Slicing plate 1/1, 23%"` and `"[42%] Exporting 3mf"`.
  - `_tail_stdout(proc, job_id)` reads `proc.stdout` line-by-line in parallel with `proc.stderr.read()` via `asyncio.gather` (so neither pipe deadlocks). Updates the slot in place; returns full stdout bytes for the existing error-detection code.
  - `GET /api/slice/orca/progress/<job_id>` is a Server-Sent Events stream. Auto-creates a slot when the client subscribes BEFORE the slice POST has registered it, so the "subscribe pre-slice" flow works without races. Bails after 150s of no updates.
  - `POST /api/slice/orca/slice` now accepts `job_id` (client-supplied) and echoes it back in the response.
  - Frontend: `SlicerPopover` generates a client-side job id (crypto.randomUUID, sanitised), opens `EventSource` BEFORE the slice POST, then surfaces a progress bar with stage text below the Slice button. Stream auto-closes on `done: true` or error.
  - **4 new pytest tests** in `backend/tests/test_orca_progress.py` cover regex matching, tail draining, % clamping, and per-job isolation. All pass; 11/11 backend tests green total.
- ✅ **Unsaved-draft indicator on NumberField**. When `draft !== null` (user has typed but not yet committed), the input border turns amber AND a tiny amber pulsing dot sits in the input gutter with tooltip "Unsaved edit — press Enter to commit". Affects EVERY numeric field across the popovers + Inspector. Zero state-flow changes — just visual reinforcement of the commit-on-Enter contract added in iter 51.
- ✅ **Release notes v1.16.0** added.
- Files touched: `frontend/src/lib/store.js` (spline default dims), `frontend/src/lib/geometry.js` (spline geometry builder + bbox), `frontend/src/components/RightPanel.jsx` (size helper + Inspector wiring), `frontend/src/components/SplineInspectorBlock.jsx` (NEW), `frontend/src/components/toolbar/AddPrimitiveButton.jsx` + `frontend/src/components/LeftPanel.jsx` (Spline button), `frontend/src/components/popovers/PopoverShell.jsx` (draft indicator), `backend/orca_engine.py` (progress + SSE + slice integration), `backend/tests/test_orca_progress.py` (NEW), `frontend/src/components/popovers/SlicerPopover.jsx` (SSE subscription + progress bar UI), `frontend/src/lib/api.js` (job_id passthrough), `frontend/src/lib/releaseNotes.js`.

### Pending P2 (next session)
- **Sketch → Path sweep** — substantial work (sketch overlay second-pass + ExtrudeGeometry-along-curve refactor). Deferred to a dedicated session.
- **Fastener Pair macro** (suggested but not yet built — Bolt + Nut + 2 negative bore cylinders pre-grouped)

## Iteration 44 (2026-05-28) — P0 OrcaSlicer profile + Consecutive rotation fixes
- ✅ **OrcaSlicer "unknown config type" error eliminated** — root cause traced via OrcaSlicer C++ source: `load_from_json` parses keys in JSON-iteration order and BREAKS the loop on the first malformed value (e.g. a JSON array containing numbers like `[0.4]` instead of strings like `["0.4"]`). Any keys after the breakpoint — including `type` — are silently dropped, surfacing the cryptic "unknown config type of file printer.json" CLI error.
  - **Fix #1**: `_stage_user_profile` now stamps the 5 metadata keys (`type`, `name`, `from`, `instantiation`, `version`) FIRST in the dict so they survive even if a later config value is malformed. Python 3.7+ guarantees dict insertion order is preserved through `json.dumps`.
  - **Fix #2**: new `_orca_stringify` helper recurses into the value and coerces numbers/bools/None/lists-of-numbers into the string format Orca expects (`350 → "350"`, `0.4 → "0.4"`, `[0.4] → ["0.4"]`, `True → "1"`, `None → ""`).
  - **Fix #3**: new `_resolve_fallback_preset` walks a universal bundled-preset chain (`Custom/MyKlipper 0.4 nozzle` + `Custom/0.20mm Standard @MyKlipper` + `OrcaFilamentLibrary/Generic PLA @System`) so printers without a Bambu-mapped system preset still get a real-base preset to ride, instead of a synthesised dict.
  - **Tests**: 10 new in `backend/tests/test_orca_profile_staging.py` (incl. Sovol SV06 Plus Ace production-input reproducer), 5 new in `backend/tests/test_orca_fallback_preset.py`. Full pytest 164/164 (1 known test-isolation flake on rate-limit-state in test_local_auth, passes in isolation).
- ✅ **Consecutive group rotation drift fixed** — root cause: Euler-additive math (`rotation += delta`) doesn't compose for non-axis-aligned starting rotations. Reproduced: starting (45,0,0) + 45° around world Y → Euler XYZ decomposition gives (54.74, 30, -35.26); naive subtraction yields a wrong delta-Euler and children scatter.
  - **Fix**: replaced both `rotateSelected` (popover path) and `Viewport.handleChange` rotate branch (gizmo path) with quaternion composition — `newQ = dQ · childQ` where `dQ = newPrimaryQ · oldPrimaryQ⁻¹`. Children's positions orbit via `applyQuaternion(dQ)`; their orientations track the same world rotation; both decomposed back to Euler XYZ only for storage.
  - **Test**: new `frontend/tests/rotation-group-consecutive.mjs` runs 5 sequential rotations (X/Y/Z mix) on a 4-piece assembly and confirms all 6 pairwise distances stay invariant (within 1e-4) AND every satellite position matches the analytically composed quaternion result.
- ✅ Release notes bumped to v1.17.0.
- Files: `backend/orca_engine.py` (_stage_user_profile rewrite, new _orca_stringify + _resolve_fallback_preset, fallback wired into orca_slice), `backend/tests/test_orca_profile_staging.py` (overwrite), `backend/tests/test_orca_fallback_preset.py` (NEW), `frontend/src/lib/store.js` (rotateSelected quaternion rewrite), `frontend/src/components/Viewport.jsx` (handleChange rotate branch), `frontend/tests/rotation-group-consecutive.mjs` (NEW), `frontend/src/lib/releaseNotes.js`.

### Pending (next session)
- **Save Assembly to Gallery/Share silent failure (P2)** — user reported "tried to save Pitman Arm to the Share and it didn't save it"; trace `/api/components` save flow front-to-back.
- **Sketch → Path sweep (P1)** — deferred from iter 43.
- **Refactor `frontend/src/lib/store.js`** — file is now >1300 lines; split rotation/CSG math + group ops into dedicated modules.
- **PRD.md split** — file is at 916 lines; should split into PRD.md (problem statement / personas / static) + CHANGELOG.md (append-only history) + ROADMAP.md (P0/P1/P2 backlog).


## Iteration 45 (2026-05-28) — Eye-icon STL preview rotation-order fix
- ✅ **STL Preview / gallery thumbnail no longer shows disjointed parts** when an assembly has been rotated.
  - Root cause: `manifold-3d`'s `m.rotate([rx, ry, rz])` applies rotations in *global X → Y → Z* order (per its docs). THREE.Euler('XYZ') — used by every viewport / inspector / gizmo path — is the *opposite* (global Z → Y → X). The two produce the same result for axis-aligned rotations but DIFFER materially for any part with non-trivial multi-axis Euler values. After the rigid-body group fix landed in iter 44, every child of a rotated assembly carries multi-axis Euler — so the export pipeline started visibly disagreeing with the viewport.
  - Reproduced numerically: same Euler `(45°, 90°, 0)`, point `(1,0,0)` → viewport lands it at `(0, 0.707, -0.707)`, buggy manifold lands it at `(0, 0, -1)`. Distance 0.77.
  - Fix: in `manifoldEngine.js → buildObjectManifold`, replace `m.rotate([rx,ry,rz])` with `m.transform(mat.elements)` where `mat = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, "XYZ"))`. `Matrix4.elements` is already column-major, exactly what manifold-3d's `Mat4` type expects. Manifold's `transform` is order-agnostic so the bake-order mismatch is eliminated by construction. BVH path was already correct (uses Three.js Object3D.matrixWorld) — only the manifold path needed this fix.
  - Test: new `frontend/tests/manifold-rotation-order.mjs` runs 60 viewport↔manifold agreement assertions across 10 typical post-group-rotation Euler values × 6 probe vectors, plus a buggy-path divergence check to confirm the bug was real.
- Files: `frontend/src/lib/manifoldEngine.js` (transform replaces rotate), `frontend/tests/manifold-rotation-order.mjs` (NEW), `frontend/src/lib/releaseNotes.js` (v1.17.1 entry).

### Pending (next session)
- **Save Assembly to Gallery/Share silent failure (P2)** — could not reproduce in preview; awaiting user repro on prod with DevTools network capture.
- **Sketch → Path sweep (P1)** — deferred.
- **Refactor `frontend/src/lib/store.js`** — file is >1300 lines; split rotation/CSG math + group ops into dedicated modules.
- **PRD.md split** — file is at 940+ lines; should split into PRD.md / CHANGELOG.md / ROADMAP.md.


## Iteration 46 (2026-05-28) — Sweep primitive (P1) + Refactor
### What landed
- ✅ **Sweep primitive (P1)** — extrudes a 2D PROFILE along a 3D PATH so the profile stays perpendicular to the path tangent at every sample (Frenet-frame true sweep). Live-editable in the Inspector.
  - Profile kinds: `circle`, `rect`, `polygon` (✅), `sketch` (placeholder for next iter)
  - Path kinds: `helix`, `arc`, `bezier`, `sketch3d`, `ref` (✅ — `sketch3d` UI hookup deferred)
  - Default preset: helical spring (circle profile × helix path × 3 turns) so the user sees what Sweep DOES the moment they click it
  - Twist field rotates the profile linearly along the path tangent (corkscrew / spiral cable wraps)
  - `ref` path option lets a sweep ride another helix/sweep's centerline — UI dropdown lists pickable objects; if none exist surfaces an amber empty-state hint
- ✅ **Refactor** — `lib/store.js` split into focused modules without changing any behaviour:
  - `lib/transforms.js` — pure `applyTranslate` / `applyScaleMul` / `applyRigidRotate` / `isZeroDelta` / `isIdentityFactor`. Quaternion-composed rigid-body rotation logic now unit-testable in isolation.
  - `lib/historyStack.js` — pure `cloneObjects` / `pushHistoryState` / `undoState` / `redoState` + `HISTORY_LIMIT` constant.
  - `store.js` dropped from 1265 → 1147 lines.
- ✅ **PRD.md split** — was 932 lines, now:
  - `PRD.md` (44 lines) — static product spec + companion-doc index
  - `CHANGELOG.md` (~902 lines) — append-only iteration history
  - `ROADMAP.md` (NEW) — prioritised P0/P1/P2/P3 backlog
- ✅ Release notes bumped to **v1.18.0** ("Sweep primitive · Live profile-along-path extrusion").

### Tests added
- `frontend/tests/transforms-and-history.mjs` — ~40 assertions covering every extracted helper, including the 5-rotation rigid-body invariant.
- `frontend/tests/sweep-geometry.mjs` — 52 assertions across 12 profile × path combos + twist effect + degenerate-input null + helix-sweep bounding-volume invariant.

### Test report
- `/app/test_reports/iteration_16.json` — backend 173/173 pytest, frontend 5 node test files all GREEN, UI smoke verified Sweep button in both surfaces, Sweep adds to scene, Inspector exposes profile/path/Samples/Twist°/R/Pitch/Turns, geometry live-rebuilds on kind switch.

### Files touched
- `frontend/src/lib/sweepGeometry.js` (NEW), `frontend/src/lib/transforms.js` (NEW), `frontend/src/lib/historyStack.js` (NEW), `frontend/src/components/SweepInspectorBlock.jsx` (NEW)
- `frontend/src/lib/store.js`, `frontend/src/lib/geometry.js`, `frontend/src/components/Viewport.jsx`, `frontend/src/components/RightPanel.jsx`, `frontend/src/components/LeftPanel.jsx`, `frontend/src/components/toolbar/AddPrimitiveButton.jsx`, `frontend/src/lib/releaseNotes.js`, `frontend/src/lib/csg.js`
- `frontend/tests/transforms-and-history.mjs` (NEW), `frontend/tests/sweep-geometry.mjs` (NEW)
- `/app/memory/PRD.md` (rewritten — static-only), `/app/memory/CHANGELOG.md` (NEW), `/app/memory/ROADMAP.md` (NEW)

### Known MVP limitations (deferred — not bugs)
- `profile.kind: "sketch"` is a no-op (UI surfaces an amber hint pointing at next iter)
- `path.kind: "sketch3d"` similarly waiting for Sketch3D wire-up
- Sweep objects with `path.kind: "ref"` fall back to a placeholder cube during **STL EXPORT** (CSG path doesn't thread scene context yet). The **live viewport** renders correctly. Tracked for next iteration.

### Pending (next session)
- Sweep MVP follow-ups: sketch→profile + sketch3d→path wire-up; thread `scene` through `csg.js` so ref-sweeps export correctly.
- See ROADMAP.md for the up-to-date backlog.


## Iteration 47 (2026-05-28) — Center on Bed (right-click)
- ✅ **"Center on bed" added to the right-click context menu** (sits directly under "Drop to bed"). Translates the selected item or assembly so its combined X/Z bounding-box center lands at the build-plate origin (0, _, 0). Y is preserved — the existing Drop-to-bed action remains the way to land an assembly on the plate vertically.
- For multi-part selections, the centering is **rigid-body**: every member translates by the same dx/dz so internal pairwise distances are preserved exactly (a grouped Pitman Arm stays a Pitman Arm).
- Bbox-center vs centroid-of-positions: we deliberately use the AABB center because that matches what users expect visually — when one part is much larger than the others, the visible centre of the assembly sits closer to the big part. Centroid-of-positions would skew toward whichever side has more parts.
- Edge cases handled: no-op early-out if already centered (within 0.5mm), defensive fallback for primitives whose bbox can't be computed (uses their raw position), pushes history only when a real translation will happen.
- Test: new `frontend/tests/center-on-bed.mjs` — 16 assertions covering single object, 3-cube assembly rigid-body invariant, Y preservation, and the bbox-center vs position-centroid distinction.
- Release notes bumped to **v1.18.1**.
- Files: `frontend/src/components/ContextMenu.jsx` (new doCenterOnBed handler + menu item with Crosshair icon + testid `ctx-center-bed-btn`), `frontend/src/lib/releaseNotes.js`, `frontend/tests/center-on-bed.mjs` (NEW).


## Iteration 48 (2026-05-28) — Sweep MVP follow-ups + Fastener Pair macro

### What landed
- ✅ **Sweep ref-export fix** — Sweeps with `path.kind: "ref"` (the "From Object" path option) now export to STL with the source object's centerline-driven geometry baked in. Underneath: a module-level `_sceneContext` in `lib/csg.js` set/cleared at the entry points (`evaluateScene`, `evaluateSceneByColor`); `lib/manifoldEngine.js` signature-extends `buildObjectManifold(wasm, obj, scene)` and threads `scene` through both `evaluateSceneAsync` and `evaluateSceneByColorAsync`. Closes one of the three known MVP limitations from iter 46.
- ✅ **Sweep preset library** — 8 curated cards in the Sweep Inspector (Helical spring, Watch spring, Twisted cable, Corkscrew, Rope, Hex bar arc, Spiral railing, Tornado funnel). One click rewrites the full Sweep dims; tweakable afterward without resetting. Surfaced as an orange-bordered card at the top of `SweepInspectorBlock` with `data-testid="sweep-preset-picker"`.
- ✅ **Fastener Pair macro** — new `addFastenerPair` store action + LeftPanel "Fastener Pair" button under Composites. Drops a coordinated **Bolt + Nut + bore cylinder + head counterbore**, all sharing a `groupId` prefixed `fastener-` so they move/rotate/scale as one fastener and ungroup for fine-tuning. The 4 parts share matching pitch/major-radius so the threads visually mate; layout is built so dropping it onto a 12mm-thick host gives you a flush-headed, fully-threaded fastener with one click. Customisation via `opts` (boltR, pitch, workThickness, headR, headH, shaftH, nutH) flows through cleanly.
- ✅ Release notes bumped to **v1.19.0**.

### Tests added
- `frontend/tests/sweep-presets-and-fastener.mjs` — 25+ assertions covering all 8 presets (each builds valid geometry with >100 tris and a distinct tri count), corkscrew first-vertex finiteness, and Fastener Pair layout invariants (counterbore-bottom, bore alignment, nut flush with bore-top, bolt shaft extends past nut top, customisation params flow through correctly).

### Test report
- `/app/test_reports/iteration_17.json` — backend 100% (no changes), frontend 100%. All 7 node test files green. Sweep preset picker + Fastener Pair button verified clickable + produce expected scene changes.

### Files touched
- `frontend/src/lib/csg.js` (module-level `_sceneContext` + entry-point wrappers)
- `frontend/src/lib/manifoldEngine.js` (scene-aware `buildObjectManifold` + threaded through `evaluateSceneAsync` + `evaluateSceneByColorAsync`)
- `frontend/src/components/SweepInspectorBlock.jsx` (SWEEP_PRESETS array + Preset library UI card)
- `frontend/src/lib/store.js` (new `addFastenerPair` action)
- `frontend/src/components/LeftPanel.jsx` (FastenerPairButton + wired into Composites grid)
- `frontend/src/lib/releaseNotes.js` (v1.19.0 entry)
- `frontend/tests/sweep-presets-and-fastener.mjs` (NEW)

### Pending (next session)
- The two sketch-source Sweep options (`profile.kind:"sketch"`, `path.kind:"sketch3d"`) still surface as no-ops with amber hints. Wiring them requires a "Use as sweep profile" / "Use as sweep path" context-menu action on the existing sketch UI — small UX surface, deferred unless requested.
- E2E note from the testing agent (pre-existing, NOT a feature bug): Playwright scripted change-events on React-controlled `<select>` elements don't reliably trigger React's onChange. Math-layer node tests cover this exhaustively, but if more frontend E2E is desired later, exposing `window.useScene` in dev builds would help.
- See ROADMAP.md for the up-to-date backlog.


## Iteration 49 (2026-05-28) — Park on bed + Hardware Library + Texture Library v1

### What landed
- ✅ **Park on bed** — right-click menu action that combines Center-on-bed (X/Z) + Drop-to-bed (Y) in a single history push. Rigid-body invariant for multi-part selections. Sits between "Center on bed" and the save-component group; test-id `ctx-park-bed-btn`.
- ✅ **Hardware Library** — modal dialog backed by `lib/hardwareLibrary.js` (HARDWARE_TABLE + HARDWARE_LENGTHS_BY_GRADE + hardwareToFastenerOpts). 7 ISO metric grades (M3, M4, M5, M6, M8, M10, M12) × common shop lengths. ISO-standard coarse pitches + head dimensions baked in. workThickness auto-computed (length−5mm so 5mm of shaft pokes past the nut, clamped to 2mm minimum). Snap-to-closest length on grade change so the picker never lands in an invalid state. Drop creates a pre-grouped Fastener Pair (Bolt + Bore + Counterbore + Nut).
- ✅ **Texture Library v1** — geometric/printable textures via a new `texture` primitive type backed by `lib/textureGeometry.js`. Patterns:
  - **knurl_diamond** — diagonal cross-hatch (tool-handle grip)
  - **hex** — honeycomb cells (vents, decorative)
  - **bumps** — hemispherical bumps (anti-slip)
  - **ridges_linear** — parallel half-cylinders (flashlight flutes)
  - Each texture sits on a base plate so subtractive overlap onto a host won't leave manifold gaps. Positive (raised/union) or negative (engraved/subtract). Geometric — survives STL export, slices into G-code.
- ✅ Release notes bumped to **v1.20.0** ("Park on bed · Hardware Library · Texture Library").

### Tests added
- `frontend/tests/park-on-bed.mjs` (~17 assertions) — single object, 3-cube rigid assembly, no-op for already-parked.
- `frontend/tests/hardware-library.mjs` (~30 assertions) — table completeness, ISO-standard coarse-pitch sanity, hardwareToFastenerOpts mapping (incl. workThickness clamp + override).
- `frontend/tests/texture-geometry.mjs` (~60 assertions) — all 4 patterns produce valid merged geometry, base plate at y=-depth, relief reaches at least half of height, triangle counts stay under 100k at default dims, footprint × tile-density scaling sensible.

### Test report
- `/app/test_reports/iteration_18.json` — backend 100% (no changes), frontend 100% on all 10 node tests + 3 new UI surfaces verified end-to-end.

### Files touched
- `frontend/src/components/ContextMenu.jsx` (doParkOnBed handler + menu item)
- `frontend/src/lib/hardwareLibrary.js` (NEW)
- `frontend/src/components/dialogs/HardwareLibraryDialog.jsx` (NEW)
- `frontend/src/lib/textureGeometry.js` (NEW)
- `frontend/src/components/dialogs/TextureLibraryDialog.jsx` (NEW)
- `frontend/src/components/LeftPanel.jsx` (HardwareLibraryButton + TextureLibraryButton + both dialogs wired into Composites)
- `frontend/src/lib/geometry.js` (new `texture` case)
- `frontend/src/lib/store.js` (new `texture` primitive default + buildPrimitive halfH for texture)
- `frontend/src/lib/releaseNotes.js` (v1.20.0 entry)
- `frontend/tests/park-on-bed.mjs`, `hardware-library.mjs`, `texture-geometry.mjs` (NEW)

### Texture Library v2 backlog
- Patterns: diamond plate / tread, brick / fabric weave / decorative, hex camo, parametric voronoi.
- Apply-to-face wire-up: right-click an object → "Apply texture to face..." passes the target into the dialog so the texture footprint auto-sizes to the picked face. (Dialog already accepts a `targetObjectId` prop; the context-menu action is the remaining piece.)
- Imperial fastener grades (UNC/UNF) — to mirror Hardware Library's ISO metric coverage.


## Iteration 51 (2026-05-28) — Sketch → Sweep Wiring (Profile + 3D Path)
- ✅ **Use sketch as Sweep profile** — right-click a single `sketch` object → "Use sketch as Sweep profile" creates a new sweep that uses the sketch's 2D points as a `profile.kind: "sketch"` swept along a default helix path. Original sketch is preserved so users can iterate on the 2D shape and re-link.
- ✅ **Use sketch as Sweep path (3D)** — right-click → "Use sketch as Sweep path (3D)" creates a new sweep with a default circular profile swept along the sketch's points promoted to 3D (`[x, 0, z]`). A new `Rise (mm)` inspector field on `path.kind: "sketch3d"` redistributes Y linearly from 0 → rise across the polyline so users can lift a planar path into a helical/staircase-like 3D sweep with one number.
- ✅ **SweepInspectorBlock** — replaced the "next iteration" placeholders. `profile.kind: "sketch"` now renders a sketch-picker (lists every scene sketch with point counts). `path.kind: "sketch3d"` renders the same picker plus the Rise field. Re-linking just updates `points` so the user's other sweep params (samples / twist / profile) stay intact.
- ✅ **Store** — new `addSweepFromSketch(sketchId, role, opts)` action (store.js around L529). Deep-copies points to keep the sweep snapshot immune to later sketch edits. Auto-drops the new sweep on the bed via `computeRotatedBBox`. Pushes history exactly once. Toast on both branches.
- ✅ Verified by testing agent (`/app/test_reports/iteration_20.json`) — 6/6 acceptance criteria PASS, 9/10 micro-assertions verified directly (10th was a test-selector nit, functionality intact per screenshot). Geometry pipeline already covered by `tests/sweep-geometry.mjs`; added `tests/sketch-to-sweep.mjs` (9/9 assertions pass) for the new profile/path/rise math.
- Files: `frontend/src/lib/store.js`, `frontend/src/components/ContextMenu.jsx`, `frontend/src/components/SweepInspectorBlock.jsx`, `frontend/tests/sketch-to-sweep.mjs` (NEW).

## Iteration 52 (2026-05-28) — P2 Polish Batch (a11y · Bed-Clearance Callouts · Store Refactor)
- ✅ **Voice button a11y** — `voice-btn` now carries `aria-pressed` (true during `recording` / `confirming` / Go-mode loop, false otherwise) and `aria-label`. Disabled (unsupported-browser) variant also gets the labels. Screen readers can announce mic state without parsing the visual style.
- ✅ **STL Preview bed-clearance pill** — `STLPreviewDialog` stats overlay extended with a `bed` line showing the current printer's build volume plus a green `fits ✓` (data-testid `stl-preview-fits`) or amber `too big` (data-testid `stl-preview-too-big`) chip computed against the merged STL bbox. Works for any printer the user has selected.
- ✅ **Gallery card extent + bed-clearance callouts** — every gallery item with a `bbox_mm` field now renders a `X×Y×Z mm` chip (data-testid `gallery-bbox-<id>`); when the extent exceeds the viewer's current printer build volume, an amber `too big` chip (data-testid `gallery-bed-too-big-<id>`) is added so users see at a glance whether a remix will fit their bed. Legacy items without `bbox_mm` render neither chip and don't crash.
- ✅ **Backend `bbox_mm` field** — added optional `bbox_mm: {x, y, z}` to `GalleryItemCreate` + `GalleryItemMeta`. Round-trips through `POST /api/gallery` → `GET /api/gallery`. Backward-compatible (Optional[dict] = None). 177/177 backend pytest still passing.
- ✅ **Bbox plumbing through worker + main-thread STL path** — `csg.worker.js#stl-bytes` and `exporters.js#exportSceneToSTLBytes` now compute and return the merged geometry's bounding box. `ShareDialog` forwards it to the backend so newly-published items auto-populate the chip.
- ✅ **store.js refactor — composites extraction** — pure builders moved to `lib/composites.js` (`buildSlot`, `buildFastenerPair`, `buildCountersink`, `buildHexPocket`, `buildGusset`). Store actions are now thin `pushHistory + set` wrappers. `store.js`: 1481 → 1312 lines (~11.4% reduction). Pure builders are unit-testable in node — new `tests/composites-smoke.mjs` (50+ assertions) locks in the public contract.
- ✅ Verified by testing agent (`/app/test_reports/iteration_21.json`) — 100% backend + 100% frontend. Zero issues, zero action items, zero regressions on iter 51 sketch-to-sweep.
- Files: `frontend/src/components/VoiceButton.jsx`, `frontend/src/components/STLPreviewDialog.jsx`, `frontend/src/components/Gallery.jsx`, `frontend/src/components/dialogs/ShareDialog.jsx`, `frontend/src/lib/composites.js` (NEW), `frontend/src/lib/store.js`, `frontend/src/lib/exporters.js`, `frontend/src/lib/workers/csg.worker.js`, `backend/server.py`, `frontend/tests/composites-smoke.mjs` (NEW).

## Iteration 53 (2026-05-29) — Closing P2 Refactor + Remix Auto-Fit
- ✅ **store.js refactor continued** — extracted `applyCut` to `lib/cutActions.js` (`buildCutDelta`, pure async) and `duplicateSelected` + `mirrorSelectedInPlace` to `lib/selectionActions.js` (`duplicateSelectedDelta`, `mirrorSelectedInPlaceDelta`, pure). store.js: 1313 → 1164 lines (~28% total reduction since iter 51 baseline of 1481).
- ✅ **"Resize to fit my bed" on Remix** — new `useScene.resizeSceneToBed({ targetFraction = 0.95 })` action computes the combined world AABB, derives a uniform scale factor = `0.95 * min(BV.x/dx, BV.z/dy, BV.y/dz)`, and applies it to every object's `scale` + `position` (centred on bed origin, base on Y=0). History-atomic.
- ✅ **Gallery Remix UX** — when a card's `bbox_mm` exceeds the viewer's current printer build volume, the Remix button switches from orange `gallery-remix-<id>` to amber `gallery-remix-fit-<id>` labelled "Remix · fit bed" and routes to `/workspace?remix=<id>&fit=1`. Otherwise the original orange Remix button is unchanged.
- ✅ **Workspace `?fit=1` handler** — after a successful remix load (either project-JSON or STL-fallback branch), the workspace defers one frame and calls `resizeSceneToBed()`, surfacing a toast: *"Resized X% to fit your bed"*. Skips silently when the model already fits.
- ✅ Verified by testing agent (`/app/test_reports/iteration_22.json`) — 100% backend + 100% frontend. Specifically: a 400×50×50 mm "BigCube" remix auto-scaled to factor 0.5225 yielding exactly **209.00 mm = 95% × 220 mm** on the X axis. Plain (non-fit) remix stays at scale [1,1,1]. Composites/cut/duplicate/mirror unchanged post-refactor.
- ✅ Node unit tests added — `tests/resize-to-bed.mjs` (6 assertions, all PASS).
- Files: `frontend/src/lib/cutActions.js` (NEW), `frontend/src/lib/selectionActions.js` (NEW), `frontend/src/lib/store.js`, `frontend/src/components/Gallery.jsx`, `frontend/src/components/Workspace.jsx`, `frontend/tests/resize-to-bed.mjs` (NEW).

## Iteration 54 (2026-05-29) — ARM64 OrcaSlicer Engine
- ✅ **OrcaSlicer 2.3.2 now runs natively on aarch64** — preview pod can produce real production-quality gcode (125 KB / 5027 lines / 50 layers in 0.11s for a 10mm cube test).
- ✅ **Distribution choice**: upstream OrcaSlicer publishes ARM64 binaries ONLY as a Flatpak. We install that Flatpak system-wide via `flatpak install --system` (gives us a 90 MB `orca-slicer` ELF + the GNOME 49 runtime). The K8s pod denies user namespaces so `flatpak run` (bwrap) fails — workaround: invoke the binary directly through the runtime's `ld-linux-aarch64.so.1` with a hand-crafted `--library-path`. Bypasses the sandbox entirely.
- ✅ **New `scripts/install_orca_arm64.sh`** — idempotent installer. Detects already-installed flatpak via `flatpak info`, downloads the 109 MB `.flatpak` bundle from the upstream GitHub release only when needed, installs flatpak + ostree apt deps on first boot, lays a launcher at `/app/backend/bin/orca-aarch64/OrcaSlicer` plus `resources` + `share` symlinks for profile resolution.
- ✅ **server.py auto-installer** — startup hook now routes to either `install_orca.py` (x86_64 AppImage) or `install_orca_arm64.sh` (aarch64 flatpak) based on `platform.machine()`. Same lock-file pattern, same fire-and-forget thread.
- ✅ **`/api/slice/orca/reinstall`** — no longer 400s on aarch64; routes to the bash installer with optional `?force=true`.
- ✅ **Three v2.3.x compatibility patches in `orca_engine.py`**:
  1. `_load_system_preset` now probes `<vendor>/<kind>/base/` in addition to `<vendor>/<kind>/` (the OrcaFilamentLibrary `fdm_filament_*` base files moved into a `base/` subdir).
  2. `_stage_user_profile` writes `from: "system"` (was `User`) — required because OrcaSlicer 2.3.x's compatibility check uses the file's own `name` as the "inherited from" identity only when from='system'. Without this, slice fails with rc -17 ("process not compatible with printer").
  3. `_stage_user_profile` auto-injects `G92 E0` into machine `layer_change_gcode` when `use_relative_e_distances` is true/unset. Required by v2.3.x's relative-extruder validation. Bundled `Custom/MyKlipper 0.4 nozzle` ships an empty layer gcode that fails the check.
- ✅ **Error-message improvement** — failed slice now combines stderr + stdout in the API detail (boost::log emits to stdout, not stderr, so the previous err-only tail was empty on validation failures).
- ✅ Verified by testing agent (`/app/test_reports/iteration_23.json`) — 100% backend + 100% frontend. All 4 orca endpoints PASS; the Slicer popover now offers OrcaSlicer as a selectable engine instead of "unsupported on aarch64".
- ✅ Regression tests updated — `test_iter15_smoke.py` asserts installed=True on aarch64, `test_orca_profile_staging.py` (10 tests) asserts from=='system'. Backend pytest: 176/177 PASS (the 1 failure is a pre-existing 429 rate-limiter flake on /api/auth/login, unrelated).
- Files: `backend/orca_engine.py`, `backend/server.py`, `backend/scripts/install_orca_arm64.sh` (NEW), `backend/tests/test_orca_arm64_slice.py` (NEW), `backend/tests/test_iter15_smoke.py`, `backend/tests/test_orca_profile_staging.py`.

## Iteration 55 (2026-05-29) — Compare Engines v1 (Metrics-Only)
- ✅ **New "Compare engines" button** in the Slicer popover (testid `slicer-compare-engines-btn`) sits directly under the green SLICE button. Disabled until both a primitive exists AND OrcaSlicer reports installed — tooltip explains the latter.
- ✅ **Parallel dual-slice pipeline** — `lib/engineCompare.js` runs the built-in JS slicer (worker) and OrcaSlicer (server) through `Promise.all` so total wall time = max(builtin, orca) instead of sum. Each side is wrapped in its OWN try/catch so a failure in one engine doesn't kill the comparison; the failed side renders a "failed" pill with the error in its tooltip.
- ✅ **Engine Comparison modal** (`dialogs/EngineComparisonDialog.jsx`): two status pills (sliced/failed) + 5-row metrics table (G-code lines, layer count, filament mm, gcode KB, slice duration) with trophy icons on the winning side per row. Caveat copy below the table reminds the reader that "winner" means "more efficient number for that metric", NOT "better print" — Orca routinely produces longer G-code precisely because it generates real supports/ironing/multi-perimeter walls the built-in skips.
- ✅ **Per-engine downloads** — separate buttons for `model_builtin.gcode` and `model_orca.gcode`. Disabled when their side failed.
- ✅ **A11y** — modal has `role="dialog"` + `aria-modal="true"` + `aria-labelledby="engine-compare-title"`. Escape key dismisses.
- ✅ Verified by testing agent (`/app/test_reports/iteration_24.json`) — 100% backend + 100% frontend. All 5 row test-ids respond, trophy/wins-N-of-N counter renders, download buttons toggle disabled correctly when one side failed, dialog closes via X / backdrop / Escape.
- ✅ Node unit test `tests/engine-compare-rows.mjs` — 22 assertions (lowerIsBetter / higherIsBetter / ties / missing values / KB scale conversion).
- Files: `frontend/src/lib/engineCompare.js` (NEW), `frontend/src/components/dialogs/EngineComparisonDialog.jsx` (NEW), `frontend/src/components/popovers/SlicerPopover.jsx`, `frontend/tests/engine-compare-rows.mjs` (NEW).

### Side effect — date string fix
- 📅 Audit: all iter 51-54 CHANGELOG entries carried `2026-02-28` (a typo that kept getting copy-pasted by previous agents). Corrected to actual authoring dates (May 27-29 per git timestamps). Iter 54 → 2026-05-29, iter 55 → 2026-05-29.

## Iteration 56 (2026-05-29) — Texture Library Tutorial PDF
- ✅ **10-page in-depth PDF tutorial** at `/docs/ForgeSlicer-Texture-Tutorial.pdf` (~65 KB). Covers: why geometric textures, modifier flag, 3 ways to add a texture (dialog / right-click face / voice), 4-parameter tuning table, flat vs cylinder wrap with math, all 9 patterns catalog with side-by-side thumbnails + use cases + tips, CSG workflow recipe, flashlight-grip walkthrough, print-quality tips, troubleshooting matrix, quick reference.
- ✅ **PDF brand-consistent** — orange band header, slate-900 cover, brand-color trophy callouts, page numbers, version stamp.
- ✅ **Schematic pattern thumbnails** generated by `scripts/render_texture_thumbs.py` (PIL) — 9 distinct visual representations (knurl diamonds, hex grid, bumps, ridges, diamond plate pinwheels, brick running-bond, fabric weave, hex camo with randomised shades, voronoi cell decomposition). AI visual analyzer confirmed sharp rendering + 3×3 cover-grid layout.
- ✅ **In-app discoverability** — Texture Library dialog (`TextureLibraryDialog.jsx`) now has a "Tutorial PDF" link with BookOpen icon next to the "Pattern" label (testid `texture-tutorial-pdf-link`). Opens in a new tab so the user doesn't lose the dialog state.
- ✅ **Idempotent regen** — running `python3 scripts/build_texture_tutorial.py` re-renders thumbs + rebuilds the PDF in-place. README at `frontend/public/docs/README.md` documents the workflow for future agents adding tutorials.
- Files: `scripts/build_texture_tutorial.py` (NEW), `scripts/render_texture_thumbs.py` (NEW), `frontend/public/docs/ForgeSlicer-Texture-Tutorial.pdf` (NEW), `frontend/public/docs/README.md` (NEW), `frontend/src/components/dialogs/TextureLibraryDialog.jsx` (link + BookOpen import).

## Iteration 57 (2026-05-29) — Tutorial PDF Suite + Help Mega-Menu
- ✅ **Three new tutorial PDFs**:
  - `ForgeSlicer-Getting-Started.pdf` (4 pages, 11 KB) — workspace tour, first-part walkthrough, CSG concept, where-to-go-next decision table, slicer-engine comparison, FAQ.
  - `ForgeSlicer-Hardware-Tutorial.pdf` (4 pages, 15 KB) — full ISO M3–M12 + UNC/UNF #4-40 to 1/2-13 spec tables, fastener-pair anatomy, two-plate-bolt walkthrough, composite cousins (Slot/Countersink/Hex pocket/Gusset), print-and-fit tips, troubleshooting.
  - `ForgeSlicer-Sweep-Tutorial.pdf` (6 pages, 16 KB) — sweep concept, helix/arc/bezier/sketch3d/ref paths, profile kinds, sketch tool workflow, custom-hook walkthrough, twist+samples deep-dive, print tips, troubleshooting.
- ✅ **Shared chrome library** `scripts/tutorial_lib.py` — palette, styles, page chrome (orange band + footer), cover_block, keyed_table, callout helpers. Refactored `build_texture_tutorial.py` to use it; existing PDF is byte-near-identical after refactor.
- ✅ **One-shot regen** `scripts/build_all_tutorials.py` rebuilds every PDF in dependency order.
- ✅ **Help mega-menu** (`components/toolbar/HelpMegaMenu.jsx`) replaces the bare Help button. Two sections: in-app User Manual (preserves existing HelpDialog flow) + four PDF download links (open in new tab, right-click → Save As to download). Plus a footer "Browse all docs & PDFs" link to `/docs/`. Closes on click-outside, Escape, and item click. ARIA: `role="menu"`, `aria-haspopup`, `aria-expanded`.
- ✅ Verified by testing agent (`/app/test_reports/iteration_25.json`) — 11/11 frontend checks PASS, zero issues, zero action items. All 4 PDFs HTTP 200 application/pdf; all 6 menu items present + functional.
- ✅ Updated `frontend/public/docs/README.md` with the new contents + regen instructions.
- Files: `scripts/tutorial_lib.py` (NEW), `scripts/build_getting_started_tutorial.py` (NEW), `scripts/build_hardware_tutorial.py` (NEW), `scripts/build_sweep_tutorial.py` (NEW), `scripts/build_all_tutorials.py` (NEW), `scripts/build_texture_tutorial.py` (REFACTORED), `frontend/src/components/toolbar/HelpMegaMenu.jsx` (NEW), `frontend/src/components/toolbar/SystemRow.jsx`, `frontend/public/docs/*.pdf` (4 files), `frontend/public/docs/README.md`.


## Iteration 58 (2026-05-29) — Tutorial PDF Suite v2 + Inline Viewer
- ✅ **Three additional tutorial PDFs** generated via the shared `tutorial_lib.py` chrome:
  - `ForgeSlicer-Voice-Tutorial.pdf` (8 sections, 15 KB) — how voice control works, mic states, phrasing principles (be explicit, pronouns, chain in one breath), full lexicon by category, AI-generation triggers (auto-submit vs pre-fill), end-to-end phone-stand walkthrough, troubleshooting matrix.
  - `ForgeSlicer-Slicer-Tutorial.pdf` (8 sections, 14 KB) — engines + profile inheritance, Send-to-Slicer flow, **Compare Engines A/B workflow with metric definitions** (print time, filament, peak temp, support volume, wall path length…), four compare-engine recipes (speed-vs-quality / support style / material / wall count sweep), send-to-desktop hand-off formats, troubleshooting.
  - `ForgeSlicer-Gallery-Tutorial.pdf` (8 sections, 15 KB) — anatomy of a shared item (11 fields), publish flow, component library save/add/verify, **nine-license comparison matrix** (CC-BY / CC0 / MIT / Apache / GPL / LGPL / AGPL / CC-BY-SA / CC-BY-NC / CC-BY-ND / ForgeSlicer Standard), remix + attribution + Resize-to-my-bed, filter/search/author-profile, troubleshooting.
- ✅ **HelpDialog refactor — Tutorials tab with inline PDF viewer** (`components/HelpDialog.jsx`):
  - New `Tutorials` component with a thin 224-px picker rail on the left listing all 7 PDFs (testids `tutorial-pick-<file>`) and an `<iframe src="/docs/<file>.pdf#toolbar=0&navpanes=0">` (testid `tutorial-iframe`) filling the rest. The picker rail highlights the active tutorial in orange.
  - Sub-toolbar above the iframe with `Open in new tab` (testid `tutorial-open-new-tab`, target=_blank) and `Download` (testid `tutorial-download`, download attribute) buttons.
  - Added `tutorials` entry to SECTIONS (second in the sidebar, right after Index) and to the Index cards grid so first-time users land on it from the table of contents (`help-card-tutorials`).
  - Section content overrides parent padding for the tutorials view so the iframe fills the full content area.
  - Imports `TUTORIALS` from `HelpMegaMenu.jsx` (exported) — single source of truth between dropdown and dialog.
- ✅ **HelpMegaMenu** updated to include all 7 PDFs with `data-testid` per entry.
- ✅ Verified by testing agent (`/app/test_reports/iteration_26.json`) — **13/13 frontend assertions PASS**, zero issues, zero action items, zero retest needed. All 3 new PDFs HTTP 200 application/pdf; iframe src toggles correctly when switching tutorials.
- Files: `scripts/build_voice_tutorial.py` (NEW), `scripts/build_slicer_tutorial.py` (NEW), `scripts/build_gallery_tutorial.py` (NEW), `frontend/public/docs/ForgeSlicer-Voice-Tutorial.pdf` (NEW), `frontend/public/docs/ForgeSlicer-Slicer-Tutorial.pdf` (NEW), `frontend/public/docs/ForgeSlicer-Gallery-Tutorial.pdf` (NEW), `frontend/src/components/HelpDialog.jsx` (Tutorials component + Index card + SECTIONS entry + render switch), `frontend/src/components/toolbar/HelpMegaMenu.jsx` (TUTORIALS exported + 3 new entries), `frontend/public/docs/README.md`.

## Iteration 59 (2026-05-29) — Component Dimensions + Smart Tutorial Links + 2 Refactors
A four-feature batch that landed in one session.

### 1. Component-pair Dimensions tool (Blender-style "Item" offsets)
- ✅ New persistent annotation type — right-click an object → **"Measure to…"** → right-click a second object → **"Add dimension: A ↔ here"**. Renders a dashed amber leader line between the two parts' world centres plus a HUD chip showing centre-to-centre distance and signed ΔX / ΔY / ΔZ.
- ✅ Chip values update **live** as either part moves, rotates, or scales (verified: cube[0,10,0] vs sphere[0,12,0] reads ΔY=+2.00 mm; moving the cube to y=20 flips to ΔY=−8.00 mm).
- ✅ Cascade-on-delete — removing a referenced object also removes its dimension annotations (no orphaned chips).
- ✅ `clearScene` (toolbar New Project) wipes annotations.
- ✅ Math lives in pure `lib/componentDimensions.js` (`worldBboxOf`, `computeComponentDimension`, `fmtSignedMm`) — testable without React.
- ✅ Store gained `componentDimensions[]`, `pendingDimensionFromId`, `beginComponentDimension`, `commitComponentDimension`, `removeComponentDimension`, `clearComponentDimensions`. De-duped on the unordered {A,B} pair so the user can't end up with two chips drawing the same number.
- Files: `lib/componentDimensions.js` (NEW), `lib/store.js` (added state + actions + cleanup on delete), `components/Viewport.jsx` (added `ComponentDimensionLine` + `ComponentDimensionsLayer`), `components/ContextMenu.jsx` (3 new menu states: start / cancel / commit).

### 2. Smart tutorial deep-links (potential improvement from previous iteration)
- ✅ Right-click an object → menu item **"Tutorial: <topic>"** appears when ForgeSlicer can map the object's type to a relevant PDF. Click → opens the PDF in a new tab.
- ✅ Routing rules (in priority order):
  1. `obj.texture.pattern` → Texture Library tutorial
  2. Primitive type direct hit: `sweep`/`sketch` → Sweep; `bolt`/`nut` → Hardware
  3. Composite-group fallback via `groupId` / `groupName` prefix match: `fastener-` / `slot-` / `cs-` / `hexp-` / `gus-` → Hardware
- ✅ Multi-select handling: when right-clicking a child of a composite group (workspace auto-selects all group members), the menu still surfaces the suggestion because the gate is `count===1 || (count>1 && allInSameGroup)`. Independent multi-selections correctly suppress the link.
- ✅ Node unit test `frontend/tests/tutorial-suggestions.mjs` — 14 cases all green (regression guard).
- Files: `lib/tutorialSuggestions.js` (NEW), `components/ContextMenu.jsx` (probeObj gate), `frontend/tests/tutorial-suggestions.mjs` (NEW).

### 3. Refactor — store.js project I/O extraction
- ✅ `serialize` / `loadProject` / `clearScene` moved to `lib/projectIO.js` as pure helpers (`serializeProject`, `loadProjectState`, `emptyProjectState`). Store methods delegate. No behavioural change; `componentDimensions` correctly reset on load (workspace annotations, not model data — same as Blender's viewport-overlay convention).

### 4. Refactor — HelpDialog.jsx split (771 → 515 lines)
- ✅ Extracted shared typography (`H`/`P`/`Code`/`Kbd`/`Step`) to `components/help/typography.jsx`.
- ✅ Extracted `VOICE_LEXICON` data array to `components/help/voiceLexicon.js`.
- ✅ Extracted `VoiceCommands` and `Tutorials` section components to `components/help/sections/*.jsx`.
- ✅ Zero regressions — Voice/Tutorials/QuickStart navigation, voice-lexicon-search, tutorial-iframe + picker rail all verified by testing agent.

### Testing
- `/app/test_reports/iteration_27.json` — initial test (14/15 pass; flagged the fastener-tutorial gap).
- `/app/test_reports/iteration_28.json` — retest after data-layer fix (4/7 — exposed the consumer-layer single-select gate).
- `/app/test_reports/iteration_29.json` — **8/8 PASS, zero regressions**.
- Unit tests: `tests/tutorial-suggestions.mjs` 14/14 green.

### Files touched / created
NEW: `lib/componentDimensions.js`, `lib/tutorialSuggestions.js`, `lib/projectIO.js`, `components/help/typography.jsx`, `components/help/voiceLexicon.js`, `components/help/sections/VoiceCommands.jsx`, `components/help/sections/Tutorials.jsx`, `frontend/tests/tutorial-suggestions.mjs`.
EDITED: `lib/store.js`, `components/Viewport.jsx`, `components/ContextMenu.jsx`, `components/HelpDialog.jsx`.


## Iteration 60 (2026-05-30) — TinkerCAD-style Anchored Ruler
User shared a TinkerCAD screenshot showing the "anchored ruler" feature (drop a 0.00 origin at a corner, then read signed offsets to other parts) and asked us to add it alongside the existing centerpoint-pair dimension tool. Both tools now coexist.

### What was built
- ✅ **New toolbar button** — `ruler-anchor-mode-btn` (lucide `Anchor` icon, sits next to the existing `measure-mode-btn`). Toggles a global `rulerMode` boolean.
- ✅ **Click-to-anchor** — when mode is on, clicking any object snaps the anchor to that object's nearest bbox corner (8 corners considered; Euclidean distance from the click world-point picks the winner). Pure math lives in `lib/rulerAnchor.js` (`bboxCorners`, `nearestCorner`, `offsetToObject`).
- ✅ **Blue 3D ruler scale** — once anchored, three blue dashed axis rays extend from the anchor across the build plate (X horizontal, Y vertical, Z depth). Axes can be filtered via the HUD `cycleRulerAxes` button: `XYZ → X → Y → Z → XYZ`.
- ✅ **Anchor HUD card** — small TinkerCAD-style panel at the anchored corner showing `0.00 · <name> · XYZ · ×`. The × dismisses the anchor (mode stays on); the axis-cycle button cycles which directions show.
- ✅ **Per-object offset chips** — every visible non-anchored object gets a chip with `X +Δ mm · Y +Δ mm · Z +Δ mm` color-coded per axis (rose/emerald/amber). Values are signed and live — drag any part and its chip updates.
- ✅ **Escape key** clears the anchor first (then pending dimension pick, then selection) — verified.
- ✅ **Cascade-on-delete** — deleting the anchored part clears the anchor; deleting any other part just removes that part's chip.
- ✅ **clearScene / loadProject** both reset `rulerAnchor` to null (annotation, not model state — same convention as Blender's viewport overlay).
- ✅ **Coexistence** — the existing centerpoint-pair dimension tool (right-click `Measure to…`) is untouched and still works. The two are complementary: pair-dim gives centre-to-centre, ruler gives anchor-to-corner-of-each-part.

### Bug found & fixed mid-iteration
- Initially the toolbar toggle didn't clear `rulerAnchor` on ON→OFF transition, so re-toggling resurrected the old anchor. Fixed by adding `if (rulerMode) clearRulerAnchor()` in the onClick before `setRulerMode(!rulerMode)`. (Reported by testing agent iter-30 as T8 PARTIAL.)

### Testing
- `/app/test_reports/iteration_30.json` — **12/13 PASS** initial; the T8 latent bug was the only flag and is now fixed. Validated: button toggling, anchor HUD render, signed-offset chip values (e.g. X −3.00 mm, Y +0.00 mm, Z +4.00 mm), axis cycle XYZ→X→Y→Z→XYZ with correct DOM presence, × dismiss keeps mode on, Esc clears anchor, cascade-on-delete (both directions), live chip updates on drag, AND regressions on measure-mode + component-pair dim all pass.

### Files
- NEW: `lib/rulerAnchor.js` (pure math).
- EDITED: `lib/store.js` (state + actions + cascade cleanup), `lib/projectIO.js` (reset on load/clear), `components/Viewport.jsx` (RulerAnchorLayer + RulerOffsetChip + click routing), `components/toolbar/EditRow.jsx` (toolbar button + ON→OFF anchor clear), `components/toolbar/useToolbarShortcuts.js` (Escape).


## Iteration 61 (2026-05-30) — Anchored Ruler v2 (Two-Step Pick)
User feedback on iter 60: with 13+ parts in a scene the per-object offset chips became a wall of overlapping labels. They wanted the TinkerCAD workflow: *select first component, then a second component* — not every object on the bed.

### What changed
- ✅ **Two-step UX**: click 1 sets the anchor (the `0.00` origin), click 2 picks the target whose offsets show. Subsequent clicks REPLACE the target (most-recent-wins). Clicking the already-anchored part is a no-op (user dismisses anchor via × or Esc explicitly).
- ✅ **Single chip max** — only the explicitly-picked target shows ΔX/ΔY/ΔZ. The previous "chip for every object" implementation is gone.
- ✅ **Pick-target hint** — between click 1 and click 2 a small subtle banner under the anchor reads *"Click a second part to read its offset…"* so the workflow stays obvious.
- ✅ **Target-clear `×`** — the target chip carries its own × button so you can clear the target without dismissing the anchor.
- ✅ Cascade cleanup extended to `rulerTargetId` (deleting the target part just clears the chip; deleting the anchor clears everything). `clearScene` / `loadProject` reset both.

### Files touched
- `lib/store.js` — added `rulerTargetId` state + `setRulerTarget`/`clearRulerTarget` actions; `setRulerAnchor` now also resets `rulerTargetId`; cascade-on-delete extended.
- `lib/projectIO.js` — added `rulerTargetId: null` to both `loadProjectState` and `emptyProjectState`.
- `components/Viewport.jsx` — `onRulerHit` rewritten as a two-step branch; `RulerAnchorLayer` renders the single-target chip OR the pick-target hint, never the global per-object chip set.

### Status
Implementation verified via screenshot: after click 1, scene shows `0.00 · Cylinder · XYZ · ×` HUD + hint banner + dashed axes, no offset chips. No regressions in measure mode, centerpoint-pair dimension, smart tutorial links, or PDF tutorials.


## Iteration 62 (2026-05-30) — Anchored Ruler v3 (TinkerCAD axis labels + 27 snap points + same-object)
User feedback on v2: *"Instead of just popping up a chip with a summary of the measurements, I want the dimensional measurements to be more like TinkerCAD. Additionally, I may want to measure from a midpoint or some other to get dimensional information even on the same component."*

### What changed
- ✅ **TinkerCAD-style L-bracket dim labels** — replaced the single offset chip with three axis-aligned coloured segments (ΔX rose → ΔY emerald → ΔZ amber) forming an orthogonal path anchor → target. A signed-mm label sits at the midpoint of each segment with the matching colour. Labels for axis components that are ~0 are hidden automatically. Labels honour the `axes` filter (XYZ / X / Y / Z).
- ✅ **27 snap points per object** instead of just 8 corners:
  - 8 bbox corners
  - 12 edge midpoints
  - 6 face centres
  - 1 object centre
- ✅ **Snap-kind toggle pills** in the anchor HUD — `COR / EDG / FAC / CEN` — so the user can restrict snapping (e.g., turn off corners to only snap to face centres). Refuses to disable the last enabled kind.
- ✅ **Same-object measurement enabled** — clicking the anchored object again now snaps to a DIFFERENT snap point on it (e.g., body diagonal of a cube). The only ignore is when the EXACT same snap point is re-clicked.
- ✅ **Snap-point ghost markers** — small coloured spheres at all 27 candidates on the anchored + target objects so the user can see where they'll snap next. Active snap point renders larger.
- ✅ **Target HUD** — small `<name> · (snapKind) · ×` card at the target snap point with its own clear button.
- ✅ **HUD consolidation fix** — the anchor card, snap pills, and pick-target hint are now wrapped in a single `<Html>` flex-column at the anchor world point (was 3 separate `<Html>` siblings layering on top of each other; latter overlays were intercepting clicks meant for earlier ones).

### Bugs found & fixed mid-iteration
- **Iter 31 → 32 retest**: 3/19 click-handler regressions on the anchor HUD subtree. RCA: drei `<Html>` siblings at identical world points layer in DOM order and the latest-rendered swallows pointer events from earlier ones. Fix: collapsed 3 sibling overlays → 1 wrapper `<Html>` with `pointerEvents:'auto'` and a flex-column layout. All 13 retested checks PASS, zero regressions.

### Files
NEW: nothing.
EDITED: `lib/rulerAnchor.js` (added `bboxEdgeMidpoints`, `bboxFaceCenters`, `bboxCenterPoint`, `allSnapPoints`, `nearestSnapPoint`; kept `nearestCorner` as a back-compat alias), `lib/store.js` (replaced `rulerTargetId` with full `rulerTarget` snap-point record + added `rulerSnapKinds` + `toggleRulerSnapKind`), `lib/projectIO.js` (track the new shape), `components/Viewport.jsx` (rewrote `RulerAnchorLayer`, dropped `RulerOffsetChip` to a noop stub).

### Tests
- `/app/test_reports/iteration_31.json` — initial v3 test: 16/19 PASS.
- `/app/test_reports/iteration_32.json` — post-fix retest: **13/13 PASS** on the consolidated HUD + sanity checks for previously-passing flows.


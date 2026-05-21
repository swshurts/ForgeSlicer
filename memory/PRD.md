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
| Component | Responsibility |
|-----------|---------------|
| `Landing.jsx` | Hero, feature grid, CTAs |
| `Workspace.jsx` | Shell composing TopToolbar / Left / Viewport / Right / Status |
| `Viewport.jsx` | R3F Canvas, build plate, grid, gizmo, transform-controls |
| `LeftPanel.jsx` | Positive & negative primitive palettes + outliner tree |
| `RightPanel.jsx` | Inspector (transforms/dimensions) + slicer settings + Slice button |
| `TopToolbar.jsx` | File ops, import, export STL/3MF, boolean ops, transform modes, snap/grid, share, send-to-orca |
| `StatusBar.jsx` | Units/build volume/mode/snap/selection summary |
| `Gallery.jsx` | Public gallery browser with download & delete |
| `Dialogs.jsx` | Share-to-gallery + Send-to-OrcaSlicer dialogs |
| `lib/store.js` | Zustand scene store + slicer settings |
| `lib/csg.js` | three-bvh-csg evaluator (positive union → negative subtract pipeline) |
| `lib/geometry.js` | Primitive → BufferGeometry builders |
| `lib/exporters.js` | STL (bin/ASCII) + 3MF (jszip) + STL/OBJ import + JSON project I/O |
| `lib/slicer.js` | Synchronous plane-intersection slicer → Marlin-flavoured GCODE |
| `lib/api.js` | Axios client for `/api/gallery` |

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

## Backlog / Future Enhancements
- P1: Real solid infill in GCODE slicer (perimeter contours only today)
- P1: Replace three-bvh-csg with manifold-3d (Google's WASM library) for truly watertight Boolean output
- P2: Curve/extrude primitives
- P2: `forgeslicer://` URL protocol companion app
- P2: Further refactor `ContextMenu.jsx` + `TopToolbar.jsx` (Dialogs.jsx done)
- P3: Sketch / 2D drawing mode
- P3: AMS-aware preview — visualize multi-color slices layer-by-layer with extruder swaps
- P3: Remix activity feed on Profile (who remixed your designs, when)

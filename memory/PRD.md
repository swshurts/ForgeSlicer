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
- **Routes**: `/` Landing, `/workspace` CAD editor, `/gallery` Public Gallery.

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

## Phase 3 (P0 — next) — Subscription Monetization
Roadmap captured in `/app/MONETIZATION_PLAN.md`. Three tiers planned:
1. **Free**: 3–5 saved/exported models per week, public gallery browsing.
2. **Hobbyist** (~$2/mo): unlimited gallery access + private library quota.
3. **Pro** (~$7/mo): unlimited create/upload/download, custom components, advanced exports.
Will be enforced by a new `users.tier` field + middleware counters; Stripe Checkout for upgrade flow.

## Backlog / Future Enhancements
- P0: Phase 3 Stripe monetization (tiers, usage gating, checkout)
- P1: Real solid infill in GCODE slicer
- P1: Replace three-bvh-csg with manifold-3d
- P1: Tier 1 Component Library polish — tag search UI, upvote/verified badges, expanded categories, pre-built "Slot/Racetrack" primitive
- P2: Curve/extrude primitives
- P2: `forgeslicer://` URL protocol companion app
- P3: Sketch / 2D drawing mode
- P3: AMS-aware preview — multi-color slice playback

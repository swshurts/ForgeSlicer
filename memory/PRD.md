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

## Current Open Items (as of 2026-06-01)

### Pending P1 (queued)
- **Scheduled OrcaSlicer upstream sync** — daily/weekly cron task fetches `SoftFever/OrcaSlicer/resources/profiles/*/machine/*.json`, hashes them, surfaces deltas in an Admin → Profile Updates dashboard with optional Resend email digest.

### Backlog (P2/P3)
- Continue `store.js` refactor (composite-primitives block ~L676; boolean/dim action blocks).
- `Viewport.jsx` size reduction.
- Multi-user CRDT collaborative editing (Yjs).
- Photo-to-plane (experimental).
- Admin moderation dashboard for flagged shared profiles (counter exists; UI deferred).

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

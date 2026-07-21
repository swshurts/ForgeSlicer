# ForgeSlicer — Product Requirements

> Measurement UX (updated 2026-07-03, iter-116): The workplane ruler follows TinkerCAD's **reference-origin** model — placement dots on all bbox corners, ruler drop point becomes the measurement origin, selected objects show size chips + EDITABLE distance-from-origin chips (typing moves the part). The old two-point PICK measurement system is retired.
 Document

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
- `lib/exporters.js` — STL (bin/ASCII) + 3MF (jszip) + STL/OBJ import + JSON project I/O. **iter-104.1**: ForgeSlicer is now Z-up internally (matches CAD-standard + STL/3MF natively), so the Y-up↔Z-up rotation passes have been removed — imports and exports preserve orientation directly.
- `lib/useOrcaSlice.js` — Hook: OrcaSlicer profile state, install polling, SSE progress with polling-fallback (iter 78), runSlice/buildPayload
- `backend/orca_engine.py` — OrcaSlicer CLI integration: async job queue, SSE progress, validation-error visibility with `--debug 5`, fail-log persistence (iter 78)

## Companion Documents
- **CHANGELOG.md** — append-only iteration history.
- **ROADMAP.md** — prioritised P0/P1/P2 backlog and pending issues.
- **test_credentials.md** — seed users for the testing agent / E2E suites.


### Recently completed (iter-151.11, 2026-07-21) — Hinged-lid orientation bug fix

Drawer Chest's "Top compartment is a hinged-lid box" mode was placing the hinge knuckles on the FRONT of the chest (same side as the drawer handles) and the finger pull on the BACK. Root cause: this generator's drawer fronts live at world `+Y = +D/2` (drawers are shifted forward by `D/2 - drawerTotalD/2`), but the lid code assumed the opposite convention. Swapped `knuckleY` from `+D/2` to `-D/2` and the finger pull from `-D/2` to `+D/2`; matching frame-side + lid-side ribs updated in one pass. Verified via workspace screenshot — hinges now on back edge, pull on front edge.

### Recently completed (iter-151.7 – 151.10, 2026-07-21) — Phase 1-3 shipped

Four sizeable features landed in the same session, each verified end-to-end:

**iter-151.7 — Plate Thumbnails**
- New `PlateThumbnail.jsx` renders each plate's top-down XY footprint into a small 44×32 canvas embedded inside the plate tab (build-plate outline + filled rectangles per object). Fast, no WebGL cost. Redraws whenever the scoped object list changes.

**iter-151.7 — Printer-Aware Clearance Auto-Tune**
- New `printerProfile` store field: `{ nozzleDiameter, xyShrink }` persisted to localStorage.
- `clearanceProfile.js` helper: suggested = `nozzle*0.5 + shrink`, clamped to [0.10, 0.90] and snapped to 0.05 mm.
- `PrinterClearanceProfile` panel added to the RightPanel Print tab (nozzle Ø + XY shrink inputs + live-computed "Suggested clearance" readout).
- `BoxDesignerDialog` and `DrawerChestDialog` now derive their initial `clearance` default from the profile. Drawer bumps +0.05 mm (deeper mating surface accumulates shrink).

**iter-151.9 — Print-Shop Presets** (new backend collection + share links)
- Backend: `routes/print_presets.py` with POST/GET-mine/GET-public/GET-slug/apply/DELETE endpoints. `MongoDB.print_presets` collection with `slug` (8-char base32), `slice_settings` blob (8 KB cap), `uses` counter. Apply requires auth per product decision — public preview does not.
- Frontend: `inspector/PrintPresetsPanel.jsx` (save current slicer + material + printer as a named preset, list mine, apply/delete/copy-share-URL) + `pages/PresetImportPage.jsx` at route `/presets/:slug` (public preview + sign-in-gated Apply).
- API client: `printPresetsApi` in `lib/api.js`.

**iter-151.10 — Cooperative Projects (approval-based)**
- Backend: `routes/coop_projects.py` — Project + Proposal collections, all endpoints under `/api/coop-projects`. Private projects gain members via owner's `invite {email}`. Public projects have a `pending_requests` queue the owner approves/denies. Members submit change proposals (scene snapshot); owner accepts (proposal scene becomes committed, `scene_version` bumps) or rejects (with note).
- Frontend: `pages/CoopProjectsPage.jsx` at route `/coop` — list of mine + discover-public, then detail view with three tabs (Overview / Members / Proposals). Members can `Load into workspace` + `Submit for review`; owners see the full proposal queue with Accept & Reject buttons + owner-note textarea.
- Landing-page header link added ("Co-op") for discoverability.

**Testing**: All four verified via curl (create/apply/invite/proposal-accept flows) and frontend screenshot flows (list → detail → tab navigation → per-tab actions).



### Recently completed (iter-151.6, 2026-07-21) — Multi-Plate MVP complete (Move-to-Plate)

**Two Move-to-Plate entry points shipped:**
- **Top plate-tab bar**: When any parts are selected AND there is more than one plate, an amber `Move (N)` button appears next to the plate tabs with a dropdown of destination plates. One click dispatches the whole selection.
- **Inspector "Move to Plate"**: Full-width amber button under Drop/LayFlat/Delete in the RightPanel. Shows a dropdown of destination plates. Uses `selectedIds` when there is a multi-select, otherwise falls back to the primary selection so single-object moves work too. Undoable — `moveObjectsToPlate` now pushes a history snapshot.

**Files touched**:
- `frontend/src/components/RightPanel.jsx` — `<MoveToPlateControl>` component + Inspector wiring
- `frontend/src/lib/store.js` — `moveObjectsToPlate` now guards empty args and calls `pushHistory()` for undo

**Testing (frontend screenshot flow)**: Added a cube on Plate 1 → opened Inspector → clicked "Move to Plate (1)" → chose "→ Plate 2" → cube disappears from Plate 1 outliner and appears on Plate 2. Verified plate-tab-bar variant renders identically.


## Current Open Items (as of 2026-07-21)

### Recently completed (iter-151.5, 2026-07-21) — Gridfinity FULL baseplate + drawer sub-divider

**Two more drawer-interior features shipped in the same dialog:**
- **Gridfinity FULL baseplate profile**: New "Gridfinity FULL baseplate profile" checkbox carves the exact Gridfinity pocket profile into each drawer floor. Uses a 3-slab stacked approximation of Zack Freedman's canonical spec: top rim 41.5 × 41.5 (r=4, 0.8 mm), chamfer step 39 × 39 (r=3, 2.15 mm), bottom pocket 35.6 × 35.6 (r=1.85, 0.8 mm). Total depth 3.75 mm. Drawer floor auto-thickens to 5 mm when enabled so the pocket doesn't punch through. Mutually exclusive with the "locators (crosses)" mode.
- **Drawer sub-divider grid**: New dropdown with 8 layouts — 1×2, 2×1, 2×2, 1×3, 3×1, 2×3, 3×2, 3×3 — that unions interior walls into each drawer to split it into cubbies. Wall thickness matches the drawer walls; walls stop 1 mm below the drawer rim. Independent of Gridfinity so users can combine (e.g. 2×2 cubbies each with their own Gridfinity pocket).

**Files touched**:
- `frontend/src/lib/drawerChestGenerator.js` — `floorTh` local override, Gridfinity baseplate 3-slab carving loop, sub-divider wall builder, exclusivity guard vs locators
- `frontend/src/components/params/DrawerChestDialog.jsx` — two new form fields (checkbox + select), mutex logic

**Testing**: Screenshot + volume-delta verified. 3×3 subdivider produces 9 clean cubbies (visible in the workspace preview). Full baseplate + 3×3 subdivider combined on the Gridfinity preset produces 372.4 cm³ / 129 g at 15 % infill. Add-to-Workspace lays parts side-by-side with no Manifold union failures.

### Recently completed (iter-151.4, 2026-07-21) — Preset chests + filament estimate + Gridfinity locators

**New features (all working together in the Drawer Chest dialog):**
- **Preset chests dropdown**: 7 starter configs at the top of the dialog — Default, Small tool tray, Desk organizer, Jewelry chest (hinged top), Gridfinity 3×2, Workshop chest (5 rows), Bookcase insert (flat bottom). Selecting a preset loads params; the user can tweak from there without restrictions.
- **Filament + print-time estimate**: Live footer strip shows total grams (at 15 % infill, PLA) + solid-fill grams + print time in hours/days + total solid volume in cm³. Computed by summing the signed-tetrahedron volume of every part in the bundle. Small-tray preset ~40 g / 2 h; workshop preset ~789 g / 1.6 d.
- **Gridfinity locators (42 mm)**: New checkbox in the Drawers section unions small `+`-shaped locator crosses onto each drawer's interior floor at every Gridfinity 42 mm grid intersection. Layout centred on X, aligned to the drawer FRONT on Y (per user spec). Cells that don't fully fit are dropped, and crosses too close to a wall are skipped. Compatible with Zack Freedman's CC-BY-SA 4.0 Gridfinity spec.

**Round-2 polish + round-1 hardware fixes (same session):**
- Removed the buggy through-hole "Finger recess" handle.
- New handle styles based on user hardware references: **Square knob**, **Arched pull**, **Square pull**, **None**. All union onto the drawer face as protrusions — printable in-place or as separate hardware.
- **Feet-when-zero fix**: Setting Feet height to 0 (with checkbox still checked) now produces a perfectly flat bottom. Lifted `min` from 2 → 0.
- **Rows** cap raised 8 → 10.

**Files touched**:
- `frontend/src/lib/drawerChestGenerator.js` — Gridfinity crosses, volume calculation helper, three new handle styles, feet-height=0 skip
- `frontend/src/components/params/DrawerChestDialog.jsx` — PRESETS array + dropdown, Gridfinity checkbox, filament estimate footer

**Testing**: Screenshot + volume-delta verified. Gridfinity adds ~10 cm³ / 150 crosses on a 5-drawer workshop preset — matches expected math. All 7 presets load and build cleanly. Add-to-Workspace with the workshop preset produces 7 non-overlapping parts (Frame + 5 Drawers + Cap).

### Recently completed (iter-151.2, 2026-07-21) — Drawer Chest per-drawer heights + hinged-lid top compartment

**Feature additions (user spec):**
- **Per-drawer heights** (`DrawerChestDialog.jsx`, `drawerChestGenerator.js`): New "Custom drawer heights" toggle exposes a list of per-slot height inputs (top→bottom). The BOTTOM row is always the auto-fill (shows the leftover height as a placeholder). This lets users pack a shallow tool drawer above a deep sock drawer, for example.
- **Hinged-lid top compartment**: New "Top compartment is a hinged-lid box" toggle turns the top row into a chest-style top-opening compartment. Front face for that row stays closed; the topmost divider drops; a matching hinged lid with piano-hinge knuckles (Ø 2.20 mm axle hole, 1.75 mm filament pin fit) generates as a separate part. Detachable-cap is auto-disabled in this mode.
- **Master-view improvements**: The "Explode drawers 8 mm" toggle now ALSO rotates the hinged lid open (~52°) around its back-edge pivot so users can see the top compartment interior. Toggle it off to preview the closed shape.
- **Lid download button**: `chest-download-hinged-lid` appears in the footer when the hinged mode is active.

**Bug fixes (during scaffolding):**
- **Drawer sizing**: Previous code set `drawerTotalD = drawerBodyD + drawerFaceThickness - clearance` which pushed the drawer's back face 2.4 mm behind the frame's back interior wall. Rewrote as `drawerTotalD = D - wall - drawerBackClearance` so the drawer face is exactly flush with the frame front and the back has a proper `clearance` mm gap.
- **Glide nubs**: Previously placed 0.6 mm hemispheres on the drawer's ±X SIDES, making the drawer's bbox 1.2 mm wider than the slot interior (drawer wouldn't slide in). Nubs moved to the drawer's underside (Z=0) at ±35 % X, ±25 % Y, radius auto-capped to `min(0.5, clearance * 0.9)` so they never exceed clearance.
- **Frame back wall**: Cavity Y-cut was over-cutting into the back wall by 1 mm (turning a 3 mm nominal back into a 2 mm back). All the over-cut now sits at the +Y (front) side.
- **Feet inset**: `footInset` param had no effect (corner posts always reached the outer edge). Rewrote as "clear the entire feet Z-band, then union in 4 posts inset by `footInset` mm" so the parameter now controls the visible inset properly.
- **Effective height**: Hinged-lid mode subtracts `hingeLidThickness` from `frameH` so the total assembled height (feet + cabinet + lid) matches the user's requested `H`.

**Files touched**:
- `frontend/src/lib/drawerChestGenerator.js` — major rewrite (~470 lines)
- `frontend/src/components/params/DrawerChestDialog.jsx` — added heights section, hinged toggle, mutex with topCap, lid download button, hinged-lid preview rotation

**Testing**: Screenshot-verified default, hinged-only, hinged + custom heights, closed vs open preview. Add-to-workspace lays 5 parts side-by-side without Manifold union failures. ZIP bundle (104 KB) + individual Frame STL (12 KB) download cleanly.

### Recently completed (iter-150.6, 2026-07-20) — Add-to-Workspace overlap bug (user reported: hinged export produced tiny fragment)

- **Root cause**: `handleAddToWorkspace` dropped both Box body and Lid at world origin `[0, 0, 0]`. For hinged lids, the box + lid knuckles interlock (as designed for the assembled hinge), so the two "imported positive" meshes physically overlapped in the workspace scene. When the user then hit Export STL / 3MF, `evaluateSceneAsync` ran `wasm.Manifold.union([box, lid])` on the interlocking meshes, which choked and collapsed the result down to only a fragment (~346 tris) — matching the "tiny knuckles + tiny slab" that appeared in Flashforge slicer.
- **Fix** (`components/params/BoxDesignerDialog.jsx`): After each `addImportedMesh` call we now shift the just-added part by its own bbox width + a 10 mm padding along +X so each part lands cleanly next to (not on top of) the previous one. Box body → 0…60 mm, Lid → 70…130 mm. Workspace STL export now produces the expected 1428 triangles with correct dimensions.
- Direct BOX / LID / ZIP downloads inside the Box Designer dialog were never affected (each was a single-part STL) and continue to work.

### Recently completed (iter-150.5, 2026-07-20) — Lid clearance widening (user feedback)

After a real print, all three "captured" lid modes needed extra clearance to compensate for FDM shrinkage & first-layer squish:

- **Hinged**: axle hole Ø bumped from 1.85 mm → **2.20 mm** (0.45 mm total slip fit for a 1.75 mm filament pin). Knuckle radius floor bumped to 2.6 mm.
- **Sliding**: rewrote clearance math so every gap scales with the user's Clearance knob PLUS a fixed floor. Vertical slot slop is now `clearance + 0.35` (~0.6 mm at default). Per-side rail slop is `clearance + 0.15` (~0.4 mm at default). Depth slop at the back stop is `2 × clearance + 0.4` (~0.9 mm at default). Lid slab shrunk from 57.7 × 40.24 → 57.4 × 39.59 mm at defaults.
- **Friction**: skirt inset widened to `wall + clearance + 0.25` per side (was `wall + clearance`) so a default clearance produces a real slip fit rather than a jam fit.
- **UI**: each lid-mode hint now spells out the exact clearance the user is getting so they can bump the global Clearance value if their printer runs tight.

### Recently completed (iter-150.4, 2026-07-20) — Sliding-lid stackable-foot bug

User reported the sliding lid built with a raised platform on top ("cyan portion" from the slicer's planar-cut view) that physically prevented the lid from sliding under the box's overhang.

- **Root cause**: the `stackable` extra always union'd a 1.2 mm-tall foot onto the top of the lid regardless of lid mode. For sliding + hinged lids the lid is trapped inside the box, so the foot pokes above the wall top and blocks entry into the slot.
- **Fix**: the stackable-foot union now only runs when `lidMode` is `"drop"` or `"friction"` (free-stacking modes). Sliding + hinged lids stay a flat slab with rails / knuckles.
- **UI**: the "Stackable lip" checkbox is now visually greyed and labelled "(n/a)" whenever the current lid mode is sliding or hinged so the toggle isn't silently ignored.

### Recently completed (iter-150.3, 2026-07-20) — Magnet-mount rewrite (user spec)

Rebuilt drop-on-lid magnet mounts to a proper hardware spec:
- **Magnet thickness lookup**: 5 mm Ø disc → 3 mm thick, 10 mm Ø disc → 2 mm thick. Pocket depth exactly matches the nominal magnet thickness (with a 0.5 mm over-cut for a clean drill).
- **Pocket position**: pocket EDGE is inset 2.5 mm from each outer wall so there is always a 2.5 mm barrier of material between the magnet and the box exterior. Pocket centre = `2.5 + magR` in from each outer wall. Box bbox stays at the nominal 60×40 regardless of magnet size (previous version made a 5 mm magnet bump the box to 63.4×43.4 and 10 mm to 68.4×48.4).
- **Wall-mount geometry**: replaced the full-height cylindrical post with a 5 mm-deep lathed boss. Profile: cylindrical section (mountR = magR + 1.5, 4 mm tall) with a 45°-ish chamfered bottom (1 mm chamfer height, 0.8 mm radial reduction) that softens the transition from boss to cavity floor — better print bridging and less stress concentration.
- **Lid auto-bump**: when magnets are enabled, lid thickness is silently raised to `magnet_thickness + 0.8 mm` (3.8 mm for 5 mm magnets, 2.8 mm for 10 mm) so the pocket never breaks the top surface. UI shows an amber hint whenever a bump was applied.

### Recently completed (iter-150.2, 2026-07-20) — Sliding-lid follow-up

- **Printability false-positive guard** (`lib/printabilityChecks.js`): the "too thin to print reliably" check was surfacing a nonsense `Shortest dimension is -Infinity mm` when the imported mesh's bounding-box computation produced an empty `THREE.Box3` (min=+Inf, max=-Inf). Added `!isFinite(...)` guards in both `worldBBox()` and `checkSmallFeatures()` so degenerate / empty geometries are silently skipped rather than displayed as a scary red banner.
- **Sliding-lid STL verified clean**: exported STL for a 60×40×30 box + sliding lid parses as 484 well-formed triangles, no degenerate faces, bbox 60×40×28. The previous versions could produce a corrupted export from the CSG chain — with the iter-150.1 groove-cutter rewrite the export path is now clean.

### Recently completed (iter-150.1, 2026-07-20) — Box Designer 2nd-round bug fixes

Following user's follow-up feedback ("slider missing the overhang to capture the lid; magnet pockets missing"):
- **Sliding lid overhang** (`lib/boxGenerator.js`): T-slot no longer breaks through the top of the side walls. Groove Z-range now stops `capH = 0.8–1.4 mm` below the wall top, leaving a continuous cap of material above the groove on the two side walls + back wall. The front-wall notch height matches the groove exactly (no longer cuts to the top of the wall), so the lid can only enter through the front and cannot lift out — it's captured by the overhang.
- **Magnet pockets** (drop-on lid): two independent bugs squashed. (1) Cylinder axis defaulted to Y (horizontal) — added `pocket.rotateX(π/2)` so pockets drill straight down in Z. (2) Pockets were being centred inside the empty cavity so nothing got subtracted; added internal corner posts (radius = magR + 1.2 mm, floor to top) that weld into two adjacent walls at each interior corner. Pockets are now drilled into those solid posts + matching pockets on the lid underside, giving a printable magnet seat regardless of wall thickness.

### Recently completed (iter-149, 2026-07-20) — Enhancements PDF Release A + B + C + STL Preview / Pyramid fixes

**Release C (§4a + §4b — Menu reorg + Box Designer)**
- **Menu reorganization** (PDF §4a): Left palette now has exactly 5 tabs in this order — 3D · 2D · COMBO · PARAM · AI. The standalone LIB tab was folded into COMBO (composites section on top, component library with cat filter on the bottom). New PARAM tab hosts parametric generators.
- **Box Designer** (PDF §4b): New PARAM-tab launcher opens a full-screen dialog (`BoxDesignerDialog.jsx`) with a left form column + right live 3D preview + footer action bar. Knobs cover every parameter from Figure 2 of the PDF: outside W/D/H, wall thickness, floor thickness, corner radius, 5 lid modes (none / drop / sliding / hinged / friction fit), lid thickness, clearance, compartments cols×rows (1–8), stackable lip, side handles (cylindrical finger scoops), label recess (front-face pad with configurable depth).
- **Parametric geometry** (`lib/boxGenerator.js`): client-side manifold-3d unions + differences. Handles the special-case geometry each lid mode requires — sliding rails ride in grooves cut into the box top, hinged tabs pair with a lid knuckle around a 1.5 mm axle hole, friction fit adds a tapered skirt with a hollow interior. Every returned part is a welded `THREE.BufferGeometry` with `bbox` for reporting.
- **Multi-part exports** (`jszip`): Four action buttons — Add to workspace / Download Box.stl / Download Lid.stl / Download ZIP bundle. ZIP includes a `README.txt` with the exact parameters used so users can rebuild an identical box later.
- **Live rebuild**: 220 ms debounce on every parameter change. Build token guards against stale results overwriting a newer build.
- **Testing**: Testing-agent 10/10 flows PASS after a 1-line fix (JSZip doesn't accept DataView — convert to Uint8Array before `zip.file()`). Individual STL downloads use `new Blob([dv], ...)` which handles DataView natively.

**iter-149.2 fix — Pyramid flatten produced translucent / empty mesh**
- User reported: creating a diamond (two pyramids) and clicking "Flatten to single mesh" produced a translucent ghosted mesh that reported the scene as empty on export.
- Root cause: my hand-built pyramid index buffer wound every face **inward** (side normals pointed into the pyramid, base normal pointed +Z). Three.js with `side=DoubleSide` rendered the workspace mesh fine, so the bug hid until the flatten hit `manifold-3d` — which treats an inward-wound mesh as an inverted solid (negative volume). Union of an inverted solid with itself → 0-volume manifold → STL export sees empty scene; the flatten still writes a "1 positive component" imported mesh, but its geometry is a hollow inverted hull.
- Fix (`geometry.js`): swapped both side + base triangle winding to (apex, a, b) and (baseCentre, b, a). Verified via viewport render + flatten → export cycle: pyramid, ngon prism, and 2-pyramid diamond all produce correct solid meshes with expected bbox.

**iter-149.1 fix — STL Preview axes orientation**
- User flagged the STL Preview axis gizmo was inconsistent with the exported STL. Root cause: the preview `<Canvas>` used the three.js default Y-up camera (`up = [0,1,0]`) plus a Y-up centring / drop transform in `PreviewMesh`, while the exported STL is Z-up (matches the workspace + Orca + PrusaSlicer). Pyramids and wedges therefore appeared tilted in the preview even though the STL was correct in Orca.
- Fix: forced `camera.up = [0,0,1]`, moved the OrbitControls target to `[0,0,20]`, rotated the drei `<Grid>` 90° around X so it lays on the XY plane, swapped light positions to Z-up, and updated `PreviewMesh` to centre on X/Y and drop `bb.min.z` (was dropping `bb.min.y`).
- Result: Pyramid apex points straight up, grid is flat, axis gizmo shows Z (blue) up matching Orca. Verified via screenshot.

**Release A (§1 + §2 — Foundations)**
- **Custom Build Plate** (PDF §1): New "Printer build plate" section in the Snap/Plate popover with X/Y/Z inputs (mm ↔ inch toggle), 6 preset chips (Mini 180 / Std 220 / Mid 256 / Large 300 / XL 350 / 500). Writes straight into `buildVolume` — no need to save a full OrcaSlicer printer profile for a quick "does this fit?" test.
- **Triangle ASA / SAS / SSS calculator** (PDF §2a): New `TriangleFromAngles.jsx` mounted under the Triangle inputs. Users pick a mode (SAS / ASA / SSS), enter the appropriate angles + sides, see a live derived base/height/apex-shift preview, and click Apply. Invalid combos (triangle-inequality failure, angle sum ≥ 180°) surface as a red "Invalid" hint with the Apply button disabled.
- **Pyramid + N-gon Prism 3D primitives** (PDF §2b): Two new primitives in the 3D palette. Pyramid = n-sided base + apex height (default 4-sided so it reads as classic pyramid). Prism = n-sided polygon extruded to a printable height (default 6-sided hex). Inspector exposes base-radius, height, and a 3–24 side slider.
- **Nomenclature** (PDF §2c): 3D "Cube" button labelled "Rect. Solid", 2D "Square" labelled "Rectangle". Internal type strings (`cube`, `square2d`) unchanged so gallery + scene JSON continue to load. Tooltips clarify that a cube/square is just the special case where all axes match.
- **Testing**: Testing agent 6/6 flows PASS, 100 % frontend success rate. All 10 pre-existing primitives regression-clean.

**Release B (§3 — Lithophane parity with LithoForge.net)**
- **AI-menu Lithophane rewiring**: The "Lithophane / 2.5D Relief" button used to open the tiny PhotoToPlaneDialog (heightmap on the current workspace). It now opens the full `LithoStudio` (`/litho`) in a new tab — that's ForgeSlicer's LithoForge.net-equivalent: multi-filament palette optimiser, layer timeline, HueForge-style vibrancy, 3MF export.
- **Secondary "Quick 2.5D Relief"** button remains for the one-shot single-filament use case; smaller styling makes the studio the visual default.
- **Testing**: Smoke test confirms the new tab opens `/litho` and both buttons render with the expected labels + tooltips.

### Recently completed (iter-148, 2026-07-20) — Gallery Health UI + Decimate size/FPS estimates
- **`/admin/health` dashboard** (`AdminHealth.jsx` + route in `App.js`): Renders `/api/admin/gallery-stats` as two cards (Gallery / Components) with colour-coded stat tiles (missing thumbnail = warn, missing STL = danger, orphaned = warn). By-category histogram chips, oldest/newest timestamps. Header link (`data-testid="admin-health-link"`) added to `/admin` for quick access.
- **Thumbnail regeneration background job**: New `POST /api/admin/regenerate-thumbnails` starts a worker; `GET .../status` polls progress (idle → running → done/error). Worker streams every missing-thumbnail doc, renders a PNG via `thumbnail_service.render_stl_thumbnail` (matplotlib Agg headless, 256×256, slate-900 background matching UI), and updates `db.gallery` / `db.components`. Errors are per-item and accumulated on the job so a bad row can't kill the whole batch. Live progress bar + expandable error list in the UI.
- **AI failure panel** (`GET /api/admin/ai-errors`): Recent `db.ai_jobs.status='FAILED'` rows (limit=50), plus 24 h + 7 d failure-rate aggregates. Colour-coded (>15 % danger, >5 % warn) so an admin sees provider outages at a glance. Provider badge (fal cyan vs meshy fuchsia).
- **Decimate tooltip size/FPS estimates** (`PrintabilityReportPanel.jsx`): Each preset chip now shows a small `X MB · Y fps` line at the bottom (`data-testid="printability-decimate-{key}-est"`); the current-tris summary appends `(~X MB · Y fps)`. Heuristics: `stlBytes ≈ 50 * tris` (binary STL), `fps ≈ clamp(min(60, 30_000_000/tris), 5, 60)`. Hover title tooltips gained `Est. STL size:` + `Est. viewport:` lines. Helps beginners tie face-count reductions to real file-size and viewport wins.
- **Testing**: 12/12 new pytest cases in `tests/test_admin_health.py` (auth gates, worker end-to-end, ai-errors shape + seeded row detection, thumbnail_service unit tests). Testing-agent E2E: 5/5 flows PASS, 100 % backend + frontend success.

### Recently completed (iter-147, 2026-07-20) — Decimate preview tooltip + Gallery health dashboard
- **Decimate preview tooltip** (`PrintabilityReportPanel.jsx`): The 3 preset chips now show a before/after triangle-count preview instead of a static "25k tris" label. Header shows `Current: <n> tris` derived from `report.metrics.triangle_count` (with a per-object geometry fallback for the brief pre-analyzer window). Each chip's `title` tooltip renders `<current> → <target> tris (±%)` so hovering reveals the exact math. Presets grey out and label their target in muted colour when the current mesh is already below the target (guards against no-op reductions). Emerald accent + percentage tag when the preset would actually shrink.
- **`/api/admin/gallery-stats`** (`server.py`): New admin-gated endpoint returning per-collection health for `db.gallery` + `db.components`. One MongoDB `$facet` per collection: totals, featured count, per-category histogram, missing_thumbnail, missing_stl, oversized_stl (>20 MB raw base64), orphaned_no_owner (docs whose `user_id` no longer resolves to a user), oldest/newest timestamps, plus public/private split on gallery. Verified live against preview DB — surfaced 33 gallery + 78 component items missing thumbnails, 2 broken components with empty STL blobs.
- **Access**: Both endpoints share the same `_require_admin_for_upstream` guard. Non-admin → 403.
- **E2E**: Preview DB reveals real drift; PowerShell curl already used successfully by the operator to run the taxonomy audit endpoint against production (returned `total_matched: 0` — production is fully migrated).

### Production usage
```
# Health snapshot:
curl 'https://forgeslicer.com/api/admin/gallery-stats' \
     -H "Authorization: Bearer <YOUR_ADMIN_SESSION_TOKEN>"
```

### Recently completed (iter-146, 2026-07-19) — Admin taxonomy-backfill endpoint (production audit)
- **Context**: Preview DB was already clean after iter-131. To audit + migrate the production DB without shell access, exposed the same iter-145 backfill logic via HTTP.
- **Shared module** (`backend/taxonomy_backfill.py`): Extracted `process_collection(coll, label, apply, limit=5000)` and `summarise(matched, remaps)` from the CLI script into a shared module. Both the CLI (`scripts/backfill_gallery_categories.py`) and the new HTTP endpoint import it — so they can never disagree on which docs are eligible or how they get re-classified.
- **Admin route** (`server.py`): `POST /api/admin/taxonomy-backfill?dry_run=<bool>` — gated by `_require_admin_for_upstream`. Runs against both `db.gallery` + `db.components`, returns a JSON audit report with per-collection `matched` count and `remaps: [{old, new, count}]`. `dry_run=true` (default) writes nothing; `dry_run=false` applies the migration.
- **E2E**: Seeded 3 legacy docs (electronics, brackets, fasteners) → dry-run returned correct old→new remaps + `total_matched: 3` — apply wrote them — idempotency dry-run reported `total_matched: 0` — non-admin user hit `HTTP 403`. CLI still works via the shared module.

### Production usage
```
# Dry-run (safe — writes nothing):
curl -X POST 'https://forgeslicer.com/api/admin/taxonomy-backfill?dry_run=true' \
  -H "Authorization: Bearer <admin session token>"

# Apply the migration:
curl -X POST 'https://forgeslicer.com/api/admin/taxonomy-backfill?dry_run=false' \
  -H "Authorization: Bearer <admin session token>"
```
Admin session tokens live in `db.user_sessions` for any user whose `is_admin` flag is true.

### Recently completed (iter-145, 2026-07-19) — Taxonomy backfill + Decimate deep-link
- **Taxonomy backfill migration** (`server.py`, `scripts/backfill_gallery_categories.py`): Extended the startup backfill to cover **legacy category ids** (rack, mounting, fasteners, electronics, brackets, hinges, gears, miniatures, structural) as well as missing-category docs — re-classifies via `gallery_taxonomy.guess_category(name)`. Runs against both `db.gallery` AND `db.components` collections. Fully idempotent: re-runs are ~0-cost no-ops once the DB is fully tagged. Added a standalone CLI at `scripts/backfill_gallery_categories.py` with `--dry-run`, `--apply`, and `--only {gallery,components}` flags so operators can preview + verify without a redeploy. Dry-run prints a plan grouped by `(old → new)` count.
- **Decimate deep-link** (`PrintabilityReportPanel.jsx`, `toolbar/projectActions.js`): The "Very heavy mesh" import warning's **"Decimate now"** toast action now (1) opens the Printability report dialog, (2) fires a `forgeslicer:printability-focus` event with `detail.focus="decimate"`. The panel listens for that event, scrolls its Decimate preset row into view, and pulses `animate-pulse ring-2 border-orange-400/70` for 4 s so the user lands directly on the target-face-count picker. Three preset chips (Mini/25k, Functional/12k, Low-poly/3k) call `runDecimate(preset)` immediately — no confirmation, undo via Ctrl+Z. Row is only rendered when the scene contains at least one imported mesh.
- **E2E** (playwright): CLI dry-run correctly identifies 3 seeded legacy docs, `--apply` writes them, re-run reports 0 matches. UI: drop STL → dispatch open-dialog + focus events → panel shows Decimate row with all 3 preset chips, `animate-pulse` and `ring-2` classes present (screenshot confirms the orange pulsing border).

### Recently completed (iter-144, 2026-07-19) — Phase C · Gallery + In-app polish + extended intents
- **Extended intents** (`Workspace.jsx`): 3 new voice-command shortcut intents — `?intent=hollow` → "make this hollow with 2 mm walls", `?intent=add-hole` → "add a 5 mm hole through the top", `?intent=printable` → "make this printable without supports". Each routes through the existing `parseTranscript` + `executeCommand` pipeline against the current selection. If the scene is empty, we surface an actionable hint toast instead of failing silently. Landing.jsx now surfaces 3 matching use-case cards (Hollow, Add hole, Print without supports) that link to these intents.
- **C1 · Gallery categories** (`Gallery.jsx`): Rewrote the frontend category list to match the backend `gallery_taxonomy.py` (which already had all 7 categories the user asked for). Chips now render: Household, Tools, Organizers, Replacement Parts, Toys, Education, Cosplay, Mechanical, Decorative, Misc — in the same order the backend serves them, so category-filter URLs work consistently.
- **C1 · Featured Creators + Customize CTA**: Both already shipped — `FeaturedCreators` component + `Customize · fit bed` and `Customize in ForgeSlicer` buttons on every gallery item. Confirmed via source scan, no changes needed.
- **C2 · Triangle-count guardrails** (`lib/exporters.js`, `toolbar/projectActions.js`): Two-tier warning. Threshold 1: **150k tris** → soft "Heavy mesh" toast. Threshold 2: **500k tris** → strong "Very heavy mesh" toast with a **"Decimate now"** action button that opens the Printability report dialog via `forgeslicer:open-dialog { name: "printability" }`.
- **C3 · Competitive comparison strip** (`Landing.jsx`): Added an 8-row "Why ForgeSlicer?" table on the homepage comparing to Tinkercad / Fusion 360 / Blender with ForgeSlicer highlighted in orange. Non-combative — links out to the `/tinkercad-alternative` SEO landing for the deep-dive.
- **E2E playwright**: Landing → 9 use-case cards + 8-row comparison table; `/workspace?intent=hollow` → URL scrubbed after handling; `/gallery` → all 7 requested categories present, `missing from wanted: []`.

### Recently completed (iter-143, 2026-07-19) — Intent-wiring + Phase B · SEO/AI polish
- **Intent-wiring** (`Workspace.jsx`): Wired the homepage use-case cards. `?intent=text-nametag` drops a Text primitive + hint toast, `?intent=drawer-organizer` and `?intent=bracket` drop a Box primitive with tailored next-step guidance, `?intent=import-repair` triggers the topbar Import button. Handled-ref guards against effect re-runs; URL is scrubbed with `replace: true` after handling so a refresh doesn't re-fire.
- **B1 · SEO landing content pass** (`seo/landings.js`): Corrected the AI provider messaging across all Meshy-referencing pages (tinkercad-alternative, ai-3d-design, 3d-printing-cad, prusaslicer-workflow). Every reference now credits **fal.ai (default, Hunyuan3D) + Meshy.ai (optional fallback)** as independent third-party providers, matches iter-132 provider swap + iter-142 marketing sweep.
- **B2 · /learn audit**: 8 lessons in `learn/lessons.js` (365 lines, ~45 lines each) — content is already comprehensive and Meshy-free. No changes needed.
- **B3 · AI panel example-prompt chips** (`AIGenerateDialog.jsx`): Added `ai-prompt-examples` row below the Text tab textarea with 5 tested prompts ("a simple phone stand", "a low-poly fox keychain", "a cable clip for a desk edge", "a hex-shaped planter, 60 mm wide", "a nametag base with rounded corners"). Clicking a chip populates the textarea and clears any stale preview thumbnails.
- **E2E playwright**: `/workspace?intent=text-nametag` → text primitive dropped, URL cleaned. `/ai-3d-design` intro contains fal.ai + Meshy.ai + "independent third-party AI providers". AI dialog Text tab shows 5 chips; clicking populates the input.

### Recently completed (iter-142, 2026-07-19) — Phase A · Marketing site trust + clarity
- **Scope**: First phase of the ChatLLM-driven marketing review. Focus was quick wins on the homepage, working around scaffolding that already existed (Trust hub, changelog, roadmap, Learn, SEO landings, ReleaseNotesDialog, SplashScreen).
- **A1 · What's-new bell button on the landing header** (`Landing.jsx`): Added a Sparkles icon button (`landing-whats-new-btn`) that dispatches `forgeslicer:show-release-notes` — same event the workspace `whats-new-btn` fires. Also fixed a latent bug in `ReleaseNotesDialog.jsx` where an early return inside the useEffect skipped registering the manual-trigger event listener on non-product routes, silently killing the topbar pin on the landing page. Manual triggers now work everywhere; auto-open remains route-gated to `/workspace`, `/gallery`, `/profile`.
- **A2 · 4-step workflow strip** (`Landing.jsx`): New `landing-workflow-strip` section between the hero and the tab content. Renders "Design or import → Edit in the browser → Check printability → Export or slice" with per-step accent colours + icons. Explains the actual pipeline while keeping the "Design. Speak. Slice. Print." tagline for personality.
- **A2 · AI provider messaging fix**: Hero subheadline + Design-by-Conversation attribution now correctly credit **fal.ai (default, Hunyuan3D) + Meshy.ai (optional fallback)** as third-party providers, aligning with the iter-132 provider swap. Removes the stale "Meshy.ai only" language.
- **A4 · Use case card strip** (`Landing.jsx`): 6 benefit-focused cards — Name tag, Replacement part, Drawer organiser, Bracket, Photo lithophane, Classroom project — each linking directly into the workspace with an `intent` query param the workspace can hook into later for preset selection.
- **A3 · Trust footer**: Already comprehensive from iter-105.38 — no changes needed. 6-link Trust column, Workflows column, Product column, brand summary. Confirmed via screenshot.
- **E2E smoke** (playwright): landing loads with no auto-modal, sparkle button opens ReleaseNotesDialog with 40 entries newest-first (v1.23.1 top), workflow strip renders 4 steps, use case grid renders 6 cards. All lint clean.

### Deferred / next phases
- **Phase B** (SEO / Learn / AI positioning): SEO landings already exist at `/tinkercad-alternative`, `/edit-stl-online`, `/ai-3d-design`, `/browser-cad`, `/orcaslicer-workflow`, `/bambu-studio-workflow`, `/prusaslicer-workflow` — content pass to be done. `/learn` scaffolded (8 lessons per footer). AI panel example-prompt cards not yet added.
- **Phase C** (Gallery + in-app polish): Gallery tag/category filter, Featured Creators strip, "Customize in ForgeSlicer" CTA, in-app triangle-count guardrails, group/ungroup + align/distribute, competitive comparison strip.

### Recently completed (iter-141, 2026-07-13) — One-click background remover in Photo-to-Plane
- **User request**: Extend the Photo-to-Plane / Lithophane dialog with a background remover so JPGs (or PNGs without alpha) can produce silhouette meshes without external editing.
- **Fix** (`lib/heightmap.js::imageToLuminance`): New optional `bgRemove: { enabled, tolerance /* 0-100 */, sample /* {r,g,b} | null */, result /* out param */ }`. When enabled, auto-samples the median RGB across four 6% corner patches (or uses the caller-provided colour), then marks any pixel within `tolerance × 130` colour-distance units as transparent (`alpha[i] = 0`). Merges with the existing alpha channel so it composes with an already-transparent PNG. Writes the auto-sampled colour back through the `result` out-param so the UI can render a swatch.
- **UI** (`PhotoToPlaneDialog.jsx`): New "Remove background" checkbox with a collapsible sub-panel containing the auto-sampled colour swatch, RGB label, and a tolerance slider (default 35, range 0-100). Preview canvas already renders the checkerboard over transparent regions (iter-140), so the effective silhouette is visible instantly.
- **E2E smoke**: JPG with a white background + a circular subject + dark rectangular features → auto-sample detects `rgb(255,255,255)`, preview corner turns from `(0,0,0)` → `(55,55,55)` (checkerboard), generated mesh is a **circular silhouette** of the subject (15,556 tris, 55.8×55.8×3.6 mm) — white background completely carved out.
- **Tests**: 14/14 heightmap unit tests still pass. `bgRemove` internals rely on canvas which jsdom doesn't fully support — validated via playwright.

### Recently completed (iter-140, 2026-07-13) — Alpha-aware Lithophane / 2.5D Relief
- **User feedback (with screenshots)**: The prior fix went to the wrong pipeline. The PNG heightmap on the "Lithophane / 2.5D Relief" tool (client-side `lib/heightmap.js`, NOT the backend `bas_relief_service`) produced a spiky rectangular plate because transparent PNG pixels read back as `RGBA(0,0,0,0)` → luminance 0 → after invert=1 → full relief height. JPG "worked" but still emitted a rectangular plate ignoring the intended circular subject.
- **Fix** (`frontend/src/lib/heightmap.js`):
  - `imageToLuminance` now scans for α<250 and, if present, returns a per-pixel `alpha` Float32Array. Also re-composites the canvas over neutral grey (128) after reading alpha so semi-transparent edges no longer inject false luminance.
  - `buildHeightmapMesh` accepts an optional `alpha` param. Quads whose 4 corners aren't all opaque (α ≥ 0.5) are skipped from both top + bottom surfaces; walls are emitted at every solid-vs-transparent boundary so the mesh stays watertight regardless of silhouette shape. Omitting the param preserves the legacy rectangular plate for JPGs.
- **UI** (`PhotoToPlaneDialog.jsx`): Preview canvas renders a dark checkerboard over the transparent regions so the user immediately sees the effective silhouette before generating.
- **Tests** (`heightmap.test.js`): Updated the "bottom stays flat" / "tall pixels are tall" cases to work with the new per-quad interleaved emission order; added `iter-140 — alpha mask carves the mesh silhouette` and `iter-140 — alpha omitted reproduces legacy triangle count`. **14/14 pass** (+ 4 canvas-context-required cases skipped in jsdom as before).
- **E2E**: Live UI smoke — uploaded a 256×256 RGBA circle with dark rectangles inside, preview corner sampled at RGB `(55,55,55)` (checkerboard, not white), Generate emitted 28088 triangles, mesh appeared in the viewport as a **circular medallion** silhouette with the dark rectangles as recessed features. ✅

### Recently completed (iter-139, 2026-07-13) — Alpha-aware bas-relief silhouette + inversion fix
- **User feedback**: The bas-relief output was "almost the inverse" of what it should be. Two root causes: (1) `Image.convert("L")` silently dropped the alpha channel, so PNGs with the transparency-viewer checkerboard baked into their bytes were being read as noisy rectangular heightmaps. (2) The mesh silhouette was hardcoded to the inscribed disc, ignoring the circular alpha the user had painted.
- **Fix** (`bas_relief_service.py::_to_heightmap`): Rewrote to detect an alpha channel, composite RGB over neutral grey (128) before grayscale conversion so semi-transparent fringes don't inject false heights, trim the image to the alpha's bounding box so the user-specified diameter maps to the actual subject extent (not to the transparent padding), and return an alpha mask alongside the heightmap. `generate_bas_relief` intersects that alpha mask with the inscribed disc to form the mesh silhouette — an all-transparent image falls back to the geometric disc so the operator never emits an empty mesh.
- **Default confirmed correct for reflective use**: `dark_is_high=False` (default) → bright pixels sit HIGH → light reflects off the raised subject. Verified with a synthetic gradient PNG.
- **UI copy** (`BasReliefTab.jsx`): Rewrote the hint text — clarifies reflective (default) vs lithophane use, and calls out that PNG alpha becomes the silhouette.
- **Tests**: 3 new `TestAlphaAware` cases (`test_alpha_becomes_silhouette`, `test_bright_pixels_are_high_by_default`, `test_fully_transparent_png_falls_back_to_disc`). Full bas-relief suite: **20/20 pass**.
- **E2E curl**: RGBA PNG with a 512-px alpha circle + dark trees at 100 mm target → medallion.stl bbox = 99×99×12.6 mm, peak Z lands on the light stone (0.78 × 12 + 3 = 12.55) ✓ silhouette respects alpha, brightness map is upright.

### Recently completed (iter-138, 2026-07-13) — Selective Thicken + Bas-Relief split
- **User feedback**: (1) iter-137's `thicken_walls` used a global Minkowski sum which grew the entire silhouette — walls that were already thick got inflated too. (2) The bas-relief ring was welded to the medallion as a single body — the user wanted two separate parts so they can be printed in different colours / swapped.
- **Selective `thicken_walls`** (`mesh_optimize_service.py`): Rewrote from Minkowski to per-vertex ray-cast + normal-offset. Samples up to 8000 vertices, shoots an inward ray along each vertex's normal to measure LOCAL wall thickness, then displaces only the thin ones outward by `(target − thickness)/2` (the opposite wall contributes the other half). Includes a linear feathering ramp over `[target, target·1.5]` to blend transitions and a 5% safety overshoot so the analyzer definitively passes. Un-sampled vertices inherit the correction via a 4-pass mesh-graph max-diffusion. New API: `target_thickness_mm` (default 1.2 mm — matches the analyzer's threshold) replaces `offset_mm`. Verified: 20 × 20 × 0.5 mm thin plate → Z grows, X/Y silhouette preserved (naive Minkowski would grow by 2·offset on every axis); analyzer score returns to 100.
- **Bas-Relief split** (`bas_relief_service.py`, `server.py`): Refactored to emit medallion + ring as SEPARATE closed meshes. New `_build_annulus_mesh` helper generates a clean washer-shaped ring; medallion pipeline unchanged (single disk at `diameter_mm`). When `ring_enabled=True`, `/api/ai/generate/bas-relief` bundles both STLs into an `application/zip` response with entries `medallion.stl` + `ring.stl`; when disabled, the endpoint returns the legacy single-STL body (backwards compatible). New response header `X-Optimize-Parts` ("1" or "2") lets the client route the response without inspecting Content-Type.
- **Frontend** (`BasReliefTab.jsx`): Uses JSZip to unpack the ZIP and import each STL as a separate scene object via `addImportedMesh` (colour them independently on the plate). Legacy single-STL path preserved. UI hint updated: "Add frame ring (separate part — colour it independently)".
- **Frontend** (`PrintabilityReportPanel.jsx`, `meshOptimizeApi.js`): Renamed `offsetMm` → `targetThicknessMm` (default 1.2 mm); Auto-Fix orchestrator + per-issue Fix button pass the new param.
- **CORS** (`server.py`): Extended `expose_headers` with `X-Optimize-Parts`, `X-Optimize-Target-Mm`, `X-Optimize-Thin-Verts-Fixed`.
- **Tests**: 4 fresh `TestThickenWalls` cases (selective behaviour, silhouette preservation, bulky mesh no-op, param validation). Updated `test_iter136_1_ring_api.py` (ZIP+2 STLs assertion) + `test_iter137_thicken_http.py` (target_thickness_mm param, selective bbox growth). Full suite: **512/518 pass** — the 6 failures are all pre-existing external upstream flakes (fal.ai balance exhausted, billing catalog network). All iter-136 through iter-138 tests green.
- **E2E curl**: `/api/ai/generate/bas-relief` w/ ring returns `application/zip` (2 STLs, X=100 medallion + X=120 ring); w/o ring returns single STL. `/api/printability/thicken-walls` w/ 0.5 mm plate returns thickened STL with `X-Optimize-Thin-Verts-Fixed=8`, analyzer score 85 → 100.

### Recently completed (iter-137, 2026-07-13) — Thicken Walls Auto-Fix + BasReliefTab extraction
- **User request**: (P0) Extract `BasReliefTab.jsx` from `AIGenerateDialog.jsx` for maintainability. (P1) Ship the `thicken_walls` Printability Auto-Fix endpoint (was a placeholder toast). User chose Manifold-based Minkowski-sum offset (option 1b) over vertex-normal offset, batched with the refactor (option 2a).
- **Backend** (`mesh_optimize_service.thicken_walls`): New function using `manifold3d.Manifold.minkowski_sum` (morphological dilation). Approach: `result = mesh ⊕ ball(offset_mm)` with a 20-segment low-poly ball. Meshes with >6000 faces are pre-decimated first (Minkowski scales as O(faces_A × faces_B) per the manifold3d docs — a 200K-tri AI mesh would explode). Validates offset in [0.05, 5.0]; rejects with 422 if mesh is non-manifold ("run Auto-Clean first"). Empirical: 20×20×0.5 mm plate → +0.5 mm offset → 21×21×1.5 mm output (bbox grows by 2·offset per axis, exactly as expected).
- **Route** (`routes/printability.py`): `POST /api/printability/thicken-walls` — multipart form `file` + `offset_mm` (default 0.5) + `file_type`. Auth-gated identical to `decimate`/`add-base`. Response headers: `X-Optimize-Offset-Mm`, `X-Optimize-Faces-Before`, `X-Optimize-Faces-After`, `X-Optimize-Pre-Decimated`. 400 on unsupported ext, 413 on >100MB, 422 on bad offset / non-manifold input, 503 if manifold3d ever missing at runtime.
- **Frontend** (`lib/meshOptimizeApi.js`): New `thickenWallsImportedObject(obj, { offsetMm })` that exports geometry → POSTs → parses response STL back into a merged BufferGeometry with re-computed bbox. Returns `{ update, stats: { offsetMm, facesBefore, facesAfter, preDecimated } }`.
- **Frontend** (`PrintabilityReportPanel.jsx`): Wired up `runThickenWalls(0.5)`, added `thicken_walls` branch to `handleFix`, and included it in the Auto-Fix orchestrator between Auto-Clean and Decimate (Minkowski runs BEFORE decimate to preserve subtle wall geometry). Auto-Fix visibility check extended so the button appears whenever any of the 4 fixable codes is present. Placeholder "coming in the next update" toast now fires only for `voxel_remesh` / `reorient`.
- **Refactor** (`components/BasReliefTab.jsx`): New 254-line component extracted from AIGenerateDialog. Uses `forwardRef` + `useImperativeHandle` to expose `submit()` so the shared footer CTA can still trigger generation without duplicating slider state. Parent `AIGenerateDialog.jsx` shrank 1241 → 1049 lines.
- **Tests**: 4 new `TestThickenWalls` cases in `test_mesh_optimize.py` (bbox growth, thin_walls resolution end-to-end, offset bounds validation, pre-decimation flag). Full suite: **531 tests pass** (23 in this file). Manual curl smoke: thin-plate score 85 → 100 after thicken (`thin_walls` issue resolved).
- **E2E smoke**: Bas-Relief tab still renders identically after extraction — all 7 test IDs (`bas-relief-diameter`, `-max`, `-base`, `-smooth`, `-invert`, `-ring-toggle`, `ai-submit-bas-relief-btn`) present, ring toggle reveals `bas-relief-ring-panel`, no console errors.

### Recently completed (iter-136.1, 2026-07-13) — Frame Ring on the Bas-Relief tab
- **User request**: Enhance iter-136 by adding an optional raised outer ring (the wooden-circle border seen on traditional Japanese Cork Art pieces).
- **Backend** (`bas_relief_service.py` + `server.py`): three new params — `ring_enabled` (bool), `ring_width_mm` (mm), `ring_height_mm` (mm). When enabled, the mesh's outer diameter becomes `diameter + 2*ring_width`; the ring band sits at a constant `base + ring_height` above the plate. Nested masks (`outer_mask`, `centre_mask`) keep the subject relief entirely inside the original diameter. `total_height_mm` returns the greater of `base + max_relief` and `base + ring_height` so importers auto-size correctly. Pydantic bounds intentionally OMITTED on the ring params — the service enforces them conditionally so `ring_enabled=false` requests never 422 on stale slider values.
- **Response headers**: 4 new — `X-Optimize-Outer-Diameter-Mm`, `X-Optimize-Ring-Enabled`, `X-Optimize-Ring-Width-Mm`, `X-Optimize-Ring-Height-Mm`. CORS `expose_headers` updated.
- **Frontend** (`AIGenerateDialog.jsx`): new "Add frame ring" toggle below the Invert checkbox on the Bas-Relief tab. When enabled a collapsible sub-panel reveals Ring Width and Ring Height sliders (`data-testid="bas-relief-ring-width"` / `-height`) and a live "Outer diameter with frame: X mm" readout.
- **Testing (iter-136.1): 100% pass** — 17/17 service unit tests (6 new `TestFrameRing`), 8/8 new API integration tests, 11/11 iter-136 regression tests, 100% frontend flow verified (toggle default off + panel not in DOM → enable → sliders + realtime outer diameter → generate → mesh imported with expected bbox). **Full backend suite: 525/525 pass.**


- **User request**: AI-to-3D providers stubbornly turn a reference image into a full stereoscopic model. User needs the OPPOSITE — a circular disk (200-250 mm ⌀, 12-15 mm max thickness) with the subject rendered as a shallow relief on top. Traditional "Japanese Cork Art" style, single-color print, wall/stand decorative.
- **Solution — pure geometry pipeline (no AI, no cost)**:
  - `/app/backend/bas_relief_service.py` (new). Loads reference image → grayscale → optional invert (`dark_is_high`) → optional Gaussian smooth → down-sample to `grid_size²` (default 512) → circular mask → build a solid disk mesh: displaced-heightmap TOP + flat bottom + straight cylindrical rim → emit STL bytes.
  - Runs on trimesh + PIL + numpy. ~2 s for a 220 mm × 512-grid disk (~800K triangles).
  - No fal.ai / no Meshy → does NOT count against the monthly AI quota.
- **New endpoint `POST /api/ai/generate/bas-relief`** accepts `image_b64` OR `image_url`. Parameters: `diameter_mm 60..380` (default 220), `max_relief_mm 0.5..40` (default 12), `base_thickness_mm 0.6..20` (default 3), `dark_is_high`, `smooth_sigma 0..10`, `grid_size 128..800`. Streams STL back with `X-Optimize-Diameter-Mm / Max-Relief-Mm / Base-Thickness-Mm / Total-Height-Mm / Faces / Grid-Size` headers.
- **New AI dialog tab** (`AIGenerateDialog.jsx`): amber-accented "Bas-Relief" tab with `data-testid="ai-tab-bas-relief"`. Panel has 4 sliders (diameter / max relief / base thickness / smoothing), an Invert checkbox, and a circular image preview. CTA: amber "Generate Bas-Relief" button. STL streams back → auto-imports at exact mm scale → dialog auto-closes with a "Bas-relief disk ready · 220 mm × 15.0 mm thick" toast.
- **Testing (iter-136): 100% pass** — 11/11 new backend API tests, 10 new unit tests, 31 frontend UI checks (all sliders realtime, quota unchanged, mesh imported at correct dimensions). Zero regressions on existing tabs.
- **Note for future**: `_build_disk_mesh` currently uses Python for-loops; vectorising with numpy stride tricks would drop ~2s → ~0.3s at max grid. Deferred until users report the current latency.


**Part A — Printability fix UI (P1)**
- **New client** `/app/frontend/src/lib/meshOptimizeApi.js` — `decimateImportedObject(obj, preset)` and `addBaseToImportedObject(obj, {shape, thicknessMm, marginMm})`. Exports the object's geometry to binary STL, POSTs multipart to the iter-134 endpoints, parses the STL response back to a `BufferGeometry` update, and returns stats parsed from `X-Optimize-*` headers.
- **`PrintabilityReportPanel.jsx`** — `handleFix` now dispatches `decimate_with_intent` → real `runDecimate("functional")` and `add_base` → real `runAddBase("cylinder", 3.0, 2.0)`. Same pushHistory-first pattern as `runAutoClean` (Ctrl+Z reverts). Skips non-imported primitives with a helpful toast.
- **Auto-Fix orchestrator** — new orange-gradient button at the top of the report card (`data-testid="printability-auto-fix"`). Runs the safe fixers in sequence (auto_clean → decimate → add-base) based on which `fix_action` codes appear in the current report. Sequential (`await step.run()`) so later steps see fresh geometry.
- **Testing: 100% pass** — 77/77 backend (64 existing + 13 new iter-135 targeted). Frontend Auto-Fix flow verified end-to-end via Playwright (real STL injection → click → toast sequence → mesh mutated → report re-ran).

**Part B — admin.py + auth_local.py refactor (P2)**
- **`admin.py`** `_register_user_admin_routes` (~145 LOC) split into 3 focused sub-registrars: `_register_user_list_routes` (read), `_register_user_privilege_routes` (promote/quota/contributor), `_register_user_safety_routes` (ban/session-kill). New `_admin_user_row(u, usage)` helper for row serialization.
- **`admin.py`** `_register_pricing_routes` extracted `_serialize_pricing_row(db, pid, pkg)` and `_build_pricing_override(pid, p, catalog)` helpers. `get_pricing` becomes a one-line dict-comprehension.
- **`auth_local.py`** `_register_password_routes.register` extracted `_attach_password_to_google_account(existing, req)` (auth-method merge) and `_create_password_user(req)` (fresh user) helpers. `register` body is now a clean happy-path read.
- Behavior-preserving. 57/57 admin + auth tests continue to pass; testing agent verified endpoint response shapes are byte-identical.



**Part A — Pre-existing test failures fixed (P1 done)**
- `test_projects.py` — hard `os.environ["TOKEN_A"]` requirement replaced with an in-file `_seed_session` helper that upserts ephemeral users + 7-day session tokens directly into Mongo. Test now runnable both in CI and locally without external prep. **8/8 pass.**
- `test_iter15_smoke.py` — aarch64 Orca `version` banner assertion loosened: on preview pods the flatpak wrapper reports `installed=True` but the underlying binary can be absent, so `version` may legitimately be `None`. Test now asserts payload shape + a non-empty version when present. **All pass.**
- `test_admin.py` — `/admin/users` returned 500 because two legacy user docs lacked a `user_id` field. `admin.py` now skips such rows with a warning log instead of KeyError-ing. **All pass.**
- `test_iter132_2_preview.py` — shared test user accumulated 13 real fal.ai gens over prior runs and hit the 13/month cap. Fixture now sets `ai_quota_override: 250` and zeros `ai_usage.count` on the test user before each test. **14/14 pass.**
- **Full backend suite: 476/476 pass, 0 failed.** Was 435 → +6 files re-enabled.

**Part B — Phase 1 mesh optimization**
- **Thin-wall detection** in `printability_service._check_thin_walls`. Ray-cast inward normals on a 2000-vertex random sample; flags vertices where wall thickness < 1.2 mm. Severity scales with thin-fraction (MINOR / MAJOR). New issue code `thin_walls` with `fix_action: thicken`.
- **New service module** `/app/backend/mesh_optimize_service.py`:
  - `DECIMATE_PRESETS` = `mini` (25 K faces, tabletop mini) / `functional` (12 K, mech parts) / `low_poly` (3 K, faceted art). Each has a `min_faces` floor so tiny meshes aren't destroyed.
  - `decimate_with_intent(mesh_bytes, preset)` — quadric decimation via `simplify_quadric_decimation(face_count=…)`. Silhouette-preserving fallback to 5% simplification if mesh is already under target.
  - `add_auto_base(mesh_bytes, shape, thickness_mm, margin_mm)` — cylinder or rectangle base sized to bbox footprint + margin, boolean-unioned via `manifold3d`. Concatenation fallback if union fails.
- **New endpoints** on `/api/printability`:
  - `GET /decimate-presets` — auth-gated listing of the 3 presets
  - `POST /decimate` — multipart STL + preset → decimated STL + `X-Optimize-*` headers
  - `POST /add-base` — multipart STL + shape/thickness/margin → fused STL + `X-Optimize-*` headers
- **CORS** — added `expose_headers` list so the browser can read `X-Optimize-*` from the response via fetch.
- **Deps**: `fast_simplification==0.1.13` added (trimesh backend for `simplify_quadric_decimation`).
- **Tests**: `/app/backend/tests/test_mesh_optimize.py` — 17/17 tests locking presets, shape validation, thin-wall triggers on 0.5 mm plate, silence on bulky sphere, degenerate-mesh safety, STL round-trip.
- **Smoke test**: curl'd both endpoints via preview URL — decimate 20 480 → 3 000 faces (85.35% reduction) in ~1s, add-base fused sphere + cylinder → 8 700 faces successfully.


- **User request**: Implemented the iter-132 finish-summary enhancement — generate ~$0.001 Flux Schnell reference images so users can pick the best preview BEFORE spending ~$0.16 on the full Hunyuan3D generation.
- **New backend**: `POST /api/ai/preview/images` (body: `prompt`, `art_style`, `count 1-4`) returns `{urls, count, prompt}`. Fal.ai-only — Meshy BYO users get 409 with an explanation. Not counted against the 3D-generation cap (previews are 150× cheaper).
- **Extended backend**: `POST /api/ai/generate/image` now accepts EITHER `image_b64+mime_type` (original) OR `image_url` (from a preview). http(s) only; image_url wins when both present. Response includes `provider` field.
- **New frontend UX** in `AIGenerateDialog.jsx` (text mode):
  - "Preview images first" button (cyan) below the prompt (fal.ai users only)
  - 4-thumbnail grid appears once previews load; click to select (cyan ring + "SELECTED" badge)
  - Primary CTA switches from "Generate" (fuchsia, direct text-to-3D) to "Generate 3D from preview" (cyan, commits selected URL to Hunyuan3D)
  - "Regenerate previews" & "Clear" secondary actions
  - Prompt edits auto-clear the preview grid so stale thumbnails can't mislead
  - Preview state resets on dialog close
- **New service function**: `fal_service.generate_preview_images(prompt, num_images)` — Flux Schnell batch mode (max 4 images).
- **Testing (iter-132.2): 100% pass** — 14/14 backend integration tests + 10/10 frontend UX assertions. Zero bugs, zero regressions. Real Flux Schnell calls succeed (~3-8s for 4-image batch).


- **User decision**: Chose Hunyuan3D **Pro** (`fal-ai/hunyuan3d/v2`, ~$0.16/gen) over Turbo for higher-fidelity geometry. Text-to-3D uses a 2-step pipeline: `fal-ai/flux/schnell` → Hunyuan3D v2.
- **Selection order** (in `_pick_ai_provider(user)`):
  1. User has a personal Meshy key (BYO) → **Meshy** (premium, no cap counter)
  2. FAL_KEY configured → **fal.ai** (default, cap counter applies)
  3. Platform MESHY_API_KEY configured → Meshy (legacy fallback)
  4. Else → 503
- **New backend module**: `/app/backend/fal_service.py` — mirrors Meshy interface (`is_configured`, `create_text_to_3d`, `create_image_to_3d`, `create_multi_image_to_3d`, `get_task`, `pick_model_url`, `download_mesh`, `FalHTTPError`). Text-mode returns `<request_id>|<flux_image_url>` so `/api/ai/jobs/{id}` can preview the intermediate reference image.
- **Provider tracked per job**: `ai_jobs.provider` field ("fal"/"meshy"); polling & mesh-download route to the correct service via `_provider_module(name)`. Legacy jobs without the field default to Meshy for backward compat.
- **`GET /api/ai/usage`** now returns `active_provider` ("fal"/"meshy") so the frontend UI can attribute correctly.
- **Frontend** (`AIGenerateDialog.jsx`): "Powered by …" chip branches on `usage.active_provider` (`data-testid=ai-generate-provider-attribution`). Meshy attribution → fuchsia + "using your personal API key"; fal.ai → cyan + "3D generation integrated into ForgeSlicer".
- **Error handling**: FalHTTPError translated to 502 with fal.ai's own message (e.g. "Exhausted balance. Top up..."). Network errors → 504 with retry hint. Mesh download route hardened per testing agent feedback (iter-132.1: `RequestError`/`TimeoutException` → 504 instead of bare 500).
- **Testing (iter-132)**: **100% pass** — 25/25 (11 unit + 14 integration). All 9 acceptance criteria validated by `testing_agent_v3_fork`. Provider dispatch, refund logic on 502, `provider` persisted on new jobs, legacy jobs default to Meshy, active_provider correct for both BYO and default users.
- **Multi-image caveat**: Hunyuan3D v2 on fal.ai is single-view; multi-image uploads use only the first image (documented). Meshy BYO users still get true multi-view fusion.
- **Config**: `FAL_KEY` in `/app/backend/.env`. `fal_client==1.0.0` in `requirements.txt`.


- **User request**: Instituted the enhancement idea from iter-130 — "Copy dimensions" one-click clipboard action.
- **Behaviour**: Small pill-button in the bottom-right of the viewport (`data-testid='copy-dimensions-btn'`) that appears ONLY when (a) DIMS mode is on AND (b) exactly one component is selected. One click copies a multi-line, human-readable measurement summary to the clipboard:
  ```
  ForgeSlicer measurement — <object name>
  Bounding box:  W 20.00 mm × D 20.00 mm × H 20.00 mm
  Position:      X 0.00 mm  Y 0.00 mm  Z 0.00 mm
  Ruler origin:  1.00 mm, 2.00 mm, 3.00 mm         (only if workplane ruler placed)
  Relative pos:  X -1.00 mm  Y -2.00 mm  Z -3.00 mm (only if workplane ruler placed)
  Ruler:         ΔX +20.00 mm  ΔY +20.00 mm  ΔZ +20.00 mm  ‖ 34.6410 mm  (only if anchor+target set)
  ```
- **Respects the mm/in unit toggle** (3-decimal precision + " in" suffix in inch mode).
- **UX polish**: button flips to emerald "Copied ✓" state for 1.5s + sonner toast fires. Falls back to `execCommand('copy')` when the browser lacks a secure context.
- **File**: `/app/frontend/src/components/viewport/CopyDimensionsButton.jsx` (new); mounted from `Workspace.jsx`.
- **Testing (iter-131 → 131.1)**: 100% pass (6/6). Fixed one bug during dev — workplane-origin lines emitted unconditionally because `workplaneRuler.origin` defaults to `[0,0,0]` (truthy); added `workplaneRuler.active` gate.


- **User report**: "The measurement I am trying to see is still covered by another label. I can spin the bed and around to finally see it; but, I shouldn't have to do that." — screenshot showed H/Y/Z position chips + TOP peak chip + workplane origin all cluttered, with some visually stacked and hidden.
- **Root cause**: (a) dim H chip + all 3 position chips X/Y/Z were pushed to the same WEST screen quadrant (screenOffset x=-24..-54) causing predictable pile-ups; (b) drei `<Html>` wrappers for read-only chips had default `pointer-events:auto` DOM boxes at their un-translated screen anchors — invisible pointer barriers that blocked :hover on any chip whose bbox fell inside them.
- **Fix** (`SelectionDimLabels.jsx`, `WorkplaneRuler.jsx`, `RulerLayers.jsx`):
  - Position chips X/Y/Z moved from WEST (-54px) to SOUTH-EAST (+46px x) — opposite quadrant from H dim chip
  - Dim chip separations bumped to ±32px so leader lines can breathe
  - TOP/TIP peak chip pushed 44px up (was 24px); workplane origin label pushed diagonally SE
  - Chip background opacity dropped to 0.32 (was 0.55) so occluded text bleeds through
  - New `.forge-chip-hover` module-scope CSS: any hovered chip → opacity 1, z-index 200, bg 0.95
  - All read-only `<Html>` wrappers (peak-chip, origin-label, ruler-dim ×4, pinned-dim ×4) got `style={{ pointerEvents: 'none' }}` so they no longer intercept hover on chips beneath
- **Testing (iter-129 → 130)**: 100% pass. `page.hover(dim-label-h)` now succeeds; computed z-index flips to 200; every chip is independently hoverable regardless of screen-space overlap. 5/5 sibling chips (W/D/pos-x/y/z) verified working.


- **User report** (verbatim + illustration): "There are too many ruler selection points on a typical drawing." Screenshots showed 80+ orange rings blanketing the viewport whenever the workplane ruler was activated. RECURRING issue — third occurrence per the previous handoff.
- **User's desired UX** (verbatim spec): "If I select a vertex (or very close to it), that should be my anchor point. If I select an edge, the center point should be my anchor point. If I select the body of a component, the center of the component should be my anchor point. […] The x,y,z distances should be displayed plus the direct distance from anchor to secondary points."
- **New model — feature hierarchy** (`smartSnapForClick` in `/app/frontend/src/lib/rulerAnchor.js`):
  - Corner within 15% of min-bbox-extent → snap corner
  - Else edge midpoint within 30% of min-bbox-extent → snap edge midpoint
  - Else → snap body centre
  - Same rule applies to negative/subtracted shapes (they exist as components → centre wins).
- **Hover preview** (rewrote `/app/frontend/src/components/viewport/RulerPlacementDots.jsx`): the 21-dot cloud is GONE. A single orange crosshair-in-ring appears at the point that WOULD be committed on click, driven by a new `rulerHoverSnap` store slice populated by `SceneObject.onPointerMove`. Ring outer radius scales with snap kind (corner 1.0mm / edge 1.4mm / centre 1.8mm) so the user can tell the snap kind at a glance.
- **New total-distance chip** in `RulerAnchorLayer` + `PinnedRulerLayer` (`RulerLayers.jsx`): displays `√(Δx²+Δy²+Δz²)` with 4-decimal precision. Live ruler: cyan, `data-testid=ruler-dim-total`. Pinned: muted amber, `data-testid=pinned-dim-total-<id>`.
- **Rewired click handlers** in `Viewport.jsx`: `onRulerHit`, `onWorkplaneRulerPlace`, and probing all use `smartSnapForClick`. Bed catch-plane now handles probing too (was placing-only).
- **Testing (iter-127)**: **frontend 5/5 PASS · 6/6 unit tests PASS (`rulerAnchor.smartSnap.test.js`) · zero regressions.** Verified: zero pageerrors during hover-snap kind cycling, hover ring renders visually, ruler-dim-total = 34.6410 mm for a corner-to-diagonal-corner measurement on a default 20mm cube, all Δ chips = +20.00 mm, pin/unpin works, mode-toggle clears hover snap. R3F `data-testid` crash from initial run was fixed by removing DOM attributes from scene primitives (tests use `window.__forgeStore.getState().rulerHoverSnap.snapKind` for programmatic assertions).


- **User report**: "If I crop an image, it should be cropped, not made black and then reappear in the lithophane." Screenshots showed a big black band in the source viewport above the visible crop rectangle when TOP:50% was applied. User was on production; suspected the crop was also being ignored by the generator.
- **Root cause**: `Viewport.jsx` used CSS `clip-path` on a full-sized `<img>` inside a fixed-aspect wrapper. Pixels outside the clip were hidden but the DOM box remained the source's aspect ratio → dead space appeared as a black band. The actual generation pipeline (`ensureCurrentImageId → renderEditedImage → /optimize`) was already applying the crop correctly (confirmed by dimensional check: 200×200 source with cropT=45 → generated preview is 200×110).
- **Fix**: replaced the clip-path approach with an `overflow: hidden` wrapper sized to the crop's aspect ratio (`aspectRatio: cw / ch`, `height: 70vh`), and scaled+shifted the underlying `<img>` (`width: 100/cw * 100%`, `height: 100/ch * 100%`, negative margin offsets) so only the crop region fills the wrapper. `CropOverlay` drag handles are now hidden when `cropActive` (users adjust via sliders) since the wrapper no longer represents the full source image's coordinate space.
- **Testing (iter-124)**: **frontend 4/4 crop states PASS · backend 40/40 + 1 new dimensional-crop test PASS · zero issues.** Verified: fresh upload shows crop overlay drag handles; cropT=45 shrinks wrap to 2:1 aspect with no black band; generated preview naturalHeight = 110 (exactly 55% of source 200) confirming the crop reaches /optimize; reset restores 1:1 aspect + overlay; cropT=30 persists across page reload; /workspace + / + /litho/marketplace regression pass.

### Recently completed (iter-134, 2026-07-06) — LithoForge Phase 3: Tier gates + Landing integration
- **User directives** (verbatim): Landing option A (fold into ForgeSlicer's `/`, no separate splash). Perks: Job quota **inherits** from ForgeSlicer; Marketplace publishing **gated**; Export formats **open**; Nozzle/printer count **open**; Filament library **open**; Preset slots **retain current (unlimited)**; Creator payouts **gated**.
- **New**: `/app/backend/litho/tier_gate.py` — stateless helper. `ensure_paid(user)` raises 402 for non-paid tier; `is_paid(user)` non-raising boolean. Accepts both dict and SimpleNamespace user shapes.
- **Gates applied** (only two — everything else stays open):
  - `PUT /api/litho/studio/my-jobs/{job_id}/listing` → 402 for free.
  - `POST /api/litho/studio/payouts/email` → 402 for free.
  - `GET /api/litho/studio/payouts/status` — now returns `eligible: bool` so the frontend can render an upsell state instead of 402 on view.
- **Frontend upsell UX**: `PayoutsPage.jsx` shows a `payouts-upgrade-banner` with a `payouts-upgrade-cta → /pricing` for free users; email input + Save button disabled. `PublishDialog.jsx` 402 catch branch surfaces a Sonner toast with a `See plans` action button that opens `/pricing`.
- **Landing integration** (`Landing.jsx`): new `StartAccordionSection id="lithophane"` between "What It Does" and "How It Works" using the same accordion pattern as siblings so it reads as one product. Content: badge, H3, description, 4-card LithoFeature grid (Photo intake · Auto palette · Layer-swap G-code · Marketplace), two CTAs `landing-lithophane-cta → /litho` and `landing-lithophane-marketplace → /litho/marketplace`.
- **Testing (iter-123)**: **backend 40/40 PASS · frontend 6/6 flows PASS · zero issues.** New `TestTierGates` class + updated `TestPayouts` for `eligible` field + `_promote_to_maker` context manager for the affected marketplace/payouts tests.
- **E2E verified live**: promote user to maker → publish/set-email 200; revert to free → 402; landing Photo → Lithophane accordion renders with both CTAs; `/litho/payouts` upgrade banner visible.

### Recently completed (iter-131, 2026-07-06) — Full LithoForge Phase 2 merge: Marketplace, Checkout, Creator Payouts
- **User directive**: Continue the LithoForge merge — Phase 2 (marketplace). Confirmed choices from iter-129: separate `/litho/marketplace` route with a TopToolbar submenu "Marketplace → Models / Lithophanes"; unified pricing (no separate lithophane tier); no account migration.
- **Backend ports** (all in `/app/backend/litho/`, mounted inside `/api/litho/studio/*` for a single root URL space):
  - `marketplace.py` — listings CRUD (`PUT/GET/DELETE /my-jobs/{job_id}/listing`), browse (`GET /marketplace`), detail (`GET /marketplace/{id}`), preview mesh (`GET /marketplace/{id}/preview-mesh` → STL blob), creator profile (`GET /creators/{user_id}`).
  - `marketplace_braintree.py` — sandbox-mode Braintree checkout (`POST /marketplace/client-token`, `POST /marketplace/{id}/checkout-bt`, `POST /webhook/braintree`, download-token gated STL/3MF export).
  - `paypal_payouts.py` — creator payouts with **auto mock-mode** when `PAYPAL_CLIENT_ID` is empty (which it is). Endpoints: `GET/POST /payouts/{status,email,transactions}`, admin-only `/admin/payouts/{pending,run,batches}`, webhook `/webhook/paypal-payouts`. Real PayPal Payouts wire-in ready — flip the env var to go live.
  - `email_purchase.py` — Resend-backed purchase-confirmation email with download link. Degrades to no-op when `RESEND_API_KEY` is missing.
- **Frontend ports** (`/app/frontend/src/components/litho/components/marketplace/`):
  - MarketplacePage (browse grid), MarketplaceHeader (page chrome, no more UserMenu — deferred to app-level), ListingCard, ListingDetailPage (title, price, filaments, Lithophane3DPreview canvas), Lithophane3DPreview (three.js viewer), PurchaseDialog (Braintree Drop-in card iframe + email input), PurchaseSuccessPage (?token= short-circuit works), CreatorPage, PayoutsPage.
  - Real PublishDialog replaces the Phase-2 stub from iter-129.
- **App wiring**:
  - 5 new React Router routes: `/litho/marketplace`, `/litho/marketplace/:jobId`, `/litho/marketplace/:jobId/success`, `/litho/creator/:userId`, `/litho/payouts` (ProtectedRoute).
  - TopToolbar `SystemRow.jsx` — old standalone Gallery button REMOVED. New `<MarketplaceMenu />` hover-dropdown at the same position with two items: **Models** (→ /gallery) and **Lithophanes** (→ /litho/marketplace). Lithophane creation button (open-lithoforge-btn → /litho) preserved as a separate CTA.
- **Auth context bridge** (iter-131 fix):
  - `/app/frontend/src/components/litho/lib/auth.jsx` rewritten as a shim that re-exports ForgeSlicer's global `@/contexts/AuthContext`. Every LithoForge component's `useAuth` import (JobHistory, PresetManager, LibraryMatchPanel, FilamentLibraryDialog, PurchaseDialog, PayoutsPage, quota.jsx) transparently reads through — no consumer-side edits needed.
  - `AuthProvider` and `AuthCallbackHandler` kept as no-op re-exports so stale imports don't blow up the tree.
- **Testing**:
  - **iter-121**: backend **34/34 pytest PASS** (12 new: TestMarketplace, TestBraintreeCheckout, TestPayouts, TestAdminPayouts, TestPayPalWebhook). Frontend E2E: marketplace-menu renders, /litho/marketplace grid, ListingCard → detail → Buy → PurchaseDialog all work. Two bugs auto-fixed by testing agent: (a) `/preview-mesh` broken imports (`from jobs_history` → `from litho.jobs_history`); (b) ListingCard Link path missing `/litho` prefix. One HIGH-priority bug found: /litho/payouts stuck on "Loading…" (LithoForge AuthProvider never mounted).
  - **iter-122**: **retest post-fix — 100% pass, 6/6 frontend flows, zero issues.** /litho/payouts now loads instantly, PayPal email save persists, no regressions on any other litho page.
- **E2E verified live**: upload 96×96 gradient PNG → optimize → PUT publish "Sunset Gradient" @ $4.99 → marketplace grid renders the ListingCard with CMYKW gradient thumbnail → detail page → Buy button opens PurchaseDialog with Braintree Drop-in.
- **What's still Phase 3+**: unified landing/marketing splash for `/litho` (currently the studio launches directly); merge lithophane perks into ForgeSlicer's pricing tiers; DNS 301s from lithoforge.net → forgeslicer.com/litho; PayPal webhook signature verification (tech debt — code has a TODO); admin quota unification.

### Recently completed (iter-129, 2026-07-06) — Full LithoForge merged into ForgeSlicer (Phase 1)
- **User directive**: "Merge the entire functionality of LithoForge into ForgeSlicer, not just a stripped-down version. The goal is to make LithoForge.net go away." User confirmed: full Studio UX first, unified pricing, no account migration (no publicized signups), strip SSO/handoff shims now.
- **Scope shipped this session (Phase 1 of 5)**: complete Lithophane Studio workspace at `/litho` route + all backend routers to make it stateful.
- **Backend adds** (`/app/backend/litho/`):
  - `presets.py` — user-saved lithophane presets (CRUD `/api/litho/studio/presets`)
  - `jobs_history.py` — persisted job history with thumbnails (GET `/api/litho/studio/my-jobs`); optimize now writes to Mongo for signed-in users
  - `filament_library_api.py` — real-world brand catalog + user's private filaments (`/api/litho/studio/filament-library/*`)
  - `manufacturer_library.py` — 19-brand curated catalog (Bambu, Prusament, Polymaker, Sunlu, Elegoo, eSun, etc.)
  - All wired inside `/app/backend/routes/litho_studio.py` via a shared user-dict-to-SimpleNamespace adapter.
- **Frontend adds** (`/app/frontend/src/components/litho/`, ~11K LOC):
  - LithoStudio.jsx (main page, from LithoForge's App.js)
  - 25 workspace components (ConfigPanel, PaletteEditor, LayerTimeline, Histogram, CompareSlider, Loupe, ZoomPanView, CostSwapSimulator, FilamentLibraryDialog, PresetManager, StatsPanel, LibraryMatchPanel, ImageEditPanel, UploadZone, Viewport, CropOverlay, HelpHint, JobHistory, PrinterSelect, NozzleSelect)
  - Stubs for Header (with in-tree "Back to Workspace" link + primary "Generate lithophane" CTA), MobileShell (passthrough), ModeToggle, PublishDialog (Phase 2 toast), ForgeSlicerSendButton (uses in-app importAnyMeshFile pipeline — no HTTP handoff)
  - Route `/litho` wired in `App.js` behind ProtectedRoute
  - `SystemRow.jsx` and `Landing.jsx` toolbar buttons converted from `openInPeer(lithoforge.net)` to `<Link to="/litho">`
- **Stripped (Phase 5 clean slate)**:
  - Backend: `/app/backend/sso_bridge.py`, `/app/backend/routes/litho_inbox.py`
  - Frontend: `LithoInboxWatcher.jsx`, `LithoStudioModal.jsx` (from iter-128, superseded), `SsoAccept.jsx`, `ssoBridge.js`, `ssoHandoff.js`, `lithoInboxApi.js`
  - Related tests: `test_sso_bridge.py`
  - All `openInPeer` calls, SSO-bridge banner rendering (returns null now), and cross-domain lithoforge.net links replaced with in-app routes
- **Testing (iter-119)**: **22/22 backend pytests pass · 100% frontend E2E pass · zero issues.** Test file: `/app/backend/tests/test_litho_studio.py` extended with TestPresets, TestMyJobs, TestFilamentLibrary, and 404-regression tests for the removed sso-bridge/inbox routes. E2E verified: /litho loads → upload 128×128 PNG → "Suggest palette from photo" → "Generate lithophane" → ΔE 34.65 · 22 Layers · 6 filaments · MEAN 34.65/95PCT 49.48 → STL/3MF/Swap downloads visible → Workspace back button routes to /workspace.
- **What's still Phase 2+** (upcoming): marketplace routes (publish/browse/buy/creator/payouts), pricing tier merge (add lithophane perks to ForgeSlicer's existing tiers), unified admin tab, `/litho` landing/launch marketing page, DNS-level redirect for lithoforge.net → forgeslicer.com/litho.

### Recently completed (iter-128, 2026-07-06) — LithoForge merged into ForgeSlicer as in-app Lithophane Studio (Superseded by iter-129)
- **What**: User uploaded `LithoForge.zip` asking to merge the separate lithophane generator INTO ForgeSlicer as a first-party feature (instead of the old cross-domain redirect to lithoforge.net).
- **Backend port** (`/app/backend/litho/`): 6 core engine files copied verbatim — `lithophane.py` (CMYKW optimizer core, 900+ lines), `exporters.py` (STL/3MF/lightbox builders), `palette_suggest.py` (K-means Lab palette picker), `printers.py` (56 profiles across 7 vendors), `cost_estimator.py`, `lightbox.py`. Intra-package imports rewritten to relative imports. New router `/app/backend/routes/litho_studio.py` exposes `/api/litho/studio/*` under ForgeSlicer's existing `get_current_user` auth dep.
- **New endpoints** (all under `/api/litho/studio`): `GET /filaments/default`, `GET /filaments/library`, `GET /printers`, `GET /printers/{id}/fit`, `POST /palette/suggest`, `POST /upload` (base64 PNG/JPG), `POST /optimize` (image → heightmap + preview), `GET /jobs/{id}`, `GET /export/{id}/{stl|3mf|swaps}`. Jobs + uploads kept in a bounded per-process LRU dict (40 uploads, 60 jobs) — ForgeSlicer's own project system handles long-term persistence.
- **Frontend** (`/app/frontend/src/components/LithoStudioModal.jsx` + `/app/frontend/src/lib/lithoStudioApi.js`): compact 3-column modal (config left, preview centre, palette/results right) — Print Size / Layers & Swaps / Geometry / Printer inputs, upload area with source-image preview, Suggest Palette button, Generate button, then result stats (ΔE mean/p95, layers, backlight %, cost estimate) plus 4 action buttons (Send to build plate + STL/3MF/swaps.txt). "Send to build plate" downloads the STL blob → runs it through the same `importAnyMeshFile` pipeline as drag-and-drop → adds the mesh via `addImportedMesh` → closes modal → object appears in the outliner ready to slice.
- **Toolbar rewire**: `SystemRow.jsx` — the existing "LithoForge" button (data-testid `open-lithoforge-btn`) now opens the in-app modal instead of `openInPeer("https://lithoforge.net")`. Old cross-domain fallback preserved only if the modal handler isn't wired (defensive — never triggers in the merged app).
- **Skipped** (intentional): LithoForge's auth, admin, sso_bridge, marketplace, publish, paypal payouts, email service, meshy, VoiceCommand, MobileShell, ErrorBoundary, JobHistory, PricingPage, GlobalUpgradeModal, LandingPage, Header, UserMenu — all covered by ForgeSlicer's superior versions. Kept `LithoInboxWatcher` for backwards-compat with lithoforge.net-hosted users who still push handoffs into ForgeSlicer.
- **Deps**: `scikit-image==0.26.0` + `scikit-learn==1.9.0` added to `requirements.txt` (pip-frozen). No new frontend deps.
- **Testing**: iter-118 test report — **100% pass on 15/15 backend pytest cases + full frontend E2E** (upload → palette suggest → optimize → downloads → send-to-build-plate). Regression: /auth/me, /litho/inbox, /me/meshy-key/status, /printability/analyze all still pass.
- **E2E verified live**: 100×100 gradient PNG → 96×96×2.2 mm lithophane mesh placed on the workspace build plate, Inspector shows "INSPECTOR — IMPORTED · tmplpkb9n7x · on bed", filament color palette + Repair/Lay-Flat/Delete actions all wired.

### Recently completed (iter-127, 2026-07-06) — Auto-Clean: first real Fix handler
- "Fix with Auto-Clean" button now wired to the existing `/api/mesh/repair` pipeline (MeshLab + PyMeshFix + trimesh normal fix).
- Score-delta toast: "Score raised: 42 → 78 · +36 points" after every fix (positive), and warning toasts for zero / negative deltas.
- Per-issue Fix buttons show spinner + disabled state during repair to prevent double-click races.
- Verified live: broken non-watertight cube 70 → 100 (+30 score jump). Full backend suite: **16/16 passed**.

### Strategic pivot (2026-07-04)
**ForgeSlicer is now positioned as an "AI-mesh → printable-file preparation system"** — the missing middleware between AI 3D generators (Meshy, Tripo, Hunyuan3D, TRELLIS) and consumer slicers (Bambu, Prusa, Orca). Not another slicer, not another CAD tool. Owns the workflow-pain wedge nobody else does.

**Approved roadmap:**
- Week 1: Fal.ai Hunyuan3D v2.1 as default provider ($0.05/gen, 8× cheaper than Meshy) — Meshy kept as premium BYO
- **Week 2: Printability Report scoring engine ← ✅ DONE (iter-126)**
- **Week 3-4: Auto-Clean bundle wired to fix_action ← ✅ DONE (iter-127)**
- Weeks 4-5: Decimate-with-print-intent presets
- Weeks 6-7: Auto-Base generator + Thin-wall detection
- Weeks 8-11: Resin MVP (hollow, drain holes, orientation assistant, resin readiness score)
- Ongoing: Batch mode + shareable print-shop preset packs

### Recently completed (iter-126, 2026-07-04) — Printability Report engine (Phase 1B skeleton)
**ForgeSlicer is now positioned as an "AI-mesh → printable-file preparation system"** — the missing middleware between AI 3D generators (Meshy, Tripo, Hunyuan3D, TRELLIS) and consumer slicers (Bambu, Prusa, Orca). Not another slicer, not another CAD tool. Owns the workflow-pain wedge nobody else does.

**Approved roadmap:**
- Week 1: Fal.ai Hunyuan3D v2.1 as default provider ($0.05/gen, 8× cheaper than Meshy) — Meshy kept as premium BYO
- **Week 2 (CURRENT): Printability Report scoring engine ← ✅ DONE (iter-126)**
- Weeks 4-5: Auto-Clean bundle + Decimate-with-print-intent
- Weeks 6-7: Auto-Base generator + Thin-wall detection
- Weeks 8-11: Resin MVP (hollow, drain holes, orientation assistant, resin readiness score)
- Ongoing: Batch mode + shareable print-shop preset packs

### Recently completed (iter-126, 2026-07-04) — Printability Report engine (Phase 1B skeleton)
- Backend `printability_service.py` — pure-function analyzer: watertight / winding / fragments / triangle-count / degenerate / flat-base / bbox checks → `PrintabilityReport { score, verdict, issues[], metrics }`. Uses trimesh + numpy (no new deps).
- `POST /api/printability/analyze` — auth-required multipart upload, `.stl/.obj/.ply/.3mf/.glb/.gltf`, 100MB cap, stateless.
- 14 pytest cases (service + HTTP) — all pass. Testing agent added 2 more HTTP cases (16/16 total) + verified 9/9 UI cases.
- Frontend `PrintabilityReportPanel.jsx` — docked slide-in with color-coded score ring, verdict badge, metric strip, and issue rows with **"Fix with X" buttons** wired to `fix_action` codes (currently stubbed toasts; real handlers land as future tools ship).
- Toolbar button `printability-open-btn` (orange ShieldCheck) opens the panel from SystemRow.
- Testing agent: 25/25 pass, no functional issues. Minor visual polish (score ring double-rotation) fixed in iter-126.1.

### Recently completed (iter-125.6, 2026-07-04) — Ruler polish trio + AI-provider research
- **Snap-to-vertex crosshair** on hover of any pick dot (orange, Billboard-anchored).
- **TIP chip decomposition** — cone/cyl/sphere tip chip now shows 3D magnitude + inline "→ horizontal · ↑ vertical" breakdown.
- **Probe hover tooltip** — pinned probes reveal per-axis ΔX/ΔY/ΔZ on hover (color-coded rose/emerald/sky).
- **Provider research verified**: Meshy ≈ 2× Tripo ($0.40 vs $0.21/model). "Hi3D" is ambiguous (Hitem3D commercial / Hi3DGen open-source / Hunyuan3D via Replicate). Est. 1–2 days to add Tripo as alternate provider (reuses BYO-key vault).

### Recently completed (iter-125.3, 2026-07-04) — Ruler vertex probe mode ("measure to ANY vertex")
- New crosshair-icon toolbar button on the workplane ruler opens a **probe mode**: 22 pick candidates per visible object light up as small hollow-orange rings (bbox corners + top/bottom-centers + side face-centers + vertical-edge midpoints + volume center). Click any to pin a persistent dashed line + distance chip from ruler origin. Multiple probes stack. Eraser button clears all.

### Recently completed (iter-125.1, 2026-07-04) — Ruler regression on stacked objects
- Fixed `priorityRaycast` tie-break — stacked/overlapping placement dots (cube-top + cone-bottom sharing a coord) now resolve to the dot closest to the camera instead of insertion order. Regression covered by 4 new Jest tests in `lib/priorityRaycast.test.js`.
- Added top-center + bottom-center synthetic placement dots per bbox so users can pick cone tips / cylinder tops as the ruler origin.
- Ruler origin label now shows an amber `↑ Z` elevation tag when the ruler is placed on an elevated surface (top of a stacked part), removing the "readings look wrong" confusion.

### Recently completed (iter-125, 2026-07-04) — BYO Meshy AI key (P1)
- New `/api/me/meshy-key/*` routes (status / save / delete). Keys Fernet-encrypted at rest via new `secrets_vault.py` module (`FORGE_SECRET_ENC_KEY` env var).
- `meshy_service.py` helpers all accept optional `api_key=` override; `verify_api_key()` validates the key against Meshy before saving.
- `/api/ai/generate/*`: users with a personal key BYPASS the monthly cap (they pay Meshy directly). `ai_jobs` rows tagged with `used_personal_key: bool` for admin reporting.
- `/api/ai/usage` returns `has_personal_key: bool`. AI dialog badge flips to "Unlimited · Your key" when set.
- New profile card `MeshyKeyCard.jsx` — password input + reveal toggle + Save & verify; masked hint chip + Remove key in the active state.
- 11 new pytest cases (`test_meshy_key.py`) — 42 backend tests total pass.

### Recently completed (iter-124, 2026-07-03) — Vendor-native G-code routing (Option A)
- Expanded `PRINTER_PRESET_META` from 4 Bambu-only IDs to **16 IDs** across 7 vendors (Bambu, Prusa, Voron, Sovol, FLSun, Creality, Elegoo).
- Non-BBL vendors route the printer preset to their vendor bundle; process/filament fall through to Custom/OrcaFilamentLibrary and get patched into compatibility by `_patch_cross_profile_compatibility` server-side.
- Added 2 Elegoo printers to `PRINTER_PROFILES` (Neptune 4, Centauri Carbon).
- Production binary provisioning: `POST /api/slice/orca/reinstall` triggers the AppImage installer into persistent `/app/backend/bin/orca-x86_64/` (already wired; verified script targets correct path).
- 11 new Jest tests in `orcaProfiles.presetRouting.test.js`; 23 backend + 6 frontend regression tests unchanged.

### In Progress P1
- **Shapr3D-style reverse engineering** — RANSAC-based primitive fitting (STL → editable planes/cylinders/cubes) for mechanical parts.
  - ✅ **Phase 1 (iter-105.25)** — Backend plane segmentation (`POST /api/mesh/segment`) using `pyransac3d`. Cube → 6 planes, sphere → 0, L-bracket → 8 (100% coverage).
  - ✅ **Phase 2 (iter-105.26)** — Sphere + cylinder detection before planes. Normal-driven Hough-on-Gauss-map + 2D Kasa circle fit replaces unreliable pyransac3d Cylinder. Cylinder → 1 cyl + 2 caps; block-with-hole → 1 cyl + 6 planes (the bonus mechanical-CAD success).
  - ✅ **Phase 3 (iter-105.27)** — Frontend "Reverse Engineer" button + dialog. Loading / primitive list / stats grid / honest-warning banner when coverage < 30% ("this looks like an art piece"). Sphere dedup regression fixed alongside.
  - 🟡 **Phase 4 (next)** — "Replace with Primitives" — swap static mesh for editable Three.js parametric objects.
  - ⏸️ **Phase 2.5 (deferred)** — Cone detection (requires custom RANSAC; pyransac3d has no Cone class).

### Pending P2 (backlog)
- Yjs CRDT live collaborative editing.
- Design dice / random mood-board generator (optional).

### Recently completed (iter-105.14)
- **iter-105.14 (2026-02-22) — Multi-Image → STL (Meshy multi-view).**
  - **New AI Generate tab**: `AIGenerateDialog.jsx` now exposes a 3rd tab "Multi-Image" alongside "From Text" and "From Image". Users upload 2–4 orthographic photos (labelled Front / Side / Top / Extra in a 2×2 grid) and Meshy AI fuses them into a single mesh.
  - **Backend**: `POST /api/ai/generate/multi-image` validates 2–4 images, calls `meshy_service.create_multi_image_to_3d`, persists the job with `kind='multi_image'`, increments monthly AI usage, and refunds the quota counter on upstream failure (httpx.HTTPStatusError / ValueError). Polling reuses the existing `/api/ai/jobs/{id}` handler.
  - **Frontend testids**: `ai-tab-multi`, `ai-multi-slot-{0–3}`, `ai-multi-input-{0–3}`, `ai-multi-clear-{0–3}`, `ai-submit-multi-btn`. Submit disabled until ≥2 slots filled. `multiSlots` state clears to `[null,null,null,null]` on dialog close.
  - **Tests**: `/app/backend/tests/test_ai_multi_image.py` (validation, persistence, quota refund) + Playwright frontend pass. Backend 100% (8 passed, 2 skipped — Meshy rejects 1×1 PNG fixtures, refund path verified instead). Frontend 100%.
  - **Known minor**: when submission fails with Meshy 502 on degenerate fixtures, Cloudflare's edge layer can rewrite the backend error body. Does not affect real-world flows (real photos route normally). Test-harness-only cosmetic.

### Recently completed (iter-105.13)
- **iter-105.13 (2026-02-20) — Per-face image picker + toast audit.**
  - **Per-face picker (P2)**: new "Per-face" wrap mode in the Texture dialog (cube only) with a 6-slot cube-net layout (cross/unfolded — top row Top, middle ring Left-Front-Right-Back, bottom row Bottom). Each slot opens an inline source browser to pick a built-in pattern, a custom texture, or leave that face flat.
    - `_wrapCube` in `textureGeometry.js` now accepts `perFaceHeightmaps: { "+x": hm, "-x": hm, "+y": hm, "-y": hm, "+z": hm, "-z": hm }` — null entries leave that face flat. Seam-stitching still works (the per-face heightmap is sampled per face within the sum-of-contributions pass, so edges between two textured faces still close cleanly).
    - Dialog builds the 6 heightmaps in parallel via `Promise.all` before invoking the wrap engine.
    - Shared relief settings (height / fit / invert / modifier) apply uniformly to every textured face in v1 — keeps the UI manageable. Per-face independent settings are a v2 backlog item if a user asks.
  - **Toast consistency audit**: grepped all 144 `toast.*` call sites — every one already uses a typed variant (`success / error / warning / info / message / loading`). The `richColors` flag enabled globally in iter-105.12 already paints them with the right icons & accent colours. No changes needed; the visual consistency is in place.
  - **Verified live**: cube + per-face mode, picked hex on +Z, bumps on +X, knurl on -Y, left the other 3 empty. Cube-net UI updated to show each picked thumbnail correctly in the right slot.

### Recently completed (iter-105.12)
- **iter-105.12 (2026-02-20) — Centre toast notifications.**
  - **User report**: LithoForge inbox toasts popping in the upper-right corner were getting missed because the workspace's busy right rail (Inspector, Gallery, Send to OrcaSlicer) drew the eye away.
  - **Fix**: switched the Sonner Toaster position from `top-right` → `top-center` in both the default `<Toaster>` wrapper (`/app/frontend/src/components/ui/sonner.jsx`) AND the App-level mount (`/app/frontend/src/App.js` — the App-level prop was overriding the wrapper default, so both needed the change).
  - **Verified live**: toast `centerX === window.innerWidth / 2` (1280px wide window → centerX=960, viewport centre 960). Stacked toasts also align to centre.

### Recently completed (iter-105.11)
- **iter-105.11 (2026-02-20) — LithoForge → ForgeSlicer inbox.**
  - **User ask**: lithophanes flowing in from LithoForge.net should land in ForgeSlicer ready to modify or slice.
  - **Architecture** (per user choices): partner tool POSTs a finished STL/3MF to a ForgeSlicer endpoint; the workspace polls the inbox; user lands and sees a toast; one click imports onto the plate. Shared Emergent session_token authenticates both sides.
  - **Backend** (`/app/backend/routes/litho_inbox.py`, wired in `server.py`):
    - `POST   /api/litho/inbox` — multipart file + form fields `name`, `format` (stl/3mf), `source_shape` (flat/curved/cylinder/disc/lightbox_rect/lightbox_circle), `source_metadata` (JSON). Stream-validates 100MB size cap.
    - `GET    /api/litho/inbox` — list pending items for current user.
    - `GET    /api/litho/inbox/{id}/download` — streams the file (marks `consumed=true` opportunistically).
    - `DELETE /api/litho/inbox/{id}` — removes the inbox record + GridFS payload.
    - File payloads go through GridFS (`litho_files` bucket) so a 30-50 MB lithophane STL doesn't bust the 16 MB BSON document limit.
  - **Frontend** (`/app/frontend/src/components/LithoInboxWatcher.jsx` + `lib/lithoInboxApi.js`):
    - Mounts inside Workspace as a render-less watcher.
    - Initial poll 1.5s after mount, then every 60s. Listens for `forgeslicer:litho-inbox-refresh` events for future synchronous handoffs.
    - For each pending item: shows a Sonner toast with the LithoForge name + shape label + file size, an "Open" action and a "Later" cancel.
    - "Open" downloads the file, runs it through the existing `importAnyMeshFile` / `import3MFFileMulti` pipeline (same code path as drag-and-drop), pre-stores 3MF pristine bytes for round-trip, deletes the inbox record. Store auto-selects the imported mesh → Inspector populates automatically.
  - **Verified live**: curl POST → toast appears with the right text → clicking Open imports the mesh, selects it, Inspector shows "INSPECTOR — IMPORTED · Family Photo on Cylinder · on bed", inbox empties. Reload doesn't re-toast.

### Recently completed (iter-105.10)
- **iter-105.10 (2026-02-20) — Single-face wrap + Mesh-detail slider + Lithophane preset.**
  - **Single-face wrap (P1)**: new `faceMask` arg on `wrapTextureForTarget`. UI exposes a `<select>` (`texture-face-mask`, cube only) with options *All 6 faces / Top (+Z) / Bottom (-Z) / Right (+X) / Left (-X) / Back (+Y) / Front (-Y)*. Only the chosen face gets displaced — the other five stay flat, dramatically shrinking the STL when you only want detail on one "display side".
  - **Mesh-detail (P1)**: new `meshDetail` arg (`draft` / `standard` / `high`). Scales the per-axis segment cap (`0.35× / 0.65× / 1.0×`) for sphere, cube, cylinder and cone wraps. Exposed as a 3-button toggle in the dialog (default High). Lets the creator pick STL size vs surface fidelity without re-uploading.
  - **Lithophane preset (P2)**: ✨ Lithophane Preset button in the dialog header — one click sets `sourceKind=custom`, `fitMode=stretch`, `invert=true`, `height=3mm`, `modifier=positive`. Slots naturally with the user's LithoForge.net workflow for back-lit prints.
  - **Exports**: `CUBE_FACES` + `MESH_DETAIL_LEVELS` constants out of `textureGeometry.js` so future UIs (e.g. ContextMenu right-click wrap) can reuse them.
  - **Verified live**: cube + hex with face=+Z produced a clean 20×20×21.5mm cube (hex relief ONLY on top), Mesh-detail toggle scales vertex counts as expected, Lithophane preset flips the dialog to custom/stretch/invert/3mm in one click.

### Recently completed (iter-105.9)
- **iter-105.9 (2026-02-20) — Surface detail bump + upside-down fix.**
  - **Coarseness**: previous mesh resolution (~32-50 segs/axis on a 50mm cube) was leaving custom-image features looking like rough chunks. Bumped:
    - Heightmap canvas resolution `256 → 512` (4× pixels — enough to capture portrait / line-art detail).
    - Cube seg cap `128 → 200` per axis (~240k verts max — heavy but slicer-friendly).
    - Sphere seg cap `192 → 256`, cylinder/cone radial segs `96-128 → 192`, axial caps bumped to 192.
    - All seg formulas re-tuned to target ~24 verts per heightmap-tile so mesh density matches heightmap density.
    - Upload re-encode also `256 → 512` so users uploading high-res source images don't get blurry downscale.
    - Backend `_MAX_IMAGE_B64_BYTES` raised `200KB → 800KB` to fit the larger PNGs.
  - **Upside-down**: custom-uploaded images came out flipped along the V axis because canvas Y is top-down but the wrap engine's UV convention is V=0 at the bottom. Fixed in `_canvasToHmap` — heightmap row 0 now corresponds to the bottom of the canvas. Built-in patterns are symmetric so unaffected; custom images now render right-side up.
  - **Verified live**: an A-arrow test image uploaded and wrapped onto a cube now shows recognisable letterforms across multiple faces (vs the old "rough mush" rendering).

### Recently completed (iter-105.8)
- **iter-105.8 (2026-02-20) — Custom textures: 401 fix + graceful unauth UX.**
  - **User report**: persistent `401 Not authenticated` from `GET /api/textures` even though the rest of the workspace worked fine. Console was flooded with red error stacks.
  - **Root cause**: `customTexturesApi.js` was using `process.env.REACT_APP_BACKEND_URL` *directly* instead of the shared `API` constant in `/app/frontend/src/lib/api.js`. The env var is baked at build time and on the custom production domain it points at the original `*.emergent.host` URL — every API call is cross-origin and the httpOnly `session_token` cookie isn't sent. The bug also manifested on Preview during brief session lapses (the backend logs showed `/api/auth/me 401` interleaved with `/api/textures 401`).
  - **Fix**:
    1. `customTexturesApi.js` now imports `API` from `./api`, which uses `resolveBackendUrl()` to switch to `window.location.origin` whenever the page host differs from the env var. Cookies stay first-party.
    2. `listCustomTextures()` no longer throws on 401 — it returns `{__unauthenticated: true, items: []}` so the dialog can render an empty My Textures grid with a clear sign-in banner instead of spewing red errors.
    3. New `NotAuthenticatedError` class exported so the upload handler can surface a friendlier message ("Sign in (top-right menu) and try again — your image is still here.") instead of "401".
    4. New `texture-custom-signed-out` banner inside the My Textures tab explains why the grid is empty and where to sign in.
  - **Verified live**: with a valid session the grid populates and zero texture-related errors hit the console; without auth the workspace already gates entry, but if a user's session lapses while the dialog is open they now get a clean banner.

### Recently completed (iter-105.7)
- **iter-105.7 (2026-02-20) — Selection toast + mesh resolution.**
  - **Issue A — selection-required prompt**: clicking the Texture button with nothing selected now triggers a Sonner toast ("Select an object first — pick a sphere, cube, cylinder or cone to wrap a texture onto.") for 3 seconds and *short-circuits* opening the dialog (since the dialog can no longer drop a flat tile on the bed, opening it without a target would just show a banner). Detection works for both no-selection-at-all and selected-but-unsupported-type (torus / imported / sweep).
  - **Issue B — hex pattern barely visible on cube**: the previous cube wrap used `seg = max(24, min(96, s/(refTile/3)))`, which on a 20mm cube with tileSize 3mm yielded only 24 segs per axis (~1.2 mm per segment — way too coarse to capture the ~1.5mm hex feature). Bumped to `max(32, min(128, (s/refTile)*12))` which on the same cube gives ~80 segs per axis, ~0.25mm per vertex — features now read cleanly.
  - **Verified live**: toast fires when clicking Textures with no selection; hex cube now shows full clean hex relief on all faces instead of subtle dots.

### Recently completed (iter-105.6)
- **iter-105.6 (2026-02-20) — Cube wrap: close the seams.**
  - **User screenshot showed**: every edge of a textured cube had a triangular dark gap where the heightmap silhouette was visible through the cube body.
  - **Root cause**: `BoxGeometry` produces SEPARATE vertices per face — every shared edge has 2 coincident copies, every corner has 3. The previous wrap pass displaced each copy along its own face normal, so the top-face copy went +Z and the side-face copy went +X, pulling the duplicates apart into a triangular gap.
  - **Fix** (`/app/frontend/src/lib/textureGeometry.js`): displace each vertex by the SUM of contributions from every face it lies on (looked up by original position, not stored normal). Interior verts → 1 face. Edge verts → 2 face normals. Corner verts → 3. All coincident duplicates land at the same final position because they all see the same set of contributing faces.
  - **Verified live**: cube + voronoi (the user's reported failure case) and cube + hex both render as single solid textured cubes with no visible gaps along any edge.

### Recently completed (iter-105.5)
- **iter-105.5 (2026-02-20) — Texture system rewrite: heightmap-first + user-uploaded images.**
  - **User pain**: iter-105.4 made things worse — only the dense knurl pattern survived on cube/sphere. Hex / bumps / brick / diamond plate were collapsing to flat planes because the 3D-pattern-to-heightmap rasteriser fills axis-aligned triangle BBs (which over-fill the gaps between shapes and under-fill the dense interiors). User also asked for a new feature: upload ANY image (daisies, airplane, logo) as a texture.
  - **Rebuilt as one pipeline**:
    1. `/app/frontend/src/lib/textureHeightmap.js` (NEW) — universal heightmap source. All 9 built-in patterns are now rendered via Canvas2D (proper anti-aliased shapes, ~90% coverage on bumps instead of 12%). Custom user images use the SAME path.
    2. `wrapTextureForTarget(target, {heightmap, modifier, fitMode, tileSize})` (`/app/frontend/src/lib/textureGeometry.js`) — refactored to accept a heightmap directly. Stretch mode wraps one image once across the entire target; tile mode repeats every `tileSizeMM` of arc length.
    3. Backend `/api/textures` (NEW — `/app/backend/routes/custom_textures.py`) — per-user CRUD for saved heightmaps. Stored as ≤256×256 grayscale PNG data-URLs (≤200KB each) directly inside the document, with a 64×64 thumb_b64 for the grid.
    4. `TextureLibraryDialog` (rewritten) — two-tab UI (Built-in patterns / My Textures). My Textures tab has drag-and-drop + file picker upload, list with per-card delete, name field, defaults stored per texture. Removed the old "drop a flat tile on the bed" workflow entirely (the dialog now refuses to apply without a target).
    5. Per-application Fit toggle: **Tile** (repeat across surface) vs **Stretch** (fit once).
    6. Per-custom-texture Invert toggle (bright = low) for images whose subject is dark on a light background.
  - **Verified live** in preview env:
    - Sphere + positive hex → full coverage with proper hex relief.
    - Cube + negative bumps → cube body intact (20×20×20mm preserved), dense engraved dimples on all 6 faces.
    - Custom image upload: drew a 4×4 daisy stamp pattern in browser → POST `/api/textures` returned 200 + texture_id → texture appears in My Textures grid with correct thumbnail → applied to sphere produces a daisy-pattern bumpy surface.
  - **Killed (per user request)**:
    - "Drop a flat tile on the bed" — no longer offered; dialog requires a target.
    - The 3D-pattern-to-heightmap rasteriser (`_buildPatternHeightmap` in textureGeometry.js) — every wrap now uses the new canvas-based heightmap source.

### Recently completed (iter-105.4)
- **iter-105.4 (2026-02-20) — Surface-Wrap Textures, take 2.**
  - **Bug**: All NEGATIVE wrap-textures (and most POSITIVE wraps on a cube) were collapsing into floating face plates on the bed. Bumps on a sphere only achieved 10–15% surface coverage.
  - **Root causes (3)**:
    1. `_wrapCube` returned only six *disconnected* texture-face plates with no cube body — so NEGATIVE mode literally deleted the cube and POSITIVE rendered as a hollow shell.
    2. `_wrapSphere` / `_wrapCylinder` / `_wrapCone` used `disp = sign * (depth + h)`, which uniformly inflated (positive) or shrank (negative) the entire mesh by `depth ≈ 0.8 mm` — making the relief read against an already-puffy/shrunken surface (the "10–15% coverage" the user reported).
    3. After surface wrapping, the replacement mesh kept the original primitive's `position` even though the displaced bbox was a different size, causing positives to dip below the bed and negatives to float above it.
  - **Fix** (`/app/frontend/src/lib/textureGeometry.js` + `/app/frontend/src/components/dialogs/TextureLibraryDialog.jsx`):
    1. Rewrote `_wrapCube` to subdivide a `BoxGeometry` (16–64 segments per axis based on `tileSize`) and displace each face's vertices along its own outward normal. BoxGeometry uses separate vertices per face so edge crease behaviour is built in — no tearing, no floating plates.
    2. Switched `_wrapSphere`/`_wrapCylinder`/`_wrapCone` to `disp = sign * h` (no `depth` offset). Where the pattern is empty (`h=0`) the sphere/cylinder keeps its original silhouette exactly, so relief reads cleanly against the original surface.
    3. After wrap, `TextureLibraryDialog` repositions the result so its lowest vertex sits on `z=0` (true on-bed contact).
  - **Verified live** on preview env: sphere + positive bumps now covers the full surface; cube + hex pattern keeps a solid cube body with raised hex relief; negative hex on cube engraves cleanly into the surface; sphere bbox stays at full 24mm after negative wrap (was shrinking to 20mm before).

### Recently completed (iter-105.1)
- **iter-105.1 (2026-02-20) — Post-MVP polish sweep.**
  - **Inspector dim hints**: `RightPanel.NumberField` + `PopoverShell.NumberField` accept a new `hint` prop. Cube dims now read "X (width) · Y (depth) · Z (height)", Position popover reads "X (right) · Y (forward) · Z (up)", Rotation reads "X (pitch) · Y (roll) · Z (yaw)".
  - **Cone r1/r2 Inspector**: Cones whose dims carry both `r1` and `r2` (e.g. countersink CS Cup) now show two diameter fields ("Top ⌀" + "Bottom ⌀") instead of a single Diameter field that ignored both — fixes the user-reported "Countersink Inspect properties don't coordinate with intent" complaint.
  - **`estimateHalfExtents` Z-up rewrite**: The Inspector dim-line was still using Y-up axis ordering for cube / sphere / cylinder / cone / torus / helix / pipe / wedge / bolt / nut / spline / sweep. All cases now return `[hx, hy, hz]` 1:1 with world XYZ — fixes wrong half-extents in the Inspector "Real-size" readouts and Scale popover.
  - **Texture face-application overhaul**: `TextureLibraryDialog.jsx` now (1) falls back to the current selection when no `targetObjectId` is passed, (2) computes world-space face centre + outward normal from `computeRotatedBBox`, (3) auto-positions the texture flush against the chosen face with rotation aligned to the face normal, (4) "Bake into the part on drop" checkbox (default ON) calls `combineTwoAsync(target, texture, op)` and replaces both objects with the merged result. Replaces the old "drop a thin tile on the bed and let the user manually boolean it" workflow.
  - **Design Chat multi-turn history**: Backend `/api/voice/command` accepts an optional `history: [{role, text}, …]` field; the LLM gets the last 8 turns prepended as a `PRIOR CHAT` block. Frontend `parseTranscript(text, {history})` opt-in passes the chat log only from Design Chat (voice commands stay one-shot to avoid extra token cost).
  - **Landing Templates grid expanded** from 4 → 8 cards: added Cable Comb · Project Enclosure · Spool Hub Spacer · Right-Angle Bracket. Card styling re-skinned: solid slate-950/80 background with an absolutely-positioned accent gradient overlay, so titles render with full white contrast on every accent.
  - **Misc**: HelpDialog cut-plane "Upper" wording updated (+Y → +Z). All 36 backend tests still pass.
- **iter-105 (2026-02-19) — Design Chat MVP shipped + Landing-page Templates Gallery + primitive bug sweep.**
  - **Design Chat panel**: `/app/frontend/src/components/dialogs/DesignChatDialog.jsx` — conversational textarea that talks to `/api/voice/command` per turn, executes the returned plan/template/atomic command on the live scene, shows assistant replies + step counts in a chat log. Surfaces 4 sample prompts on first open. Exposed via a new "Design Chat" primary button in the LeftPanel `AI` tab (re-skinned to lead with Design Chat; Meshy AI and Heightmap demoted to secondary roles). Single-turn for MVP — the scene IS the persistent context. Cmd/Ctrl+Enter to send.
  - **Templates Gallery on Landing**: `/app/frontend/src/components/LandingTemplates.jsx` — 4 curated cards (Pi 4 Wall Mount, Tool Holder, Soft Vise Jaws, Drawer Pull) that stash `{template_id, params}` in sessionStorage and navigate to `/workspace?template=<id>`. Workspace's new `templateParam` useEffect picks up the payload, calls `expandTemplate()`, runs the steps through `executePlan()`, sets the project name, and shows a load banner.
  - **Primitive bug sweep**:
    - **`bolt` & `nut` & `spline`**: rewrote `geometry.js` to use ExtrudeGeometry-with-holes for the nut + ExtrudeGeometry of cylinder/hex profiles for bolt and a star-shape for spline. Drops the open `TubeGeometry` helical-thread overlay that was breaking Manifold's "watertight" requirement, so bolt/nut/spline now WORK AS CSG NEGATIVES (subtract a bolt from a cube → real screw hole). Nut now visibly has its through-hole too.
    - **`sweep` & helix path / arc path**: `sweepGeometry.js` updated for Z-up — helix axis = +Z, arc lies flat in XY. Bezier defaults moved Y→Z so the rope preset curves upward. Added `getBaseSize` for sweep/texture types so resize popovers show real dimensions.
    - **`primitiveDefaults.js` position regression**: was leaking the half-height into `position[1]` (Y/forward) instead of `position[2]` (Z/up); fixed so new primitives land at world origin XY with their bottom on Z=0.
    - **`Workspace.jsx` add-component carry-over**: drop-to-bed pass was still computing `worldMinY` from `bb.min.y` after the Z-up migration — corrected to `worldMinZ` / `bb.min.z`.
    - **`composites.js`**: programmatic `position[1]↔position[2]` and `rotation[1]↔rotation[2]` swap across all composite builders (Slot, FastenerPair, Countersink, HexPocket, Gusset) — 15 occurrences.
    - **`centerOnBed` regression**: fixed (caught by testing agent) — formula now correctly uses `nx = -centreX; ny = -centreY; nz = -bb.min.z` since `computeRotatedBBox` returns a LOCAL bbox.
  - **Tests**: 36 voice / command / template tests all pass.

### Recently completed (iter-104)
- iter-104.3 (2026-02-19) — UI polish: Inspector "Bottom Y" → "Bottom Z" with `data-testid=bottom-z`; selectionActions mirror-axis Z floor-clamp; voice_templates_boards regression rewrite (8/8 pass).
- iter-104.2 (2026-02-19) — Template sweep: programmatic `position[1]↔position[2]` and `rotation[1]↔rotation[2]` swap across all 9 voice templates (45 occurrences). LLM executor system prompt in `backend/server.py` rewritten for Z-up CAD convention.
- iter-104.1 (2026-02-19) — Z-up foundation + Tier 2 partial-fillet rewrite (LANDED). The internal Three.js coordinate space is now Z-up (`THREE.Object3D.DEFAULT_UP = (0,0,1)` set in `index.js` before React mounts). Files touched:
  - **Tier 1**: `index.js` (DEFAULT_UP), `Viewport.jsx` (camera `[220,-260,200]`, OrbitControls target `[0,0,bv.z/4]`, BuildPlate + DesignPlate now on XY at Z=0, drei `<Grid>` rotated 90° about X, CutPlaneGizmo default plane normal +Z, cylinder/cone sub-element pick overlays repositioned around +Z axis, `CameraFitOnPrinterChange` updated), `geometry.js` (cube `BoxGeometry(d.x, d.y, d.z)` 1:1; cylinder/cone/lathe/helix/bolt/nut/spline/pipe/wedge/2D-extrude all rotated to Z-up; `getBaseSize` 1:1 with dims), `store.js` (`addPrimitive`/`addSketch`/`addSweepFromSketch`/`addImportedMesh`/`addRawObject` auto-drop on `position[2]=-bb.min.z`; `dropToBed`/`centerOnBed`/`dropSelectionToBed`/`layFlatSelection` (thin-axis = Z exit), `updateDims` pin-bottom Z, `duplicateObject` offset on XY not on Z, `bakeScaleIntoDims` 1:1, `resizeSceneToBed` BV axis mapping 1:1).
  - **Tier 2**: `partialFillet.js` (`dimsLocal = { x: w, y: dep, z: h }` 1:1; `Manifold.cube([w, depY, h])`; cube/cylinder/cone lathe finals rotated to Z-up), `edgeFaceMeta.js` (1:1 cubeEdgeEndpoints/cubeFaceQuads/cubeVertexPositions; CUBE_FACES relabeled — `f_minY` → "Front face", `f_maxY` → "Back face", `f_minZ` → "Bottom face", `f_maxZ` → "Top face"; CUBE_EDGES relabeled accordingly), `manifoldEngine.js` (no direct change — inherits via `buildGeometry`), `csg.js` `cutObjectByPlane` (half-space offset moved from local +Y to local +Z), `exporters.js` (removed all Y↔Z rotations on STL/OBJ/3MF import + export — `_zUpToYUp` is now an identity passthrough; `_normaliseForSlicer` only drops bbox), `slicer.js` (pre-rotate merged geometry -90° around X so the existing Y-up slicer math runs unchanged and outputs Z-up GCODE).
  - **Tier 5**: SKIPPED per user (option b — no test stubs).
  - Smoke test verified: build plate lies on XY, cube auto-drops to Z=10 with bottom at Z=0, dims X/Y/Z all show 20mm, bottom-left axis legend reads "Z = up".
  - **Known carry-overs into iter-104.2/.3**: every backend voice template in `/app/backend/voice_templates/` still emits old-convention positions (`position[1]` for "up"); the LLM executor passes them through verbatim → templates will render incorrectly until iter-104.2 sweeps them. UI labels like Inspector's "Bottom Y" readout and "Y (depth)" dim hints still say Y where they now mean Z — fix in iter-104.3.
- iter-104.0 (2026-02-19) — **CAD-standard axis migration plan locked.** See `/app/memory/AXIS_MIGRATION_PLAN.md`.

### Recently completed (iter-103)
- iter-103.3 (2026-02-19) — **Centre-on-bed + 3 new voice templates + matching backplate hint + refactor pass.** Big batch from the user prompt "Do the Centre on bed suggestion along with the P1 and P2's. Do them in the order that minimizes your effort."
  - **Centre-on-bed action.** New `centerOnBed(id)` store helper computes the object's world-space bbox (via `computeRotatedBBox`, so it works for rotated objects), then translates the object so its X/Z extents centre on the origin AND its bottom face sits on Y=0. Surfaced as a `MapPin`-icon button at the bottom of the Scale popover (`data-testid="scale-center-on-bed-btn"`). Particularly useful after voice-plan booleans where the merged object's pivot can drift off-centre.
  - **3 new voice templates.** `vise_jaws` (matched pair of soft jaws with flat / V-groove / soft-pad face options, optional top hook lip and through-bolt holes); `project_enclosure` (5-sided open-top box sized to an interior volume, with vent slots on long or all walls and 4-corner screw posts with M3 pilot holes); `hose_adapter` (barbed cylindrical reducer between two hose IDs with optional flange and per-section barb count). All three honour `.get(default)` for every parameter (the previous batch's templates incorrectly used bracketed access, breaking the all-default invocation — fixed in this iteration).
  - **Matching backplate.** No new template — the existing `board_faceplate` wall-mode already accepts `faces:["-x"]` and produces a back panel sized to the short edge with USB-C / HDMI / audio cutouts. Promoted this as a first-class voice intent in the LLM system prompt (`server.py`) so "add a matching backplate for the Pi 4" now reliably maps to `board_faceplate` with `faces:['-x']`. Also added voice-intent hints for all five iter-103 templates (cable comb, spool spacer, vise jaws, project enclosure, hose adapter) so the LLM picks them up by descriptive name.
  - **VoiceButton refactor.** Phrase classifiers (`isGoExitPhrase`, `isGoPausePhrase`, `isResumePhrase`), timing knobs (`GO_PAUSE_WINDOW_MS`, etc.), and the localStorage mode-pref helpers (`readMode`, `writeMode`) moved to `lib/voiceModePhrases.js`. ~80 lines out of `VoiceButton.jsx`'s top-of-file, leaving the main component as orchestration logic rather than regex appendix + orchestration.
  - **RightPanel refactor.** Extracted `EdgeControls` (~326 lines, per-edge/face/vertex fillet UI) to `components/inspector/EdgeControls.jsx`. Extracted `AutoSaveSection` (~84 lines, File System Access API project auto-save widget) to `components/inspector/AutoSaveSection.jsx`. `RightPanel.jsx` shrunk from 1601 → 1196 lines (25% smaller). Pure code-moves — no behaviour changes. The dynamic `import("../lib/autoSave")` calls in AutoSaveSection got their relative paths bumped to `"../../lib/autoSave"` to match the new depth; lint and live load both verified.

### Recently completed (iter-103) — backplate / merged-bbox / wall mode User-reported: after `create a faceplate for a RPI4`, the Inspector showed `base size 1.00 × 1.00 × 1.00 mm` with X/Y/Z all 1 mm in the Scale popover, even though the geometry on screen was clearly at full size. Root cause: `voicePlanExecutor.js`'s boolean step creates a new `type: "imported"` object from the merged geometry, but it set `dims: {}` and never populated `originalBbox`. `geometry.js`'s `getBaseSize` for imported objects requires `originalBbox` and falls back to `{x:1, y:1, z:1}` otherwise — that's the "1 mm" the user saw. Fix: walk the merged worker payload's raw vertex array (the `combineTwoAsync` worker returns `{vertices: Float32Array, indices: Uint32Array}`, NOT a `THREE.BufferGeometry`, so `computeBoundingBox()` is not available) to compute the bbox extents and attach them as `originalBbox`. Same fix applied to `toolbar/projectActions.js`'s manual Combine action — it had the identical bug. Verified with a standalone bbox-from-vertices test against a faceplate-sized vertex soup (95 × 24.5 × 3 mm) and edge cases (null / empty input).
- iter-103.1 (2026-02-19) — **Voice "faceplate" template now produces a vertical wall.** User-reported regression: saying "create a faceplate for a RPI4" produced a small flat shape with 3 vertical "fins" — actually the plate material BETWEEN edge-notches cut into the +Z border of a flat tray. The `board_faceplate` template was generating a horizontal mounting tray with cutouts positioned 5 mm OUTSIDE the plate edge, so the subtract carved through the border but mostly missed the plate body, leaving the residual castle-wall shape the user described. Root cause: the template's geometry treated "faceplate" as "tray" — connector cutouts piercing through world Y (thickness) of a flat plate, with their footprint along world Z extending past the plate. Fix: new `orientation` param (`"wall"` default, `"tray"` legacy). In wall mode the plate stands UP — width along world X matches the board's connector edge length + 2 × border, height along world Y is max-connector-height + 2 × `wall_margin_mm`, thickness goes through world Z. Connector cutouts pierce through Z (the thin axis), positioned at their natural X (along the long edge) and Y (above bed at connector height + margin). Only the FIRST face in `faces_filter` is honoured in wall mode (a wall can only cover one edge of the board). Tray mode is preserved untouched and reachable via `orientation: "tray"`. New regression test `backend/tests/test_voice_templates_boards.py` (8 cases) locks the behaviour down — verifies wall plate orientation, cutout-fits-through, cutout-above-bed, single-face constraint, tray mode legacy behaviour, and `skip_plate` semantics across both orientations.

### Recently completed (iter-103) — initial batch
- iter-103 (2026-02-19) — **Snap-step controls + faux design plate + iter popover + SSO banner + 2 new voice templates.** Big batch from the user prompt "snap-to-grid + faux large build plate + the previous Action Items + the Refactor."
  - **Snap-step controls.** `snapRotate` (15° default) and `snapScale` (0.1 mm default) were hardcoded; now editable. New store setters `setSnapRotate`, `setSnapScale`. `<TransformControls scaleSnap>` now reads `snapScale` from the store instead of the inline `0.1` constant.
  - **Faux design plate.** New `designPlate: { enabled, x, y, z, name }` state in the scene store + setter `setDesignPlate(patch)`. New `<DesignPlate />` component in Viewport renders a translucent dark plate UNDER the printer plate when enabled, with a cyan dashed perimeter + envelope wireframe at the configured height, a coarser 50 mm cyan secondary grid, and a name/dimensions label anchored to the back-left corner. Drawn at `y = -0.15` so the printer plate's orange ring still wins z-fighting. Bounds-checks / G-code export still gate on the printer plate; the design plate is purely a modelling-envelope aid. Subdivision of oversized parts continues to be handled by the existing Subdivide dialog (or a desktop slicer's split feature) per the user's stated preference.
  - **Snap & Design Plate popover.** New `popovers/SnapAndPlatePopover.jsx` triggered by a `Settings2` cog button immediately to the right of the Magnet/Grid icons in EditRow. Six NumberFields (translate / rotate / scale snap, design-plate width / depth / height) + preset chips (1 mm · 5 mm · 90° · 1 m · 1.5 m · 2 m · Desk-scale 600). Same PopoverShell pattern as Position / Rotation / Scale so it inherits standard close/escape/anchor behaviour.
  - **Clickable iter popover.** The hardcoded `iter-101` span on Landing is now driven by `lib/iterLabel.js` (single source of truth — bump alongside PRD.md). Clicking it opens a small popover summarising the last 3 iterations from `RECENT_ITERATIONS` (same file). Moved the span OUT of the wordmark `<Link>` so the click no longer fires home-nav; closes on Escape / outside-click.
  - **SSO Bridge banner.** New `SsoBridgeBanner` component above the Landing hero — dismissible (localStorage `forge.sso.banner.dismissed`), copy adapts to signed-in vs anonymous state, CTA hits the existing `openInPeer("https://lithoforge.net", "/")` so signed-in users get a one-click bridge. Shown only on Landing so workspace tooling stays uncluttered.
  - **Voice templates `cable_comb` + `spool_spacer`.** Two new `voice_templates/*.py` modules registered in `voice_templates/__init__.py`. `cable_comb` (slot_count, slot_width, finger_width, finger_height, lip, mount_holes, screw_diameter) generates a flat-printable desk-edge cable comb with optional lip overhangs and 2-or-3 mount holes. `spool_spacer` (outer_diameter, inner_diameter, length, rib_count, end_flange) generates a hub adapter shell with optional inner grip ribs and an end flange. Both deterministic, both expand to ≤12 steps, both verified via `expand(...)` in a smoke test.

### Recently completed (iter-102)
- iter-102.8 (2026-02-18) — **STL export now includes per-edge cube chamfers/fillets.** Symptom (user-reported): exported STL opened in OrcaSlicer / FlashStudio rendered the user's chamfered column as a plain sharp box, even though the live viewport showed the chamfer. Same regression visible in the in-app STL Preview. Root cause: `evaluateSceneAsync → buildObjectManifold → buildGeometry(obj)` is synchronous, and the synchronous cube path in `geometry.js` returns a **sharp** `BoxGeometry` placeholder for any cube where `hasActiveEdgeFillets(obj)` is true — the viewport's async path (`buildCubeGeometryWithFillets`) overrides that placeholder live, but the export pipeline never receives the override. Any cube whose `edgeFillets` map had entries (from any prior Edge-mode session — or after iter-102.7's behaviour where Item-mode edits populate per-edge entries) exported as a plain box. Fix: refactored `partialFillet.js` to expose `buildCubeManifoldWithFilletsSync(wasm, obj)` that returns a Manifold directly (the existing `buildCubeGeometryWithFillets` is now a thin async wrapper). Added a fast-path in `manifoldEngine.buildObjectManifold` that detects `obj.type === "cube" && hasActiveEdgeFillets(obj)` and builds the chamfered manifold via the new sync function, then applies the object's scale/rotation/translation via the extracted `_applyTransformAfterGeom` helper. STL, 3MF, slice, and Print-Preview flatten paths all funnel through `evaluateSceneAsync`, so a single fix covers every export surface. Regression test extended (`__tests__/partialFillet.regression.mjs`) — now includes the Item-mode uniform-2 mm chamfer-on-8×20×118-column case the user originally reported.
- iter-102.7 (2026-02-18) — **Partial chamfer regression fixed for 6 of 12 cube edges.** Symptom (user-reported, 8×20×118 column): chamfering the back-right vertical edge produced a slightly distorted shape; chamfering a second edge (front-right) collapsed the entire cube to empty. Root cause in `lib/partialFillet.js` chamfer branch: the 2D triangle handed to Manifold's `CrossSection` was wound clockwise whenever `signA * signB < 0` (i.e. the two perpendicular face picks were on opposite min/max sides — front-right, back-left vertical edges plus their X/Z-axis equivalents). Manifold treats CW polygons as HOLES, so `extrude()` returned an empty solid and `carved.add(emptyPrism)` produced an invalid manifold → bbox `Infinity` → empty mesh. Fix: detect the sign-mismatch case and swap v1/v2 in the triangle so it's always CCW. Also dropped the `SLACK` overshoot on the chamfer prism's extrude length (was producing tiny 0.25 mm protrusions above the cube's top/bottom faces along chamfered edges) — block keeps slack for clean CSG carve, prism now exactly matches `lenAxis` so the result is flush. Standalone regression test added at `frontend/src/lib/__tests__/partialFillet.regression.mjs` — exercises all 12 edges via direct Manifold calls, run with `node ...`.
- iter-102.6 (2026-06-18) — **Voice trigger relocated to Commands popup.** Removed the Voice button from the toolbar entirely; the Commands button is now the single command entry point. Inside the popup footer, replaced the combined "Voice [mode] ⌄" pill with two separate controls: a real **🎤 VOICE** trigger button that closes the popup and starts recording (same Realtime / Whisper-fallback path as before), and a small **`ONE ⌄`** mode chip that opens the Single / Go dropdown. Clicking the popup's VOICE now actually starts a voice command instead of just opening the mode menu.
- iter-102.5 (2026-06-18) — **Real-time voice transcription via OpenAI Realtime API.** Replaced the record-then-Whisper pipeline with a WebRTC streaming connection to `gpt-4o-mini-realtime-preview-2024-12-17` (the cheap model). Live partial transcripts now appear character-by-character in the feedback banner as the user speaks; OpenAI's server-side VAD commits the final transcript ~400 ms after pause, which then feeds into the existing `/api/voice/command` plan parser. **New backend routes** (`routes/realtime.py`, mounted at `/api/v1/realtime`): `POST /session` mints an ephemeral client token via OpenAI's GA `/v1/realtime/client_secrets` endpoint, `POST /negotiate` proxies the WebRTC SDP exchange (so the OpenAI API key never reaches the browser), `GET /status` reports availability. **New frontend module** `lib/realtimeVoice.js` handles mic capture, peer connection, data-channel transcription events. Graceful fallback to the legacy Whisper path on any Realtime error. Configured for text-only output (no model speech back) to roughly halve the per-command cost — landing around $0.005-0.01 per voice command. Requires user-supplied `OPENAI_API_KEY` in `backend/.env` (NOT covered by Emergent LLM Key). **Toolbar refactor** in same iteration: removed the Voice mode chevron from the toolbar, added a labelled `⌨ COMMANDS` button instead, and relocated the voice mode picker (Single / Go) into the Commands popup footer where it opens upward as a dropdown.
- iter-102.4 (2026-06-17) — **Voice "newer additions" failures fixed.** Three concrete bugs the user hit: (1) atomic `add` schema didn't allow `position`, so coords like "upper-left corner at (-35,-14)" were silently dropped. Schema now includes optional `position` + `rotation`, and the prompt explains how to compute centre coords from corner anchors. Executor (`voiceCommands.js → case "add"`) honours both. (2) Descriptive phrases like "cutouts for USB and Ethernet of a Pi 4" returned `unknown` because the LLM only recognised the literal "faceplate" noun. Added a DESCRIPTIVE → TEMPLATE MAPPING block to the prompt + a new `skip_plate` param on the `board_faceplate` template that returns just the connector negatives (no plate, no boolean step). (3) Composite "template + place at X,Y" requests now emit a two-step plan; added a `template` step handler inside `voicePlanExecutor.js` that expands via `/api/voice/expand-template` and tracks multi-id tags so a subsequent `translate` step targeting `tag:cutouts` shifts the whole assembly. Backend pytest 15/15, end-to-end smoke verified all three commands the user reported.
- iter-102.3 (2026-06-17) — **Voice lexicon refreshed + inline default-edge indicator.** Voice help section now leads with a 6-card "Phrasing tips" grid (lead with the verb, units beat raw numbers, name the template noun explicitly, selection matters, multi-step opens Plan Preview, per-edge fillet is mouse-only). Added a new **Parametric templates** lexicon section with 10 working phrases covering Pi 4/5 + Arduino Mega faceplates, right-angle brackets, drawer pulls, tool holders — each with a "Try ▶" button that runs the phrase against the current scene. **Inline indicator** on the Inspector's Edge / Face / Vertex modes: when a global uniform Item-mode radius is set, it now shows "Other edges: 2.00 mm chamfer · [Clear]" so the layered (uniform + per-edge) model isn't a surprise. Clicking Clear drops `dims.edgeRadius` to 0 without touching the per-edge map. Files: `frontend/src/components/help/voiceLexicon.js`, `frontend/src/components/help/sections/VoiceCommands.jsx`, `frontend/src/components/RightPanel.jsx`.
- iter-102.2 (2026-06-17) — **Edge-mode no longer cascades to all 12 edges.** Before: switching from Item mode to Edge mode and editing one edge would materialise the existing uniform radius across every edge first, so a "fillet just the bottom-right edge" edit silently chamfered all 12. Fix: removed the materialise-uniform shim; instead `partialFillet.js`'s cube path now reads `dims.edgeRadius`/`edgeStyle` as the **default** for any edge not explicitly listed in `edgeFillets`. So a cube with Item-mode 2 mm chamfer + per-edge 5 mm fillet on the bottom-right correctly renders as 11 edges × 2 mm + 1 edge × 5 mm. A sharp cube + single edge edit only chamfers that one edge.
- iter-102.1 (2026-06-17) — **Fillet/chamfer now world-space correct under non-uniform scale.** `bakeScaleIntoDims(objId)` store action multiplies the mesh scale into `dims` and resets `scale=[1,1,1]`, called lazily by `EdgeControls.writeRadius/writeStyle` so the user's first fillet edit normalises the scale. `maxR` in the Inspector is now also computed in world-space so the slider cap matches what the user sees in the viewport. Covers cube, cylinder, cone, sphere primitives.
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

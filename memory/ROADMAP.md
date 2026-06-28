# ForgeSlicer — Roadmap

Prioritised backlog. **P0** = must-fix now / blocking, **P1** = next planned feature, **P2** = polish / nice-to-have, **P3** = experimental / future.

> Append `[DONE — iter NN]` to the line when an item ships, then move it to `CHANGELOG.md`. Keep this file lean: it should be a glance-able to-do list, not a history book.

---

## 🔴 P0 — Blocking
*(none open as of 2026-05-30 — iter 70 cleared rc -17, iter 71 cleared Cloudflare 524 via async-job pattern)*

- **RANSAC Phase 4 & 5 — Replace-with-Primitives** (iter-105.32, queued 2026-06-27). API + dialog (Phases 1-3) shipped. Remaining: a sensitivity slider on `ReverseEngineerDialog.jsx`, plus a "Replace with Primitives" button that swaps the static mesh for editable parametric Three.js Box/Cylinder/Sphere meshes at the detected transforms (hide the original mesh, keep its STL as a fallback). Touches `dialogs/ReverseEngineerDialog.jsx` and the scene store.

## 🟡 P1 — Next features
*(P1 cleared 2026-05-31 — iter 77 shipped cancel-slice, per-printer temps, and the bed-axis gizmo.)*

- **Beginner CAD toolset expansion** (filed 2026-06-27 from Steve's stakeholder review). The goal is to lift the modelling surface to the level a TinkerCAD user would expect at first sight. Every tool below must ship beginner-friendly: clear lucide icon, one-line description, numeric inputs in mm, one contextual help example ("e.g. fillet a 2 mm corner for a soft edge"), and a sensible default that "just works" if the user touches nothing.
    - **Fillet / round edges** — pick edges via raycast → enter radius (default 1 mm) → preview ghost mesh before commit. Internally a swept ball-radius offset; reuses the manifold engine for the boolean.
    - **Chamfer** — same UX as fillet but produces a 45° (or user-set angle) bevel instead of a curve. Default 0.5 mm chamfer. Share the edge-pick widget with fillet.
    - **Dedicated Hole / Countersink tool** — single dialog with diameter + depth + optional countersink head (angle + larger dia). Spawns a tagged negative primitive. Presets: M3/M4/M5/M6 clearance + #4/#6/#8/#10 imperial. Sits beside the existing primitive palette in LeftPanel.
    - **Align / Distribute** — multi-select two-plus objects → align (left / centre / right on X, Y, or Z) and distribute (equal spacing). Toolbar icon + keyboard shortcut. Inspired by Figma/Illustrator semantics — these are the muscle-memory commands beginners try first.
    - **Measurement / ruler tools** — extend MEAS-01: snap-to-vertex / edge-midpoint / face-centre, persistent measurement labels (toggle visibility per measurement), unit toggle (mm / inch / cm). Already partly anchored — finish the snap + persistent panel.
    - **Tolerance / clearance helper** — small dropdown that maps a fit name ("press fit", "running fit", "loose clearance") to a clearance value, then nudges a selected hole/peg pair by that amount. Built on top of the existing primitive picker + measurement.
    - **Snap-to-face placement** — drop or paste an object → it auto-orients to the nearest face under the cursor (face normal becomes the object's +Z), with an optional clip-to-face-bbox toggle. Lets a beginner stick a label on a phone-case back without learning the rotation gizmo.
    - **Reusable component library** — a third LeftPanel tab ("Library") with curated parts: M-series screws (heads + nuts), pegs / dowels, hinges (butt + piano), hooks (S + J), brackets (L + T + corner), text labels with the new fonts, common cutouts (USB-A / USB-C / 3.5 mm jack / wall switch box / DIN-rail clip). Each library item is a parametric composite — open it, tweak the exposed parameter (length, thread pitch, hinge width…), drop it into the scene.

- **Pre-flight Printability Checks** (filed 2026-06-27 from Steve's stakeholder review). Catch the failures that turn a new printer-owner's first weekend into a frustration spiral. Runs automatically on the active scene before any export / slice, and is also accessible on-demand via a toolbar button ("Check my print"). Surfaces a single dismissible side panel with one row per finding — plain-language headline + severity pill + visual highlight + one-click fix button. Beginner-friendly framing first; technical detail collapsed under "Show details" for the engineers.
    - **Checks to implement** (priority order — start with the ones that account for ~80 % of failed first prints):
        1. **Non-manifold / open geometry** — find holes, T-junctions, inverted normals, disconnected shells. Headline: *"Your model has gaps the slicer can't seal."* Fix button: **Repair mesh** (calls the existing watertight-heal pipeline already used during slicer handoff).
        2. **Thin walls** — sample mesh distance against a configurable minimum (default 0.8 mm = 2 × 0.4 nozzle). Headline: *"Walls thinner than 0.8 mm may not print at all."* Fix button: **Thicken wall** (offsets the negative by the missing amount).
        3. **Overhangs** — face-normal angle vs build axis; anything > 45° without supports is flagged. Headline: *"This face will sag without supports — or print it upside down."* Fix buttons: **Reorient part** (rotates so the overhang faces up) + **Add supports note** (sets a project flag so the slicer enables them).
        4. **Floating parts / islands** — connected-components on the union; any island whose bbox doesn't touch Z = 0 is flagged. Headline: *"This piece floats in mid-air — it'll fall off mid-print."* Fix button: **Drop to bed** (translates -Z to make min.z = 0).
        5. **Intersecting geometry** — pairwise bbox + mesh-mesh intersection on positives. Headline: *"Two parts overlap — the slicer will treat them as one blob."* Fix button: **Boolean union** (merges them) or **Move apart** (auto-nudge by overlap depth).
        6. **Build-volume violations** — current scene bbox vs `useScene.buildVolume`. Headline: *"Won't fit on your printer's bed (215 × 215 × 250 mm)."* Fix buttons: **Scale to fit** + **Pick a bigger printer profile**.
        7. **Very small features** — feature size < 0.6 mm (1.5 × nozzle). Headline: *"Detail smaller than your nozzle will be erased."* Fix button: **Scale feature up** (selectively scales the offending sub-component).
    - **UX requirements (non-negotiable for beginner-friendly framing)**:
        - **Severity pills**: 🟥 *Will fail* · 🟧 *Likely to fail* · 🟨 *Quality issue* · 🟩 *All good*. Never use raw colour numbers or technical scores.
        - **Visual highlight**: clicking a finding's row scrolls the viewport camera to the offending region and overlays a translucent red/orange/yellow mesh patch. Click-away clears.
        - **One-click fixes**: each finding has a primary CTA that performs the suggested fix; secondary CTA "Mark as OK — I know what I'm doing" silences this finding for the session.
        - **Plain-language first, jargon second**: every headline is one sentence a non-engineer would understand. The technical name (e.g. "non-manifold edge: 14 unmatched half-edges at z = 4.2 mm") sits behind a "Show details" disclosure.
        - **Empty-state celebration**: when all checks pass, show 🟩 *"Ready to print — no issues found"* with a confidence bullet list.
        - **Quiet by default**: panel doesn't pop modal — it slides into the existing right-side rail with a badge on the toolbar button. Beginners aren't yelled at on every keystroke.
    - **Where it lives**: new `lib/printabilityChecks.js` (each check a pure function: `(scene, settings) => Finding[]`), a `PrintabilityPanel.jsx` in the right rail, and a "Check before export" hook in `ExportDialog.jsx` / the slicer handoff path. Reuses the existing manifold engine for the geometry probes — no new wasm dep.
    - **Settings worth exposing later** (P2 once shipped): minimum wall thickness, overhang threshold angle, minimum feature size — preset by printer profile, override in advanced mode.

- ~~Sweep MVP follow-ups~~ [DONE — iter 51]
- ~~Fastener Pair macro~~ [DONE — iter 48]
- ~~Texture v2 patterns + apply-to-face + UNC/UNF imperial fasteners~~ [DONE — iter 50]
- ~~Composite library expansion — Countersinks / Gussets / Hex Pockets~~ [DONE — iter 50]
- ~~Hierarchical Project Structure (Rocket → Engine → Fuel Pump)~~ [DONE — iter 63]

## 🟢 P2 — Polish
- **Curved-surface text projection** (iter-105.33 follow-up, 2026-06-27) — the new `text` primitive ships as flat-face only (positioned via gizmos, composed via boolean union/subtract). Add a "Project onto face" mode that lets the user click a host face, then samples each glyph's outline and raycasts onto the surface so text conforms to curved hosts (cylinder rims, mug bodies, sphere logos). Touches `lib/textGeometry.js` (glyph sampling), a new `lib/textProjection.js` (raycast + extrude-along-normal), and a workspace tool button.
- **Flexible triangle primitive** (iter-105.27 enhancement, 2026-06-26) — the triangle primitive currently only creates equilateral triangles. Add: base + height inputs, three angles + side lengths, a "right triangle" preset, and an isosceles / scalene picker. Keep the equilateral path as the default for backwards-compat with existing scenes. Likely touches `lib/store.js` (PRIMITIVE_DEFAULTS for triangle), the `Shape2DControls` block in `RightPanel.jsx`, and the triangle geometry builder in `lib/geometry.js`.
- **Refactor `lib/store.js` further** — was 1486 lines after iter 73; iter 74 extracted PRIMITIVE_DEFAULTS / buildPrimitive (→ `primitiveDefaults.js`) and the anchored-ruler action slice (→ `rulerActions.js`), bringing store.js to **1295 lines (-191, -13%)**. Further candidates: composite-primitives block (lines 676-997, ~320 lines) could move into a `compositeActions.js` slice next.
- ~~Tutorial coverage — Voice / Slicer-Compare / Gallery-Share PDFs~~ [DONE — iter 58]
- ~~HelpDialog.jsx split~~ [DONE — iter 59, 771→515 lines]
- **Save Assembly to Gallery silent-failure follow-up** — only acts if user reports it on prod with DevTools payload.
- **First-click flake on `starter-customize-keychain`** (iter-105.32 testing report) — on a literal cold-load of `/`, the very first click on the keychain card sometimes does NOT fire `navigate(/workspace?template=keychain)`. Subsequent card clicks all work. Suspected cause: AuthContext or React-Router state still hydrating when the click fires. Investigate whether the AppRouter gate is rendering a placeholder that swallows the click, then either delay the cards until auth settles or pre-warm the route.

## 🔵 P3 — Experimental / future
- ~~**"Resize to fit my bed" on Remix**~~ [DONE — iter 53]
- ~~**ARM64 OrcaSlicer**~~ [DONE — iter 54]
- ~~**Compare Engines** (v1, metrics-only)~~ [DONE — iter 55]
- ~~**Compare Engines v2 — toolpath overlay**~~ [DONE — iter 64, new Toolpaths tab in EngineComparisonDialog with layer slider + per-engine diff highlight]
- ~~**Search for community OrcaSlicer ARM64 binaries**~~ [DONE — iter 63 research]
  - **Finding**: no native non-Flatpak ARM64 headless binary exists in 2026. The Matszwe02 community build wraps OrcaSlicer in KasmVNC + Docker (full GUI in a container, ~1 GB) — heavier than our Flatpak, not headless. Official path is Flathub aarch64 Flatpak (what we already use). **Recommendation**: keep the current Flatpak install. ~280 MB GNOME runtime is the cost of being on the only maintained ARM64 path.
- ~~**SlicerPopover refactor**~~ [DONE — iter 64, 522 → 382 lines via `useOrcaSlice` hook]
- ~~**Project tree drag-and-drop**~~ [DONE — iter 64]
- Live multi-user editing (CRDT / Yjs).
- Photo → reference plane (drop a photo, snap dims to known features).

---

## Recurring Items
- **PRD / CHANGELOG / ROADMAP file split** — done in iter 46. Future agents: keep PRD.md static; append to CHANGELOG.md after every finish; move items from ROADMAP to CHANGELOG when they ship.

# ForgeSlicer — Roadmap

Prioritised backlog. **P0** = must-fix now / blocking, **P1** = next planned feature, **P2** = polish / nice-to-have, **P3** = experimental / future.

> Append `[DONE — iter NN]` to the line when an item ships, then move it to `CHANGELOG.md`. Keep this file lean: it should be a glance-able to-do list, not a history book.

---

## 🔴 P0 — Blocking
*(none open as of 2026-05-30 — iter 70 cleared rc -17, iter 71 cleared Cloudflare 524 via async-job pattern)*

## 🟡 P1 — Next features
*(P1 cleared 2026-05-31 — iter 77 shipped cancel-slice, per-printer temps, and the bed-axis gizmo.)*
- ~~Sweep MVP follow-ups~~ [DONE — iter 51]
- ~~Fastener Pair macro~~ [DONE — iter 48]
- ~~Texture v2 patterns + apply-to-face + UNC/UNF imperial fasteners~~ [DONE — iter 50]
- ~~Composite library expansion — Countersinks / Gussets / Hex Pockets~~ [DONE — iter 50]
- ~~Hierarchical Project Structure (Rocket → Engine → Fuel Pump)~~ [DONE — iter 63]

## 🟢 P2 — Polish
- **Flexible triangle primitive** (iter-105.27 enhancement, 2026-06-26) — the triangle primitive currently only creates equilateral triangles. Add: base + height inputs, three angles + side lengths, a "right triangle" preset, and an isosceles / scalene picker. Keep the equilateral path as the default for backwards-compat with existing scenes. Likely touches `lib/store.js` (PRIMITIVE_DEFAULTS for triangle), the `Shape2DControls` block in `RightPanel.jsx`, and the triangle geometry builder in `lib/geometry.js`.
- **Refactor `lib/store.js` further** — was 1486 lines after iter 73; iter 74 extracted PRIMITIVE_DEFAULTS / buildPrimitive (→ `primitiveDefaults.js`) and the anchored-ruler action slice (→ `rulerActions.js`), bringing store.js to **1295 lines (-191, -13%)**. Further candidates: composite-primitives block (lines 676-997, ~320 lines) could move into a `compositeActions.js` slice next.
- ~~Tutorial coverage — Voice / Slicer-Compare / Gallery-Share PDFs~~ [DONE — iter 58]
- ~~HelpDialog.jsx split~~ [DONE — iter 59, 771→515 lines]
- **Save Assembly to Gallery silent-failure follow-up** — only acts if user reports it on prod with DevTools payload.

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

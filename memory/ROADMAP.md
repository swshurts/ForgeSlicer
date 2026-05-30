# ForgeSlicer — Roadmap

Prioritised backlog. **P0** = must-fix now / blocking, **P1** = next planned feature, **P2** = polish / nice-to-have, **P3** = experimental / future.

> Append `[DONE — iter NN]` to the line when an item ships, then move it to `CHANGELOG.md`. Keep this file lean: it should be a glance-able to-do list, not a history book.

---

## 🔴 P0 — Blocking
*(none open as of 2026-05-30 — iter 70 cleared the OrcaSlicer rc -17 cross-vendor compatibility regression)*

## 🟡 P1 — Next features
- **User-defined printers** — `user_printers` MongoDB collection + `POST/GET/PUT/DELETE /api/me/printers` + frontend "Define Printer" dialog. Lets users register the wave of 2026 printers (8-10 released since Jan, ~4 more this month) without waiting for OrcaSlicer's preset shipment cadence. Slice endpoint accepts `user_printer_id` and resolves it before falling back to bundled presets. Pairs naturally with the iter-70 cross-vendor patch.
*(all earlier P1 items complete as of iter 53)*
- ~~Sweep MVP follow-ups~~ [DONE — iter 51]
- ~~Fastener Pair macro~~ [DONE — iter 48]
- ~~Texture v2 patterns + apply-to-face + UNC/UNF imperial fasteners~~ [DONE — iter 50]
- ~~Composite library expansion — Countersinks / Gussets / Hex Pockets~~ [DONE — iter 50]
- ~~Hierarchical Project Structure (Rocket → Engine → Fuel Pump)~~ [DONE — iter 63]

## 🟢 P2 — Polish
- **Refactor `lib/store.js` further** — 1481→1300 lines after iter 59 (extracted I/O to projectIO.js). Further extraction candidates: the long boolean / cut / dimension action blocks could move into dedicated files.
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

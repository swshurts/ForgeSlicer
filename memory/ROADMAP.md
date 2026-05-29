# ForgeSlicer — Roadmap

Prioritised backlog. **P0** = must-fix now / blocking, **P1** = next planned feature, **P2** = polish / nice-to-have, **P3** = experimental / future.

> Append `[DONE — iter NN]` to the line when an item ships, then move it to `CHANGELOG.md`. Keep this file lean: it should be a glance-able to-do list, not a history book.

---

## 🔴 P0 — Blocking
*(none open as of 2026-02-28)*

## 🟡 P1 — Next features
*(all P1 items complete as of iter 53)*
- ~~Sweep MVP follow-ups~~ [DONE — iter 51]
- ~~Fastener Pair macro~~ [DONE — iter 48]
- ~~Texture v2 patterns + apply-to-face + UNC/UNF imperial fasteners~~ [DONE — iter 50]
- ~~Composite library expansion — Countersinks / Gussets / Hex Pockets~~ [DONE — iter 50]

## 🟢 P2 — Polish
- **Refactor `lib/store.js` further** — 1481→1164 lines after iter 53 (composites + selectionActions + cutActions extracted). Roughly 28% reduction. Future candidates: project I/O (`serialize` + `loadProject` + `clearScene`, ~60 lines), `addSweepFromSketch` (~80 lines, could move to `composites.js`), Texture / Hardware dialog state (~25 lines).
- ~~**Eyeball preview & gallery thumbnail callouts**~~ [DONE — iter 52]
- ~~**Voice button a11y**~~ [DONE — iter 52]
- **Save Assembly to Gallery/Share silent-failure follow-up** — only triggers if user reports a recurrence on prod with DevTools network payload + response captured.

## 🔵 P3 — Experimental / future
- ~~**"Resize to fit my bed" on Remix**~~ [DONE — iter 53] (was originally an enhancement suggestion — landed as the closing polish item)
- Direct ARM64 OrcaSlicer build for preview-pod parity (currently x86_64 AppImage only). **← Next focus per user.**
- Live multi-user editing (CRDT / Yjs).
- Photo → reference plane (drop a photo, snap dims to known features).

---

## Recurring Items
- **PRD / CHANGELOG / ROADMAP file split** — done in iter 46. Future agents: keep PRD.md static; append to CHANGELOG.md after every finish; move items from ROADMAP to CHANGELOG when they ship.

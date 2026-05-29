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
- **Refactor `lib/store.js` further** — 1481→1164 lines after iter 53. Further extraction candidates: project I/O (`serialize` + `loadProject` + `clearScene`, ~60 lines).
- **Tutorial coverage** — Voice, Slicer/OrcaSlicer/Compare-engines, Gallery/Share/Remix PDFs still missing. Same `tutorial_lib.py` pattern as Hardware / Sweep / Getting Started — ~30 min per new PDF.
- **Save Assembly to Gallery silent-failure follow-up** — only acts if user reports it on prod with DevTools payload.

## 🔵 P3 — Experimental / future
- ~~**"Resize to fit my bed" on Remix**~~ [DONE — iter 53]
- ~~**ARM64 OrcaSlicer**~~ [DONE — iter 54]
- ~~**Compare Engines** (v1, metrics-only)~~ [DONE — iter 55]
- **Compare Engines v2 — toolpath overlay** (deferred, user-confirmed): per-layer 3D toolpath rendering of BOTH slicers in different colors with a layer slider + diff highlight for segments only present in one engine.
- **Search for community OrcaSlicer ARM64 binaries** — user-requested follow-up: check whether any community fork ships a true headless / non-flatpak ARM64 build that would let us drop the GNOME runtime dependency (~280 MB on disk).
- **SlicerPopover refactor** — file at 545 lines after Compare Engines wiring (code-review threshold = 500). Natural extraction: `useOrcaSlice()` hook for the Orca branch of handleSlice + the inline subscribeProgress helper.
- Live multi-user editing (CRDT / Yjs).
- Photo → reference plane (drop a photo, snap dims to known features).

---

## Recurring Items
- **PRD / CHANGELOG / ROADMAP file split** — done in iter 46. Future agents: keep PRD.md static; append to CHANGELOG.md after every finish; move items from ROADMAP to CHANGELOG when they ship.

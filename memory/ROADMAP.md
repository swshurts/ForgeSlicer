# ForgeSlicer — Roadmap

Prioritised backlog. **P0** = must-fix now / blocking, **P1** = next planned feature, **P2** = polish / nice-to-have, **P3** = experimental / future.

> Append `[DONE — iter NN]` to the line when an item ships, then move it to `CHANGELOG.md`. Keep this file lean: it should be a glance-able to-do list, not a history book.

---

## 🔴 P0 — Blocking
*(none open as of 2026-02-28)*

## 🟡 P1 — Next features
- **Sweep MVP follow-ups (iter 46 deferred — all 3 closed)**:
  - ~~Thread `scene` context through `lib/csg.js` so `path.kind: "ref"` sweeps export correctly~~ [DONE — iter 48]
  - ~~`profile.kind: "sketch"` — wire up "Use as sweep profile" from a sketch context menu so the user can sweep an arbitrary 2D drawing.~~ [DONE — iter 51]
  - ~~`path.kind: "sketch3d"` — let users draw a 2D polyline and use it as a 3D sweep path (with optional linear Y-rise).~~ [DONE — iter 51]
- ~~**Fastener Pair macro**~~ [DONE — iter 48]
- **Texture Library v2** (follow-ups to iter 49):
  - Additional patterns: diamond plate / tread, brick / fabric weave / decorative, hex camo, parametric voronoi.
  - ~~Right-click "Apply texture to face..." action that opens TextureLibraryDialog with `targetObjectId` set so the footprint auto-sizes to the picked face.~~ [DONE — iter 50]
  - Imperial fastener grades (UNC/UNF) in the Hardware Library to mirror ISO metric coverage. [DONE — iter 50]
- **Composite library expansion** — chamfered countersinks, gussets, hex pockets (mentioned in the Composites footer as "coming soon" — flesh out with the same pattern Slot + Fastener Pair use). [DONE — iter 50]

## 🟢 P2 — Polish
- **Refactor `lib/store.js` further** — now at 1147 lines after iter 46 split. Group ops + sketch state could still come out (target <800 lines).
- **Eyeball preview & gallery thumbnail callouts** — overlay X/Y/Z extents + bed clearance on the rendered preview so it goes from "looks right" to "ready to print" at a glance.
- **Save Assembly to Gallery/Share silent-failure follow-up** — user reported "Pitman Arm didn't save" but could not be reproduced in preview testing. If it recurs on prod, capture full DevTools network payload + response so we can trace it.
- **Voice button a11y** — add `aria-pressed` to the mic button and a `data-testid` for the Group / Combo button (flagged by iter 15 testing agent).

## 🔵 P3 — Experimental / future
- Direct ARM64 OrcaSlicer build for preview-pod parity (currently x86_64 AppImage only).
- Live multi-user editing (CRDT / Yjs).
- Photo → reference plane (drop a photo, snap dims to known features).

---

## Recurring Items
- **PRD / CHANGELOG / ROADMAP file split** — done in iter 46. Future agents: keep PRD.md static; append to CHANGELOG.md after every finish; move items from ROADMAP to CHANGELOG when they ship.

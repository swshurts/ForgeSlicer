# ForgeSlicer — Axis Convention Migration (iter-104)

## Why
Industry CAD (SolidWorks, Fusion 360, OnShape, FreeCAD, Inventor) all use
**Z-up**: X = right, Y = forward (away from viewer), Z = up. Users who
learn ForgeSlicer should NOT have to unlearn axis conventions when they
move to "real" CAD.

ForgeSlicer's current internal state is awkward: dimension LABELS are
already Z-up (`dims.z` is "the up dim") but the rendered scene runs on
Three.js's native Y-up convention. So `position[1]` is "up" while
`dims.z` is also "up". This dual convention is the root of every
"why is my cube lying on its side" bug we've shipped.

User decision (2026-02-19): full conversion. Option (c) + order A —
Three.js's internal coord space becomes Z-up via
`THREE.Object3D.DEFAULT_UP = new Vector3(0, 0, 1)`, **and** every
position/dim mapping becomes 1:1 with the user-facing label.

## Target convention (post-migration)
- `dims.x` → world X (right)
- `dims.y` → world Y (forward)
- `dims.z` → world Z (up)
- `position[0]` → world X
- `position[1]` → world Y (forward)
- `position[2]` → world Z (up)
- `rotation[0]` → rotation about X (pitch)
- `rotation[1]` → rotation about Y (roll, was "yaw" in old convention)
- `rotation[2]` → rotation about Z (yaw, was "roll")
- Default cylinder axis = world Z (currently world Y, needs `rotateX(π/2)`
  at construction)
- Bed plane = XY (Z = 0)

## File-by-file change list

### Tier 1 — boot / scene root (must change atomically)
| File | Change |
| --- | --- |
| `frontend/src/index.js` | Set `THREE.Object3D.DEFAULT_UP = new Vector3(0, 0, 1)` immediately after React import. |
| `frontend/src/components/Viewport.jsx` | Camera default positions: was `[200, 100, 200]` (XZ orbit); becomes `[200, -200, 100]` (XY orbit, Z up). Build plate: rotate to lie on XY plane. Gizmo viewport: relabel X/Y/Z, accept new orientation. OrbitControls `target`: was `[0, buildVolume.z/4, 0]`; becomes `[0, 0, buildVolume.z/4]`. |
| `frontend/src/lib/geometry.js` | `buildGeometry` cube path: change `BoxGeometry(d.x, d.z, d.y)` → `BoxGeometry(d.x, d.y, d.z)`. Cylinder path: apply `geom.rotateX(Math.PI/2)` so default axis is Z. Sphere unchanged. Cone/Helix/Pipe/etc: each needs to be re-pointed to Z-up. |
| `frontend/src/lib/store.js` | `addPrimitive` default Y-drop becomes Z-drop (`position[2] = dims.z/2`). All `position[1]` references for "up" → `position[2]`. `dropToBed`, `centerOnBed`: bbox.min.y → bbox.min.z. `bakeScaleIntoDims`: y/z roles swap. |

### Tier 2 — geometry math (each is self-contained)
| File | Change |
| --- | --- |
| `lib/partialFillet.js` | Heavy. Rewrites in `buildEdgePieces`, `cubeFaceQuads`, `cubeEdgeEndpoints`. The convention comment at top — currently `dimsLocal = { x: w, y: h, z: dep }` — flips back to `{ x: w, y: dep, z: h }` (1:1 with user dims). Rotation arrays (`[90,0,0]` for Y axis, `[0,90,0]` for X axis) need rewinding. Regression test `__tests__/partialFillet.regression.mjs` rewrites. |
| `lib/edgeFaceMeta.js` | The `hyHeight`/`hzDepth` halves swap meaning. Edge `axis` letters stay the same (still X/Y/Z) but the LOCAL frame they reference is now 1:1 with dims. |
| `lib/manifoldEngine.js` | `buildObjectManifold` cube path: `Manifold.cube([w, h, dep])` becomes `Manifold.cube([d.x, d.y, d.z])`. The `_applyTransformAfterGeom` Euler order is fine. |
| `lib/csg.js` | Most code is geometry-agnostic, but check `applyTransform` carefully. |
| `lib/voicePlanExecutor.js` | The bbox computation from raw vertices already uses min/max XYZ — no semantic change. The default position `[0, 0, 0]` is fine. But step `position` arrays from the LLM/templates are now interpreted with the new mapping. |
| `lib/slicer.js` | Layer-slicing iterates `z` — this is already the right axis after migration. Confirm. |
| `lib/exporters.js` | STL/OBJ/3MF export: most exporters bake the world transform, so they're geometry-pure. But the multi-material 3MF metadata might pin axis hints — audit. |

### Tier 3 — every voice template (deterministic geometry)
All in `backend/voice_templates/`. Each template's `position` arrays
need migrating from `[x, y_up, z_depth]` to `[x, y_forward, z_up]`,
and dim layouts (`{x, y, z}`) from `(width, depth, height)` to
`(width, forward, height)` — wait, that's the same letter mapping but
the meaning is different. Specifically:

- **bracket.py** — `_horizontal_plate` builds dims `{x: w, y: d, z: t}`
  and positions at `[0, t/2, 0]`. The thickness `t` was world-Y in
  the old convention; it's world-Z now. Position becomes `[0, 0, t/2]`.
  The vertical plate equivalently flips.
- **boards.py** — wall mode positions at `[cx_world, cy_world, 0.0]`
  where `cy_world` was the "Y above bed". Now becomes `[cx, 0, cz]`
  with the height stored in position[2]. The plate's dims need the
  same flip.
- **drawer_pull.py** — base/post/finial all use `position[1]` for the
  "up" Y. Each becomes `position[2]`.
- **tool_holder.py** — same.
- **cable_comb.py** — same. The slot cutters' `position[1]` flips.
- **spool_spacer.py** — the entire cylinder stack uses
  `position[1]` for height. Flips.
- **vise_jaws.py** — bodies at `[centre_x, H/2, 0.0]` → `[cx, 0, H/2]`.
  V-groove rotation `[0, 0, 45]` was about Z (the "up" axis); now
  the V-groove still wants to be rotated about the up axis, so
  `[0, 0, 45]` stays — but the cutter dims change: was `dims={x: w, y: W+2, z: v_half*2}` (where y was the long along-jaw axis, z the V depth); becomes `{x: w, y: W+2, z: v_half*2}` if y is now still the along-jaw axis (it is — forward), so no change. CAREFUL: V-groove orientation needs revisiting.
- **project_enclosure.py** — heaviest rewrite. Shell, cavity, vents,
  corner posts, and the helper `_add_vent_slots` all encode positions
  per axis.
- **hose_adapter.py** — vertical cylinder stack. `_build_section`
  positions at `[0, y_bottom + length/2, 0]`. Becomes
  `[0, 0, z_bottom + length/2]`. Default cylinder axis is now Z
  (from Tier 1), so no per-cylinder rotation needed for the upright stack.

### Tier 4 — UI surfaces
| File | Change |
| --- | --- |
| `components/RightPanel.jsx` & inspector subfiles | Number-field labels: "Y (depth)" → "Y (forward)" or just "Y"; "Z (height)" → "Z (up)" or just "Z". Position display unchanged in symbolic form but interpretation flips. |
| `components/popovers/PositionPopover.jsx` | Field order may need rearranging so Z comes last (the up axis). |
| `components/popovers/ScalePopover.jsx` | base-size display: `baseArr[0] × baseArr[1] × baseArr[2]` — same indices, new meaning. |
| `components/StatusBar.jsx` | "BUILD: 220×220×250" — order already conveys X × Y × Z, no change. |
| `components/dialogs/PrintPreviewDialog.jsx` | The slicer pipeline already does its own coordinate handling; audit. |
| `components/popovers/SnapAndPlatePopover.jsx` | Design plate dim labels — "Width / Depth / Height" stay correct. |

### Tier 5 — tests
| File | Change |
| --- | --- |
| `backend/tests/test_voice_templates.py` | Plate position assertions: `position[1]` for "up" → `position[2]`. |
| `backend/tests/test_voice_templates_boards.py` | Wall plate "above bed" tests check `position[1]`; flip to `position[2]`. Plate dims-spread assertions (`d['z'] > d['y']`) reverse: wall is now tall in Z. |
| `frontend/src/lib/__tests__/partialFillet.regression.mjs` | bbox checks use `bb.min/max[0/1/2]` — semantically need to remap once cube construction changes. |

## Sequencing (suggested)
1. **iter-104.1 — Foundation only.** Tier 1 + Tier 2 partial-fillet rewrite + Tier 5 test stubs. App may render templates incorrectly until iter-104.2. Smoke screenshot at the end. Tests pinned to skip/xfail for affected templates.  
   **STATUS (2026-02-19): DONE** — Tier 1 (`index.js` DEFAULT_UP, `Viewport.jsx` camera/plate/overlays/cut-gizmo, `geometry.js` 1:1 dims, `store.js` Z-drop everywhere, `csg.js` plane cut +Z normal, `slicer.js` Z→Y pre-rotation, `exporters.js` removed Y↔Z passes) + Tier 2 (`partialFillet.js` cube `dimsLocal` 1:1 + cube/cylinder/cone lathe Z-up, `edgeFaceMeta.js` 1:1 dims + relabeled faces/edges, `manifoldEngine.js` inherits via `buildGeometry`) shipped. Tier 5 test stubs SKIPPED per user (option b). Smoke screenshot verified: build plate lies on XY, cube stands up on Z-up, gizmo "Z is up" label correct.
2. **iter-104.2 — All voice templates.** Tier 3 in one batch. Re-enable Tier 5 tests; all should pass.  
   **STATUS (2026-02-19): DONE** — Programmatic swap of `position[1]↔position[2]` and `rotation[1]↔rotation[2]` across all 9 voice templates (`bracket`, `boards`, `drawer_pull`, `tool_holder`, `cable_comb`, `spool_spacer`, `vise_jaws`, `project_enclosure`, `hose_adapter`) — 45 occurrences. Dims dicts unchanged (already had `z` = "up" semantics). LLM system prompt in `backend/server.py` rewritten for Z-up CAD convention. Backend tests passing: `test_voice_templates.py` 15/15 + `test_voice_templates_boards.py` rewritten and 8/8 passing. Live verification: `/api/voice/expand-template` for Pi 4 returns `position=[0, 0, 12.25]` (Z-up) for the wall plate.
3. **iter-104.3 — UI polish + final regression sweep.** Tier 4 labels (notably "Bottom Y" → "Bottom Z" in the Inspector transform readout, "Y (depth)" → "Y (forward)" in dim labels), ensure no `position[1]` left meaning "up" anywhere via grep audit, run full test suite + manual screenshot per template.  
   **STATUS (2026-02-19): DONE (partial)** — `RightPanel.jsx` "Bottom Y" → "Bottom Z" + `data-testid="bottom-z"` swapped; `selectionActions.js` mirror-axis Z floor-clamp updated; final grep pass over `/app/frontend/src/lib` shows remaining `position[1]`/`bb.min.y` references are now legitimately Y=forward usages (not Y=up). Pre-existing comments in some files (e.g. helper variable names like `cy`/`cz` in templates) still use Y-up terminology but values are functionally correct after the swap.

Each iteration takes ~1 fresh session's context to do safely.

## Risks
- **Imported STL/3MF files** baked with the old axis assumption will
  load LYING ON THEIR SIDE after migration. We need a one-time
  per-project flag or a top-level "Z-up" import banner so the first
  load of legacy projects gets a 90° rotation prompt.
- **Saved projects.** Every `.forge.json` ever written encodes
  positions/dims in the old convention. On load, detect missing
  `__axisConvention: "zup"` flag → apply `(x, y_up, z_depth) →
  (x, z_depth, y_up)` rewrite at deserialize time.
- **Voice executor LLM prompt.** The system prompt explicitly teaches
  the LLM the old convention. Needs a coordinated update or the LLM
  will keep emitting old-style positions.
- **Manifold-3D library.** Its API is axis-agnostic — `cube([x,y,z])`
  just takes spans — so it follows whatever we feed it. Safe.

## Until migration completes
Document at the top of the README that the API surface (templates,
exported STL, saved projects) is changing in iter-104.x and pin the
current behaviour as "ForgeSlicer v1 axis convention" so external
integrations have a versioned reference.

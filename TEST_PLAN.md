# ForgeSlicer — Comprehensive User Test Plan

Use this as a guided workout. Each section is a self-contained scenario with
**Setup**, **Steps**, and **Expected** results. Mark each with ✅ as you go.

> Tip — open the browser **DevTools console** (F12) before you start so you can
> spot any errors that appear during a test.

---

## 0. Environment Smoke

| | Check |
|-|-------|
| 0.1 | Landing page (`/`) loads with hero + feature grid |
| 0.2 | "Launch Workspace" navigates to `/workspace`; build plate visible, grid + axes gizmo render |
| 0.3 | "Public Gallery" link opens `/gallery`, both **Designs** and **Components** tabs work |
| 0.4 | No red errors in browser console |

---

## 1. Primitive Add / Inspector

**Setup**: Fresh workspace.

1.1 Click each positive primitive: **Cube, Sphere, Cylinder, Cone, Torus**.
  → Each appears at build-plate origin, default size, listed in the Outliner with the icon.

1.2 Click each 2D shape (Circle, Square, Triangle, Polygon).
  → Appears as a thin "wafer" (h = 1 mm). Resize H in the Inspector to extrude.

1.3 Select any primitive. In the **Right Panel Inspector**:
  - Change **Name** → outliner row updates.
  - Toggle **Positive / Negative** → object turns cyan when negative.
  - Click a **Filament Color** swatch → object color updates in viewport.
  - Edit **Dimensions** numerically → size changes live, dimension chip (bottom-left of viewport) updates.

1.4 Switch to the **Add Negative** palette and add a negative cylinder. Drag it through a positive cube.
  → The cylinder shows cyan + translucent inside the cube (a hole preview).

---

## 2. Transforms via Gizmo, Popovers, and Keyboard

**Setup**: One cube selected.

2.1 **Gizmo modes** — press `G` (translate), `R` (rotate), `S` (scale). Each click and drag of the arrow/ring/handle should move/rotate/scale the cube.

2.2 **Snap** — click the Magnet icon to toggle snapping. Translate snap = 1 mm by default; rotate snap = 15°.

2.3 **Position popover** — click **Position** in the top toolbar.
  - Type new X / Y / Z mm. Pressing Tab or Enter commits the change.
  - Use Down arrow to nudge.

2.4 **Rotation popover** — click **Rotation**.
  - Type angles. Negative values rotate the other way.
  - Toggle **Auto-drop to bed on rotate** in the inspector and re-test rotate. The cube re-seats after rotation.

2.5 **Size popover** — click **Size**.
  - Aspect-ratio **lock**: with lock ON, editing X also scales Y and Z by the same ratio.
  - Free per-axis: untick the lock, edit only Z.
  - Try the **Real Size (mm)** column — enter 50 mm, the percent column updates accordingly.

2.6 **Bbox chip** — bottom-left of the viewport shows `SIZE w × d × h mm · Name`. It should stay out of the model and update live.

---

## 3. Boolean Ops (CSG)

**Setup**: One positive cube + one negative cylinder roughly intersecting.

3.1 Click **Union (+)** in the toolbar → both merge into one orange mesh.
3.2 Undo (`Ctrl+Z`).
3.3 Click **Subtract (−)** → the cylinder is carved out of the cube. The result is a single positive imported mesh in the Outliner.
3.4 Undo + try **Intersect** → only the volume common to both remains.

> Edge case: combine a thin slab and a tall cylinder that *just* touch. The
> CSG engine may warn "MESH HAS N OPEN EDGES" — that's expected; slicers
> auto-repair on import.

---

## 4. Selection (Single, Multi, Marquee, Groups)

**Setup**: Add 3 cubes scattered on the bed.

4.1 **Single** — click each cube; the orange outline highlights only it.
4.2 **Ctrl-click** — toggle add/remove of individual items in the selection set.
4.3 **Shift-click** — additive selection.
4.4 **Marquee** — hold **Shift**, drag a rectangle across the viewport.
  - The orange dashed box appears.
  - On release, every cube fully or partially inside is selected.
  - Confirm `DUPLICATE (N)` badge in the toolbar shows the count.

4.5 **Marquee + Ctrl** — Hold **Ctrl+Shift**, drag → adds to existing selection instead of replacing.

4.6 **Group** — select 2+ cubes, right-click → **Group selected**. An "ASSEMBLY" header appears in the Outliner with all members nested.

4.7 **Click a group member** → the whole group selects (Duplicate badge shows `(N)`).

4.8 **Marquee around a group** → also selects every group member.

4.9 **Drag the gizmo** while the group is selected → **all members move together**.

4.10 **Ungroup** — right-click → **Ungroup**. The header disappears; items return to top level.

4.11 **Flatten** — right-click → **Flatten to single mesh**. The originals are removed and a single baked mesh remains.

4.12 **Right-click in the Outliner** on a row → the context menu opens (same actions).

---

## 5. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| G / R / S | Translate / Rotate / Scale mode |
| M | Toggle Measure mode |
| Esc | Exit Measure / clear selection |
| Delete / Backspace | Delete all selected |
| Ctrl+D | Duplicate selection |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Shift (held) | Marquee box-select overlay |
| Ctrl+Shift+drag | Additive marquee |

5.1 Verify each. Type inside the project-name input — Delete/Backspace should **not** wipe the scene (input editing only).

---

## 6. Measurement Tool

6.1 Press **M** (or click the Ruler icon). The "MEASURE MODE" banner appears.
6.2 Click two points on any object → a green dimension label appears between them with distance in mm.
6.3 Click the small × on the label to remove an individual measurement.
6.4 Press Esc to exit measure mode; existing measurements stay until cleared.

---

## 7. Duplicate & Mirror

**Setup**: 1 cube selected.

7.1 Click **Duplicate** popover. Use the X / Y / Z mirror buttons inside.
  - **Duplicate** → an offset copy.
  - **Mirror X / Y / Z** → an axis-flipped copy reflecting about origin.

7.2 Select multiple objects, then Duplicate → the badge shows `(N)`; all N get cloned at once.

---

## 8. Import / Export Round-trip

8.1 **Export STL** — click the STL icon. A `<project>.stl` file downloads. Open in any viewer to confirm geometry.
8.2 **Export 3MF** — click the Layers icon. If the scene uses 2+ filament colors, a multi-object 3MF is emitted (the busy banner mentions `N-part 3MF`).
8.3 **STL Preview** — click the Eye icon → opens a 3D preview modal showing exactly what will be sliced/exported.
8.4 **Save Project** — click the Save icon → `.forge.json` saved locally.
8.5 **Open Project** — click the Open icon, pick the `.forge.json` → scene restored.
8.6 **Import STL/3MF/OBJ** — click the Upload icon. The mesh appears centered on the bed.
8.7 **Landing-page import** — back at `/`, click **Import STL · 3MF · OBJ** → choose a file → workspace opens with that mesh loaded + green banner.

---

## 9. Component Library Round-trip

9.1 Build a small assembly (e.g. cube 60 × 60 × 4 mm + 4 negative cylinders r=2 h=10 forming a 50 mm screw-hole rectangle).

9.2 **Save** — click **Component**. Type a name, pick **Type: Negative**, leave "Include parts of the opposite modifier" UNCHECKED.
  - "Saving N parts" summary should read `4 parts · 1 skipped (not negative)`.
  - Click **Publish to Library** → success banner.

9.3 Open **Gallery → Components tab** → your component is listed.

9.4 Click **Add to Scene** on the card → workspace opens, the 4 negative cylinders are imported, the assembly drops onto the build plate (lowest point at Y=0).

9.5 Drop them onto a new 60×60 positive plate → they subtract as expected on Export STL.

9.6 **Preview** the saved component (Eye icon on the card) — should render in a 3D modal.

---

## 10. Public Designs Gallery

10.1 In the workspace, click **Share** → fill name/author → publish.
10.2 Gallery → Designs tab → your design appears.
10.3 Click **Remix** → workspace opens with the design loaded and `remixOf` set.
10.4 Modify → Share again → remix lineage is recorded.

---

## 11. Slicer Hand-off

11.1 Click **Slicer** popover → pick layer height, infill, temps.
11.2 Click **Slicer popover → Export GCODE** → a .gcode file downloads.
11.3 Click **Send to OrcaSlicer** → 3MF downloads + an instructions dialog appears.
11.4 The split dropdown next to "Send to …" shows alternate slicers (Prusa, Cura).

---

## 12. Voice Commands (GPT-5.2)

> Requires Chrome or Edge (Web Speech API). The **Voice** button is in the top toolbar (right-side, before the project-name input).

For each scenario, click **Voice**, speak the phrase, wait for the green banner.

| # | Say | Expected |
|---|-----|----------|
| 12.1 | "add a cube to the drawing with dimensions x = 252 mm, y = 6 mm, and z = 44 mm" | Cube added at exactly 252 × 6 × 44 mm |
| 12.2 | "add a negative cylinder radius 5 height 10" | Cyan cylinder appears |
| 12.3 | "move selected 10 millimeters to the right" | Selected part moves +10mm X |
| 12.4 | "rotate 90 degrees on Y" | Rotates 90° about Y |
| 12.5 | "duplicate the selection mirrored on X" | Mirror copy added |
| 12.6 | "subtract" | Boolean subtract runs on last two objects |
| 12.7 | "drop to bed" | Selection re-seats on Y=0 |
| 12.8 | "delete it" | Selection removed |
| 12.9 | "select all" | All scene objects selected |
| 12.10 | "group" / "ungroup" | Group / ungroup the multi-select |
| 12.11 | "undo" / "redo" | History pointer moves |
| 12.12 | "export STL" / "export 3MF" / "save project" | File downloads |
| 12.13 | "save as component" | Save Component dialog opens |
| 12.14 | (gibberish) "purple monkey dishwasher" | Yellow banner: "Could not understand…" |

> The on-screen banner echoes what was **Heard** + the action taken — useful
> to spot speech-recognition mishears (e.g. "to" vs "two").

---

## 13. Undo / Redo Robustness

13.1 Add cube, sphere, cylinder. Press Ctrl+Z three times → scene empty.
13.2 Press Ctrl+Y three times → scene restored.
13.3 Combine into a Union, then Ctrl+Z → originals back. Ctrl+Y → union back.

---

## 14. Build Volume / Printer Profile

14.1 Right panel → **Printer & Filament** → switch printer. Build plate dimensions update.
14.2 Click **Save mine** → enter brand/name/build volume → publish to community.
14.3 In a new workspace, your printer appears in the dropdown.

---

## 15. Edge Cases / Regression Hot-spots

15.1 Scale a part to 0 mm via Backspace in the Size popover → the workspace should **not** freeze.
15.2 Rotate an imported mesh repeatedly back to 0° → the mesh stays visible (no buffer-mutation bug).
15.3 Send to Slicer dialog should auto-close after the 3MF downloads.
15.4 Boolean subtract a negative shape larger than the positive → result may be empty; toolbar shows the error gracefully.
15.5 Add 50+ primitives → performance still smooth (CSG runs in a Web Worker).
15.6 Refresh the page during boolean → no half-state.

---

## 16. Acceptance Checklist (sign-off)

- [ ] Every primitive can be added, transformed, and exported as STL.
- [ ] Marquee + group + drag moves entire assembly.
- [ ] Voice commands add primitives at exact specified dimensions.
- [ ] Saved components recall with original dimensions and drop to bed.
- [ ] STL/3MF exports open cleanly in OrcaSlicer (negatives subtracted).
- [ ] No console errors at any step.

---

_Last updated: 2026-02-17_

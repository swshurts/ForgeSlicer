# ForgeSlicer — User Acceptance Testing (UAT)

Last updated: **2026-02-25** (post Iteration 48 — SVG group-import + release-date timezone fix)

> Walk top-to-bottom on a fresh browser tab signed into the **preview** environment.
> Tick `[x]` as you verify, or leave a comment after `→` for anything broken.
> When you finish, paste the bullets you marked failed/odd back to the agent.

---

## 🆕 Today's fixes worth confirming first
- [ ] **Release-notes dates show correct day** in your local timezone (Feb 25 entries no longer show Feb 24)
- [ ] **SVG logo import → one selectable assembly** (Section 4 below has the detailed checks)
- [ ] **AMS-aware GCODE preview** when scene has 2+ colour slots (Section 7a)

---

## 0. Pre-flight

- [ ] Preview URL loads at `REACT_APP_BACKEND_URL` without console errors
- [ ] Announcement / "What's new" dialog opens once and auto-closes / dismisses
- [ ] `/api/auth/me` returns 200 when signed in (DevTools → Network)

---

## 1. Auth (Iteration 34)

- [ ] **Email + password** signup creates an account and lands on `/workspace`
- [ ] **Magic link** sign-in delivers email and authenticates on click
- [ ] **Google sign-in** completes without an R3F overlay/crash
- [ ] Hard reload after sign-in keeps the user logged in (cookie persists)
- [ ] Incognito session: sign-in succeeds end-to-end (CORS/cookies OK)
- [ ] Sign out clears `/api/auth/me` to 401

---

## 2. Core CAD — primitives, transforms, booleans

- [ ] Add cube / sphere / cylinder / cone / torus from the left palette
- [ ] Each new part auto-drops so its bottom sits on Y=0 (build plate)
- [ ] Translate / rotate / scale gizmos work; snap toggles affect step sizes
- [ ] Inspector edits (dims, position, rotation) reflect instantly in the viewport
- [ ] Boolean **Union** of two overlapping cubes produces a clean merged mesh
- [ ] Boolean **Subtract** carves the second from the first (no leftover slivers)
- [ ] Boolean **Intersect** keeps only the overlap region
- [ ] Undo (Ctrl+Z) reverts the last boolean in a single step
- [ ] Manifold ✓ badge appears in the GCODE popover after a clean slice

---

## 3. Sketch / 2D drawing mode (Iteration ~44)

- [ ] Toggling **Sketch mode** in the toolbar shows the 2D canvas overlay
- [ ] Polygon tool: clicking 4+ points and finishing creates a closed shape
- [ ] Freehand tool draws a continuous stroke without lag
- [ ] Cancel button discards the sketch and returns to 3D mode
- [ ] **Extrude to 3D** commits the sketch as a positive object at the drawn XZ
- [ ] Inspector allows editing the extruded sketch's height + modifier flag
- [ ] Undo works after committing a sketch

---

## 4. SVG Import (Iteration 46 — updated Iteration 48)

- [ ] **File → Import SVG** opens the `SVGImportDialog`
- [ ] Dragging a real SVG (logo / icon) into the dialog shows a preview
- [ ] Width/height/extrude depth fields update the preview live
- [ ] **Multi-path SVGs** (≥2 paths) show a purple "Group as one assembly" toggle, **ON by default**
- [ ] Importing a 565-path logo with grouping ON: clicking any glyph in the workspace selects the **whole logo** (all paths highlighted at once)
- [ ] Moving/rotating with the gizmo moves the **whole logo** as one
- [ ] Unchecking the toggle: paths import as separate, individually selectable objects (legacy behaviour)
- [ ] Single-path SVGs skip the toggle entirely (no UI noise)
- [ ] **Import as Sketch** lands a 2D wafer in the scene at the chosen size
- [ ] **Import as Extrusion** lands a 3D part at the chosen depth
- [ ] Imported SVG parts respect the auto-drop-to-bed preference
- [ ] Undo removes the imported SVG cleanly (one step, even for grouped multi-path)

---

## 5. STL / OBJ / 3MF Import + Auto-repair (Iteration 45)

- [ ] Drag an `.stl` file onto the workspace — mesh appears, sits on bed
- [ ] Importing a known-imperfect STL (e.g. Thingiverse model) does **not** vanish in preview/slicer
- [ ] BVH fallback kicks in silently when manifold-3d rejects the import
- [ ] Inspector shows mm dimensions (originalBbox preserved)
- [ ] Resizing the imported mesh keeps its bottom on Y=0
- [ ] `.obj` and `.3mf` files import without errors

---

## 6. Slicer + GCODE export (Iterations 35–36, 40)

- [ ] Slicer popover opens and respects current printer's build volume
- [ ] Slicing a 20mm cube with default settings emits a non-empty GCODE
- [ ] Top + bottom solid bands honour the configured layer counts
- [ ] Infill pattern selector: rectilinear / grid / gyroid each produces visibly different layer fills
- [ ] Transition layers boost density between sparse and solid bands
- [ ] **GCODE downloads on first click** (no silent drop)
- [ ] Emerald "Saved as `<file>.gcode`" confirmation appears
- [ ] "Download `<file>` again" re-fires the same payload without re-slicing
- [ ] Header advertises infill % + pattern (`; ForgeSlicer 1.0 - GCODE (… 15% gyroid …)`)

---

## 7. GCODE Preview Viewer (Iteration 42)

- [ ] **Preview toolpaths** button opens the layer scrubber
- [ ] Slider + prev/next buttons step through layers; Play animates
- [ ] Layer stats (Z, Extrude, Travel, Layer) update per layer
- [ ] Single-material print renders orange extrude + grey travel (legacy look)

### 7a. AMS-aware Preview (Iteration 47 — NEW)

- [ ] In the Inspector, assign 2+ scene objects to **different colour slots** (T0 White, T7 Orange, etc.)
- [ ] Slice & open the preview — **AMS · N tools** badge appears in the dialog header
- [ ] **Extruders legend** chips show each active tool with the correct hex swatch
- [ ] Toolpaths render per-extruder in their assigned colours (not all orange)
- [ ] **Tool-change rings** appear at the changeover XY positions per layer
- [ ] **Tool Chg** stat increments on layers that swap filament
- [ ] Clicking a legend chip **hides** that extruder's segments; clicking again restores them
- [ ] GCODE header includes `; AMS_TABLE T0=#... T1=#...` line
- [ ] `T<n>` tool-change commands appear between per-colour blocks in the GCODE
- [ ] Reverting back to a single-colour scene re-slices to legacy single-tool output (no badge, no legend)

---

## 8. Export (STL / 3MF)

- [ ] **Export STL** produces a single-mesh binary STL that loads in OrcaSlicer
- [ ] **Export 3MF** with multi-colour scene produces a multi-object 3MF whose colours match in OrcaSlicer/Bambu Studio
- [ ] Send-to-OrcaSlicer dialog gives copy-pasteable instructions

---

## 9. Gallery + Sharing

- [ ] **Share to Gallery** uploads STL with author, title, and (where applicable) manifold ✓ badge
- [ ] Public gallery lists the new item without refresh
- [ ] Remixing another user's item opens it in workspace with `remixOf` set
- [ ] Profile shows the user's remix activity feed (Iteration 41)
- [ ] Delete-own-item works; cannot delete others'

---

## 10. Billing (Iteration 43)

- [ ] `/pricing` page lists tiers with correct copy
- [ ] **Checkout** opens Stripe-hosted page; completing a test card redirects to `/billing/success`
- [ ] `/api/auth/me` returns the upgraded `subscription_tier` after success
- [ ] User menu shows the new tier badge
- [ ] Downgrade/cancel flow (if applicable) reflects in the menu

---

## 11. Voice + AI

- [ ] Voice command "add a 30mm cube" creates a 30mm cube in the scene
- [ ] AI **Generate from text** produces a 3D mesh and adds it to the workspace
- [ ] Generated meshes can be moved, scaled, and exported like any imported mesh

---

## 12. Admin (admin accounts only)

- [ ] Admin panel lists users with tier + last sign-in
- [ ] Admin audit log captures actions (impersonate, tier change, delete)

---

## 🐛 Outstanding-issue capture

Use this section while testing — list anything that fails / feels off so we can triage:

| # | Area | Description | Repro steps | Priority guess |
|---|------|-------------|-------------|----------------|
|   |      |             |             |                |
|   |      |             |             |                |

When you're done, paste this table (or just the failing checkboxes) back to the agent.

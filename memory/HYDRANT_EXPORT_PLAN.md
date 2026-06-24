# Hydrant Cutout Export — Path Forward

**Context**: The boolean engine drops the cube subtraction on the hydrant because
the AI-generated STL is non-manifold (open edges, self-intersections). Two
in-app voxel-remesh attempts this week produced blob output and were deleted.
This document compares five real paths forward, with honest effort and cost.

---

## TL;DR — recommended order

| Priority | Option | Dev | Per-use $ | Quality | Verdict |
|---|---|---|---|---|---|
| **DO FIRST** | **A — 3MF modifier-mesh export** | 4–6 h | $0 | Perfect | The right engineering answer. |
| Also do | B — "Repair Outside" handoff polish | 1–2 h | $0 | N/A | 1-day quick win, helps STL users. |
| Maybe later | C — Self-host MeshLab repair worker | 2–3 d | $0 | Very good | If we want STL to "just work". |
| Skip | D — libigl winding-number → WASM | 3–7 d | $0 | Best possible | Too much engineering for the payoff. |
| Skip | E — Voxel-remesh v3 | 1–2 d | $0 | Likely still blob | Proven dead-end. |

Net plan if you say yes to A + B: **half-day to a day** of work, **zero per-use
cost**, AI hydrants export correctly forever. The remaining options are
optional polish.

---

## Option A — 3MF modifier-mesh export ⭐ RECOMMENDED

**What it is.** Stop doing the boolean during export. Write a 3MF file that
contains BOTH meshes — the host as the "build object" and the negative cube
as a "negative volume modifier" attached to it. OrcaSlicer, Bambu Studio,
PrusaSlicer, and Cura all support modifier meshes natively. **The slicer
does the boolean at slice time** using their robust internal CSG, which is
already designed to handle hobbyist-quality STL input.

This is how Onshape / Fusion / SolidWorks export multi-part assemblies to
slicers, and it's the OFFICIAL 3MF/PrusaSlicer recommendation for
non-watertight inputs. It's also literally faster than us doing the CSG
ourselves.

**Workflow**:
1. User builds hydrant + filleted cube negative.
2. Clicks Export 3MF.
3. Result opens in OrcaSlicer with the cube already attached as a negative
   modifier. They see the cutout immediately on the bed. Slice → print.

**What we change**:
- `lib/3mf.js` (already exists for our current 3MF export): emit a second
  `<object>` element per negative, mark it as `<modifier-mesh type="negative"/>`
  via the 3MF Slic3r metadata extension.
- Add a project-level toggle "Export negatives as modifier meshes (recommended
  for non-watertight imports)" — default ON for any project containing an
  imported mesh.
- Surface in STL Preview's amber warning: "→ Use 3MF export instead, your
  slicer will handle the cut."

**Effort**: 4–6 hours including unit-test against OrcaSlicer load.
**Upfront $**: $0.
**Per-use $**: $0.
**Per-use time**: 0 — instant.
**Risk**: Low. 3MF spec is well-documented; OrcaSlicer's parser is forgiving.
**Caveat**: Pure STL export still can't carry a modifier, so we keep the
amber warning for users who insist on STL.

---

## Option B — "Repair Outside" handoff polish

**What it is.** We already ship the amber dropped-cut warning that names the
external repair tools. Make that flow actually fast:

- "Export host as STL for repair" button → downloads just the host mesh.
- Side-by-side copy-pasteable command line for Blender's headless 3D Print
  Toolbox: `blender --background --python repair.py -- input.stl output.stl`.
- "Re-import repaired STL" picker that REPLACES the existing host (preserves
  position, scale, transforms, and the cube negative still attached) instead
  of adding it as a second object.

**Effort**: 1–2 hours.
**Upfront $**: $0.
**Per-use $**: $0 (user time: ~5 min per repair).
**Risk**: None — we're just polishing existing escape hatches.

---

## Option C — Self-host MeshLab repair worker

**What it is.** Add a backend Python worker that wraps MeshLab's
`meshing_repair_non_manifold_edges` and `meshing_close_holes` filters.
ForgeSlicer POSTs the STL, worker returns the repaired version, frontend
swaps the geometry.

MeshLab handles non-manifold STL repair very well; it's the same engine
under Microsoft 3D Builder's Repair button.

**What we change**:
- `backend/services/mesh_repair_service.py` — wraps PyMeshLab Python bindings.
- `POST /api/mesh/repair` — accepts STL bytes, returns repaired STL bytes.
- Frontend "Repair via Cloud" button on the Inspector → swap geometry in place.
- Backend Dockerfile additions: `pip install pymeshlab` (~250 MB image bloat).

**Effort**: 2–3 days including: PyMeshLab integration, request/response
streaming for big meshes (chunked upload), per-user rate limit, Dockerfile
size optimisation (or move to a separate small repair-only container so
the main backend stays lean).

**Upfront $**: $0 (self-hosted, no third-party API).
**Per-use $**: $0 (compute borne by our infra; ~5–30 s per repair on a small
worker — Kubernetes pod CPU is ~$0.01–0.05/hr so the per-repair cost rounds
to fractions of a cent).
**Per-use time**: 10–30 s round trip.
**Risk**: Medium. MeshLab can hang or OOM on pathological inputs — need
timeout + memory limits. Container image gets bigger.

---

## Option D — Compile libigl Winding-Number to WASM

**What it is.** libigl's `signed_distance_pseudonormal` + `winding_number`
robustly handles non-manifold meshes — research-grade, used in Meshmixer,
Onshape, and Autodesk. Compile to WASM via Emscripten and integrate into
our existing repair worker (replacing the failed parity + closest-point
attempts).

This is THE algorithm that "actually works" for non-manifold mesh repair
in-browser. It's also why we keep saying "use Meshmixer" — that's what
Meshmixer is doing internally.

**Effort**: 3–7 days because:
- Emscripten toolchain setup (~half a day).
- libigl + Eigen dependency build, including pruning what we don't need
  (~half a day).
- WASM build, threading model, memory layout (~1 day).
- Integration with our existing `repair.worker.js` pattern (~half a day).
- Tuning on hobbyist STL inputs (~1 day).
- Bundle size optimisation — naïve build is ~3–5 MB extra payload (~half a day).

**Upfront $**: $0 (libigl is MIT).
**Per-use $**: $0 (all client-side).
**Per-use time**: ~5–15 s per repair, in a Web Worker, no main-thread freeze.
**Risk**: High. WASM size adds to initial load even for users who never
hit a non-manifold mesh. Maintenance burden — libigl updates may require
rebuilds. Honest assessment: feasible but expensive vs. just shipping
Option A.

---

## Option E — Voxel-remesh v3 (adaptive)

**What it is.** Try the in-app voxel remesh AGAIN with: adaptive voxel
resolution (finer near surface), better SDF (closest-point + winding-number
hybrid), and bigger compute budget per voxel.

**Honest assessment**: parity (v1) and closest-point (v2) both failed
because the fundamental issue is that **a thin-shell mesh has no "inside"
to find**. No SDF algorithm can synthesise correct interior topology from
a broken shell without making something up. Even libigl handles this by
having a robust winding-number computation that fights the bad input,
not by avoiding it. Without that — and at our budget — we'll get a blob
again.

**Effort**: 1–2 days.
**Upfront $**: $0.
**Per-use $**: $0.
**Risk**: Very High. **Recommend skipping.** I told you this twice and was
wrong twice; the third try has the same fundamental ceiling.

---

## My recommendation, in 3 sentences

1. **Ship Option A** (3MF modifier-mesh export) tomorrow — this single
   half-day of work makes hydrant exports actually work, end-to-end, in
   your slicer, with zero per-use cost.
2. **Then ship Option B** (Repair Outside polish) the same day so the
   amber warning stops being a dead-end for users who must export STL.
3. **Defer everything else** until users actually ask for it.

If you say yes, I'll lay out a 5-step implementation plan for Option A
before I touch any code tomorrow, so we both agree on what "done" looks
like before I start.

import { create } from "zustand";
import * as THREE from "three";
import { PRINTERS, FILAMENTS, getPrinter, getFilament } from "./presets";
import { computeRotatedBBox } from "./geometry";
import {
  buildSlot,
  buildFastenerPair,
  buildCountersink,
  buildHexPocket,
  buildGusset,
} from "./composites";
import { duplicateSelectedDelta, mirrorSelectedInPlaceDelta } from "./selectionActions";
import { buildCutDelta } from "./cutActions";
import { subdivideObject } from "./subdivide";
import {
  applyTranslate,
  applyScaleMul,
  applyRigidRotate,
  isZeroDelta,
  isIdentityFactor,
} from "./transforms";
import {
  cloneObjects,
  pushHistoryState,
  undoState,
  redoState,
} from "./historyStack";
import {
  serializeProject,
  loadProjectState,
  emptyProjectState,
} from "./projectIO";
// Primitive defaults + factory (iter-74 extraction — was ~130 lines
// of pure data/functions inlined in this file).
import { PRIMITIVE_DEFAULTS, newId, buildPrimitive } from "./primitiveDefaults";
// Anchored-ruler action slice + reference-validity helper (iter-74
// extraction). The slice exports a factory returning the action
// methods to spread into the main store below.
import { rulerRefStillValid, createRulerActions } from "./rulerActions";
// Composite-primitive action slice (iter-87 extraction — was ~50
// lines of repeated pushHistory+build+set boilerplate inlined here).
import { createCompositeActions } from "./compositeActions";
// Profile / preferences action slice (iter-90 extraction — printer
// + filament + my-printer + auto-drop toggles + community list).
import { createProfileActions } from "./profileActions";

const defaultPrinterId = "custom";
const defaultFilamentId = "pla";

export const useScene = create((set, get) => ({
  objects: [],
  selectedId: null,       // primary selection (most recently clicked) — used by Inspector / popovers
  selectedIds: [],        // full selection set for multi-select actions (duplicate, mirror, delete)
  transformMode: "translate",
  snapEnabled: true,
  snapTranslate: 1,
  // iter-112 — Display unit system. Storage is always mm; this only
  // controls how dimensions / measurements / readouts are SHOWN to
  // the user and how their typed inputs are interpreted. Hydrated
  // from localStorage so the choice persists across reloads.
  unitSystem: (() => {
    try { return localStorage.getItem("forgeslicer.unitSystem") === "in" ? "in" : "mm"; }
    catch { return "mm"; }
  })(),
  snapRotate: 15,
  snapScale: 0.1,
  gridVisible: true,
  // Iter-103 — "Faux" design plate. A user-configurable secondary build
  // volume drawn UNDER the printer plate when enabled. Lets users
  // sketch parts larger than any single printer — the design plate
  // shows the full envelope (e.g. a 1.5 m thing) while the printer
  // plate stays anchored at origin so they can see what one batch of
  // slicing covers. Bounds-checking still uses the printer plate; the
  // design plate is purely a visual modelling aid. Slicing big parts
  // into printer-sized chunks is delegated to the existing Subdivide
  // dialog (or to a desktop slicer's "split" feature) for now.
  designPlate: {
    enabled: false,
    x: 1000,           // mm
    y: 1000,           // mm
    z: 1000,           // mm — modelling-envelope height (visual only)
    name: "Design plate",
  },
  buildVolume: { ...getPrinter(defaultPrinterId).buildVolume, kinematics: getPrinter(defaultPrinterId).kinematics || null },
  projectName: "Untitled Project",
  remixOf: null,  // gallery item id this project is remixing

  // The id of the hierarchical project (from `/api/projects`) the
  // current scene was loaded from, plus its name as a cheap label for
  // the breadcrumb. Null when the scene is detached (e.g., fresh
  // session or imported file). Set by ProjectExplorerDialog on Open
  // and Save-here; cleared by `newProject()` / `loadProject` when the
  // incoming payload has no project linkage.
  currentProjectId: null,
  currentProjectName: null,

  // Iter-94 — Pristine 3MF bytes preserved verbatim from the original
  // import. When LithoForge (or any sister-app handoff) sends a multi-
  // material / per-object-coloured 3MF, the in-memory mesh that
  // ForgeSlicer derives from it strips every bit of color/material/
  // filament-slot metadata (the importer flattens to triangles). To
  // round-trip those colors through OrcaSlicer's desktop app, we keep
  // the ORIGINAL bytes here and let `OrcaDialog` hand them off
  // unchanged when the user hasn't materially edited the scene.
  //
  // Cleared on `newProject()` and on any `loadProject()` that doesn't
  // explicitly re-set it. Set by the Workspace import-side-effect
  // when a 3MF lands via the handoff route or workspace drop-zone.
  pristine3MFBytes: null,    // Uint8Array | null
  pristine3MFFilename: null, // string | null
  setPristineImport: (bytes, filename) => set({
    pristine3MFBytes: bytes && bytes.byteLength ? bytes : null,
    pristine3MFFilename: filename || null,
  }),
  clearPristineImport: () => set({ pristine3MFBytes: null, pristine3MFFilename: null }),

  // ---- profiles ----
  printerId: defaultPrinterId,
  filamentId: defaultFilamentId,
  // The user's preferred / "default" printer id. Persisted to localStorage
  // so a returning user always lands on their hardware without having to
  // re-pick it from the dropdown. Set automatically on first "Save mine"
  // (publish to community) and editable via the "Set as default" toggle
  // in RightPanel. `null` = no preference saved (uses the system default).
  myPrinterId: typeof window !== "undefined" && window.localStorage
    ? (window.localStorage.getItem("forge.printer.mine") || null)
    : null,
  communityPrinters: [],         // [{ id, brand, name, build_x/y/z, max_*, default_*, submitter, uses }]
  autoDropOnRotate: typeof window !== "undefined" && window.localStorage
    ? window.localStorage.getItem("forge.autoDropOnRotate") === "true"
    : false,
  // Drop every new primitive / imported mesh so its bottom sits on Y=0
  // (the build plate) right after it's added. Persisted to localStorage so
  // the preference survives a reload — defaults to TRUE because that's the
  // intuitive "lay it on the table" behaviour first-time users expect.
  autoDropNew: typeof window !== "undefined" && window.localStorage
    ? window.localStorage.getItem("forge.autoDropNew") !== "false"
    : true,

  // ---- TinkerCAD-style workplane ruler (iter-113) ----
  // A draggable L-shaped reference widget the user drops onto the
  // workplane at Z=0. When active, the viewport shows signed ΔX/ΔY/ΔZ
  // chips from the ruler's origin to the bounding-box centre of the
  // selected object — exactly like the blue ruler in TinkerCAD. Lives
  // outside the per-object measurement system so it persists across
  // selections and never gets cascade-cleared on object removal.
  workplaneRuler: {
    active: false,
    // Iter-114.2 — `placing` is true while the user has clicked RULER
    // but not yet committed a click in the viewport. While in this
    // mode the next click anywhere on the workplane or on any visible
    // face / vertex / edge-midpoint sets the ruler's origin and flips
    // the ruler `active`. Lets users place the ruler exactly where
    // they want (TinkerCAD parity) instead of always landing at world
    // origin.
    placing: false,
    origin: [0, 0, 0],
  },
  setWorkplaneRuler: (patch) => set((s) => ({
    workplaneRuler: { ...s.workplaneRuler, ...patch },
  })),
  enterWorkplaneRulerPlacing: () => set(() => ({
    workplaneRuler: { active: false, placing: true, origin: [0, 0, 0] },
  })),
  placeWorkplaneRuler: (origin) => set((s) => ({
    workplaneRuler: {
      ...s.workplaneRuler,
      active: true,
      placing: false,
      origin: Array.isArray(origin) && origin.length === 3 ? origin : [0, 0, 0],
    },
  })),
  removeWorkplaneRuler: () => set((s) => ({
    workplaneRuler: { ...s.workplaneRuler, active: false, placing: false },
    // Wipe pick measurements together with the ruler so the canvas
    // is clean the next time the user reopens the tool (iter-114.5).
    rulerPicks: [],
  })),

  // ---- Workplane-ruler picked points (iter-114.5 / TinkerCAD parity) ----
  // Persistent list of points the user has clicked on a selected
  // object while the workplane ruler is active. Each pick renders a
  // dashed leader line from the ruler origin + four chips (ΔX, ΔY,
  // ΔZ, diagonal distance). Lets users measure plate thickness,
  // hole-to-hole spacing, vertex offsets, etc. without leaving the
  // ruler workflow.
  rulerPicks: [],
  addRulerPick: (point, meta = {}) => {
    if (!Array.isArray(point) || point.length !== 3) return;
    const id = `pick_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ rulerPicks: [...s.rulerPicks, { id, point, ...meta }] }));
  },
  removeRulerPick: (id) => set((s) => ({
    rulerPicks: s.rulerPicks.filter((p) => p.id !== id),
  })),
  clearRulerPicks: () => set({ rulerPicks: [] }),

  // ---- Snap-to-face placement (iter-113) ----
  // When ON, the next pointer-click on any face of any visible object
  // teleports the CURRENT primary selection so its base sits flat on
  // that face — auto-rotating so the selection's local +Z aligns with
  // the face's world normal. Single-shot: turns itself off after one
  // successful placement. Used for TinkerCAD-style "drop this on top
  // of that" assembly building.
  placeOnFaceMode: false,
  setPlaceOnFaceMode: (on) => set({ placeOnFaceMode: !!on }),

  // ---- Inline W/D/H dimension labels (iter-114.1) ----
  // OFF by default. User reported the always-on labels covered small
  // selections (e.g. a 30×26×5 mm triangle) and clashed with the
  // workplane ruler's delta chips. Now a toolbar toggle (DIMS pill)
  // controls visibility — clean canvas by default, opt-in inline
  // editing for users who want TinkerCAD-style numeric tags.
  // Persisted to localStorage so power users who like them on keep
  // them on across sessions.
  dimLabelsEnabled: (() => {
    try {
      const v = typeof localStorage !== "undefined"
        ? localStorage.getItem("forge.dimLabelsEnabled")
        : null;
      return v === "1";
    } catch { return false; }
  })(),
  setDimLabelsEnabled: (on) => {
    try { localStorage.setItem("forge.dimLabelsEnabled", on ? "1" : "0"); } catch { /* noop */ }
    set({ dimLabelsEnabled: !!on });
  },

  // ---- measurement ----
  measureMode: false,
  measurements: [], // [{id, a:[x,y,z], b:[x,y,z], objIdA, objIdB}]
  pendingMeasurePoint: null,

  // Bake a non-uniform mesh scale back into the primitive's dimensions
  // so any further geometry generation (fillet/chamfer, CSG booleans)
  // works in WORLD-SPACE millimetres rather than base-space. This is
  // the CAD-correct behavior — TinkerCAD / Fusion 360 both treat
  // dimensional edits as destructive and never carry a non-unit scale
  // forward into fillet ops.
  //
  // Coordinate mapping (matches `geometry.js`):
  //   • THREE local X = world X → cube dims.x, cylinder/cone radial
  //   • THREE local Y = world Y (UP / height) → cube dims.z, cyl/cone dims.h
  //   • THREE local Z = world Z (depth) → cube dims.y, cyl/cone radial
  //
  // For cylinder/cone the radial axis is shared by THREE's X and Z, so
  // if the user applied a non-uniform X/Z scale we collapse them via
  // geometric mean — preserving the apparent radius while admitting the
  // primitive can't represent an ellipse natively.
  //
  // No-ops if scale is already [1,1,1] (within float tolerance).
  bakeScaleIntoDims: (objId) => {
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.id !== objId) return o;
        const sc = o.scale || [1, 1, 1];
        const isUnit = Math.abs(sc[0] - 1) < 1e-4 && Math.abs(sc[1] - 1) < 1e-4 && Math.abs(sc[2] - 1) < 1e-4;
        if (isUnit) return o;
        const d = { ...(o.dims || {}) };
        if (o.type === "cube") {
          // iter-104.1 Z-up: dims map 1:1 to world X/Y/Z.
          d.x = (d.x || 20) * sc[0];
          d.y = (d.y || 20) * sc[1];
          d.z = (d.z || 20) * sc[2];
        } else if (o.type === "cylinder" || o.type === "cone") {
          // Cylinder axis is +Z (height). Radial extent is on X/Y.
          const radialFactor = Math.sqrt(Math.max(0, sc[0]) * Math.max(0, sc[1])) || 1;
          d.r = (d.r || 10) * radialFactor;
          d.h = (d.h || 20) * sc[2];
          if (d.r1 != null) d.r1 *= radialFactor;
          if (d.r2 != null) d.r2 *= radialFactor;
        } else if (o.type === "sphere") {
          // Sphere is uniformly scalable — collapse all 3 into radius via cube root.
          const f = Math.cbrt(Math.max(0, sc[0] * sc[1] * sc[2])) || 1;
          d.r = (d.r || 10) * f;
        } else {
          // Unknown primitive — leave dims untouched and only reset the
          // scale field. This is the conservative choice (no data loss).
          return { ...o, scale: [1, 1, 1] };
        }
        return { ...o, dims: d, scale: [1, 1, 1] };
      }),
    }));
  },

  // ---- sub-element selection (face / edge / vertex for fillet work) ----
  //
  // `subSelectMode` controls the picker overlay:
  //   "object" — default; nothing drawn. Inspector "Edge fillet" panel
  //              edits the legacy whole-item uniform radius.
  //   "face"   — hover/click on cube faces, cylinder caps/side, cone base/side.
  //   "edge"   — hover/click on individual edges (12 per cube, 2 per cyl, 1 per cone).
  //   "vertex" — hover/click on corners; selecting one applies the radius
  //              to ALL edges of the item (equivalent to whole-item mode
  //              but reachable from the 3D picker).
  //
  // `subSelection` stores the currently-highlighted sub-element. It is
  // transient — cleared on object change or mode change.
  subSelectMode: "object",
  subSelection: null, // { kind: "face"|"edge"|"vertex", id: string } | null
  setSubSelectMode: (m) => set((s) => ({
    subSelectMode: m,
    // Switching out of "object" clears any prior pick so we don't keep
    // a stale highlight; switching back to "object" also clears it.
    subSelection: m === s.subSelectMode ? s.subSelection : null,
  })),
  setSubSelection: (sub) => set({ subSelection: sub }),
  clearSubSelection: () => set({ subSelection: null }),

  // Apply a fillet/chamfer to the resolved set of edges for the current
  // primary selection. `edgeIds` is a list of canonical edge IDs (from
  // edgeFaceMeta.js); `radius` and `style` are the new values. Passing
  // `radius=0` deletes those edges from the per-edge map, returning
  // them to "sharp" (or to the legacy uniform radius if one is set).
  setEdgeFillets: (objId, edgeIds, radius, style) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.id !== objId) return o;
        const next = { ...(o.edgeFillets || {}) };
        for (const eid of edgeIds) {
          if (!radius || radius <= 0.05) {
            delete next[eid];
          } else {
            next[eid] = { style: style === "chamfer" ? "chamfer" : "fillet", radius };
          }
        }
        const out = { ...o, edgeFillets: next };
        // If the per-edge map became empty, drop the field so the legacy
        // uniform path can take over cleanly.
        if (Object.keys(next).length === 0) delete out.edgeFillets;
        return out;
      }),
    }));
  },

  // Convenience: take the legacy uniform edgeStyle/edgeRadius and
  // materialise it across every edge of the primitive's per-edge map.
  // Used when the user switches from "Item" mode into "Edge" mode and
  // we want their existing uniform radius to be the starting point.
  materializeUniformFilletsAsPerEdge: (objId) => {
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.id !== objId) return o;
        if (o.edgeFillets && Object.keys(o.edgeFillets).length) return o; // already per-edge
        const r = o.dims?.edgeRadius || 0;
        if (r <= 0.05) return o;
        const style = o.dims?.edgeStyle === "chamfer" ? "chamfer" : "fillet";
        // Use the edge IDs appropriate to the primitive type. The list
        // comes from edgeFaceMeta — import here would create a cycle so
        // we do a literal list inline. Keep this in sync with CUBE_EDGES
        // / CYLINDER_EDGES / CONE_EDGES.
        let ids = [];
        if (o.type === "cube") {
          ids = [
            "e_X_minY_minZ","e_X_minY_maxZ","e_X_maxY_minZ","e_X_maxY_maxZ",
            "e_Y_minX_minZ","e_Y_minX_maxZ","e_Y_maxX_minZ","e_Y_maxX_maxZ",
            "e_Z_minX_minY","e_Z_minX_maxY","e_Z_maxX_minY","e_Z_maxX_maxY",
          ];
        } else if (o.type === "cylinder") {
          ids = ["e_top", "e_bottom"];
        } else if (o.type === "cone") {
          ids = ["e_base"];
        }
        const next = {};
        for (const eid of ids) next[eid] = { style, radius: r };
        // Clear the legacy fields so they don't double-apply.
        const dims = { ...o.dims };
        delete dims.edgeRadius;
        delete dims.edgeStyle;
        return { ...o, dims, edgeFillets: next };
      }),
    }));
  },

  // ---- component-pair dimensions (Blender-style) ----
  // Persistent annotations tying two scene objects together — the world
  // points are recomputed live from the objects' bboxes, so the chip
  // value tracks any move/rotate/scale automatically. Cleared on project
  // open (not currently persisted in .forge.json — annotations are a
  // workspace concept, not a model concept).
  componentDimensions: [],   // [{id, objIdA, objIdB}]
  pendingDimensionFromId: null,

  // ---- anchored ruler (TinkerCAD-style) ----
  // Two-step workflow: click 1 sets the anchor snap-point, click 2 sets
  // the target snap-point. The same object can be both anchor & target
  // (different snap points) so the user can measure intra-object
  // diagonals — e.g., anchor at corner A of a cube, then snap to corner
  // B of the same cube to read its body diagonal.
  //
  // Snap points are enumerated per object: 8 corners + 12 edge midpoints
  // + 6 face centres + 1 centre = 27 candidates. `rulerSnapKinds` filters
  // which families are eligible. Defaults to all four; user can restrict
  // via the HUD pills (Corner / Edge / Face / Centre).
  rulerMode: false,
  rulerAnchor: null,            // {worldPoint:[x,y,z], objId, objName, snapKey, snapKind} | null
  rulerTarget: null,            // {worldPoint:[x,y,z], objId, objName, snapKey, snapKind} | null
  rulerAxesMode: "xyz",         // 'xyz' | 'x' | 'y' | 'z'
  rulerSnapKinds: ["corner", "edge", "face", "center"],
  // Persistent pinned measurements — each entry stores a frozen
  // {anchor, target} snap-pair. Render layer recomputes their world
  // positions every frame from the live object positions so they track
  // moves. New entries are appended on the user clicking the pin button
  // in RulerScreenHud (only enabled while both anchor & target exist).
  pinnedRulerDims: [],          // [{id, anchor:snapRec, target:snapRec}]

  // ---- cut tool ----
  // When cutMode is true, the viewport renders an adjustable cut plane that
  // can be translated/rotated. The plane lives in world space; geometry is
  // sliced when the user clicks Apply in the cut overlay.
  cutMode: false,
  cutPlane: {
    position: [0, 25, 0],  // center of plane in world space
    rotation: [0, 0, 0],   // Euler rotation (plane normal is local +Y after rotation)
    size: 200,             // visual size of the plane gizmo
  },
  pendingMeasureObjId: null,

  // ---- history ----
  history: [],
  redoStack: [],

  // ---- internals ----
  pushHistory: () => {
    const s = get();
    set(pushHistoryState(s.history, s.objects));
  },

  undo: () => {
    const s = get();
    const next = undoState(s.history, s.redoStack, s.objects);
    if (!next) return;
    set({ ...next, selectedId: null, selectedIds: [] });
  },

  redo: () => {
    const s = get();
    const next = redoState(s.history, s.redoStack, s.objects);
    if (!next) return;
    set({ ...next, selectedId: null, selectedIds: [] });
  },

  // ---- profile actions ----
  // setPrinter / setFilament / setMyPrinter / setAutoDropOnRotate /
  // setAutoDropNew / setCommunityPrinters / addCommunityPrinter /
  // removeCommunityPrinter all live in `./profileActions.js` (iter-90
  // extraction). They handle the printer/filament selection + the
  // workspace preference toggles, including localStorage persistence.

  // ---- scene mutations ----
  setProjectName: (name) => set({ projectName: name }),
  setRemixOf: (id) => set({ remixOf: id }),

  // Mark the scene as belonging to a hierarchical project — read by
  // the topbar breadcrumb. Pass `null, null` to detach.
  setCurrentProject: (id, name) => set({
    currentProjectId: id || null,
    currentProjectName: name || null,
  }),

  addPrimitive: (type, modifier = "positive") => {
    get().pushHistory();
    let obj = buildPrimitive(type, modifier);
    // Honour the "auto-drop new parts to bed" preference (default ON).
    // Z-up: bed is the XY plane at Z=0, drop offsets position[2].
    if (get().autoDropNew) {
      try {
        const bb = computeRotatedBBox(obj);
        if (isFinite(bb.min.z)) {
          obj = { ...obj, position: [obj.position[0], obj.position[1], -bb.min.z] };
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("addPrimitive auto-drop bbox failed for", obj.type, err);
      }
    }
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id, selectedIds: [obj.id] }));
    return obj.id;
  },

  // Fastener Pair macro — drops a coordinated Bolt + Nut + 2 negative
  // bore cylinders pre-grouped as one drop-in assembly. The four parts
  // share a `groupId` so they move/rotate/scale as a unit; the user
  // can ungroup to fine-tune individual members.
  //
  // Geometry layout (all parts share matching pitch + major radius so
  // the bolt threads visually mate with the nut threads):
  //   - Bolt: head at Y=0, shaft running upward through the work
  //   - Bore #1 (negative): coplanar with the bolt shaft, extending
  //                         through the host part — carves the through-hole
  //   - Bore #2 (negative): the COUNTERBORE for the bolt head (recess
  //                         the head into the host part for a flush fit)
  //   - Nut: positioned at the FAR side of where a typical 10mm-thick
  //         host part would be, so threads engage past the work face
  //
  // Fastener Pair / Countersink / Hex Pocket / Gusset / Slot — these
  // composite-drop actions are spread in from `compositeActions.js`
  // (iter-87 extraction). See that file for the per-composite docs.
  // Pre-iter-87 these lived as five repeated pushHistory+build+set
  // blocks inlined here — moving them out reduced ~50 lines and
  // gave us one clean place for any future composite to land.

  // Add a user-drawn sketch as an extruded scene object. `points` is an
  // array of `[x, z]` world-plane coordinates (same units as `position`).
  // The sketch's centroid becomes its origin; we then offset the object's
  // world position so the polygon renders exactly where the user drew it
  // (this is what "place on the build plate where I drew" should feel
  // like — drawing in workspace XZ → object appears at that XZ).
  addSketch: (points, modifier = "positive", height = 5, opts = {}) => {
    if (!Array.isArray(points) || points.length < 3) return null;
    get().pushHistory();
    let cx = 0, cy = 0;
    for (const [x, y] of points) { cx += x; cy += y; }
    cx /= points.length; cy /= points.length;
    const obj = {
      id: newId("sketch"),
      name: opts.name || `Sketch ${(get().objects || []).filter((o) => o.type === "sketch").length + 1}`,
      type: "sketch",
      modifier,
      visible: true,
      locked: false,
      position: [cx, cy, height / 2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dims: { points: points.map(([x, y]) => [x, y]), h: height },
      colorIndex: modifier === "negative" ? 0 : 7,
      // Optional shared group — used by SVG import to bundle every glyph
      // of a multi-path logo into a single assembly so the user can move
      // the whole thing as one. Falls through when caller omits it.
      ...(opts.groupId ? { groupId: opts.groupId, groupName: opts.groupName || opts.name || "Sketch group" } : {}),
    };
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id, selectedIds: [obj.id] }));
    return obj.id;
  },

  // Sketch-mode UI state — when truthy, the SketchOverlay component takes
  // over the workspace canvas with a 2D drawing surface. Cleared by the
  // overlay itself on commit / cancel.
  sketchMode: false,
  setSketchMode: (on) => set({ sketchMode: !!on }),

  // ---------- Sketch → Sweep ----------
  // Promote an existing 2D `sketch` object into one of the two compound
  // descriptors of a NEW sweep object:
  //
  //   role = "profile" — use the sketch's points as a closed 2D profile
  //                      swept along a default helix path. The user can
  //                      switch the path to arc / bezier / sketch3d / ref
  //                      in the Inspector afterwards.
  //   role = "path"    — promote the sketch's [x, z] points to a 3D
  //                      polyline [x, y, z] (y=0 by default, or distributed
  //                      linearly from 0 → opts.rise across the points
  //                      when a rise is requested) and sweep a default
  //                      circular profile along it.
  //
  // The original sketch is preserved — users may want to keep iterating
  // on the 2D shape while also referencing it from a sweep. The new
  // sweep is placed at the source sketch's position so it visually
  // overlays where the user expects.
  addSweepFromSketch: (sketchId, role = "profile", opts = {}) => {
    const s = get();
    const src = s.objects.find((o) => o.id === sketchId);
    if (!src || src.type !== "sketch") return null;
    const points2D = Array.isArray(src.dims?.points) ? src.dims.points : [];
    if (points2D.length < 3) return null;

    get().pushHistory();
    const baseId = newId("sweep");
    const baseName = role === "profile"
      ? `${src.name} → Sweep profile`
      : `${src.name} → Sweep path`;

    let dims;
    if (role === "profile") {
      dims = {
        samples: 96,
        twistDeg: 0,
        profile: { kind: "sketch", points: points2D.map(([x, y]) => [x, y]) },
        path: { kind: "helix", r: 12, pitch: 6, turns: 3 },
      };
    } else {
      // path role — promote [x, z] → [x, y, z] with optional linear rise.
      const rise = Number.isFinite(opts.rise) ? opts.rise : 0;
      const n = points2D.length;
      const points3D = points2D.map(([x, z], i) => [
        x,
        n > 1 ? (i / (n - 1)) * rise : 0,
        z,
      ]);
      dims = {
        samples: 128,
        twistDeg: 0,
        profile: { kind: "circle", r: 2, segments: 16 },
        path: { kind: "sketch3d", points: points3D, rise },
      };
    }

    const obj = {
      id: baseId,
      name: baseName,
      type: "sweep",
      modifier: src.modifier || "positive",
      visible: true,
      locked: false,
      // Position the sweep at the build-plate origin — the swept geometry
      // is centered on the path's own centroid by buildSweepGeometry, so
      // placing the object at the origin keeps everything where the user
      // drew it.
      position: [0, 0, role === "path" ? 0 : 10],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dims,
      colorIndex: (src.modifier === "negative") ? 0 : 7,
    };

    // Auto-drop so the new sweep sits on the bed (Z=0 plane).
    let placed = obj;
    if (get().autoDropNew) {
      try {
        const bb = computeRotatedBBox(placed);
        if (isFinite(bb.min.z)) {
          placed = { ...placed, position: [placed.position[0], placed.position[1], -bb.min.z] };
        }
      } catch (_) { /* non-fatal */ }
    }

    set((st) => ({
      objects: [...st.objects, placed],
      selectedId: placed.id,
      selectedIds: [placed.id],
    }));
    return placed.id;
  },
  // Texture Library dialog state — kept on the store (rather than on a
  // single component) so the right-click context menu can request the
  // dialog to open with a target object pre-selected, even though the
  // menu unmounts the moment it's clicked. Workspace renders the
  // dialog once at the top level and reads these two fields to drive
  // its `open` / `targetObjectId` props.
  textureLibraryOpen: false,
  textureLibraryTargetId: null,
  openTextureLibrary: (targetObjectId = null) =>
    set({ textureLibraryOpen: true, textureLibraryTargetId: targetObjectId }),
  closeTextureLibrary: () =>
    set({ textureLibraryOpen: false, textureLibraryTargetId: null }),

  addImportedMesh: (name, vertices, indices = null, originalBbox = null, opts = {}) => {
    get().pushHistory();
    // Iter-94 Phase 2 — `opts.customColor` is an optional "#rrggbb"
    // string sourced from a 3MF's <basematerials> displaycolor. When
    // present the viewport renders this exact color instead of using
    // the MULTICOLOR_PALETTE swatch; the user can still override it
    // via the Inspector's color picker.
    // `opts.modifier` lets multi-object handoffs flag negative parts
    // (rare for lithophanes; defaults to "positive").
    const modifier = opts.modifier === "negative" ? "negative" : "positive";
    let obj = {
      id: newId("mesh"),
      name: name || "Imported Mesh",
      type: "imported",
      modifier,
      visible: true,
      locked: false,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dims: {},
      colorIndex: 0,
      customColor: typeof opts.customColor === "string" ? opts.customColor : null,
      materialName: opts.materialName || null,
      originalBbox: originalBbox || undefined, // {x,y,z} in mm at scale 1
      geometry: { vertices, indices },
    };
    if (get().autoDropNew) {
      try {
        const bb = computeRotatedBBox(obj);
        if (isFinite(bb.min.z)) {
          obj = { ...obj, position: [obj.position[0], obj.position[1], -bb.min.z] };
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("addImportedMesh auto-drop bbox failed:", err);
      }
    }
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id, selectedIds: [obj.id] }));
    return obj.id;
  },

  // Iter-114 — Replace the geometry of an imported mesh in place
  // (used by the Fillet/Chamfer dialog). Recomputes `originalBbox`
  // from the new vertices so dim-label edits keep working. Pushes a
  // history snapshot so the user can undo a botched fillet pass.
  replaceImportedGeometry: (id, vertices, indices) => {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj || obj.type !== "imported") return;
    get().pushHistory();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const bb = {
      x: Number.isFinite(maxX - minX) ? maxX - minX : (obj.originalBbox?.x ?? 0),
      y: Number.isFinite(maxY - minY) ? maxY - minY : (obj.originalBbox?.y ?? 0),
      z: Number.isFinite(maxZ - minZ) ? maxZ - minZ : (obj.originalBbox?.z ?? 0),
    };
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id
          ? { ...o, geometry: { vertices, indices }, originalBbox: bb, csgVersion: (o.csgVersion || 0) + 1 }
          : o,
      ),
    }));
  },

  addRawObject: (obj) => {
    get().pushHistory();
    let withId = { ...obj, id: obj.id || newId(obj.type || "mesh") };
    if (get().autoDropNew && !obj.__skipAutoDrop) {
      try {
        const bb = computeRotatedBBox(withId);
        if (isFinite(bb.min.z)) {
          const wz = (withId.position?.[2] ?? 0) + bb.min.z;
          if (Math.abs(wz) > 1e-3) {
            withId = { ...withId, position: [withId.position[0], withId.position[1], withId.position[2] - wz] };
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("addRawObject auto-drop bbox failed:", err);
      }
    }
    set((s) => ({ objects: [...s.objects, withId], selectedId: withId.id, selectedIds: [withId.id] }));
    return withId.id;
  },

  // ---------- Composite primitives ----------
  // `addSlot`, `addFastenerPair`, `addCountersink`, `addHexPocket`,
  // `addGusset` are spread in from `./compositeActions.js` (iter-87
  // extraction). They each drop a pre-grouped assembly as a single
  // undo step and return the assembly's groupId.

  // Atomic "boolean replace" — remove a set of objects AND insert one or more
  // new objects in a single store mutation that pushes history exactly once.
  // The old multi-step `removeObject; removeObject; addRawObject` flow each
  // pushed its own history snapshot, so Ctrl-Z would restore the state
  // *after* removals but *before* the insert → empty scene. This action
  // exists so callers (boolean union/subtract/intersect, flatten, etc.) get
  // a single, reversible step.
  setObjectName: (id, name) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, name: (name || "").slice(0, 80) || o.name } : o)),
    }));
  },

  replaceObjects: (idsToRemove, newObjects = []) => {
    const removeSet = new Set(idsToRemove || []);
    const incoming = (Array.isArray(newObjects) ? newObjects : [newObjects])
      .filter(Boolean)
      .map((o) => ({ ...o, id: o.id || newId(o.type || "mesh") }));
    get().pushHistory();
    set((s) => {
      const remaining = s.objects.filter((o) => !removeSet.has(o.id));
      const next = [...remaining, ...incoming];
      const newIds = incoming.map((o) => o.id);
      return {
        objects: next,
        // Keep the last inserted object as the primary selection so the
        // Inspector lights up the merged result, not nothing.
        selectedId: newIds[newIds.length - 1] ?? (removeSet.has(s.selectedId) ? null : s.selectedId),
        selectedIds: newIds.length ? newIds : s.selectedIds.filter((x) => !removeSet.has(x)),
        measurements: s.measurements.filter((m) => !removeSet.has(m.objIdA) && !removeSet.has(m.objIdB)),
        pendingMeasurePoint: removeSet.has(s.pendingMeasureObjId) ? null : s.pendingMeasurePoint,
        pendingMeasureObjId: removeSet.has(s.pendingMeasureObjId) ? null : s.pendingMeasureObjId,
        componentDimensions: s.componentDimensions.filter(
          (d) => !removeSet.has(d.objIdA) && !removeSet.has(d.objIdB)
        ),
        pendingDimensionFromId: removeSet.has(s.pendingDimensionFromId) ? null : s.pendingDimensionFromId,
        rulerAnchor: rulerRefStillValid(s.rulerAnchor, s.objects, removeSet) ? s.rulerAnchor : null,
        rulerTarget: rulerRefStillValid(s.rulerTarget, s.objects, removeSet) ? s.rulerTarget : null,
        pinnedRulerDims: (s.pinnedRulerDims || []).filter((d) =>
          rulerRefStillValid(d.anchor, s.objects, removeSet) &&
          rulerRefStillValid(d.target, s.objects, removeSet)
        ),
      };
    });
    return incoming.map((o) => o.id);
  },

  removeObject: (id) => {
    get().pushHistory();
    set((s) => {
      const removeSet = new Set([id]);
      return {
        objects: s.objects.filter((o) => o.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        selectedIds: s.selectedIds.filter((x) => x !== id),
        measurements: s.measurements.filter((m) => m.objIdA !== id && m.objIdB !== id),
        pendingMeasurePoint:
          s.pendingMeasureObjId === id ? null : s.pendingMeasurePoint,
        pendingMeasureObjId:
          s.pendingMeasureObjId === id ? null : s.pendingMeasureObjId,
        componentDimensions: s.componentDimensions.filter(
          (d) => d.objIdA !== id && d.objIdB !== id
        ),
        pendingDimensionFromId: s.pendingDimensionFromId === id ? null : s.pendingDimensionFromId,
        rulerAnchor: rulerRefStillValid(s.rulerAnchor, s.objects, removeSet) ? s.rulerAnchor : null,
        rulerTarget: rulerRefStillValid(s.rulerTarget, s.objects, removeSet) ? s.rulerTarget : null,
        pinnedRulerDims: (s.pinnedRulerDims || []).filter((d) =>
          rulerRefStillValid(d.anchor, s.objects, removeSet) &&
          rulerRefStillValid(d.target, s.objects, removeSet)
        ),
      };
    });
  },

  // Bulk-delete every currently-selected object. Used by the Delete key
  // shortcut so the user can prune all mirrored copies at once if they
  // don't like the result.
  removeSelected: () => {
    const ids = get().selectedIds.length
      ? get().selectedIds
      : (get().selectedId ? [get().selectedId] : []);
    if (ids.length === 0) return;
    get().pushHistory();
    const removeSet = new Set(ids);
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      selectedId: null,
      selectedIds: [],
      measurements: s.measurements.filter((m) => !ids.includes(m.objIdA) && !ids.includes(m.objIdB)),
      componentDimensions: s.componentDimensions.filter(
        (d) => !ids.includes(d.objIdA) && !ids.includes(d.objIdB)
      ),
      pendingDimensionFromId: ids.includes(s.pendingDimensionFromId) ? null : s.pendingDimensionFromId,
      rulerAnchor: rulerRefStillValid(s.rulerAnchor, s.objects, removeSet) ? s.rulerAnchor : null,
      rulerTarget: rulerRefStillValid(s.rulerTarget, s.objects, removeSet) ? s.rulerTarget : null,
      pinnedRulerDims: (s.pinnedRulerDims || []).filter((d) =>
        rulerRefStillValid(d.anchor, s.objects, removeSet) &&
        rulerRefStillValid(d.target, s.objects, removeSet)
      ),
    }));
  },

  // Align every currently-selected object on a single axis. The FIRST
  // selected object is the **anchor** — it stays in place, and every
  // other selected object moves to match its edge/centre. This matches
  // how Figma / Illustrator / Fusion's "Align to first" and most CAD
  // packages work: you pick the reference, then everything else snaps
  // to it.
  //   - axis: "x" | "y" | "z"
  //   - mode: "min" (left/front/bottom edge), "max" (right/back/top edge),
  //           "center" (axis midpoint)
  // No-op if fewer than 2 objects are selected (alignment needs at least
  // two things to align together). Lands as a single undo step.
  alignSelection: (axis, mode) => {
    const s = get();
    const ids = s.selectedIds.length
      ? s.selectedIds
      : (s.selectedId ? [s.selectedId] : []);
    if (ids.length < 2) return;
    const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const bbxs = [];
    for (const id of ids) {
      const o = s.objects.find((x) => x.id === id);
      if (!o) continue;
      try {
        const bb = computeRotatedBBox(o);
        const p = (o.position && o.position[axisIdx]) || 0;
        bbxs.push({ id: o.id, min: bb.min[axis] + p, max: bb.max[axis] + p });
      } catch {
        // skip — partially-loaded objects can't be aligned
      }
    }
    if (bbxs.length < 2) return;

    // ANCHOR = first selected. The anchor's edge/centre becomes the
    // target value; the anchor itself never moves.
    const anchor = bbxs[0];
    let target;
    if (mode === "min") target = anchor.min;
    else if (mode === "max") target = anchor.max;
    else target = (anchor.min + anchor.max) / 2;

    get().pushHistory();
    set((st) => ({
      objects: st.objects.map((o) => {
        if (o.id === anchor.id) return o;       // anchor stays put
        const bbx = bbxs.find((b) => b.id === o.id);
        if (!bbx) return o;
        const cur = mode === "min" ? bbx.min : mode === "max" ? bbx.max : (bbx.min + bbx.max) / 2;
        const delta = target - cur;
        if (Math.abs(delta) < 1e-6) return o;
        const np = [...o.position];
        np[axisIdx] += delta;
        return { ...o, position: np };
      }),
    }));
  },

  // Distribute selected objects evenly along `axis` ("x"|"y"|"z"). The
  // outermost two objects on that axis define the span; the remaining
  // N-2 are repositioned so their centres are equally spaced inside.
  // Acts on whatever is currently selected (≥ 3 objects required —
  // with 2 there's nothing to distribute). Single undo step.
  distributeSelection: (axis) => {
    const s = get();
    const ids = s.selectedIds.length
      ? s.selectedIds
      : (s.selectedId ? [s.selectedId] : []);
    if (ids.length < 3) return;
    const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const items = [];
    for (const id of ids) {
      const o = s.objects.find((x) => x.id === id);
      if (!o) continue;
      try {
        const bb = computeRotatedBBox(o);
        const p = (o.position && o.position[axisIdx]) || 0;
        const min = bb.min[axis] + p;
        const max = bb.max[axis] + p;
        items.push({ id: o.id, centre: (min + max) / 2 });
      } catch { /* skip */ }
    }
    if (items.length < 3) return;
    // Sort by current centre on the chosen axis so we know which two
    // are the "outermost" (those stay put — same convention as Adobe
    // / Figma "Distribute centres horizontally").
    items.sort((a, b) => a.centre - b.centre);
    const first = items[0].centre;
    const last = items[items.length - 1].centre;
    const span = last - first;
    if (Math.abs(span) < 1e-6) return; // all collapsed onto one point
    const step = span / (items.length - 1);

    get().pushHistory();
    set((st) => ({
      objects: st.objects.map((o) => {
        const idx = items.findIndex((it) => it.id === o.id);
        if (idx <= 0 || idx >= items.length - 1) return o; // endpoints stay
        const target = first + step * idx;
        const delta = target - items[idx].centre;
        if (Math.abs(delta) < 1e-6) return o;
        const np = [...o.position];
        np[axisIdx] += delta;
        return { ...o, position: np };
      }),
    }));
  },

  // Drop the object so its lowest point sits on Z=0 (the build plate).
  dropToBed: (id, withHistory = true) => {
    const s = get();
    const obj = s.objects.find((o) => o.id === id);
    if (!obj) return;
    try {
      const bb = computeRotatedBBox(obj);
      const newZ = -bb.min.z;
      if (Math.abs(newZ - obj.position[2]) < 1e-4) return;
      if (withHistory) s.pushHistory();
      set((st) => ({
        objects: st.objects.map((o) =>
          o.id === id ? { ...o, position: [o.position[0], o.position[1], newZ] } : o
        ),
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("dropToBed: bbox failed", err);
    }
  },

  // iter-103.3 — Center an object's footprint on the build-plate origin
  // AND drop its bottom to Y=0 in a single pass. Use case: after a
  // voice-template boolean (faceplate, bracket, …) the merged object's
  // pivot can drift off-centre because the CSG operands didn't share
  // the same world position. A one-click "Centre on bed" re-anchors
  // the result so future moves use a sensible origin.
  //
  // Computes the WORLD-space bbox (including the object's current
  // rotation via `computeRotatedBBox`) and translates by:
  //   dx = -bb.centre.x       (X centred on origin)
  //   dz = -bb.centre.z       (Z centred on origin)
  //   dy = -bb.min.y          (bottom face on Y=0)
  // …on top of the object's current position so we don't blow away
  // any other transform the user applied.
  centerOnBed: (id, withHistory = true) => {
    const s = get();
    const obj = s.objects.find((o) => o.id === id);
    if (!obj) return;
    try {
      const bb = computeRotatedBBox(obj);
      // computeRotatedBBox returns the bbox of the geometry rotated+scaled
      // around the LOCAL origin (translation excluded). To centre the
      // object on world XY and drop bottom to Z=0, the new world position
      // is exactly the negation of the local bbox's centre/min.
      const centreX = (bb.min.x + bb.max.x) / 2.0;
      const centreY = (bb.min.y + bb.max.y) / 2.0;
      const [px, py, pz] = obj.position;
      const nx = -centreX;
      const ny = -centreY;
      const nz = -bb.min.z;
      if (
        Math.abs(nx - px) < 1e-4 &&
        Math.abs(ny - py) < 1e-4 &&
        Math.abs(nz - pz) < 1e-4
      ) return;
      if (withHistory) s.pushHistory();
      set((st) => ({
        objects: st.objects.map((o) =>
          o.id === id ? { ...o, position: [nx, ny, nz] } : o
        ),
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("centerOnBed: bbox failed", err);
    }
  },

  // Drop the WHOLE selection to the bed as a single rigid unit.
  // Finds the lowest world-Y across every selected object (after its
  // current rotation has been applied to its bbox) and translates all
  // of them by the same dy so the bottom-most point lands on Y=0 —
  // preserving every member's relative offset. Use this instead of
  // looping `dropToBed(id)` per-member, which would snap each piece
  // to the bed independently and destroy a multi-part assembly's
  // vertical alignment (e.g. a standoff's bolt-hole would float in
  // mid-air while the shell sat on the bed).
  dropSelectionToBed: (withHistory = true) => {
    const s = get();
    const ids = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
    if (ids.length === 0) return;
    if (ids.length === 1) { get().dropToBed(ids[0], withHistory); return; }
    let worldMinZ = Infinity;
    for (const id of ids) {
      const o = s.objects.find((x) => x.id === id);
      if (!o) continue;
      try {
        const bb = computeRotatedBBox(o);
        const wz = (o.position?.[2] ?? 0) + bb.min.z;
        if (wz < worldMinZ) worldMinZ = wz;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("dropSelectionToBed: bbox failed for", o?.id, err);
      }
    }
    if (!Number.isFinite(worldMinZ)) return;
    if (Math.abs(worldMinZ) < 1e-3) return;
    if (withHistory) s.pushHistory();
    const dz = -worldMinZ;
    set((st) => ({
      objects: st.objects.map((o) =>
        ids.includes(o.id)
          ? { ...o, position: [o.position[0], o.position[1], o.position[2] + dz] }
          : o
      ),
    }));
  },

  // Lay-flat the current selection: pick the LARGEST face of the
  // combined world-space bounding box and rotate the assembly so that
  // face ends up parallel to the build plate (i.e. the assembly's
  // "thinnest" axis becomes vertical). Then drop-to-bed so the lowest
  // point sits on Y=0.
  //
  // Why this exists (iter-79): in ForgeSlicer's workspace the user can
  // rotate models with the gizmo, but it's tedious to get a thin/tall
  // model (panel, tray, sign) onto the bed face-down. Without this,
  // OrcaSlicer's CLI sees the model in its current orientation and
  // every FDM heuristic (overhangs, supports, bed adhesion, layer
  // count, "empty layer" detection) is worse on the wrong orientation
  // — that's the root cause of all the recent "GCODE has missing
  // geometry" prints. One-click Lay Flat solves it for 95 % of cases.
  //
  // Algorithm:
  //   1. Compute combined world-space AABB of every selected object,
  //      accounting for each member's current rotation/scale.
  //   2. Find the SHORTEST axis (X/Y/Z) — the face perpendicular to
  //      it is the largest face by area.
  //   3. If shortest is already Y, the assembly is already flat —
  //      just drop to bed and return.
  //   4. Otherwise compute a 90° rotation that aligns the shortest
  //      axis with world-Y, expressed as a quaternion around the
  //      assembly centroid (so members orbit cohesively).
  //   5. Apply the rotation to every member's position + rotation
  //      using the same quaternion-delta machinery the multi-select
  //      gizmo uses (see Viewport.jsx handleChange's rotate branch).
  //   6. Drop the now-flat assembly to the bed.
  layFlatSelection: (withHistory = true) => {
    const s = get();
    let ids = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
    // Fall back to "all visible objects" when nothing is explicitly
    // selected — this is the common case for the slicer popover's
    // quick Lay-Flat button (user clicks SLICE on the whole scene
    // without picking individual parts). Iter-79.
    if (ids.length === 0) {
      ids = s.objects.filter((o) => o.visible !== false).map((o) => o.id);
    }
    if (ids.length === 0) return;
    const objs = ids.map((id) => s.objects.find((o) => o.id === id)).filter(Boolean);
    if (objs.length === 0) return;

    // 1. World-space combined AABB.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const o of objs) {
      try {
        const bb = computeRotatedBBox(o);
        const px = o.position[0], py = o.position[1], pz = o.position[2];
        minX = Math.min(minX, px + bb.min.x);
        minY = Math.min(minY, py + bb.min.y);
        minZ = Math.min(minZ, pz + bb.min.z);
        maxX = Math.max(maxX, px + bb.max.x);
        maxY = Math.max(maxY, py + bb.max.y);
        maxZ = Math.max(maxZ, pz + bb.max.z);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("layFlatSelection: bbox failed for", o?.id, err);
      }
    }
    if (!Number.isFinite(minX)) return;
    const extX = maxX - minX;
    const extY = maxY - minY;
    const extZ = maxZ - minZ;

    // 2. Shortest axis.
    let thinAxis;
    if (extX <= extY && extX <= extZ) thinAxis = "x";
    else if (extY <= extX && extY <= extZ) thinAxis = "y";
    else thinAxis = "z";

    // 3. Already flat — short-circuit to drop-to-bed.
    if (thinAxis === "z") {
      get().dropSelectionToBed(withHistory);
      return;
    }

    // 4. Rotation: bring the thin axis to world-Z. We rotate +90°
    // around the appropriate world axis. For thin=X that's the Y axis;
    // for thin=Y that's the X axis. The sign doesn't matter because
    // the bbox is symmetric on the thin axis — either ±90° puts the
    // largest face on the bed.
    const dQ = new THREE.Quaternion().setFromAxisAngle(
      thinAxis === "x" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    // 5. Rigid-body apply (same quaternion-delta pattern as gizmo).
    if (withHistory) s.pushHistory();
    set((st) => ({
      objects: st.objects.map((o) => {
        if (!ids.includes(o.id)) return o;
        const offset = new THREE.Vector3(
          o.position[0] - cx,
          o.position[1] - cy,
          o.position[2] - cz,
        ).applyQuaternion(dQ);
        const oldQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(o.rotation[0]),
          THREE.MathUtils.degToRad(o.rotation[1]),
          THREE.MathUtils.degToRad(o.rotation[2]),
          "XYZ",
        ));
        const newQ = dQ.clone().multiply(oldQ);
        const newEuler = new THREE.Euler().setFromQuaternion(newQ, "XYZ");
        return {
          ...o,
          position: [cx + offset.x, cy + offset.y, cz + offset.z],
          rotation: [
            Math.round(THREE.MathUtils.radToDeg(newEuler.x) * 1e4) / 1e4,
            Math.round(THREE.MathUtils.radToDeg(newEuler.y) * 1e4) / 1e4,
            Math.round(THREE.MathUtils.radToDeg(newEuler.z) * 1e4) / 1e4,
          ],
        };
      }),
    }));

    // 6. Land on the bed (no extra history entry — step 5 already
    // pushed one and we want the whole Lay-Flat as a single Undo step).
    get().dropSelectionToBed(false);
  },


  duplicateObject: (id) => {
    get().pushHistory();
    set((s) => {
      const src = s.objects.find((o) => o.id === id);
      if (!src) return s;
      const copy = {
        ...src,
        id: newId(src.type),
        name: `${src.name} copy`,
        position: [src.position[0] + 5, src.position[1] + 5, src.position[2]],
      };
      return { objects: [...s.objects, copy], selectedId: copy.id, selectedIds: [copy.id] };
    });
  },

  updateObject: (id, patch) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  },

  updateDims: (id, dimsPatch) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) => {
        if (o.id !== id) return o;
        // Compute the bottom-Z BEFORE the dim change so we can pin it after.
        // Stops a part from "floating" when the user shrinks its Z dim: e.g.
        // a 20mm cube sits at position Z=10 (bottom on bed). If the user
        // types Z=6 into the Inspector, the cube now spans Z=7..13 (still
        // centred at 10). We snap it back so bottom stays on the bed.
        let bottomZ = null;
        try {
          const bbBefore = computeRotatedBBox(o);
          bottomZ = (o.position?.[2] ?? 0) + bbBefore.min.z;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("updateDims: pre-bbox failed", err);
        }
        const next = { ...o, dims: { ...o.dims, ...dimsPatch } };
        if (bottomZ !== null && bottomZ > -1e-3 && bottomZ < 1e-3) {
          // Was sitting on/near the bed — keep it there after the resize.
          try {
            const bbAfter = computeRotatedBBox(next);
            const newCenterZ = -bbAfter.min.z;
            next.position = [next.position[0], next.position[1], newCenterZ];
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("updateDims: post-bbox failed", err);
          }
        }
        return next;
      }),
    }));
  },

  // Bare transform setter — fires constantly during gizmo drag; DOES NOT snapshot.
  // Use beginTransform / commitTransform around drag for undo support.
  setTransform: (id, key, value) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, [key]: value } : o
      ),
    })),

  beginTransform: () => {
    get().pushHistory();
  },

  // For numeric input changes that are atomic
  setTransformWithHistory: (id, key, value) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, [key]: value } : o
      ),
    }));
  },

  // For imported meshes: set real dimension in mm (per axis)
  setImportedDim: (id, axis /* 'x'|'y'|'z' */, mm) => {
    const s = get();
    const obj = s.objects.find((o) => o.id === id);
    if (!obj || !obj.originalBbox) return;
    const idx = { x: 0, y: 1, z: 2 }[axis];
    const orig = obj.originalBbox[axis];
    if (!orig || orig <= 0) return;
    s.pushHistory();
    const newScale = mm / orig;
    set((st) => ({
      objects: st.objects.map((o) => {
        if (o.id !== id) return o;
        const ns = [...o.scale];
        ns[idx] = newScale;
        return { ...o, scale: ns };
      }),
    }));
  },

  toggleVisible: (id) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, visible: !o.visible } : o
      ),
    }));
  },

  toggleLocked: (id) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, locked: !o.locked } : o
      ),
    }));
  },

  flipModifier: (id) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id
          ? { ...o, modifier: o.modifier === "positive" ? "negative" : "positive" }
          : o
      ),
    }));
  },

  setColorIndex: (id, idx) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        // Iter-94 Phase 2 — picking a palette swatch overrides any
        // imported `customColor`. Clearing it ensures the next render
        // uses the palette lookup so the user's manual pick is what
        // they see (not the original LithoForge tone).
        o.id === id ? { ...o, colorIndex: Math.max(0, Math.min(7, idx | 0)), customColor: null } : o
      ),
    }));
  },

  // ---------- Groups (lightweight: parts share a `groupId` and move together) ----------
  // Stamp every currently-selected object with a fresh groupId. Selecting any
  // member afterward expands the selection to the whole group, so transforms
  // and duplicate operate on the assembly as one unit. Children remain
  // fully editable — this is *not* a baked merge (use `flattenSelected` for
  // that).
  groupSelected: (name = "Group") => {
    const ids = get().selectedIds.length
      ? get().selectedIds
      : (get().selectedId ? [get().selectedId] : []);
    if (ids.length < 2) return null;
    get().pushHistory();
    const gid = newId("group");
    set((s) => ({
      objects: s.objects.map((o) => (ids.includes(o.id) ? { ...o, groupId: gid, groupName: name } : o)),
      selectedIds: ids,
      selectedId: ids[ids.length - 1],
    }));
    return gid;
  },
  // Rename every member of a group to share the new group name.
  // We stamp the name onto each member's `groupName` field rather than
  // store it on a separate "group" entity — the codebase models groups
  // implicitly via shared `groupId`, and every read site that needs
  // the name picks the first member's `groupName`, so a consistent
  // stamp keeps everything in sync without a schema change.
  renameGroup: (groupId, newName) => {
    if (!groupId || !newName) return;
    const trimmed = String(newName).trim();
    if (!trimmed) return;
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        o.groupId === groupId ? { ...o, groupName: trimmed } : o
      ),
    }));
  },


  ungroupSelected: () => {
    const ids = get().selectedIds.length ? get().selectedIds : (get().selectedId ? [get().selectedId] : []);
    if (ids.length === 0) return;
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) => {
        if (!ids.includes(o.id)) return o;
        const { groupId: _g, groupName: _gn, ...rest } = o;
        return rest;
      }),
    }));
  },

  // Apply a positional delta to every currently-selected object. Used by
  // the Position popover when the selection is multi (e.g. the user moved a
  // grouped assembly). For single-select callers should keep using
  // setTransformWithHistory which is precise.
  translateSelected: (delta) => {
    const ids = get().selectedIds.length ? get().selectedIds : (get().selectedId ? [get().selectedId] : []);
    if (ids.length === 0) return;
    if (isZeroDelta(delta)) return;
    get().pushHistory();
    set((s) => ({ objects: applyTranslate(s.objects, ids, delta) }));
  },
  // Multiplicative group scaling: each selected member's scale is
  // multiplied by `factor` (per-axis), AND their offset from the
  // PRIMARY grows by the same factor so the whole assembly scales
  // as a rigid unit centred on the primary. Pure-function impl is
  // in `./transforms.js → applyScaleMul`.
  scaleSelectedMul: (factor) => {
    const ids = get().selectedIds.length ? get().selectedIds : (get().selectedId ? [get().selectedId] : []);
    if (ids.length === 0) return;
    if (isIdentityFactor(factor)) return;
    get().pushHistory();
    set((s) => ({
      objects: applyScaleMul(s.objects, ids, s.selectedId, factor),
    }));
  },


  // Rigid-body rotation around the primary's position. Quaternion-
  // composed math lives in `./transforms.js → applyRigidRotate` so
  // it can be unit-tested without a Zustand harness. See that
  // module for the rationale on quaternion vs Euler-addition.
  rotateSelected: (delta) => {
    const ids = get().selectedIds.length ? get().selectedIds : (get().selectedId ? [get().selectedId] : []);
    if (ids.length === 0) return;
    if (isZeroDelta(delta)) return;
    get().pushHistory();
    set((s) => ({
      objects: applyRigidRotate(s.objects, ids, s.selectedId, delta),
    }));
  },

  // selectObject:
  //   - default (no `mode`): single-selection — replaces the set with [id].
  //     If the clicked object belongs to a group, the WHOLE group is
  //     selected so transforms move it as a unit. Users can still drill in
  //     to individual children via Ctrl-click (which uses mode='toggle').
  //   - mode='toggle' (Ctrl/Cmd-click): adds id if absent, removes if present
  //     — operates on the single clicked object only, ignoring group siblings.
  //   - mode='add'    (Shift-click)   : adds id if absent (range select TODO)
  //   - mode='exact'  (programmatic)  : exactly select [id] without group expansion.
  selectObject: (id, mode = null) => {
    set((s) => {
      // Sub-element selections are only meaningful for the currently
      // primary-selected object. When primary selection changes, drop
      // any stale sub-pick so the inspector / overlay don't stay
      // anchored to an object the user is no longer looking at.
      const subPatch = (id === null || id !== s.selectedId)
        ? { subSelection: null, subSelectMode: "object" }
        : {};
      if (id === null) return { selectedId: null, selectedIds: [], ...subPatch };
      if (!mode) {
        const target = s.objects.find((o) => o.id === id);
        if (target && target.groupId) {
          const groupMembers = s.objects.filter((o) => o.groupId === target.groupId).map((o) => o.id);
          return { selectedId: id, selectedIds: groupMembers, ...subPatch };
        }
        return { selectedId: id, selectedIds: [id], ...subPatch };
      }
      if (mode === "exact") {
        return { selectedId: id, selectedIds: [id], ...subPatch };
      }
      const current = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
      const has = current.includes(id);
      let next;
      if (mode === "toggle") {
        next = has ? current.filter((x) => x !== id) : [...current, id];
      } else {
        next = has ? current : [...current, id];
      }
      return {
        selectedIds: next,
        selectedId: next.length ? (has && mode === "toggle" ? next[next.length - 1] || null : id) : null,
        ...subPatch,
      };
    });
  },
  clearSelection: () => set({ selectedId: null, selectedIds: [], subSelection: null, subSelectMode: "object" }),

  // Duplicate every currently-selected object. Optionally mirror each copy
  // along a world axis (x/y/z) by negating that scale component and reflecting
  // the position about the bed center on that axis. The newly created copies
  // become the new selection so subsequent transforms operate on them.
  duplicateSelected: ({ mirrorAxis = null, offset = 5 } = {}) => {
    const delta = duplicateSelectedDelta(get(), { mirrorAxis, offset, newId });
    if (!delta) return;
    get().pushHistory();
    set(delta);
  },

  // In-place mirror: flip the selection on the given axis WITHOUT creating
  // a duplicate. Useful for fixing asymmetric AI-generated meshes. Pure
  // logic lives in `selectionActions.js`; this is the history-aware wrapper.
  mirrorSelectedInPlace: (axis) => {
    const delta = mirrorSelectedInPlaceDelta(get(), axis);
    if (!delta) return;
    get().pushHistory();
    set(delta);
  },

  setTransformMode: (mode) => set({ transformMode: mode }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setSnapTranslate: (v) => set({ snapTranslate: Math.max(0.001, Number(v) || 0) }),
  // iter-112 — unit-system toggle. Persists via localStorage so the
  // user's last choice survives a reload.
  setUnitSystem: (system) => {
    const next = system === "in" ? "in" : "mm";
    try { localStorage.setItem("forgeslicer.unitSystem", next); } catch { /* noop */ }
    set({ unitSystem: next });
  },
  setSnapRotate: (v) => set({ snapRotate: Math.max(0.1, Number(v) || 0) }),
  setSnapScale: (v) => set({ snapScale: Math.max(0.001, Number(v) || 0) }),
  setGridVisible: (v) => set({ gridVisible: v }),
  setBuildVolume: (v) => set({ buildVolume: v }),
  setDesignPlate: (patch) => set((st) => ({
    designPlate: { ...st.designPlate, ...patch },
  })),

  setCutMode: (v) => set({ cutMode: !!v }),
  setCutPlane: (patch) => set((st) => ({ cutPlane: { ...st.cutPlane, ...patch } })),

  // Subdivide an oversized object using a manual or auto-computed list
  // of axis-aligned planar cuts. The source object is REPLACED in-scene
  // by every resulting piece (plus connectors if requested). Lands as a
  // single undo step.
  //
  // `objectId`     — id of the scene object to subdivide
  // `cuts`         — { x: [worldX, ...], y: [worldY, ...], z: [worldZ, ...] }
  // `connectors`   — { kind: "none" | "dowel" | "dovetail", sizeMm: number }
  //
  // Returns { ok, count, error }.
  applySubdivide: async (objectId, cuts, connectors = { kind: "none" }) => {
    const src = get().objects.find((o) => o.id === objectId);
    if (!src) return { ok: false, error: "Object not found" };
    let newObjects = [];
    try {
      newObjects = await subdivideObject(src, cuts, newId, { connectors });
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
    if (newObjects.length === 0) {
      return { ok: false, error: "Cuts didn't produce any new pieces" };
    }
    get().pushHistory();
    set((st) => ({
      objects: [...st.objects.filter((o) => o.id !== objectId), ...newObjects],
      selectedIds: newObjects.map((o) => o.id),
      selectedId: newObjects[newObjects.length - 1].id,
    }));
    return { ok: true, count: newObjects.length };
  },

  // Apply the current cut plane to the currently-selected object(s).
  // `keep` is "both" | "upper" | "lower". Pure cut logic lives in
  // `cutActions.js`; this wrapper handles history + scene replacement
  // so the multi-piece cut lands as a single undo step.
  applyCut: async (keep = "both") => {
    const delta = await buildCutDelta(get(), keep, newId);
    if (!delta) return { ok: false, error: "Nothing selected" };
    const { newObjects, errors, removedIds } = delta;
    if (newObjects.length === 0) {
      return { ok: false, error: errors.join("; ") || "Cut produced no geometry" };
    }
    get().pushHistory();
    set((st) => ({
      objects: [...st.objects.filter((o) => !removedIds.includes(o.id)), ...newObjects],
      selectedIds: newObjects.map((o) => o.id),
      selectedId: newObjects[newObjects.length - 1].id,
      cutMode: false,
    }));
    return { ok: true, pieces: newObjects.length, errors };
  },

  // ---- Measurement ----
  setMeasureMode: (on) =>
    set({ measureMode: on, pendingMeasurePoint: null, pendingMeasureObjId: null }),

  handleMeasureClick: (point, objId = null) => {
    const s = get();
    if (!s.measureMode) return;
    if (!s.pendingMeasurePoint) {
      set({ pendingMeasurePoint: point, pendingMeasureObjId: objId });
    } else {
      const m = {
        id: `m-${Date.now()}`,
        a: s.pendingMeasurePoint,
        b: point,
        objIdA: s.pendingMeasureObjId,
        objIdB: objId,
      };
      set({
        measurements: [...s.measurements, m],
        pendingMeasurePoint: null,
        pendingMeasureObjId: null,
      });
    }
  },

  removeMeasurement: (id) =>
    set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) })),

  clearMeasurements: () =>
    set({ measurements: [], pendingMeasurePoint: null }),

  // ---- Component-pair dimensions (Blender-style annotations) ----
  // Idempotent: clicking "Measure to … X" twice with X already paired is
  // a no-op (we de-dupe on unordered {A,B}). The first click stores the
  // "from" id; the second click commits the pair. The user can cancel a
  // pending pick with Esc (handled by ContextMenu's onClose) or by
  // calling `clearPendingComponentDimension`.
  beginComponentDimension: (fromId) => {
    if (!fromId) return;
    set({ pendingDimensionFromId: fromId });
  },
  clearPendingComponentDimension: () => set({ pendingDimensionFromId: null }),
  // Add a pair given an explicit "to" id. Reads the pending "from" id
  // from state. Refuses to pair an object with itself.
  commitComponentDimension: (toId) => {
    const s = get();
    const fromId = s.pendingDimensionFromId;
    if (!fromId || !toId || fromId === toId) {
      set({ pendingDimensionFromId: null });
      return null;
    }
    // De-dupe on the unordered {A,B} pair so the user doesn't end up
    // with two chips drawing the same number.
    const exists = s.componentDimensions.find(
      (d) =>
        (d.objIdA === fromId && d.objIdB === toId) ||
        (d.objIdA === toId && d.objIdB === fromId)
    );
    if (exists) {
      set({ pendingDimensionFromId: null });
      return exists.id;
    }
    const id = `cd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    set({
      componentDimensions: [
        ...s.componentDimensions,
        { id, objIdA: fromId, objIdB: toId },
      ],
      pendingDimensionFromId: null,
    });
    return id;
  },
  removeComponentDimension: (id) =>
    set((s) => ({ componentDimensions: s.componentDimensions.filter((d) => d.id !== id) })),
  clearComponentDimensions: () =>
    set({ componentDimensions: [], pendingDimensionFromId: null }),

  // ---- Anchored ruler (TinkerCAD-style) ----
  // Actions live in `./rulerActions.js`. We spread the factory's
  // output here so every method becomes a direct store action with
  // no behaviour change. See `rulerActions.js` for the docstrings.
  ...createRulerActions(set, get),

  // ---- Profile + preferences (iter-90 extraction) ----
  ...createProfileActions({
    get,
    set,
    deps: { PRINTERS, getPrinter, defaultPrinterId },
  }),

  // ---- Composite primitives (iter-87 extraction) ----
  // Each composite drops a pre-grouped assembly (slot, fastener pair,
  // countersink, hex pocket, gusset) as a single undo step. Builders
  // live in `./composites.js`; the action wrappers live in
  // `./compositeActions.js`.
  ...createCompositeActions({
    get,
    set,
    deps: {
      buildFastenerPair, buildCountersink, buildHexPocket,
      buildGusset, buildSlot, buildPrimitive, newId,
    },
  }),

  clearScene: () => {
    get().pushHistory();
    set(emptyProjectState());
  },

  // Auto-fit the entire scene to the current printer's build volume.
  // Useful after a Remix import when the source design was authored for
  // a bigger bed. Computes the combined world AABB, scales every object
  // uniformly so the longest axis ≈ `targetFraction` × the shortest
  // build-volume axis (default 95%), and re-positions each object so
  // the assembly keeps its centre on the bed origin and its base on Y=0.
  //
  // Returns { ok: true, scaleFactor } on success, { ok: false, reason }
  // when there's nothing to scale or the math is degenerate.
  resizeSceneToBed: ({ targetFraction = 0.95 } = {}) => {
    const s = get();
    const objs = s.objects;
    if (!objs || objs.length === 0) return { ok: false, reason: "Scene is empty" };

    // Combined world AABB across every visible object.
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let any = false;
    for (const o of objs) {
      if (o.visible === false) continue;
      try {
        const bb = computeRotatedBBox(o);
        const px = o.position?.[0] ?? 0;
        const py = o.position?.[1] ?? 0;
        const pz = o.position?.[2] ?? 0;
        const wx0 = px + bb.min.x, wx1 = px + bb.max.x;
        const wy0 = py + bb.min.y, wy1 = py + bb.max.y;
        const wz0 = pz + bb.min.z, wz1 = pz + bb.max.z;
        if (wx0 < minX) minX = wx0;
        if (wx1 > maxX) maxX = wx1;
        if (wy0 < minY) minY = wy0;
        if (wy1 > maxY) maxY = wy1;
        if (wz0 < minZ) minZ = wz0;
        if (wz1 > maxZ) maxZ = wz1;
        any = true;
      } catch (_) { /* skip un-bbox-able primitives (sweeps with ref paths etc.) */ }
    }
    if (!any) return { ok: false, reason: "Could not compute scene bounds" };

    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    const longest = Math.max(dx, dy, dz);
    if (longest <= 0.001) return { ok: false, reason: "Scene has zero extent" };

    // Build-volume axis mapping (Z-up): BV.x → world X, BV.y → world Y,
    // BV.z → world Z (height). All axes map 1:1.
    const bv = s.buildVolume || { x: 220, y: 220, z: 250 };
    const fitX = (bv.x * targetFraction) / dx;
    const fitY = (bv.y * targetFraction) / dy;
    const fitZ = (bv.z * targetFraction) / dz;
    const scaleFactor = Math.min(fitX, fitY, fitZ);
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      return { ok: false, reason: "Could not compute scale factor" };
    }
    // Skip the work if we're already inside 1% of target — avoids burning
    // an undo slot on a no-op resize.
    if (Math.abs(scaleFactor - 1) < 0.01) {
      return { ok: false, reason: "Already fits bed", scaleFactor };
    }

    // Centre of the source AABB (used so the rescaled assembly stays
    // centred on the bed instead of drifting toward +X/+Y).
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    get().pushHistory();
    set((st) => ({
      objects: st.objects.map((o) => {
        // Rescale each object's position relative to the assembly centre,
        // then multiply its existing scale by the same factor. Z is
        // handled separately so we can drop the resulting assembly to
        // Z=0 in the same pass (no need for a follow-up dropToBed call).
        const px = (o.position?.[0] ?? 0) - cx;
        const py = (o.position?.[1] ?? 0) - cy;
        const pz = o.position?.[2] ?? 0;
        const newZ = (pz - minZ) * scaleFactor;
        return {
          ...o,
          position: [px * scaleFactor, py * scaleFactor, newZ],
          scale: [
            (o.scale?.[0] ?? 1) * scaleFactor,
            (o.scale?.[1] ?? 1) * scaleFactor,
            (o.scale?.[2] ?? 1) * scaleFactor,
          ],
        };
      }),
    }));
    return { ok: true, scaleFactor };
  },

  loadProject: (state) => {
    get().pushHistory();
    set(loadProjectState(state, {
      printerId: defaultPrinterId,
      filamentId: defaultFilamentId,
    }));
  },

  serialize: () => serializeProject(get()),
}));

export const useSliceSettings = create((set) => ({
  layerHeight: 0.2,
  firstLayerHeight: 0.3,
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  printSpeed: 60,
  travelSpeed: 120,
  perimeters: 2,
  infillPercent: 15,
  // Sparse infill pattern for middle layers: "rectilinear" | "grid" | "gyroid".
  infillPattern: "rectilinear",
  // Tier-(c) hybrid: number of transition layers above bottom solid and
  // below top solid where sparse infill density is boosted to bridge
  // sparse → solid smoothly. 0 disables.
  transitionLayers: 2,
  // Tier-(a) solid infill: number of fully solid layers at the bottom
  // and top of the print. Middle layers stay perimeter-only until
  // Tier-(b) sparse infill lands.
  topLayers: 4,
  bottomLayers: 4,
  nozzleTemp: 210,
  bedTemp: 60,
  // Build-plate surface (iter-75). Drives OrcaSlicer's `curr_bed_type`
  // field — Orca picks bed temp from the matching `*_plate_temp`
  // field in the filament profile based on this value. The bed-temp
  // override below sets ALL four plates to the user's value so it
  // doesn't matter if some printer profile overrides `curr_bed_type`
  // downstream, but `curr_bed_type` still influences other surface-
  // specific behaviours (PEI vs cool-plate first-layer Z, etc.).
  bedSurface: "Textured PEI Plate",
  retraction: 1.0,
  set: (patch) => set(patch),
}));

export { PRINTERS, FILAMENTS };

// Dev / debug: expose the scene store on `window.__forgeStore` so
// Playwright scripts, the browser console, and tooling like Cypress
// can introspect or drive scene state without needing to hook into
// React's fiber tree. Strictly read/write through the same API
// React components use, so there's no risk of state drift.
if (typeof window !== "undefined") {
  window.__forgeStore = useScene;
}

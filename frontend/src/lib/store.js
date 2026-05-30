import { create } from "zustand";
import * as THREE from "three";
import { PRINTERS, FILAMENTS, getPrinter, getFilament } from "./presets";
import { computeRotatedBBox } from "./geometry";
import { SWEEP_DEFAULTS } from "./sweepGeometry";
import { TEXTURE_DEFAULTS } from "./textureGeometry";
import {
  buildSlot,
  buildFastenerPair,
  buildCountersink,
  buildHexPocket,
  buildGusset,
} from "./composites";
import { duplicateSelectedDelta, mirrorSelectedInPlaceDelta } from "./selectionActions";
import { buildCutDelta } from "./cutActions";
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

const PRIMITIVE_DEFAULTS = {
  cube:     { dims: { x: 20, y: 20, z: 20 } },
  sphere:   { dims: { r: 12, segments: 48 } },
  cylinder: { dims: { r: 10, h: 24, segments: 64 } },
  cone:     { dims: { r: 10, h: 24, segments: 64 } },
  torus:    { dims: { r: 14, tube: 4, segments: 48 } },
  // ---- Curve / extrude-style primitives (v1.12) ----
  // helix: a tube swept along a parametric helix. Useful for screw
  //        threads, springs, decorative coils, antennae mounts. `turns`
  //        is the number of complete revolutions; `pitch` is the
  //        per-turn rise so `H = turns * pitch`.
  helix:    { dims: { r: 12, tube: 2, pitch: 6, turns: 4, segments: 96 } },
  // pipe: hollow cylinder (outer R, wall thickness, height). Same idea
  //       as cylinder but builds the inside hole at primitive construction
  //       time so the user doesn't need a CSG subtract for the simplest
  //       case (pipes / tube fittings / standoffs).
  pipe:     { dims: { r: 12, wall: 2, h: 30, segments: 64 } },
  // wedge: TinkerCAD-style ramp. Right-triangle profile extruded along
  //        the X axis; ramps along +Z, height along +Y. Great for
  //        chamfered bases, draft angles, ergonomic grips.
  wedge:    { dims: { x: 24, y: 16, z: 24 } },
  // ---- Threaded fasteners (v1.15) ----
  // bolt:  cylinder body + triangular thread helix swept around it.
  //        Models ISO-metric profile so it screws into the matching
  //        `nut` primitive. `r` is the major (outside) thread radius,
  //        `pitch` is the per-turn rise (1.5mm for ~M10), `h` is the
  //        threaded length, `headR`/`headH` are the hex/cap head.
  bolt:     { dims: { r: 5, pitch: 1.5, h: 20, headR: 8, headH: 4, segments: 48, headStyle: "hex" } },
  // nut:   hex prism with an inner-thread helix swept inside. Major
  //        radius matches the bolt's; the inside threads cut into the
  //        prism so a bolt of matching pitch screws right in. `pitch`
  //        must match the mating bolt. `flatR` is the hex flat radius
  //        (across-flats / 2).
  nut:      { dims: { r: 5, pitch: 1.5, h: 5, flatR: 8, segments: 48 } },
  // spline (1.16): a splined SHAFT — N longitudinal ridges (teeth)
  //        running along a cylindrical core. Models the splined-shaft
  //        side of mechanical couplings (gears, drive hubs, etc.). The
  //        Inspector exposes both `width` (chord on outer surface, mm)
  //        and `angle` (per-tooth angular span, deg) — they're two
  //        views on the same constraint. `profile` picks the cross-
  //        section: rectangular (flat-top), triangular (involute/
  //        serration), or rounded (knurl-like). When the user toggles
  //        the object's modifier to "negative" the same geometry cuts
  //        matching grooves into another part (the bore side).
  spline:   { dims: { r: 6, h: 30, teeth: 8, toothHeight: 1.2, toothWidthDeg: 12, profile: "rectangular", segments: 32 } },
  // ---- 2D shapes ----
  // Stored as thin extrusions (h = 1 mm by default — a "2D wafer").
  // The Extrude action in the inspector promotes them to 3D parts by
  // bumping h to whatever depth the user wants.
  circle:   { dims: { r: 10, h: 1 } },
  square2d: { dims: { side: 20, h: 1 } },
  triangle: { dims: { r: 12, h: 1 } },
  polygon:  { dims: { r: 12, sides: 6, h: 1 } },
  // ---- Sweep (v1.18, iter 46) ----
  // sweep: extrudes a 2D profile along a 3D path so the profile stays
  //        perpendicular to the path tangent at every sample. Profile
  //        descriptors live in `dims.profile`; path descriptors in
  //        `dims.path`. The default preset is a helical spring — circular
  //        profile swept along a helix — so users see what Sweep actually
  //        does the moment they add it.
  sweep:    { dims: { ...SWEEP_DEFAULTS } },
  // ---- Texture (v1.20, iter 49) ----
  // texture: tiled geometric pattern (knurl / hex / bumps / ridges)
  //          baked as a single merged BufferGeometry on top of a thin
  //          base plate. Positive textures union onto a host surface;
  //          negatives engrave. The user picks the pattern + dims via
  //          the Texture Library dialog OR via the Inspector's
  //          TextureInspectorBlock once the object is selected.
  texture:  { dims: { ...TEXTURE_DEFAULTS } },
};

let nextId = 1;
const newId = (type) => `${type}-${Date.now()}-${nextId++}`;

const buildPrimitive = (type, modifier = "positive", overrides = {}) => {
  const def = PRIMITIVE_DEFAULTS[type] || PRIMITIVE_DEFAULTS.cube;
  // Compute the bbox-half-height so the new primitive lands centered
  // on the build plate with its base at Y=0. Helix uses turns*pitch
  // (the geometry's actual vertical extent), other curve primitives
  // fall through to their explicit `h` key. Final fallback is the
  // legacy z/h/r heuristic so untouched primitives behave as before.
  let halfH;
  if (type === "helix") halfH = (def.dims.turns * def.dims.pitch) / 2;
  else if (type === "sweep") {
    // Sweep's vertical extent depends on the path kind. For helix we
    // know it analytically; for everything else we punt to the auto-
    // drop pass downstream (computeRotatedBBox handles it).
    const p = def.dims.path || {};
    if (p.kind === "helix") halfH = (p.turns * p.pitch) / 2;
    else halfH = 10;
  }
  else if (type === "texture") {
    // Texture sits with its base plate at y=0 down to y=-depth, and
    // relief rising up to y=height. Halfway between those is what
    // we want as the centroid for the auto-drop pass.
    const depth = def.dims.depth ?? 0.8;
    const height = def.dims.height ?? 1.0;
    halfH = (depth + height) / 2;
  }
  else if (def.dims.h != null) halfH = def.dims.h / 2;
  else if (def.dims.z != null) halfH = def.dims.z / 2;
  else if (def.dims.r != null) halfH = def.dims.r;
  else halfH = 10;
  return {
    id: newId(type),
    name: `${type[0].toUpperCase() + type.slice(1)}`,
    type,
    modifier,
    visible: true,
    locked: false,
    position: [0, halfH, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dims: type === "sweep"
      // Sweep dims contain nested `profile` and `path` descriptors —
      // a shallow `{ ...def.dims }` would make every new sweep share
      // the SAME object references for those nested dicts and an
      // edit on one would silently leak into another. Deep-copy them.
      ? {
          ...def.dims,
          profile: { ...def.dims.profile },
          path: { ...def.dims.path },
        }
      : { ...def.dims },
    colorIndex: modifier === "negative" ? 0 : 7,
    ...overrides,
  };
};

// Deep clone helper for scene snapshots lives in `./historyStack.js`
// so the history machinery can be unit-tested in isolation. The
// previous in-file copy was identical — we import it now.

const defaultPrinterId = "custom";
const defaultFilamentId = "pla";

export const useScene = create((set, get) => ({
  objects: [],
  selectedId: null,       // primary selection (most recently clicked) — used by Inspector / popovers
  selectedIds: [],        // full selection set for multi-select actions (duplicate, mirror, delete)
  transformMode: "translate",
  snapEnabled: true,
  snapTranslate: 1,
  snapRotate: 15,
  snapScale: 0.1,
  gridVisible: true,
  buildVolume: getPrinter(defaultPrinterId).buildVolume,
  projectName: "Untitled Project",
  remixOf: null,  // gallery item id this project is remixing

  // ---- profiles ----
  printerId: defaultPrinterId,
  filamentId: defaultFilamentId,
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

  // ---- measurement ----
  measureMode: false,
  measurements: [], // [{id, a:[x,y,z], b:[x,y,z], objIdA, objIdB}]
  pendingMeasurePoint: null,

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
  setPrinter: (id) => {
    const s = get();
    // Look in built-in first, then community
    let p = PRINTERS.find((x) => x.id === id);
    if (!p) {
      const c = s.communityPrinters.find((x) => x.id === id);
      if (c) {
        p = {
          id: c.id,
          brand: c.brand,
          name: c.name,
          buildVolume: { x: c.build_x, y: c.build_y, z: c.build_z },
          maxNozzleTemp: c.max_nozzle_temp,
          maxBedTemp: c.max_bed_temp,
          defaultNozzle: c.default_nozzle,
          defaultPrintSpeed: c.default_print_speed,
        };
      }
    }
    if (!p) p = getPrinter(defaultPrinterId);
    set({
      printerId: p.id,
      buildVolume: { ...p.buildVolume },
    });
  },
  setFilament: (id) => set({ filamentId: id }),
  setAutoDropOnRotate: (v) => {
    if (typeof window !== "undefined" && window.localStorage) {
      try { window.localStorage.setItem("forge.autoDropOnRotate", v ? "true" : "false"); }
      catch (err) {
        // eslint-disable-next-line no-console
        console.warn("persist autoDropOnRotate failed:", err);
      }
    }
    set({ autoDropOnRotate: !!v });
  },
  setAutoDropNew: (v) => {
    if (typeof window !== "undefined" && window.localStorage) {
      try { window.localStorage.setItem("forge.autoDropNew", v ? "true" : "false"); }
      catch (err) {
        // eslint-disable-next-line no-console
        console.warn("persist autoDropNew failed:", err);
      }
    }
    set({ autoDropNew: !!v });
  },
  setCommunityPrinters: (list) => set({ communityPrinters: list }),
  addCommunityPrinter: (p) =>
    set((s) => ({ communityPrinters: [p, ...s.communityPrinters] })),
  removeCommunityPrinter: (id) =>
    set((s) => ({ communityPrinters: s.communityPrinters.filter((c) => c.id !== id) })),

  // ---- scene mutations ----
  setProjectName: (name) => set({ projectName: name }),
  setRemixOf: (id) => set({ remixOf: id }),

  addPrimitive: (type, modifier = "positive") => {
    get().pushHistory();
    let obj = buildPrimitive(type, modifier);
    // Honour the "auto-drop new parts to bed" preference (default ON).
    // We compute the rotated local bbox and offset position.y so the bottom
    // touches Y=0. Wrapped in try/catch so a missing geometry helper for
    // exotic types can't break primitive creation.
    if (get().autoDropNew) {
      try {
        const bb = computeRotatedBBox(obj);
        if (isFinite(bb.min.y)) {
          obj = { ...obj, position: [obj.position[0], -bb.min.y, obj.position[2]] };
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
  // `opts.boltR` / `opts.pitch` / `opts.workThickness` let downstream
  // callers customise; defaults match the bolt primitive's defaults
  // (M10 ish — 5mm major radius, 1.5mm pitch).
  addFastenerPair: (opts = {}) => {
    get().pushHistory();
    const { parts, groupId, primaryId } = buildFastenerPair(opts, { buildPrimitive, newId });
    set((s) => ({
      objects: [...s.objects, ...parts],
      selectedId: primaryId,
      selectedIds: parts.map((p) => p.id),
    }));
    return groupId;
  },

  // ---- Composite macros (iter 50) ---------------------------------
  // Each composite is a small assembly the user can drop with ONE
  // click. All members share a groupId so they move/rotate as a unit
  // and ungroup-able for fine-tuning. Pure builders live in
  // `lib/composites.js`; the store actions are thin pushHistory + set
  // wrappers so undo captures the entire assembly in one snapshot.

  addCountersink: (opts = {}) => {
    get().pushHistory();
    const { parts, groupId, primaryId } = buildCountersink(opts, { buildPrimitive, newId });
    set((s) => ({
      objects: [...s.objects, ...parts],
      selectedId: primaryId,
      selectedIds: parts.map((p) => p.id),
    }));
    return groupId;
  },

  addHexPocket: (opts = {}) => {
    get().pushHistory();
    const { parts, groupId, primaryId } = buildHexPocket(opts, { buildPrimitive, newId });
    set((s) => ({
      objects: [...s.objects, ...parts],
      selectedId: primaryId,
      selectedIds: parts.map((p) => p.id),
    }));
    return groupId;
  },

  addGusset: (opts = {}) => {
    get().pushHistory();
    const { parts, groupId, primaryId } = buildGusset(opts, { buildPrimitive, newId });
    set((s) => ({
      objects: [...s.objects, ...parts],
      selectedId: primaryId,
      selectedIds: parts.map((p) => p.id),
    }));
    return groupId;
  },

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
      position: [cx, height / 2, cy],
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
      position: [0, role === "path" ? 0 : 10, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dims,
      colorIndex: (src.modifier === "negative") ? 0 : 7,
    };

    // Auto-drop so the new sweep sits on the bed.
    let placed = obj;
    if (get().autoDropNew) {
      try {
        const bb = computeRotatedBBox(placed);
        if (isFinite(bb.min.y)) {
          placed = { ...placed, position: [placed.position[0], -bb.min.y, placed.position[2]] };
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

  addImportedMesh: (name, vertices, indices = null, originalBbox = null) => {
    get().pushHistory();
    let obj = {
      id: newId("mesh"),
      name: name || "Imported Mesh",
      type: "imported",
      modifier: "positive",
      visible: true,
      locked: false,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dims: {},
      colorIndex: 0,
      originalBbox: originalBbox || undefined, // {x,y,z} in mm at scale 1
      geometry: { vertices, indices },
    };
    if (get().autoDropNew) {
      try {
        const bb = computeRotatedBBox(obj);
        if (isFinite(bb.min.y)) {
          obj = { ...obj, position: [obj.position[0], -bb.min.y, obj.position[2]] };
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("addImportedMesh auto-drop bbox failed:", err);
      }
    }
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id, selectedIds: [obj.id] }));
    return obj.id;
  },

  addRawObject: (obj) => {
    get().pushHistory();
    let withId = { ...obj, id: obj.id || newId(obj.type || "mesh") };
    if (get().autoDropNew && !obj.__skipAutoDrop) {
      try {
        const bb = computeRotatedBBox(withId);
        if (isFinite(bb.min.y)) {
          const wy = (withId.position?.[1] ?? 0) + bb.min.y;
          if (Math.abs(wy) > 1e-3) {
            withId = { ...withId, position: [withId.position[0], withId.position[1] - wy, withId.position[2]] };
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
  // Slot / racetrack hole — see `lib/composites.js#buildSlot` for the
  // construction details. The store action is the thin pushHistory +
  // set wrapper so the slot lands as a single undo step. Returns the
  // assembly's groupId.
  addSlot: (modifier = "negative", overrides = {}) => {
    get().pushHistory();
    const { parts, groupId, primaryId } = buildSlot({ modifier, ...overrides }, { buildPrimitive, newId });
    set((s) => ({
      objects: [...s.objects, ...parts],
      selectedId: primaryId,
      selectedIds: parts.map((p) => p.id),
    }));
    return groupId;
  },

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
        rulerAnchor: (s.rulerAnchor && removeSet.has(s.rulerAnchor.objId)) ? null : s.rulerAnchor,
        rulerTarget: (s.rulerTarget && removeSet.has(s.rulerTarget.objId)) ? null : s.rulerTarget,
      };
    });
    return incoming.map((o) => o.id);
  },

  removeObject: (id) => {
    get().pushHistory();
    set((s) => ({
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
      rulerAnchor: (s.rulerAnchor && s.rulerAnchor.objId === id) ? null : s.rulerAnchor,
      rulerTarget: (s.rulerTarget && s.rulerTarget.objId === id) ? null : s.rulerTarget,
    }));
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
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      selectedId: null,
      selectedIds: [],
      measurements: s.measurements.filter((m) => !ids.includes(m.objIdA) && !ids.includes(m.objIdB)),
      componentDimensions: s.componentDimensions.filter(
        (d) => !ids.includes(d.objIdA) && !ids.includes(d.objIdB)
      ),
      pendingDimensionFromId: ids.includes(s.pendingDimensionFromId) ? null : s.pendingDimensionFromId,
      rulerAnchor: (s.rulerAnchor && ids.includes(s.rulerAnchor.objId)) ? null : s.rulerAnchor,
      rulerTarget: (s.rulerTarget && ids.includes(s.rulerTarget.objId)) ? null : s.rulerTarget,
    }));
  },

  // Drop the object so its lowest point sits on Y=0 (the build plate).
  dropToBed: (id, withHistory = true) => {
    const s = get();
    const obj = s.objects.find((o) => o.id === id);
    if (!obj || obj.type === "imported" ? false : false) {} // placeholder
    if (!obj) return;
    try {
      const bb = computeRotatedBBox(obj);
      const newY = -bb.min.y;
      if (Math.abs(newY - obj.position[1]) < 1e-4) return;
      if (withHistory) s.pushHistory();
      set((st) => ({
        objects: st.objects.map((o) =>
          o.id === id ? { ...o, position: [o.position[0], newY, o.position[2]] } : o
        ),
      }));
    } catch (err) {
      // Geometry may not be ready (rebuild mid-flight). Surface it so
      // recurring failures are visible without breaking the action.
      // eslint-disable-next-line no-console
      console.warn("dropToBed: bbox failed", err);
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
    let worldMinY = Infinity;
    for (const id of ids) {
      const o = s.objects.find((x) => x.id === id);
      if (!o) continue;
      try {
        const bb = computeRotatedBBox(o);
        const wy = (o.position?.[1] ?? 0) + bb.min.y;
        if (wy < worldMinY) worldMinY = wy;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("dropSelectionToBed: bbox failed for", o?.id, err);
      }
    }
    if (!Number.isFinite(worldMinY)) return;
    if (Math.abs(worldMinY) < 1e-3) return;
    if (withHistory) s.pushHistory();
    const dy = -worldMinY;
    set((st) => ({
      objects: st.objects.map((o) =>
        ids.includes(o.id)
          ? { ...o, position: [o.position[0], o.position[1] + dy, o.position[2]] }
          : o
      ),
    }));
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
        position: [src.position[0] + 5, src.position[1], src.position[2] + 5],
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
        // Compute the bottom-Y BEFORE the dim change so we can pin it after.
        // This stops a part from "floating" when the user shrinks its Y dim:
        // e.g. default 20mm cube sits at position Y=10 (bottom on bed). If the
        // user types Y=6 into the Inspector, the cube now spans Y=7..13 (still
        // centred at 10). We snap it back so bottom stays on the bed instead.
        let bottomY = null;
        try {
          const bbBefore = computeRotatedBBox(o);
          bottomY = (o.position?.[1] ?? 0) + bbBefore.min.y;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("updateDims: pre-bbox failed", err);
        }
        const next = { ...o, dims: { ...o.dims, ...dimsPatch } };
        if (bottomY !== null && bottomY > -1e-3 && bottomY < 1e-3) {
          // Was sitting on/near the bed — keep it there after the resize.
          try {
            const bbAfter = computeRotatedBBox(next);
            const newCenterY = -bbAfter.min.y;  // bottom = 0 ⇒ center = -min.y
            next.position = [next.position[0], newCenterY, next.position[2]];
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
        o.id === id ? { ...o, colorIndex: Math.max(0, Math.min(7, idx | 0)) } : o
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
      if (id === null) return { selectedId: null, selectedIds: [] };
      if (!mode) {
        const target = s.objects.find((o) => o.id === id);
        if (target && target.groupId) {
          const groupMembers = s.objects.filter((o) => o.groupId === target.groupId).map((o) => o.id);
          return { selectedId: id, selectedIds: groupMembers };
        }
        return { selectedId: id, selectedIds: [id] };
      }
      if (mode === "exact") {
        return { selectedId: id, selectedIds: [id] };
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
      };
    });
  },
  clearSelection: () => set({ selectedId: null, selectedIds: [] }),

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
  setSnapTranslate: (v) => set({ snapTranslate: v }),
  setGridVisible: (v) => set({ gridVisible: v }),
  setBuildVolume: (v) => set({ buildVolume: v }),

  setCutMode: (v) => set({ cutMode: !!v }),
  setCutPlane: (patch) => set((st) => ({ cutPlane: { ...st.cutPlane, ...patch } })),

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
  setRulerMode: (on) => set({ rulerMode: !!on }),
  // Anchor snap-point — caller computes via nearestSnapPoint() and
  // hands us the full record. Resets the target on every new anchor so
  // the user starts the second-click flow fresh.
  setRulerAnchor: (anchor) => set({ rulerAnchor: anchor || null, rulerTarget: null }),
  clearRulerAnchor: () => set({ rulerAnchor: null, rulerTarget: null }),
  // Target snap-point — the second click. Most-recent click wins.
  setRulerTarget: (target) => set({ rulerTarget: target || null }),
  clearRulerTarget: () => set({ rulerTarget: null }),
  // Cycle the visible axes: xyz → x → y → z → xyz. Matches the
  // hamburger-icon toggle on the TinkerCAD ruler HUD.
  cycleRulerAxes: () => {
    const order = ["xyz", "x", "y", "z"];
    const cur = get().rulerAxesMode || "xyz";
    const next = order[(order.indexOf(cur) + 1) % order.length];
    set({ rulerAxesMode: next });
  },
  // Toggle one snap-kind on/off. Refuses to disable the last enabled
  // kind (we'd have nothing to snap to). 'corner' / 'edge' / 'face' / 'center'.
  toggleRulerSnapKind: (kind) => {
    const cur = get().rulerSnapKinds || [];
    if (cur.includes(kind)) {
      if (cur.length <= 1) return; // keep at least one
      set({ rulerSnapKinds: cur.filter((k) => k !== kind) });
    } else {
      set({ rulerSnapKinds: [...cur, kind] });
    }
  },

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

    // Build-volume axis mapping: BV.x → world X, BV.y → world Z (depth),
    // BV.z → world Y (height). The bed-fit target is the largest box
    // that fits inside that volume — limited by whichever axis ratio
    // demands the smallest scale.
    const bv = s.buildVolume || { x: 220, y: 220, z: 250 };
    const fitX = (bv.x * targetFraction) / dx;
    const fitZ = (bv.y * targetFraction) / dz;
    const fitY = (bv.z * targetFraction) / dy;
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
    // centred on the bed instead of drifting toward +X/+Z).
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    get().pushHistory();
    set((st) => ({
      objects: st.objects.map((o) => {
        // Rescale each object's position relative to the assembly centre,
        // then multiply its existing scale by the same factor. Y is
        // handled separately so we can drop the resulting assembly to
        // Y=0 in the same pass (no need for a follow-up dropToBed call).
        const px = (o.position?.[0] ?? 0) - cx;
        const pz = (o.position?.[2] ?? 0) - cz;
        const py = o.position?.[1] ?? 0;
        const newY = (py - minY) * scaleFactor;
        return {
          ...o,
          position: [px * scaleFactor, newY, pz * scaleFactor],
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

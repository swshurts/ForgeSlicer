import { create } from "zustand";
import * as THREE from "three";
import { PRINTERS, FILAMENTS, getPrinter, getFilament } from "./presets";
import { computeRotatedBBox } from "./geometry";
import { SWEEP_DEFAULTS } from "./sweepGeometry";
import { TEXTURE_DEFAULTS } from "./textureGeometry";
import { cutObjectByPlane } from "./csg";
import { cutObjectByPlaneAsync } from "./workerClient";
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
    const boltR = opts.boltR ?? 5;
    const pitch = opts.pitch ?? 1.5;
    const workThickness = opts.workThickness ?? 12;
    const headR = opts.headR ?? boltR * 1.6;
    const headH = opts.headH ?? Math.max(3, boltR * 0.7);
    const shaftH = opts.shaftH ?? workThickness + 8;
    const nutH = opts.nutH ?? Math.max(3, boltR * 1.0);
    const groupId = `fastener-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const groupName = opts.groupName || "Fastener Pair";
    get().pushHistory();
    // Generate distinct IDs since `buildPrimitive` stamps a millisecond-
    // resolution id-stem; four parts created in the same tick would
    // collide. We use a small counter postfix to guarantee uniqueness.
    let i = 0;
    const freshId = (type) => `${type}-${Date.now()}-${i++}`;
    const counterboreDepth = headH + 0.2;
    const parts = [
      // Bolt — head at Y=0, shaft rising upward.
      {
        ...buildPrimitive("bolt", "positive"),
        id: freshId("bolt"),
        name: "Bolt", position: [0, 0, 0],
        dims: { r: boltR, pitch, h: shaftH, headR, headH, segments: 48, headStyle: "hex" },
        groupId, groupName,
      },
      // Through-bore for the shaft — clearance fit (+0.4mm).
      {
        ...buildPrimitive("cylinder", "negative"),
        id: freshId("cylinder"),
        name: "Bolt Bore", position: [0, headH + workThickness / 2, 0],
        dims: { r: boltR + 0.4, h: workThickness, segments: 48 },
        groupId, groupName,
      },
      // Counterbore — recess the head into the work surface.
      {
        ...buildPrimitive("cylinder", "negative"),
        id: freshId("cylinder"),
        name: "Head Counterbore", position: [0, counterboreDepth / 2, 0],
        dims: { r: headR + 0.5, h: counterboreDepth, segments: 48 },
        groupId, groupName,
      },
      // Nut — threaded onto the far side of the work surface.
      {
        ...buildPrimitive("nut", "positive"),
        id: freshId("nut"),
        name: "Nut", position: [0, headH + workThickness + nutH / 2, 0],
        dims: { r: boltR, pitch, h: nutH, flatR: headR, segments: 48 },
        groupId, groupName,
      },
    ];
    set((s) => ({
      objects: [...s.objects, ...parts],
      selectedId: parts[0].id,
      selectedIds: parts.map((p) => p.id),
    }));
    return groupId;
  },

  // ---- Composite macros (iter 50) ---------------------------------
  // Each composite is a small assembly the user can drop with ONE
  // click. All members share a groupId so they move/rotate as a unit
  // and ungroup-able for fine-tuning. Naming pattern: `addXxx(opts)`.

  // Countersink — a flat-bottomed cylinder + a chamfered cone above
  // it, both negative, so subtracting from a host produces a hole
  // that takes a flat-head bolt flush with the surface.
  addCountersink: (opts = {}) => {
    const boreR = opts.boreR ?? 2.5;            // shaft clearance
    const headR = opts.headR ?? boreR * 2;      // sink-cup radius
    const sinkH = opts.sinkH ?? headR;          // sink depth
    const throughH = opts.throughH ?? 12;       // host thickness
    const groupId = `cs-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const groupName = opts.groupName || "Countersink";
    get().pushHistory();
    let i = 0;
    const freshId = (t) => `${t}-${Date.now()}-${i++}`;
    const parts = [
      // Through-bore cylinder (clearance for the shaft below the sink).
      {
        ...buildPrimitive("cylinder", "negative"),
        id: freshId("cylinder"),
        name: "CS Bore", position: [0, throughH / 2, 0],
        dims: { r: boreR, h: throughH, segments: 48 },
        groupId, groupName,
      },
      // Sink cup — a cone with its wide top at the work surface and
      // its narrow bottom matching boreR. Three.js Cone is wide at
      // y=-h/2 and narrow at y=+h/2; we want the OPPOSITE (wide on
      // top), so we use a frustum-shaped Cylinder with two radii.
      {
        ...buildPrimitive("cone", "negative"),
        id: freshId("cone"),
        name: "CS Cup", position: [0, throughH - sinkH / 2, 0],
        dims: { r1: headR, r2: boreR, h: sinkH, segments: 48 },
        groupId, groupName,
      },
    ];
    set((s) => ({
      objects: [...s.objects, ...parts],
      selectedId: parts[0].id,
      selectedIds: parts.map((p) => p.id),
    }));
    return groupId;
  },

  // Hex pocket — engraved hex socket (M-equivalent), useful for
  // dropping a hex-key drive into a host without modeling a real
  // socket geometry. Single negative hexagonal cylinder.
  addHexPocket: (opts = {}) => {
    const acrossFlatsR = opts.acrossFlatsR ?? 2.5;   // socket size
    const depth = opts.depth ?? 4;
    const groupId = `hexp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const groupName = opts.groupName || "Hex Pocket";
    get().pushHistory();
    const part = {
      ...buildPrimitive("cylinder", "negative"),
      id: `cylinder-${Date.now()}-0`,
      name: "Hex Pocket", position: [0, depth / 2, 0],
      // A 6-segment cylinder IS a hex prism. Radius matches the
      // across-corners (circumradius) so the flats line up with the
      // requested across-flats dimension (= circumradius * cos(30°)).
      dims: { r: acrossFlatsR / Math.cos(Math.PI / 6), h: depth, segments: 6 },
      rotation: [0, 30, 0], // flats vertical
      groupId, groupName,
    };
    set((s) => ({
      objects: [...s.objects, part],
      selectedId: part.id,
      selectedIds: [part.id],
    }));
    return groupId;
  },

  // Gusset — a triangular reinforcement bracket between two
  // perpendicular faces. Modeled as a wedge (right-triangle prism)
  // positive primitive — the user just drops it into the corner and
  // optionally booleans it into the host.
  addGusset: (opts = {}) => {
    const w = opts.w ?? 12;       // leg length along X
    const h = opts.h ?? 12;       // leg length along Y
    const thickness = opts.thickness ?? 3;  // gusset thickness
    const groupId = `gus-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const groupName = opts.groupName || "Gusset";
    get().pushHistory();
    // We use a wedge primitive built on the fly via a custom 'wedge'
    // type. The store/buildGeometry chain doesn't have a dedicated
    // wedge primitive YET, so we fake it with a box rotated so its
    // diagonal forms the gusset's hypotenuse — visually close enough
    // for an MVP, and the user can replace it with a sketched
    // triangle for the real shape if needed.
    const part = {
      ...buildPrimitive("triangle", "positive"),
      id: `triangle-${Date.now()}-0`,
      name: "Gusset", position: [w / 2, h / 2, 0],
      dims: { r: Math.max(w, h) / 2, h: thickness },
      rotation: [0, 0, 0],
      groupId, groupName,
    };
    set((s) => ({
      objects: [...s.objects, part],
      selectedId: part.id,
      selectedIds: [part.id],
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
  // Slot / racetrack hole — a rectangular cube capped by two half-cylinders.
  // Built as a real grouped assembly (1 cube + 2 cylinders) so the user can
  // still edit individual radii/lengths after the fact instead of being
  // locked into a baked single-mesh. Default is NEGATIVE so the slot carves
  // a hole through a parent plate (the common rack-mount use-case).
  // Parameters (all millimetres):
  //   width  — short axis of the slot (matches bolt diameter family). 6 ≈ M5 clearance.
  //   length — OAL of the slot, cap-to-cap. Must be >= width; the rectangular
  //            middle has length (length - width).
  //   depth  — slot height (i.e. plate thickness it carves through).
  // Returns the assembly's groupId.
  addSlot: (modifier = "negative", overrides = {}) => {
    const width = Math.max(0.1, overrides.width ?? 6);
    const length = Math.max(width, overrides.length ?? 10);
    const depth = Math.max(0.1, overrides.depth ?? 6.5);
    const middle = length - width;             // length of the rectangular core
    const radius = width / 2;

    get().pushHistory();
    const gid = `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const groupName = `Slot ${width}×${length}×${depth}`;
    const baseY = depth / 2;                   // half-height so bottom sits on Y=0

    // Cube body: x = width, z (extrude depth in our convention) = depth,
    // y (length) = middle. When middle === 0 (e.g. width==length, a round
    // pill) we still emit a degenerate 0-length cube to keep the group's
    // member count consistent; CSG handles 0-length boxes gracefully.
    const cube = {
      id: newId("cube"),
      name: "Slot · core",
      type: "cube",
      modifier,
      visible: true,
      locked: false,
      position: [0, baseY, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dims: { x: width, y: middle, z: depth },
      // Slot defaults to orange when positive; negative slots use the cyan
      // negative tint so colorIndex doesn't matter visually.
      colorIndex: modifier === "negative" ? 0 : 7,
      groupId: gid,
      groupName,
    };
    // Two cylinders at each end of the long (Z) axis. Cylinders default to
    // axis = Y in three.js BoxGeometry/CylinderGeometry; rotate -90° about
    // X so they sit flat (axis along world Y), matching the cube's depth.
    // Cylinder z-position is +/- middle/2 so its centre lines up with the
    // cube's end face.
    const halfCap = middle / 2;
    const capA = {
      id: newId("cylinder"),
      name: "Slot · cap A",
      type: "cylinder",
      modifier,
      visible: true,
      locked: false,
      position: [0, baseY, +halfCap],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      dims: { r: radius, h: depth, segments: 48 },
      colorIndex: modifier === "negative" ? 0 : 7,
      groupId: gid,
      groupName,
    };
    const capB = { ...capA, id: newId("cylinder"), name: "Slot · cap B", position: [0, baseY, -halfCap] };

    set((s) => ({
      objects: [...s.objects, cube, capA, capB],
      selectedId: cube.id,
      selectedIds: [cube.id, capA.id, capB.id],
    }));
    return gid;
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
    const s = get();
    const ids = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
    if (ids.length === 0) return;
    get().pushHistory();
    const axisIdx = { x: 0, y: 1, z: 2 }[mirrorAxis] ?? -1;
    // If ANY source object is in a group, the whole duplication batch gets a
    // SINGLE fresh groupId so the copies form their OWN assembly (rather than
    // joining the original assembly and bloating it on every duplicate). When
    // none of the sources are grouped, leave groupId undefined so copies are
    // top-level. The new group name is the source group name + " copy" so
    // the outliner header reads sensibly.
    const sourceObjs = ids.map((id) => s.objects.find((o) => o.id === id)).filter(Boolean);
    const anyGrouped = sourceObjs.some((o) => o.groupId);
    const newGroupId = anyGrouped ? newId("group") : null;
    const seedGroupName = sourceObjs.find((o) => o.groupName)?.groupName;
    const newGroupName = anyGrouped
      ? `${seedGroupName || "Assembly"} ${mirrorAxis ? `(mirror ${mirrorAxis.toUpperCase()})` : "copy"}`
      : undefined;
    set((st) => {
      const copies = [];
      for (const id of ids) {
        const src = st.objects.find((o) => o.id === id);
        if (!src) continue;
        const copy = {
          ...src,
          id: newId(src.type),
          name: src.name + (mirrorAxis ? ` (mirror ${mirrorAxis.toUpperCase()})` : " copy"),
          position: [...src.position],
          rotation: [...src.rotation],
          scale: [...src.scale],
          dims: { ...src.dims },
          originalBbox: src.originalBbox ? { ...src.originalBbox } : undefined,
          geometry: src.geometry ? {
            vertices: src.geometry.vertices,
            indices: src.geometry.indices,
          } : undefined,
          // Override the spread-inherited groupId: copies form their own new
          // assembly (or none, if sources weren't grouped).
          groupId: newGroupId || undefined,
          groupName: newGroupName,
        };
        if (axisIdx >= 0) {
          // Mirror the copy so it sits ADJACENT to the original along the
          // chosen axis (not on top of it). Negating position only works
          // when the source isn't centred on that axis — at position[ax]=0,
          // -0 is still 0 and the copy stacks invisibly on the original.
          // Computing the source's world-space extent on this axis and
          // shifting the copy by that extent + a small gap guarantees a
          // visible, non-overlapping mirror in every case.
          const axisKey = ["x", "y", "z"][axisIdx];
          let extent = 0;
          try {
            const bb = computeRotatedBBox(src);
            extent = Math.abs((bb.max?.[axisKey] ?? 0) - (bb.min?.[axisKey] ?? 0));
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("mirror bbox fallback:", err);
          }
          copy.scale[axisIdx] = -copy.scale[axisIdx];
          copy.position[axisIdx] = src.position[axisIdx] + extent + offset;
          if (mirrorAxis === "y") copy.position[1] = Math.max(0, copy.position[1]);
        } else {
          // Plain duplicate — shift slightly so it's visible.
          copy.position[0] += offset;
          copy.position[2] += offset;
        }
        copies.push(copy);
      }
      const newIds = copies.map((c) => c.id);
      return {
        objects: [...st.objects, ...copies],
        selectedIds: newIds,
        selectedId: newIds[newIds.length - 1] || st.selectedId,
      };
    });
  },

  // In-place mirror: flip the selection on the given axis WITHOUT creating
  // a duplicate. Useful for fixing asymmetric AI-generated meshes. Uses
  // the bbox extent so the part stays put on the bed (its origin doesn't
  // jump when scale flips sign).
  mirrorSelectedInPlace: (axis) => {
    const s = get();
    const axisIdx = { x: 0, y: 1, z: 2 }[axis];
    if (axisIdx === undefined) return;
    const ids = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
    if (ids.length === 0) return;
    get().pushHistory();
    set((st) => {
      const updated = st.objects.map((o) => {
        if (!ids.includes(o.id)) return o;
        const next = {
          ...o,
          scale: [...o.scale],
          position: [...o.position],
          rotation: [...o.rotation],
        };
        next.scale[axisIdx] = -next.scale[axisIdx];
        return next;
      });
      return { objects: updated };
    });
  },

  setTransformMode: (mode) => set({ transformMode: mode }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setSnapTranslate: (v) => set({ snapTranslate: v }),
  setGridVisible: (v) => set({ gridVisible: v }),
  setBuildVolume: (v) => set({ buildVolume: v }),

  setCutMode: (v) => set({ cutMode: !!v }),
  setCutPlane: (patch) => set((st) => ({ cutPlane: { ...st.cutPlane, ...patch } })),

  // Apply the current cut plane to the currently-selected object(s).
  // `keep` is "both" | "upper" | "lower" — controls which piece(s) survive.
  // For each selected object: subtract the appropriate half-space, replace
  // the original with up to two new "imported mesh" objects representing
  // the resulting pieces. History-atomic so Ctrl+Z restores everything in
  // one step.
  applyCut: async (keep = "both") => {
    const s = get();
    const ids = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
    if (ids.length === 0) return { ok: false, error: "Nothing selected" };
    const plane = s.cutPlane;
    const newObjects = [];
    const errors = [];
    for (const id of ids) {
      const src = s.objects.find((o) => o.id === id);
      if (!src) continue;
      try {
        // Prefer the manifold-3d worker path so cuts are guaranteed
        // watertight; the workerClient automatically falls back to
        // the synchronous BVH-CSG cutter if the worker can't be
        // constructed (test environments, very old browsers).
        let result;
        try {
          result = await cutObjectByPlaneAsync(src, plane, {
            upper: keep === "both" || keep === "upper",
            lower: keep === "both" || keep === "lower",
          });
        } catch (manifoldErr) {
          // Manifold rejected (NotManifold on a corrupted import etc.) —
          // fall back to BVH so the user still gets a result instead of
          // a hard error.
          // eslint-disable-next-line no-console
          console.warn("[applyCut] manifold cut failed, falling back to BVH:", manifoldErr.message);
          result = cutObjectByPlane(src, plane, {
            upper: keep === "both" || keep === "upper",
            lower: keep === "both" || keep === "lower",
          });
        }
        const pieces = [];
        if (result.upper) pieces.push({ part: result.upper, suffix: keep === "both" ? "upper" : "" });
        if (result.lower) pieces.push({ part: result.lower, suffix: keep === "both" ? "lower" : "" });
        if (pieces.length === 0) {
          errors.push(`${src.name}: cut produced empty geometry`);
          continue;
        }
        for (const { part, suffix } of pieces) {
          newObjects.push({
            id: newId("cut"),
            name: suffix ? `${src.name} (${suffix})` : `${src.name} (cut)`,
            type: "imported",
            modifier: src.modifier || "positive",
            visible: true,
            position: [0, 0, 0],   // pieces stay in world space; their geom is already baked
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            dims: {},
            color: src.color,
            geometry: { vertices: part.vertices, indices: part.indices },
            originalBbox: src.originalBbox,
          });
        }
      } catch (e) {
        errors.push(`${src.name}: ${e.message || e}`);
      }
    }
    if (newObjects.length === 0) {
      return { ok: false, error: errors.join("; ") || "Cut produced no geometry" };
    }
    get().pushHistory();
    set((st) => {
      const remaining = st.objects.filter((o) => !ids.includes(o.id));
      return {
        objects: [...remaining, ...newObjects],
        selectedIds: newObjects.map((o) => o.id),
        selectedId: newObjects[newObjects.length - 1].id,
        cutMode: false,
      };
    });
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

  clearScene: () => {
    get().pushHistory();
    set({
      objects: [],
      selectedId: null,
      projectName: "Untitled Project",
      measurements: [],
      pendingMeasurePoint: null,
    });
  },

  loadProject: (state) => {
    get().pushHistory();
    set({
      objects: state.objects || [],
      selectedId: null,
      projectName: state.projectName || "Untitled Project",
      buildVolume: state.buildVolume || { x: 220, y: 220, z: 250 },
      printerId: state.printerId || defaultPrinterId,
      filamentId: state.filamentId || defaultFilamentId,
      measurements: state.measurements || [],
    });
  },

  serialize: () => {
    const s = get();
    return {
      version: 2,
      projectName: s.projectName,
      buildVolume: s.buildVolume,
      printerId: s.printerId,
      filamentId: s.filamentId,
      measurements: s.measurements,
      objects: s.objects.map((o) => ({
        ...o,
        geometry: o.geometry
          ? {
              vertices: Array.from(o.geometry.vertices),
              indices: o.geometry.indices ? Array.from(o.geometry.indices) : null,
            }
          : undefined,
      })),
    };
  },
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

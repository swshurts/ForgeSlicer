import { create } from "zustand";
import { PRINTERS, FILAMENTS, getPrinter, getFilament } from "./presets";
import { computeRotatedBBox } from "./geometry";
import { cutObjectByPlane } from "./csg";

const PRIMITIVE_DEFAULTS = {
  cube:     { dims: { x: 20, y: 20, z: 20 } },
  sphere:   { dims: { r: 12, segments: 48 } },
  cylinder: { dims: { r: 10, h: 24, segments: 64 } },
  cone:     { dims: { r: 10, h: 24, segments: 64 } },
  torus:    { dims: { r: 14, tube: 4, segments: 48 } },
  // ---- 2D shapes ----
  // Stored as thin extrusions (h = 1 mm by default — a "2D wafer").
  // The Extrude action in the inspector promotes them to 3D parts by
  // bumping h to whatever depth the user wants.
  circle:   { dims: { r: 10, h: 1 } },
  square2d: { dims: { side: 20, h: 1 } },
  triangle: { dims: { r: 12, h: 1 } },
  polygon:  { dims: { r: 12, sides: 6, h: 1 } },
};

let nextId = 1;
const newId = (type) => `${type}-${Date.now()}-${nextId++}`;

const buildPrimitive = (type, modifier = "positive", overrides = {}) => {
  const def = PRIMITIVE_DEFAULTS[type] || PRIMITIVE_DEFAULTS.cube;
  return {
    id: newId(type),
    name: `${type[0].toUpperCase() + type.slice(1)}`,
    type,
    modifier,
    visible: true,
    locked: false,
    position: [0, (def.dims.z || def.dims.h || def.dims.r) / 2 || 10, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dims: { ...def.dims },
    // Default a positive primitive to slot 7 (Orange) so the historical
    // ForgeSlicer-house-orange look is preserved; negatives use the cyan
    // outline so colorIndex is moot for them. Picking slot 0 (White) in the
    // inspector now renders accurately as White.
    colorIndex: modifier === "negative" ? 0 : 7,
    ...overrides,
  };
};

// Deep clone helper. Preserves typed arrays for imported geometry.
const cloneObjects = (objects) =>
  objects.map((o) => ({
    ...o,
    position: [...o.position],
    rotation: [...o.rotation],
    scale: [...o.scale],
    dims: { ...o.dims },
    originalBbox: o.originalBbox ? { ...o.originalBbox } : undefined,
    geometry: o.geometry
      ? {
          vertices: o.geometry.vertices, // shared reference (immutable in store)
          indices: o.geometry.indices,
        }
      : undefined,
  }));

const HISTORY_LIMIT = 60;

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
    const snap = cloneObjects(s.objects);
    const next = [...s.history, snap];
    if (next.length > HISTORY_LIMIT) next.shift();
    set({ history: next, redoStack: [] });
  },

  undo: () => {
    const s = get();
    if (s.history.length === 0) return;
    const last = s.history[s.history.length - 1];
    const cur = cloneObjects(s.objects);
    set({
      objects: last,
      history: s.history.slice(0, -1),
      redoStack: [...s.redoStack, cur],
      selectedId: null,
      selectedIds: [],
    });
  },

  redo: () => {
    const s = get();
    if (s.redoStack.length === 0) return;
    const next = s.redoStack[s.redoStack.length - 1];
    const cur = cloneObjects(s.objects);
    set({
      objects: next,
      redoStack: s.redoStack.slice(0, -1),
      history: [...s.history, cur],
      selectedId: null,
      selectedIds: [],
    });
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
    if (!delta || delta.every((v) => Math.abs(v) < 1e-6)) return;
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        ids.includes(o.id)
          ? { ...o, position: [o.position[0] + delta[0], o.position[1] + delta[1], o.position[2] + delta[2]] }
          : o
      ),
    }));
  },
  rotateSelected: (delta) => {
    const ids = get().selectedIds.length ? get().selectedIds : (get().selectedId ? [get().selectedId] : []);
    if (ids.length === 0) return;
    if (!delta || delta.every((v) => Math.abs(v) < 1e-6)) return;
    get().pushHistory();
    set((s) => ({
      objects: s.objects.map((o) =>
        ids.includes(o.id)
          ? { ...o, rotation: [o.rotation[0] + delta[0], o.rotation[1] + delta[1], o.rotation[2] + delta[2]] }
          : o
      ),
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
  applyCut: (keep = "both") => {
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
        const result = cutObjectByPlane(src, plane, {
          upper: keep === "both" || keep === "upper",
          lower: keep === "both" || keep === "lower",
        });
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

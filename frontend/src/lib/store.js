import { create } from "zustand";
import { PRINTERS, FILAMENTS, getPrinter, getFilament } from "./presets";
import { computeRotatedBBox } from "./geometry";

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
    colorIndex: 0,
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
  autoDropOnRotate: true,

  // ---- measurement ----
  measureMode: false,
  measurements: [], // [{id, a:[x,y,z], b:[x,y,z], objIdA, objIdB}]
  pendingMeasurePoint: null,
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
  setAutoDropOnRotate: (v) => set({ autoDropOnRotate: v }),
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
    const obj = buildPrimitive(type, modifier);
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id, selectedIds: [obj.id] }));
    return obj.id;
  },

  addImportedMesh: (name, vertices, indices = null, originalBbox = null) => {
    get().pushHistory();
    const obj = {
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
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id, selectedIds: [obj.id] }));
    return obj.id;
  },

  addRawObject: (obj) => {
    get().pushHistory();
    const withId = { ...obj, id: obj.id || newId(obj.type || "mesh") };
    set((s) => ({ objects: [...s.objects, withId], selectedId: withId.id, selectedIds: [withId.id] }));
    return withId.id;
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
    } catch (e) {
      // ignore — geometry may not be ready
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
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, dims: { ...o.dims, ...dimsPatch } } : o
      ),
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

  // selectObject:
  //   - default (no `mode`): single-selection — replaces the set with [id]
  //   - mode='toggle' (Ctrl/Cmd-click): adds id if absent, removes if present
  //   - mode='add'    (Shift-click)   : adds id if absent (range select TODO)
  selectObject: (id, mode = null) => {
    set((s) => {
      if (id === null) return { selectedId: null, selectedIds: [] };
      if (!mode) return { selectedId: id, selectedIds: [id] };
      const current = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
      const has = current.includes(id);
      let next;
      if (mode === "toggle") {
        next = has ? current.filter((x) => x !== id) : [...current, id];
      } else {
        // 'add'
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
        };
        if (axisIdx >= 0) {
          // Mirror about the origin plane of that axis. Negative scale flips
          // the geometry; flipping position keeps the copy "across" from the
          // original. For Y mirrors we additionally clamp to the build plate
          // afterwards so the mirrored copy doesn't end up underground.
          copy.scale[axisIdx] = -copy.scale[axisIdx];
          copy.position[axisIdx] = -copy.position[axisIdx];
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

  setTransformMode: (mode) => set({ transformMode: mode }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setSnapTranslate: (v) => set({ snapTranslate: v }),
  setGridVisible: (v) => set({ gridVisible: v }),
  setBuildVolume: (v) => set({ buildVolume: v }),

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
  nozzleTemp: 210,
  bedTemp: 60,
  retraction: 1.0,
  set: (patch) => set(patch),
}));

export { PRINTERS, FILAMENTS };

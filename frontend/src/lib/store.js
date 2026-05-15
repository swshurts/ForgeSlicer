import { create } from "zustand";
import { PRINTERS, FILAMENTS, getPrinter, getFilament } from "./presets";
import { computeRotatedBBox } from "./geometry";

const PRIMITIVE_DEFAULTS = {
  cube:     { dims: { x: 20, y: 20, z: 20 } },
  sphere:   { dims: { r: 12, segments: 48 } },
  cylinder: { dims: { r: 10, h: 24, segments: 64 } },
  cone:     { dims: { r: 10, h: 24, segments: 64 } },
  torus:    { dims: { r: 14, tube: 4, segments: 48 } },
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
  selectedId: null,
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
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id }));
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
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id }));
    return obj.id;
  },

  addRawObject: (obj) => {
    get().pushHistory();
    const withId = { ...obj, id: obj.id || newId(obj.type || "mesh") };
    set((s) => ({ objects: [...s.objects, withId], selectedId: withId.id }));
    return withId.id;
  },

  removeObject: (id) => {
    get().pushHistory();
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      measurements: s.measurements.filter((m) => m.objIdA !== id && m.objIdB !== id),
      pendingMeasurePoint:
        s.pendingMeasureObjId === id ? null : s.pendingMeasurePoint,
      pendingMeasureObjId:
        s.pendingMeasureObjId === id ? null : s.pendingMeasureObjId,
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
      return { objects: [...s.objects, copy], selectedId: copy.id };
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

  selectObject: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),

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

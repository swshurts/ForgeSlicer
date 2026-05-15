import { create } from "zustand";

const PRIMITIVE_DEFAULTS = {
  cube:     { dims: { x: 20, y: 20, z: 20 } },
  sphere:   { dims: { r: 12, segments: 32 } },
  cylinder: { dims: { r: 10, h: 24, segments: 32 } },
  cone:     { dims: { r: 10, h: 24, segments: 32 } },
  torus:    { dims: { r: 14, tube: 4, segments: 24 } },
};

let nextId = 1;
const newId = (type) => `${type}-${Date.now()}-${nextId++}`;

const buildPrimitive = (type, modifier = "positive", overrides = {}) => {
  const def = PRIMITIVE_DEFAULTS[type] || PRIMITIVE_DEFAULTS.cube;
  return {
    id: newId(type),
    name: `${type[0].toUpperCase() + type.slice(1)}`,
    type,
    modifier,         // 'positive' | 'negative'
    visible: true,
    locked: false,
    position: [0, (def.dims.z || def.dims.h || def.dims.r) / 2 || 10, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dims: { ...def.dims },
    ...overrides,
  };
};

export const useScene = create((set, get) => ({
  objects: [],
  selectedId: null,
  transformMode: "translate", // translate | rotate | scale
  snapEnabled: true,
  snapTranslate: 1,    // mm
  snapRotate: 15,      // degrees
  snapScale: 0.1,
  gridVisible: true,
  buildVolume: { x: 220, y: 220, z: 250 },
  projectName: "Untitled Project",

  // ---------- mutations ----------
  setProjectName: (name) => set({ projectName: name }),

  addPrimitive: (type, modifier = "positive") => {
    const obj = buildPrimitive(type, modifier);
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id }));
    return obj.id;
  },

  addImportedMesh: (name, vertices, indices = null) => {
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
      geometry: { vertices, indices }, // Float32Array, Uint32Array|null
    };
    set((s) => ({ objects: [...s.objects, obj], selectedId: obj.id }));
    return obj.id;
  },

  addRawObject: (obj) => {
    const withId = { ...obj, id: obj.id || newId(obj.type || "mesh") };
    set((s) => ({ objects: [...s.objects, withId], selectedId: withId.id }));
    return withId.id;
  },

  removeObject: (id) =>
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  duplicateObject: (id) =>
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
    }),

  updateObject: (id, patch) =>
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    })),

  updateDims: (id, dimsPatch) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, dims: { ...o.dims, ...dimsPatch } } : o
      ),
    })),

  setTransform: (id, key, value) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, [key]: value } : o
      ),
    })),

  toggleVisible: (id) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, visible: !o.visible } : o
      ),
    })),

  toggleLocked: (id) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, locked: !o.locked } : o
      ),
    })),

  flipModifier: (id) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id
          ? { ...o, modifier: o.modifier === "positive" ? "negative" : "positive" }
          : o
      ),
    })),

  selectObject: (id) => set({ selectedId: id }),
  clearSelection: () => set({ selectedId: null }),

  setTransformMode: (mode) => set({ transformMode: mode }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setSnapTranslate: (v) => set({ snapTranslate: v }),
  setGridVisible: (v) => set({ gridVisible: v }),
  setBuildVolume: (v) => set({ buildVolume: v }),

  clearScene: () =>
    set({ objects: [], selectedId: null, projectName: "Untitled Project" }),

  loadProject: (state) =>
    set({
      objects: state.objects || [],
      selectedId: null,
      projectName: state.projectName || "Untitled Project",
      buildVolume: state.buildVolume || { x: 220, y: 220, z: 250 },
    }),

  serialize: () => {
    const s = get();
    return {
      version: 1,
      projectName: s.projectName,
      buildVolume: s.buildVolume,
      objects: s.objects.map((o) => ({
        ...o,
        // strip non-serializable Float32Array if any -> convert to plain arrays
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
  printSpeed: 60,         // mm/s
  travelSpeed: 120,
  perimeters: 2,
  infillPercent: 15,
  nozzleTemp: 210,
  bedTemp: 60,
  retraction: 1.0,
  set: (patch) => set(patch),
}));

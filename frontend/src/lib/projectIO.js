// Project I/O helpers — `.forge.json` serialise / deserialise / empty.
//
// Extracted from `lib/store.js` so the store reducer stays small and the
// I/O logic can be unit-tested without the zustand store. These functions
// are PURE — they take and return plain JS data, no side effects, no
// `get()`/`set()`. The store delegates by passing in its current state
// (for serialise) or by spreading the returned partial state (for load
// and empty).
//
// Format versions
// ---------------
//   v1 — original (objects + buildVolume only)
//   v2 — adds projectName + printerId + filamentId + measurements
//
// componentDimensions are NOT persisted in v2 — they're workspace
// annotations, not part of the model. Same reasoning as Blender: when you
// load a .blend file, your viewport dimension overlays do not survive.

const DEFAULT_BUILD_VOLUME = { x: 220, y: 220, z: 250 };
const DEFAULT_PROJECT_NAME = "Untitled Project";

/**
 * Serialise the scene to a plain JSON-safe project object. The caller
 * (store.serialize) passes its full state in; we project only the fields
 * we care about, and convert typed arrays to plain arrays so JSON.stringify
 * doesn't lose precision or barf on Float32Array.
 */
export function serializeProject(state) {
  return {
    version: 3,
    projectName: state.projectName,
    buildVolume: state.buildVolume,
    printerId: state.printerId,
    filamentId: state.filamentId,
    measurements: state.measurements,
    // Pinned ruler measurements survive save/load — they're part of the
    // designer's documentation, not just transient workspace state.
    // Live anchor/target are intentionally NOT persisted (those are
    // mid-action workflow state).
    pinnedRulerDims: state.pinnedRulerDims || [],
    objects: state.objects.map((o) => ({
      ...o,
      geometry: o.geometry
        ? {
            vertices: Array.from(o.geometry.vertices),
            indices: o.geometry.indices ? Array.from(o.geometry.indices) : null,
          }
        : undefined,
    })),
  };
}

/**
 * Return the partial state to spread onto the store when loading a
 * project file. Defensive defaults so an older .forge.json missing
 * newer fields still loads cleanly. `defaults` carries the printer/filament
 * fallback ids resolved at store construction time (different builds
 * may default to different printer profiles).
 */
export function loadProjectState(state, defaults = {}) {
  return {
    objects: state.objects || [],
    selectedId: null,
    selectedIds: [],
    projectName: state.projectName || DEFAULT_PROJECT_NAME,
    buildVolume: state.buildVolume || DEFAULT_BUILD_VOLUME,
    printerId: state.printerId || defaults.printerId,
    filamentId: state.filamentId || defaults.filamentId,
    measurements: state.measurements || [],
    // Workspace-only annotations — reset on load.
    componentDimensions: [],
    pendingDimensionFromId: null,
    pendingMeasurePoint: null,
    pendingMeasureObjId: null,
    rulerAnchor: null,
    rulerTarget: null,
    // Pinned ruler dims DO survive save/load (designer's documentation).
    pinnedRulerDims: state.pinnedRulerDims || [],
    // Hierarchical-project linkage. `loadProject` is also used by the
    // Project Explorer's "Open" action which passes these through; for
    // legacy `.forge.json` files there's no linkage, so default to
    // null and let the breadcrumb stay hidden.
    currentProjectId: state.currentProjectId || null,
    currentProjectName: state.currentProjectName || null,
  };
}

/**
 * Return the partial state for a brand-new empty scene (used by clearScene).
 * Preserves the active printer/filament so the user doesn't lose their
 * machine setup when they start a fresh design.
 */
export function emptyProjectState() {
  return {
    objects: [],
    selectedId: null,
    selectedIds: [],
    projectName: DEFAULT_PROJECT_NAME,
    measurements: [],
    pendingMeasurePoint: null,
    pendingMeasureObjId: null,
    componentDimensions: [],
    pendingDimensionFromId: null,
    rulerAnchor: null,
    rulerTarget: null,
    pinnedRulerDims: [],
    // Clearing the scene detaches it from any hierarchical project so
    // the breadcrumb collapses.
    currentProjectId: null,
    currentProjectName: null,
  };
}

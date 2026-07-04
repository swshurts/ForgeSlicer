// Browser-side slicer engine registry.
//
// ForgeSlicer stays browser-first: the React app chooses an engine,
// prepares STL/3MF/profile payloads, then calls a backend/sidecar adapter.
// Today only the built-in JS slicer and server Orca adapter are runnable.
// Prusa/Elegoo/Bambu-local entries live here as explicit future targets so
// routing logic can be developed without scattering vendor checks in UI code.

export const SLICER_ENGINE_IDS = {
  BUILTIN: "builtin",
  ORCA: "orca",
  PRUSA: "prusa",
  ELEGOO: "elegoo",
  BAMBU_LOCAL: "bambu-local",
};

export const SLICER_ENGINES = [
  {
    id: SLICER_ENGINE_IDS.BUILTIN,
    label: "Built-in",
    description: "Fast, runs in your browser. Single perimeter, simple infills.",
    locationLabel: "in-browser",
    implemented: true,
    visibleInPicker: true,
    nativeFamilies: ["generic", "flashforge"],
  },
  {
    id: SLICER_ENGINE_IDS.ORCA,
    label: "OrcaSlicer",
    description: "Production-quality. Multi-perimeter walls, all infill patterns, supports, AMS.",
    locationLabel: "server-side",
    implemented: true,
    visibleInPicker: true,
    nativeFamilies: ["orca", "bambu", "generic"],
    requiresStatusKey: "orcaReady",
  },
  {
    id: SLICER_ENGINE_IDS.PRUSA,
    label: "PrusaSlicer",
    description: "Planned external PrusaSlicer adapter for native Prusa GCODE.",
    locationLabel: "planned",
    implemented: false,
    visibleInPicker: false,
    nativeFamilies: ["prusa"],
  },
  {
    id: SLICER_ENGINE_IDS.ELEGOO,
    label: "ElegooSlicer",
    description: "Planned external ElegooSlicer adapter for native Elegoo GCODE.",
    locationLabel: "planned",
    implemented: false,
    visibleInPicker: false,
    nativeFamilies: ["elegoo"],
  },
  {
    id: SLICER_ENGINE_IDS.BAMBU_LOCAL,
    label: "Bambu local",
    description: "Reserved for the reviewed non-cloud Bambu slicer adapter; Orca remains the current Bambu route.",
    locationLabel: "reserved",
    implemented: false,
    visibleInPicker: false,
    nativeFamilies: ["bambu"],
    sourceUrl: "https://github.com/swshurts/Bambu_Slicer",
  },
];

export function getSlicerEngine(engineId) {
  return SLICER_ENGINES.find((engine) => engine.id === engineId) || null;
}

export function isSlicerEngineAvailable(engineId, status = {}) {
  const engine = getSlicerEngine(engineId);
  if (!engine || !engine.implemented) return false;
  if (engine.requiresStatusKey) return status[engine.requiresStatusKey] === true;
  return true;
}

export function getSelectableSlicerEngines(status = {}, { includeFuture = false } = {}) {
  return SLICER_ENGINES
    .filter((engine) => engine.visibleInPicker || includeFuture)
    .map((engine) => ({
      ...engine,
      available: isSlicerEngineAvailable(engine.id, status),
    }));
}

export function normalizePrinterFamily(printerIdOrName) {
  const value = String(printerIdOrName || "").toLowerCase();
  if (!value || value === "custom") return "generic";
  if (value.includes("bambu") || value.includes("bbl")) return "bambu";
  if (value.includes("prusa")) return "prusa";
  if (value.includes("elegoo") || value.includes("neptune") || value.includes("centauri")) return "elegoo";
  if (value.includes("flashforge") || value.includes("flash-forge") || value.includes("adventurer")) return "flashforge";
  if (value.includes("orca")) return "orca";
  return "generic";
}

export function getRecommendedSlicerEngineForPrinter(printerIdOrName, opts = {}) {
  const family = normalizePrinterFamily(printerIdOrName);
  if (family === "bambu") {
    return opts.preferBambuLocal ? SLICER_ENGINE_IDS.BAMBU_LOCAL : SLICER_ENGINE_IDS.ORCA;
  }
  if (family === "prusa") return SLICER_ENGINE_IDS.PRUSA;
  if (family === "elegoo") return SLICER_ENGINE_IDS.ELEGOO;
  if (family === "flashforge") return SLICER_ENGINE_IDS.BUILTIN;
  return SLICER_ENGINE_IDS.ORCA;
}

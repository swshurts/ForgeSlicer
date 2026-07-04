import {
  SLICER_ENGINE_IDS,
  getRecommendedSlicerEngineForPrinter,
  getSelectableSlicerEngines,
  isSlicerEngineAvailable,
  normalizePrinterFamily,
} from "./slicerEngines";

describe("slicer engine registry", () => {
  test("current browser picker exposes built-in plus Orca only", () => {
    const engines = getSelectableSlicerEngines({ orcaReady: true });
    expect(engines.map((engine) => engine.id)).toEqual([
      SLICER_ENGINE_IDS.BUILTIN,
      SLICER_ENGINE_IDS.ORCA,
    ]);
    expect(engines.every((engine) => engine.implemented)).toBe(true);
  });

  test("Orca availability follows backend status while built-in is always available", () => {
    expect(isSlicerEngineAvailable(SLICER_ENGINE_IDS.BUILTIN, {})).toBe(true);
    expect(isSlicerEngineAvailable(SLICER_ENGINE_IDS.ORCA, { orcaReady: false })).toBe(false);
    expect(isSlicerEngineAvailable(SLICER_ENGINE_IDS.ORCA, { orcaReady: true })).toBe(true);
    expect(isSlicerEngineAvailable(SLICER_ENGINE_IDS.PRUSA, { orcaReady: true })).toBe(false);
  });

  test("normalizes known printer families from ids and names", () => {
    expect(normalizePrinterFamily("bambu_a1")).toBe("bambu");
    expect(normalizePrinterFamily("Original Prusa MK4")).toBe("prusa");
    expect(normalizePrinterFamily("elegoo-neptune-4-pro")).toBe("elegoo");
    expect(normalizePrinterFamily("flashforge-adventurer5m")).toBe("flashforge");
    expect(normalizePrinterFamily("custom")).toBe("generic");
  });

  test("recommends native target engines without enabling unfinished adapters", () => {
    expect(getRecommendedSlicerEngineForPrinter("bambu_x1c")).toBe(SLICER_ENGINE_IDS.ORCA);
    expect(getRecommendedSlicerEngineForPrinter("bambu_x1c", { preferBambuLocal: true })).toBe(SLICER_ENGINE_IDS.BAMBU_LOCAL);
    expect(getRecommendedSlicerEngineForPrinter("prusa_mk4")).toBe(SLICER_ENGINE_IDS.PRUSA);
    expect(getRecommendedSlicerEngineForPrinter("elegoo-centauri-carbon")).toBe(SLICER_ENGINE_IDS.ELEGOO);
    expect(getRecommendedSlicerEngineForPrinter("flashforge-adventurer5m")).toBe(SLICER_ENGINE_IDS.BUILTIN);
    expect(getRecommendedSlicerEngineForPrinter("voron_24_350")).toBe(SLICER_ENGINE_IDS.ORCA);
  });
});

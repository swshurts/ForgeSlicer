/**
 * Vendor-native G-code routing (Option A) — verify that
 * `resolveSystemPresets` returns the correct vendor bundle for
 * every printer we've explicitly routed. Backend `orca_engine.py`
 * consumes these `{vendor, name}` pairs to load the actual
 * OrcaSlicer system preset JSONs, so a typo here means the slice
 * silently falls back to the generic `Custom/MyKlipper` bundle
 * (losing the vendor-specific start/end G-code).
 */
import { resolveSystemPresets, PRINTER_PROFILES } from "./orcaProfiles";

describe("resolveSystemPresets — vendor routing coverage", () => {
  // Bambu keeps full process+filament routing since BBL ships every combo.
  test("Bambu A1 routes to BBL vendor bundle with process + filament suffix", () => {
    const r = resolveSystemPresets("bambu_a1", "standard", "pla");
    expect(r.printer).toEqual({ vendor: "BBL", name: "Bambu Lab A1 0.4 nozzle" });
    expect(r.process).toEqual({ vendor: "BBL", name: "0.20mm Standard @BBL A1" });
    expect(r.filament).toEqual({ vendor: "BBL", name: "Bambu PLA Basic @BBL A1" });
  });

  test("Bambu X1C routes to BBL vendor bundle", () => {
    const r = resolveSystemPresets("bambu_x1c", "fine", "petg");
    expect(r.printer.vendor).toBe("BBL");
    expect(r.printer.name).toBe("Bambu Lab X1 Carbon 0.4 nozzle");
  });

  // Non-BBL vendors: printer preset resolves to vendor bundle, process/filament
  // stay null so the backend uses its fallback chain.
  test("Prusa MK4 routes printer to Prusa vendor bundle, process/filament null", () => {
    const r = resolveSystemPresets("prusa_mk4", "standard", "pla");
    expect(r.printer).toEqual({ vendor: "Prusa", name: "Prusa MK4 0.4 nozzle" });
    expect(r.process).toBeNull();
    expect(r.filament).toBeNull();
  });

  test("Voron 2.4 350 routes to Voron vendor bundle", () => {
    const r = resolveSystemPresets("voron_24_350", "standard", "pla");
    expect(r.printer).toEqual({ vendor: "Voron", name: "Voron 2.4 350 0.4 nozzle" });
    expect(r.process).toBeNull();
  });

  test("Voron 2.4 300 uses the 300mm-specific machine preset", () => {
    const r = resolveSystemPresets("voron_24_300", "standard", "pla");
    expect(r.printer.name).toBe("Voron 2.4 300 0.4 nozzle");
  });

  test("Sovol SV06 / SV07 / SV08 all route to Sovol vendor bundle", () => {
    expect(resolveSystemPresets("sovol_sv06", "standard", "pla").printer)
      .toEqual({ vendor: "Sovol", name: "Sovol SV06 0.4 nozzle" });
    expect(resolveSystemPresets("sovol_sv07", "standard", "pla").printer)
      .toEqual({ vendor: "Sovol", name: "Sovol SV07 0.4 nozzle" });
    expect(resolveSystemPresets("sovol_sv08", "standard", "pla").printer)
      .toEqual({ vendor: "Sovol", name: "Sovol SV08 0.4 nozzle" });
  });

  test("FLSun deltas route to FLSun vendor bundle", () => {
    expect(resolveSystemPresets("flsun_q5", "standard", "pla").printer)
      .toEqual({ vendor: "FLSun", name: "FLSun Q5 0.4 nozzle" });
    expect(resolveSystemPresets("flsun_s1", "standard", "pla").printer)
      .toEqual({ vendor: "FLSun", name: "FLSun S1 0.4 nozzle" });
    // T1 Pro maps to the T1 bundle (Pro is a hardware refresh sharing
    // the base machine config in-slicer).
    expect(resolveSystemPresets("flsun_t1_pro", "standard", "pla").printer.name)
      .toBe("FLSun T1 0.4 nozzle");
  });

  test("Creality Ender-3 routes to Creality vendor bundle", () => {
    const r = resolveSystemPresets("ender_3", "standard", "pla");
    expect(r.printer).toEqual({ vendor: "Creality", name: "Creality Ender-3 0.4 nozzle" });
  });

  test("Elegoo Neptune 4 + Centauri Carbon route to Elegoo vendor bundle", () => {
    expect(resolveSystemPresets("elegoo_neptune_4", "standard", "pla").printer)
      .toEqual({ vendor: "Elegoo", name: "Elegoo Neptune 4 0.4 nozzle" });
    expect(resolveSystemPresets("elegoo_centauri_carbon", "standard", "pla").printer)
      .toEqual({ vendor: "Elegoo", name: "Elegoo Centauri Carbon 0.4 nozzle" });
  });

  test("Unmapped printers (custom, sovol_sv06_plus_ace) return null triple → backend uses raw profile", () => {
    // `custom` is intentionally not routed — user pasted their own JSON.
    const r1 = resolveSystemPresets("custom", "standard", "pla");
    expect(r1.printer).toBeNull();
    expect(r1.process).toBeNull();
    expect(r1.filament).toBeNull();

    // sovol_sv06_plus_ace omitted from routing (not confirmed in
    // upstream tree at time of writing) — falls through cleanly.
    const r2 = resolveSystemPresets("sovol_sv06_plus_ace", "standard", "pla");
    expect(r2.printer).toBeNull();
  });

  test("Elegoo printer entries exist in PRINTER_PROFILES with valid build volumes", () => {
    expect(PRINTER_PROFILES.elegoo_neptune_4).toBeDefined();
    expect(PRINTER_PROFILES.elegoo_neptune_4.profile.printable_height).toBe(265);
    expect(PRINTER_PROFILES.elegoo_centauri_carbon).toBeDefined();
    expect(PRINTER_PROFILES.elegoo_centauri_carbon.profile.gcode_flavor).toBe("klipper");
  });
});

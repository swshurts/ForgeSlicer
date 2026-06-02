/**
 * Iter-81: verify cloneBundledPrinterToUserPayload converts a bundled
 * profile into a `user_printers`-shape payload that the backend can
 * accept via POST /api/me/printers. This is the underpinning of the
 * "Clone to My Printers" Quick-Start UX — without it the user has to
 * manually retype 10 fields just to override Start/End G-code for
 * Klipper macros etc.
 */
import { cloneBundledPrinterToUserPayload, PRINTER_PROFILES } from "./orcaProfiles";

describe("cloneBundledPrinterToUserPayload", () => {
  test("clones Sovol SV06 Plus Ace with Klipper flavour + 300x300x340", () => {
    const out = cloneBundledPrinterToUserPayload("sovol_sv06_plus_ace");
    expect(out).not.toBeNull();
    expect(out.name).toBe("Sovol SV06 Plus Ace (My Copy)");
    expect(out.printer_model).toBe("Sovol SV06 Plus Ace");
    expect(out.nozzle_diameter).toBe(0.4);
    expect(out.build_x_mm).toBe(300);
    expect(out.build_y_mm).toBe(300);
    expect(out.build_z_mm).toBe(340);
    expect(out.gcode_flavor).toBe("klipper");
    expect(out.max_speed_x).toBe(500);
    expect(out.start_gcode).toBe("");
    expect(out.end_gcode).toBe("");
    expect(out.notes).toContain("Cloned from bundled");
  });

  test("clones Creality Ender-3 with Marlin2 flavour + 220x220x250", () => {
    const out = cloneBundledPrinterToUserPayload("ender_3");
    expect(out).not.toBeNull();
    expect(out.build_x_mm).toBe(220);
    expect(out.build_y_mm).toBe(220);
    expect(out.build_z_mm).toBe(250);
    expect(out.gcode_flavor).toBe("marlin2");
    expect(out.max_speed_x).toBe(180);
  });

  test("falls back to neutral defaults when bundled profile has minimal fields", () => {
    const out = cloneBundledPrinterToUserPayload("custom");
    expect(out).not.toBeNull();
    // "custom" profile is intentionally sparse — printable_area is
    // missing so build_x/y default to 220x220 and printable_height
    // defaults to 250.
    expect(out.build_x_mm).toBe(220);
    expect(out.build_y_mm).toBe(220);
    expect(out.build_z_mm).toBe(250);
    expect(out.gcode_flavor).toBe("marlin2");
  });

  test("returns null for unknown bundled id (caller toasts)", () => {
    const out = cloneBundledPrinterToUserPayload("nonexistent_printer_xyz");
    expect(out).toBeNull();
  });

  test("custom suffix override works (e.g. for power-user cloning twice)", () => {
    const out = cloneBundledPrinterToUserPayload("sovol_sv06_plus_ace", {
      suffix: " (Klipper Tuned)",
    });
    expect(out.name).toBe("Sovol SV06 Plus Ace (Klipper Tuned)");
  });

  test("clamps gcode_flavor to the accepted USER_PRINTER_GCODE_FLAVORS set", () => {
    // Every bundled profile in PRINTER_PROFILES should produce a valid
    // flavour. Regression guard for future profile additions.
    const validFlavors = new Set(["marlin", "marlin2", "klipper", "reprap", "smoothie"]);
    for (const id of Object.keys(PRINTER_PROFILES)) {
      const out = cloneBundledPrinterToUserPayload(id);
      if (out) {
        expect(validFlavors.has(out.gcode_flavor)).toBe(true);
      }
    }
  });
});

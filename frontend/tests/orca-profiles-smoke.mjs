// Smoke test for the OrcaSlicer profile builder + Sovol catalogue.
// Verifies:
//   • Sovol SV06/SV06+/SV07/SV08 are all present in the printer list
//   • buildOrcaPayload returns the three expected JSON shapes
//   • Inline tunables override the chosen process preset's defaults
//   • The grouped printer list categorises by manufacturer correctly
//
// Run: cd /app/frontend && node tests/orca-profiles-smoke.mjs

import {
  PRINTER_PROFILES, PROCESS_PROFILES, FILAMENT_PROFILES,
  buildOrcaPayload, getPrinterGroups, INFILL_PATTERNS,
} from "../src/lib/orcaProfiles.js";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const results = [];
function check(label, cond, extra = "") {
  results.push({ label, cond });
  console.log(`${cond ? PASS : FAIL} — ${label}${extra ? ` — ${extra}` : ""}`);
}

// ---- Sovol catalogue ----
for (const id of ["sovol_sv06", "sovol_sv06_plus", "sovol_sv06_plus_ace", "sovol_sv07", "sovol_sv08"]) {
  const p = PRINTER_PROFILES[id];
  check(`Sovol model present: ${id}`, !!p, `label="${p?.label || ""}"`);
  if (p) {
    check(`${id} categorised as "Sovol"`, p.category === "Sovol");
    check(`${id} has printable_area`, Array.isArray(p.profile?.printable_area) && p.profile.printable_area.length === 4);
    check(`${id} declares a gcode_flavor`, !!p.profile?.gcode_flavor);
  }
}
// SV07 + SV08 + SV06 Plus Ace should be klipper (the Klipper-firmware Sovols).
check("SV07 is klipper", PRINTER_PROFILES.sovol_sv07.profile.gcode_flavor === "klipper");
check("SV08 is klipper", PRINTER_PROFILES.sovol_sv08.profile.gcode_flavor === "klipper");
check("SV06 Plus Ace is klipper", PRINTER_PROFILES.sovol_sv06_plus_ace.profile.gcode_flavor === "klipper");
check("SV06 is marlin", PRINTER_PROFILES.sovol_sv06.profile.gcode_flavor === "marlin2");
check("SV06 Plus (non-Ace) is marlin", PRINTER_PROFILES.sovol_sv06_plus.profile.gcode_flavor === "marlin2");

// ---- Process + filament presets sanity ----
check("Standard process has 2 perimeters", PROCESS_PROFILES.standard.profile.wall_loops === 2);
check("Strong process has 4 perimeters", PROCESS_PROFILES.strong.profile.wall_loops === 4);
check("Fine process turns ironing on", PROCESS_PROFILES.fine.profile.ironing === true);
check("PLA filament has hot_plate_temp 60", PLA_BED(FILAMENT_PROFILES.pla.profile));
function PLA_BED(p) { return Array.isArray(p.hot_plate_temp) && p.hot_plate_temp[0] === 60; }
check("ABS filament fans low", FILAMENT_PROFILES.abs.profile.fan_max_speed[0] <= 20);

// ---- Builder behaviour ----
const p1 = buildOrcaPayload({
  printerId: "sovol_sv06", processId: "standard", filamentId: "pla",
  wallLoops: 3, sparseInfillDensity: 40, sparseInfillPattern: "gyroid",
  enableSupport: true, ironing: true,
});
check("builder returns 3 profiles + summary", !!(p1.printerProfile && p1.processProfile && p1.filamentProfile && p1.summary));
check("builder applies wall_loops override", p1.processProfile.wall_loops === 3,
  `wall_loops=${p1.processProfile.wall_loops}`);
check("builder applies sparse_infill_density override", p1.processProfile.sparse_infill_density === 40);
check("builder applies pattern override", p1.processProfile.sparse_infill_pattern === "gyroid");
check("builder applies supports override", p1.processProfile.enable_support === true);
check("builder applies ironing override", p1.processProfile.ironing === true);
check("builder summary contains Sovol SV06", p1.summary.printer.includes("Sovol SV06"));

// ---- Default fallback ----
const p2 = buildOrcaPayload({
  printerId: "nonexistent", processId: "nonexistent", filamentId: "nonexistent",
  wallLoops: null, sparseInfillDensity: null, sparseInfillPattern: null,
  enableSupport: null, ironing: null,
});
check("builder falls back to custom printer", p2.summary.printer.includes("Custom"));
check("builder falls back to standard process", p2.summary.process.includes("Standard"));
check("builder falls back to PLA filament", p2.summary.filament === "PLA");
check("builder preserves preset wall_loops when override is null", p2.processProfile.wall_loops === 2);

// ---- Grouping ----
const groups = getPrinterGroups();
const cats = Object.keys(groups);
check("printer groups include Bambu Lab", cats.includes("Bambu Lab"));
check("printer groups include Sovol", cats.includes("Sovol"));
check("Sovol group has 5 printers", groups.Sovol?.length === 5, `count=${groups.Sovol?.length}`);

// ---- Infill pattern list ----
check("at least 6 infill patterns exposed", INFILL_PATTERNS.length >= 6, `n=${INFILL_PATTERNS.length}`);
check("gyroid is in the list", INFILL_PATTERNS.some((p) => p.id === "gyroid"));
check("lightning is in the list", INFILL_PATTERNS.some((p) => p.id === "lightning"));

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log("  - " + f.label);
  process.exit(1);
}

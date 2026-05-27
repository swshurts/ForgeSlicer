// Smoke tests for buildOrcaPayload — the most production-critical
// helper in orcaProfiles.js. The OrcaSlicer CLI strictly validates
// the JSONs it loads, so any drift in this helper that omits the
// required metadata fields will break every Orca-engine slice.
//
// Run with: cd frontend && node tests/orca-profile-meta.mjs
import { buildOrcaPayload } from "../src/lib/orcaProfiles.js";

let failures = 0;
function check(label, cond, extra = "") {
  if (!cond) {
    console.error("✗", label, extra);
    failures += 1;
  } else {
    console.log("✓", label);
  }
}

const payload = buildOrcaPayload({
  printerId: "bambu_a1",
  processId: "standard",
  filamentId: "pla",
  wallLoops: 3,
  sparseInfillDensity: 25,
  sparseInfillPattern: "gyroid",
  enableSupport: true,
  ironing: false,
});

// Each profile MUST have the four metadata fields. Without these,
// OrcaSlicer's C++ profile validator throws
//   `operator():file X.json's from <value> is unsupported (code 251)`
// and exits, which was the production v1.0 slice-flow bug.
for (const [key, expectedType] of [
  ["printerProfile", "machine"],
  ["processProfile", "process"],
  ["filamentProfile", "filament"],
]) {
  const prof = payload[key];
  check(`${key} has type = "${expectedType}"`, prof.type === expectedType);
  check(`${key} has from = "User"`, prof.from === "User");
  check(`${key} has instantiation = "true"`, prof.instantiation === "true");
  check(`${key} has a non-empty name`, typeof prof.name === "string" && prof.name.length > 0);
}

// Tunable merging — wall_loops + sparse_infill_density should override
// the process preset.
check("wall_loops override applied", payload.processProfile.wall_loops === 3);
check("sparse_infill_density override applied", payload.processProfile.sparse_infill_density === 25);
check("sparse_infill_pattern override applied", payload.processProfile.sparse_infill_pattern === "gyroid");
check("enable_support override applied", payload.processProfile.enable_support === true);

// summary is preserved
check("summary has printer label", payload.summary.printer.includes("A1"));
check("summary has filament label", typeof payload.summary.filament === "string");

// Unknown IDs fall back to defaults without crashing
const fallback = buildOrcaPayload({
  printerId: "nonexistent-printer",
  processId: "nonexistent-process",
  filamentId: "nonexistent-filament",
});
check("unknown printerId falls back to a real profile", fallback.printerProfile.type === "machine");
check("unknown processId falls back to a real profile", fallback.processProfile.type === "process");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll metadata + tunable checks passed.");

// Regression for the Hardware Library mapping into Fastener Pair opts.
//
// Run:  cd /app/frontend && node tests/hardware-library.mjs

import {
  HARDWARE_TABLE,
  HARDWARE_LENGTHS_BY_GRADE,
  hardwareToFastenerOpts,
} from "../src/lib/hardwareLibrary.js";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

// ---- Library completeness ----
ok(HARDWARE_TABLE.length === 7,
   `7 grades shipped in v1 (M3..M12), got ${HARDWARE_TABLE.length}`);
const ids = HARDWARE_TABLE.map((s) => s.id);
ok(JSON.stringify(ids) === JSON.stringify(["M3","M4","M5","M6","M8","M10","M12"]),
   "grades in monotonic order");

for (const spec of HARDWARE_TABLE) {
  ok(spec.majorR * 2 === spec.m,
     `${spec.id}: majorR (${spec.majorR}) × 2 = M-number (${spec.m})`);
  ok(spec.pitch > 0 && spec.pitch < spec.m,
     `${spec.id}: pitch ${spec.pitch} reasonable`);
  ok(spec.headR > spec.majorR,
     `${spec.id}: headR ${spec.headR} > majorR ${spec.majorR}`);
  // Coarse-pitch sanity (ISO standard values).
  const expectedPitch = { M3: 0.5, M4: 0.7, M5: 0.8, M6: 1.0, M8: 1.25, M10: 1.5, M12: 1.75 }[spec.id];
  ok(approx(spec.pitch, expectedPitch),
     `${spec.id}: pitch matches ISO standard (${expectedPitch})`);
}

// Every grade has a non-empty length list.
for (const grade of ids) {
  const lens = HARDWARE_LENGTHS_BY_GRADE[grade];
  ok(Array.isArray(lens) && lens.length > 0,
     `${grade}: length list non-empty (${lens?.length} entries)`);
}

// ---- hardwareToFastenerOpts mapping ----
{
  const m5 = HARDWARE_TABLE.find((s) => s.id === "M5");
  const opts = hardwareToFastenerOpts(m5, 20);
  ok(opts.boltR === 2.5, "M5×20: boltR = 2.5");
  ok(opts.pitch === 0.8, "M5×20: pitch = 0.8");
  ok(opts.shaftH === 20, "M5×20: shaftH = length");
  ok(opts.workThickness === 15, "M5×20: default workThickness = length - 5 = 15");
  ok(opts.headR === 4.0, "M5×20: headR = spec.headR (4.0)");
  ok(opts.groupName === "Fastener M5×20", "groupName labels grade+length");
}

// Tiny length (M3×5) — workThickness must clamp at 2mm minimum.
{
  const m3 = HARDWARE_TABLE.find((s) => s.id === "M3");
  const opts = hardwareToFastenerOpts(m3, 5);
  ok(opts.workThickness === 2, "M3×5: workThickness clamps at 2mm minimum (would be 0)");
}

// workThicknessOverride respected.
{
  const m6 = HARDWARE_TABLE.find((s) => s.id === "M6");
  const opts = hardwareToFastenerOpts(m6, 25, 10);
  ok(opts.workThickness === 10, "override respected (10mm)");
  ok(opts.shaftH === 25, "shaftH still tracks length");
}

console.log("\nAll hardware-library regression assertions passed ✔");

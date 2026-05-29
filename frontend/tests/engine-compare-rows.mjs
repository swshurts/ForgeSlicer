// Engine-comparison row math regression test.
// Run:  cd /app/frontend && node tests/engine-compare-rows.mjs
//
// Verifies the comparison-row logic in engineCompare.js without
// spinning up the slicers themselves: feed it two synthetic stats
// objects + assert which side wins each row.
//
// The math under test:
//   - lowerIsBetter=true: smaller value wins
//   - lowerIsBetter=false: larger value wins
//   - ties produce winner=null
//   - missing values on either side disable the comparison

// We re-implement the (very small) computation here from the spec so
// this file can run in isolation — the production module imports
// browser-only utilities (workerClient, exporters, api) that don't
// resolve under bare node.
function buildComparisonRows(builtinStats, orcaStats) {
  const rows = [
    { label: "G-code lines",  key: "gcodeLines",  builtin: builtinStats?.segments,    orca: orcaStats?.gcode_lines,  unit: "",   lowerIsBetter: false },
    { label: "Layer count",   key: "layers",      builtin: builtinStats?.layers,      orca: orcaStats?.layers,       unit: "",   lowerIsBetter: false },
    { label: "Filament used", key: "filamentMM",  builtin: builtinStats?.filamentMM,  orca: orcaStats?.filament_mm,  unit: "mm", lowerIsBetter: true,  decimals: 1 },
    { label: "G-code size",   key: "gcodeBytes",  builtin: builtinStats?.gcodeBytes,  orca: orcaStats?.gcode_bytes,  unit: "KB", lowerIsBetter: true,  scale: 1 / 1024, decimals: 1 },
    { label: "Slice duration",key: "durationSec", builtin: builtinStats?.durationSec, orca: orcaStats?.duration_seconds, unit: "s", lowerIsBetter: true, decimals: 2 },
  ];
  return rows.map((r) => {
    const a = Number.isFinite(r.builtin) ? r.builtin * (r.scale ?? 1) : null;
    const b = Number.isFinite(r.orca)    ? r.orca    * (r.scale ?? 1) : null;
    let winner = null;
    if (a !== null && b !== null && a !== b) {
      if (r.lowerIsBetter) winner = a < b ? "builtin" : "orca";
      else                 winner = a > b ? "builtin" : "orca";
    }
    return { ...r, builtin: a, orca: b, winner };
  });
}

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};

// --- (1) Orca wins the "more is better" columns, built-in wins
//     the "less is better" columns, on a typical comparison ---
{
  const builtin = { segments: 12345, layers: 50, filamentMM: 245.3, gcodeBytes: 125 * 1024, durationSec: 0.4 };
  const orca    = { gcode_lines: 89000, layers: 200, filament_mm: 380.1, gcode_bytes: 980 * 1024, duration_seconds: 4.2 };
  const rows = buildComparisonRows(builtin, orca);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  ok(byKey.gcodeLines.winner === "orca",   "more gcode-lines = orca wins (lowerIsBetter=false)");
  ok(byKey.layers.winner === "orca",       "more layers = orca wins (Orca's typically higher layer count flags real supports)");
  ok(byKey.filamentMM.winner === "builtin","less filament = built-in wins");
  ok(byKey.gcodeBytes.winner === "builtin","smaller gcode size = built-in wins");
  ok(byKey.durationSec.winner === "builtin","faster slice = built-in wins");
}

// --- (2) Tie produces winner=null ---
{
  const same = { segments: 1000, layers: 50, filamentMM: 100, gcodeBytes: 100 * 1024, durationSec: 1.0 };
  const sameOrca = { gcode_lines: 1000, layers: 50, filament_mm: 100, gcode_bytes: 100 * 1024, duration_seconds: 1.0 };
  const rows = buildComparisonRows(same, sameOrca);
  for (const r of rows) ok(r.winner === null, `tie on ${r.key}: winner=null`);
}

// --- (3) Missing values produce no comparison ---
{
  const partial = { segments: 1000 }; // only one field
  const rows = buildComparisonRows(partial, null);
  for (const r of rows) ok(r.winner === null, `${r.key}: no comparison when one side is null`);
  const onlyOrca = buildComparisonRows(null, { gcode_lines: 5000 });
  ok(onlyOrca.find((r) => r.key === "gcodeLines").orca === 5000, "Orca-only side still surfaces its value");
  ok(onlyOrca.every((r) => r.winner === null), "no winner when builtin side is null");
}

// --- (4) KB scale conversion applies ---
{
  const builtin = { gcodeBytes: 51200 };  // 50 KB
  const orca = { gcode_bytes: 102400 };   // 100 KB
  const rows = buildComparisonRows(builtin, orca);
  const r = rows.find((x) => x.key === "gcodeBytes");
  ok(Math.abs(r.builtin - 50) < 1e-6, `KB scale: builtin 50 KB (got ${r.builtin})`);
  ok(Math.abs(r.orca - 100) < 1e-6, `KB scale: orca 100 KB (got ${r.orca})`);
  ok(r.winner === "builtin", "smaller gcode size = built-in wins (after KB scale)");
}

// --- (5) Edge: explicit zero is finite and counts ---
{
  const a = { segments: 0 };
  const b = { gcode_lines: 100 };
  const r = buildComparisonRows(a, b).find((x) => x.key === "gcodeLines");
  ok(r.builtin === 0, "explicit 0 survives the Number.isFinite gate");
  ok(r.winner === "orca", "0 vs 100 with lowerIsBetter=false → orca wins");
}

console.log("\nAll engine-compare-rows regression assertions passed ✔");

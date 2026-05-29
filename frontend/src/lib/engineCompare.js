// Engine comparison — runs the current scene through BOTH the built-in
// JS slicer AND OrcaSlicer in parallel, then collects matching stats so
// the user can see the trade-off side-by-side.
//
// Two design notes:
//   1. We Promise.all the two slices so total wall time = max(builtin,
//      orca) instead of sum. The built-in finishes in <1s for typical
//      scenes; Orca is ~5-30s. Running serially would feel sluggish.
//   2. Each branch is wrapped in its OWN try/catch — a failure in one
//      slicer doesn't kill the other. The caller renders a "skipped"
//      pill on the failed side instead of refusing to compare at all.
//      Common failure modes: Orca not installed (returns 503), built-in
//      hitting a non-manifold STL (worker rejects with NotManifold).
//
// Returns shape:
//   {
//     builtin: { ok, stats?, error?, gcode?, filename? },
//     orca:    { ok, stats?, error?, gcode?, filename? },
//     comparison: [
//       { label, builtin, orca, winner: "builtin"|"orca"|null, unit, lowerIsBetter }
//     ],
//   }

import { sliceToGCODEAsync } from "./workerClient";
import { exportSceneToSTLBytes } from "./exporters";
import { orcaApi, apiErrorMessage } from "./api";
import { buildOrcaPayload } from "./orcaProfiles";

function arrayBufferToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Compute the comparison table from two stats objects. Each row picks a
// "winner" — the side with the lower value (or higher for the columns
// flagged `lowerIsBetter: false`). When either side is missing/null
// the row still renders with an em-dash and no winner highlight.
function buildComparisonRows(builtinStats, orcaStats) {
  // Pull a comparable layer count: built-in's `layers` is the rendered
  // sliceCount; Orca returns `layers: null` sometimes (depends on the
  // 3MF metadata block). When Orca's null we derive from G-code by
  // looking for "; LAYER:" markers — handled upstream where possible.
  const rows = [
    { label: "G-code lines",  key: "gcodeLines",  builtin: builtinStats?.segments,    orca: orcaStats?.gcode_lines,  unit: "",          lowerIsBetter: false },
    { label: "Layer count",   key: "layers",      builtin: builtinStats?.layers,      orca: orcaStats?.layers,       unit: "",          lowerIsBetter: false },
    { label: "Filament used", key: "filamentMM",  builtin: builtinStats?.filamentMM,  orca: orcaStats?.filament_mm,  unit: "mm",        lowerIsBetter: true,  decimals: 1 },
    { label: "G-code size",   key: "gcodeBytes",  builtin: builtinStats?.gcodeBytes,  orca: orcaStats?.gcode_bytes,  unit: "KB",        lowerIsBetter: true,  scale: 1 / 1024, decimals: 1 },
    { label: "Slice duration",key: "durationSec", builtin: builtinStats?.durationSec, orca: orcaStats?.duration_seconds, unit: "s",     lowerIsBetter: true,  decimals: 2 },
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

export async function compareEngines({ objects, settings, buildVolume, orcaPayload }) {
  // Two slices in parallel — failure-isolated per side.
  const t0 = performance.now();

  const builtinPromise = (async () => {
    const tStart = performance.now();
    try {
      const r = await sliceToGCODEAsync(objects, {
        ...settings,
        bedX: buildVolume.x,
        bedY: buildVolume.y,
      });
      const durationSec = (performance.now() - tStart) / 1000;
      // gcodeBytes is computed once here so both the table-renderer
      // and the eventual download path can read the same value.
      const gcodeBytes = r.gcode ? new TextEncoder().encode(r.gcode).byteLength : 0;
      return {
        ok: true,
        stats: { ...r.stats, durationSec, gcodeBytes },
        gcode: r.gcode,
        filename: "model_builtin.gcode",
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  })();

  const orcaPromise = (async () => {
    const tStart = performance.now();
    try {
      const { bytes } = await exportSceneToSTLBytes(objects);
      const b64 = arrayBufferToBase64(bytes);
      const r = await orcaApi.slice({
        stlBase64: b64,
        printerProfile:    orcaPayload.printerProfile,
        processProfile:    orcaPayload.processProfile,
        filamentProfile:   orcaPayload.filamentProfile,
        printerPresetName: orcaPayload.printerPresetName,
        printerVendor:     orcaPayload.printerVendor,
        processPresetName: orcaPayload.processPresetName,
        processVendor:     orcaPayload.processVendor,
        filamentPresetName: orcaPayload.filamentPresetName,
        filamentVendor:    orcaPayload.filamentVendor,
      });
      // Some Orca responses don't carry layer count in stats — derive
      // it from the gcode itself so the comparison table has a value.
      const layers = (r.stats?.layers
        || (r.gcode?.match(/^; LAYER:\d+/gm) || []).length
        || (r.gcode?.match(/^;LAYER:\d+/gm) || []).length
        || null);
      const gcodeBytes = r.stats?.gcode_bytes
        || (r.gcode ? new TextEncoder().encode(r.gcode).byteLength : 0);
      const durationSec = r.stats?.duration_seconds ?? (performance.now() - tStart) / 1000;
      return {
        ok: true,
        stats: { ...r.stats, layers, gcode_bytes: gcodeBytes, duration_seconds: durationSec },
        gcode: r.gcode,
        filename: "model_orca.gcode",
      };
    } catch (e) {
      return { ok: false, error: apiErrorMessage(e) || e.message || String(e) };
    }
  })();

  const [builtin, orca] = await Promise.all([builtinPromise, orcaPromise]);
  const totalSec = (performance.now() - t0) / 1000;
  const comparison = buildComparisonRows(
    builtin.ok ? builtin.stats : null,
    orca.ok ? orca.stats : null,
  );
  return { builtin, orca, comparison, totalSec };
}

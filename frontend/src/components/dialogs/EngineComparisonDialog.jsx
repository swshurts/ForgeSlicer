// EngineComparisonDialog — side-by-side report of the built-in JS
// slicer vs OrcaSlicer for the SAME scene + settings. Renders a
// two-column metrics table with "winner" highlights, a per-side
// status pill (success / failed / not-installed), and download
// buttons for whichever G-code(s) succeeded.
//
// Triggered from the SlicerPopover's "Compare engines" button. Modal
// stays open until the user dismisses it so they can read the table
// without losing the side outputs.
import React from "react";
import { X, Download, AlertTriangle, CheckCircle2, GitCompare, Trophy, Loader2 } from "lucide-react";
import { downloadText } from "../../lib/exporters";

function fmt(value, decimals = 0, unit = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const s = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString();
  return unit ? `${s} ${unit}` : s;
}

function StatusPill({ ok, error }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-semibold">
        <CheckCircle2 size={11} /> sliced
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[10px] font-semibold"
      title={error || ""}
    >
      <AlertTriangle size={11} /> failed
    </span>
  );
}

export default function EngineComparisonDialog({ open, busy, result, onClose, onRerun }) {
  if (!open) return null;

  const builtin = result?.builtin;
  const orca = result?.orca;
  const rows = result?.comparison || [];
  // Winner tally — light fun touch in the header. Ties (winner: null)
  // contribute to neither side, so the totals don't always add up to
  // the row count.
  const tally = rows.reduce(
    (acc, r) => {
      if (r.winner === "builtin") acc.builtin += 1;
      else if (r.winner === "orca") acc.orca += 1;
      return acc;
    },
    { builtin: 0, orca: 0 },
  );

  const downloadGcode = (side) => {
    const src = side === "builtin" ? builtin : orca;
    if (!src?.ok || !src.gcode) return;
    downloadText(src.gcode, src.filename, "text/plain");
  };

  return (
    <div
      data-testid="engine-compare-dialog"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-700">
          <GitCompare size={18} className="text-orange-400" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-slate-100">Engine Comparison</h2>
            <div className="text-[11px] text-slate-400">
              {busy
                ? "Slicing in both engines…"
                : result
                  ? `Total wall time ${result.totalSec.toFixed(2)} s`
                  : "Ready to run"}
            </div>
          </div>
          <button
            data-testid="engine-compare-close-btn"
            onClick={onClose}
            className="h-8 w-8 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center"
            aria-label="Close comparison"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {busy && (
            <div className="flex items-center justify-center gap-3 py-8 text-slate-300">
              <Loader2 size={20} className="animate-spin text-orange-400" />
              <div className="text-sm">Running both slicers in parallel — Orca usually finishes last.</div>
            </div>
          )}

          {!busy && result && (
            <>
              {/* Per-engine status row */}
              <div className="grid grid-cols-2 gap-3">
                <div data-testid="engine-compare-builtin-status" className="bg-slate-950 border border-slate-700 rounded p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[12px] font-semibold text-slate-200">Built-in JS</div>
                    <StatusPill ok={builtin?.ok} error={builtin?.error} />
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {builtin?.ok ? "In-browser, no server round-trip." : builtin?.error || "—"}
                  </div>
                  {tally.builtin > tally.orca && tally.builtin > 0 && (
                    <div className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-orange-500/15 text-orange-300 border border-orange-500/40 font-semibold">
                      <Trophy size={10} /> wins {tally.builtin} of {rows.length}
                    </div>
                  )}
                </div>
                <div data-testid="engine-compare-orca-status" className="bg-slate-950 border border-slate-700 rounded p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[12px] font-semibold text-slate-200">OrcaSlicer</div>
                    <StatusPill ok={orca?.ok} error={orca?.error} />
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {orca?.ok ? "Server-side, production-quality." : orca?.error || "—"}
                  </div>
                  {tally.orca > tally.builtin && tally.orca > 0 && (
                    <div className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-orange-500/15 text-orange-300 border border-orange-500/40 font-semibold">
                      <Trophy size={10} /> wins {tally.orca} of {rows.length}
                    </div>
                  )}
                </div>
              </div>

              {/* Comparison table */}
              <div className="bg-slate-950 border border-slate-700 rounded overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-slate-900 text-slate-400 uppercase tracking-wider text-[10px]">
                      <th className="text-left px-3 py-2 font-semibold">Metric</th>
                      <th className="text-right px-3 py-2 font-semibold">Built-in</th>
                      <th className="text-right px-3 py-2 font-semibold">OrcaSlicer</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {rows.map((r) => (
                      <tr key={r.key} data-testid={`engine-compare-row-${r.key}`} className="border-t border-slate-800">
                        <td className="text-left px-3 py-2 text-slate-300 font-sans">{r.label}</td>
                        <td
                          className={`text-right px-3 py-2 tabular-nums ${
                            r.winner === "builtin" ? "text-orange-300 font-semibold" : "text-slate-400"
                          }`}
                        >
                          {fmt(r.builtin, r.decimals || 0, r.unit)}
                          {r.winner === "builtin" && <Trophy size={11} className="inline ml-1.5 mb-0.5 text-orange-400" />}
                        </td>
                        <td
                          className={`text-right px-3 py-2 tabular-nums ${
                            r.winner === "orca" ? "text-orange-300 font-semibold" : "text-slate-400"
                          }`}
                        >
                          {fmt(r.orca, r.decimals || 0, r.unit)}
                          {r.winner === "orca" && <Trophy size={11} className="inline ml-1.5 mb-0.5 text-orange-400" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Caveat — winner ≠ better print, the table just summarises numbers */}
              <div className="text-[10px] text-slate-500 leading-snug px-1">
                Trophy marks the side with the more efficient number for that metric — fewer
                G-code lines, less filament, faster slice. They don't necessarily mean a
                <strong className="text-slate-400"> better print</strong>: Orca routinely produces longer
                G-code precisely because it generates real supports, ironing, multi-perimeter
                walls, etc. that the built-in slicer skips. Read the trade-off, not the score.
              </div>

              {/* Download row */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                <button
                  data-testid="engine-compare-download-builtin-btn"
                  onClick={() => downloadGcode("builtin")}
                  disabled={!builtin?.ok}
                  className="h-9 px-3 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 border border-slate-700 disabled:cursor-not-allowed text-slate-200 text-xs font-semibold rounded flex items-center gap-1.5"
                >
                  <Download size={12} /> Built-in G-code
                </button>
                <button
                  data-testid="engine-compare-download-orca-btn"
                  onClick={() => downloadGcode("orca")}
                  disabled={!orca?.ok}
                  className="h-9 px-3 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 border border-slate-700 disabled:cursor-not-allowed text-slate-200 text-xs font-semibold rounded flex items-center gap-1.5"
                >
                  <Download size={12} /> Orca G-code
                </button>
                <div className="flex-1" />
                <button
                  data-testid="engine-compare-rerun-btn"
                  onClick={onRerun}
                  className="h-9 px-3 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5"
                >
                  <GitCompare size={12} /> Run again
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

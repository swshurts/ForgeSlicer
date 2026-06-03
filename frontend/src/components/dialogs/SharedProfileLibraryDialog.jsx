// Iter-83: SharedProfileLibraryDialog — browse and clone printer
// profiles other ForgeSlicer users have published to the Shared
// Library. Solves the "every Sovol SV06 Plus Ace owner re-discovers
// the same Klipper START_PRINT macros from scratch" friction.
//
// Flow:
//   1. Dialog opens with the full public list (newest first), or
//      filtered to a specific printer model when invoked with
//      `initialFilter`.
//   2. User scans cards for a printer matching theirs, expands
//      details to inspect start/end g-code + notes.
//   3. One click on "Clone to my printers" duplicates the doc into
//      the user's library with `(Shared)` suffix and a credit line
//      in notes. Toast confirms success and offers to jump to the
//      My Printers dialog.
//
// We don't auto-select / auto-set the new clone as active to avoid
// blowing up an in-flight slice — the user explicitly switches over
// when ready.

import { useEffect, useState } from "react";
import {
  X, Globe2, Loader2, Download as Clone, Search, Filter, AlertTriangle,
  Flag, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { sharedPrintersApi, apiErrorMessage } from "../../lib/api";

export default function SharedProfileLibraryDialog({ open, onClose, initialFilter = "", onCloned }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(initialFilter);
  const [expandedId, setExpandedId] = useState(null);
  const [cloningId, setCloningId] = useState(null);

  useEffect(() => {
    if (!open) return;
    setFilter(initialFilter);
    setError(null);
    setLoading(true);
    sharedPrintersApi
      .list({ printerModel: initialFilter || undefined })
      .then((data) => setList(data || []))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [open, initialFilter]);

  if (!open) return null;

  // Client-side text filter (case-insensitive substring) on top of
  // the server-side printer_model exact-match. Lets the user narrow
  // from "Sovol SV06 Plus Ace" → "klipper" or "SV06" without
  // round-tripping the server every keystroke.
  const visible = filter
    ? list.filter((r) => {
        const q = filter.toLowerCase();
        return (
          (r.name || "").toLowerCase().includes(q)
          || (r.printer_model || "").toLowerCase().includes(q)
          || (r.gcode_flavor || "").toLowerCase().includes(q)
          || (r.notes || "").toLowerCase().includes(q)
        );
      })
    : list;

  const handleClone = async (row) => {
    setCloningId(row.printer_id);
    try {
      const cloned = await sharedPrintersApi.clone(row.printer_id);
      toast.success(`Cloned "${cloned.name}" to your printers — open My Printers to edit.`);
      if (onCloned) onCloned(cloned);
    } catch (err) {
      toast.error(`Clone failed: ${apiErrorMessage(err)}`);
    } finally {
      setCloningId(null);
    }
  };

  const handleFlag = async (row) => {
    if (!window.confirm(`Flag "${row.name}" for moderator review? (Use only for inappropriate / broken profiles.)`)) {
      return;
    }
    try {
      await sharedPrintersApi.flag(row.printer_id);
      toast.info("Thanks — moderators will review.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="shared-profile-library-dialog"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Globe2 size={16} className="text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Shared Profile Library</h2>
              <div className="text-[10px] text-slate-500 leading-tight">
                Printer profiles published by other ForgeSlicer users — clone &amp; tweak instead of starting from scratch.
              </div>
            </div>
          </div>
          <button onClick={onClose} data-testid="shared-library-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </header>

        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <Search size={14} className="text-slate-500" />
          <input
            data-testid="shared-library-filter-input"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by printer name, model, flavour, or notes…"
            className="flex-1 h-8 bg-slate-950 border border-slate-700 rounded px-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
          />
          {initialFilter && (
            <div className="text-[10px] text-slate-400 flex items-center gap-1 px-2 py-1 bg-slate-800 rounded">
              <Filter size={10} /> {initialFilter}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12 text-slate-400 text-xs gap-2">
              <Loader2 size={18} className="animate-spin" /> Loading shared profiles…
            </div>
          )}
          {error && !loading && (
            <div className="bg-rose-500/10 border border-rose-500/40 rounded p-3 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {!loading && !error && visible.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">
              {filter || initialFilter
                ? "No published profiles match this filter."
                : "Nobody's published a profile yet — be the first! Open My Printers and click the share icon next to one of yours."}
            </div>
          )}
          {!loading && !error && visible.map((row) => {
            const expanded = expandedId === row.printer_id;
            return (
              <div
                key={row.printer_id}
                data-testid={`shared-library-row-${row.printer_id}`}
                className="bg-slate-950 border border-slate-700 rounded p-3 space-y-2"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">{row.name}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      <span className="text-slate-500">by</span>{" "}
                      <span className="text-emerald-300">@{row.published_by_display}</span>
                      {" · "}
                      <span className="font-mono">{row.printer_model || "Custom"}</span>
                      {" · "}
                      <span className="font-mono">{row.build_x_mm}×{row.build_y_mm}×{row.build_z_mm} mm</span>
                      {" · "}
                      <span className="font-mono">{row.gcode_flavor}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Cloned {row.clone_count} time{row.clone_count === 1 ? "" : "s"}
                      {" · "}
                      {row.published_at?.slice(0, 10)}
                      {row.flag_count > 0 && (
                        <span className="text-amber-400 ml-1">· {row.flag_count} flag{row.flag_count === 1 ? "" : "s"}</span>
                      )}
                    </div>
                  </div>
                  <button
                    data-testid={`shared-library-expand-${row.printer_id}`}
                    onClick={() => setExpandedId(expanded ? null : row.printer_id)}
                    className="h-7 w-7 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 flex items-center justify-center"
                    title={expanded ? "Hide details" : "Show start/end g-code + notes"}
                  >
                    {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  <button
                    data-testid={`shared-library-flag-${row.printer_id}`}
                    onClick={() => handleFlag(row)}
                    className="h-7 w-7 bg-slate-800 hover:bg-amber-900/40 text-slate-400 hover:text-amber-300 rounded border border-slate-700 flex items-center justify-center"
                    title="Flag for moderator review"
                  >
                    <Flag size={11} />
                  </button>
                  <button
                    data-testid={`shared-library-clone-${row.printer_id}`}
                    onClick={() => handleClone(row)}
                    disabled={cloningId === row.printer_id}
                    className="h-7 px-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-[11px] font-semibold rounded flex items-center gap-1.5"
                  >
                    {cloningId === row.printer_id ? <Loader2 size={11} className="animate-spin" /> : <Clone size={11} />}
                    Clone
                  </button>
                </div>
                {expanded && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    {row.notes && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Notes</div>
                        <div className="text-[11px] text-slate-300 whitespace-pre-wrap bg-slate-900 border border-slate-800 rounded p-2">{row.notes}</div>
                      </div>
                    )}
                    {row.start_gcode && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Start g-code</div>
                        <pre className="text-[10px] font-mono text-amber-200 bg-slate-900 border border-slate-800 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">{row.start_gcode}</pre>
                      </div>
                    )}
                    {row.end_gcode && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">End g-code</div>
                        <pre className="text-[10px] font-mono text-amber-200 bg-slate-900 border border-slate-800 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">{row.end_gcode}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Subdivide dialog — splits an oversized object into printable pieces.
//
// Two modes:
//   • Auto — computes the minimum axis-aligned cut grid that produces
//            pieces all fitting under the current build volume. The
//            number of cuts is editable per axis (so users can over-
//            subdivide on purpose, e.g. to print on a smaller machine).
//   • Manual — lets the user type explicit world-coordinate cut planes
//              on each axis. Live preview shows where every plane sits
//              along the source bbox.
//
// Connector picker: None / Dowel / Dovetail. (The "mark a face" mode
// the user mentioned will land in iter-70; for v1 we ship the three
// auto-positioned styles.)
import React, { useEffect, useMemo, useState } from "react";
import {
  X, Scissors, Hammer, Wand2, AlertTriangle, Loader2, Plus, Trash2, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useScene } from "../../lib/store";
import { checkOversize, computeAutoCutGrid, planesForGrid } from "../../lib/oversizeCheck";

// Per-axis connector picker constants. Dowel sizes follow off-the-shelf
// dowel diameters; dovetail size is the tongue thickness in mm.
const CONNECTOR_KINDS = [
  { id: "none",     label: "None",     hint: "Clean planar cuts only. You'll glue / fasten after printing." },
  { id: "dowel",    label: "Dowels",   hint: "Cylindrical peg + matching hole on every cut face. Print the pegs separately." },
  { id: "dovetail", label: "Dovetails", hint: "Stylised tongue-and-groove cuboids. Slide-together fit." },
];
const DEFAULT_SIZE_MM = 6;

export default function SubdivideDialog({ open, objectId, onClose }) {
  const objects = useScene((s) => s.objects);
  const buildVolume = useScene((s) => s.buildVolume);
  const applySubdivide = useScene((s) => s.applySubdivide);

  const src = useMemo(() => objects.find((o) => o.id === objectId) || null, [objects, objectId]);
  const report = useMemo(
    () => (src ? checkOversize(src, buildVolume) : null),
    [src, buildVolume],
  );

  const [mode, setMode] = useState("auto");
  const [autoGrid, setAutoGrid] = useState({ x: 0, y: 0, z: 0 });
  const [manualCuts, setManualCuts] = useState({ x: [], y: [], z: [] });
  const [connectorKind, setConnectorKind] = useState("none");
  const [connectorSize, setConnectorSize] = useState(DEFAULT_SIZE_MM);
  const [busy, setBusy] = useState(false);

  // Whenever the dialog opens (or the source / printer changes), reset
  // to a fresh auto grid + empty manual cuts so the user lands on a
  // useful starting point.
  useEffect(() => {
    if (!open || !report) return;
    setAutoGrid(computeAutoCutGrid(report));
    setManualCuts({ x: [], y: [], z: [] });
    setMode("auto");
    setConnectorKind("none");
    setConnectorSize(DEFAULT_SIZE_MM);
    // Frame the viewport on the source bbox so the user sees the model
    // they're about to slice (plus the now-tiny build plate underneath).
    try {
      window.dispatchEvent(new CustomEvent("forgeslicer:frame-bbox", {
        detail: { min: report.bbox.min, max: report.bbox.max },
      }));
    } catch { /* no-op */ }
  }, [open, report]);

  if (!open) return null;
  if (!src) {
    return (
      <ModalShell onClose={onClose}>
        <div className="text-sm text-slate-300 p-4">Object no longer in scene.</div>
      </ModalShell>
    );
  }

  // Build the cut list that's actually about to be applied. Auto =
  // even-spacing planes from the grid; Manual = user's typed values
  // clamped to the bbox.
  const effectiveCuts = mode === "auto"
    ? planesForGrid(report, autoGrid)
    : sanitiseManual(manualCuts, report);
  const totalCuts = (effectiveCuts.x?.length || 0) + (effectiveCuts.y?.length || 0) + (effectiveCuts.z?.length || 0);
  const expectedPieces =
    ((autoGrid.x ?? effectiveCuts.x?.length ?? 0) + 1) *
    ((autoGrid.y ?? effectiveCuts.y?.length ?? 0) + 1) *
    ((autoGrid.z ?? effectiveCuts.z?.length ?? 0) + 1);

  const handleApply = async () => {
    if (totalCuts === 0) {
      toast.error("Pick at least one cut plane");
      return;
    }
    setBusy(true);
    try {
      const r = await applySubdivide(src.id, effectiveCuts, {
        kind: connectorKind,
        sizeMm: connectorSize,
      });
      if (!r.ok) {
        toast.error(r.error || "Subdivide failed");
        setBusy(false);
        return;
      }
      toast.success(`Subdivided into ${r.count} piece${r.count === 1 ? "" : "s"}`);
      onClose();
    } catch (err) {
      toast.error(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <Scissors size={16} className="text-orange-400" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-white">
            Subdivide “{src.name || "Object"}”
          </h2>
          {report && (
            <div className="text-[10px] text-slate-400 font-mono">
              {report.size.x.toFixed(1)} × {report.size.y.toFixed(1)} × {report.size.z.toFixed(1)} mm —{" "}
              <span className="text-amber-300">
                exceeds build volume {report.build.x.toFixed(0)} × {report.build.y.toFixed(0)} × {report.build.z.toFixed(0)} mm
              </span>
            </div>
          )}
        </div>
        <button
          data-testid="subdivide-close"
          onClick={onClose}
          className="h-7 w-7 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4 overflow-y-auto">
        {/* Mode toggle */}
        <div className="flex items-center gap-2" data-testid="subdivide-mode-toggle">
          <ModeButton
            id="auto" active={mode === "auto"} onClick={() => setMode("auto")}
            icon={Wand2} label="Auto"
            hint="System picks the minimum number of cuts that fit the build plate."
          />
          <ModeButton
            id="manual" active={mode === "manual"} onClick={() => setMode("manual")}
            icon={Hammer} label="Manual"
            hint="Type explicit cut positions per axis."
          />
        </div>

        {/* Mode panel */}
        {mode === "auto" ? (
          <AutoPanel
            report={report}
            grid={autoGrid}
            setGrid={setAutoGrid}
          />
        ) : (
          <ManualPanel
            report={report}
            cuts={manualCuts}
            setCuts={setManualCuts}
          />
        )}

        {/* Connector picker */}
        <section className="space-y-2" data-testid="subdivide-connectors">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Connectors
          </div>
          <div className="flex flex-wrap gap-2">
            {CONNECTOR_KINDS.map((c) => (
              <button
                key={c.id}
                data-testid={`subdivide-connector-${c.id}`}
                onClick={() => setConnectorKind(c.id)}
                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                  connectorKind === c.id
                    ? "bg-orange-500/20 border-orange-500/60 text-orange-200"
                    : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 leading-snug">
            {CONNECTOR_KINDS.find((c) => c.id === connectorKind)?.hint}
          </p>
          {connectorKind !== "none" && (
            <label className="flex items-center gap-2 text-[11px] text-slate-300">
              Size
              <input
                type="range"
                min={3} max={12} step={0.5}
                value={connectorSize}
                onChange={(e) => setConnectorSize(parseFloat(e.target.value))}
                className="flex-1 accent-orange-500"
                data-testid="subdivide-connector-size"
              />
              <span className="font-mono text-orange-300 w-12 text-right">{connectorSize.toFixed(1)} mm</span>
            </label>
          )}
        </section>

        {/* Preview summary */}
        <div className="rounded border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-300">
          <div>
            <span className="text-slate-500">Planned cuts:</span>{" "}
            <span className="text-orange-300 font-mono">
              X={effectiveCuts.x?.length || 0} · Y={effectiveCuts.y?.length || 0} · Z={effectiveCuts.z?.length || 0}
            </span>
          </div>
          <div className="mt-0.5">
            <span className="text-slate-500">Expected pieces:</span>{" "}
            <span className="text-white font-mono" data-testid="subdivide-expected-pieces">{expectedPieces}</span>
            {connectorKind !== "none" && (
              <span className="text-slate-500"> + {connectorKind} connectors</span>
            )}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-800">
        <button
          onClick={onClose}
          className="h-8 px-3 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded border border-slate-700"
        >
          Cancel
        </button>
        <button
          data-testid="subdivide-apply-btn"
          onClick={handleApply}
          disabled={busy || totalCuts === 0}
          className="h-8 px-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-semibold text-white rounded flex items-center gap-1.5"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />}
          Subdivide
        </button>
      </div>
    </ModalShell>
  );
}

// ---------- Sub-components ----------

function ModalShell({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="subdivide-dialog"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, icon: Icon, label, hint, id }) {
  return (
    <button
      data-testid={`subdivide-mode-${id}`}
      onClick={onClick}
      className={`flex-1 px-3 py-2 rounded border text-left transition-colors ${
        active
          ? "bg-orange-500/10 border-orange-500/60"
          : "bg-slate-950 border-slate-800 hover:border-slate-600"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
        <Icon size={12} className={active ? "text-orange-300" : "text-slate-500"} />
        {label}
      </div>
      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{hint}</p>
    </button>
  );
}

function AutoPanel({ report, grid, setGrid }) {
  if (!report) return null;
  return (
    <section className="space-y-2" data-testid="subdivide-auto-panel">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
        Cuts per axis
      </div>
      {/* Per-axis numeric stepper. Display the over-by amount so users
          can see WHY a cut is needed on each axis. */}
      {["x", "y", "z"].map((a) => {
        const over = report.over[a];
        const fits = report.fits[a];
        return (
          <div key={a} className="flex items-center gap-2 text-xs">
            <span className="w-4 text-slate-500 uppercase font-mono">{a}</span>
            <button
              data-testid={`subdivide-auto-${a}-dec`}
              onClick={() => setGrid((g) => ({ ...g, [a]: Math.max(0, (g[a] || 0) - 1) }))}
              className="w-6 h-6 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded flex items-center justify-center"
            >
              −
            </button>
            <span data-testid={`subdivide-auto-${a}-value`} className="w-8 text-center font-mono text-orange-300">{grid[a] || 0}</span>
            <button
              data-testid={`subdivide-auto-${a}-inc`}
              onClick={() => setGrid((g) => ({ ...g, [a]: Math.min(8, (g[a] || 0) + 1) }))}
              className="w-6 h-6 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded flex items-center justify-center"
            >
              +
            </button>
            <span className={`text-[10px] ${fits ? "text-slate-500" : "text-amber-300"}`}>
              {fits
                ? `fits (${report.size[a].toFixed(0)} / ${report.build[a].toFixed(0)} mm)`
                : `over by ${over.toFixed(0)} mm`}
            </span>
          </div>
        );
      })}
      <p className="text-[10px] text-slate-500 leading-snug pt-1">
        Auto starts with the minimum cuts that fit the current printer. Bump a counter to over-subdivide
        (e.g. to fit a smaller machine you'll hand the pieces to later).
      </p>
    </section>
  );
}

function ManualPanel({ report, cuts, setCuts }) {
  const [draft, setDraft] = useState({ x: "", y: "", z: "" });
  if (!report) return null;
  const addCut = (axis) => {
    const v = parseFloat(draft[axis]);
    if (Number.isNaN(v)) return;
    const lo = report.bbox.min[axis];
    const hi = report.bbox.max[axis];
    if (v <= lo + 1 || v >= hi - 1) {
      toast.error(`Cut on ${axis.toUpperCase()} must be within ${lo.toFixed(0)} … ${hi.toFixed(0)} mm`);
      return;
    }
    setCuts((c) => ({ ...c, [axis]: [...c[axis], v].sort((a, b) => a - b) }));
    setDraft((d) => ({ ...d, [axis]: "" }));
  };
  const removeCut = (axis, idx) => {
    setCuts((c) => ({ ...c, [axis]: c[axis].filter((_, i) => i !== idx) }));
  };
  return (
    <section className="space-y-2" data-testid="subdivide-manual-panel">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
        Cut planes (world mm)
      </div>
      {["x", "y", "z"].map((a) => (
        <div key={a} className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-4 text-slate-500 uppercase font-mono text-xs">{a}</span>
            <input
              type="number"
              data-testid={`subdivide-manual-${a}-input`}
              placeholder={`${report.bbox.min[a].toFixed(0)} … ${report.bbox.max[a].toFixed(0)}`}
              value={draft[a]}
              onChange={(e) => setDraft((d) => ({ ...d, [a]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") addCut(a); }}
              className="flex-1 h-7 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2 font-mono focus:border-orange-500 outline-none"
            />
            <button
              data-testid={`subdivide-manual-${a}-add`}
              onClick={() => addCut(a)}
              className="h-7 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 rounded flex items-center gap-1"
            >
              <Plus size={11} /> Add
            </button>
          </div>
          {cuts[a].length > 0 && (
            <div className="flex flex-wrap gap-1 ml-6">
              {cuts[a].map((v, i) => (
                <button
                  key={i}
                  data-testid={`subdivide-manual-${a}-chip-${i}`}
                  onClick={() => removeCut(a, i)}
                  className="h-5 px-1.5 bg-slate-800 hover:bg-red-500/20 hover:border-red-500/60 border border-slate-700 text-[10px] font-mono text-slate-200 rounded flex items-center gap-1"
                  title="Remove this cut"
                >
                  {v.toFixed(1)} <Trash2 size={9} />
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <p className="text-[10px] text-slate-500 leading-snug pt-1">
        Each value is the world-axis coordinate (mm) the cut plane passes through. Enter to add.
      </p>
    </section>
  );
}

// Drop manual cuts that fall outside the bbox so a cut that misses the
// geometry never produces a zero-piece artefact downstream.
function sanitiseManual(cuts, report) {
  if (!report) return { x: [], y: [], z: [] };
  const out = {};
  for (const a of ["x", "y", "z"]) {
    const lo = report.bbox.min[a];
    const hi = report.bbox.max[a];
    out[a] = (cuts[a] || []).filter((v) => v > lo + 0.5 && v < hi - 0.5);
  }
  return out;
}

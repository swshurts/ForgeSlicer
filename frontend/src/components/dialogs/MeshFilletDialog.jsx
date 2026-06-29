// Iter-114 — MeshFilletDialog
//
// UI for the Fillet / Chamfer operation on an IMPORTED mesh. Lives at
// the workspace level (mounted from Workspace.jsx via a small open
// flag) but is invoked from the Inspector when an imported object is
// selected. Async Manifold work is cancellable via AbortController so
// the user can dismiss the modal mid-compute without freezing the
// browser.
import React, { useState, useRef, useEffect } from "react";
import { X, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { useScene } from "../../lib/store";
import { applyMeshFillet } from "../../lib/meshFillet";
import { toast } from "sonner";

export default function MeshFilletDialog({ open, onClose, objectId }) {
  const obj = useScene((s) => s.objects.find((o) => o.id === objectId));
  const replaceImportedGeometry = useScene((s) => s.replaceImportedGeometry);
  const [radius, setRadius] = useState(0.8);
  const [mode, setMode] = useState("round"); // "round" | "chamfer"
  const [scope, setScope] = useState("outer"); // "outer" | "inner" | "full"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const abortRef = useRef(null);

  // Reset state when the dialog opens for a new mesh.
  useEffect(() => {
    if (open) {
      setBusy(false);
      setErr(null);
      // Suggest a radius proportional to the smallest mesh dimension —
      // 5% caps out at 3mm. Avoids surprising the user with a kernel
      // bigger than the part they're filleting.
      const bb = obj?.originalBbox;
      if (bb) {
        const minDim = Math.min(bb.x, bb.y, bb.z);
        const suggested = Math.max(0.2, Math.min(3, minDim * 0.05));
        setRadius(Number(suggested.toFixed(2)));
      }
    }
  }, [open, obj?.originalBbox]);

  if (!open || !obj || obj.type !== "imported") return null;

  const handleRun = async () => {
    setBusy(true);
    setErr(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const t0 = performance.now();
      const { vertices, indices } = await applyMeshFillet(obj, {
        radius,
        mode,
        scope,
        signal: ctrl.signal,
      });
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      replaceImportedGeometry(obj.id, vertices, indices);
      toast.success(
        `${mode === "chamfer" ? "Chamfer" : "Fillet"} applied · r=${radius}mm · ${elapsed}s`,
      );
      onClose();
    } catch (e) {
      if (e?.name === "AbortError") {
        toast.message("Mesh fillet cancelled.");
      } else {
        console.error("[meshFillet]", e);
        setErr(e?.message || String(e));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="mesh-fillet-dialog"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-md p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Sparkles size={16} className="text-orange-400" />
              {mode === "chamfer" ? "Chamfer Mesh" : "Fillet Mesh"}
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Rolling-ball edge rounding on{" "}
              <span className="font-mono text-orange-300">{obj.name}</span>
            </p>
          </div>
          <button
            data-testid="mesh-fillet-close-btn"
            onClick={handleCancel}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
            disabled={busy && !abortRef.current}
            title={busy ? "Cancel operation" : "Close"}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Mode tabs — round vs chamfer */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">
              Mode
            </label>
            <div className="flex gap-1.5">
              {[
                { id: "round", label: "Round (Fillet)", hint: "Smooth arcs" },
                { id: "chamfer", label: "Chamfer", hint: "Flat bevels" },
              ].map((m) => (
                <button
                  key={m.id}
                  data-testid={`mesh-fillet-mode-${m.id}`}
                  onClick={() => setMode(m.id)}
                  disabled={busy}
                  className={`flex-1 px-2.5 py-1.5 text-[11px] font-semibold rounded border transition-colors ${
                    mode === m.id
                      ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
                      : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {m.label}
                  <span className="block text-[9px] font-normal opacity-70 mt-0.5">
                    {m.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Scope */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">
              Edges to round
            </label>
            <div className="flex gap-1.5">
              {[
                { id: "outer", label: "Outer", hint: "Convex" },
                { id: "inner", label: "Inner", hint: "Concave" },
                { id: "full", label: "Full", hint: "Both — slow" },
              ].map((s) => (
                <button
                  key={s.id}
                  data-testid={`mesh-fillet-scope-${s.id}`}
                  onClick={() => setScope(s.id)}
                  disabled={busy}
                  className={`flex-1 px-2 py-1.5 text-[10.5px] font-semibold rounded border transition-colors ${
                    scope === s.id
                      ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
                      : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {s.label}
                  <span className="block text-[9px] font-normal opacity-70 mt-0.5">
                    {s.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Radius */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                Radius
              </label>
              <span
                data-testid="mesh-fillet-radius-readout"
                className="text-[10px] font-mono text-orange-400"
              >
                {radius.toFixed(2)} mm
              </span>
            </div>
            <input
              data-testid="mesh-fillet-radius-slider"
              type="range"
              min={0.1}
              max={5}
              step={0.05}
              value={radius}
              onChange={(e) => setRadius(parseFloat(e.target.value))}
              disabled={busy}
              className="w-full accent-orange-500"
            />
            <div className="text-[9.5px] text-slate-500 mt-1 leading-tight">
              Larger radii produce smoother edges but can take 10–60 seconds on complex meshes.
            </div>
          </div>

          {err && (
            <div
              data-testid="mesh-fillet-error"
              className="px-2.5 py-2 rounded bg-red-500/10 border border-red-500/40 text-red-300 text-[11px] flex items-start gap-2"
            >
              <AlertCircle size={12} className="mt-[1px] flex-shrink-0" />
              <span>{err}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end mt-5">
          <button
            data-testid="mesh-fillet-cancel-btn"
            onClick={handleCancel}
            className="px-3 py-1.5 text-[11px] font-semibold rounded border bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
          >
            {busy ? "Cancel" : "Close"}
          </button>
          <button
            data-testid="mesh-fillet-run-btn"
            onClick={handleRun}
            disabled={busy}
            className="px-3 py-1.5 text-[11px] font-semibold rounded border bg-orange-500/20 border-orange-500/60 text-orange-300 hover:bg-orange-500/30 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <Sparkles size={12} />
                Apply
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

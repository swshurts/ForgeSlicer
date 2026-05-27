// Read-only viewer for OrcaSlicer's bundled, inheritance-walked preset
// JSON. Opened from the small "View bundled JSON →" links under the
// OrcaProfileEditor dropdowns so power users can verify exactly what
// config the slicer will load — and so the next preset-name mismatch
// is one click away from being debugged.
import React, { useEffect, useState } from "react";
import { X, FileJson, Loader2, AlertTriangle, Copy, Check } from "lucide-react";
import { orcaApi, apiErrorMessage } from "../../lib/api";

export default function OrcaPresetViewer({ open, vendor, kind, name, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !vendor || !kind || !name) return;
    let cancelled = false;
    setBusy(true); setError(""); setData(null);
    orcaApi.preset({ vendor, kind, name })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(apiErrorMessage(e) || String(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open, vendor, kind, name]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pretty = data ? JSON.stringify(data.preset, null, 2) : "";
  const keyCount = data ? Object.keys(data.preset).length : 0;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silent, user can ctrl+a / ctrl+c */
    }
  };

  return (
    <div
      data-testid="orca-preset-viewer"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-slate-900 border border-purple-500/40 rounded-lg shadow-2xl w-[min(880px,92vw)] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <FileJson size={16} className="text-purple-300 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                {name}
                <span className="text-[10px] text-slate-400 font-normal ml-2 uppercase tracking-wider">{vendor} · {kind}</span>
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                Fully-flattened OrcaSlicer bundled preset (all <code className="text-purple-300">inherits</code> already resolved).
              </div>
            </div>
          </div>
          <button
            data-testid="orca-preset-viewer-close"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          ><X size={16} /></button>
        </div>

        <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <span data-testid="orca-preset-viewer-keys">
            {data ? `${keyCount} keys · ${pretty.length.toLocaleString()} chars` : busy ? "Loading…" : ""}
          </span>
          <button
            data-testid="orca-preset-viewer-copy"
            disabled={!data}
            onClick={onCopy}
            className="h-7 px-2 rounded text-[11px] font-semibold flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors text-purple-200"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 min-h-0">
          {busy && (
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading preset from server…
            </div>
          )}
          {error && (
            <div data-testid="orca-preset-viewer-error" className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded p-3 text-[12px] text-red-200">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {data && (
            <pre
              data-testid="orca-preset-viewer-pre"
              className="text-[11px] font-mono leading-relaxed text-emerald-100 bg-slate-950 border border-slate-800 rounded p-3 whitespace-pre-wrap break-all"
            >{pretty}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { X, FileUp, Loader2, Square, MinusSquare, AlertCircle } from "lucide-react";
import { parseSVGToShapes } from "../lib/svgImport";
import { useScene } from "../lib/store";

/**
 * SVG → extruded-sketch import dialog.
 *
 * Triggered from `forgeslicer:import-svg` window events (dispatched by
 * the toolbar Import button when a .svg file is chosen). Renders a
 * preview list of detected shapes, lets the user pick extrude height +
 * positive/negative modifier + target max size, and drops the imported
 * shapes onto the build plate via the existing `addSketch` action.
 */
export default function SVGImportDialog() {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [svgText, setSvgText] = useState("");
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState(null);
  const [height, setHeight] = useState(5);
  const [maxSize, setMaxSize] = useState(80);
  const [modifier, setModifier] = useState("positive");
  const [busy, setBusy] = useState(false);
  const addSketch = useScene((s) => s.addSketch);

  // Listen for the toolbar's "open with this SVG" event.
  useEffect(() => {
    const onOpen = (e) => {
      const { text, name } = e.detail || {};
      setSvgText(text || "");
      setFilename(name || "import.svg");
      setError("");
      setOpen(true);
    };
    window.addEventListener("forgeslicer:import-svg", onOpen);
    return () => window.removeEventListener("forgeslicer:import-svg", onOpen);
  }, []);

  // Re-parse whenever the text or target size changes — kept cheap by
  // operating on whatever the user already loaded.
  useEffect(() => {
    if (!open || !svgText) return;
    try {
      const r = parseSVGToShapes(svgText, { targetMaxMM: maxSize });
      setParsed(r);
      setError("");
    } catch (e) {
      setError(e.message || String(e));
      setParsed(null);
    }
  }, [open, svgText, maxSize]);

  const handleImport = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      // Import each shape as its own scene object. Lets users delete or
      // reposition individual glyphs (e.g., letters in a logo) without
      // affecting the rest.
      for (const s of parsed.shapes) {
        addSketch(s.points, modifier, height);
      }
      setOpen(false);
    } finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <div
      data-testid="svg-import-dialog"
      className="fixed inset-0 z-[210] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => !busy && setOpen(false)}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-orange-500/30 rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-4 flex items-center gap-2 border-b border-slate-800 bg-orange-500/5 flex-shrink-0">
          <FileUp size={16} className="text-orange-400" />
          <div className="flex-1 text-xs font-semibold uppercase tracking-wider text-orange-300">
            Import SVG
            <span className="text-slate-400 font-mono normal-case ml-2">— {filename}</span>
          </div>
          <button
            data-testid="svg-import-close"
            onClick={() => setOpen(false)}
            className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
          ><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {error ? (
            <div className="bg-red-500/10 border border-red-500/40 text-red-300 text-sm rounded p-3 flex gap-2" data-testid="svg-import-error">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : !parsed ? (
            <div className="flex items-center justify-center py-8 text-slate-500">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            <>
              <div className="bg-slate-950 border border-slate-800 rounded p-3 grid grid-cols-2 gap-y-1.5 text-[11px] font-mono">
                <span className="text-slate-500">Shapes</span>
                <span className="text-orange-300 text-right" data-testid="svg-import-shape-count">{parsed.shapes.length}</span>
                <span className="text-slate-500">Width</span>
                <span className="text-orange-300 text-right">{parsed.bbox.width.toFixed(1)} mm</span>
                <span className="text-slate-500">Height</span>
                <span className="text-orange-300 text-right">{parsed.bbox.height.toFixed(1)} mm</span>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Max size (longest edge)</span>
                <div className="flex items-center gap-2">
                  <input
                    data-testid="svg-import-max-size"
                    type="range" min={10} max={200} step={5}
                    value={maxSize}
                    onChange={(e) => setMaxSize(parseInt(e.target.value, 10))}
                    className="flex-1 accent-orange-500"
                  />
                  <span className="text-xs font-mono text-orange-300 w-14 text-right">{maxSize} mm</span>
                </div>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Extrude height</span>
                <div className="flex items-center gap-2">
                  <input
                    data-testid="svg-import-height"
                    type="range" min={0.5} max={30} step={0.5}
                    value={height}
                    onChange={(e) => setHeight(parseFloat(e.target.value))}
                    className="flex-1 accent-orange-500"
                  />
                  <span className="text-xs font-mono text-orange-300 w-14 text-right">{height} mm</span>
                </div>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  data-testid="svg-import-modifier-positive"
                  onClick={() => setModifier("positive")}
                  className={`h-9 rounded text-xs font-semibold flex items-center justify-center gap-1.5 ${modifier === "positive" ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                >
                  <Square size={12} /> Positive
                </button>
                <button
                  data-testid="svg-import-modifier-negative"
                  onClick={() => setModifier("negative")}
                  className={`h-9 rounded text-xs font-semibold flex items-center justify-center gap-1.5 ${modifier === "negative" ? "bg-red-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                >
                  <MinusSquare size={12} /> Negative
                </button>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            data-testid="svg-import-cancel"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="h-9 px-4 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
          >
            Cancel
          </button>
          <button
            data-testid="svg-import-commit"
            onClick={handleImport}
            disabled={!parsed || busy}
            className="h-9 px-5 rounded bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-xs font-semibold text-white flex items-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
            Import {parsed ? parsed.shapes.length : 0} shape{parsed?.shapes.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

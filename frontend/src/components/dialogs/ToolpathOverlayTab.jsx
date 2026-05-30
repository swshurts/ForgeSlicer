// Engine-comparison toolpath overlay.
//
// Renders both engines' G-code on the SAME 2D canvas with per-engine
// colors plus a layer scrubber. Segments that appear in BOTH engines on
// the matched layer are drawn in muted grey; segments UNIQUE to one
// engine pop in that engine's signature color (orange = Built-in,
// purple = Orca). That gives a "what does Orca add that the built-in
// slicer skips?" visualisation at a glance.
//
// Mounted as a tab inside EngineComparisonDialog. Receives the two
// `{ ok, gcode, ... }` halves of a comparison result.
import React, { useMemo, useRef, useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { parseGcode, pairLayersByZ, diffLayerPair, combinedBbox } from "../../lib/gcodeParser";

const COLOR_BUILTIN_UNIQUE = "#f97316";  // orange
const COLOR_ORCA_UNIQUE    = "#a855f7";  // purple
const COLOR_SHARED         = "#475569";  // slate-600
const CANVAS_PX = 480;
const CANVAS_PADDING = 14;

function strokeMoves(ctx, moves, color, fitX, fitY, lineW = 1.5) {
  if (!moves.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const m of moves) {
    ctx.moveTo(fitX(m.x0), fitY(m.y0));
    ctx.lineTo(fitX(m.x1), fitY(m.y1));
  }
  ctx.stroke();
}

export default function ToolpathOverlayTab({ builtinGcode, orcaGcode }) {
  const canvasRef = useRef(null);
  const [showBuiltin, setShowBuiltin] = useState(true);
  const [showOrca, setShowOrca] = useState(true);
  const [showShared, setShowShared] = useState(true);
  const [layerIdx, setLayerIdx] = useState(0);

  // Parse both gcode dumps once. Heavy work — useMemo gates re-runs on
  // dialog open or when the slice is re-run.
  const parsedA = useMemo(() => parseGcode(builtinGcode || ""), [builtinGcode]);
  const parsedB = useMemo(() => parseGcode(orcaGcode || ""), [orcaGcode]);
  const pairs = useMemo(() => pairLayersByZ(parsedA, parsedB), [parsedA, parsedB]);
  const bbox = useMemo(() => combinedBbox(parsedA, parsedB), [parsedA, parsedB]);

  // Clamp the slider when the underlying pair count changes.
  useEffect(() => {
    if (pairs.length === 0) { setLayerIdx(0); return; }
    if (layerIdx >= pairs.length) setLayerIdx(pairs.length - 1);
  }, [pairs.length, layerIdx]);

  const pair = pairs[layerIdx] || null;
  const diff = useMemo(() => (pair ? diffLayerPair(pair) : null), [pair]);

  // Repaint whenever something changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    if (!pair || (!pair.layerA && !pair.layerB) || !diff) {
      ctx.fillStyle = "#475569";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No layer data on either side", w / 2, h / 2);
      return;
    }

    // Square fit-to-bbox transform. We honour the combined bbox so both
    // engines share an axis-aligned coordinate system.
    const usable = Math.min(w, h) - CANVAS_PADDING * 2;
    const scale = bbox.x > 0 || bbox.y > 0
      ? usable / Math.max(bbox.x || 1, bbox.y || 1)
      : 1;
    const offsetX = CANVAS_PADDING + (usable - bbox.x * scale) / 2;
    const offsetY = CANVAS_PADDING + (usable - bbox.y * scale) / 2;
    const fitX = (x) => offsetX + (x - bbox.minX) * scale;
    const fitY = (y) => h - (offsetY + (y - bbox.minY) * scale);

    // Order: shared first (dim background), unique on top so they
    // visually dominate. Per-engine visibility honors the legend toggles.
    if (showShared) {
      strokeMoves(ctx, diff.sharedA, COLOR_SHARED, fitX, fitY, 1);
    }
    if (showBuiltin) {
      strokeMoves(ctx, diff.uniqueA, COLOR_BUILTIN_UNIQUE, fitX, fitY, 1.4);
    }
    if (showOrca) {
      strokeMoves(ctx, diff.uniqueB, COLOR_ORCA_UNIQUE, fitX, fitY, 1.4);
    }
  }, [pair, diff, bbox, showBuiltin, showOrca, showShared]);

  if (pairs.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-slate-500">
        No paired layers available — both engines must have sliced successfully for the overlay.
      </div>
    );
  }

  const zLabel = (() => {
    if (!pair) return "—";
    const zA = pair.zA != null ? pair.zA.toFixed(2) : "—";
    const zB = pair.zB != null ? pair.zB.toFixed(2) : "—";
    return zA === zB ? `${zA} mm` : `built-in ${zA} mm · orca ${zB} mm`;
  })();

  return (
    <div data-testid="engine-compare-overlay-tab" className="space-y-3">
      {/* Canvas */}
      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          width={CANVAS_PX}
          height={CANVAS_PX}
          data-testid="engine-compare-overlay-canvas"
          className="rounded border border-slate-700 bg-black"
        />
      </div>

      {/* Layer scrubber */}
      <div className="bg-slate-950 border border-slate-700 rounded p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
          <span>Layer <span className="text-orange-300">{layerIdx + 1}</span> / {pairs.length}</span>
          <span className="text-slate-500">{zLabel}</span>
        </div>
        <input
          type="range"
          data-testid="engine-compare-overlay-layer-slider"
          min={0}
          max={Math.max(0, pairs.length - 1)}
          value={layerIdx}
          onChange={(e) => setLayerIdx(parseInt(e.target.value, 10))}
          className="w-full accent-orange-500"
        />
      </div>

      {/* Legend with per-class toggles */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <LegendChip
          testid="engine-compare-overlay-toggle-builtin"
          color={COLOR_BUILTIN_UNIQUE}
          label={`Built-in only · ${diff?.stats.uniqueACount || 0}`}
          on={showBuiltin}
          onToggle={() => setShowBuiltin((v) => !v)}
        />
        <LegendChip
          testid="engine-compare-overlay-toggle-orca"
          color={COLOR_ORCA_UNIQUE}
          label={`Orca only · ${diff?.stats.uniqueBCount || 0}`}
          on={showOrca}
          onToggle={() => setShowOrca((v) => !v)}
        />
        <LegendChip
          testid="engine-compare-overlay-toggle-shared"
          color={COLOR_SHARED}
          label={`Shared · ${diff?.stats.sharedCount || 0}`}
          on={showShared}
          onToggle={() => setShowShared((v) => !v)}
        />
      </div>

      <div className="text-[10px] text-slate-500 leading-snug">
        Orange = segments only the Built-in slicer drew on this layer · purple = segments only Orca drew ·
        grey = segments both engines produced (within a 0.4 mm endpoint tolerance, ignoring direction).
        Use the slider to step through layers; the canvas auto-scales to the combined extrusion bbox.
      </div>
    </div>
  );
}

function LegendChip({ color, label, on, onToggle, testid }) {
  return (
    <button
      onClick={onToggle}
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium transition-colors ${
        on ? "bg-slate-900 border-slate-700 text-slate-200" : "bg-slate-950 border-slate-800 text-slate-500"
      }`}
    >
      <span className="w-3 h-3 rounded-sm" style={{ background: on ? color : "transparent", border: `1px solid ${color}` }} />
      <span>{label}</span>
      {on ? <Eye size={10} /> : <EyeOff size={10} />}
    </button>
  );
}

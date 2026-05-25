import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Eye, Play, Pause, ChevronLeft, ChevronRight, Layers as LayersIcon } from "lucide-react";

/**
 * GCODE preview viewer.
 *
 * Renders a 2D top-down toolpath visualisation for the most recent slice:
 *   - parse every layer's G0 (travel) and G1 (extrude) moves
 *   - parse `; TOOL:n hex=#...` markers (multi-material / AMS prints) so
 *     each segment can be attributed to its source extruder/filament
 *   - paint per-layer into a square canvas, auto-fit to bounding box
 *   - scrubber slider lets the user step through layers + play/pause
 *
 * Color legend:
 *   - single-material prints: orange = extrusion, dim grey = travel
 *   - multi-material (AMS) prints: each extruder's segments use that
 *     filament's hex color from `; AMS_TABLE` / `; TOOL:` markers,
 *     visible/hidden via the per-tool toggles in the legend
 *
 * Keeping this component standalone — receives raw GCODE text + a close
 * handler. The Slicer popover hands off both whenever a slice succeeds.
 */
export default function GcodePreviewDialog({ open, gcode, filename, onClose }) {
  const canvasRef = useRef(null);
  const [layerIdx, setLayerIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hiddenTools, setHiddenTools] = useState(() => new Set());

  // Parse GCODE once per dialog open. Layers are bucketed at every
  // `; LAYER:n` comment — the same convention our slicer emits.
  const parsed = useMemo(() => parseGcode(gcode || ""), [gcode]);
  const totalLayers = parsed.layers.length;
  const isMulti = parsed.tools.length >= 2;

  // Reset to layer 0 + show every tool whenever a fresh GCODE payload arrives.
  useEffect(() => {
    setLayerIdx(0);
    setPlaying(false);
    setHiddenTools(new Set());
  }, [gcode]);

  // Playback loop — advance one layer every 100ms, stop at the end.
  useEffect(() => {
    if (!playing || totalLayers === 0) return undefined;
    const t = setInterval(() => {
      setLayerIdx((i) => {
        if (i + 1 >= totalLayers) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 100);
    return () => clearInterval(t);
  }, [playing, totalLayers]);

  // Repaint the canvas whenever the layer, hidden-tool set, or dialog open state changes.
  useEffect(() => {
    if (!open || !canvasRef.current || totalLayers === 0) return;
    paintLayer(canvasRef.current, parsed, layerIdx, hiddenTools);
  }, [open, parsed, layerIdx, totalLayers, hiddenTools]);

  if (!open) return null;

  const layer = parsed.layers[layerIdx] || null;
  const toolChangeCount = layer ? layer.toolChanges : 0;
  return (
    <div
      data-testid="gcode-preview-dialog"
      className="fixed inset-0 z-[210] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-slate-900 border border-orange-500/30 rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-4 flex items-center gap-2 border-b border-slate-800 bg-orange-500/5 flex-shrink-0">
          <Eye size={16} className="text-orange-400" />
          <div className="flex-1 text-xs font-semibold uppercase tracking-wider text-orange-300">
            GCODE Preview {filename ? <span className="text-slate-400 font-mono normal-case ml-2">— {filename}</span> : null}
            {isMulti ? <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 normal-case tracking-normal font-mono" data-testid="gcode-preview-ams-badge">AMS · {parsed.tools.length} tools</span> : null}
          </div>
          <button
            data-testid="gcode-preview-close-btn"
            onClick={onClose}
            className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          {totalLayers === 0 ? (
            <div className="text-sm text-slate-400 py-6 text-center">
              No layers detected — try slicing first.
            </div>
          ) : (
            <>
              <div className="bg-slate-950 border border-slate-800 rounded p-2 flex items-center justify-center">
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={560}
                  className="bg-black rounded"
                  data-testid="gcode-preview-canvas"
                />
              </div>

              {/* Layer scrubber */}
              <div className="flex items-center gap-3" data-testid="gcode-preview-scrubber">
                <button
                  data-testid="gcode-preview-prev-btn"
                  onClick={() => setLayerIdx((i) => Math.max(0, i - 1))}
                  disabled={layerIdx === 0}
                  className="h-8 w-8 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 flex items-center justify-center"
                  title="Previous layer"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  data-testid="gcode-preview-play-btn"
                  onClick={() => setPlaying((p) => !p)}
                  className="h-8 w-8 rounded bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center"
                  title={playing ? "Pause" : "Play"}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  data-testid="gcode-preview-next-btn"
                  onClick={() => setLayerIdx((i) => Math.min(totalLayers - 1, i + 1))}
                  disabled={layerIdx >= totalLayers - 1}
                  className="h-8 w-8 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 flex items-center justify-center"
                  title="Next layer"
                >
                  <ChevronRight size={14} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, totalLayers - 1)}
                  value={layerIdx}
                  onChange={(e) => { setPlaying(false); setLayerIdx(parseInt(e.target.value, 10)); }}
                  className="flex-1 accent-orange-500"
                  data-testid="gcode-preview-slider"
                />
              </div>

              {/* Layer stats */}
              <div className="grid grid-cols-5 gap-2 text-[11px] font-mono">
                <Stat label="Layer" value={`${layerIdx + 1} / ${totalLayers}`} />
                <Stat label="Z" value={layer ? `${layer.z.toFixed(2)} mm` : "—"} />
                <Stat label="Extrude" value={layer ? `${layer.extrudeMoves}` : "—"} />
                <Stat label="Travel" value={layer ? `${layer.travelMoves}` : "—"} />
                <Stat label="Tool Chg" value={isMulti ? `${toolChangeCount}` : "—"} />
              </div>

              {/* Legend + per-tool toggles. Single-material prints fall back
                  to the simple orange-extrude / grey-travel legend. */}
              {isMulti ? (
                <div className="flex flex-wrap items-center gap-2 px-1" data-testid="gcode-preview-tool-legend">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <LayersIcon size={11} /> Extruders
                  </span>
                  {parsed.tools.map((t) => {
                    const hidden = hiddenTools.has(t.index);
                    return (
                      <button
                        key={t.index}
                        data-testid={`gcode-preview-tool-${t.index}-toggle`}
                        onClick={() => setHiddenTools((set) => {
                          const next = new Set(set);
                          if (next.has(t.index)) next.delete(t.index); else next.add(t.index);
                          return next;
                        })}
                        className={`flex items-center gap-1.5 px-2 h-6 rounded border text-[10px] font-mono transition-colors ${
                          hidden
                            ? "bg-slate-900 border-slate-800 text-slate-600"
                            : "bg-slate-950 border-slate-700 text-slate-200 hover:border-orange-500/60"
                        }`}
                        title={hidden ? "Show this extruder" : "Hide this extruder"}
                      >
                        <span
                          className="inline-block w-3 h-3 rounded-sm border border-black/40"
                          style={{ background: hidden ? "#1f2937" : t.hex }}
                        />
                        T{t.index}
                        {t.name ? <span className="text-slate-500">· {t.name}</span> : null}
                      </button>
                    );
                  })}
                  <span className="ml-auto text-[10px] text-slate-500 font-mono">
                    {parsed.bbox.x.toFixed(0)}×{parsed.bbox.y.toFixed(0)} mm
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-4 text-[10px] text-slate-400 px-1">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 bg-orange-400" /> extrude (print)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 bg-slate-600" /> travel (no extrusion)
                  </span>
                  <span className="ml-auto text-slate-500">{parsed.bbox.x.toFixed(0)}×{parsed.bbox.y.toFixed(0)} mm</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1 flex flex-col">
      <span className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</span>
      <span className="text-orange-300">{value}</span>
    </div>
  );
}

// ---------- GCODE parsing ----------
// Read modal X / Y / Z and group moves per `; LAYER:n` block. We track the
// active tool index via `T<n>` lines and `; TOOL:n hex=#... name=<name>`
// markers — the AMS palette declared in the header (`; AMS_TABLE T0=#...`)
// determines the default colour for any tool we encounter mid-stream.
function parseGcode(gcode) {
  const layers = [];
  const toolMap = new Map(); // index → { index, hex, name }
  let cur = null;
  let x = 0, y = 0, z = 0;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  let activeTool = 0;

  const lines = gcode.split("\n");
  for (const raw of lines) {
    const line = raw.trim();

    // AMS color table — declared once in the header.
    const mAms = /^;\s*AMS_TABLE\s+(.+)$/.exec(line);
    if (mAms) {
      const re = /T(\d+)\s*=\s*(#[0-9a-fA-F]{6})/g;
      let m;
      while ((m = re.exec(mAms[1])) !== null) {
        const idx = parseInt(m[1], 10);
        const existing = toolMap.get(idx) || { index: idx };
        toolMap.set(idx, { ...existing, hex: m[2] });
      }
      continue;
    }

    // Tool marker — tells the preview which extruder/filament is about
    // to deposit material. We update activeTool here so any moves
    // between this marker and the next layer/tool marker attribute to
    // it. Also acts as a tool-change indicator if it differs from the
    // currently-active tool (counted on the current layer).
    const mTool = /^;\s*TOOL:\s*(\d+)\s*(?:hex=(#[0-9a-fA-F]{6}))?\s*(?:name=(.+))?$/.exec(line);
    if (mTool) {
      const idx = parseInt(mTool[1], 10);
      const hex = mTool[2];
      const name = (mTool[3] || "").trim();
      const existing = toolMap.get(idx) || { index: idx };
      toolMap.set(idx, {
        index: idx,
        hex: hex || existing.hex,
        name: name || existing.name,
      });
      if (cur && idx !== activeTool) {
        cur.toolChanges = (cur.toolChanges || 0) + 1;
        // Drop a visual marker at the current XY so the canvas can dot
        // it on top of the toolpaths.
        cur.toolChangeMarkers.push({ x, y, tool: idx });
      }
      activeTool = idx;
      continue;
    }

    if (!line || line.startsWith(";")) {
      const mLayer = /^;\s*LAYER:\s*(\d+)\s*z\s*=\s*([0-9.+-eE]+)/.exec(line);
      if (mLayer) {
        cur = {
          idx: parseInt(mLayer[1], 10),
          z: parseFloat(mLayer[2]),
          moves: [],
          toolChangeMarkers: [],
          extrudeMoves: 0,
          travelMoves: 0,
          toolChanges: 0,
        };
        layers.push(cur);
      }
      continue;
    }

    // Explicit tool change (`T<n>`) — same effect as a `; TOOL:` marker.
    const mT = /^T(\d+)\b/.exec(line);
    if (mT) {
      const idx = parseInt(mT[1], 10);
      if (cur && idx !== activeTool) {
        cur.toolChanges = (cur.toolChanges || 0) + 1;
        cur.toolChangeMarkers.push({ x, y, tool: idx });
      }
      if (!toolMap.has(idx)) toolMap.set(idx, { index: idx });
      activeTool = idx;
      continue;
    }

    // Quick reject — only G0 / G1 are toolpath moves.
    if (!/^G[01]\b/.test(line)) continue;
    const isG0 = /^G0\b/.test(line);
    const nx = readArg(line, "X");
    const ny = readArg(line, "Y");
    const nz = readArg(line, "Z");
    const hasE = /\sE-?[0-9]/.test(line);
    if (nz != null) z = nz;
    const fromX = x, fromY = y;
    if (nx != null) x = nx;
    if (ny != null) y = ny;
    if (cur) {
      if (nx != null || ny != null) {
        const extruding = !isG0 && hasE;
        cur.moves.push({ x0: fromX, y0: fromY, x1: x, y1: y, extruding, tool: activeTool });
        if (extruding) cur.extrudeMoves++; else cur.travelMoves++;
        if (extruding) {
          if (x < xMin) xMin = x; if (x > xMax) xMax = x;
          if (y < yMin) yMin = y; if (y > yMax) yMax = y;
          if (fromX < xMin) xMin = fromX; if (fromX > xMax) xMax = fromX;
          if (fromY < yMin) yMin = fromY; if (fromY > yMax) yMax = fromY;
        }
      }
    }
  }
  if (!isFinite(xMin)) { xMin = 0; xMax = 0; yMin = 0; yMax = 0; }

  // Resolve tools — sorted by index for stable legend order. Any tool
  // referenced by a move but missing a hex falls back to the default
  // orange so it's still visible.
  const tools = Array.from(toolMap.values())
    .sort((a, b) => a.index - b.index)
    .map((t) => ({
      index: t.index,
      hex: t.hex || "#f97316",
      name: t.name || "",
    }));

  return {
    layers,
    tools,
    bbox: { x: xMax - xMin, y: yMax - yMin, minX: xMin, minY: yMin, maxX: xMax, maxY: yMax },
  };
}

function readArg(line, ch) {
  const re = new RegExp(`\\s${ch}(-?[0-9]*\\.?[0-9]+)`);
  const m = re.exec(" " + line);
  return m ? parseFloat(m[1]) : null;
}

// ---------- Paint ----------
function paintLayer(canvas, parsed, idx, hiddenTools) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const layer = parsed.layers[idx];
  if (!layer) return;
  const bb = parsed.bbox;
  // Pad 5% so lines don't touch the canvas edge.
  const pad = 0.05;
  const sx = w * (1 - 2 * pad) / Math.max(bb.x, 1);
  const sy = h * (1 - 2 * pad) / Math.max(bb.y, 1);
  const s = Math.min(sx, sy);
  const cx = (w - s * bb.x) / 2;
  const cy = (h - s * bb.y) / 2;
  const map = (x, y) => {
    // Flip Y so the print's +Y is up on screen.
    const px = cx + (x - bb.minX) * s;
    const py = h - cy - (y - bb.minY) * s;
    return [px, py];
  };

  // Single-material prints: legacy orange/grey rendering for parity with
  // the previous viewer. Multi-material prints get one stroke pass per
  // extruder so the colours stay distinct.
  const isMulti = parsed.tools.length >= 2;

  // Travel moves first — drawn dim under extrusion lines for clarity.
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "rgba(120, 120, 130, 0.45)";
  ctx.beginPath();
  for (const m of layer.moves) {
    if (m.extruding) continue;
    if (hiddenTools && hiddenTools.has(m.tool)) continue;
    const [x0, y0] = map(m.x0, m.y0);
    const [x1, y1] = map(m.x1, m.y1);
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  }
  ctx.stroke();

  // Extrusion strokes — one batched path per tool so the canvas only
  // changes strokeStyle at most `tools.length` times per repaint.
  if (isMulti) {
    const byTool = new Map();
    for (const m of layer.moves) {
      if (!m.extruding) continue;
      if (hiddenTools && hiddenTools.has(m.tool)) continue;
      if (!byTool.has(m.tool)) byTool.set(m.tool, []);
      byTool.get(m.tool).push(m);
    }
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    for (const t of parsed.tools) {
      const moves = byTool.get(t.index);
      if (!moves || moves.length === 0) continue;
      ctx.strokeStyle = t.hex;
      ctx.beginPath();
      for (const m of moves) {
        const [x0, y0] = map(m.x0, m.y0);
        const [x1, y1] = map(m.x1, m.y1);
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }

    // Tool-change indicators — small ring at the position where each
    // tool change happened, coloured with the new tool's hex. Skipped
    // when that tool is currently hidden.
    for (const marker of (layer.toolChangeMarkers || [])) {
      if (hiddenTools && hiddenTools.has(marker.tool)) continue;
      const tool = parsed.tools.find((t) => t.index === marker.tool);
      const [px, py] = map(marker.x, marker.y);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.9)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = (tool && tool.hex) || "#f97316";
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#f97316";
    ctx.beginPath();
    for (const m of layer.moves) {
      if (!m.extruding) continue;
      const [x0, y0] = map(m.x0, m.y0);
      const [x1, y1] = map(m.x1, m.y1);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }
}

import React, { useEffect, useRef, useState } from "react";
import { Pencil, Square, Circle as CircleIcon, X, Check, Undo2, Hexagon, MousePointer2 } from "lucide-react";
import { useScene } from "../lib/store";

/**
 * Sketch / 2D drawing overlay.
 *
 * When `useScene.sketchMode === true`, this component renders an absolutely-
 * positioned canvas on top of the workspace and intercepts pointer events.
 * The user draws on a top-down view of the build plate; on commit the
 * drawn shape becomes a new `sketch` scene object (extruded along Y by
 * `extrudeHeight` mm).
 *
 * Tools (top-bar inside the overlay):
 *   - **Pencil**: click to add polyline vertices. Double-click or Enter to
 *     close. Useful for organic outlines.
 *   - **Rect**: drag from corner to corner. Snaps to right-angled rectangle.
 *   - **Circle**: drag from center to radius. Approximated by a 48-segment
 *     polygon (smooth enough to look round at any zoom; rough enough that
 *     three.js's ExtrudeGeometry stays cheap).
 *
 * Build-plate axes:
 *   - X is horizontal (left → right), Z is vertical (top → bottom on screen).
 *   - The user draws as if looking straight down at the bed; on extrude
 *     the shape rises along +Y.
 */
export default function SketchOverlay() {
  const sketchMode = useScene((s) => s.sketchMode);
  const setSketchMode = useScene((s) => s.setSketchMode);
  const addSketch = useScene((s) => s.addSketch);
  const buildVolume = useScene((s) => s.buildVolume);

  const canvasRef = useRef(null);
  const [tool, setTool] = useState("pencil");
  const [modifier, setModifier] = useState("positive");
  const [extrudeHeight, setExtrudeHeight] = useState(5);
  // Pencil polyline as a list of build-plate [x, z] points (mm).
  const [points, setPoints] = useState([]);
  // For rect/circle: in-progress drag start/end (also build-plate coords).
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  // Hover position — drawn as a ghost cursor + a preview line from the last
  // committed pencil point so the user sees where the next click lands.
  const [hover, setHover] = useState(null);

  // Reset every tool's working state when entering/exiting sketch mode or
  // switching tools so a half-drawn pencil polyline doesn't leak between
  // sessions.
  useEffect(() => {
    if (!sketchMode) {
      setPoints([]); setDragStart(null); setDragEnd(null); setHover(null);
    }
  }, [sketchMode]);
  useEffect(() => {
    setPoints([]); setDragStart(null); setDragEnd(null);
  }, [tool]);

  // Re-paint whenever any input changes. Painting the full canvas every
  // frame is fine here — the build plate is small (1-2k px) and we only
  // repaint on user input, never on a RAF loop.
  useEffect(() => {
    if (!sketchMode) return;
    paint(canvasRef.current, { tool, points, dragStart, dragEnd, hover, buildVolume });
  }, [sketchMode, tool, points, dragStart, dragEnd, hover, buildVolume]);

  // Cancel / commit shortcuts.
  useEffect(() => {
    if (!sketchMode) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (points.length || dragStart) {
          // First Escape clears the in-progress shape; second exits sketch mode.
          setPoints([]); setDragStart(null); setDragEnd(null);
        } else {
          setSketchMode(false);
        }
      } else if (e.key === "Enter") commit();
      else if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        // Undo last pencil point — quality-of-life.
        if (tool === "pencil" && points.length) {
          setPoints((p) => p.slice(0, -1));
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sketchMode, points, dragStart, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sketchMode) return null;

  // Translate a canvas-pixel event into build-plate [x, z] mm.
  const toPlate = (evt) => {
    const c = canvasRef.current;
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    const px = evt.clientX - rect.left, py = evt.clientY - rect.top;
    const { x: bx, y: by } = plateExtents(c, buildVolume);
    // Snap to 1mm grid — feels precise without being painful.
    const mx = Math.round(((px - by.padX) / by.scale) - bx.bx / 2);
    const mz = Math.round(((py - by.padY) / by.scale) - bx.bz / 2);
    return [mx, mz];
  };

  const handleDown = (e) => {
    const p = toPlate(e); if (!p) return;
    if (tool === "pencil") {
      setPoints((prev) => [...prev, p]);
    } else {
      setDragStart(p); setDragEnd(p);
    }
  };
  const handleMove = (e) => {
    const p = toPlate(e); if (!p) return;
    setHover(p);
    if ((tool === "rect" || tool === "circle") && dragStart) setDragEnd(p);
  };
  const handleUp = (e) => {
    if ((tool === "rect" || tool === "circle") && dragStart) {
      const p = toPlate(e); if (!p) return;
      // Convert the in-progress drag into a committed shape immediately —
      // rect/circle are one-and-done tools (no multi-click).
      const pts = shapePoints(tool, dragStart, p);
      if (pts.length >= 3) {
        const id = addSketch(pts, modifier, extrudeHeight);
        if (id) setSketchMode(false);
      }
      setDragStart(null); setDragEnd(null);
    }
  };
  const handleDoubleClick = () => { if (tool === "pencil") commit(); };

  const commit = () => {
    if (tool === "pencil") {
      if (points.length < 3) return;
      const id = addSketch(points, modifier, extrudeHeight);
      if (id) setSketchMode(false);
    }
  };

  // Compute build-plate dimensions for the on-screen mm/grid mapping.
  const bx = buildVolume?.x || 220;
  const bz = buildVolume?.y || 220;  // store's buildVolume.y maps to plate Z

  return (
    <div className="absolute inset-0 z-[80] bg-slate-950/95 flex flex-col" data-testid="sketch-overlay">
      {/* Toolbar */}
      <div className="h-12 px-3 flex items-center gap-2 border-b border-slate-800 bg-slate-900">
        <Hexagon size={14} className="text-orange-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-orange-300">Sketch</span>
        <span className="text-[10px] text-slate-500 ml-2">Drawing on build plate ({bx}×{bz}mm)</span>
        <div className="flex-1" />

        <ToolButton testid="sketch-tool-pencil" Icon={Pencil} label="Pencil" active={tool === "pencil"} onClick={() => setTool("pencil")} />
        <ToolButton testid="sketch-tool-rect" Icon={Square} label="Rect" active={tool === "rect"} onClick={() => setTool("rect")} />
        <ToolButton testid="sketch-tool-circle" Icon={CircleIcon} label="Circle" active={tool === "circle"} onClick={() => setTool("circle")} />

        <div className="w-px h-7 bg-slate-700 mx-1" />

        <select
          data-testid="sketch-modifier"
          value={modifier}
          onChange={(e) => setModifier(e.target.value)}
          className="h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2"
        >
          <option value="positive">Positive (add)</option>
          <option value="negative">Negative (cut)</option>
        </select>
        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          Height
          <input
            data-testid="sketch-extrude-height"
            type="number"
            value={extrudeHeight}
            min={0.5}
            step={0.5}
            onChange={(e) => setExtrudeHeight(Math.max(0.5, parseFloat(e.target.value) || 5))}
            className="w-14 h-7 bg-slate-950 border border-slate-700 rounded text-xs text-white px-1 text-right"
          />
          mm
        </label>

        <div className="w-px h-7 bg-slate-700 mx-1" />

        {tool === "pencil" && points.length > 0 && (
          <button
            data-testid="sketch-undo-point"
            onClick={() => setPoints((p) => p.slice(0, -1))}
            className="h-8 px-2 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1"
            title="Undo last point (⌘Z)"
          >
            <Undo2 size={12} /> Undo
          </button>
        )}
        <button
          data-testid="sketch-commit"
          onClick={commit}
          disabled={tool === "pencil" ? points.length < 3 : !dragStart}
          className="h-8 px-3 rounded bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-xs font-semibold text-white flex items-center gap-1"
        >
          <Check size={12} /> Commit
        </button>
        <button
          data-testid="sketch-exit"
          onClick={() => setSketchMode(false)}
          className="h-8 px-3 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1"
        >
          <X size={12} /> Exit
        </button>
      </div>

      {/* Hint bar */}
      <div className="px-3 py-1.5 bg-slate-900/80 border-b border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
        <MousePointer2 size={11} className="text-slate-500" />
        {tool === "pencil" && (
          <span>Click to add corners. Double-click or press <kbd className="text-orange-300">Enter</kbd> to close. <kbd className="text-orange-300">⌘Z</kbd> undoes the last point. <kbd className="text-orange-300">Esc</kbd> cancels.</span>
        )}
        {tool === "rect" && <span>Drag from one corner to the opposite corner. Release to commit.</span>}
        {tool === "circle" && <span>Drag from the center outward to set the radius. Release to commit.</span>}
      </div>

      {/* Canvas — fills remaining space. */}
      <div className="flex-1 flex items-center justify-center p-4">
        <canvas
          ref={canvasRef}
          width={900}
          height={700}
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onDoubleClick={handleDoubleClick}
          className="bg-slate-950 border border-slate-800 rounded cursor-crosshair"
          data-testid="sketch-canvas"
        />
      </div>
    </div>
  );
}

function ToolButton({ Icon, label, active, onClick, testid }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`h-8 px-2 rounded text-xs font-semibold flex items-center gap-1 ${active ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
      title={label}
    >
      <Icon size={12} /> {label}
    </button>
  );
}

// ---------- Geometry helpers ----------

// Build the closed polygon for the current rect/circle drag. We pass it
// into `addSketch` so the resulting object uses the same `points` shape
// the pencil tool produces.
function shapePoints(tool, a, b) {
  if (!a || !b) return [];
  if (tool === "rect") {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    if (x1 - x0 < 1 || z1 - z0 < 1) return [];
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  }
  if (tool === "circle") {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const r = Math.hypot(dx, dy);
    if (r < 1) return [];
    const segs = 48;
    const out = [];
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      out.push([a[0] + Math.cos(t) * r, a[1] + Math.sin(t) * r]);
    }
    return out;
  }
  return [];
}

// Compute padded plate region inside the canvas with isotropic scale so
// the build plate fits with breathing room and grid lines stay square.
function plateExtents(canvas, buildVolume) {
  const W = canvas.width, H = canvas.height;
  const bx = buildVolume?.x || 220;
  const bz = buildVolume?.y || 220;
  const pad = 40;
  const scale = Math.min((W - 2 * pad) / bx, (H - 2 * pad) / bz);
  const drawW = bx * scale, drawH = bz * scale;
  const padX = (W - drawW) / 2;
  const padY = (H - drawH) / 2;
  return { x: { bx, bz }, y: { padX, padY, scale, drawW, drawH } };
}

function paint(canvas, { tool, points, dragStart, dragEnd, hover, buildVolume }) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);

  const ex = plateExtents(canvas, buildVolume);
  const { padX, padY, scale, drawW, drawH } = ex.y;
  const { bx, bz } = ex.x;

  // Plate rectangle
  ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, padY, drawW, drawH);
  // 10mm grid
  ctx.strokeStyle = "rgba(71, 85, 105, 0.4)";
  ctx.lineWidth = 0.5;
  for (let mm = 10; mm < bx; mm += 10) {
    const x = padX + mm * scale;
    ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, padY + drawH); ctx.stroke();
  }
  for (let mm = 10; mm < bz; mm += 10) {
    const y = padY + mm * scale;
    ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + drawW, y); ctx.stroke();
  }

  // Origin crosshair
  ctx.strokeStyle = "rgba(249, 115, 22, 0.5)";
  ctx.lineWidth = 1;
  const ox = padX + (bx / 2) * scale, oy = padY + (bz / 2) * scale;
  ctx.beginPath(); ctx.moveTo(ox - 8, oy); ctx.lineTo(ox + 8, oy);
  ctx.moveTo(ox, oy - 8); ctx.lineTo(ox, oy + 8); ctx.stroke();

  const toPx = ([mx, mz]) => [padX + (mx + bx / 2) * scale, padY + (mz + bz / 2) * scale];

  // Pencil: existing polyline
  if (tool === "pencil" && points.length > 0) {
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = toPx(p);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Hover preview line from last point
    if (hover) {
      const [hx, hy] = toPx(hover);
      const [lx, ly] = toPx(points[points.length - 1]);
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(hx, hy);
      ctx.strokeStyle = "rgba(249, 115, 22, 0.4)";
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Dots
    ctx.fillStyle = "#f97316";
    points.forEach((p) => {
      const [x, y] = toPx(p);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
  }

  // Rect / circle in-progress
  if ((tool === "rect" || tool === "circle") && dragStart && dragEnd) {
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "rgba(249, 115, 22, 0.1)";
    if (tool === "rect") {
      const [x0, y0] = toPx([Math.min(dragStart[0], dragEnd[0]), Math.min(dragStart[1], dragEnd[1])]);
      const [x1, y1] = toPx([Math.max(dragStart[0], dragEnd[0]), Math.max(dragStart[1], dragEnd[1])]);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      const [cx, cy] = toPx(dragStart);
      const dx = dragEnd[0] - dragStart[0], dy = dragEnd[1] - dragStart[1];
      const r = Math.hypot(dx, dy) * scale;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  // Hover coords readout (always visible — helps the user place precisely)
  if (hover) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(8, H - 28, 130, 20);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(`X ${hover[0].toString().padStart(4)}  Z ${hover[1].toString().padStart(4)}`, 14, H - 14);
  }
}

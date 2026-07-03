// Iter-114.3 — TinkerCAD-parity dimension HUD.
//
// Renders for the primary selection (when DIMS is on):
//   • 3 colour-coded W / D / H dimension chips connected by SHORT
//     LEADER LINES + arrows to the edge midpoints they measure.
//   • 3 POSITION chips pinned at the front-left-bottom corner of the
//     bbox, showing the corner's coords RELATIVE to the workplane
//     ruler origin when active (else workplane origin = 0,0,0).
//   • Translucent white chip styling matches TinkerCAD's look so the
//     labels never feel like opaque popovers blocking the geometry.
//   • Chips and ruler can coexist — we no longer auto-hide when the
//     ruler is on.
import React, { useState, useRef, useEffect, useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import { useScene } from "../../lib/store";
import { computeRotatedBBox } from "../../lib/geometry";
import { toDisplayLen, fromDisplayLen } from "../../lib/units";

const COLOR_X = "#E11D48"; // rose-600  — slightly darker so it reads on white
const COLOR_Y = "#059669"; // emerald-600
const COLOR_Z = "#2563EB"; // blue-600

function isAxisEditable(obj, axis) {
  if (!obj) return false;
  if (obj.locked) return false;
  if (obj.type === "cube") return true;
  if (obj.type === "sphere") return true;
  if (obj.type === "cylinder" || obj.type === "cone") return true;
  if (obj.type === "imported" && obj.originalBbox) return true;
  return false;
}

// Resize so the object's world bbox along `axis` becomes `mm`.
// Ratio-based: parametric dims are multiplied by target/current, which
// keeps this correct for objects carrying a scale factor (e.g. after a
// group scale) or a rotation — writing the raw mm into dims would be
// wrong by the scale factor (user bug: 120mm bar → typed 100 → 600mm).
function commitAxisLength(obj, axis, mm, currentMm, actions) {
  if (!obj || !Number.isFinite(mm) || mm <= 0) return;
  if (!Number.isFinite(currentMm) || currentMm <= 1e-6) return;
  const ratio = mm / currentMm;
  const { updateDims, setImportedDim } = actions;
  if (obj.type === "cube") {
    updateDims(obj.id, { [axis]: (obj.dims?.[axis] ?? 20) * ratio });
    return;
  }
  if (obj.type === "sphere") {
    updateDims(obj.id, { r: (obj.dims?.r ?? 10) * ratio });
    return;
  }
  if (obj.type === "cylinder") {
    if (axis === "z") updateDims(obj.id, { h: (obj.dims?.h ?? 20) * ratio });
    else updateDims(obj.id, { r: (obj.dims?.r ?? 10) * ratio });
    return;
  }
  if (obj.type === "cone") {
    if (axis === "z") { updateDims(obj.id, { h: (obj.dims?.h ?? 20) * ratio }); }
    else {
      const oldR1 = obj.dims?.r1 ?? obj.dims?.r ?? 10;
      const oldR2 = obj.dims?.r2 ?? 0;
      updateDims(obj.id, { r1: oldR1 * ratio, r2: oldR2 * ratio });
    }
    return;
  }
  if (obj.type === "imported" && obj.originalBbox) {
    const idx = { x: 0, y: 1, z: 2 }[axis];
    const current = (obj.originalBbox?.[axis] ?? 1) * (obj.scale?.[idx] ?? 1);
    setImportedDim(obj.id, axis, current * ratio);
  }
}

/**
 * Editable dimension chip with a leader line to its anchored edge.
 *
 * `anchor` is the WORLD point on the bbox edge midpoint that the chip
 * measures. `position` is where the chip itself floats (a bit offset
 * so it doesn't overlap geometry). A dashed line + arrowhead renders
 * between them so users can tell which chip belongs to which edge.
 */
function DimChip({ axis, worldMm, color, position, anchor, screenOffset, editable, unitSystem, onCommit, testid }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) {
      const d = unitSystem === "in" ? 3 : 2;
      setValue(toDisplayLen(worldMm, unitSystem).toFixed(d));
    }
  }, [worldMm, unitSystem, editing]);

  useEffect(() => {
    if (!editing) return undefined;
    // Focus twice — immediately and after a short delay. Drei's <Html>
    // re-appends its container to the DOM right after mount, which
    // silently drops focus gained in the same tick (input stays open
    // but keystrokes go to <body>).
    if (inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
    const t = setTimeout(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 80);
    return () => clearTimeout(t);
  }, [editing]);

  const commit = () => {
    const display = parseFloat(value);
    if (Number.isFinite(display) && display > 0) onCommit(fromDisplayLen(display, unitSystem));
    setEditing(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
    e.stopPropagation();
  };

  const axisLabel = axis === "x" ? "W" : axis === "y" ? "D" : "H";
  const transform = screenOffset ? `translate(${screenOffset.x}px, ${screenOffset.y}px)` : undefined;

  return (
    <>
      {/* Leader line: dashed segment from chip anchor (on the bbox
          edge) out to where the chip sits. Iter-114.3 — matches the
          TinkerCAD style of "leader-with-arrow" so every chip is
          unambiguously tied to its edge. */}
      {anchor && (
        <Line
          points={[anchor, position]}
          color={color}
          lineWidth={1.2}
          dashed
          dashSize={2}
          gapSize={1.5}
          depthTest={false}
          transparent
          opacity={0.65}
        />
      )}
      <Html position={position} center zIndexRange={[70, 0]} sprite={false}>
        <div style={{ transform, pointerEvents: "auto" }}>
          {editing ? (
            <div
              data-testid={`${testid}-editor`}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded shadow-md select-none"
              style={{
                pointerEvents: "auto",
                background: "rgba(255,255,255,0.92)",
                border: `1.5px solid ${color}`,
                boxShadow: `0 1px 4px rgba(0,0,0,0.18), 0 0 6px ${color}40`,
              }}
            >
              <span className="font-mono text-[10px] font-bold" style={{ color }}>{axisLabel}</span>
              <input
                ref={inputRef}
                data-testid={`${testid}-input`}
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKey}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-14 bg-transparent text-[11px] font-mono font-semibold text-slate-900 outline-none border-b border-slate-400 focus:border-slate-900"
              />
              <span className="text-[9px] font-mono text-slate-500">{unitSystem}</span>
            </div>
          ) : (
            <button
              data-testid={testid}
              type="button"
              onClick={(e) => { e.stopPropagation(); if (editable) setEditing(true); }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!editable}
              title={editable
                ? `${axisLabel} (${axis.toUpperCase()}) — click to edit`
                : `${axisLabel} (${axis.toUpperCase()}) — read-only for this object type`}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold select-none whitespace-nowrap ${
                editable ? "cursor-pointer" : "cursor-default"
              }`}
              style={{
                // Translucent white chip — TinkerCAD parity. Still
                // readable over dark themes thanks to the 80 % opacity
                // and the colored axis letter, but lets geometry show
                // through behind it.
                pointerEvents: "auto",
                background: "rgba(255,255,255,0.80)",
                border: `1px solid ${color}80`,
                color: "#0F172A",
                boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }}
            >
              <span style={{ color }} className="font-bold">{axisLabel}</span>
              <span>{toDisplayLen(worldMm, unitSystem).toFixed(unitSystem === "in" ? 3 : 1)}</span>
              <span className="text-[9px] text-slate-500">{unitSystem}</span>
            </button>
          )}
        </div>
      </Html>
    </>
  );
}

/**
 * Position chip — EDITABLE (TinkerCAD ruler parity). Anchored to the
 * bbox corner nearest the ruler origin, shows that corner's coordinate
 * along one axis relative to the active workplane ruler origin (or the
 * workplane origin 0,0,0 if no ruler). Typing a new value MOVES the
 * object so the corner lands at that distance from the origin.
 */
function PositionChip({ axis, worldMm, color, position, screenOffset, unitSystem, editable, onCommit, testid }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) {
      const dp = unitSystem === "in" ? 3 : 2;
      setValue(toDisplayLen(worldMm, unitSystem).toFixed(dp));
    }
  }, [worldMm, unitSystem, editing]);

  useEffect(() => {
    if (!editing) return undefined;
    // Same double-focus trick as DimChip — drei <Html> re-appends its
    // container after mount which drops same-tick focus.
    if (inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
    const t = setTimeout(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 80);
    return () => clearTimeout(t);
  }, [editing]);

  const commit = () => {
    const display = parseFloat(value.replace("−", "-"));
    if (Number.isFinite(display)) onCommit(fromDisplayLen(display, unitSystem));
    setEditing(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
    e.stopPropagation();
  };

  const v = toDisplayLen(worldMm, unitSystem);
  const dp = unitSystem === "in" ? 3 : 2;
  const sign = v >= 0 ? "" : "−";
  const txt = `${sign}${Math.abs(v).toFixed(dp)}`;
  const transform = screenOffset ? `translate(${screenOffset.x}px, ${screenOffset.y}px)` : undefined;
  const label = axis.toUpperCase();

  return (
    <Html position={position} center zIndexRange={[68, 0]} sprite={false}>
      <div style={{ transform, pointerEvents: "auto" }}>
        {editing ? (
          <div
            data-testid={`${testid}-editor`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded shadow-md select-none"
            style={{
              pointerEvents: "auto",
              background: "rgba(255,255,255,0.92)",
              border: `1.5px dashed ${color}`,
              boxShadow: `0 1px 4px rgba(0,0,0,0.18), 0 0 6px ${color}40`,
            }}
          >
            <span className="font-mono text-[10px] font-bold" style={{ color }}>{label}</span>
            <input
              ref={inputRef}
              data-testid={`${testid}-input`}
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKey}
              onBlur={commit}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-14 bg-transparent text-[11px] font-mono font-semibold text-slate-900 outline-none border-b border-slate-400 focus:border-slate-900"
            />
            <span className="text-[9px] font-mono text-slate-500">{unitSystem}</span>
          </div>
        ) : (
          <button
            data-testid={testid}
            type="button"
            onClick={(e) => { e.stopPropagation(); if (editable) setEditing(true); }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!editable}
            title={editable
              ? `${label} distance from ruler origin — click to edit (moves the part)`
              : `${label} distance from ruler origin — this object is locked`}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10.5px] font-semibold whitespace-nowrap select-none ${
              editable ? "cursor-pointer" : "cursor-default"
            }`}
            style={{
              pointerEvents: "auto",
              background: "rgba(255,255,255,0.80)",
              border: `1px dashed ${color}80`,
              color: "#0F172A",
              boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
            }}
          >
            <span style={{ color }} className="font-bold">{label}</span>
            <span>{txt}</span>
            <span className="text-[9px] text-slate-500">{unitSystem}</span>
          </button>
        )}
      </div>
    </Html>
  );
}

export function SelectionDimLabels() {
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const unitSystem = useScene((s) => s.unitSystem);
  const updateDims = useScene((s) => s.updateDims);
  const setImportedDim = useScene((s) => s.setImportedDim);
  const updateObject = useScene((s) => s.updateObject);
  const measureMode = useScene((s) => s.measureMode);
  const rulerMode = useScene((s) => s.rulerMode);
  const cutMode = useScene((s) => s.cutMode);
  const placeOnFaceMode = useScene((s) => s.placeOnFaceMode);
  const dimLabelsEnabled = useScene((s) => s.dimLabelsEnabled);
  const workplaneRuler = useScene((s) => s.workplaneRuler);
  const workplaneRulerPlacing = workplaneRuler?.placing;

  const obj = objects.find((o) => o.id === selectedId);

  // World-space bbox + anchor (edge midpoint) AND chip floating
  // position. The anchor end of the leader line lives on the bbox;
  // the position end is offset away from geometry.
  const bboxData = useMemo(() => {
    if (!obj || obj.visible === false) return null;
    try {
      const bb = computeRotatedBBox(obj);
      if (!Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) return null;
      const px = obj.position?.[0] || 0;
      const py = obj.position?.[1] || 0;
      const pz = obj.position?.[2] || 0;
      const minX = bb.min.x + px, maxX = bb.max.x + px;
      const minY = bb.min.y + py, maxY = bb.max.y + py;
      const minZ = bb.min.z + pz, maxZ = bb.max.z + pz;
      const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
      if (sizeX < 0.05 && sizeY < 0.05 && sizeZ < 0.05) return null;
      const inset = Math.max(10, 0.3 * Math.max(sizeX, sizeY, sizeZ));
      return {
        sizeX, sizeY, sizeZ,
        minX, maxX, minY, maxY, minZ, maxZ,
        // Dimension-chip anchors (on the bbox edges) and floating
        // chip positions (offset).
        anchorW: [(minX + maxX) / 2, minY, minZ],
        posW:    [(minX + maxX) / 2, minY - inset, minZ],
        anchorD: [maxX, (minY + maxY) / 2, (minZ + maxZ) / 2],
        posD:    [maxX + inset, (minY + maxY) / 2, (minZ + maxZ) / 2],
        anchorH: [minX, (minY + maxY) / 2, (minZ + maxZ) / 2],
        posH:    [minX - inset, (minY + maxY) / 2, (minZ + maxZ) / 2],
      };
    } catch { return null; }
  }, [obj]);

  if (!obj || !bboxData) return null;
  // Visible when DIMS is toggled on OR the workplane ruler is placed —
  // TinkerCAD parity: dropping the ruler implies you want readouts.
  if (!dimLabelsEnabled && !workplaneRuler?.active) return null;
  // Exclusive modes still hide the chip stack — they own the canvas.
  // Workplane ruler ACTIVE no longer hides us — both layer together.
  if (measureMode || rulerMode || cutMode || placeOnFaceMode) return null;
  if (workplaneRulerPlacing) return null;

  const editableX = isAxisEditable(obj, "x");
  const editableY = isAxisEditable(obj, "y");
  const editableZ = isAxisEditable(obj, "z");

  // Origin for position chips — ruler origin if active, else world.
  // Iter-114.4: pin the position chips to whichever of the 8 bbox
  // corners is CLOSEST to the ruler origin in screen distance. That
  // way placing the ruler on the right side of a part shows readings
  // at the right corner; placing it behind shows readings at the back
  // corner. Far more useful than always front-left-bottom.
  const origin = workplaneRuler?.active ? workplaneRuler.origin : [0, 0, 0];
  // 4 candidate corners — BOTTOM face only. Pinning to bottom corners
  // means the Z chip always reads "distance from the ruler plane up to
  // the BOTTOM of the part" (TinkerCAD elevation), instead of
  // accidentally reporting a top-corner height when the origin is
  // elevated. X/Y distances are identical for top/bottom corners.
  const corners = [
    [bboxData.minX, bboxData.minY, bboxData.minZ],
    [bboxData.maxX, bboxData.minY, bboxData.minZ],
    [bboxData.minX, bboxData.maxY, bboxData.minZ],
    [bboxData.maxX, bboxData.maxY, bboxData.minZ],
  ];
  let bestCorner = corners[0];
  let bestD = Infinity;
  for (const c of corners) {
    const dx = c[0] - origin[0];
    const dy = c[1] - origin[1];
    const dz = c[2] - origin[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; bestCorner = c; }
  }
  const cornerX = bestCorner[0] - origin[0];
  const cornerY = bestCorner[1] - origin[1];
  const cornerZ = bestCorner[2] - origin[2];

  // Editing a position chip MOVES the object so the pinned corner sits
  // at the typed distance from the origin (TinkerCAD ruler behavior).
  const posEditable = !obj.locked;
  const commitCornerPos = (axisIdx) => (mm) => {
    const current = bestCorner[axisIdx] - origin[axisIdx];
    const delta = mm - current;
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-6) return;
    const p = obj.position || [0, 0, 0];
    const np = [p[0], p[1], p[2]];
    np[axisIdx] += delta;
    updateObject(obj.id, { position: np });
  };

  return (
    <group renderOrder={999}>
      {/* W / D / H — dimension chips, each with a dashed leader line. */}
      <DimChip
        axis="x"
        worldMm={bboxData.sizeX}
        color={COLOR_X}
        position={bboxData.posW}
        anchor={bboxData.anchorW}
        screenOffset={{ x: 0, y: 24 }}
        editable={editableX}
        unitSystem={unitSystem}
        onCommit={(mm) => commitAxisLength(obj, "x", mm, bboxData.sizeX, { updateDims, setImportedDim })}
        testid="dim-label-w"
      />
      <DimChip
        axis="y"
        worldMm={bboxData.sizeY}
        color={COLOR_Y}
        position={bboxData.posD}
        anchor={bboxData.anchorD}
        screenOffset={{ x: 24, y: 0 }}
        editable={editableY}
        unitSystem={unitSystem}
        onCommit={(mm) => commitAxisLength(obj, "y", mm, bboxData.sizeY, { updateDims, setImportedDim })}
        testid="dim-label-d"
      />
      <DimChip
        axis="z"
        worldMm={bboxData.sizeZ}
        color={COLOR_Z}
        position={bboxData.posH}
        anchor={bboxData.anchorH}
        screenOffset={{ x: -24, y: 0 }}
        editable={editableZ}
        unitSystem={unitSystem}
        onCommit={(mm) => commitAxisLength(obj, "z", mm, bboxData.sizeZ, { updateDims, setImportedDim })}
        testid="dim-label-h"
      />

      {/* X / Y / Z — corner POSITION chips (EDITABLE — typing a value
          moves the part relative to the ruler origin). Pinned to the
          bbox corner nearest the origin. A dashed leader ties the
          corner back to the ruler origin so the reference is obvious. */}
      {workplaneRuler?.active && (
        <Line
          points={[origin, bestCorner]}
          color="#94A3B8"
          lineWidth={1}
          dashed
          dashSize={3}
          gapSize={2}
          depthTest={false}
          transparent
          opacity={0.5}
        />
      )}
      {/* Vertical ELEVATION drop-line — when the part floats above (or
          below) the ruler plane, tie its pinned bottom corner straight
          down to the plane so the Z chip's reading is visually obvious. */}
      {workplaneRuler?.active && Math.abs(cornerZ) > 0.05 && (
        <Line
          points={[[bestCorner[0], bestCorner[1], origin[2]], bestCorner]}
          color={COLOR_Z}
          lineWidth={1.5}
          dashed
          dashSize={2}
          gapSize={2}
          depthTest={false}
          transparent
          opacity={0.8}
        />
      )}
      <PositionChip
        axis="x"
        worldMm={cornerX}
        color={COLOR_X}
        position={bestCorner}
        screenOffset={{ x: -54, y: -2 }}
        unitSystem={unitSystem}
        editable={posEditable}
        onCommit={commitCornerPos(0)}
        testid="pos-chip-x"
      />
      <PositionChip
        axis="y"
        worldMm={cornerY}
        color={COLOR_Y}
        position={bestCorner}
        screenOffset={{ x: -54, y: 16 }}
        unitSystem={unitSystem}
        editable={posEditable}
        onCommit={commitCornerPos(1)}
        testid="pos-chip-y"
      />
      <PositionChip
        axis="z"
        worldMm={cornerZ}
        color={COLOR_Z}
        position={bestCorner}
        screenOffset={{ x: -54, y: 34 }}
        unitSystem={unitSystem}
        editable={posEditable}
        onCommit={commitCornerPos(2)}
        testid="pos-chip-z"
      />
    </group>
  );
}

export default SelectionDimLabels;

// Iter-113 — TinkerCAD-style inline-editable W/D/H dimension labels.
//
// Renders three chips welded to the primary selection's world bbox:
//   • W (X) — front-bottom edge midpoint
//   • D (Y) — right-bottom edge midpoint
//   • H (Z) — front-right vertical edge midpoint
//
// Each chip is read-only by default. Clicking turns it into a small
// numeric input that respects the global mm/inch toggle. Submitting
// (Enter or blur) writes back the new dimension to the appropriate
// scene action:
//   • cube       → updateDims(id, {x|y|z: mm})
//   • cylinder   → updateDims(id, {r: mm/2})         for X/Y
//                 updateDims(id, {h: mm})            for Z
//   • cone       → updateDims(id, {r1: mm/2, r2: r2_scaled}) for X/Y
//                 updateDims(id, {h: mm})            for Z
//   • sphere     → updateDims(id, {r: mm/2})         for any axis
//   • imported   → setImportedDim(id, axis, mm)       (requires originalBbox)
//   • everything else (sketch, sweep, text, group of mixed) → read-only.
//
// The labels respect the unit toggle (mm vs in) and are hidden during
// gizmo-drag transforms (so the user reads the live bbox chip in the
// corner instead of stale text floating around the moving mesh).
import React, { useState, useRef, useEffect, useMemo } from "react";
import { Html } from "@react-three/drei";
import { useScene } from "../../lib/store";
import { computeRotatedBBox } from "../../lib/geometry";
import { toDisplayLen, fromDisplayLen } from "../../lib/units";

const COLOR_X = "#FB7185"; // rose
const COLOR_Y = "#34D399"; // emerald
const COLOR_Z = "#60A5FA"; // sky (Z = up)

/** Decide whether a given primitive type+axis is editable. */
function isAxisEditable(obj, axis) {
  if (!obj) return false;
  if (obj.locked) return false;
  if (obj.type === "cube") return true;
  if (obj.type === "sphere") return true;
  if (obj.type === "cylinder" || obj.type === "cone") return true;
  if (obj.type === "imported" && obj.originalBbox) return true;
  return false;
}

/** Commit a new world-mm length for a given axis on the selected object. */
function commitAxisLength(obj, axis, mm, actions) {
  if (!obj || !Number.isFinite(mm) || mm <= 0) return;
  const { updateDims, setImportedDim } = actions;
  if (obj.type === "cube") {
    updateDims(obj.id, { [axis]: mm });
    return;
  }
  if (obj.type === "sphere") {
    // Sphere is uniform — any axis edit sets the same diameter.
    updateDims(obj.id, { r: mm / 2 });
    return;
  }
  if (obj.type === "cylinder") {
    if (axis === "z") updateDims(obj.id, { h: mm });
    else updateDims(obj.id, { r: mm / 2 });
    return;
  }
  if (obj.type === "cone") {
    if (axis === "z") {
      updateDims(obj.id, { h: mm });
    } else {
      // Scale the base radius — preserve the tip:base ratio so a cone
      // doesn't accidentally become a cylinder. Tip radius (r2) follows
      // the same factor.
      const oldR1 = obj.dims?.r1 ?? obj.dims?.r ?? 10;
      const oldR2 = obj.dims?.r2 ?? 0;
      const factor = (mm / 2) / Math.max(oldR1, 1e-6);
      updateDims(obj.id, { r1: mm / 2, r2: oldR2 * factor });
    }
    return;
  }
  if (obj.type === "imported" && obj.originalBbox) {
    setImportedDim(obj.id, axis, mm);
    return;
  }
}

/** Single editable chip — encapsulates input/display toggle. */
function DimChip({
  axis,
  worldMm,
  color,
  position,
  editable,
  unitSystem,
  onCommit,
  testid,
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  // Sync the visible mm value into the editor whenever the live bbox
  // changes (drag, rotate, etc.) — but never overwrite the user's
  // in-flight typing.
  useEffect(() => {
    if (!editing) {
      const d = unitSystem === "in" ? 3 : 2;
      setValue(toDisplayLen(worldMm, unitSystem).toFixed(d));
    }
  }, [worldMm, unitSystem, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const display = parseFloat(value);
    if (Number.isFinite(display) && display > 0) {
      const mm = fromDisplayLen(display, unitSystem);
      onCommit(mm);
    }
    setEditing(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
    e.stopPropagation();
  };

  const axisLabel = axis === "x" ? "W" : axis === "y" ? "D" : "H";

  return (
    <Html
      position={position}
      center
      zIndexRange={[70, 0]}
      sprite={false}
    >
      {editing ? (
        <div
          data-testid={`${testid}-editor`}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950/95 border shadow-lg select-none"
          style={{
            pointerEvents: "auto",
            borderColor: color,
            boxShadow: `0 0 10px ${color}80`,
          }}
        >
          <span
            className="font-mono text-[10px] font-bold"
            style={{ color }}
          >
            {axisLabel}
          </span>
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
            className="w-14 bg-transparent text-[11px] font-mono font-semibold text-white outline-none border-b border-slate-600 focus:border-white"
          />
          <span className="text-[9px] font-mono text-slate-400">{unitSystem}</span>
        </div>
      ) : (
        <button
          data-testid={testid}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (editable) setEditing(true);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!editable}
          title={
            editable
              ? `${axisLabel} (${axis.toUpperCase()}) — click to edit`
              : `${axisLabel} (${axis.toUpperCase()}) — read-only for this object type`
          }
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950/85 border font-mono text-[11px] font-semibold select-none whitespace-nowrap transition-shadow ${
            editable
              ? "cursor-pointer hover:bg-slate-900"
              : "cursor-default opacity-80"
          }`}
          style={{
            pointerEvents: "auto",
            borderColor: `${color}90`,
            color: "#F8FAFC",
            textShadow: "0 1px 2px #000a",
          }}
        >
          <span style={{ color }} className="font-bold">{axisLabel}</span>
          <span>
            {toDisplayLen(worldMm, unitSystem).toFixed(unitSystem === "in" ? 3 : 1)}
          </span>
          <span className="text-[9px] text-slate-400">{unitSystem}</span>
        </button>
      )}
    </Html>
  );
}

/**
 * Inline-editable W/D/H labels for the currently selected object.
 * Renders nothing when:
 *   - no primary selection
 *   - the gizmo is mid-drag (handled by parent: hidden during
 *     transformInProgress)
 *   - the object is hidden
 *   - the bbox can't be resolved (e.g. partially loaded sweep)
 */
export function SelectionDimLabels() {
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const unitSystem = useScene((s) => s.unitSystem);
  const updateDims = useScene((s) => s.updateDims);
  const setImportedDim = useScene((s) => s.setImportedDim);
  const measureMode = useScene((s) => s.measureMode);
  const rulerMode = useScene((s) => s.rulerMode);
  const cutMode = useScene((s) => s.cutMode);
  const placeOnFaceMode = useScene((s) => s.placeOnFaceMode);

  const obj = objects.find((o) => o.id === selectedId);

  // Compute the WORLD-space rotated bbox + label-anchor world points.
  const bboxData = useMemo(() => {
    if (!obj || obj.visible === false) return null;
    try {
      const bb = computeRotatedBBox(obj);
      if (!Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) return null;
      const px = obj.position?.[0] || 0;
      const py = obj.position?.[1] || 0;
      const pz = obj.position?.[2] || 0;
      const minX = bb.min.x + px;
      const maxX = bb.max.x + px;
      const minY = bb.min.y + py;
      const maxY = bb.max.y + py;
      const minZ = bb.min.z + pz;
      const maxZ = bb.max.z + pz;
      const sizeX = maxX - minX;
      const sizeY = maxY - minY;
      const sizeZ = maxZ - minZ;
      // Skip if the selection is degenerate (e.g. a single-point sketch).
      if (sizeX < 0.05 && sizeY < 0.05 && sizeZ < 0.05) return null;
      // Slight inset so the chip doesn't collide with the bbox edge line.
      const inset = 2.5;
      return {
        sizeX, sizeY, sizeZ,
        // W (X) label — front-bottom edge midpoint, pulled forward in Y.
        posW: [(minX + maxX) / 2, minY - inset, minZ],
        // D (Y) label — right-bottom edge midpoint, pushed right in X.
        posD: [maxX + inset, (minY + maxY) / 2, minZ],
        // H (Z) label — front-right vertical edge midpoint.
        posH: [maxX + inset, minY - inset, (minZ + maxZ) / 2],
      };
    } catch {
      return null;
    }
  }, [obj]);

  if (!obj || !bboxData) return null;
  // Hide during exclusive interaction modes — those overlays own the
  // visual surface and our labels would clutter the read.
  if (measureMode || rulerMode || cutMode || placeOnFaceMode) return null;

  const editableX = isAxisEditable(obj, "x");
  const editableY = isAxisEditable(obj, "y");
  const editableZ = isAxisEditable(obj, "z");

  return (
    <group renderOrder={999}>
      <DimChip
        axis="x"
        worldMm={bboxData.sizeX}
        color={COLOR_X}
        position={bboxData.posW}
        editable={editableX}
        unitSystem={unitSystem}
        onCommit={(mm) => commitAxisLength(obj, "x", mm, { updateDims, setImportedDim })}
        testid="dim-label-w"
      />
      <DimChip
        axis="y"
        worldMm={bboxData.sizeY}
        color={COLOR_Y}
        position={bboxData.posD}
        editable={editableY}
        unitSystem={unitSystem}
        onCommit={(mm) => commitAxisLength(obj, "y", mm, { updateDims, setImportedDim })}
        testid="dim-label-d"
      />
      <DimChip
        axis="z"
        worldMm={bboxData.sizeZ}
        color={COLOR_Z}
        position={bboxData.posH}
        editable={editableZ}
        unitSystem={unitSystem}
        onCommit={(mm) => commitAxisLength(obj, "z", mm, { updateDims, setImportedDim })}
        testid="dim-label-h"
      />
    </group>
  );
}

export default SelectionDimLabels;

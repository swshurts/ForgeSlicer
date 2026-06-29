// Iter-114 — Extracted from RightPanel.jsx during the RightPanel
// refactor. Hosts the 2D-shape Inspector controls (circle, square2d,
// triangle, polygon) and the Extrude-depth presets that follow them.
//
// Pure presentational: receives `obj`, the `updateDims` action, and
// the matching `NumberField` from the parent so we don't re-import
// the entire RightPanel internal toolkit.
import React from "react";
import { useScene } from "../../lib/store";

export function Shape2DControls({ obj, updateDims, NumberField }) {
  const d = obj.dims || {};
  const unitSystem = useScene((s) => s.unitSystem);
  const is2D = (d.h || 1) <= 1.01; // visually "still a 2D sketch"
  return (
    <div className="space-y-2" data-testid="shape2d-controls">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center justify-between">
          <span>2D Dimensions ({unitSystem})</span>
          <span
            className={`text-[9px] normal-case px-1.5 py-0.5 rounded ${is2D ? "bg-purple-500/20 text-purple-300" : "bg-orange-500/20 text-orange-300"}`}
            title={is2D ? "Currently a 2D sketch — set Extrude depth below" : "Already extruded"}
          >
            {is2D ? "2D sketch" : `extruded ${unitSystem === "in" ? (((d.h || 1) / 25.4).toFixed(3) + " in") : (((d.h || 1).toFixed(1)) + " mm")}`}
          </span>
        </div>
        {obj.type === "circle" && (
          <div className="grid grid-cols-1 gap-2">
            <NumberField testid="dim2d-r" label="Radius" value={d.r} onChange={(v) => updateDims(obj.id, { r: v })} step={0.5} min={0.1} />
          </div>
        )}
        {obj.type === "square2d" && (
          <div className="grid grid-cols-1 gap-2">
            <NumberField testid="dim2d-side" label="Side" value={d.side} onChange={(v) => updateDims(obj.id, { side: v })} step={0.5} min={0.1} />
          </div>
        )}
        {obj.type === "triangle" && (
          <div className="grid grid-cols-1 gap-2">
            {/* iter-114 — flexible triangle. Base + height + apex
                shift covers right / isoceles / scalene cases in one
                primitive. Legacy r-based scenes fall back via
                geometry.js when neither base nor height is set. */}
            <NumberField
              testid="dim-tri-base"
              label="Base (X)"
              value={d.base ?? (d.r ? d.r * Math.sqrt(3) : 20)}
              onChange={(v) => updateDims(obj.id, { base: v, r: undefined })}
              step={0.5}
              min={0.1}
              inUnit="length"
            />
            <NumberField
              testid="dim-tri-height"
              label="Height (Y)"
              value={d.height ?? (d.r ? d.r * 1.5 : 17.3)}
              onChange={(v) => updateDims(obj.id, { height: v, r: undefined })}
              step={0.5}
              min={0.1}
              inUnit="length"
            />
            <NumberField
              testid="dim-tri-apex-shift"
              label="Apex shift (X)"
              value={d.apexShift ?? 0}
              onChange={(v) => updateDims(obj.id, { apexShift: v, r: undefined })}
              step={0.5}
              inUnit="length"
            />
            <div className="text-[9.5px] text-slate-500 leading-tight">
              0 = isoceles · +half base = right triangle (right angle on left) · −half base = right triangle (right angle on right)
            </div>
          </div>
        )}
        {obj.type === "polygon" && (
          <div className="space-y-2">
            <NumberField testid="dim2d-r" label="Circumradius" value={d.r} onChange={(v) => updateDims(obj.id, { r: v })} step={0.5} min={0.1} />
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Sides</span>
                <span data-testid="polygon-sides-readout" className="text-[10px] font-mono text-orange-400">{d.sides | 0}</span>
              </div>
              <input
                data-testid="polygon-sides-slider"
                type="range"
                min={3}
                max={24}
                step={1}
                value={d.sides | 0}
                onChange={(e) => updateDims(obj.id, { sides: parseInt(e.target.value, 10) })}
                className="w-full accent-orange-500"
              />
              <div className="mt-1">
                <NumberField
                  testid="polygon-sides-input"
                  label=""
                  value={d.sides | 0}
                  onChange={(v) => updateDims(obj.id, { sides: Math.max(3, Math.min(24, Math.round(v))) })}
                  step={1}
                  min={3}
                  suffix="sides"
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <ExtrudePresets obj={obj} updateDims={updateDims} NumberField={NumberField} />
    </div>
  );
}

function ExtrudePresets({ obj, updateDims, NumberField }) {
  const dropToBed = useScene((s) => s.dropToBed);
  const apply = (mm) => {
    updateDims(obj.id, { h: mm });
    // After extruding upward, keep the bottom flush with the bed.
    setTimeout(() => dropToBed(obj.id, false), 0);
  };
  const presets = [1, 5, 10, 20];
  return (
    <div data-testid="extrude-controls" className="bg-slate-950/60 border border-purple-500/40 rounded p-2 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center justify-between">
        <span>Extrude to depth</span>
        <span className="text-[9px] normal-case text-slate-500">turns 2D → 3D</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {presets.map((mm) => (
          <button
            key={mm}
            data-testid={`extrude-preset-${mm}`}
            onClick={() => apply(mm)}
            className={`h-7 text-[10px] font-mono rounded border ${
              Math.abs((obj.dims.h || 0) - mm) < 0.01
                ? "border-orange-500 bg-orange-500/15 text-orange-300"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-orange-500/50"
            }`}
          >
            {mm}mm
          </button>
        ))}
      </div>
      <NumberField
        testid="extrude-custom-input"
        label="Custom depth"
        value={obj.dims.h}
        onChange={(v) => v > 0 && apply(v)}
        step={0.5}
        min={0.1}
        suffix="mm"
      />
    </div>
  );
}

export default Shape2DControls;

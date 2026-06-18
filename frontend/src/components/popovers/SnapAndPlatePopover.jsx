// SnapAndPlatePopover — iter-103.
//
// Triggered by the small settings-cog button immediately to the right of
// the Snap (Magnet) / Grid icons in the EditRow toolbar. Surfaces two
// adjacent concerns that used to be unreachable from the UI:
//
//   1. Snap step values — translate (mm), rotate (degrees), scale (mm).
//      All three were already in the store but only `snapTranslate`
//      could be set (and only programmatically, via the StatusBar's
//      hover hint). Rotation snapped at a hardcoded 15° / scale at a
//      hardcoded 0.1 mm. Now editable.
//
//   2. Design plate — the "faux" oversized build plate users can switch
//      on to model parts bigger than any single printer (1 m – several m
//      cubed). Drawn UNDER the printer plate as a dashed cyan envelope
//      with its own 50 mm grid, so the printer plate stays the visually
//      dominant surface while the modelling envelope is unmistakable.
//      Bounds-checks / G-code export still gate on the printer plate;
//      this is a visual aid for assembly-scale work, with sectioning
//      delegated to the existing Subdivide dialog or a desktop slicer.
//
// Kept lean — just NumberField rows + a toggle. Same PopoverShell
// pattern as the Position / Rotation / Scale popovers so it inherits
// the standard close/escape/anchor behaviour.
import React from "react";
import { Settings2, LayoutGrid } from "lucide-react";
import { PopoverShell, NumberField } from "./PopoverShell";
import { useScene } from "../../lib/store";

export default function SnapAndPlatePopover({ anchor, onClose }) {
  const snapEnabled = useScene((s) => s.snapEnabled);
  const setSnapEnabled = useScene((s) => s.setSnapEnabled);
  const snapTranslate = useScene((s) => s.snapTranslate);
  const setSnapTranslate = useScene((s) => s.setSnapTranslate);
  const snapRotate = useScene((s) => s.snapRotate);
  const setSnapRotate = useScene((s) => s.setSnapRotate);
  const snapScale = useScene((s) => s.snapScale);
  const setSnapScale = useScene((s) => s.setSnapScale);
  const designPlate = useScene((s) => s.designPlate);
  const setDesignPlate = useScene((s) => s.setDesignPlate);

  return (
    <PopoverShell
      title="Snap & Design Plate"
      icon={Settings2}
      onClose={onClose}
      anchor={anchor}
      testid="snap-plate-popover"
      width={320}
    >
      {/* ── Snap section ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Snap</span>
          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              data-testid="snap-enable-toggle"
              type="checkbox"
              checked={snapEnabled}
              onChange={(e) => setSnapEnabled(e.target.checked)}
              className="accent-orange-500"
            />
            <span>{snapEnabled ? "On" : "Off"}</span>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Move"
            value={snapTranslate}
            onChange={setSnapTranslate}
            step={0.1}
            suffix="mm"
            testid="snap-translate-field"
            disabled={!snapEnabled}
          />
          <NumberField
            label="Rotate"
            value={snapRotate}
            onChange={setSnapRotate}
            step={1}
            suffix="°"
            testid="snap-rotate-field"
            disabled={!snapEnabled}
          />
          <NumberField
            label="Scale"
            value={snapScale}
            onChange={setSnapScale}
            step={0.01}
            suffix="mm"
            testid="snap-scale-field"
            disabled={!snapEnabled}
          />
        </div>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {[0.1, 0.5, 1, 5, 10].map((v) => (
            <button
              key={`mv-${v}`}
              data-testid={`snap-translate-preset-${v}`}
              onClick={() => setSnapTranslate(v)}
              disabled={!snapEnabled}
              className={`px-1.5 h-5 rounded text-[10px] font-mono border ${
                snapTranslate === v
                  ? "border-orange-500/70 text-orange-300 bg-orange-500/10"
                  : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {v} mm
            </button>
          ))}
          {[1, 5, 15, 30, 45, 90].map((v) => (
            <button
              key={`rot-${v}`}
              data-testid={`snap-rotate-preset-${v}`}
              onClick={() => setSnapRotate(v)}
              disabled={!snapEnabled}
              className={`px-1.5 h-5 rounded text-[10px] font-mono border ${
                snapRotate === v
                  ? "border-orange-500/70 text-orange-300 bg-orange-500/10"
                  : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {v}°
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-800 my-1" />

      {/* ── Design plate section ─────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <LayoutGrid size={12} className="text-cyan-400" />
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Design plate</span>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              data-testid="design-plate-enable-toggle"
              type="checkbox"
              checked={designPlate.enabled}
              onChange={(e) => setDesignPlate({ enabled: e.target.checked })}
              className="accent-cyan-500"
            />
            <span>{designPlate.enabled ? "Shown" : "Hidden"}</span>
          </label>
        </div>
        <p className="text-[10px] text-slate-500 leading-snug">
          Translucent envelope drawn around the printer plate so you can model parts larger
          than any single bed. Visual only — slicing big parts is still handled by Subdivide
          or your desktop slicer.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Width"
            value={designPlate.x}
            onChange={(v) => setDesignPlate({ x: Math.max(50, v) })}
            step={50}
            suffix="mm"
            testid="design-plate-x-field"
            disabled={!designPlate.enabled}
          />
          <NumberField
            label="Depth"
            value={designPlate.y}
            onChange={(v) => setDesignPlate({ y: Math.max(50, v) })}
            step={50}
            suffix="mm"
            testid="design-plate-y-field"
            disabled={!designPlate.enabled}
          />
          <NumberField
            label="Height"
            value={designPlate.z}
            onChange={(v) => setDesignPlate({ z: Math.max(50, v) })}
            step={50}
            suffix="mm"
            testid="design-plate-z-field"
            disabled={!designPlate.enabled}
          />
        </div>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {[
            { label: "1 m", x: 1000, y: 1000, z: 1000 },
            { label: "1.5 m", x: 1500, y: 1500, z: 1000 },
            { label: "2 m", x: 2000, y: 2000, z: 1000 },
            { label: "Desk-scale 600", x: 600, y: 600, z: 400 },
          ].map((preset) => (
            <button
              key={preset.label}
              data-testid={`design-plate-preset-${preset.label.toLowerCase().replace(/[\s.]+/g, "-")}`}
              onClick={() => setDesignPlate({ enabled: true, x: preset.x, y: preset.y, z: preset.z })}
              className="px-2 h-6 rounded text-[10px] font-mono border border-slate-700 text-slate-400 hover:border-cyan-500/70 hover:text-cyan-300 hover:bg-cyan-500/10"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </PopoverShell>
  );
}

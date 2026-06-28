// HoleDialog — Beginner-friendly hole / countersink builder.
//
// The existing CountersinkButton in LeftPanel drops a hard-coded
// M5-ish countersink. That's fine for power users, but a beginner
// asking "where's my M3 clearance hole?" needs a labelled preset.
//
// This dialog wraps `useScene.addCountersink({ boreR, headR, sinkH,
// throughH })` with:
//   • Six metric presets (M3, M4, M5, M6, M8) + four imperial
//     presets (#4, #6, #8, #10) following ISO 7045 / ASME B18.6.3.
//   • Optional countersink toggle (off → drops a single negative
//     cylinder via the primitive system; on → drops the full
//     countersink cone+cylinder pair via the composite action).
//   • Editable numeric overrides under "Custom" — the preset chips
//     just bake reasonable defaults into the four inputs.
//
// Trigger: a new "Hole" button on the Combo tab's composite grid.

import React, { useState } from "react";
import { X, Drill, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useScene } from "../../lib/store";
import { buildPrimitive } from "../../lib/primitiveDefaults";

// Standard clearance-hole tables. boreR is HALF the close-fit
// clearance diameter (ISO 7045 close series). headR is the
// countersink head radius for the matching flat-head screw, and
// sinkH is the countersunk depth so a 90° flat head sits flush.
// throughH defaults to 12 mm — a sensible "through any printable
// part" depth that the user can override per drop.
const HOLE_PRESETS = [
  { id: "m3",  label: "M3",  boreR: 1.65, headR: 3.0,  sinkH: 1.7, group: "metric" },
  { id: "m4",  label: "M4",  boreR: 2.20, headR: 4.0,  sinkH: 2.3, group: "metric" },
  { id: "m5",  label: "M5",  boreR: 2.75, headR: 5.0,  sinkH: 2.8, group: "metric" },
  { id: "m6",  label: "M6",  boreR: 3.30, headR: 6.0,  sinkH: 3.3, group: "metric" },
  { id: "m8",  label: "M8",  boreR: 4.40, headR: 8.0,  sinkH: 4.4, group: "metric" },
  { id: "#4",  label: "#4",  boreR: 1.55, headR: 2.85, sinkH: 1.5, group: "imperial" },
  { id: "#6",  label: "#6",  boreR: 1.85, headR: 3.50, sinkH: 1.8, group: "imperial" },
  { id: "#8",  label: "#8",  boreR: 2.20, headR: 4.30, sinkH: 2.1, group: "imperial" },
  { id: "#10", label: "#10", boreR: 2.55, headR: 4.95, sinkH: 2.5, group: "imperial" },
];

const DEFAULT_THROUGH_H = 12;

export default function HoleDialog({ open, onClose }) {
  const [selectedPreset, setSelectedPreset] = useState("m3");
  const [withCountersink, setWithCountersink] = useState(true);
  const [boreR, setBoreR]       = useState(HOLE_PRESETS[0].boreR);
  const [headR, setHeadR]       = useState(HOLE_PRESETS[0].headR);
  const [sinkH, setSinkH]       = useState(HOLE_PRESETS[0].sinkH);
  const [throughH, setThroughH] = useState(DEFAULT_THROUGH_H);

  if (!open) return null;

  const pickPreset = (preset) => {
    setSelectedPreset(preset.id);
    setBoreR(preset.boreR);
    setHeadR(preset.headR);
    setSinkH(preset.sinkH);
  };

  const onAddHole = () => {
    try {
      if (withCountersink) {
        // Composite path — drops 2 grouped parts (cylinder bore + cone cup).
        useScene.getState().addCountersink({
          boreR, headR, sinkH, throughH,
          groupName: `${selectedPreset.toUpperCase()} Countersink`,
        });
        toast.success(`Dropped ${selectedPreset.toUpperCase()} countersink — Ø ${(boreR * 2).toFixed(2)} mm bore + Ø ${(headR * 2).toFixed(1)} mm head.`);
      } else {
        // Plain bore — single negative cylinder, undo-atomic.
        useScene.getState().pushHistory();
        const part = {
          ...buildPrimitive("cylinder", "negative"),
          name: `${selectedPreset.toUpperCase()} Hole`,
          position: [0, 0, throughH / 2],
          dims: { r: boreR, h: throughH, segments: 48 },
        };
        useScene.setState((st) => ({
          objects: [...st.objects, part],
          selectedId: part.id,
          selectedIds: [part.id],
        }));
        toast.success(`Dropped ${selectedPreset.toUpperCase()} hole — Ø ${(boreR * 2).toFixed(2)} mm × ${throughH} mm.`);
      }
      onClose();
    } catch (e) {
      toast.error(`Couldn't add hole: ${e.message || e}`);
    }
  };

  return (
    <div
      data-testid="hole-dialog-overlay"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        data-testid="hole-dialog"
        className="w-[440px] max-h-[80vh] bg-slate-950 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80">
          <div>
            <div className="flex items-center gap-2">
              <Drill size={16} className="text-cyan-400" />
              <h2 className="text-[14px] font-bold text-white tracking-tight">Hole / Countersink</h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Pick a thread size — the dialog bakes the right clearance and head dims for you.
            </p>
          </div>
          <button
            data-testid="hole-close-btn"
            onClick={onClose}
            className="text-slate-500 hover:text-white p-1 -m-1 rounded"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Preset chooser */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Metric (ISO 7045)</div>
            <div className="grid grid-cols-5 gap-1.5">
              {HOLE_PRESETS.filter((p) => p.group === "metric").map((p) => (
                <button
                  key={p.id}
                  data-testid={`hole-preset-${p.id}`}
                  onClick={() => pickPreset(p)}
                  className={`h-9 rounded border text-[12px] font-semibold transition-colors ${
                    selectedPreset === p.id
                      ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                      : "bg-slate-900 border-slate-700 text-slate-300 hover:border-cyan-500/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold pt-1">Imperial (ASME B18.6.3)</div>
            <div className="grid grid-cols-4 gap-1.5">
              {HOLE_PRESETS.filter((p) => p.group === "imperial").map((p) => (
                <button
                  key={p.id}
                  data-testid={`hole-preset-${p.id}`}
                  onClick={() => pickPreset(p)}
                  className={`h-9 rounded border text-[12px] font-semibold transition-colors ${
                    selectedPreset === p.id
                      ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                      : "bg-slate-900 border-slate-700 text-slate-300 hover:border-cyan-500/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Countersink toggle */}
          <label className="flex items-center gap-2.5 px-3 py-2 rounded border border-slate-800 bg-slate-900/40 cursor-pointer hover:border-slate-700">
            <input
              type="checkbox"
              data-testid="hole-countersink-toggle"
              checked={withCountersink}
              onChange={(e) => setWithCountersink(e.target.checked)}
              className="w-4 h-4 accent-cyan-500"
            />
            <div className="flex-1">
              <div className="text-[12px] text-white font-semibold">Include countersink for flat-head screws</div>
              <div className="text-[10px] text-slate-500 leading-snug">
                Adds the angled head cup so the screw sits flush. Turn off for a plain through-hole.
              </div>
            </div>
          </label>

          {/* Numeric overrides */}
          <details className="rounded border border-slate-800 bg-slate-900/30 overflow-hidden">
            <summary
              data-testid="hole-customise-toggle"
              className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-white flex items-center gap-1.5"
            >
              <Sparkles size={11} />
              Customise dimensions
            </summary>
            <div className="grid grid-cols-2 gap-2 p-3 pt-2">
              <NumField label="Bore Ø (mm)"   value={boreR * 2}   onChange={(v) => setBoreR(v / 2)} testid="hole-input-bore-d" />
              <NumField label="Through depth" value={throughH}    onChange={(v) => setThroughH(v)} testid="hole-input-through-h" />
              {withCountersink && (
                <>
                  <NumField label="Head Ø (mm)" value={headR * 2} onChange={(v) => setHeadR(v / 2)} testid="hole-input-head-d" />
                  <NumField label="Sink depth"   value={sinkH}     onChange={(v) => setSinkH(v)}     testid="hole-input-sink-h" />
                </>
              )}
            </div>
          </details>

          {/* Live preview summary */}
          <div className="text-[10px] text-slate-400 font-mono bg-slate-950 border border-slate-800 rounded p-2 leading-snug">
            <div><span className="text-slate-500">bore   </span>Ø {(boreR * 2).toFixed(2)} mm × {throughH} mm deep</div>
            {withCountersink && (
              <div><span className="text-slate-500">head   </span>Ø {(headR * 2).toFixed(2)} mm × {sinkH} mm sink</div>
            )}
            <div className="text-emerald-300/80 pt-0.5">drops as a {withCountersink ? "grouped negative pair" : "single negative cylinder"} at the scene origin · undo-atomic</div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-end gap-2">
          <button
            data-testid="hole-cancel-btn"
            onClick={onClose}
            className="h-8 px-4 bg-slate-800 hover:bg-slate-700 text-white text-[12px] font-semibold rounded border border-slate-700"
          >
            Cancel
          </button>
          <button
            data-testid="hole-add-btn"
            onClick={onAddHole}
            className="h-8 px-4 bg-cyan-600 hover:bg-cyan-500 text-white text-[12px] font-semibold rounded border border-cyan-400/40 inline-flex items-center gap-1.5"
          >
            <Drill size={12} />
            Add {selectedPreset.toUpperCase()} {withCountersink ? "countersink" : "hole"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, testid }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      <input
        type="number"
        step="0.05"
        min="0.05"
        data-testid={testid}
        value={value.toFixed(2)}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n > 0) onChange(n);
        }}
        className="h-7 bg-slate-950 border border-slate-700 rounded text-[12px] text-white px-2 focus:border-cyan-500 outline-none font-mono"
      />
    </label>
  );
}

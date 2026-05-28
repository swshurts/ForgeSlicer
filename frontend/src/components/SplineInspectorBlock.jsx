// Splined-shaft Inspector block.
//
// Surfaces both unit-systems users think in: angular span per tooth
// (degrees) AND chord width on the cylinder's outer surface (mm).
// They're related by `width = 2·R·sin(deg/2)`. The block converts
// between them on edit. When the user proposes a width that won't fit
// at the current tooth count (the math implies > 360° total angular
// coverage), we surface a "nearest fit" picker with 2-3 alternatives:
// either reduce the tooth count or shrink the width. The user picks
// one, we apply, and continue. This implements the popup-confirmation
// rule the user asked for: don't silently snap to something they
// didn't choose.
//
// Profile picker (rectangular / triangular / rounded) maps directly
// to the cross-section the geometry builder ships.
import React, { useState } from "react";
import { Settings2 } from "lucide-react";
import { NumberField } from "./popovers/PopoverShell";

const PROFILES = [
  { id: "rectangular", label: "Rectangular", hint: "Flat-top teeth (standard ISO splines)" },
  { id: "triangular",  label: "Triangular",  hint: "V-shape (involute / serration)" },
  { id: "rounded",     label: "Rounded",     hint: "Half-circle (knurled grip)" },
];

// Convert chord (mm at outer surface) ↔ angular span (deg) given the
// cylinder's outer radius R. width = 2·R·sin(deg/2).
const chordFromDeg = (R, deg) => 2 * R * Math.sin((deg * Math.PI) / 360);
const degFromChord = (R, chord) => (360 / Math.PI) * Math.asin(Math.min(1, chord / (2 * R)));

// Given a desired chord width and a current tooth count, propose up
// to 3 nearby (N, toothDeg) pairs that fit on the cylinder. We require
// teeth + a small per-tooth gap (≥ 0.5°) so adjacent teeth never touch.
function suggestFits(R, desiredWidth, currentN) {
  const out = [];
  const minGap = 0.5;
  // Try the current N first, then bracket it.
  const candidates = [currentN, currentN - 1, currentN + 1, currentN - 2, currentN + 2];
  const seen = new Set();
  for (const n of candidates) {
    if (n < 2 || n > 64 || seen.has(n)) continue;
    seen.add(n);
    const maxDeg = 360 / n - minGap;
    if (maxDeg <= 1) continue;
    const desiredDeg = degFromChord(R, desiredWidth);
    const deg = Math.min(maxDeg, desiredDeg);
    const realised = chordFromDeg(R, deg);
    out.push({ N: n, toothDeg: deg, width: realised, ok: deg >= desiredDeg - 0.05 });
    if (out.length >= 3) break;
  }
  return out;
}

export default function SplineInspectorBlock({ obj, updateDims }) {
  const d = obj.dims || {};
  const R = d.r || 6;
  const N = d.teeth || 8;
  const toothDeg = d.toothWidthDeg || 12;
  const currentWidth = chordFromDeg(R, toothDeg);
  const profile = d.profile || "rectangular";
  // Fit-picker state: when the user types a width that doesn't fit at
  // the current N, we open this overlay until they pick an option.
  const [fitPrompt, setFitPrompt] = useState(null);

  const applyWidth = (mm) => {
    const desiredDeg = degFromChord(R, mm);
    const maxDeg = 360 / N - 0.5;
    if (desiredDeg <= maxDeg) {
      // Fits as-is.
      updateDims(obj.id, { toothWidthDeg: desiredDeg });
      return;
    }
    // Doesn't fit — prompt the user with nearby alternatives.
    setFitPrompt({ desiredWidth: mm, options: suggestFits(R, mm, N) });
  };
  const applyOption = (opt) => {
    updateDims(obj.id, { teeth: opt.N, toothWidthDeg: opt.toothDeg });
    setFitPrompt(null);
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions (mm / °)</div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField testid="dim-spline-r"      label="Core ⌀"     value={R * 2}        onChange={(v) => updateDims(obj.id, { r: Math.max(0.5, v / 2) })} step={1} suffix="mm" />
        <NumberField testid="dim-spline-h"      label="Length"     value={d.h || 30}     onChange={(v) => updateDims(obj.id, { h: Math.max(1, v) })}      step={1} suffix="mm" />
        <NumberField testid="dim-spline-teeth"  label="Teeth"      value={N}             onChange={(v) => updateDims(obj.id, { teeth: Math.max(2, Math.min(64, Math.round(v))) })} step={1} />
        <NumberField testid="dim-spline-toothH" label="Tooth depth" value={d.toothHeight || 1.2} onChange={(v) => updateDims(obj.id, { toothHeight: Math.max(0.1, v) })} step={0.1} suffix="mm" />
        <NumberField testid="dim-spline-deg"    label="Tooth angle" value={+toothDeg.toFixed(2)} onChange={(v) => updateDims(obj.id, { toothWidthDeg: Math.max(1, Math.min(360 / N - 0.5, v)) })} step={1} suffix="°" />
        <NumberField testid="dim-spline-width"  label="Tooth width" value={+currentWidth.toFixed(3)} onChange={(v) => applyWidth(Math.max(0.05, v))} step={0.1} suffix="mm" />
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Tooth profile</div>
        <div className="grid grid-cols-3 gap-1" data-testid="dim-spline-profile-picker">
          {PROFILES.map((p) => {
            const active = profile === p.id;
            return (
              <button
                key={p.id}
                data-testid={`dim-spline-profile-${p.id}`}
                onClick={() => updateDims(obj.id, { profile: p.id })}
                title={p.hint}
                className={`h-8 rounded text-[11px] font-semibold transition-colors ${active ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 text-[10px] text-slate-500 leading-snug">
        {N} teeth at {toothDeg.toFixed(1)}° each = {(N * toothDeg).toFixed(1)}° of {' '}
        the {360}° circumference. Tip: toggle Negative on this object to CUT the same teeth INTO a mating bore.
      </div>

      {fitPrompt && (
        <div
          data-testid="spline-fit-dialog"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setFitPrompt(null)}
        >
          <div
            className="bg-slate-900 border border-amber-500/40 rounded-lg shadow-2xl w-[min(440px,92vw)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <Settings2 size={14} className="text-amber-300" />
              <div className="text-sm font-semibold text-white">
                Tooth width {fitPrompt.desiredWidth.toFixed(2)} mm won't fit
              </div>
            </div>
            <p className="text-[11px] text-slate-300 leading-snug mb-3">
              A {R * 2}mm shaft can't fit {N} teeth at that width without overlap. Pick a close alternative:
            </p>
            <div className="flex flex-col gap-1.5" data-testid="spline-fit-options">
              {fitPrompt.options.map((opt) => (
                <button
                  key={opt.N}
                  data-testid={`spline-fit-option-${opt.N}`}
                  onClick={() => applyOption(opt)}
                  className="h-9 px-3 rounded bg-slate-800 hover:bg-amber-500/20 hover:border-amber-500 border border-slate-700 text-left text-[12px] text-slate-200 flex items-center justify-between transition-colors"
                >
                  <span>
                    <span className="font-mono text-amber-200">{opt.N} teeth</span>
                    <span className="text-slate-500 mx-2">·</span>
                    <span className="font-mono text-slate-300">{opt.width.toFixed(2)} mm</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {opt.toothDeg.toFixed(1)}°
                  </span>
                </button>
              ))}
            </div>
            <button
              data-testid="spline-fit-cancel"
              onClick={() => setFitPrompt(null)}
              className="mt-3 h-8 w-full rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300"
            >
              Cancel — keep current width
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

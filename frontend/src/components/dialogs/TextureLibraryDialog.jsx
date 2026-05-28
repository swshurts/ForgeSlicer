// Texture Library dialog — pick a geometric texture pattern + tuning
// params, then drop it onto the build plate as a single positive (or
// negative) primitive. Same lifecycle as any other primitive — the
// user can move/rotate/scale it after, and union/subtract it against
// a target via the standard CSG boolean tools.
//
// V1 patterns:  Knurl (diamond), Hex grid, Bumps, Ridges (linear).
// V2 backlog:   Diamond plate, brick, fabric weave, hex camo, voronoi.
//
// Why a separate dialog instead of a Composites grid card? The
// parameter surface (pattern + 5 numeric dims + apply mode) is too
// dense for inline buttons. A dialog gives us room for the per-
// pattern hint text + a live "preview footprint" callout.
import React, { useState } from "react";
import { Layers, X } from "lucide-react";
import { useScene } from "../../lib/store";
import { TEXTURE_PATTERNS } from "../../lib/textureGeometry";

export default function TextureLibraryDialog({ open, onClose, targetObjectId = null }) {
  const addPrimitive = useScene((s) => s.addPrimitive);
  const updateDims = useScene((s) => s.updateDims);
  const objects = useScene((s) => s.objects);
  const target = targetObjectId ? objects.find((o) => o.id === targetObjectId) : null;

  // Defaults: pick the first pattern + its tuning defaults.
  const [pattern, setPattern] = useState(TEXTURE_PATTERNS[0].id);
  const [w, setW] = useState(30);
  const [d, setD] = useState(30);
  const [tileSize, setTileSize] = useState(TEXTURE_PATTERNS[0].defaults.tileSize);
  const [height, setHeight] = useState(TEXTURE_PATTERNS[0].defaults.height);
  const [depth, setDepth] = useState(0.8);
  const [modifier, setModifier] = useState("positive");
  const [face, setFace] = useState("top");
  const selectedPattern = TEXTURE_PATTERNS.find((p) => p.id === pattern) || TEXTURE_PATTERNS[0];

  // When the pattern changes, snap the tile/height defaults to ones
  // that look reasonable for the new pattern (each kind has different
  // visual density). The user can always override afterward.
  const handlePatternChange = (id) => {
    const p = TEXTURE_PATTERNS.find((x) => x.id === id) || TEXTURE_PATTERNS[0];
    setPattern(id);
    setTileSize(p.defaults.tileSize);
    setHeight(p.defaults.height);
  };

  // When the user picks "Apply to face of <target>", size the texture
  // footprint to the target's AABB on that face. The picker is only
  // shown if a target was passed in (i.e. dialog was opened from the
  // right-click "Apply texture..." action on an object).
  const applyToFace = () => {
    if (!target) return;
    // Compute target's bounding extent on the chosen face.
    const s = target.scale || [1, 1, 1];
    const dims = target.dims || {};
    // Fall back to dims.h/r if precise bbox isn't available — good
    // enough for default sizing; user can tweak w/d after.
    const tw = (dims.x ?? dims.w ?? dims.r ? (dims.r ?? 0) * 2 : 30) * s[0];
    const tdp = (dims.z ?? dims.d ?? dims.r ? (dims.r ?? 0) * 2 : 30) * s[2];
    const th = (dims.y ?? dims.h ?? 30) * s[1];
    if (face === "top" || face === "bottom") { setW(tw); setD(tdp); }
    else if (face === "front" || face === "back") { setW(tw); setD(th); }
    else { setW(th); setD(tdp); }
  };

  React.useEffect(() => {
    if (target) applyToFace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, targetObjectId]);

  const handleDrop = () => {
    const id = addPrimitive("texture", modifier);
    // Overwrite the just-added default dims with the user's picks.
    updateDims(id, { pattern, w, d, tileSize, height, depth });
    onClose();
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="texture-library-dialog"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-w-[94vw] rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-slate-100">Texture Library</h2>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">geometric / printable</span>
          </div>
          <button data-testid="texture-library-close-btn" onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Pattern picker — grid of cards */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Pattern</label>
            <div className="grid grid-cols-2 gap-1.5">
              {TEXTURE_PATTERNS.map((p) => (
                <button
                  key={p.id}
                  data-testid={`texture-pattern-${p.id}`}
                  onClick={() => handlePatternChange(p.id)}
                  className={`text-left rounded border px-2.5 py-2 transition-all ${
                    pattern === p.id
                      ? "border-orange-500 bg-orange-500/15"
                      : "border-slate-700 bg-slate-950 hover:border-slate-500"
                  }`}
                >
                  <div className={`text-xs font-medium ${pattern === p.id ? "text-orange-300" : "text-slate-200"}`}>
                    {p.label}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{p.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Apply mode */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Apply as</label>
            <div className="flex gap-1.5">
              {[
                { id: "positive", label: "Raised (union)", color: "orange" },
                { id: "negative", label: "Engraved (subtract)", color: "cyan" },
              ].map((m) => (
                <button
                  key={m.id}
                  data-testid={`texture-modifier-${m.id}`}
                  onClick={() => setModifier(m.id)}
                  className={`flex-1 h-8 rounded border text-xs font-medium transition-all ${
                    modifier === m.id
                      ? m.color === "orange"
                        ? "border-orange-500 bg-orange-500/15 text-orange-300"
                        : "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target face — only shown when a target object is set */}
          {target && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">
                Apply to face of <span className="text-orange-300">{target.name}</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {["top", "bottom", "front", "back", "left", "right"].map((f) => (
                  <button
                    key={f}
                    data-testid={`texture-face-${f}`}
                    onClick={() => setFace(f)}
                    className={`h-7 px-2.5 rounded border text-[11px] font-medium transition-all capitalize ${
                      face === f
                        ? "border-orange-500 bg-orange-500/15 text-orange-300"
                        : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Texture footprint will be auto-sized to the picked face. Drag/position via Inspector after.
              </div>
            </div>
          )}

          {/* Numeric controls */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Footprint & relief</label>
            <div className="grid grid-cols-3 gap-2">
              <NumField testid="texture-w" label="W (mm)" value={w} onChange={setW} min={1} />
              <NumField testid="texture-d" label="D (mm)" value={d} onChange={setD} min={1} />
              <NumField testid="texture-tilesize" label="tile (mm)" value={tileSize} onChange={setTileSize} min={0.5} step={0.5} />
              <NumField testid="texture-height" label="height (mm)" value={height} onChange={setHeight} min={0.2} step={0.2} />
              <NumField testid="texture-depth" label="plate (mm)" value={depth} onChange={setDepth} min={0.4} step={0.2} />
            </div>
            <div className="text-[10px] text-slate-500 mt-1.5 leading-tight">
              <b className="text-slate-400">tile</b>: pattern periodicity. <b className="text-slate-400">height</b>: relief depth above the base. <b className="text-slate-400">plate</b>: base-plate thickness — keep at least 0.4mm so subtractive overlap won't leave manifold gaps.
            </div>
          </div>

          {/* Live summary */}
          <div className="rounded border border-slate-800 bg-slate-950 p-2 text-[11px] font-mono text-slate-400" data-testid="texture-preview">
            {selectedPattern.label} · {w}×{d}mm · tile {tileSize}mm · {modifier === "positive" ? `+${height}mm raised` : `-${height}mm engraved`} · base {depth}mm
          </div>

          <button
            data-testid="texture-drop-btn"
            onClick={handleDrop}
            className="w-full h-9 rounded bg-orange-500 hover:bg-orange-400 text-slate-950 text-sm font-semibold transition-colors"
          >
            Drop on plate
          </button>
        </div>
      </div>
    </div>
  );
}

// Small numeric field — clamped, no overflow. Defined inline because
// the popover variant lives in PopoverShell and we don't need its full
// drag-affordance behavior here (the dialog is keyboard-focused).
function NumField({ testid, label, value, onChange, min = 0, step = 1 }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
      <input
        data-testid={testid}
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n >= min) onChange(n);
        }}
        className="h-7 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-slate-200"
      />
    </div>
  );
}

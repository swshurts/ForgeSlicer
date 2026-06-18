// EdgeControls — per-edge / per-face / per-vertex fillet & chamfer UI.
//
// Extracted from RightPanel.jsx during the iter-103.3 refactor pass.
// All behaviour preserved as-is — this is a pure code-move, not a
// rewrite. The component reads sub-selection state from the scene
// store (subSelectMode + subSelection) and writes back through
// setEdgeFillets / updateDims so the rest of the inspector tree
// reacts the same way it always did.
//
// Why it lives here: the main RightPanel file was 1600+ lines; this
// one block accounted for 326 of them. Extracting it leaves the
// inspector container readable and lets future per-edge work (groove
// presets, chamfer-then-fillet stacking) happen in a focused file.
import React from "react";
import { useScene } from "../../lib/store";
import { Sliders, ChevronDown } from "lucide-react";
import * as edgeFaceMeta from "../../lib/edgeFaceMeta";

function EdgeControls({ obj, updateDims }) {
  const subSelectMode = useScene((s) => s.subSelectMode);
  const setSubSelectMode = useScene((s) => s.setSubSelectMode);
  const subSelection = useScene((s) => s.subSelection);
  const setSubSelection = useScene((s) => s.setSubSelection);
  const setEdgeFillets = useScene((s) => s.setEdgeFillets);
  const bakeScaleIntoDims = useScene((s) => s.bakeScaleIntoDims);

  // If the object is carrying a non-unit mesh scale, the next fillet/
  // chamfer write would compute the radius in BASE-space mm — i.e. it
  // would silently get sheared by the scale. CAD-correct behaviour
  // (TinkerCAD / Fusion 360) is to bake the scale into dims first so
  // the fillet radius is honoured in WORLD-space mm regardless of how
  // the user shaped the primitive. We bake lazily inside the write
  // handlers below so the user's first fillet edit also normalises
  // the scale; subsequent edits are no-ops.
  const sc = obj.scale || [1, 1, 1];
  const hasNonUnitScale = Math.abs(sc[0] - 1) > 1e-4 || Math.abs(sc[1] - 1) > 1e-4 || Math.abs(sc[2] - 1) > 1e-4;

  // Lazy-imported metadata so this file doesn't grow a hard dep chain
  // across the whole component tree. The module is tiny.
  const meta = edgeFaceMeta;
  const edges = meta.getEdgesForType(obj.type);
  const faces = meta.getFacesForType(obj.type);

  const d = obj.dims || {};
  const filletMap = obj.edgeFillets || {};
  const hasPerEdge = Object.keys(filletMap).length > 0;

  // ── Resolve "what's currently being edited" based on subSelectMode ──
  // The radius/style controls below read & write through this resolver
  // so a single set of inputs serves every mode.
  let currentLabel, currentEdgeIds, currentStyle, currentRadius, maxR;
  if (subSelectMode === "edge" && subSelection?.kind === "edge") {
    currentLabel = edges.find((e) => e.id === subSelection.id)?.label || subSelection.id;
    currentEdgeIds = [subSelection.id];
    const cfg = filletMap[subSelection.id];
    currentStyle = cfg?.style === "chamfer" ? "chamfer" : "fillet";
    currentRadius = cfg?.radius || 0;
  } else if (subSelectMode === "face" && subSelection?.kind === "face") {
    const f = faces.find((x) => x.id === subSelection.id);
    currentLabel = f?.label || subSelection.id;
    currentEdgeIds = f ? [...f.edges] : [];
    // Style + radius shared across all 4 edges; use the first edge's
    // value as the displayed default so re-opening shows the existing
    // state. If they diverge (e.g. user edited individual edges later)
    // the display falls back to the median.
    const cfgs = currentEdgeIds.map((eid) => filletMap[eid]).filter(Boolean);
    currentStyle = cfgs[0]?.style === "chamfer" ? "chamfer" : "fillet";
    currentRadius = cfgs.length ? (cfgs.reduce((s, c) => s + (c.radius || 0), 0) / cfgs.length) : 0;
  } else if (subSelectMode === "vertex" && subSelection?.kind === "vertex") {
    currentLabel = "Whole item";
    currentEdgeIds = edges.map((e) => e.id);
    // Use legacy uniform values as defaults when no per-edge yet exists.
    currentStyle = hasPerEdge
      ? (Object.values(filletMap)[0]?.style === "chamfer" ? "chamfer" : "fillet")
      : (d.edgeStyle === "chamfer" ? "chamfer" : "fillet");
    currentRadius = hasPerEdge
      ? (Object.values(filletMap).reduce((s, c) => s + (c.radius || 0), 0) / Math.max(1, Object.values(filletMap).length))
      : (d.edgeRadius || 0);
  } else {
    // "object" (legacy uniform) path — edits obj.dims.edgeStyle/edgeRadius.
    // If per-edge entries already exist (e.g. user came back here after
    // editing individual faces), reflect their median so the slider has
    // a meaningful starting position. writeRadius() then propagates any
    // change across every existing per-edge entry, keeping Item-mode
    // edits visible even after the user has set per-edge fillets.
    currentLabel = "Whole item";
    currentEdgeIds = null; // signals legacy uniform write
    if (hasPerEdge) {
      const cfgs = Object.values(filletMap);
      currentStyle = cfgs[0]?.style === "chamfer" ? "chamfer" : "fillet";
      currentRadius = cfgs.reduce((s, c) => s + (c.radius || 0), 0) / cfgs.length;
    } else {
      currentStyle = d.edgeStyle === "chamfer" ? "chamfer" : "fillet";
      currentRadius = d.edgeRadius || 0;
    }
  }

  // Max allowed edge radius depends on the primitive's shortest half-
  // extent — IN WORLD SPACE, since a non-unit mesh scale is about to be
  // baked into dims on the next edit. Computing in base space would
  // either over- or under-cap the slider relative to what the user
  // sees in the viewport.
  const effX = (d.x || 20) * sc[0];
  const effY = (d.z || 20) * sc[1];  // world Y / height
  const effZ = (d.y || 20) * sc[2];  // world Z / depth
  if (obj.type === "cube") {
    maxR = Math.min(effX, effZ, effY) / 2 - 0.001;
  } else if (obj.type === "cylinder") {
    const effR = (d.r || 10) * Math.sqrt(Math.max(0, sc[0]) * Math.max(0, sc[2]));
    maxR = Math.min(effR, effY / 2) - 0.001;
  } else if (obj.type === "cone") {
    const effR = (d.r || 10) * Math.sqrt(Math.max(0, sc[0]) * Math.max(0, sc[2]));
    maxR = Math.min(effR, effY) - 0.001;
  } else {
    maxR = 10;
  }
  maxR = Math.max(0, maxR);

  // ── Write handlers ──
  // Item mode semantics: editing in Item mode is "I want the same
  // fillet on every edge." The cleanest way to deliver that is to drop
  // the per-edge map entirely so geometry.js routes through the fast
  // uniform RoundedBoxGeometry / lathe path. Switching back into Edge
  // / Face / Vertex modes will materialise the uniform value into per-
  // edge entries on first edit, so the user's value isn't lost.
  const writeRadius = (v) => {
    const clamped = Math.max(0, Math.min(maxR, v));
    // Normalise mesh scale into dims so the chamfer/fillet radius
    // is honoured in world-space mm. No-op if scale is already unit.
    if (hasNonUnitScale) bakeScaleIntoDims(obj.id);
    if (currentEdgeIds === null) {
      // Legacy uniform path — clear the per-edge map so the fast
      // RoundedBoxGeometry / lathe path renders the whole-item fillet.
      if (hasPerEdge) {
        setEdgeFillets(obj.id, Object.keys(filletMap), 0, currentStyle);
      }
      updateDims(obj.id, { edgeRadius: clamped, edgeStyle: currentStyle });
    } else {
      // Per-edge / face / vertex: write ONLY the picked edges. Other
      // edges keep whatever they had (per-edge entries already set OR
      // the global d.edgeRadius default applied in partialFillet.js).
      // No "materialise uniform across all 12" — that surprised users
      // by making a single-edge edit cascade to every other edge.
      setEdgeFillets(obj.id, currentEdgeIds, clamped, currentStyle);
    }
  };
  const writeStyle = (s) => {
    if (hasNonUnitScale) bakeScaleIntoDims(obj.id);
    if (currentEdgeIds === null) {
      // Item mode — same semantics as writeRadius: clear per-edge map,
      // write legacy uniform style.
      if (hasPerEdge) {
        // Preserve any existing per-edge radii but flatten their style
        // by erasing+rewriting them at the uniform radius. Simpler:
        // just clear and let the legacy edgeRadius handle it.
        setEdgeFillets(obj.id, Object.keys(filletMap), 0, s);
      }
      updateDims(obj.id, { edgeStyle: s });
    } else {
      // Re-write the current edges with the new style at the same radius.
      // If no radius set yet, default to 2 mm so the change is visible.
      const r = currentRadius > 0.05 ? currentRadius : Math.min(2, maxR);
      setEdgeFillets(obj.id, currentEdgeIds, r, s);
    }
  };

  const off = currentRadius <= 0.05;
  const showSubPicker = (obj.type === "cube" || obj.type === "cylinder" || obj.type === "cone");
  const modes = obj.type === "cube"
    ? ["object", "face", "edge", "vertex"]
    : ["object", "face", "edge"]; // cyl/cone: vertex doesn't make sense as a real pick

  return (
    <div className="mt-3 bg-slate-950/60 border border-orange-500/30 rounded p-2 space-y-2" data-testid="edge-controls">
      <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold flex items-center justify-between">
        <span>Edge {currentStyle}</span>
        <span className="text-[9px] normal-case text-slate-500">{off ? "sharp" : `${currentRadius.toFixed(2)} mm`}</span>
      </div>

      {/* Sub-element selection mode picker. "Object" = legacy whole-item.
          Face / Edge / Vertex enter pick mode in the viewport. */}
      {showSubPicker && (
        <div className="flex gap-0.5 bg-slate-900/60 border border-slate-700 rounded p-0.5" data-testid="edge-mode-picker">
          {modes.map((m) => {
            const labels = { object: "Item", face: "Face", edge: "Edge", vertex: "Vertex" };
            const active = subSelectMode === m;
            return (
              <button
                key={m}
                data-testid={`edge-mode-${m}`}
                onClick={() => setSubSelectMode(m)}
                className={`flex-1 h-6 rounded text-[10px] font-semibold transition-colors ${
                  active
                    ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/60"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
                title={
                  m === "object" ? "Edit uniform fillet for the whole item (fastest, classic)" :
                  m === "face"   ? "Click a face in the viewport — fillet abutting edges" :
                  m === "edge"   ? "Click an individual edge in the viewport" :
                                   "Click a corner — applies to all 12 edges"
                }
              >
                {labels[m]}
              </button>
            );
          })}
        </div>
      )}

      {/* Sub-element dropdown — quick keyboard / no-3D-picker access.
          Lets the user pick from the canonical list even when the
          viewport overlay isn't convenient. */}
      {showSubPicker && subSelectMode !== "object" && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">
            {subSelectMode === "face" ? "Face" : subSelectMode === "edge" ? "Edge" : "Corner"}:
          </span>
          <select
            data-testid="edge-subelement-picker"
            value={subSelection?.id || ""}
            onChange={(e) => {
              const id = e.target.value || null;
              setSubSelection(id ? { kind: subSelectMode, id } : null);
            }}
            className="flex-1 h-6 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-200 px-1.5"
          >
            <option value="">— pick {subSelectMode} —</option>
            {(subSelectMode === "face" ? faces
              : subSelectMode === "edge" ? edges
              : meta.getVerticesForType(obj.type)
            ).map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="text-[10px] text-slate-500" data-testid="edge-current-target">
        Editing: <span className="text-slate-300 font-medium">{currentLabel}</span>
        {subSelectMode !== "object" && !subSelection && (
          <span className="text-orange-400/70 ml-1"> (pick one in the viewport)</span>
        )}
      </div>

      {/* Inline "other-edges default" indicator. Visible in Edge / Face /
          Vertex modes when a global uniform radius exists on the cube.
          Tells the user "the edges you DON'T explicitly edit are still
          chamfered at 2 mm" so the layered (uniform + per-edge) model
          isn't a surprise. Clicking Clear empties the legacy field so
          the unedited edges go back to sharp without touching any
          per-edge entries the user has built up. */}
      {subSelectMode !== "object" && (d.edgeRadius || 0) > 0.05 && (
        <div
          data-testid="edge-uniform-default-indicator"
          className="flex items-center justify-between gap-2 text-[10px] bg-slate-900/60 border border-slate-700 rounded px-2 py-1"
        >
          <span className="text-slate-400">
            Other edges:
            <span className="text-slate-200 font-medium ml-1">
              {(d.edgeRadius || 0).toFixed(2)} mm {d.edgeStyle === "chamfer" ? "chamfer" : "fillet"}
            </span>
          </span>
          <button
            data-testid="edge-uniform-default-clear"
            onClick={() => {
              if (hasNonUnitScale) bakeScaleIntoDims(obj.id);
              updateDims(obj.id, { edgeRadius: 0 });
            }}
            className="px-2 h-5 rounded text-[10px] text-slate-400 hover:text-orange-300 hover:bg-slate-800"
            title="Make every edge that isn't individually filleted sharp again"
          >
            Clear
          </button>
        </div>
      )}

      <div className={`flex gap-1 ${subSelectMode !== "object" && !subSelection ? "opacity-40 pointer-events-none" : ""}`}>
        <button
          data-testid="edge-style-fillet"
          onClick={() => writeStyle("fillet")}
          className={`flex-1 h-7 rounded text-[10px] font-semibold border ${
            currentStyle === "fillet"
              ? "bg-orange-500/20 border-orange-500 text-orange-300"
              : "bg-slate-900 border-slate-700 text-slate-400 hover:border-orange-500/50"
          }`}
          title="Round the edges"
        >
          ◜ Fillet
        </button>
        <button
          data-testid="edge-style-chamfer"
          onClick={() => writeStyle("chamfer")}
          className={`flex-1 h-7 rounded text-[10px] font-semibold border ${
            currentStyle === "chamfer"
              ? "bg-orange-500/20 border-orange-500 text-orange-300"
              : "bg-slate-900 border-slate-700 text-slate-400 hover:border-orange-500/50"
          }`}
          title="Bevel the edges 45°"
        >
          ◢ Chamfer
        </button>
      </div>
      <div className={`${subSelectMode !== "object" && !subSelection ? "opacity-40 pointer-events-none" : ""}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Radius</span>
          <span data-testid="edge-radius-readout" className="text-[10px] font-mono text-orange-400">
            {currentRadius.toFixed(2)} / {maxR.toFixed(1)} mm
          </span>
        </div>
        <input
          data-testid="edge-radius-slider"
          type="range"
          min={0}
          max={Math.max(0.1, maxR)}
          step={Math.max(0.05, maxR / 200)}
          value={Math.min(currentRadius, maxR)}
          onChange={(e) => writeRadius(parseFloat(e.target.value))}
          className="w-full accent-orange-500"
        />
        <div className="mt-1 grid grid-cols-4 gap-1">
          {[0, 1, 2, 5].map((preset) => {
            const v = Math.min(preset, maxR);
            const active = Math.abs(currentRadius - v) < 0.05;
            return (
              <button
                key={preset}
                data-testid={`edge-radius-preset-${preset}`}
                onClick={() => writeRadius(v)}
                className={`h-6 text-[10px] font-mono rounded border ${
                  active
                    ? "border-orange-500 bg-orange-500/15 text-orange-300"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-orange-500/50"
                }`}
              >
                {preset === 0 ? "Off" : `${preset}mm`}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default EdgeControls;

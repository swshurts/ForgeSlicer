import React, { useState } from "react";
import { useScene, useSliceSettings } from "../lib/store";
import { sliceToGCODE } from "../lib/slicer";
import { downloadText } from "../lib/exporters";
import { Printer, Sliders, Activity, Sigma, AlertTriangle } from "lucide-react";

function NumberField({ label, value, onChange, step = 1, min, max, testid, suffix }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      <div className="relative flex items-center">
        <input
          data-testid={testid}
          type="number"
          step={step}
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value || "0"))}
          className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 pr-7 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none font-mono"
        />
        {suffix && <span className="absolute right-2 text-[10px] text-slate-500 font-mono">{suffix}</span>}
      </div>
    </label>
  );
}

function Section({ title, icon: Icon, children, testid }) {
  return (
    <div className="border-b border-slate-800" data-testid={testid}>
      <div className="px-3 py-2 flex items-center gap-2 bg-slate-900/40">
        {Icon && <Icon size={12} className="text-slate-500" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</span>
      </div>
      <div className="p-3 flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Inspector() {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const updateObject = useScene((s) => s.updateObject);
  const updateDims = useScene((s) => s.updateDims);
  const setTransform = useScene((s) => s.setTransform);
  const flipModifier = useScene((s) => s.flipModifier);

  const obj = objects.find((o) => o.id === selectedId);
  if (!obj) {
    return (
      <Section title="Inspector" icon={Sliders} testid="inspector-empty">
        <div className="text-xs text-slate-500 italic">Select an object to edit its properties.</div>
      </Section>
    );
  }

  const setPos = (i, v) => {
    const p = [...obj.position]; p[i] = v; setTransform(obj.id, "position", p);
  };
  const setRot = (i, v) => {
    const r = [...obj.rotation]; r[i] = v; setTransform(obj.id, "rotation", r);
  };
  const setScl = (i, v) => {
    const s = [...obj.scale]; s[i] = v; setTransform(obj.id, "scale", s);
  };

  return (
    <Section title={`Inspector — ${obj.type}`} icon={Sliders} testid="inspector">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Name</span>
        <input
          data-testid="inspector-name"
          value={obj.name}
          onChange={(e) => updateObject(obj.id, { name: e.target.value })}
          className="h-8 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
        />
      </label>

      <div className="flex gap-2">
        <button
          data-testid="inspector-mod-positive"
          onClick={() => obj.modifier === "negative" && flipModifier(obj.id)}
          className={`flex-1 h-8 rounded text-xs font-semibold border ${
            obj.modifier !== "negative"
              ? "bg-orange-500/20 border-orange-500 text-orange-300"
              : "bg-slate-900 border-slate-700 text-slate-400 hover:border-orange-500/60"
          }`}
        >
          POSITIVE
        </button>
        <button
          data-testid="inspector-mod-negative"
          onClick={() => obj.modifier !== "negative" && flipModifier(obj.id)}
          className={`flex-1 h-8 rounded text-xs font-semibold border ${
            obj.modifier === "negative"
              ? "bg-cyan-500/20 border-cyan-500 text-cyan-300"
              : "bg-slate-900 border-slate-700 text-slate-400 hover:border-cyan-500/60"
          }`}
        >
          NEGATIVE
        </button>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Position (mm)</div>
        <div className="grid grid-cols-3 gap-2">
          <NumberField testid="transform-x-input" label="X" value={obj.position[0]} onChange={(v) => setPos(0, v)} step={0.5} />
          <NumberField testid="transform-y-input" label="Y" value={obj.position[1]} onChange={(v) => setPos(1, v)} step={0.5} />
          <NumberField testid="transform-z-input" label="Z" value={obj.position[2]} onChange={(v) => setPos(2, v)} step={0.5} />
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Rotation (deg)</div>
        <div className="grid grid-cols-3 gap-2">
          <NumberField testid="rotation-x" label="X" value={obj.rotation[0]} onChange={(v) => setRot(0, v)} step={5} />
          <NumberField testid="rotation-y" label="Y" value={obj.rotation[1]} onChange={(v) => setRot(1, v)} step={5} />
          <NumberField testid="rotation-z" label="Z" value={obj.rotation[2]} onChange={(v) => setRot(2, v)} step={5} />
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Scale</div>
        <div className="grid grid-cols-3 gap-2">
          <NumberField testid="scale-x" label="X" value={obj.scale[0]} onChange={(v) => setScl(0, v)} step={0.1} />
          <NumberField testid="scale-y" label="Y" value={obj.scale[1]} onChange={(v) => setScl(1, v)} step={0.1} />
          <NumberField testid="scale-z" label="Z" value={obj.scale[2]} onChange={(v) => setScl(2, v)} step={0.1} />
        </div>
      </div>

      {obj.type === "cube" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions (mm)</div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField testid="dim-x" label="W" value={obj.dims.x} onChange={(v) => updateDims(obj.id, { x: v })} step={1} min={0.1} />
            <NumberField testid="dim-y" label="D" value={obj.dims.y} onChange={(v) => updateDims(obj.id, { y: v })} step={1} min={0.1} />
            <NumberField testid="dim-z" label="H" value={obj.dims.z} onChange={(v) => updateDims(obj.id, { z: v })} step={1} min={0.1} />
          </div>
        </div>
      )}
      {(obj.type === "sphere" || obj.type === "cylinder" || obj.type === "cone") && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions (mm)</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField testid="dim-r" label="Radius" value={obj.dims.r} onChange={(v) => updateDims(obj.id, { r: v })} step={0.5} min={0.1} />
            {obj.type !== "sphere" && (
              <NumberField testid="dim-h" label="Height" value={obj.dims.h} onChange={(v) => updateDims(obj.id, { h: v })} step={0.5} min={0.1} />
            )}
          </div>
        </div>
      )}
      {obj.type === "torus" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions (mm)</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField testid="dim-r" label="Radius" value={obj.dims.r} onChange={(v) => updateDims(obj.id, { r: v })} step={0.5} />
            <NumberField testid="dim-tube" label="Tube" value={obj.dims.tube} onChange={(v) => updateDims(obj.id, { tube: v })} step={0.2} />
          </div>
        </div>
      )}
    </Section>
  );
}

function SliceStats({ stats }) {
  if (!stats) return null;
  return (
    <div className="bg-slate-950 border border-slate-700 rounded p-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono" data-testid="slice-stats">
      <span className="text-slate-500">Layers</span>
      <span className="text-orange-400 text-right">{stats.layers}</span>
      <span className="text-slate-500">Segments</span>
      <span className="text-orange-400 text-right">{stats.segments}</span>
      <span className="text-slate-500">Filament</span>
      <span className="text-orange-400 text-right">{stats.filamentMM.toFixed(1)} mm</span>
      <span className="text-slate-500">BBox X</span>
      <span className="text-slate-300 text-right">{stats.bbox.x.toFixed(1)} mm</span>
      <span className="text-slate-500">BBox Y</span>
      <span className="text-slate-300 text-right">{stats.bbox.y.toFixed(1)} mm</span>
      <span className="text-slate-500">BBox Z</span>
      <span className="text-slate-300 text-right">{stats.bbox.z.toFixed(1)} mm</span>
    </div>
  );
}

function SlicerSection() {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const settings = useSliceSettings();
  const setS = useSliceSettings((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);

  const handleSlice = async () => {
    setError(""); setBusy(true); setStats(null);
    try {
      // run in microtask to allow UI repaint
      await new Promise((r) => setTimeout(r, 30));
      const { gcode, stats } = sliceToGCODE(objects, settings);
      setStats(stats);
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      downloadText(gcode, `${safe}.gcode`, "text/plain");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Slicer Settings" icon={Printer} testid="slicer-section">
      <div className="grid grid-cols-2 gap-2">
        <NumberField testid="slice-layer-height" label="Layer Height" value={settings.layerHeight} onChange={(v) => setS({ layerHeight: v })} step={0.05} min={0.05} suffix="mm" />
        <NumberField testid="slice-first-layer" label="First Layer" value={settings.firstLayerHeight} onChange={(v) => setS({ firstLayerHeight: v })} step={0.05} min={0.05} suffix="mm" />
        <NumberField testid="slice-nozzle" label="Nozzle" value={settings.nozzleDiameter} onChange={(v) => setS({ nozzleDiameter: v })} step={0.05} min={0.1} suffix="mm" />
        <NumberField testid="slice-filament" label="Filament Ø" value={settings.filamentDiameter} onChange={(v) => setS({ filamentDiameter: v })} step={0.05} suffix="mm" />
        <NumberField testid="slice-print-speed" label="Print Speed" value={settings.printSpeed} onChange={(v) => setS({ printSpeed: v })} step={5} suffix="mm/s" />
        <NumberField testid="slice-travel-speed" label="Travel" value={settings.travelSpeed} onChange={(v) => setS({ travelSpeed: v })} step={5} suffix="mm/s" />
        <NumberField testid="slice-nozzle-temp" label="Hotend" value={settings.nozzleTemp} onChange={(v) => setS({ nozzleTemp: v })} step={5} suffix="°C" />
        <NumberField testid="slice-bed-temp" label="Bed" value={settings.bedTemp} onChange={(v) => setS({ bedTemp: v })} step={5} suffix="°C" />
      </div>
      <div className="text-[10px] text-amber-400/80 flex items-start gap-1 font-medium leading-tight">
        <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
        <span>Preview slicer: perimeter contours only. For production prints use OrcaSlicer with the exported 3MF.</span>
      </div>
      <button
        data-testid="slice-model-btn"
        onClick={handleSlice}
        disabled={busy || objects.length === 0}
        className="w-full h-10 bg-green-500 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-md shadow-md transition-all uppercase tracking-wide text-sm flex items-center justify-center gap-2"
      >
        <Activity size={16} />
        {busy ? "Slicing..." : "Slice & Export GCODE"}
      </button>
      {error && <div className="text-xs text-red-400" data-testid="slice-error">{error}</div>}
      <SliceStats stats={stats} />
    </Section>
  );
}

function StatsSection() {
  const objects = useScene((s) => s.objects);
  const visibles = objects.filter((o) => o.visible);
  const positives = visibles.filter((o) => o.modifier !== "negative").length;
  const negatives = visibles.filter((o) => o.modifier === "negative").length;
  return (
    <Section title="Scene" icon={Sigma} testid="scene-stats">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono">
        <span className="text-slate-500">Components</span>
        <span className="text-slate-200 text-right">{objects.length}</span>
        <span className="text-slate-500">Positive</span>
        <span className="text-orange-400 text-right">{positives}</span>
        <span className="text-slate-500">Negative</span>
        <span className="text-cyan-400 text-right">{negatives}</span>
      </div>
    </Section>
  );
}

export default function RightPanel() {
  return (
    <aside className="w-72 flex-shrink-0 border-l border-slate-800 bg-slate-900 flex flex-col h-full overflow-y-auto" data-testid="right-panel">
      <Inspector />
      <StatsSection />
      <SlicerSection />
    </aside>
  );
}

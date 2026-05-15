import React, { useState, useMemo, useEffect } from "react";
import { useScene, useSliceSettings, PRINTERS, FILAMENTS } from "../lib/store";
import { getPrinter, getFilament } from "../lib/presets";
import { sliceToGCODE } from "../lib/slicer";
import { downloadText } from "../lib/exporters";
import { evaluateScene } from "../lib/csg";
import { printersApi } from "../lib/api";
import { Printer, Sliders, Activity, Sigma, AlertTriangle, Beaker, Factory, Upload, Trash2, ArrowDownToLine, ShieldAlert } from "lucide-react";

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

function Section({ title, icon: Icon, children, testid, accent = "text-slate-500" }) {
  return (
    <div className="border-b border-slate-800" data-testid={testid}>
      <div className="px-3 py-2 flex items-center gap-2 bg-slate-900/40">
        {Icon && <Icon size={12} className={accent} />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</span>
      </div>
      <div className="p-3 flex flex-col gap-3">{children}</div>
    </div>
  );
}

// Group printers by brand for the select (built-ins + community)
function printerOptions(community) {
  const byBrand = {};
  for (const p of PRINTERS) {
    if (!byBrand[p.brand]) byBrand[p.brand] = [];
    byBrand[p.brand].push({ id: p.id, label: p.name, kind: "builtin" });
  }
  if (community && community.length > 0) {
    byBrand["Community"] = community.map((c) => ({
      id: c.id,
      label: `${c.brand} ${c.name}${c.uses ? ` · ${c.uses}★` : ""}`,
      kind: "community",
    }));
  }
  return byBrand;
}

function findPrinterAny(id, community) {
  return (
    PRINTERS.find((p) => p.id === id) ||
    (() => {
      const c = community.find((x) => x.id === id);
      if (!c) return null;
      return {
        id: c.id,
        brand: c.brand,
        name: c.name,
        buildVolume: { x: c.build_x, y: c.build_y, z: c.build_z },
        maxNozzleTemp: c.max_nozzle_temp,
        maxBedTemp: c.max_bed_temp,
        defaultNozzle: c.default_nozzle,
        defaultPrintSpeed: c.default_print_speed,
        notes: c.notes,
        submitter: c.submitter,
        community: true,
      };
    })()
  );
}

function ProfileSection({ onSavePrinter }) {
  const printerId = useScene((s) => s.printerId);
  const filamentId = useScene((s) => s.filamentId);
  const community = useScene((s) => s.communityPrinters);
  const setPrinter = useScene((s) => s.setPrinter);
  const setFilament = useScene((s) => s.setFilament);
  const removeCommunityPrinter = useScene((s) => s.removeCommunityPrinter);
  const setS = useSliceSettings((s) => s.set);
  const autoDropOnRotate = useScene((s) => s.autoDropOnRotate);
  const setAutoDropOnRotate = useScene((s) => s.setAutoDropOnRotate);

  const printer = findPrinterAny(printerId, community) || getPrinter("custom");
  const filament = getFilament(filamentId);
  const groups = useMemo(() => printerOptions(community), [community]);
  const isCommunity = !!printer.community;

  const handlePrinter = (id) => {
    const p = findPrinterAny(id, community);
    if (!p) return;
    setPrinter(id);
    setS({
      nozzleDiameter: p.defaultNozzle,
      printSpeed: Math.round((p.defaultPrintSpeed || 100) * (filament.printSpeedMultiplier || 1)),
    });
    if (p.community) printersApi.use(id);
  };
  const handleFilament = (id) => {
    const f = getFilament(id);
    setFilament(id);
    setS({
      nozzleTemp: f.nozzleTemp,
      bedTemp: f.bedTemp,
      retraction: f.retraction,
      printSpeed: Math.round((printer.defaultPrintSpeed || 100) * (f.printSpeedMultiplier || 1)),
    });
  };
  const handleRemoveCommunity = async () => {
    if (!isCommunity) return;
    if (!window.confirm(`Remove community printer "${printer.brand} ${printer.name}"?`)) return;
    try {
      await printersApi.delete(printer.id);
      removeCommunityPrinter(printer.id);
      setPrinter("custom");
    } catch (e) {
      window.alert("Delete failed: " + (e.response?.data?.detail || e.message));
    }
  };

  return (
    <Section title="Printer & Filament" icon={Factory} testid="profile-section" accent="text-orange-500">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium flex items-center justify-between">
          Printer
          <button
            data-testid="save-printer-btn"
            onClick={onSavePrinter}
            className="text-[10px] text-orange-400 hover:text-orange-300 flex items-center gap-1 normal-case tracking-normal font-semibold"
          >
            <Upload size={11} /> Save mine
          </button>
        </span>
        <select
          data-testid="printer-select"
          value={printerId}
          onChange={(e) => handlePrinter(e.target.value)}
          className="h-8 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
        >
          {Object.keys(groups).map((brand) => (
            <optgroup key={brand} label={brand}>
              {groups[brand].map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] font-mono bg-slate-950/60 border border-slate-800 rounded p-2">
        <span className="text-slate-500">Volume</span>
        <span className="col-span-2 text-slate-200 text-right">
          {printer.buildVolume.x}×{printer.buildVolume.y}×{printer.buildVolume.z} mm
        </span>
        <span className="text-slate-500">Max hotend</span>
        <span className="col-span-2 text-slate-200 text-right">{printer.maxNozzleTemp} °C</span>
        <span className="text-slate-500">Max bed</span>
        <span className="col-span-2 text-slate-200 text-right">{printer.maxBedTemp} °C</span>
        {isCommunity && (
          <>
            <span className="text-slate-500">Submitter</span>
            <span className="col-span-2 text-orange-400 text-right">{printer.submitter || "Anonymous"}</span>
            {printer.notes && (
              <span className="col-span-3 text-slate-400 italic text-[10px] leading-snug pt-1 normal-case">
                "{printer.notes}"
              </span>
            )}
            <button
              data-testid="delete-community-printer-btn"
              onClick={handleRemoveCommunity}
              className="col-span-3 mt-1 h-6 text-[10px] flex items-center justify-center gap-1 bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded border border-slate-700"
            >
              <Trash2 size={10} /> Remove from community
            </button>
          </>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Filament</span>
        <select
          data-testid="filament-select"
          value={filamentId}
          onChange={(e) => handleFilament(e.target.value)}
          className="h-8 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
        >
          {FILAMENTS.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <p className="text-[10px] text-slate-400 leading-snug">{filament.notes}</p>

      <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
        <input
          data-testid="auto-drop-toggle"
          type="checkbox"
          checked={autoDropOnRotate}
          onChange={(e) => setAutoDropOnRotate(e.target.checked)}
          className="accent-orange-500"
        />
        Auto-drop to bed on rotate
      </label>
    </Section>
  );
}

function ManifoldHealth() {
  const objects = useScene((s) => s.objects);
  const [info, setInfo] = useState({ ok: true, edges: 0, tris: 0 });

  // Debounced recompute when scene changes
  useEffect(() => {
    if (objects.length === 0) {
      setInfo({ ok: true, edges: 0, tris: 0 });
      return;
    }
    const handle = setTimeout(() => {
      try {
        const r = evaluateScene(objects);
        setInfo({ ok: r.manifold, edges: r.boundaryEdges, tris: r.triangleCount });
      } catch (_) {
        setInfo({ ok: true, edges: 0, tris: 0 });
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [objects]);

  if (info.ok || info.tris === 0) return null;
  return (
    <div className="mx-3 mb-3 rounded border border-blue-500/40 bg-blue-500/10 p-2" data-testid="manifold-warning">
      <div className="flex items-center gap-1 text-blue-300 text-[10px] font-semibold uppercase tracking-wider mb-1">
        <ShieldAlert size={11} /> Mesh has {info.edges} open edges
      </div>
      <p className="text-[11px] text-blue-100/90 leading-snug">
        Your Boolean operation produced a near-tangent boundary that the CSG engine
        can't perfectly close. <span className="text-white font-medium">Your print will still slice fine</span> —
        modern slicers (OrcaSlicer, PrusaSlicer, FlashPrint 5, Bambu Studio) all auto-repair on import.
        For perfect manifold geometry, slightly overlap or fully separate the parts.
      </p>
    </div>
  );
}

function CompatibilityWarning() {
  const objects = useScene((s) => s.objects);
  const buildVolume = useScene((s) => s.buildVolume);
  const printerId = useScene((s) => s.printerId);
  const filamentId = useScene((s) => s.filamentId);
  const settings = useSliceSettings();
  const printer = getPrinter(printerId);
  const filament = getFilament(filamentId);

  const warnings = [];

  // Build-volume check: estimate world bbox from object positions + dims
  // (approximation: use position +/- max extent from dims/scale)
  for (const o of objects) {
    if (!o.visible) continue;
    const half = estimateHalfExtents(o);
    const max = [
      o.position[0] + half[0],
      o.position[1] + half[1] * 2,
      o.position[2] + half[2],
    ];
    const min = [o.position[0] - half[0], 0, o.position[2] - half[2]];
    if (
      max[0] > buildVolume.x / 2 || min[0] < -buildVolume.x / 2 ||
      max[2] > buildVolume.y / 2 || min[2] < -buildVolume.y / 2 ||
      max[1] > buildVolume.z
    ) {
      warnings.push(`"${o.name}" extends beyond ${printer.name} build volume`);
      break; // one is enough
    }
  }

  if (settings.nozzleTemp > printer.maxNozzleTemp) {
    warnings.push(`Hotend ${settings.nozzleTemp}°C exceeds printer max ${printer.maxNozzleTemp}°C`);
  }
  if (settings.bedTemp > printer.maxBedTemp) {
    warnings.push(`Bed ${settings.bedTemp}°C exceeds printer max ${printer.maxBedTemp}°C`);
  }
  if (settings.nozzleTemp < filament.minNozzleTemp || settings.nozzleTemp > filament.maxNozzleTemp) {
    warnings.push(`Hotend ${settings.nozzleTemp}°C outside ${filament.name} range (${filament.minNozzleTemp}–${filament.maxNozzleTemp}°C)`);
  }

  if (warnings.length === 0) return null;
  return (
    <div className="mx-3 mb-3 rounded border border-amber-500/40 bg-amber-500/10 p-2" data-testid="compat-warning">
      <div className="flex items-center gap-1 text-amber-400 text-[10px] font-semibold uppercase tracking-wider mb-1">
        <AlertTriangle size={11} /> Compatibility
      </div>
      <ul className="text-[11px] text-amber-100/90 list-disc list-inside space-y-0.5">
        {warnings.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
    </div>
  );
}

function estimateHalfExtents(o) {
  const d = o.dims || {};
  const s = o.scale || [1, 1, 1];
  if (o.type === "cube") return [(d.x || 20) / 2 * s[0], (d.z || 20) / 2 * s[1], (d.y || 20) / 2 * s[2]];
  if (o.type === "sphere") return [(d.r || 10) * s[0], (d.r || 10) * s[1], (d.r || 10) * s[2]];
  if (o.type === "cylinder" || o.type === "cone") return [(d.r || 10) * s[0], (d.h || 20) / 2 * s[1], (d.r || 10) * s[2]];
  if (o.type === "torus") return [((d.r || 12) + (d.tube || 4)) * s[0], (d.tube || 4) * s[1], ((d.r || 12) + (d.tube || 4)) * s[2]];
  if (o.originalBbox) return [o.originalBbox.x / 2 * s[0], o.originalBbox.y / 2 * s[1], o.originalBbox.z / 2 * s[2]];
  return [10, 10, 10];
}

function Inspector() {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const updateObject = useScene((s) => s.updateObject);
  const updateDims = useScene((s) => s.updateDims);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const setImportedDim = useScene((s) => s.setImportedDim);
  const flipModifier = useScene((s) => s.flipModifier);
  const dropToBed = useScene((s) => s.dropToBed);
  const autoDropOnRotate = useScene((s) => s.autoDropOnRotate);

  const obj = objects.find((o) => o.id === selectedId);
  if (!obj) {
    return (
      <Section title="Inspector" icon={Sliders} testid="inspector-empty">
        <div className="text-xs text-slate-500 italic">Select an object to edit its properties.</div>
      </Section>
    );
  }

  const setPos = (i, v) => {
    const p = [...obj.position]; p[i] = v; setTransformWithHistory(obj.id, "position", p);
  };
  const setRot = (i, v) => {
    const r = [...obj.rotation]; r[i] = v;
    setTransformWithHistory(obj.id, "rotation", r);
    if (autoDropOnRotate) {
      setTimeout(() => dropToBed(obj.id, false), 0);
    }
  };
  const setScl = (i, v) => {
    const s = [...obj.scale]; s[i] = v; setTransformWithHistory(obj.id, "scale", s);
  };

  const isImported = obj.type === "imported";

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

      <button
        data-testid="drop-to-bed-btn"
        onClick={() => dropToBed(obj.id)}
        className="h-8 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-slate-700"
        title="Drop object so its lowest point sits on Y=0"
      >
        <ArrowDownToLine size={13} /> Drop to Bed
      </button>

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

      {isImported && obj.originalBbox && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center gap-1">
            <Beaker size={10} /> Real Size (mm)
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              testid="imported-dim-x"
              label="X"
              value={obj.originalBbox.x * obj.scale[0]}
              onChange={(v) => setImportedDim(obj.id, "x", v)}
              step={0.5} min={0.1}
            />
            <NumberField
              testid="imported-dim-y"
              label="Y"
              value={obj.originalBbox.y * obj.scale[1]}
              onChange={(v) => setImportedDim(obj.id, "y", v)}
              step={0.5} min={0.1}
            />
            <NumberField
              testid="imported-dim-z"
              label="Z"
              value={obj.originalBbox.z * obj.scale[2]}
              onChange={(v) => setImportedDim(obj.id, "z", v)}
              step={0.5} min={0.1}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            Original: {obj.originalBbox.x.toFixed(2)} × {obj.originalBbox.y.toFixed(2)} × {obj.originalBbox.z.toFixed(2)} mm
          </p>
        </div>
      )}

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
  const buildVolume = useScene((s) => s.buildVolume);
  const settings = useSliceSettings();
  const setS = useSliceSettings((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);

  const handleSlice = async () => {
    setError(""); setBusy(true); setStats(null);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const { gcode, stats } = sliceToGCODE(objects, {
        ...settings,
        bedX: buildVolume.x,
        bedY: buildVolume.y,
      });
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
  const measurements = useScene((s) => s.measurements);
  const clearMeasurements = useScene((s) => s.clearMeasurements);
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
        <span className="text-slate-500">Measurements</span>
        <span className="text-slate-200 text-right">{measurements.length}</span>
      </div>
      {measurements.length > 0 && (
        <button
          data-testid="clear-measurements-btn"
          onClick={clearMeasurements}
          className="h-7 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
        >
          Clear measurements
        </button>
      )}
    </Section>
  );
}

export default function RightPanel({ onSavePrinter }) {
  const setCommunity = useScene((s) => s.setCommunityPrinters);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await printersApi.list();
        if (!cancelled) setCommunity(list);
      } catch (_) { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [setCommunity]);

  return (
    <aside className="w-72 flex-shrink-0 border-l border-slate-800 bg-slate-900 flex flex-col h-full overflow-y-auto" data-testid="right-panel">
      <Inspector />
      <ProfileSection onSavePrinter={onSavePrinter} />
      <CompatibilityWarning />
      <ManifoldHealth />
      <StatsSection />
      <SlicerSection />
    </aside>
  );
}

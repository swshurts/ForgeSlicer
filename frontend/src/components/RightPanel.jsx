import React, { useState, useMemo, useEffect } from "react";
import { useScene, PRINTERS, FILAMENTS } from "../lib/store";
import { useSliceSettings } from "../lib/store";
import { getPrinter, getFilament } from "../lib/presets";
import { MULTICOLOR_PALETTE } from "../lib/presets";
import { evaluateSceneStatsAsync } from "../lib/workerClient";
import { computeRotatedBBox } from "../lib/geometry";
import { printersApi } from "../lib/api";
import { recentPrinters, upvotedPrinters } from "../lib/persist";
import { Printer, Sliders, Sigma, AlertTriangle, Factory, Upload, Trash2, ArrowDownToLine, ShieldAlert, Star, BadgeCheck, History } from "lucide-react";

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
  const setCommunity = useScene((s) => s.setCommunityPrinters);
  const setPrinter = useScene((s) => s.setPrinter);
  const setFilament = useScene((s) => s.setFilament);
  const removeCommunityPrinter = useScene((s) => s.removeCommunityPrinter);
  const setS = useSliceSettings((s) => s.set);
  const autoDropOnRotate = useScene((s) => s.autoDropOnRotate);
  const setAutoDropOnRotate = useScene((s) => s.setAutoDropOnRotate);
  const autoDropNew = useScene((s) => s.autoDropNew);
  const setAutoDropNew = useScene((s) => s.setAutoDropNew);
  const [recents, setRecents] = useState(() => recentPrinters.list());
  const [upvoting, setUpvoting] = useState(false);

  const printer = findPrinterAny(printerId, community) || getPrinter("custom");
  const filament = getFilament(filamentId);
  const groups = useMemo(() => printerOptions(community), [community]);
  const isCommunity = !!printer.community;
  const recentEntries = useMemo(
    () =>
      recents
        .map((id) => findPrinterAny(id, community))
        .filter(Boolean)
        .filter((p) => p.id !== printerId)
        .slice(0, 4),
    [recents, community, printerId]
  );

  const handlePrinter = (id) => {
    const p = findPrinterAny(id, community);
    if (!p) return;
    setPrinter(id);
    setRecents(recentPrinters.push(id));
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
  const handleUpvote = async () => {
    if (!isCommunity || upvoting || upvotedPrinters.has(printer.id)) return;
    setUpvoting(true);
    try {
      const res = await printersApi.upvote(printer.id);
      upvotedPrinters.add(printer.id);
      // refresh community list to reflect new vote count
      const list = await printersApi.list();
      setCommunity(list);
    } catch (e) {
      window.alert("Vote failed: " + (e.response?.data?.detail || e.message));
    } finally { setUpvoting(false); }
  };
  const alreadyVoted = isCommunity && upvotedPrinters.has(printer.id);

  return (
    <Section title="Printer & Filament" icon={Factory} testid="profile-section" accent="text-orange-500">
      {recentEntries.length > 0 && (
        <div data-testid="recent-printers">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center gap-1">
            <History size={10} /> Recent
          </div>
          <div className="flex flex-wrap gap-1">
            {recentEntries.map((p) => (
              <button
                key={p.id}
                data-testid={`recent-printer-${p.id}`}
                onClick={() => handlePrinter(p.id)}
                className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-orange-500/20 hover:text-orange-300 text-slate-300 border border-slate-700 truncate max-w-[120px]"
                title={`${p.brand} ${p.name}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
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
            <span className="col-span-2 text-orange-400 text-right flex items-center justify-end gap-1">
              {printer.submitter || "Anonymous"}
              {printer.verified && <BadgeCheck size={11} className="text-green-400" />}
            </span>
            <span className="text-slate-500">Votes</span>
            <span className="col-span-2 text-slate-200 text-right font-bold">
              ★ {printer.votes ?? 0}
            </span>
            {printer.notes && (
              <span className="col-span-3 text-slate-400 italic text-[10px] leading-snug pt-1 normal-case">
                "{printer.notes}"
              </span>
            )}
            <div className="col-span-3 flex gap-1 mt-1">
              <button
                data-testid="upvote-community-printer-btn"
                onClick={handleUpvote}
                disabled={alreadyVoted || upvoting}
                className={`flex-1 h-6 text-[10px] flex items-center justify-center gap-1 rounded border ${
                  alreadyVoted
                    ? "bg-yellow-500/10 border-yellow-500/40 text-yellow-300"
                    : "bg-slate-800 hover:bg-yellow-500/20 hover:text-yellow-300 text-slate-300 border-slate-700"
                }`}
              >
                <Star size={10} fill={alreadyVoted ? "#FACC15" : "none"} />
                {alreadyVoted ? "Voted" : "Upvote"}
              </button>
              <button
                data-testid="delete-community-printer-btn"
                onClick={handleRemoveCommunity}
                className="h-6 px-2 text-[10px] flex items-center justify-center gap-1 bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded border border-slate-700"
              >
                <Trash2 size={10} />
              </button>
            </div>
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
          data-testid="auto-drop-new-toggle"
          type="checkbox"
          checked={autoDropNew}
          onChange={(e) => setAutoDropNew(e.target.checked)}
          className="accent-orange-500"
        />
        Drop new parts to bed on add
        <span className="text-slate-500 text-[10px]">(beginner-friendly)</span>
      </label>

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

  // Debounced recompute when scene changes (runs in a Web Worker so the UI
  // doesn't stutter on heavy models).
  useEffect(() => {
    if (objects.length === 0) {
      setInfo({ ok: true, edges: 0, tris: 0 });
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      evaluateSceneStatsAsync(objects)
        .then((r) => {
          if (cancelled) return;
          setInfo({ ok: r.manifold, edges: r.boundaryEdges, tris: r.triangleCount });
        })
        .catch(() => {
          if (cancelled) return;
          setInfo({ ok: true, edges: 0, tris: 0 });
        });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
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
        modern slicers (OrcaSlicer, PrusaSlicer, Flash Studio, Bambu Studio) all auto-repair on import.
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
  const flipModifier = useScene((s) => s.flipModifier);
  const dropToBed = useScene((s) => s.dropToBed);
  const setColorIndex = useScene((s) => s.setColorIndex);

  const obj = objects.find((o) => o.id === selectedId);
  if (!obj) {
    return (
      <Section title="Inspector" icon={Sliders} testid="inspector-empty">
        <div className="text-xs text-slate-500 italic">Select an object to edit its properties.</div>
      </Section>
    );
  }

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

      {obj.modifier !== "negative" && (
        <div data-testid="inspector-color-picker">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center justify-between">
            <span>Filament Color</span>
            <span className="text-[9px] normal-case text-slate-500">slot T{obj.colorIndex || 0}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MULTICOLOR_PALETTE.map((c, i) => {
              const active = (obj.colorIndex || 0) === i;
              return (
                <button
                  key={i}
                  data-testid={`color-swatch-${i}`}
                  onClick={() => setColorIndex(obj.id, i)}
                  title={`${c.name} (T${i})`}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    active ? "border-white scale-110 ring-2 ring-orange-500" : "border-slate-700 hover:scale-105"
                  }`}
                  style={{ background: c.hex }}
                />
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center justify-between">
          <span>Transforms</span>
          <span className="text-[9px] normal-case text-slate-500">use top toolbar</span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px] font-mono bg-slate-950/60 border border-slate-800 rounded p-1.5">
          <span className="text-slate-500">Pos</span>
          <span className="col-span-2 text-slate-200 text-right truncate">
            {obj.position[0].toFixed(1)}, {obj.position[1].toFixed(1)}, {obj.position[2].toFixed(1)}
          </span>
          {(() => {
            // Show the bottom-Y of the actual rotated/scaled bbox so the user
            // can see at a glance whether the part is sitting on the bed
            // (bottom=0) or floating. "Pos" is the CENTER which trips up
            // first-time CAD users who think Y means "above the table".
            let bottomY = null;
            try {
              const bb = computeRotatedBBox(obj);
              if (isFinite(bb.min.y)) bottomY = (obj.position?.[1] ?? 0) + bb.min.y;
            } catch (_) { /* ignore */ }
            if (bottomY === null) return null;
            const onBed = Math.abs(bottomY) < 0.05;
            return (
              <>
                <span className="text-slate-500">Bottom Y</span>
                <span
                  data-testid="bottom-y"
                  className={`col-span-2 text-right truncate ${onBed ? "text-green-400" : "text-orange-300"}`}
                  title={onBed ? "Part is sitting on the bed" : "Part is floating or below the bed"}
                >
                  {bottomY.toFixed(2)} mm {onBed ? "✓ on bed" : ""}
                </span>
              </>
            );
          })()}
          <span className="text-slate-500">Rot</span>
          <span className="col-span-2 text-slate-200 text-right truncate">
            {obj.rotation[0].toFixed(0)}°, {obj.rotation[1].toFixed(0)}°, {obj.rotation[2].toFixed(0)}°
          </span>
          <span className="text-slate-500">Scale</span>
          <span className="col-span-2 text-slate-200 text-right truncate">
            {obj.scale[0].toFixed(2)} · {obj.scale[1].toFixed(2)} · {obj.scale[2].toFixed(2)}
          </span>
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
            {/* Display & edit DIAMETER for less ambiguity ("a 3mm bolt needs
                a 3.2mm hole" = diameter, never radius). The store still
                holds radius, so we convert at the boundary. */}
            <NumberField
              testid="dim-d"
              label={`Diameter${typeof obj.dims.r === "number" ? `  (r=${(obj.dims.r).toFixed(1)})` : ""}`}
              value={(obj.dims.r || 0) * 2}
              onChange={(v) => updateDims(obj.id, { r: Math.max(0.05, v / 2) })}
              step={0.5}
              min={0.1}
            />
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
            <NumberField
              testid="dim-d"
              label={`Diameter${typeof obj.dims.r === "number" ? `  (r=${(obj.dims.r).toFixed(1)})` : ""}`}
              value={(obj.dims.r || 0) * 2}
              onChange={(v) => updateDims(obj.id, { r: Math.max(0.05, v / 2) })}
              step={0.5}
            />
            <NumberField testid="dim-tube" label="Tube ⌀" value={(obj.dims.tube || 0) * 2} onChange={(v) => updateDims(obj.id, { tube: Math.max(0.05, v / 2) })} step={0.2} />
          </div>
        </div>
      )}

      {(obj.type === "circle" || obj.type === "square2d" || obj.type === "triangle" || obj.type === "polygon") && (
        <Shape2DControls obj={obj} updateDims={updateDims} />
      )}
    </Section>
  );
}

// ---------- 2D shape controls: dims + slider/number sides + Extrude ----------
function Shape2DControls({ obj, updateDims }) {
  const d = obj.dims || {};
  const is2D = (d.h || 1) <= 1.01; // visually "still a 2D sketch"
  return (
    <div className="space-y-2" data-testid="shape2d-controls">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center justify-between">
          <span>2D Dimensions (mm)</span>
          <span
            className={`text-[9px] normal-case px-1.5 py-0.5 rounded ${is2D ? "bg-purple-500/20 text-purple-300" : "bg-orange-500/20 text-orange-300"}`}
            title={is2D ? "Currently a 2D sketch — set Extrude depth below" : "Already extruded"}
          >
            {is2D ? "2D sketch" : `extruded ${(d.h || 1).toFixed(1)}mm`}
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
            <NumberField testid="dim2d-r" label="Circumradius" value={d.r} onChange={(v) => updateDims(obj.id, { r: v })} step={0.5} min={0.1} />
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
      <ExtrudePresets obj={obj} updateDims={updateDims} />
    </div>
  );
}

function ExtrudePresets({ obj, updateDims }) {
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
    </aside>
  );
}

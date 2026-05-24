import React, { useEffect, useRef, useState } from "react";
import { Move3D, RotateCw, Scale3D, Sliders, X, Lock, Unlock, ArrowDownToLine, Activity, AlertTriangle, Copy, FlipHorizontal, FlipVertical, FlipHorizontal2, CheckCircle2, Download, Eye } from "lucide-react";
import { useScene, useSliceSettings } from "../lib/store";
import { getBaseSize } from "../lib/geometry";
import { sliceToGCODEAsync } from "../lib/workerClient";
import { downloadText } from "../lib/exporters";
import GcodePreviewDialog from "./GcodePreviewDialog";

// ---------- Building blocks ----------
function NumberField({ label, value, onChange, step = 1, suffix, testid, disabled }) {
  // Keep a string draft so the user can transiently type "" / "0" / "0.5"
  // without the field firing onChange on every keystroke (which used to
  // collapse the scale to 0 mid-edit and freeze the lock math). Commit on
  // Enter or blur.
  const [draft, setDraft] = React.useState(null);
  const display = draft !== null ? draft : (Number.isFinite(value) ? String(value) : "");

  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(v)) onChange(v);
  };

  return (
    <label className="flex flex-col gap-1">
      {label !== "" && (
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      )}
      <div className="relative flex items-center">
        <input
          data-testid={testid}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={display}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); e.currentTarget.blur(); }
            if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); }
            if (e.key === "ArrowUp") { e.preventDefault(); onChange((Number.isFinite(value) ? value : 0) + step); }
            if (e.key === "ArrowDown") { e.preventDefault(); onChange((Number.isFinite(value) ? value : 0) - step); }
          }}
          className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 pr-7 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none font-mono disabled:opacity-50"
        />
        {suffix && <span className="absolute right-2 text-[10px] text-slate-500 font-mono">{suffix}</span>}
      </div>
    </label>
  );
}

function PopoverShell({ title, icon: Icon, onClose, anchor, children, testid, width = 280 }) {
  const ref = useRef(null);

  // Only close on Esc or the explicit X. The previous outside-click handler
  // was removed because it interfered with the user switching between
  // scene-tree components while a popover stays open (which is the
  // expected behavior — the popover should refresh its values for the
  // newly selected object).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Position the popover under its anchor — and cap its height so the
  // primary action button never falls off-screen. On short viewports
  // (laptops below ~720px) the Slicer popover in particular has enough
  // fields that the Slice & Export GCODE button used to render below the
  // fold with no scroll, leading to "where did the button go?" reports.
  const [pos, setPos] = useState({ top: 56, left: 16, maxHeight: 600 });
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8)
    );
    const top = rect.bottom + 6;
    // 16px margin from the viewport bottom keeps the popover from sticking
    // to the edge and lets us scroll inside if content is taller than the
    // window allows.
    const maxHeight = Math.max(240, window.innerHeight - top - 16);
    setPos({ top, left, maxHeight });
  }, [anchor, width]);

  return (
    <div
      ref={ref}
      data-testid={testid}
      className="fixed z-[120] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col"
      style={{ top: pos.top, left: pos.left, width, maxHeight: pos.maxHeight }}
    >
      <div className="h-9 px-3 flex items-center justify-between bg-slate-900/80 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={13} className="text-orange-400" />}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">{title}</span>
        </div>
        <button
          data-testid="popover-close-btn"
          onClick={onClose}
          className="h-6 w-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <X size={14} />
        </button>
      </div>
      <div className="p-3 flex flex-col gap-3 overflow-y-auto">{children}</div>
    </div>
  );
}

function EmptyMsg({ children }) {
  return <div className="text-xs text-slate-500 italic py-2">{children}</div>;
}

// ---------- Position ----------
export function PositionPopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const translateSelected = useScene((s) => s.translateSelected);
  const obj = objects.find((o) => o.id === selectedId);
  const multi = selectedIds && selectedIds.length > 1;

  const setPos = (i, v) => {
    if (!obj) return;
    if (multi) {
      // In multi-select mode, the displayed value is the primary's position
      // and editing it shifts the whole assembly by the delta. This keeps
      // group transforms intact while still letting the user type absolute
      // coordinates for the leader.
      const delta = [0, 0, 0]; delta[i] = v - obj.position[i];
      translateSelected(delta);
    } else {
      const p = [...obj.position]; p[i] = v;
      setTransformWithHistory(obj.id, "position", p);
    }
  };
  return (
    <PopoverShell
      title={obj ? `Position — ${obj.name}${multi ? ` +${selectedIds.length - 1}` : ""}` : "Position"}
      icon={Move3D} onClose={onClose} anchor={anchor} testid="position-popover"
    >
      {!obj ? (
        <EmptyMsg>Select an object first.</EmptyMsg>
      ) : (
        <>
          {multi && (
            <div className="text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 leading-snug">
              Moving the whole selection ({selectedIds.length}). Values shown are the leader; edits shift every selected component by the delta.
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <NumberField testid="popover-pos-x" label="X" value={obj.position[0]} onChange={(v) => setPos(0, v)} step={0.5} suffix="mm" />
            <NumberField testid="popover-pos-y" label="Y" value={obj.position[1]} onChange={(v) => setPos(1, v)} step={0.5} suffix="mm" />
            <NumberField testid="popover-pos-z" label="Z" value={obj.position[2]} onChange={(v) => setPos(2, v)} step={0.5} suffix="mm" />
          </div>
        </>
      )}
    </PopoverShell>
  );
}

// ---------- Rotation ----------
export function RotationPopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const rotateSelected = useScene((s) => s.rotateSelected);
  const dropToBed = useScene((s) => s.dropToBed);
  const autoDropOnRotate = useScene((s) => s.autoDropOnRotate);
  const obj = objects.find((o) => o.id === selectedId);
  const multi = selectedIds && selectedIds.length > 1;
  const setRot = (i, v) => {
    if (!obj) return;
    if (multi) {
      const delta = [0, 0, 0]; delta[i] = v - obj.rotation[i];
      rotateSelected(delta);
      if (autoDropOnRotate) setTimeout(() => selectedIds.forEach((id) => dropToBed(id, false)), 0);
    } else {
      const r = [...obj.rotation]; r[i] = v;
      setTransformWithHistory(obj.id, "rotation", r);
      if (autoDropOnRotate) setTimeout(() => dropToBed(obj.id, false), 0);
    }
  };
  return (
    <PopoverShell title={obj ? `Rotation — ${obj.name}${multi ? ` +${selectedIds.length - 1}` : ""}` : "Rotation"} icon={RotateCw} onClose={onClose} anchor={anchor} testid="rotation-popover">
      {!obj ? (
        <EmptyMsg>Select an object first.</EmptyMsg>
      ) : (
        <>
          {multi && (
            <div className="text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 leading-snug">
              Rotating the whole selection ({selectedIds.length}). Edits apply the delta to every selected component.
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <NumberField testid="popover-rot-x" label="X" value={obj.rotation[0]} onChange={(v) => setRot(0, v)} step={5} suffix="°" />
            <NumberField testid="popover-rot-y" label="Y" value={obj.rotation[1]} onChange={(v) => setRot(1, v)} step={5} suffix="°" />
            <NumberField testid="popover-rot-z" label="Z" value={obj.rotation[2]} onChange={(v) => setRot(2, v)} step={5} suffix="°" />
          </div>
          <button
            data-testid="popover-drop-to-bed"
            onClick={() => (multi ? selectedIds.forEach((id) => dropToBed(id)) : dropToBed(obj.id))}
            className="h-8 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-slate-700"
          >
            <ArrowDownToLine size={13} /> Drop {multi ? "all" : ""} to Bed
          </button>
        </>
      )}
    </PopoverShell>
  );
}

// ---------- Scale / Real Size ----------
const SCALE_LOCK_KEY = "forgeslicer.scaleLockAspect";
function readLockPref() {
  // Default OFF — most users want per-axis editing. The lock surprises
  // people by silently updating Y/Z when X changes (and vice versa). They
  // can opt in via the checkbox; the choice is persisted to localStorage.
  // Note: only a "0"/"1" UI pref — no sensitive data — so the generic
  // "insecure localStorage" lint warning doesn't apply.
  try {
    const v = localStorage.getItem(SCALE_LOCK_KEY);
    return v === "1";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("readLockPref failed:", err);
    return false;
  }
}
function writeLockPref(v) {
  try { localStorage.setItem(SCALE_LOCK_KEY, v ? "1" : "0"); }
  catch (err) {
    // eslint-disable-next-line no-console
    console.warn("writeLockPref failed:", err);
  }
}

export function ScalePopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const obj = objects.find((o) => o.id === selectedId);
  const [locked, setLockedState] = useState(readLockPref);
  const setLocked = (v) => { setLockedState(v); writeLockPref(v); };

  const base = obj ? getBaseSize(obj) : { x: 1, y: 1, z: 1 };
  const baseArr = [base.x || 1, base.y || 1, base.z || 1];

  const applyScale = (newScale) => {
    if (!obj) return;
    setTransformWithHistory(obj.id, "scale", newScale);
  };

  const setPercent = (axis, percentValue) => {
    if (!obj) return;
    if (!Number.isFinite(percentValue) || percentValue <= 0) return;
    const newFactor = percentValue / 100;
    if (locked) {
      // Use the base (scale-=-1) size as the anchor so the lock keeps
      // working even if some axis got knocked to 0 by an earlier edit.
      const ns = baseArr.map((_, i) => (i === axis ? newFactor : (obj.scale[i] / (obj.scale[axis] || newFactor)) * newFactor));
      applyScale(ns);
    } else {
      const ns = [...obj.scale]; ns[axis] = newFactor;
      applyScale(ns);
    }
  };

  const setRealSize = (axis, mm) => {
    if (!obj) return;
    if (!Number.isFinite(mm) || mm <= 0) return;
    const base = baseArr[axis];
    if (!base || base <= 0) return;
    const newFactor = mm / base;
    if (locked) {
      const ns = baseArr.map((_, i) => (i === axis ? newFactor : (obj.scale[i] / (obj.scale[axis] || newFactor)) * newFactor));
      applyScale(ns);
    } else {
      const ns = [...obj.scale]; ns[axis] = newFactor;
      applyScale(ns);
    }
  };

  const labels = ["X", "Y", "Z"];
  return (
    <PopoverShell title={obj ? `Scale — ${obj.name}` : "Scale"} icon={Scale3D} onClose={onClose} anchor={anchor} testid="scale-popover" width={340}>
      {!obj ? (
        <EmptyMsg>Select an object first.</EmptyMsg>
      ) : (
        <>
          <label
            className={`flex items-center gap-2 text-[11px] cursor-pointer select-none px-2 py-1.5 rounded border ${
              locked
                ? "bg-orange-500/15 border-orange-500/40 text-orange-200"
                : "bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <input
              data-testid="scale-lock-toggle"
              type="checkbox"
              checked={locked}
              onChange={(e) => setLocked(e.target.checked)}
              className="accent-orange-500"
            />
            {locked
              ? <><Lock size={11} className="text-orange-400" /> Aspect ratio locked — Y/Z auto-update when X changes (and vice versa)</>
              : <><Unlock size={11} className="text-slate-500" /> Free per-axis scaling</>}
          </label>
          <div className="grid grid-cols-[16px_1fr_1fr] gap-2 items-end">
            <div />
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium text-center">Percent</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium text-center">Real Size</div>
            {[0, 1, 2].map((axis) => {
              const factor = obj.scale[axis] || 1;
              const percent = +(factor * 100).toFixed(3);
              const mm = +((baseArr[axis] || 0) * factor).toFixed(3);
              return (
                <React.Fragment key={axis}>
                  <div className="text-[10px] font-semibold text-orange-300 pb-2">{labels[axis]}</div>
                  <NumberField
                    testid={`scale-percent-${labels[axis].toLowerCase()}`}
                    label=""
                    value={percent}
                    onChange={(v) => setPercent(axis, v)}
                    step={10}
                    suffix="%"
                  />
                  <NumberField
                    testid={`scale-mm-${labels[axis].toLowerCase()}`}
                    label=""
                    value={mm}
                    onChange={(v) => setRealSize(axis, v)}
                    step={1}
                    suffix="mm"
                  />
                </React.Fragment>
              );
            })}
          </div>
          <div className="text-[10px] text-slate-500 leading-snug font-mono">
            base size {baseArr[0].toFixed(2)} × {baseArr[1].toFixed(2)} × {baseArr[2].toFixed(2)} mm
          </div>
        </>
      )}
    </PopoverShell>
  );
}

// ---------- Duplicate (multi-select with optional mirror) ----------
export function DuplicatePopover({ anchor, onClose }) {
  const selectedIds = useScene((s) => s.selectedIds);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const duplicateSelected = useScene((s) => s.duplicateSelected);
  const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
  const count = ids.length;
  const names = ids.map((id) => (objects.find((o) => o.id === id) || {}).name).filter(Boolean);

  const run = (mirrorAxis) => {
    duplicateSelected({ mirrorAxis });
    onClose();
  };

  return (
    <PopoverShell title={`Duplicate${count > 1 ? ` (${count})` : ""}`} icon={Copy} onClose={onClose} anchor={anchor} testid="duplicate-popover" width={320}>
      {count === 0 ? (
        <EmptyMsg>
          Select at least one object first. <span className="text-slate-400">Tip:</span> hold
          <kbd className="mx-1 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-200">Ctrl</kbd>
          or
          <kbd className="mx-1 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-200">Shift</kbd>
          and click to add components to your selection.
        </EmptyMsg>
      ) : (
        <>
          <div className="text-[10px] text-slate-400 font-mono bg-slate-950/50 border border-slate-800 rounded p-2 max-h-20 overflow-y-auto" data-testid="duplicate-selection-list">
            {count} selected: <span className="text-orange-300">{names.join(", ")}</span>
          </div>
          <button
            data-testid="duplicate-plain-btn"
            onClick={() => run(null)}
            className="h-9 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center justify-center gap-2 uppercase tracking-wide"
          >
            <Copy size={13} /> Duplicate {count > 1 ? "all" : ""}
          </button>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium pt-1">
            …or duplicate & mirror about
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              data-testid="duplicate-mirror-x-btn"
              onClick={() => run("x")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Mirror across the X axis (left ↔ right)"
            >
              <FlipHorizontal size={13} /> X axis
            </button>
            <button
              data-testid="duplicate-mirror-y-btn"
              onClick={() => run("y")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Mirror across the Y axis (up ↔ down)"
            >
              <FlipVertical size={13} /> Y axis
            </button>
            <button
              data-testid="duplicate-mirror-z-btn"
              onClick={() => run("z")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Mirror across the Z axis (front ↔ back)"
            >
              <FlipHorizontal2 size={13} /> Z axis
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-snug">
            Mirroring flips each copy's geometry on the chosen axis and reflects its position. Booleans, color, and modifier flags are preserved.
          </p>
        </>
      )}
    </PopoverShell>
  );
}

// ---------- Slicer ----------
export function SlicerPopover({ anchor, onClose }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const buildVolume = useScene((s) => s.buildVolume);
  const settings = useSliceSettings();
  const setS = useSliceSettings((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  // Cache the last successful GCODE + filename so the user can re-download
  // without re-slicing — Chrome occasionally drops the initial auto-download
  // silently (especially when triggered from an async chain), and a fresh
  // user-gesture click here bypasses that heuristic. Cleared on every new
  // slice run so stale GCODE never gets re-shipped.
  const [lastDownload, setLastDownload] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleSlice = async () => {
    setError(""); setBusy(true); setStats(null); setLastDownload(null);
    try {
      const { gcode, stats: st } = await sliceToGCODEAsync(objects, {
        ...settings,
        bedX: buildVolume.x,
        bedY: buildVolume.y,
      });
      setStats(st);
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      const filename = `${safe}.gcode`;
      downloadText(gcode, filename, "text/plain");
      setLastDownload({ gcode, filename });
    } catch (e) {
      setError(e.message || String(e));
    } finally { setBusy(false); }
  };

  const handleDownloadAgain = () => {
    if (!lastDownload) return;
    downloadText(lastDownload.gcode, lastDownload.filename, "text/plain");
  };

  return (
    <PopoverShell title="Slicer Settings" icon={Sliders} onClose={onClose} anchor={anchor} testid="slicer-popover" width={340}>
      <div className="grid grid-cols-2 gap-2">
        <NumberField testid="popover-slice-layer-height" label="Layer Height" value={settings.layerHeight} onChange={(v) => setS({ layerHeight: v })} step={0.05} min={0.05} suffix="mm" />
        <NumberField testid="popover-slice-first-layer" label="First Layer" value={settings.firstLayerHeight} onChange={(v) => setS({ firstLayerHeight: v })} step={0.05} min={0.05} suffix="mm" />
        <NumberField testid="popover-slice-nozzle" label="Nozzle" value={settings.nozzleDiameter} onChange={(v) => setS({ nozzleDiameter: v })} step={0.05} min={0.1} suffix="mm" />
        <NumberField testid="popover-slice-filament" label="Filament Ø" value={settings.filamentDiameter} onChange={(v) => setS({ filamentDiameter: v })} step={0.05} suffix="mm" />
        <NumberField testid="popover-slice-print-speed" label="Print Speed" value={settings.printSpeed} onChange={(v) => setS({ printSpeed: v })} step={5} suffix="mm/s" />
        <NumberField testid="popover-slice-travel-speed" label="Travel" value={settings.travelSpeed} onChange={(v) => setS({ travelSpeed: v })} step={5} suffix="mm/s" />
        <NumberField testid="popover-slice-nozzle-temp" label="Hotend" value={settings.nozzleTemp} onChange={(v) => setS({ nozzleTemp: v })} step={5} suffix="°C" />
        <NumberField testid="popover-slice-bed-temp" label="Bed" value={settings.bedTemp} onChange={(v) => setS({ bedTemp: v })} step={5} suffix="°C" />
        <NumberField testid="popover-slice-bottom-layers" label="Bottom Solid" value={settings.bottomLayers} onChange={(v) => setS({ bottomLayers: Math.max(0, Math.round(v)) })} step={1} min={0} suffix="lyrs" />
        <NumberField testid="popover-slice-top-layers" label="Top Solid" value={settings.topLayers} onChange={(v) => setS({ topLayers: Math.max(0, Math.round(v)) })} step={1} min={0} suffix="lyrs" />
      </div>
      {/* Sparse infill (Tier-b) — middle layers between the solid bands.
          0% disables sparse fill entirely (perimeter cage). Spacing
          scales with density: 100% = solid, 25% = 4× extrusion-width
          spacing, etc. */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1" data-testid="popover-slice-infill-percent-wrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Infill</span>
          <div className="flex items-center gap-2 h-9 bg-slate-950 border border-slate-700 rounded px-2 focus-within:border-orange-500">
            <input
              data-testid="popover-slice-infill-percent"
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.infillPercent}
              onChange={(e) => setS({ infillPercent: parseInt(e.target.value, 10) })}
              className="flex-1 accent-orange-500"
            />
            <span className="text-xs font-mono text-orange-300 w-10 text-right">{settings.infillPercent}%</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Pattern</span>
          <select
            data-testid="popover-slice-infill-pattern"
            value={settings.infillPattern}
            onChange={(e) => setS({ infillPattern: e.target.value })}
            className="h-9 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2 focus:border-orange-500 outline-none"
          >
            <option value="rectilinear">Rectilinear ±45°</option>
            <option value="grid">Grid (crosshatch)</option>
            <option value="gyroid">Gyroid (strong)</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField testid="popover-slice-transition-layers" label="Transition" value={settings.transitionLayers} onChange={(v) => setS({ transitionLayers: Math.max(0, Math.round(v)) })} step={1} min={0} suffix="lyrs" />
      </div>
      <div className="text-[10px] text-amber-400/80 flex items-start gap-1 font-medium leading-tight">
        <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
        <span>Top/bottom solid + sparse infill (rectilinear/grid/gyroid) are now generated. For supports, tree supports, multi-material, and adaptive layer height, export 3MF and slice in OrcaSlicer.</span>
      </div>
      <button
        data-testid="popover-slice-btn"
        onClick={handleSlice}
        disabled={busy || objects.length === 0}
        className="w-full h-10 bg-green-500 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-md shadow-md transition-all uppercase tracking-wide text-sm flex items-center justify-center gap-2"
      >
        <Activity size={16} />
        {busy ? "Slicing..." : "Slice & Export GCODE"}
      </button>
      {error && <div className="text-xs text-red-400" data-testid="popover-slice-error">{error}</div>}
      {stats && (
        <div className="bg-slate-950 border border-slate-700 rounded p-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono" data-testid="popover-slice-stats">
          <span className="text-slate-500">Layers</span><span className="text-orange-400 text-right">{stats.layers}</span>
          <span className="text-slate-500">Segments</span><span className="text-orange-400 text-right">{stats.segments}</span>
          <span className="text-slate-500">Filament</span><span className="text-orange-400 text-right">{stats.filamentMM.toFixed(1)} mm</span>
        </div>
      )}
      {lastDownload && (
        <div
          data-testid="popover-slice-download-confirm"
          className="bg-emerald-500/10 border border-emerald-500/40 rounded p-2 flex flex-col gap-2"
        >
          <div className="flex items-start gap-2 text-[11px] text-emerald-200 leading-tight">
            <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5 text-emerald-400" />
            <div>
              Saved as <span className="font-mono text-emerald-300">{lastDownload.filename}</span> to your Downloads folder.
              <div className="text-emerald-200/70 mt-0.5">If your browser blocked the download, click below.</div>
            </div>
          </div>
          <button
            data-testid="popover-slice-redownload-btn"
            onClick={handleDownloadAgain}
            className="h-8 px-3 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/60 text-emerald-200 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 transition-colors"
          >
            <Download size={12} /> Download {lastDownload.filename} again
          </button>
          <button
            data-testid="popover-slice-preview-btn"
            onClick={() => setPreviewOpen(true)}
            className="h-8 px-3 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/60 text-orange-200 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 transition-colors"
          >
            <Eye size={12} /> Preview toolpaths layer-by-layer
          </button>
        </div>
      )}
      <GcodePreviewDialog
        open={previewOpen}
        gcode={lastDownload?.gcode}
        filename={lastDownload?.filename}
        onClose={() => setPreviewOpen(false)}
      />
    </PopoverShell>
  );
}

// ---------- In-place Mirror ----------
// Flips the selected object(s) on the chosen axis WITHOUT making a copy.
// Useful for AI-generated meshes where the geometry came out backwards.
export function MirrorPopover({ anchor, onClose }) {
  const selectedIds = useScene((s) => s.selectedIds);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const mirrorSelectedInPlace = useScene((s) => s.mirrorSelectedInPlace);
  const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
  const count = ids.length;
  const names = ids.map((id) => (objects.find((o) => o.id === id) || {}).name).filter(Boolean);

  const run = (axis) => {
    mirrorSelectedInPlace(axis);
    onClose();
  };

  return (
    <PopoverShell title={`Mirror in-place${count > 1 ? ` (${count})` : ""}`} icon={FlipHorizontal2} onClose={onClose} anchor={anchor} testid="mirror-popover" width={320}>
      {count === 0 ? (
        <EmptyMsg>Select at least one object first.</EmptyMsg>
      ) : (
        <>
          <div className="text-[10px] text-slate-400 font-mono bg-slate-950/50 border border-slate-800 rounded p-2 max-h-20 overflow-y-auto">
            {count} selected: <span className="text-orange-300">{names.join(", ")}</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium pt-1">
            Mirror axis
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              data-testid="mirror-inplace-x-btn"
              onClick={() => run("x")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Flip on X (left ↔ right)"
            >
              <FlipHorizontal size={13} /> X axis
            </button>
            <button
              data-testid="mirror-inplace-y-btn"
              onClick={() => run("y")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Flip on Y (top ↔ bottom)"
            >
              <FlipVertical size={13} /> Y axis
            </button>
            <button
              data-testid="mirror-inplace-z-btn"
              onClick={() => run("z")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Flip on Z (front ↔ back)"
            >
              <FlipHorizontal2 size={13} /> Z axis
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-snug">
            Flips the geometry in place by negating scale on the chosen axis. The part stays where it is — useful for fixing asymmetric AI meshes. Undo with <kbd className="px-1 bg-slate-800 rounded">Ctrl+Z</kbd>.
          </p>
        </>
      )}
    </PopoverShell>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Move3D, RotateCw, Scale3D, Sliders, X, Lock, Unlock, ArrowDownToLine, Activity, AlertTriangle } from "lucide-react";
import { useScene, useSliceSettings } from "../lib/store";
import { getBaseSize } from "../lib/geometry";
import { sliceToGCODEAsync } from "../lib/workerClient";
import { downloadText } from "../lib/exporters";

// ---------- Building blocks ----------
function NumberField({ label, value, onChange, step = 1, min, suffix, testid, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      <div className="relative flex items-center">
        <input
          data-testid={testid}
          type="number"
          step={step}
          min={min}
          disabled={disabled}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value || "0"))}
          className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 pr-7 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none font-mono disabled:opacity-50"
        />
        {suffix && <span className="absolute right-2 text-[10px] text-slate-500 font-mono">{suffix}</span>}
      </div>
    </label>
  );
}

function PopoverShell({ title, icon: Icon, onClose, anchor, children, testid, width = 280 }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onClick = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      // Clicks on the originating toolbar button shouldn't immediately close;
      // anchor element is forwarded so we can ignore it explicitly.
      if (anchor && anchor.contains && anchor.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    // Use a delay so the click that opens us doesn't close us in the same tick.
    const t = setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [onClose, anchor]);

  // Position the popover under its anchor.
  const [pos, setPos] = useState({ top: 56, left: 16 });
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8)
    );
    setPos({ top: rect.bottom + 6, left });
  }, [anchor, width]);

  return (
    <div
      ref={ref}
      data-testid={testid}
      className="fixed z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden"
      style={{ top: pos.top, left: pos.left, width }}
    >
      <div className="h-9 px-3 flex items-center justify-between bg-slate-900/80 border-b border-slate-800">
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
      <div className="p-3 flex flex-col gap-3">{children}</div>
    </div>
  );
}

function EmptyMsg({ children }) {
  return <div className="text-xs text-slate-500 italic py-2">{children}</div>;
}

// ---------- Position ----------
export function PositionPopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const obj = objects.find((o) => o.id === selectedId);
  const setPos = (i, v) => {
    if (!obj) return;
    const p = [...obj.position]; p[i] = v;
    setTransformWithHistory(obj.id, "position", p);
  };
  return (
    <PopoverShell title={obj ? `Position — ${obj.name}` : "Position"} icon={Move3D} onClose={onClose} anchor={anchor} testid="position-popover">
      {!obj ? (
        <EmptyMsg>Select an object first.</EmptyMsg>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <NumberField testid="popover-pos-x" label="X" value={obj.position[0]} onChange={(v) => setPos(0, v)} step={0.5} suffix="mm" />
          <NumberField testid="popover-pos-y" label="Y" value={obj.position[1]} onChange={(v) => setPos(1, v)} step={0.5} suffix="mm" />
          <NumberField testid="popover-pos-z" label="Z" value={obj.position[2]} onChange={(v) => setPos(2, v)} step={0.5} suffix="mm" />
        </div>
      )}
    </PopoverShell>
  );
}

// ---------- Rotation ----------
export function RotationPopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const dropToBed = useScene((s) => s.dropToBed);
  const autoDropOnRotate = useScene((s) => s.autoDropOnRotate);
  const obj = objects.find((o) => o.id === selectedId);
  const setRot = (i, v) => {
    if (!obj) return;
    const r = [...obj.rotation]; r[i] = v;
    setTransformWithHistory(obj.id, "rotation", r);
    if (autoDropOnRotate) setTimeout(() => dropToBed(obj.id, false), 0);
  };
  return (
    <PopoverShell title={obj ? `Rotation — ${obj.name}` : "Rotation"} icon={RotateCw} onClose={onClose} anchor={anchor} testid="rotation-popover">
      {!obj ? (
        <EmptyMsg>Select an object first.</EmptyMsg>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <NumberField testid="popover-rot-x" label="X" value={obj.rotation[0]} onChange={(v) => setRot(0, v)} step={5} suffix="°" />
            <NumberField testid="popover-rot-y" label="Y" value={obj.rotation[1]} onChange={(v) => setRot(1, v)} step={5} suffix="°" />
            <NumberField testid="popover-rot-z" label="Z" value={obj.rotation[2]} onChange={(v) => setRot(2, v)} step={5} suffix="°" />
          </div>
          <button
            data-testid="popover-drop-to-bed"
            onClick={() => dropToBed(obj.id)}
            className="h-8 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-slate-700"
          >
            <ArrowDownToLine size={13} /> Drop to Bed
          </button>
        </>
      )}
    </PopoverShell>
  );
}

// ---------- Scale / Real Size ----------
export function ScalePopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const obj = objects.find((o) => o.id === selectedId);
  const [locked, setLocked] = useState(true);

  const base = obj ? getBaseSize(obj) : { x: 1, y: 1, z: 1 };
  const baseArr = [base.x || 1, base.y || 1, base.z || 1];

  const applyScale = (newScale) => {
    if (!obj) return;
    setTransformWithHistory(obj.id, "scale", newScale);
  };

  const setPercent = (axis, percentValue) => {
    if (!obj) return;
    const newFactor = percentValue / 100;
    if (locked) {
      // Ratio against the previous scale on the same axis.
      const prev = obj.scale[axis] || 1;
      const ratio = newFactor / (prev || 1e-9);
      const ns = obj.scale.map((s) => s * ratio);
      applyScale(ns);
    } else {
      const ns = [...obj.scale]; ns[axis] = newFactor;
      applyScale(ns);
    }
  };

  const setRealSize = (axis, mm) => {
    if (!obj) return;
    const newFactor = mm / (baseArr[axis] || 1e-9);
    if (locked) {
      const prev = obj.scale[axis] || 1;
      const ratio = newFactor / (prev || 1e-9);
      const ns = obj.scale.map((s) => s * ratio);
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
          <label className="flex items-center gap-2 text-[11px] text-slate-200 cursor-pointer select-none px-1 py-1 rounded hover:bg-slate-800">
            <input
              data-testid="scale-lock-toggle"
              type="checkbox"
              checked={locked}
              onChange={(e) => setLocked(e.target.checked)}
              className="accent-orange-500"
            />
            {locked
              ? <><Lock size={11} className="text-orange-400" /> Lock aspect ratio</>
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
                    step={1}
                    min={0.01}
                    suffix="%"
                  />
                  <NumberField
                    testid={`scale-mm-${labels[axis].toLowerCase()}`}
                    label=""
                    value={mm}
                    onChange={(v) => setRealSize(axis, v)}
                    step={0.5}
                    min={0.01}
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

  const handleSlice = async () => {
    setError(""); setBusy(true); setStats(null);
    try {
      const { gcode, stats: st } = await sliceToGCODEAsync(objects, {
        ...settings,
        bedX: buildVolume.x,
        bedY: buildVolume.y,
      });
      setStats(st);
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      downloadText(gcode, `${safe}.gcode`, "text/plain");
    } catch (e) {
      setError(e.message || String(e));
    } finally { setBusy(false); }
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
      </div>
      <div className="text-[10px] text-amber-400/80 flex items-start gap-1 font-medium leading-tight">
        <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
        <span>Preview slicer: perimeter contours only. For production prints use OrcaSlicer with the exported 3MF.</span>
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
    </PopoverShell>
  );
}

import React from "react";
import { useScene } from "../lib/store";
import { getPrinter, getFilament } from "../lib/presets";
import { toDisplayLen, MM_PER_IN } from "../lib/units";

export default function StatusBar() {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const snapEnabled = useScene((s) => s.snapEnabled);
  const snapTranslate = useScene((s) => s.snapTranslate);
  const transformMode = useScene((s) => s.transformMode);
  const buildVolume = useScene((s) => s.buildVolume);
  const printerId = useScene((s) => s.printerId);
  const filamentId = useScene((s) => s.filamentId);
  const historyLen = useScene((s) => s.history.length);
  const measureMode = useScene((s) => s.measureMode);
  const unitSystem = useScene((s) => s.unitSystem);
  const setUnitSystem = useScene((s) => s.setUnitSystem);
  const sel = objects.find((o) => o.id === selectedId);
  const printer = getPrinter(printerId);
  const filament = getFilament(filamentId);

  // Build-volume readout — mm scene math stays untouched; we just
  // re-format on display. Build volume integers in mm convert to 3-dp
  // inches (220 mm = 8.661 in).
  const bvX = unitSystem === "in" ? (buildVolume.x / MM_PER_IN).toFixed(2) : buildVolume.x;
  const bvY = unitSystem === "in" ? (buildVolume.y / MM_PER_IN).toFixed(2) : buildVolume.y;
  const bvZ = unitSystem === "in" ? (buildVolume.z / MM_PER_IN).toFixed(2) : buildVolume.z;
  // SNAP grid — convert the stored mm snap to display unit.
  const snapDisplay = unitSystem === "in"
    ? `${(snapTranslate / MM_PER_IN).toFixed(3)}in`
    : `${snapTranslate}mm`;

  return (
    <div className="h-7 border-t border-slate-800 bg-slate-950 flex items-center px-3 text-[10px] font-mono text-slate-400 gap-4" data-testid="status-bar">
      <span className="text-orange-400">●</span>
      {/* iter-112 — clickable units toggle. Storage is always mm; this
          only flips display + input interpretation in the Inspector
          + viewport readouts. localStorage-persisted via the store. */}
      <button
        type="button"
        data-testid="units-toggle"
        onClick={() => setUnitSystem(unitSystem === "mm" ? "in" : "mm")}
        title={`Click to switch to ${unitSystem === "mm" ? "inches" : "millimetres"}. Storage is always mm — this only changes how dimensions are SHOWN.`}
        className="hover:text-white"
      >
        UNITS: <span className="text-slate-200 font-semibold">{unitSystem}</span>
      </button>
      <span>PRINTER: <span className="text-slate-200">{printer.brand} {printer.name}</span></span>
      <span>BUILD: <span className="text-slate-200" data-testid="status-build-volume">{bvX}×{bvY}×{bvZ}</span></span>
      <span>FILAMENT: <span className="text-slate-200">{filament.name}</span></span>
      <span>MODE: <span className={`uppercase ${measureMode ? "text-green-400" : "text-slate-200"}`}>{measureMode ? "MEASURE" : transformMode}</span></span>
      <span>SNAP: <span className={snapEnabled ? "text-green-400" : "text-slate-500"}>{snapEnabled ? snapDisplay : "off"}</span></span>
      <span>HIST: <span className="text-slate-200">{historyLen}</span></span>
      <div className="flex-1" />
      {sel ? (
        <span data-testid="status-selected">
          SELECTED: <span className="text-orange-400">{sel.name}</span> |
          <span className={sel.modifier === "negative" ? "text-cyan-400" : "text-orange-400"}> {sel.modifier.toUpperCase()}</span> |
          POS [{sel.position.map((p) => toDisplayLen(p, unitSystem).toFixed(unitSystem === "in" ? 3 : 1)).join(", ")}] {unitSystem}
        </span>
      ) : (
        <span>NO SELECTION</span>
      )}
    </div>
  );
}

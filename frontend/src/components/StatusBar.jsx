import React from "react";
import { useScene } from "../lib/store";
import { getPrinter, getFilament } from "../lib/presets";

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
  const sel = objects.find((o) => o.id === selectedId);
  const printer = getPrinter(printerId);
  const filament = getFilament(filamentId);

  return (
    <div className="h-7 border-t border-slate-800 bg-slate-950 flex items-center px-3 text-[10px] font-mono text-slate-400 gap-4" data-testid="status-bar">
      <span className="text-orange-400">●</span>
      <span>UNITS: <span className="text-slate-200">mm</span></span>
      <span>PRINTER: <span className="text-slate-200">{printer.brand} {printer.name}</span></span>
      <span>BUILD: <span className="text-slate-200">{buildVolume.x}×{buildVolume.y}×{buildVolume.z}</span></span>
      <span>FILAMENT: <span className="text-slate-200">{filament.name}</span></span>
      <span>MODE: <span className={`uppercase ${measureMode ? "text-green-400" : "text-slate-200"}`}>{measureMode ? "MEASURE" : transformMode}</span></span>
      <span>SNAP: <span className={snapEnabled ? "text-green-400" : "text-slate-500"}>{snapEnabled ? `${snapTranslate}mm` : "off"}</span></span>
      <span>HIST: <span className="text-slate-200">{historyLen}</span></span>
      <div className="flex-1" />
      {sel ? (
        <span data-testid="status-selected">
          SELECTED: <span className="text-orange-400">{sel.name}</span> |
          <span className={sel.modifier === "negative" ? "text-cyan-400" : "text-orange-400"}> {sel.modifier.toUpperCase()}</span> |
          POS [{sel.position.map((p) => p.toFixed(1)).join(", ")}]
        </span>
      ) : (
        <span>NO SELECTION</span>
      )}
    </div>
  );
}

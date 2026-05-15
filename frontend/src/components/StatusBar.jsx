import React from "react";
import { useScene } from "../lib/store";

export default function StatusBar() {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const snapEnabled = useScene((s) => s.snapEnabled);
  const snapTranslate = useScene((s) => s.snapTranslate);
  const transformMode = useScene((s) => s.transformMode);
  const buildVolume = useScene((s) => s.buildVolume);
  const sel = objects.find((o) => o.id === selectedId);

  return (
    <div className="h-7 border-t border-slate-800 bg-slate-950 flex items-center px-3 text-[10px] font-mono text-slate-400 gap-4" data-testid="status-bar">
      <span className="text-orange-400">●</span>
      <span>UNITS: <span className="text-slate-200">mm</span></span>
      <span>BUILD: <span className="text-slate-200">{buildVolume.x}×{buildVolume.y}×{buildVolume.z}</span></span>
      <span>MODE: <span className="text-slate-200 uppercase">{transformMode}</span></span>
      <span>SNAP: <span className={snapEnabled ? "text-green-400" : "text-slate-500"}>{snapEnabled ? `${snapTranslate}mm` : "off"}</span></span>
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

// OrcaSlicer profile editor — compact inline editor shown when the
// "Orca" engine is selected inside SlicerPopover. Three dropdowns
// (printer / process / filament) + four tunables (perimeter count,
// infill density, supports on/off, ironing on/off) cover the fields
// that meaningfully change first-print outcomes. Everything else flows
// from the chosen process preset so the slice button stays one click
// away.
import React from "react";
import { Cpu, CheckCircle2 } from "lucide-react";
import { PROCESS_PROFILES, FILAMENT_PROFILES, INFILL_PATTERNS, getPrinterGroups, resolveSystemPresets } from "../../lib/orcaProfiles";

export default function OrcaProfileEditor({
  printerId, onPrinterChange,
  processId, onProcessChange,
  filamentId, onFilamentChange,
  walls, onWallsChange,
  infillPct, onInfillPctChange,
  pattern, onPatternChange,
  supports, onSupportsChange,
  ironing, onIroningChange,
}) {
  const printerGroups = getPrinterGroups();
  // When the selected printer has bundled-system-preset metadata,
  // resolve the exact OrcaSlicer JSON name for each of the three
  // selections. The UI surfaces these underneath the dropdowns so
  // users see the same string they'd see inside OrcaSlicer's own
  // preset picker — proves the link between the two apps.
  const resolved = resolveSystemPresets(printerId, processId, filamentId);
  return (
    <div
      data-testid="orca-profile-editor"
      className="space-y-2 bg-purple-500/5 border border-purple-500/30 rounded p-2.5"
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-purple-300 font-semibold">
        <Cpu size={11} /> OrcaSlicer Profile
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-slate-400">Printer</span>
          <select
            data-testid="orca-profile-printer"
            value={printerId}
            onChange={(e) => onPrinterChange(e.target.value)}
            className="h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2 focus:border-purple-500 outline-none"
          >
            {Object.entries(printerGroups).map(([cat, items]) => (
              <optgroup key={cat} label={cat}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* OrcaSlicer-bundled preset hint. Only renders for printers
              we've mapped to a bundled JSON; non-Bambu printers stay
              on the legacy raw-dict path and don't show a hint. */}
          {resolved.printer && (
            <span
              data-testid="orca-resolved-printer"
              className="text-[9px] text-emerald-300/80 font-mono leading-tight pl-0.5 flex items-center gap-1"
              title="This bundled OrcaSlicer system preset is loaded by the server and used for the slice."
            >
              <CheckCircle2 size={9} className="flex-shrink-0 text-emerald-400" />
              <span className="truncate">{resolved.printer.name}</span>
            </span>
          )}
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[9px] uppercase tracking-wider text-slate-400">Print Profile</span>
            <select
              data-testid="orca-profile-process"
              value={processId}
              onChange={(e) => onProcessChange(e.target.value)}
              className="h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2 focus:border-purple-500 outline-none"
            >
              {Object.values(PROCESS_PROFILES).map((p) => (
                <option key={p.id} value={p.id} title={p.description}>{p.label}</option>
              ))}
            </select>
            {resolved.process && (
              <span
                data-testid="orca-resolved-process"
                className="text-[9px] text-emerald-300/80 font-mono leading-tight pl-0.5 flex items-center gap-1 truncate"
                title="Bundled process JSON loaded by the slicer"
              >
                <CheckCircle2 size={9} className="flex-shrink-0 text-emerald-400" />
                <span className="truncate">{resolved.process.name}</span>
              </span>
            )}
          </label>
          <label className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[9px] uppercase tracking-wider text-slate-400">Filament</span>
            <select
              data-testid="orca-profile-filament"
              value={filamentId}
              onChange={(e) => onFilamentChange(e.target.value)}
              className="h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2 focus:border-purple-500 outline-none"
            >
              {Object.values(FILAMENT_PROFILES).map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            {resolved.filament && (
              <span
                data-testid="orca-resolved-filament"
                className="text-[9px] text-emerald-300/80 font-mono leading-tight pl-0.5 flex items-center gap-1 truncate"
                title="Bundled filament JSON loaded by the slicer"
              >
                <CheckCircle2 size={9} className="flex-shrink-0 text-emerald-400" />
                <span className="truncate">{resolved.filament.name}</span>
              </span>
            )}
          </label>
        </div>
      </div>

      {/* Inline tunables — perimeter count + infill % + pattern + the
          two toggles. Each overrides the corresponding key on the
          chosen process preset. */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-[9px] uppercase tracking-wider text-slate-400">Perimeters (walls)</span>
          <div className="flex items-center gap-1.5 h-8 bg-slate-950 border border-slate-700 rounded px-2 focus-within:border-purple-500 min-w-0">
            <input
              data-testid="orca-walls"
              type="range" min={1} max={6} step={1}
              value={walls}
              onChange={(e) => onWallsChange(parseInt(e.target.value, 10))}
              className="flex-1 min-w-0 accent-purple-500"
            />
            <span className="text-xs font-mono text-purple-200 w-4 text-right flex-shrink-0">{walls}</span>
          </div>
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-[9px] uppercase tracking-wider text-slate-400">Infill density</span>
          <div className="flex items-center gap-1.5 h-8 bg-slate-950 border border-slate-700 rounded px-2 focus-within:border-purple-500 min-w-0">
            <input
              data-testid="orca-infill"
              type="range" min={0} max={100} step={5}
              value={infillPct}
              onChange={(e) => onInfillPctChange(parseInt(e.target.value, 10))}
              className="flex-1 min-w-0 accent-purple-500"
            />
            <span className="text-xs font-mono text-purple-200 w-8 text-right flex-shrink-0">{infillPct}%</span>
          </div>
        </label>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-400">Infill pattern</span>
        <select
          data-testid="orca-pattern"
          value={pattern}
          onChange={(e) => onPatternChange(e.target.value)}
          className="h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2 focus:border-purple-500 outline-none"
        >
          {INFILL_PATTERNS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <label className="flex items-center gap-2 h-8 bg-slate-950 border border-slate-700 rounded px-2 cursor-pointer text-xs text-slate-200 select-none">
          <input
            data-testid="orca-supports"
            type="checkbox"
            checked={supports}
            onChange={(e) => onSupportsChange(e.target.checked)}
            className="accent-purple-500"
          />
          Tree supports
        </label>
        <label className="flex items-center gap-2 h-8 bg-slate-950 border border-slate-700 rounded px-2 cursor-pointer text-xs text-slate-200 select-none">
          <input
            data-testid="orca-ironing"
            type="checkbox"
            checked={ironing}
            onChange={(e) => onIroningChange(e.target.checked)}
            className="accent-purple-500"
          />
          Ironing (top)
        </label>
      </div>
      <div className="text-[10px] text-slate-500 leading-snug pt-0.5">
        Other settings inherit from the chosen Print Profile. Slice time scales with perimeters × density.
      </div>
    </div>
  );
}

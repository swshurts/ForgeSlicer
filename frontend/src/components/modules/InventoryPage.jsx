// Inventory module — filament & materials stock (visual scaffold).
import React from "react";
import ModuleShell, { KpiCard } from "./ModuleShell";

const SPOOLS = [
  { name: "PLA", color: "Black", brand: "Polymaker", pct: 18, grams: 180, low: true },
  { name: "PLA", color: "Orange", brand: "Prusament", pct: 64, grams: 640, low: false },
  { name: "PLA", color: "Silk Blue", brand: "eSun", pct: 82, grams: 820, low: false },
  { name: "PETG", color: "White", brand: "Overture", pct: 41, grams: 410, low: false },
  { name: "PETG", color: "Clear", brand: "Prusament", pct: 9, grams: 90, low: true },
  { name: "ABS", color: "Black", brand: "Polymaker", pct: 12, grams: 120, low: true },
  { name: "TPU", color: "Natural", brand: "NinjaTek", pct: 55, grams: 550, low: false },
  { name: "PLA", color: "White", brand: "Bambu", pct: 73, grams: 730, low: false },
];

const SWATCH = {
  Black: "#111418", Orange: "#F0782B", "Silk Blue": "#5B9BD5", White: "#E8ECEF",
  Clear: "#AEC6CF", "Natural": "#D9CBB2",
};

export default function InventoryPage() {
  const lowCount = SPOOLS.filter((s) => s.low).length;
  const totalKg = (SPOOLS.reduce((a, s) => a + s.grams, 0) / 1000).toFixed(1);
  return (
    <ModuleShell title="Inventory" subtitle="Filament & materials">
      <div className="p-4 lg:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Spools tracked" value={String(SPOOLS.length)} />
          <KpiCard label="On hand" value={`${totalKg} kg`} />
          <KpiCard label="Low / reorder" value={String(lowCount)} sub="below 25%" tone="down" />
          <KpiCard label="Materials" value="4" sub="PLA · PETG · ABS · TPU" />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {SPOOLS.map((s, i) => (
            <div key={i} className="rounded-lg border border-slate-800 bg-slate-900 p-3 flex items-center gap-3">
              <span
                className="h-8 w-8 rounded-full border border-slate-600 flex-shrink-0"
                style={{ backgroundColor: SWATCH[s.color] || "#64748B" }}
                title={s.color}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white truncate">
                    {s.name} · {s.color}
                  </div>
                  <span className={`text-[11px] ${s.low ? "text-red-300 font-semibold" : "text-slate-400"}`}>
                    {s.pct}%
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">{s.brand} · {s.grams} g left</div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${s.low ? "bg-red-500" : "bg-emerald-500"}`}
                    style={{ width: `${s.pct}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ModuleShell>
  );
}

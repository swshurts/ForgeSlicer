// Production module — a print-farm operations dashboard. This is a
// visual scaffold (static demo data) illustrating the ERP direction:
// live printer status, a job queue, and an order/stock side rail.
import React from "react";
import { Printer, CircleAlert, CheckCircle2, Clock } from "lucide-react";
import ModuleShell, { KpiCard } from "./ModuleShell";

const PRINTERS = [
  { name: "Bambu X1C · #1", job: "Enclosure bracket ×4", material: "PLA · Matte Black", progress: 72, eta: "0h 48m", state: "printing" },
  { name: "Bambu X1C · #2", job: "Name tags ×12", material: "PETG · White", progress: 33, eta: "1h 42m", state: "printing" },
  { name: "Prusa MK4 · #1", job: "Cable clips ×20", material: "PLA · Orange", progress: 91, eta: "0h 07m", state: "printing" },
  { name: "Prusa MK4 · #2", job: "—", material: "PLA · Gray", progress: 0, eta: "—", state: "idle" },
  { name: "Voron 2.4 · #1", job: "Gearbox housing", material: "ABS · Black", progress: 0, eta: "—", state: "error" },
  { name: "Voron 2.4 · #2", job: "Phone stand ×6", material: "PLA · Silk Blue", progress: 54, eta: "1h 05m", state: "printing" },
];

const QUEUE = [
  { job: "JOB-2043", customer: "Northgate Dental", model: "Aligner case ×8", material: "PETG", est: "3h 10m", status: "printing" },
  { job: "JOB-2044", customer: "Cade R.", model: "RC bumper", material: "ABS", est: "2h 25m", status: "queued" },
  { job: "JOB-2045", customer: "Maker Co-op", model: "Hinge set ×15", material: "PLA", est: "5h 40m", status: "queued" },
  { job: "JOB-2041", customer: "Lumen Studio", model: "Lithophane lamp", material: "PLA", est: "6h 02m", status: "done" },
  { job: "JOB-2042", customer: "Harbor Freight", model: "Knob ×30", material: "PLA", est: "4h 18m", status: "done" },
];

const STOCK = [
  { name: "PLA · Black", pct: 18, low: true },
  { name: "PLA · Orange", pct: 64, low: false },
  { name: "PETG · White", pct: 41, low: false },
  { name: "ABS · Black", pct: 12, low: true },
];

function StateBadge({ state }) {
  const map = {
    printing: { cls: "bg-orange-500/15 text-orange-300 border-orange-500/30", icon: Printer, label: "Printing" },
    idle: { cls: "bg-slate-700/40 text-slate-300 border-slate-600", icon: Clock, label: "Idle" },
    error: { cls: "bg-red-500/15 text-red-300 border-red-500/40", icon: CircleAlert, label: "Error" },
  };
  const s = map[state] || map.idle;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>
      <Icon size={11} /> {s.label}
    </span>
  );
}

function StatusChip({ status }) {
  const map = {
    printing: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    queued: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${map[status] || map.queued}`}>
      {status}
    </span>
  );
}

export default function ProductionPage() {
  return (
    <ModuleShell title="Production" subtitle="Print farm · Main Floor">
      <div className="p-4 lg:p-6 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-5 min-w-0">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Open orders" value="18" sub="+3 today" tone="up" />
            <KpiCard label="Printers running" value="6 / 8" sub="75% utilisation" />
            <KpiCard label="Filament low" value="3 spools" sub="reorder soon" tone="down" />
            <KpiCard label="Revenue · 7d" value="$4,280" sub="+12% vs prev" tone="up" />
          </div>

          {/* Printer farm */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-2">Printer farm</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {PRINTERS.map((p) => (
                <div key={p.name} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-white truncate">{p.name}</div>
                    <StateBadge state={p.state} />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 truncate">{p.job}</div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${p.state === "error" ? "bg-red-500/60" : "bg-orange-500"}`}
                      style={{ width: `${p.progress}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-mono">{p.material}</span>
                    <span>{p.state === "printing" ? `${p.progress}% · ETA ${p.eta}` : p.state === "error" ? "needs attention" : "ready"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Queue */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-2">Job queue</h2>
            <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-950/40">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Job</th>
                    <th className="px-3 py-2 font-semibold">Customer</th>
                    <th className="px-3 py-2 font-semibold">Model</th>
                    <th className="px-3 py-2 font-semibold hidden sm:table-cell">Material</th>
                    <th className="px-3 py-2 font-semibold hidden sm:table-cell">Est. time</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {QUEUE.map((q) => (
                    <tr key={q.job} className="hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-mono text-slate-300">{q.job}</td>
                      <td className="px-3 py-2 text-white">{q.customer}</td>
                      <td className="px-3 py-2 text-slate-300">{q.model}</td>
                      <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">{q.material}</td>
                      <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">{q.est}</td>
                      <td className="px-3 py-2"><StatusChip status={q.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right rail */}
        <aside className="space-y-5">
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Order detail</h2>
              <span className="text-[10px] font-mono text-orange-300">JOB-2043</span>
            </div>
            <div className="mt-2 text-sm font-semibold text-white">Northgate Dental</div>
            <div className="text-[11px] text-slate-400">Due Jul 9 · Priority</div>
            <ul className="mt-3 space-y-2">
              {[
                { n: "Aligner case", q: "×8", p: "$96.00" },
                { n: "Retainer box", q: "×8", p: "$72.00" },
              ].map((it) => (
                <li key={it.n} className="flex items-center gap-2 text-xs">
                  <div className="h-8 w-8 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500">
                    <CheckCircle2 size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-200 truncate">{it.n}</div>
                    <div className="text-[10px] text-slate-500">{it.q}</div>
                  </div>
                  <div className="text-slate-300 font-mono">{it.p}</div>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-sm">
              <span className="text-slate-400">Total</span>
              <span className="font-bold text-white">$168.00</span>
            </div>
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Filament stock</h2>
            <ul className="mt-3 space-y-3">
              {STOCK.map((s) => (
                <li key={s.name}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300">{s.name}</span>
                    <span className={s.low ? "text-red-300 font-semibold" : "text-slate-400"}>
                      {s.pct}%{s.low ? " · low" : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${s.low ? "bg-red-500" : "bg-emerald-500"}`}
                      style={{ width: `${s.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </ModuleShell>
  );
}

// Orders module — customer order pipeline (visual scaffold, static data).
import React from "react";
import ModuleShell, { KpiCard } from "./ModuleShell";

const ORDERS = [
  { id: "ORD-1187", customer: "Northgate Dental", items: 2, total: "$168.00", due: "Jul 9", status: "in production" },
  { id: "ORD-1186", customer: "Lumen Studio", items: 1, total: "$54.00", due: "Jul 7", status: "ready" },
  { id: "ORD-1185", customer: "Cade R.", items: 3, total: "$91.50", due: "Jul 11", status: "quoted" },
  { id: "ORD-1184", customer: "Maker Co-op", items: 5, total: "$240.00", due: "Jul 12", status: "in production" },
  { id: "ORD-1183", customer: "Harbor Freight", items: 30, total: "$420.00", due: "Jul 6", status: "shipped" },
  { id: "ORD-1182", customer: "Ava P.", items: 1, total: "$28.00", due: "Jul 5", status: "shipped" },
];

const STATUS = {
  quoted: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "in production": "bg-orange-500/15 text-orange-300 border-orange-500/30",
  ready: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  shipped: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export default function OrdersPage() {
  return (
    <ModuleShell title="Orders" subtitle="Customer order pipeline">
      <div className="p-4 lg:p-6 space-y-5 max-w-6xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Open orders" value="18" sub="+3 today" tone="up" />
          <KpiCard label="Awaiting quote" value="4" />
          <KpiCard label="Ready to ship" value="2" tone="up" />
          <KpiCard label="Backlog value" value="$1,241" />
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Recent orders</h2>
            <span className="text-[11px] text-slate-500">Demo data</span>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-950/40">
              <tr>
                <th className="px-4 py-2 font-semibold">Order</th>
                <th className="px-4 py-2 font-semibold">Customer</th>
                <th className="px-4 py-2 font-semibold hidden sm:table-cell">Items</th>
                <th className="px-4 py-2 font-semibold">Total</th>
                <th className="px-4 py-2 font-semibold hidden sm:table-cell">Due</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {ORDERS.map((o) => (
                <tr key={o.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-mono text-slate-300">{o.id}</td>
                  <td className="px-4 py-2.5 text-white">{o.customer}</td>
                  <td className="px-4 py-2.5 text-slate-400 hidden sm:table-cell">{o.items}</td>
                  <td className="px-4 py-2.5 text-slate-200 font-mono">{o.total}</td>
                  <td className="px-4 py-2.5 text-slate-400 hidden sm:table-cell">{o.due}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${STATUS[o.status]}`}>
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ModuleShell>
  );
}

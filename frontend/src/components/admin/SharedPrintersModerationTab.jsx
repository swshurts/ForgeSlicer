// Iter-90 — Admin tab for moderating community shared-printer entries.
//
// Two views:
//   - Flagged (default): user_printers with flag_count > 0, sorted by
//     flag_count desc → the actionable triage list
//   - Recent: every published profile, newest first → for proactive
//     spot-checks (also where moderators look for spam dropped by
//     fresh accounts)
//
// Actions per row:
//   - Clear flags  : flag_count → 0, keeps entry published (most common)
//   - Unpublish    : soft-takedown (is_public=false, preserves history)
//   - Delete       : hard-delete (audit-logged; only for abusive)
//
// Every backend action writes an `admin_actions` row so we have a
// forensic trail in case an owner appeals a takedown.

import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import axios from "axios";
import {
  RefreshCw, Loader2, ShieldAlert, Flag, EyeOff, Trash2,
  CheckCheck, Inbox, AlertCircle, Calendar,
} from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const cfg = { withCredentials: true };

function relTime(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function FlagPill({ count }) {
  if (!count) return <span className="text-[10px] text-slate-600">—</span>;
  const intensity = count >= 5 ? "rose" : count >= 2 ? "amber" : "yellow";
  const cls = intensity === "rose"
    ? "bg-rose-500/20 text-rose-200 border-rose-500/40"
    : intensity === "amber"
    ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
    : "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      <Flag size={9} /> {count}
    </span>
  );
}

function PrinterRow({ p, busyId, onClearFlags, onUnpublish, onDelete }) {
  const isBusy = busyId === p.printer_id;
  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-800/30" data-testid={`shared-mod-row-${p.printer_id}`}>
      <td className="py-2 px-2 align-top w-[1%] whitespace-nowrap">
        <FlagPill count={p.flag_count || 0} />
      </td>
      <td className="py-2 px-2 align-top">
        <div className="text-xs font-mono text-slate-200" data-testid={`shared-mod-name-${p.printer_id}`}>{p.name}</div>
        <div className="text-[10px] text-slate-500 font-mono">
          owner: {p.user_id || "—"} · model: {p.printer_model || "custom"} · {p.nozzle_diameter ?? "?"} mm
        </div>
      </td>
      <td className="py-2 px-2 align-top text-[10px] text-slate-400 whitespace-nowrap">
        <Calendar size={9} className="inline -mt-0.5 mr-0.5" />{relTime(p.published_at)}
      </td>
      <td className="py-2 px-2 align-top text-[10px] text-slate-400 whitespace-nowrap tabular-nums">
        ↩ {p.clone_count ?? 0}
      </td>
      <td className="py-2 px-2 align-top text-right w-[1%] whitespace-nowrap">
        <div className="inline-flex items-center gap-1">
          <button
            data-testid={`shared-mod-clear-${p.printer_id}`}
            disabled={isBusy || !p.flag_count}
            onClick={() => onClearFlags(p)}
            className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30 rounded inline-flex items-center gap-1"
            title="Reset flag count to 0 (entry stays published)"
          >
            <CheckCheck size={10} /> Clear
          </button>
          <button
            data-testid={`shared-mod-unpublish-${p.printer_id}`}
            disabled={isBusy}
            onClick={() => onUnpublish(p)}
            className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-30 rounded inline-flex items-center gap-1"
            title="Soft-takedown — hides from public library, preserves data"
          >
            <EyeOff size={10} /> Unpublish
          </button>
          <button
            data-testid={`shared-mod-delete-${p.printer_id}`}
            disabled={isBusy}
            onClick={() => onDelete(p)}
            className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-30 rounded inline-flex items-center gap-1"
            title="Hard-delete (cannot be undone)"
          >
            {isBusy ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function SharedPrintersModerationTab() {
  const [view, setView] = useState("flagged"); // "flagged" | "recent"
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async (which) => {
    setLoading(true);
    try {
      const url = which === "flagged"
        ? `${API}/admin/shared-printers/flagged`
        : `${API}/admin/shared-printers/recent`;
      const { data } = await axios.get(url, cfg);
      setRows(data || []);
    } catch (err) {
      toast.error(`Couldn't load: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(view); }, [view, refresh]);

  const handleClearFlags = async (p) => {
    setBusyId(p.printer_id);
    try {
      const { data } = await axios.post(`${API}/admin/shared-printers/${encodeURIComponent(p.printer_id)}/clear-flags`, null, cfg);
      toast.success(`Cleared ${data.prior_flag_count} flag${data.prior_flag_count === 1 ? "" : "s"} on "${p.name}".`);
      await refresh(view);
    } catch (err) {
      toast.error(`Couldn't clear flags: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleUnpublish = async (p) => {
    if (!window.confirm(`Soft-unpublish "${p.name}"? It will be hidden from the public library but the data stays in the database so the owner can re-publish.`)) return;
    setBusyId(p.printer_id);
    try {
      await axios.post(`${API}/admin/shared-printers/${encodeURIComponent(p.printer_id)}/unpublish`, null, cfg);
      toast.success(`"${p.name}" unpublished.`);
      await refresh(view);
    } catch (err) {
      toast.error(`Couldn't unpublish: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (p) => {
    if (!window.confirm(`Permanently DELETE "${p.name}"? This cannot be undone. (The action is audit-logged with a snapshot of the row.)`)) return;
    setBusyId(p.printer_id);
    try {
      await axios.delete(`${API}/admin/shared-printers/${encodeURIComponent(p.printer_id)}`, cfg);
      toast.success(`"${p.name}" deleted.`);
      await refresh(view);
    } catch (err) {
      toast.error(`Couldn't delete: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid="admin-shared-printers-tab" className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold tracking-wider uppercase text-white flex items-center gap-2">
            <ShieldAlert size={14} className="text-orange-300" /> Shared printer moderation
          </h2>
          <p className="text-[11px] text-slate-400 max-w-2xl">
            Triage user-flagged community profiles or spot-check recently published ones.
            "Clear" wipes the flag counter; "Unpublish" hides the row but keeps data; "Delete" removes it permanently (audit-logged).
          </p>
        </div>
        <button
          data-testid="shared-mod-refresh"
          onClick={() => refresh(view)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-slate-300 hover:text-white border border-slate-700 hover:border-slate-500 disabled:opacity-50 rounded"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {[
          { key: "flagged", label: "Flagged", icon: Flag, accent: "border-orange-400 text-orange-200" },
          { key: "recent", label: "Recent",   icon: Inbox, accent: "border-cyan-400 text-cyan-200" },
        ].map(({ key, label, icon: I, accent }) => (
          <button
            key={key}
            data-testid={`shared-mod-tab-${key}`}
            onClick={() => setView(key)}
            className={`h-8 px-3 text-[10px] uppercase tracking-wider font-semibold border-b-2 -mb-px inline-flex items-center gap-1.5 ${
              view === key ? accent : "border-transparent text-slate-500 hover:text-white"
            }`}
          >
            <I size={11} /> {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10 text-slate-500 text-xs gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded px-4 py-10 text-center text-xs text-slate-500 space-y-1" data-testid="shared-mod-empty">
          <div className="flex items-center justify-center gap-2 text-slate-400">
            {view === "flagged"
              ? <><CheckCheck size={14} /> Nothing flagged — moderation queue is empty.</>
              : <><Inbox size={14} /> No published shared printers yet.</>}
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded">
          <table className="w-full text-xs">
            <thead className="text-[9px] uppercase tracking-wider text-slate-500 bg-slate-950/50">
              <tr>
                <th className="px-2 py-1.5 text-left">Flags</th>
                <th className="px-2 py-1.5 text-left">Printer</th>
                <th className="px-2 py-1.5 text-left">Published</th>
                <th className="px-2 py-1.5 text-left">Clones</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <PrinterRow
                  key={p.printer_id}
                  p={p}
                  busyId={busyId}
                  onClearFlags={handleClearFlags}
                  onUnpublish={handleUnpublish}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

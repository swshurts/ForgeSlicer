import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { adminApi } from "../lib/adminApi";
import { toast } from "sonner";
import {
  ArrowLeft, Hexagon, Loader2, RefreshCw, Search, Shield, ShieldCheck,
  Sparkles, Award, Ban, KeyRound, Trash2, ListChecks, BarChart3, Users,
  AlertCircle, CheckCircle2, Clock, Download, GitBranch, Activity,
} from "lucide-react";
import OrcaUpstreamTab from "./admin/OrcaUpstreamTab";
import SharedPrintersModerationTab from "./admin/SharedPrintersModerationTab";
import PricingTab from "./admin/PricingTab";

// Convert a 2D array of strings into a CSV blob and trigger a download.
// Cells are wrapped in double-quotes when they contain commas/quotes/newlines
// (RFC-4180 compliant) so the file opens cleanly in Excel / Sheets / Numbers.
function downloadCsv(filename, headers, rows) {
  const escape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  // Prepend BOM so Excel auto-detects UTF-8 instead of mangling non-ASCII names.
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function StatCard({ label, value, hint, testid }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function AnalyticsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true); setErr("");
    try { setData(await adminApi.analytics()); }
    catch (e) { setErr(e?.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="py-12 flex justify-center"><Loader2 size={24} className="animate-spin text-orange-400" /></div>;
  if (err) return <div className="text-red-400 text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div data-testid="admin-analytics-tab">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Platform overview</h2>
        <button
          data-testid="analytics-refresh"
          onClick={load}
          className="h-8 px-3 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded flex items-center gap-1.5 border border-slate-700"
        ><RefreshCw size={12} /> Refresh</button>
      </div>
      <div className="text-[11px] text-slate-500 mb-4">Generated {new Date(data.generated_at).toLocaleString()}</div>

      <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Users</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard testid="stat-users-total" label="Total users" value={data.users.total} />
        <StatCard testid="stat-users-dau" label="DAU" value={data.users.dau} hint="signed in last 24h" />
        <StatCard testid="stat-users-mau" label="MAU" value={data.users.mau} hint="signed in last 30d" />
        <StatCard testid="stat-users-contrib" label="Contributors" value={data.users.contributors} hint="lifetime badge" />
        <StatCard testid="stat-users-new24" label="New 24h" value={data.users.new_24h} />
        <StatCard testid="stat-users-new7" label="New 7d" value={data.users.new_7d} />
        <StatCard testid="stat-users-new30" label="New 30d" value={data.users.new_30d} />
      </div>

      <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Content</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard testid="stat-designs-total" label="Designs (all)" value={data.content.designs_total} />
        <StatCard testid="stat-designs-public" label="Designs (public)" value={data.content.designs_public} />
        <StatCard testid="stat-components-total" label="Components (all)" value={data.content.components_total} />
        <StatCard testid="stat-components-public" label="Components (public)" value={data.content.components_public} />
      </div>

      <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">AI usage</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard testid="stat-ai-month" label={`Gens ${data.ai.month_key}`} value={data.ai.generations_this_month} hint="this calendar month" />
      </div>
    </div>
  );
}

// ---------- Inline quota editor ----------
function QuotaCell({ user, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user.ai_quota_override ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmed = String(value).trim();
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    if (parsed !== null && (isNaN(parsed) || parsed < 1 || parsed > 300)) {
      toast.error("Quota must be blank (clear) or 1–300.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.setAiQuota(user.user_id, parsed);
      toast.success(parsed === null ? "Override cleared." : `Quota set to ${parsed}.`);
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <button
        data-testid={`quota-cell-${user.user_id}`}
        onClick={() => { setValue(user.ai_quota_override ?? ""); setEditing(true); }}
        className="text-xs text-orange-300 hover:text-orange-200 underline-offset-2 hover:underline font-mono"
        title="Click to edit"
      >
        {user.ai_quota_override !== null && user.ai_quota_override !== undefined
          ? `→ ${user.ai_quota_override}`
          : "default"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1" data-testid={`quota-edit-${user.user_id}`}>
      <input
        data-testid={`quota-input-${user.user_id}`}
        type="number"
        min={1}
        max={300}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="blank=default"
        className="h-7 w-20 px-1.5 text-xs bg-slate-950 border border-slate-700 rounded text-white focus:border-orange-500 outline-none"
        autoFocus
      />
      <button data-testid={`quota-save-${user.user_id}`} onClick={save} disabled={busy} className="h-7 px-2 text-[10px] bg-orange-500 hover:bg-orange-600 rounded text-white font-semibold disabled:opacity-50">
        {busy ? <Loader2 size={10} className="animate-spin" /> : "save"}
      </button>
      <button onClick={() => setEditing(false)} className="h-7 px-2 text-[10px] text-slate-400 hover:text-white">cancel</button>
    </div>
  );
}

function UsersTab({ adminInfo }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const load = async (overrideQ) => {
    setLoading(true); setErr("");
    try {
      setUsers(await adminApi.listUsers({ q: overrideQ !== undefined ? overrideQ : q }));
    } catch (e) { setErr(e?.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(""); /* initial load */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSearch = (e) => { e.preventDefault(); load(); };

  const toggleContributor = async (u) => {
    if (!confirm(`${u.contributor_lifetime ? "Revoke" : "Grant"} Contributor-for-Life for ${u.email}?`)) return;
    try { await adminApi.setContributor(u.user_id, !u.contributor_lifetime); toast.success("Updated."); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || e.message); }
  };

  const toggleBan = async (u) => {
    const verb = u.banned ? "Unban" : "Ban";
    if (!confirm(`${verb} ${u.email}? ${u.banned ? "" : "All their active sessions will be killed."}`)) return;
    let reason = "";
    if (!u.banned) {
      reason = prompt("Reason (optional, max 500 chars):") || "";
    }
    try { await adminApi.setBan(u.user_id, !u.banned, reason); toast.success(`${verb}ned.`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || e.message); }
  };

  const togglePromote = async (u) => {
    if (!adminInfo.is_super_admin) return;
    const verb = u.is_admin ? "Demote" : "Promote";
    if (!confirm(`${verb} ${u.email} ${u.is_admin ? "from" : "to"} admin?`)) return;
    try { await adminApi.promoteAdmin(u.user_id, !u.is_admin); toast.success(`${verb}d.`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || e.message); }
  };

  const forceReset = async (u) => {
    if (!confirm(`Sign ${u.email} out of all sessions? They'll need to log back in.`)) return;
    try {
      const r = await adminApi.forcePasswordReset(u.user_id);
      toast.success(`Killed ${r.sessions_killed} session(s).`);
    } catch (e) { toast.error(e?.response?.data?.detail || e.message); }
  };

  // Export the CURRENTLY-LOADED user set to CSV. We export what's visible
  // (post-filter), not the entire DB, so admins can grab targeted slices
  // by searching first then exporting.
  const exportCsv = () => {
    if (users.length === 0) {
      toast.error("No users to export.");
      return;
    }
    const headers = [
      "user_id", "name", "email", "auth_methods",
      "created_at", "last_login_at",
      "is_admin", "is_super_admin", "contributor_lifetime", "banned",
      "ai_quota_override", "ai_used_this_month",
    ];
    const rows = users.map((u) => [
      u.user_id, u.name || "", u.email || "", (u.auth_methods || []).join("|"),
      u.created_at || "", u.last_login_at || "",
      u.is_admin, u.is_super_admin, u.contributor_lifetime, u.banned,
      u.ai_quota_override === null || u.ai_quota_override === undefined ? "" : u.ai_quota_override,
      u.ai_used_this_month,
    ]);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const suffix = q ? `_search-${q.replace(/[^a-z0-9]/gi, "")}` : "";
    downloadCsv(`forgeslicer_users_${stamp}${suffix}.csv`, headers, rows);
    toast.success(`Exported ${users.length} user(s).`);
  };

  return (
    <div data-testid="admin-users-tab">
      <form onSubmit={onSearch} className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input
            data-testid="user-search-input"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, or user_id…"
            className="w-full h-9 pl-8 pr-3 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-orange-500 outline-none"
          />
        </div>
        <button data-testid="user-search-submit" type="submit" className="h-9 px-3 bg-orange-500 hover:bg-orange-600 text-xs text-white font-semibold rounded">Search</button>
        <button type="button" data-testid="user-search-clear" onClick={() => { setQ(""); load(""); }} className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded border border-slate-700">Clear</button>
        <button
          type="button"
          data-testid="users-export-csv"
          onClick={exportCsv}
          disabled={loading || users.length === 0}
          title="Download current results as CSV"
          className="h-9 px-3 bg-slate-800 hover:bg-emerald-700 text-xs text-emerald-300 hover:text-white rounded border border-slate-700 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={12} /> Export CSV
        </button>
      </form>

      {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 size={24} className="animate-spin text-orange-400" /></div>
      ) : (
        <div className="overflow-x-auto border border-slate-800 rounded">
          <table className="w-full text-xs" data-testid="users-table">
            <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">User</th>
                <th className="px-3 py-2 text-left">Methods</th>
                <th className="px-3 py-2 text-left">Joined</th>
                <th className="px-3 py-2 text-left">Last login</th>
                <th className="px-3 py-2 text-left">AI quota</th>
                <th className="px-3 py-2 text-left">AI used</th>
                <th className="px-3 py-2 text-left">Flags</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className={`border-t border-slate-800 ${u.banned ? "bg-red-900/10" : ""}`} data-testid={`user-row-${u.user_id}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-white">{u.name || "(no name)"}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{u.email}</div>
                  </td>
                  <td className="px-3 py-2"><span className="text-[10px] font-mono text-slate-400">{(u.auth_methods || []).join(", ") || "—"}</span></td>
                  <td className="px-3 py-2 text-[10px] text-slate-400">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2 text-[10px] text-slate-400">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2"><QuotaCell user={u} onSaved={load} /></td>
                  <td className="px-3 py-2 text-[10px] text-slate-400 font-mono">{u.ai_used_this_month}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {u.is_super_admin && <span className="px-1.5 py-0.5 bg-fuchsia-500/20 text-fuchsia-300 rounded text-[9px] font-semibold">SUPER</span>}
                      {u.is_admin && !u.is_super_admin && <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-300 rounded text-[9px] font-semibold">ADMIN</span>}
                      {u.contributor_lifetime && <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[9px] font-semibold">CONTRIB</span>}
                      {u.banned && <span className="px-1.5 py-0.5 bg-red-500/20 text-red-300 rounded text-[9px] font-semibold">BANNED</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      <button title="Toggle Contributor-for-Life" data-testid={`btn-contrib-${u.user_id}`} onClick={() => toggleContributor(u)} className="h-6 w-6 bg-slate-800 hover:bg-emerald-700 text-emerald-300 rounded flex items-center justify-center"><Award size={12} /></button>
                      {adminInfo.is_super_admin && !u.is_super_admin && (
                        <button title={u.is_admin ? "Demote admin" : "Promote to admin"} data-testid={`btn-promote-${u.user_id}`} onClick={() => togglePromote(u)} className="h-6 w-6 bg-slate-800 hover:bg-fuchsia-700 text-fuchsia-300 rounded flex items-center justify-center"><ShieldCheck size={12} /></button>
                      )}
                      <button title="Force sign out (kill all sessions)" data-testid={`btn-reset-${u.user_id}`} onClick={() => forceReset(u)} className="h-6 w-6 bg-slate-800 hover:bg-amber-700 text-amber-300 rounded flex items-center justify-center"><KeyRound size={12} /></button>
                      {!u.is_super_admin && (
                        <button title={u.banned ? "Unban user" : "Ban user"} data-testid={`btn-ban-${u.user_id}`} onClick={() => toggleBan(u)} className={`h-6 w-6 rounded flex items-center justify-center ${u.banned ? "bg-emerald-700/30 text-emerald-300 hover:bg-emerald-600/40" : "bg-slate-800 hover:bg-red-700 text-red-300"}`}><Ban size={12} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500 text-xs">No users matched.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setRows(await adminApi.audit(200)); }
    catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="py-12 flex justify-center"><Loader2 size={24} className="animate-spin text-orange-400" /></div>;

  return (
    <div data-testid="admin-audit-tab">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Recent admin actions</h2>
        <button data-testid="audit-refresh" onClick={load} className="h-8 px-3 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded flex items-center gap-1.5 border border-slate-700"><RefreshCw size={12} /> Refresh</button>
      </div>
      <div className="overflow-x-auto border border-slate-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Target</th>
              <th className="px-3 py-2 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800" data-testid={`audit-row-${r.id}`}>
                <td className="px-3 py-2 text-[10px] text-slate-400 font-mono whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-[11px] text-slate-300">{r.actor_email}</td>
                <td className="px-3 py-2"><span className="px-1.5 py-0.5 bg-slate-800 text-orange-300 rounded text-[10px] font-mono">{r.action}</span></td>
                <td className="px-3 py-2 text-[10px] text-slate-400 font-mono">{r.target_user_id || "—"}</td>
                <td className="px-3 py-2 text-[10px] text-slate-400 font-mono break-all">{JSON.stringify(r.details || {})}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No audit entries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const [adminInfo, setAdminInfo] = useState(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState("analytics");

  useEffect(() => {
    if (loading) return;
    if (!user) { setChecking(false); return; }
    (async () => {
      try {
        const info = await adminApi.me();
        setAdminInfo(info);
      } catch {
        setAdminInfo(null);
      } finally {
        setChecking(false);
      }
    })();
  }, [user, loading]);

  // Resolve the gate states. If unauth or non-admin, send to homepage —
  // we deliberately don't render any hint that /admin exists.
  if (loading || checking) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-orange-400" /></div>;
  }
  if (!user || !adminInfo) {
    return <Navigate to="/" replace />;
  }

  const TABS = [
    { key: "analytics", label: "Analytics", icon: BarChart3 },
    { key: "users",     label: "Users",     icon: Users },
    { key: "orca-upstream", label: "Orca sync", icon: GitBranch },
    { key: "shared-moderation", label: "Moderation", icon: Shield },
    // Pricing edits are super-admin only — hide the tab entirely for
    // regular admins (backend re-checks on every call regardless).
    ...(adminInfo.is_super_admin ? [{ key: "pricing", label: "Pricing", icon: Sparkles }] : []),
    { key: "audit",     label: "Audit log", icon: ListChecks },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white" data-testid="admin-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/" className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Home</span>
        </Link>
        <div className="flex-1" />
        <div className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-fuchsia-500 to-orange-600 flex items-center justify-center">
            <Shield size={16} className="text-white" strokeWidth={2.4} />
          </div>
          <span className="text-sm font-bold tracking-tight">ForgeSlicer Admin</span>
          {adminInfo.is_super_admin && (
            <span className="px-1.5 py-0.5 bg-fuchsia-500/20 text-fuchsia-300 rounded text-[9px] font-semibold tracking-wider" data-testid="admin-super-badge">SUPER</span>
          )}
          <Link
            to="/admin/health"
            data-testid="admin-health-link"
            className="ml-3 h-8 px-3 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 rounded text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 flex items-center gap-1.5"
          >
            <Activity size={12} /> Health
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-1 border-b border-slate-800 mb-6">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              data-testid={`admin-tab-${key}`}
              onClick={() => setTab(key)}
              className={`h-10 px-4 text-xs font-semibold flex items-center gap-1.5 border-b-2 -mb-px ${
                tab === key
                  ? "border-orange-500 text-orange-300"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === "analytics" && <AnalyticsTab />}
        {tab === "users" && <UsersTab adminInfo={adminInfo} />}
        {tab === "orca-upstream" && <OrcaUpstreamTab />}
        {tab === "shared-moderation" && <SharedPrintersModerationTab />}
        {tab === "pricing" && adminInfo.is_super_admin && <PricingTab />}
        {tab === "audit" && <AuditTab />}
      </main>
    </div>
  );
}

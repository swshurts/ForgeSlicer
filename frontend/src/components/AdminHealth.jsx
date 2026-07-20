/**
 * AdminHealth — dashboard at /admin/health.
 *
 * Iter-148. Surfaces the two admin backend endpoints:
 *   - GET /api/admin/gallery-stats     — totals, missing thumbnails,
 *     oversized STLs, orphaned owners (per collection).
 *   - GET /api/admin/ai-errors         — recent AI generation failures
 *     with 24 h + 7 d failure-rate trend.
 *
 * Also fires the thumbnail-regeneration background job and polls its
 * status endpoint so admins can watch progress live.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, RefreshCw, Loader2, Image as ImageIcon, AlertTriangle,
  Database, ShieldAlert, CheckCircle2, Play, Shield,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { adminApi } from "../lib/adminApi";

function StatCard({ label, value, hint, tone = "default", testid }) {
  const toneClass =
    tone === "warn"    ? "border-amber-500/30 bg-amber-500/5" :
    tone === "danger"  ? "border-red-500/30 bg-red-500/5" :
    tone === "success" ? "border-emerald-500/30 bg-emerald-500/5" :
                         "border-slate-800 bg-slate-900";
  const valueClass =
    tone === "warn"    ? "text-amber-300" :
    tone === "danger"  ? "text-red-300" :
    tone === "success" ? "text-emerald-300" :
                         "text-white";
  return (
    <div className={`border rounded p-3 ${toneClass}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</div>
      <div className={`text-xl font-bold mt-1 ${valueClass}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function CollectionCard({ title, data, testid }) {
  const missingTone = data.missing_thumbnail > 0 ? "warn" : "success";
  const orphanTone  = data.orphaned_no_owner > 0 ? "warn" : "default";
  const oversizedTone = data.oversized_stl > 0 ? "warn" : "default";
  const noStlTone   = data.missing_stl > 0 ? "danger" : "success";
  return (
    <div className="border border-slate-800 rounded-lg p-4 bg-slate-900/40" data-testid={testid}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-200">
          <Database size={14} className="text-orange-400" /> {title}
        </h3>
        <div className="text-[10px] text-slate-500 font-mono">{data.total} total</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {typeof data.public === "number" && (
          <StatCard testid={`${testid}-public`}   label="Public"   value={data.public} />
        )}
        {typeof data.private === "number" && (
          <StatCard testid={`${testid}-private`}  label="Private"  value={data.private} />
        )}
        <StatCard testid={`${testid}-featured`}    label="Featured" value={data.featured} />
        <StatCard testid={`${testid}-missing-thumb`} tone={missingTone}
          label="Missing thumbnail" value={data.missing_thumbnail}
          hint={data.missing_thumbnail === 0 ? "all rendered" : "click Regenerate above"} />
        <StatCard testid={`${testid}-missing-stl`} tone={noStlTone}
          label="Missing STL" value={data.missing_stl}
          hint={data.missing_stl === 0 ? "healthy" : "broken rows — investigate"} />
        <StatCard testid={`${testid}-oversized`}  tone={oversizedTone}
          label="Oversized STL" value={data.oversized_stl} hint="> 20 MB raw" />
        <StatCard testid={`${testid}-orphaned`}   tone={orphanTone}
          label="Orphaned owner" value={data.orphaned_no_owner}
          hint="user account gone" />
      </div>
      {data.by_category && Object.keys(data.by_category).length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">By category</div>
          <div className="flex flex-wrap gap-1.5" data-testid={`${testid}-categories`}>
            {Object.entries(data.by_category)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, n]) => (
                <span
                  key={cat}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 border border-slate-700 text-slate-300"
                  data-testid={`${testid}-cat-${cat.replace(/[^a-z0-9]/gi, "-")}`}
                >
                  {cat} <span className="text-slate-500 font-mono">{n}</span>
                </span>
              ))}
          </div>
        </div>
      )}
      {(data.oldest || data.newest) && (
        <div className="mt-3 text-[10px] text-slate-500 flex justify-between gap-3">
          <span>Oldest: {data.oldest ? new Date(data.oldest).toLocaleDateString() : "—"}</span>
          <span>Newest: {data.newest ? new Date(data.newest).toLocaleDateString() : "—"}</span>
        </div>
      )}
    </div>
  );
}

function ThumbnailRegenSection({ stats, onDone }) {
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await adminApi.regenerateThumbnailsStatus();
      setJob(s);
      return s;
    } catch (e) {
      // Silently ignore poll errors — the button remains usable.
      return null;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus();
      if (s && s.status !== "running") {
        clearInterval(pollRef.current);
        pollRef.current = null;
        if (s.status === "done") {
          toast.success(`Regenerated ${s.regenerated} thumbnail${s.regenerated === 1 ? "" : "s"}${s.errors?.length ? ` · ${s.errors.length} error${s.errors.length === 1 ? "" : "s"}` : ""}`);
          onDone?.();
        } else if (s.status === "error") {
          toast.error("Regeneration crashed", { description: s.last_error });
        }
      }
    }, 1500);
  }, [fetchStatus, onDone]);

  const start = async () => {
    setStarting(true);
    try {
      const res = await adminApi.regenerateThumbnails();
      setJob(res);
      if (res.started) {
        toast.info("Thumbnail regeneration started");
        startPolling();
      } else {
        toast.warning(res.reason || "Already running");
        startPolling();
      }
    } catch (e) {
      toast.error("Failed to start regeneration", { description: e?.response?.data?.detail || e.message });
    } finally {
      setStarting(false);
    }
  };

  const running = job?.status === "running";
  const total = job?.total || 0;
  const processed = job?.processed || 0;
  const pct = total > 0 ? Math.min(100, Math.round(100 * processed / total)) : 0;
  const missing = (stats?.gallery?.missing_thumbnail || 0) + (stats?.components?.missing_thumbnail || 0);

  return (
    <div className="border border-slate-800 rounded-lg p-4 bg-slate-900/40" data-testid="admin-health-regen-section">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-200">
            <ImageIcon size={14} className="text-orange-400" /> Thumbnail regeneration
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Renders PNG previews for every gallery item + component that&apos;s missing one.
            Runs as a background job — you can leave the page and come back.
          </p>
        </div>
        <button
          data-testid="admin-health-regen-btn"
          onClick={start}
          disabled={starting || running}
          className="shrink-0 h-9 px-3 text-xs font-semibold rounded bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-wait text-slate-950 flex items-center gap-1.5"
        >
          {starting || running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {running ? "Running…" : starting ? "Starting…" : `Regenerate ${missing || ""} missing`}
        </button>
      </div>

      {job && job.status !== "idle" && (
        <div className="space-y-2" data-testid="admin-health-regen-progress">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              Status: <span className={
                job.status === "running" ? "text-orange-300" :
                job.status === "done"    ? "text-emerald-300" :
                job.status === "error"   ? "text-red-300"    : "text-slate-300"
              } data-testid="admin-health-regen-status">{job.status}</span>
            </span>
            <span className="font-mono" data-testid="admin-health-regen-counts">
              {processed} / {total} processed · {job.regenerated} regenerated{job.skipped_no_stl ? ` · ${job.skipped_no_stl} skipped` : ""}
            </span>
          </div>
          <div className="h-2 bg-slate-800 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${job.status === "error" ? "bg-red-500" : job.status === "done" ? "bg-emerald-500" : "bg-orange-500"}`}
              style={{ width: `${pct}%` }}
              data-testid="admin-health-regen-bar"
            />
          </div>
          {job.errors?.length > 0 && (
            <details className="mt-2" data-testid="admin-health-regen-errors">
              <summary className="text-[11px] text-red-300 cursor-pointer hover:text-red-200">
                <AlertTriangle size={11} className="inline mr-1" />
                {job.errors.length} render error{job.errors.length === 1 ? "" : "s"} — click to expand
              </summary>
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {job.errors.slice(0, 20).map((err, i) => (
                  <div key={i} className="text-[10px] font-mono text-slate-400 bg-slate-950/50 p-1.5 rounded border border-slate-800">
                    <span className="text-red-400">{err.kind}</span>/<span className="text-slate-300">{err.id}</span>: {err.reason}
                  </div>
                ))}
                {job.errors.length > 20 && (
                  <div className="text-[10px] text-slate-500 italic">… and {job.errors.length - 20} more</div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function AIErrorsSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminApi.aiErrors(50)); }
    catch { /* silent — non-critical panel */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="border border-slate-800 rounded-lg p-4 bg-slate-900/40" data-testid="admin-health-ai-errors">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-200">
          <ShieldAlert size={14} className="text-red-400" /> AI generation failures
        </h3>
        <button
          data-testid="admin-health-ai-refresh"
          onClick={load}
          disabled={loading}
          className="h-7 px-2 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Refresh
        </button>
      </div>
      {loading && !data && (
        <div className="py-6 flex justify-center"><Loader2 size={20} className="animate-spin text-orange-400" /></div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <StatCard
              testid="admin-health-fail-24h"
              tone={data.failure_rate_24h_pct >= 15 ? "danger" : data.failure_rate_24h_pct >= 5 ? "warn" : "success"}
              label="Last 24 h"
              value={`${data.failed_24h}/${data.total_24h}`}
              hint={`${data.failure_rate_24h_pct}% failure rate`}
            />
            <StatCard
              testid="admin-health-fail-7d"
              tone={data.failure_rate_7d_pct >= 15 ? "danger" : data.failure_rate_7d_pct >= 5 ? "warn" : "success"}
              label="Last 7 d"
              value={`${data.failed_7d}/${data.total_7d}`}
              hint={`${data.failure_rate_7d_pct}% failure rate`}
            />
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
            Recent failures {data.recent_failures.length > 0 && (
              <span className="text-slate-500 lowercase font-normal">· showing latest {data.recent_failures.length}</span>
            )}
          </div>
          {data.recent_failures.length === 0 ? (
            <div className="text-[11px] text-emerald-300 flex items-center gap-1.5" data-testid="admin-health-ai-clean">
              <CheckCircle2 size={12} /> No recent AI generation failures. Nice.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-1" data-testid="admin-health-ai-list">
              {data.recent_failures.map((f) => (
                <div
                  key={f.job_id}
                  data-testid={`admin-health-ai-row-${f.job_id}`}
                  className="text-[10px] font-mono bg-slate-950/60 p-2 rounded border border-slate-800/60"
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className={`px-1 rounded uppercase text-[9px] ${
                        f.provider === "fal" ? "bg-cyan-500/20 text-cyan-300" : "bg-fuchsia-500/20 text-fuchsia-300"
                      }`}>{f.provider}</span>
                      <span className="text-slate-300">{f.kind}</span>
                    </span>
                    <span className="text-slate-500">
                      {f.updated_at ? new Date(f.updated_at).toLocaleString() : "—"}
                    </span>
                  </div>
                  <div className="text-red-300">{f.error || "unknown"}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminHealth() {
  const { user, loading } = useAuth();
  const [stats, setStats] = useState(null);
  const [statsErr, setStatsErr] = useState("");
  const [statsLoading, setStatsLoading] = useState(true);
  const [adminInfo, setAdminInfo] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) { setChecking(false); return; }
    (async () => {
      try { setAdminInfo(await adminApi.me()); }
      catch { setAdminInfo(null); }
      finally { setChecking(false); }
    })();
  }, [user, loading]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true); setStatsErr("");
    try { setStats(await adminApi.galleryStats()); }
    catch (e) { setStatsErr(e?.response?.data?.detail || e.message || "Failed to load stats"); }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { if (adminInfo) loadStats(); }, [adminInfo, loadStats]);

  if (loading || checking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-orange-400" />
      </div>
    );
  }
  if (!user || !adminInfo) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-slate-950 text-white" data-testid="admin-health-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/admin" className="flex items-center gap-2 text-slate-400 hover:text-white" data-testid="admin-health-back">
          <ArrowLeft size={16} /> <span className="text-sm">Admin</span>
        </Link>
        <div className="flex-1" />
        <div className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-emerald-500 to-orange-500 flex items-center justify-center">
            <Shield size={16} className="text-white" strokeWidth={2.4} />
          </div>
          <span className="text-sm font-bold tracking-tight">Gallery Health</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Health &amp; drift dashboard</h1>
            <p className="text-[11px] text-slate-500">
              Live counts from <code className="text-slate-400">db.gallery</code> and{" "}
              <code className="text-slate-400">db.components</code>. Regenerate thumbnails or
              audit recent AI failures without leaving the browser.
            </p>
          </div>
          <button
            data-testid="admin-health-refresh-stats"
            onClick={loadStats}
            disabled={statsLoading}
            className="h-8 px-3 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded flex items-center gap-1.5 border border-slate-700 disabled:opacity-50"
          >
            {statsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
          </button>
        </div>

        {statsErr && (
          <div className="border border-red-500/40 bg-red-500/10 text-red-300 rounded p-3 text-xs" data-testid="admin-health-stats-error">
            {statsErr}
          </div>
        )}

        <ThumbnailRegenSection stats={stats} onDone={loadStats} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {stats?.gallery && (
            <CollectionCard title="Gallery" data={stats.gallery} testid="admin-health-gallery" />
          )}
          {stats?.components && (
            <CollectionCard title="Components" data={stats.components} testid="admin-health-components" />
          )}
        </div>

        <AIErrorsSection />
      </main>
    </div>
  );
}

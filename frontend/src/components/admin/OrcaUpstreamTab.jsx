// Iter-85 — Admin tab for reviewing & merging OrcaSlicer upstream
// printer-profile updates fetched from SoftFever/OrcaSlicer's GitHub.
//
// Backend lives at /api/admin/orca-upstream/*. A daemon syncs every 24h
// at server boot; admins can also force "Sync now" from this tab.
//
// Workflow:
//   1. Daemon hits the GitHub git-tree API once → diffs SHAs against
//      our `orca_upstream_cache` → appends `pending` rows to
//      `orca_upstream_deltas`.
//   2. Admin sees the pending deltas here, can View / Merge / Dismiss.
//   3. Merge promotes the cached JSON into `bundled_synced_printers`,
//      which the public endpoint /api/synced-printers serves.
//   4. Frontend slicer popover (already wired separately) augments the
//      built-in PRINTER_PROFILES with these synced entries so every
//      user sees the new hardware in the dropdown.

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  RefreshCw, Loader2, GitBranch, Check, X as XIcon, Clock,
  AlertCircle, ChevronDown, ChevronRight, Sparkles, Package, Mail,
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";

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

function StatusBadge({ status }) {
  const map = {
    pending:   { cls: "bg-amber-500/20 text-amber-200 border-amber-500/40",   label: "Pending" },
    merged:    { cls: "bg-green-500/20 text-green-200 border-green-500/40",   label: "Merged" },
    dismissed: { cls: "bg-slate-500/20 text-slate-300 border-slate-500/40",   label: "Dismissed" },
  };
  const m = map[status] || map.pending;
  return (
    <span className={`text-[9px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded border ${m.cls}`}>
      {m.label}
    </span>
  );
}

function KindBadge({ kind }) {
  const cls = kind === "new"
    ? "bg-cyan-500/20 text-cyan-200 border-cyan-500/40"
    : "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40";
  return (
    <span className={`text-[9px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {kind}
    </span>
  );
}

function DeltaRow({ delta, onMerge, onDismiss, onView, busyId }) {
  const isBusy = busyId === delta.id;
  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-800/30" data-testid={`upstream-delta-row-${delta.id}`}>
      <td className="py-2 px-2 align-top w-[1%] whitespace-nowrap">
        <KindBadge kind={delta.kind} />
      </td>
      <td className="py-2 px-2 align-top">
        <div className="text-xs font-mono text-slate-200">{delta.name}</div>
        <div className="text-[10px] text-slate-500 font-mono truncate max-w-[40ch]">{delta.path}</div>
      </td>
      <td className="py-2 px-2 align-top text-[11px] text-slate-300">{delta.vendor}</td>
      <td className="py-2 px-2 align-top text-[10px] text-slate-400 whitespace-nowrap">{relTime(delta.detected_at)}</td>
      <td className="py-2 px-2 align-top w-[1%] whitespace-nowrap">
        <StatusBadge status={delta.status} />
      </td>
      <td className="py-2 px-2 align-top w-[1%] whitespace-nowrap text-right">
        {delta.status === "pending" && (
          <div className="inline-flex items-center gap-1">
            <button
              data-testid={`upstream-view-btn-${delta.id}`}
              disabled={isBusy}
              onClick={() => onView(delta)}
              className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-slate-300 hover:text-white hover:bg-slate-700 rounded"
            >
              View
            </button>
            <button
              data-testid={`upstream-merge-btn-${delta.id}`}
              disabled={isBusy}
              onClick={() => onMerge(delta)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 rounded"
            >
              {isBusy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
              Merge
            </button>
            <button
              data-testid={`upstream-dismiss-btn-${delta.id}`}
              disabled={isBusy}
              onClick={() => onDismiss(delta)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-slate-300 hover:text-white hover:bg-slate-700 rounded"
            >
              <XIcon size={10} /> Dismiss
            </button>
          </div>
        )}
        {delta.status !== "pending" && (
          <div className="text-[10px] text-slate-500">
            by {delta.action_by || "—"} · {relTime(delta.action_at)}
          </div>
        )}
      </td>
    </tr>
  );
}

function DiffPanel({ data, onClose }) {
  if (!data) return null;
  const json = data.current_json;
  const pretty = json ? JSON.stringify(json, null, 2) : "(no cached JSON)";
  return (
    <div
      className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4"
      data-testid="upstream-diff-overlay"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch size={14} className="text-orange-300" />
            <h2 className="text-sm font-semibold text-white truncate">
              {data.delta?.vendor} / {data.delta?.name}
            </h2>
            <KindBadge kind={data.delta?.kind} />
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" data-testid="upstream-diff-close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="px-4 py-2 text-[10px] text-slate-500 font-mono border-b border-slate-800">
          <div>path: {data.delta?.path}</div>
          <div>sha: {data.current_sha}</div>
        </div>
        <pre className="flex-1 overflow-auto text-[10px] leading-relaxed font-mono text-slate-200 bg-slate-950 m-3 p-3 rounded border border-slate-800" data-testid="upstream-diff-json">
          {pretty}
        </pre>
      </div>
    </div>
  );
}

// Iter-88 — "Send digest now" button + cooldown chip. Loads the
// singleton digest-state on mount so admins see how long it's been
// since the last fire-off. The "Send now" action bypasses the weekly
// cooldown on the backend (admin route resets `last_sent_at` to null
// before re-invoking the digest path).
function DigestButton() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminApi.orcaUpstream.digestState().then(setState).catch(() => {});
  }, []);
  const handleSend = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await adminApi.orcaUpstream.sendDigestNow();
      if (res.skipped === "no-changes") {
        toast.info("No new or changed upstream profiles since the last digest — nothing to send.");
      } else if (res.skipped === "no-admins") {
        toast.warning("No admins on file to receive a digest.");
      } else {
        toast.success(`Digest sent to ${res.sent} admin${res.sent === 1 ? "" : "s"} (${res.new} new, ${res.changed} changed).`);
      }
      const next = await adminApi.orcaUpstream.digestState();
      setState(next);
    } catch (err) {
      toast.error(`Couldn't send digest: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setBusy(false);
    }
  };
  const last = state?.last_sent_at ? relTime(state.last_sent_at) : "never";
  return (
    <div className="flex items-center gap-2" data-testid="upstream-digest-block">
      <div className="text-[10px] text-slate-500 leading-tight text-right">
        <div>Last digest:</div>
        <div className="text-slate-400" data-testid="upstream-digest-last">{last}</div>
      </div>
      <button
        data-testid="upstream-digest-send-btn"
        onClick={handleSend}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-cyan-200 border border-cyan-500/40 hover:border-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50 rounded"
        title="Email every admin a summary of new + changed upstream profiles. Skips silently if nothing changed."
      >
        {busy
          ? <><Loader2 size={12} className="animate-spin" /> Sending…</>
          : <><Mail size={12} /> Send digest</>}
      </button>
    </div>
  );
}

export default function OrcaUpstreamTab() {  const [tab, setTab] = useState("pending");           // pending | merged | dismissed | runs
  const [deltas, setDeltas] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [diff, setDiff] = useState(null);
  const [runsOpen, setRunsOpen] = useState(false);
  // Iter-90: community suggestions queue.
  const [suggestions, setSuggestions] = useState([]);

  const refresh = useCallback(async (statusKey) => {
    setLoading(true);
    try {
      if (statusKey === "runs") {
        const r = await adminApi.orcaUpstream.runs(20);
        setRuns(r);
      } else if (statusKey === "suggestions") {
        const s = await adminApi.orcaUpstream.listSuggestions("open");
        setSuggestions(s);
      } else {
        const d = await adminApi.orcaUpstream.deltas(statusKey);
        setDeltas(d);
      }
    } catch (err) {
      toast.error(`Couldn't load: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(tab); }, [tab, refresh]);

  // Load last-run badge regardless of which sub-tab is open.
  useEffect(() => {
    if (tab !== "runs") {
      adminApi.orcaUpstream.runs(1).then(setRuns).catch(() => {});
    }
  }, [tab]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await adminApi.orcaUpstream.sync();
      if (result.error) {
        toast.error(`Sync finished with errors: ${result.error}`);
      } else {
        const parts = [];
        if (result.new_count) parts.push(`${result.new_count} new`);
        if (result.changed_count) parts.push(`${result.changed_count} changed`);
        if (!parts.length) parts.push("no changes");
        toast.success(`Upstream sync done — ${parts.join(", ")} (${result.unchanged_count} unchanged, ${(result.duration_ms / 1000).toFixed(1)}s)`);
      }
      await refresh(tab);
      if (tab !== "runs") adminApi.orcaUpstream.runs(1).then(setRuns).catch(() => {});
    } catch (err) {
      toast.error(`Sync failed: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleMerge = async (delta) => {
    setBusyId(delta.id);
    try {
      await adminApi.orcaUpstream.mergeDelta(delta.id);
      toast.success(`Merged "${delta.name}" into the global printer library.`);
      await refresh(tab);
    } catch (err) {
      toast.error(`Merge failed: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (delta) => {
    setBusyId(delta.id);
    try {
      await adminApi.orcaUpstream.dismissDelta(delta.id);
      toast.success(`Dismissed "${delta.name}".`);
      await refresh(tab);
    } catch (err) {
      toast.error(`Dismiss failed: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleView = async (delta) => {
    try {
      const d = await adminApi.orcaUpstream.deltaDiff(delta.id);
      setDiff(d);
    } catch (err) {
      toast.error(`Couldn't load JSON: ${err?.response?.data?.detail || err.message}`);
    }
  };

  // Iter-90: resolve / reject a community suggestion. `prompt()` is
  // the cheapest path to ask for resolution notes; admins only do
  // this a few times a week so it doesn't need its own modal.
  const handleResolveSuggestion = async (s) => {
    const notes = window.prompt(`Resolve "${s.printer_name}"?\n\nOptional notes (visible to the submitter):`, "");
    if (notes === null) return;
    try {
      await adminApi.orcaUpstream.resolveSuggestion(s.id, notes);
      toast.success(`Marked "${s.printer_name}" resolved.`);
      await refresh("suggestions");
    } catch (err) {
      toast.error(`Couldn't resolve: ${err?.response?.data?.detail || err.message}`);
    }
  };
  const handleRejectSuggestion = async (s) => {
    const notes = window.prompt(`Reject "${s.printer_name}"?\n\nReason (visible to the submitter):`, "");
    if (notes === null) return;
    try {
      await adminApi.orcaUpstream.rejectSuggestion(s.id, notes);
      toast.success(`Rejected "${s.printer_name}".`);
      await refresh("suggestions");
    } catch (err) {
      toast.error(`Couldn't reject: ${err?.response?.data?.detail || err.message}`);
    }
  };

  const lastRun = runs[0];
  const subTabs = useMemo(() => [
    { key: "pending",     label: "Pending",     accent: "border-orange-400 text-orange-200" },
    { key: "merged",      label: "Merged",      accent: "border-green-400 text-green-200" },
    { key: "dismissed",   label: "Dismissed",   accent: "border-slate-400 text-slate-300" },
    { key: "suggestions", label: "Suggestions", accent: "border-fuchsia-400 text-fuchsia-200" },
    { key: "runs",        label: "Run history", accent: "border-cyan-400 text-cyan-200" },
  ], []);

  return (
    <div data-testid="admin-orca-upstream-tab" className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <h2 className="text-sm font-bold tracking-wider uppercase text-white flex items-center gap-2">
            <Sparkles size={14} className="text-orange-300" /> OrcaSlicer profile updates
          </h2>
          <p className="text-[11px] text-slate-400 max-w-2xl">
            Auto-polls <span className="font-mono text-slate-300">SoftFever/OrcaSlicer</span> every 24 hours for new
            or changed printer presets in <span className="font-mono">resources/profiles/&lt;vendor&gt;/machine/</span>.
            Merging a delta promotes the cached JSON into the global library served at
            <span className="font-mono"> /api/synced-printers</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRun && (
            <div className="text-[10px] text-slate-500" data-testid="upstream-last-run">
              Last sync: {relTime(lastRun.finished_at || lastRun.started_at)}
            </div>
          )}
          <DigestButton />
          <button
            data-testid="upstream-sync-now-btn"
            disabled={syncing}
            onClick={handleSync}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 rounded"
          >
            {syncing
              ? <><Loader2 size={12} className="animate-spin" /> Syncing…</>
              : <><RefreshCw size={12} /> Sync now</>}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {subTabs.map(({ key, label, accent }) => (
          <button
            key={key}
            data-testid={`upstream-subtab-${key}`}
            onClick={() => setTab(key)}
            className={`h-8 px-3 text-[10px] uppercase tracking-wider font-semibold border-b-2 -mb-px ${
              tab === key ? accent : "border-transparent text-slate-500 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10 text-slate-500 text-xs gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && tab === "suggestions" && (
        <div className="bg-slate-900 border border-slate-800 rounded" data-testid="upstream-suggestions-table">
          {suggestions.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-500 space-y-1">
              <div className="flex items-center justify-center gap-2 text-slate-400">
                <Sparkles size={14} /> No open community suggestions.
              </div>
              <div className="text-[10px] text-slate-600">
                Users can submit suggestions from the slicer popover ("Don't see yours? Suggest a profile").
              </div>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[9px] uppercase tracking-wider text-slate-500 bg-slate-950/50">
                <tr>
                  <th className="px-2 py-1.5 text-left">Printer</th>
                  <th className="px-2 py-1.5 text-left">Submitter</th>
                  <th className="px-2 py-1.5 text-left">Submitted</th>
                  <th className="px-2 py-1.5 text-left">Notes / URL</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.id} className="border-b border-slate-800/60 hover:bg-slate-800/30" data-testid={`upstream-suggestion-row-${s.id}`}>
                    <td className="py-2 px-2 align-top">
                      <div className="text-xs font-mono text-slate-200">{s.printer_name}</div>
                      <div className="text-[10px] text-slate-500">{s.vendor || "—"}</div>
                    </td>
                    <td className="py-2 px-2 align-top text-[10px] text-slate-400">{s.submitter_email || s.submitted_by}</td>
                    <td className="py-2 px-2 align-top text-[10px] text-slate-400">{relTime(s.submitted_at)}</td>
                    <td className="py-2 px-2 align-top text-[10px] text-slate-300 max-w-xs">
                      {s.notes && <div className="italic text-slate-400 mb-1 line-clamp-3">{s.notes}</div>}
                      {s.upstream_url && (
                        <a href={s.upstream_url} target="_blank" rel="noopener noreferrer"
                           className="text-cyan-400 hover:text-cyan-200 inline-flex items-center gap-1 underline decoration-dotted truncate max-w-full">
                          {s.upstream_url.replace(/^https?:\/\//, "").slice(0, 50)}
                        </a>
                      )}
                    </td>
                    <td className="py-2 px-2 align-top text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          data-testid={`upstream-suggestion-resolve-${s.id}`}
                          onClick={() => handleResolveSuggestion(s)}
                          className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-300 hover:bg-emerald-500/10 rounded inline-flex items-center gap-1"
                        >
                          <Check size={10} /> Resolve
                        </button>
                        <button
                          data-testid={`upstream-suggestion-reject-${s.id}`}
                          onClick={() => handleRejectSuggestion(s)}
                          className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-slate-300 hover:bg-slate-700 rounded inline-flex items-center gap-1"
                        >
                          <XIcon size={10} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && tab === "runs" && (
        <div className="bg-slate-900 border border-slate-800 rounded" data-testid="upstream-runs-table">
          {runs.length === 0
            ? <div className="px-3 py-6 text-center text-xs text-slate-500">No sync runs recorded yet.</div>
            : (
              <table className="w-full text-xs">
                <thead className="text-[9px] uppercase tracking-wider text-slate-500 bg-slate-950/50">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Started</th>
                    <th className="px-2 py-1.5 text-left">Trigger</th>
                    <th className="px-2 py-1.5 text-right">Seen</th>
                    <th className="px-2 py-1.5 text-right">New</th>
                    <th className="px-2 py-1.5 text-right">Changed</th>
                    <th className="px-2 py-1.5 text-right">Unchanged</th>
                    <th className="px-2 py-1.5 text-right">Skipped</th>
                    <th className="px-2 py-1.5 text-right">Duration</th>
                    <th className="px-2 py-1.5 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/60">
                      <td className="px-2 py-1.5 text-[10px] text-slate-300 whitespace-nowrap">{relTime(r.started_at)}</td>
                      <td className="px-2 py-1.5 text-[10px] text-slate-400">{r.trigger || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.candidates_seen}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-cyan-300">{r.new_count}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-fuchsia-300">{r.changed_count}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{r.unchanged_count}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.skipped_count}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{(r.duration_ms / 1000).toFixed(1)}s</td>
                      <td className="px-2 py-1.5 text-[10px] text-rose-300 truncate max-w-[24ch]">{r.error || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      {!loading && tab !== "runs" && tab !== "suggestions" && (
        <div className="bg-slate-900 border border-slate-800 rounded" data-testid={`upstream-deltas-${tab}`}>
          {deltas.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-500 space-y-1">
              <div className="flex items-center justify-center gap-2 text-slate-400">
                <Package size={14} /> No {tab} deltas.
              </div>
              {tab === "pending" && (
                <div className="text-[10px] text-slate-600">
                  Run "Sync now" to check GitHub for fresh upstream changes.
                </div>
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[9px] uppercase tracking-wider text-slate-500 bg-slate-950/50">
                <tr>
                  <th className="px-2 py-1.5 text-left">Kind</th>
                  <th className="px-2 py-1.5 text-left">Profile</th>
                  <th className="px-2 py-1.5 text-left">Vendor</th>
                  <th className="px-2 py-1.5 text-left">Detected</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deltas.map((d) => (
                  <DeltaRow
                    key={d.id}
                    delta={d}
                    busyId={busyId}
                    onView={handleView}
                    onMerge={handleMerge}
                    onDismiss={handleDismiss}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <DiffPanel data={diff} onClose={() => setDiff(null)} />
    </div>
  );
}

/**
 * BroadcastsTab — superadmin-only page to send an email + in-app
 * notification to every non-opted-out user (iter-151.15).
 *
 * Flow:
 *   1. Type a subject + HTML body (a small "preview" tab renders it).
 *   2. See a live recipient count (excludes users who opted out of
 *      broadcasts).
 *   3. Click Send — kicks off the background worker on the backend;
 *      the newly-created broadcast row appears at the top of the
 *      history list with a "sending" pill that flips to "done" once
 *      the worker completes.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Send, Loader2, Users, Mail, RefreshCw } from "lucide-react";
import { adminBroadcastsApi } from "../../lib/api";

export default function BroadcastsTab() {
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [preview, setPreview] = useState(false);
  const [count, setCount] = useState(null);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadPreviewCount = useCallback(async () => {
    try {
      setCount(await adminBroadcastsApi.previewCount());
    } catch (err) {
      toast.error(`Recipient count failed: ${err?.response?.data?.detail || err.message}`);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      setHistory(await adminBroadcastsApi.list() || []);
    } catch {
      // silent
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => { loadPreviewCount(); loadHistory(); }, [loadPreviewCount, loadHistory]);

  const send = async () => {
    if (!subject.trim() || !bodyHtml.trim()) {
      toast.error("Subject and body are required");
      return;
    }
    setSending(true);
    try {
      const created = await adminBroadcastsApi.send({
        subject: subject.trim(),
        body_html: bodyHtml,
        send_email: true,
      });
      toast.success(`Broadcast started · ${count?.will_receive || 0} recipients`);
      setHistory((prev) => [created, ...prev]);
      setSubject(""); setBodyHtml(""); setConfirm(false);
      // The worker updates counters asynchronously — refresh the
      // history a couple times so the "done" state lands in the UI
      // without the admin needing to click Refresh.
      setTimeout(loadHistory, 3000);
      setTimeout(loadHistory, 10_000);
    } catch (err) {
      toast.error(`Send failed: ${err?.response?.data?.detail || err.message}`);
    } finally { setSending(false); }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="admin-broadcasts-tab">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Mail size={16} className="text-purple-400" />
          <h3 className="text-base font-semibold text-white">Send Broadcast</h3>
          {count && (
            <span className="ml-auto flex items-center gap-1 text-xs text-slate-400" data-testid="broadcast-preview-count">
              <Users size={11} /> {count.will_receive} of {count.total_users} will receive · {count.opted_out} opted out
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            data-testid="broadcast-subject"
            type="text"
            maxLength={200}
            placeholder="Subject line"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-9 px-2 bg-slate-950 border border-slate-700 rounded text-sm focus:border-purple-500 outline-none"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider">
            <span>Body (HTML supported)</span>
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              data-testid="broadcast-preview-toggle"
              className="text-purple-400 hover:text-purple-300 normal-case tracking-normal text-xs"
            >
              {preview ? "Edit" : "Preview"}
            </button>
          </div>
          {preview ? (
            <div
              data-testid="broadcast-preview-render"
              className="min-h-[200px] bg-slate-950 border border-slate-700 rounded p-3 text-sm text-slate-200 leading-relaxed"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: bodyHtml || "<p style='color:#64748b'>Nothing to preview yet.</p>" }}
            />
          ) : (
            <textarea
              data-testid="broadcast-body"
              rows={10}
              placeholder='<p>Hello ForgeSlicers,</p><p>Announcing…</p>'
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              className="px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm font-mono focus:border-purple-500 outline-none resize-y"
            />
          )}
          {!confirm ? (
            <button
              data-testid="broadcast-send-btn"
              onClick={() => setConfirm(true)}
              disabled={!subject.trim() || !bodyHtml.trim()}
              className="h-9 px-4 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center gap-2 self-start"
            >
              <Send size={13} /> Send to {count?.will_receive || "…"} recipients
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded p-2">
              <span className="text-xs text-slate-200 flex-1">
                Send this to <span className="font-bold text-red-300">{count?.will_receive || 0}</span> user{count?.will_receive === 1 ? "" : "s"} now?
              </span>
              <button
                data-testid="broadcast-confirm-send-btn"
                onClick={send}
                disabled={sending}
                className="h-8 px-3 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1"
              >
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={11} />} Yes, send
              </button>
              <button
                onClick={() => setConfirm(false)}
                className="h-8 px-3 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-300">Broadcast history</h3>
          <button
            data-testid="broadcast-refresh-history-btn"
            onClick={loadHistory}
            className="text-slate-500 hover:text-slate-300"
            title="Refresh"
          >
            <RefreshCw size={12} className={loadingHistory ? "animate-spin" : ""} />
          </button>
        </div>
        {history.length === 0 && (
          <div className="text-xs text-slate-500 italic">No broadcasts sent yet.</div>
        )}
        <div className="flex flex-col gap-2">
          {history.map((b) => (
            <div key={b.broadcast_id} className="bg-slate-900 border border-slate-800 rounded p-3" data-testid={`broadcast-row-${b.broadcast_id}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-slate-100 truncate">{b.subject}</span>
                <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                  b.status === "done" ? "bg-emerald-500/20 text-emerald-300"
                  : b.status === "sending" ? "bg-amber-500/20 text-amber-300"
                  : "bg-slate-500/20 text-slate-400"
                }`}>{b.status}</span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">
                {new Date(b.created_at).toLocaleString()} · by {b.sent_by_name} · recipients {b.recipient_count} · email sent {b.email_sent} · failed {b.email_failed}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

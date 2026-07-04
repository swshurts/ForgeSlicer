/**
 * BYO Meshy AI key management card for the /profile page.
 *
 * Lets users bring their own Meshy AI key so they can generate 3D models
 * beyond ForgeSlicer's monthly cap (they pay Meshy directly).
 *
 * Behaviours:
 *   - Fetches /api/me/meshy-key/status on mount → shows the masked hint if
 *     a key is already saved.
 *   - PUT to save a new key. Server verifies against Meshy BEFORE persisting
 *     (rejects invalid keys with a 400).
 *   - DELETE to clear.
 *   - Never displays the plaintext key after saving — only the masked hint.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Eye, EyeOff, Loader2, Trash2, ExternalLink, ShieldCheck } from "lucide-react";
import { API } from "../../lib/api";

async function fetchStatus() {
  const r = await fetch(`${API}/me/meshy-key/status`, { credentials: "include" });
  if (!r.ok) throw new Error(`Status ${r.status}`);
  return r.json();
}

async function saveKey(apiKey) {
  const r = await fetch(`${API}/me/meshy-key`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(body.detail || `Save failed (${r.status})`);
  }
  return body;
}

async function clearKey() {
  const r = await fetch(`${API}/me/meshy-key`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!r.ok) throw new Error(`Clear failed (${r.status})`);
  return r.json();
}

export default function MeshyKeyCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setLoading(true);
      const s = await fetchStatus();
      setStatus(s);
    } catch (e) {
      console.warn("meshy-key status fetch failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const onSave = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      toast.error("Paste your Meshy API key first.");
      return;
    }
    if (trimmed.length < 8) {
      toast.error("That doesn't look right — Meshy keys are longer than 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await saveKey(trimmed);
      toast.success("Meshy key saved and verified. Your generations now bypass the platform cap.");
      setInput("");
      setReveal(false);
      await refresh();
    } catch (e) {
      toast.error(e.message || "Could not save the key.");
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    if (!confirm("Remove your saved Meshy key? You'll go back to the platform's monthly cap.")) return;
    setBusy(true);
    try {
      await clearKey();
      toast.success("Meshy key removed.");
      await refresh();
    } catch (e) {
      toast.error(e.message || "Could not clear the key.");
    } finally {
      setBusy(false);
    }
  };

  const hasKey = !!status?.has_key;

  return (
    <div
      data-testid="meshy-key-card"
      className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className={`h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0 ${hasKey ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
          {hasKey ? <ShieldCheck size={18} /> : <KeyRound size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            Bring Your Own Meshy AI Key
            {hasKey && (
              <span
                data-testid="meshy-key-active-badge"
                className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded"
              >
                Active · Unlimited
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Save your own Meshy AI key to bypass ForgeSlicer&apos;s monthly generation cap.
            Meshy will bill your account directly.
            {" "}
            <a
              href="https://www.meshy.ai/api"
              target="_blank"
              rel="noreferrer"
              data-testid="meshy-key-help-link"
              className="text-orange-300 hover:text-orange-200 inline-flex items-center gap-1"
            >
              Get a key <ExternalLink size={11} />
            </a>
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="animate-spin" size={12} /> Loading status…</div>
      ) : hasKey ? (
        <div className="flex items-center gap-3 flex-wrap">
          <div
            data-testid="meshy-key-hint"
            className="font-mono text-sm text-slate-200 bg-slate-950/60 border border-slate-700 rounded px-3 py-2"
          >
            {status.hint}
          </div>
          <button
            data-testid="meshy-key-clear-btn"
            onClick={onClear}
            disabled={busy}
            className="h-9 px-3 bg-slate-800 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40 text-slate-200 text-xs font-medium rounded border border-slate-700 flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="animate-spin" size={12} /> : <Trash2 size={12} />} Remove key
          </button>
          <div className="text-[11px] text-slate-500">
            Encrypted at rest. Only you can see the hint above.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              data-testid="meshy-key-input"
              type={reveal ? "text" : "password"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="msy-..."
              autoComplete="off"
              spellCheck={false}
              className="flex-1 h-10 px-3 bg-slate-950 border border-slate-700 rounded text-sm font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
            />
            <button
              data-testid="meshy-key-reveal-btn"
              onClick={() => setReveal((v) => !v)}
              className="h-10 w-10 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 flex items-center justify-center"
              title={reveal ? "Hide" : "Show"}
            >
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              data-testid="meshy-key-save-btn"
              onClick={onSave}
              disabled={busy || !input.trim()}
              className="h-10 px-4 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded flex items-center gap-2"
            >
              {busy ? <Loader2 className="animate-spin" size={14} /> : "Save & verify"}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            We verify the key against Meshy before saving. The value is encrypted
            server-side and never displayed in plain text again.
          </p>
        </div>
      )}
    </div>
  );
}

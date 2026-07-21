/**
 * UnsubscribePage — token-based opt-out landing page (iter-151.15).
 *
 * Public — accepts a URL like `/unsubscribe/:token?kind=broadcast`
 * (or `?kind=coop`). Fetches the current opt-in state, shows a big
 * confirmation button, and flips the flag via POST when clicked.
 * Users don't need to sign in for this to work — the token IS the
 * authentication.
 */
import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { MailX, Loader2, Check } from "lucide-react";
import { unsubscribeApi } from "../lib/api";

export default function UnsubscribePage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const kind = params.get("kind") === "coop" ? "coop" : "broadcast";
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await unsubscribeApi.status(token);
        if (!cancelled) setStatus(s);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.detail || "Invalid unsubscribe link");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const optOut = async () => {
    try {
      await unsubscribeApi.optOut(token, kind);
      setDone(true);
      toast.success(`Unsubscribed from ${kind === "coop" ? "cooperative-project" : "broadcast"} emails`);
    } catch (err) {
      toast.error(`Failed: ${err?.response?.data?.detail || err.message}`);
    }
  };

  const kindLabel = kind === "coop" ? "cooperative-project" : "broadcast";
  const isCurrentlyOptedIn = kind === "coop" ? status?.coop_opt_in : status?.broadcasts_opt_in;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg p-6" data-testid="unsubscribe-page">
        <div className="flex items-center gap-2 text-purple-400 mb-2">
          <MailX size={18} /> <span className="uppercase tracking-widest text-[10px] font-semibold">Email Preferences</span>
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 className="animate-spin" size={14} /> Loading…
          </div>
        )}
        {!loading && error && (
          <>
            <h1 className="text-xl font-bold text-red-400 mb-2">Invalid link</h1>
            <p className="text-sm text-slate-400 mb-4">{error}</p>
            <Link to="/" className="text-purple-400 hover:text-purple-300 underline text-sm">← Home</Link>
          </>
        )}
        {!loading && !error && !done && (
          <>
            <h1 className="text-xl font-bold text-white mb-2">
              Unsubscribe from {kindLabel} emails?
            </h1>
            <p className="text-sm text-slate-400 mb-6">
              {isCurrentlyOptedIn
                ? `You're currently receiving ${kindLabel} emails. Confirm to stop.`
                : `You've already opted out of ${kindLabel} emails. No further action needed.`}
            </p>
            {isCurrentlyOptedIn && (
              <button
                data-testid="unsubscribe-confirm-btn"
                onClick={optOut}
                className="w-full h-10 bg-red-600 hover:bg-red-500 rounded font-semibold text-white flex items-center justify-center gap-2"
              >
                <MailX size={14} /> Yes, unsubscribe me
              </button>
            )}
            <Link to="/" className="block mt-3 text-center text-purple-400 hover:text-purple-300 underline text-sm">
              ← Back to ForgeSlicer
            </Link>
          </>
        )}
        {done && (
          <>
            <h1 className="text-xl font-bold text-emerald-400 mb-2 flex items-center gap-2">
              <Check size={20} /> You're unsubscribed
            </h1>
            <p className="text-sm text-slate-400 mb-4">
              You won't receive any more {kindLabel} emails. In-app notifications will still appear for coop actions.
              You can re-enable this any time from your <Link to="/profile" className="text-purple-400 underline">Account page</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

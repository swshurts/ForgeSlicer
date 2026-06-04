import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { API } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

/**
 * Billing success page — hit after Stripe redirects back from a paid
 * checkout. Polls `/api/billing/status/{session_id}` until either:
 *  - payment_status === "paid" → show the success state, refresh
 *    AuthContext so the new tier is reflected immediately
 *  - status === "expired" → show the expired/retry message
 *  - 10 attempts exhausted → show the "still processing" message and
 *    suggest checking back later (Stripe webhook will eventually grant
 *    the tier even if polling times out).
 */
export default function BillingSuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const { refresh: refreshUser } = useAuth();
  const [state, setState] = useState({ phase: "loading", body: null });
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setState({ phase: "error", body: { detail: "No checkout session id in URL." } });
      return undefined;
    }
    let cancelled = false;
    let timeout;
    const poll = async (n) => {
      if (cancelled || n >= 10) {
        if (!cancelled) setState({ phase: "timeout", body: null });
        return;
      }
      try {
        const r = await axios.get(`${API}/billing/status/${sessionId}`, { withCredentials: true });
        if (cancelled) return;
        setAttempts(n + 1);
        if (r.data.payment_status === "paid") {
          if (refreshUser) await refreshUser();
          setState({ phase: "paid", body: r.data });
        } else if (r.data.status === "expired") {
          setState({ phase: "expired", body: r.data });
        } else {
          timeout = setTimeout(() => poll(n + 1), 2000);
        }
      } catch (e) {
        if (!cancelled) setState({ phase: "error", body: e.response?.data || { detail: e.message } });
      }
    };
    poll(0);
    return () => { cancelled = true; if (timeout) clearTimeout(timeout); };
  }, [sessionId, refreshUser]);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col" data-testid="billing-success-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/" className="flex items-center gap-2 select-none">
          <img src="/forgeslicer-logo.webp" alt="ForgeSlicer" width={28} height={28} className="rounded shadow-lg shadow-orange-900/30" />
          <span className="text-sm font-bold tracking-tight">ForgeSlicer</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-8 text-center" data-testid="billing-status-card">
          {state.phase === "loading" && (
            <>
              <Loader2 size={36} className="text-orange-400 animate-spin mx-auto mb-4" />
              <h1 className="text-lg font-semibold">Confirming your payment…</h1>
              <p className="text-xs text-slate-500 mt-2">Attempt {attempts + 1} of 10. Stripe usually responds within 5 seconds.</p>
            </>
          )}
          {state.phase === "paid" && (
            <>
              <CheckCircle2 size={44} className="text-emerald-400 mx-auto mb-4" />
              <h1 className="text-xl font-bold" data-testid="billing-success-title">Welcome to <span className="text-orange-400">{state.body?.new_tier || state.body?.package_id}</span>!</h1>
              <p className="text-sm text-slate-400 mt-2">Your tier is active for 1 year. A receipt is on its way to your inbox.</p>
              <Link to="/workspace" className="inline-block mt-6 h-10 px-5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg leading-10">
                Back to Workspace
              </Link>
            </>
          )}
          {state.phase === "expired" && (
            <>
              <AlertCircle size={36} className="text-amber-400 mx-auto mb-4" />
              <h1 className="text-lg font-semibold">Checkout expired</h1>
              <p className="text-sm text-slate-400 mt-2">No charge was made. You can try again any time.</p>
              <Link to="/pricing" className="inline-block mt-6 h-10 px-5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg leading-10">
                Back to Pricing
              </Link>
            </>
          )}
          {state.phase === "timeout" && (
            <>
              <Loader2 size={36} className="text-orange-400 mx-auto mb-4" />
              <h1 className="text-lg font-semibold">Still processing…</h1>
              <p className="text-sm text-slate-400 mt-2">
                Stripe is taking longer than usual. You'll be upgraded automatically once the webhook confirms — check back in a minute or refresh this page.
              </p>
              <button
                data-testid="billing-retry-btn"
                onClick={() => window.location.reload()}
                className="inline-block mt-6 h-10 px-5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg"
              >
                Check again
              </button>
            </>
          )}
          {state.phase === "error" && (
            <>
              <AlertCircle size={36} className="text-red-400 mx-auto mb-4" />
              <h1 className="text-lg font-semibold">Something went wrong</h1>
              <p className="text-sm text-slate-400 mt-2" data-testid="billing-error-detail">
                {state.body?.detail || "We couldn't reach Stripe to confirm your payment."}
              </p>
              <Link to="/pricing" className="inline-block mt-6 h-10 px-5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg leading-10">
                Back to Pricing
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

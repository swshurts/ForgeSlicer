import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import dropin from "braintree-web-drop-in";
import { Loader2, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { API } from "../lib/api";

/**
 * BraintreeDialog — Drop-in payment modal for ForgeSlicer's pricing
 * page. Replaces the Stripe hosted-checkout redirect with an in-app
 * dialog that accepts PayPal, Venmo, and credit cards via one widget.
 *
 * Flow:
 *  1. Mount → fetch /api/billing/braintree/client-token (auth required).
 *  2. dropin.create() into a container we own — Drop-in injects its
 *     own iframe-isolated UI for PayPal/Venmo/card.
 *  3. User submits → requestPaymentMethod() returns a single-use nonce.
 *  4. POST /api/billing/braintree/checkout with { package_id, nonce }.
 *  5. Backend charges + grants the tier idempotently in one round-trip;
 *     we surface success and call `onSuccess(newTier)` so the parent
 *     can refresh the user from AuthContext.
 *
 * Why a custom modal (vs Radix Dialog): the Drop-in iframe really
 * dislikes being remounted/teardown'd by React's portal logic, and a
 * plain fixed-overlay div with our own backdrop keeps the Drop-in
 * lifecycle simple. The component itself owns mount + teardown.
 */
export default function BraintreeDialog({
  open,
  onClose,
  packageId,
  packageName,
  amountDisplay,
  onSuccess,
}) {
  const containerRef = useRef(null);
  const instanceRef = useRef(null);
  const [clientToken, setClientToken] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | loading | ready | submitting | success | error
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch client-token when the dialog opens; tear down everything
  // on close so a re-open always gets a fresh nonce/UI. The state
  // resets run in queueMicrotask so React 19's strict-mode doesn't
  // flag synchronous setState during an effect body — the visible
  // behaviour is identical, just one tick later.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPhase("loading");
      setErrorMsg("");
    });
    (async () => {
      try {
        const r = await axios.get(`${API}/billing/braintree/client-token`, { withCredentials: true });
        if (cancelled) return;
        setClientToken(r.data.client_token);
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e.response?.data?.detail || e.message || "Could not start checkout.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      const inst = instanceRef.current;
      if (inst) {
        instanceRef.current = null;
        try { inst.teardown(() => { /* noop */ }); } catch { /* noop */ }
      }
      setClientToken(null);
      setPhase("idle");
    };
  }, [open]);

  // Mount the Drop-in widget once we have a token + container.
  useEffect(() => {
    if (!open || !clientToken || !containerRef.current || instanceRef.current) return;
    dropin.create(
      {
        authorization: clientToken,
        container: containerRef.current,
        // Enable PayPal + Venmo alongside the default card flow. The
        // PayPal `flow: "checkout"` is one-time (vs "vault" which would
        // persist a payment method for future charges — not what we
        // want today). The `amount` here is informational only — the
        // ACTUAL charge amount is set server-side from PACKAGES, so
        // tampering this value can't change what the user pays.
        paypal: { flow: "checkout", amount: undefined, currency: "USD" },
        venmo: { allowNewBrowserTab: false },
        card: {},
      },
      (err, instance) => {
        if (err) {
          setErrorMsg(err.message || "Could not load payment widget.");
          setPhase("error");
          return;
        }
        instanceRef.current = instance;
        setPhase("ready");
      },
    );
  }, [open, clientToken]);

  const handlePay = async () => {
    const inst = instanceRef.current;
    if (!inst) return;
    setPhase("submitting");
    setErrorMsg("");
    try {
      const payload = await inst.requestPaymentMethod();
      const r = await axios.post(
        `${API}/billing/braintree/checkout`,
        { package_id: packageId, payment_method_nonce: payload.nonce },
        { withCredentials: true },
      );
      setPhase("success");
      // Brief flash of the success state, then let the parent take over.
      setTimeout(() => {
        if (onSuccess) onSuccess(r.data.new_tier);
        if (onClose) onClose();
      }, 1200);
    } catch (e) {
      // Two failure shapes: Braintree-side (nonce gen failed, e.g.
      // user typed an invalid card) vs server-side (axios error). Both
      // funnel through the same banner; the user can either retry the
      // same payment method or pick a different one in Drop-in.
      const msg = e.response?.data?.detail || e.message || "Payment failed.";
      setErrorMsg(msg);
      setPhase("ready");
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="braintree-dialog-backdrop"
      className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        data-testid="braintree-dialog"
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-800 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Upgrade to</div>
            <div className="text-lg font-bold tracking-tight">
              {packageName} · <span className="text-orange-400">{amountDisplay}</span>
            </div>
          </div>
          <button
            data-testid="braintree-close"
            onClick={onClose}
            disabled={phase === "submitting"}
            className="text-slate-500 hover:text-white disabled:opacity-30"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 min-h-[260px]">
          {(phase === "loading" || phase === "idle") && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
              <Loader2 size={24} className="animate-spin text-orange-400" />
              <span className="text-xs">Loading secure checkout…</span>
            </div>
          )}

          {errorMsg && phase !== "success" && (
            <div
              data-testid="braintree-error"
              className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 text-red-300 text-xs rounded p-2.5"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Drop-in's own UI lands in this container. We keep it
              mounted even during loading so Drop-in can attach. */}
          <div ref={containerRef} data-testid="braintree-dropin-container" />

          {phase === "success" && (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-emerald-400">
              <CheckCircle2 size={28} />
              <span className="text-sm font-semibold">Payment successful</span>
              <span className="text-[11px] text-slate-400">Your tier is active. Closing…</span>
            </div>
          )}
        </div>

        {(phase === "ready" || phase === "submitting") && (
          <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
            <button
              data-testid="braintree-cancel-btn"
              onClick={onClose}
              disabled={phase === "submitting"}
              className="h-9 px-3 text-xs text-slate-400 hover:text-white disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              data-testid="braintree-pay-btn"
              onClick={handlePay}
              disabled={phase === "submitting"}
              className="h-9 px-4 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white text-xs font-semibold rounded inline-flex items-center gap-1.5"
            >
              {phase === "submitting"
                ? <><Loader2 size={12} className="animate-spin" /> Processing…</>
                : <>Pay {amountDisplay}</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

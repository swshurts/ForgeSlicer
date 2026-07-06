import React, { useEffect, useRef, useState } from "react";
import { ShoppingBag, X } from "lucide-react";
import dropin from "braintree-web-drop-in";

import { API, PLATFORM_FEE_PCT } from "../../lib/api";
import { useAuth } from "../../lib/auth";

/**
 * Braintree Drop-in purchase dialog (replaces the old Stripe-redirect
 * version). Flow:
 *   1. Mount → request a client_token from /api/marketplace/client-token
 *   2. dropin.create({ authorization: token, container: divRef }) →
 *      renders Braintree's PCI-compliant card iframe
 *   3. User clicks Pay → dropinInstance.requestPaymentMethod() returns
 *      a one-shot nonce → POST it to /api/marketplace/{job_id}/checkout-bt
 *      together with the buyer's email and origin
 *   4. Backend calls gateway.transaction.sale(...) and returns
 *      {success, transaction_id, download_token} on the same request
 *   5. We hand the buyer their download_token by navigating to the
 *      existing success page — keeps the email-receipt + download UI
 *      paths intact so nothing else needs to change.
 *
 * Notes:
 * - The Drop-in instance is torn down on unmount AND on every payment
 *   attempt so we never reuse a stale, already-submitted nonce.
 * - The Pay button is disabled until Drop-in finishes initialising
 *   AND until the email is valid.
 */
export const PurchaseDialog = ({ listing, onClose }) => {
  const { user } = useAuth();
  // Default the email to the signed-in user's address so authenticated
  // buyers never have to type it. Anonymous buyers still get the
  // placeholder + "Required" cue.
  const [email, setEmail] = useState(() => user?.email || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dropinReady, setDropinReady] = useState(false);
  // True once Drop-in reports it has a fully-valid payment method.
  const [paymentMethodReady, setPaymentMethodReady] = useState(false);
  // Which Drop-in payment option is currently selected — drives the
  // Pay button label so it reads "Pay $X with PayPal" / "with card" /
  // "with Venmo" instead of a generic amount.
  const [methodKind, setMethodKind] = useState("card");
  const [initError, setInitError] = useState("");

  const containerRef = useRef(null);
  const dropinRef = useRef(null);
  const pollRef = useRef(null);
  const emailRef = useRef(null);

  const price = Number(listing.price_usd || 0);
  const fee = (price * PLATFORM_FEE_PCT) / 100;
  const creator = price - fee;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // --- Drop-in lifecycle ---
  useEffect(() => {
    let cancelled = false;

    const mount = async () => {
      try {
        const res = await fetch(`${API}/marketplace/client-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(`client-token ${res.status}`);
        const { client_token } = await res.json();
        if (cancelled) return;
        const instance = await dropin.create({
          authorization: client_token,
          container: containerRef.current,
          card: { cardholderName: { required: true } },
          // PayPal intentionally disabled until a PayPal Business
          // sandbox account is linked in Braintree (Settings →
          // Processing → PayPal). To re-enable, uncomment:
          //
          // paypal: {
          //   flow: "checkout",
          //   amount: price.toFixed(2),
          //   currency: "USD",
          // },
        });
        if (cancelled) {
          await instance.teardown().catch(() => {});
          return;
        }
        dropinRef.current = instance;
        // Subscribe to validity events for fast UI feedback.
        // NOTE: Drop-in only emits these events on edge transitions —
        // a subscriber attached *after* the form has already become
        // valid never sees the event. We also poll below as a safety
        // net, and we don't gate the Pay button on this flag (the
        // submit handler asks Drop-in directly via
        // `requestPaymentMethod()` which is the source of truth).
        const refreshReady = () => {
          try {
            setPaymentMethodReady(instance.isPaymentMethodRequestable());
          } catch {
            /* instance torn down */
          }
        };
        refreshReady();
        instance.on("paymentMethodRequestable", refreshReady);
        instance.on("noPaymentMethodRequestable", refreshReady);
        // Track which method the user picked so we can adapt the Pay
        // button's label. Possible values include "card", "paypal",
        // "venmo", "applePay", "googlePay".
        instance.on("paymentOptionSelected", (payload) => {
          if (payload?.paymentOption) {
            setMethodKind(payload.paymentOption);
          }
        });
        // Belt-and-suspenders: poll until torn down. Drop-in sometimes
        // misses event emission on Safari + first-time card entry, so
        // the user can otherwise stare at a disabled button.
        const poll = setInterval(refreshReady, 400);
        pollRef.current = poll;
        setDropinReady(true);
      } catch (e) {
        if (!cancelled) {
          setInitError(e?.message || "Failed to initialise the card form.");
        }
      }
    };

    mount();

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (dropinRef.current) {
        dropinRef.current.teardown().catch(() => {});
        dropinRef.current = null;
      }
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!validEmail) {
      setError("Please enter your email so we can deliver the download link.");
      try {
        emailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        emailRef.current?.focus();
      } catch {
        /* noop */
      }
      return;
    }
    if (!dropinRef.current) {
      setError("Card form isn't ready yet — please wait a moment.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      let nonce;
      try {
        const result = await dropinRef.current.requestPaymentMethod();
        nonce = result.nonce;
      } catch (rpmErr) {
        // Drop-in throws when any card field is invalid/empty. Its
        // own error message is generally helpful (e.g. "Please fill
        // out a card number"). Surface it instead of failing silently.
        const msg =
          rpmErr?.message ||
          "Please double-check the card details and try again.";
        throw new Error(msg);
      }
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const checkoutRes = await fetch(
        `${API}/marketplace/${listing.job_id}/checkout-bt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_method_nonce: nonce,
            buyer_email: email,
            origin_url: origin,
          }),
        }
      );
      const data = await checkoutRes.json();
      if (!checkoutRes.ok || !data.success) {
        throw new Error(data.error_message || "Payment was declined.");
      }
      // Stash buyer email for the success page email-receipt UI.
      try {
        sessionStorage.setItem(`buyer_email_${listing.job_id}`, email);
      } catch {
        /* ignore */
      }
      // Land on the existing success page with the download token.
      window.location.href =
        `/marketplace/${listing.job_id}/success?session_id=${encodeURIComponent(
          data.transaction_id
        )}&token=${encodeURIComponent(data.download_token)}`;
    } catch (err) {
      setError(err?.message || "Could not complete payment.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="purchase-dialog-backdrop"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-zinc-950 border border-zinc-800 max-w-md w-full p-6 space-y-5 max-h-[92vh] overflow-y-auto"
        data-testid="purchase-dialog"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
              Checkout
            </div>
            <h2 className="font-display text-2xl font-black tracking-tight leading-tight">
              {listing.title}
            </h2>
            <div className="font-mono text-[11px] text-zinc-500 mt-1">
              by {listing.creator_name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="purchase-close-btn"
            className="text-zinc-500 hover:text-zinc-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="border border-zinc-800 p-3 space-y-1 font-mono text-[11px] tabular-nums">
          <div className="flex justify-between text-zinc-400">
            <span>Item price</span>
            <span>${price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-zinc-600">
            <span>Platform fee ({PLATFORM_FEE_PCT}%)</span>
            <span>−${fee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-zinc-600">
            <span>Creator receives</span>
            <span>${creator.toFixed(2)}</span>
          </div>
          <div className="border-t border-zinc-800 mt-2 pt-2 flex justify-between text-zinc-100 font-bold">
            <span>You pay</span>
            <span>${price.toFixed(2)} USD</span>
          </div>
        </div>

        <div>
          <label
            htmlFor="purchase-email"
            className="font-mono text-[10px] uppercase tracking-[0.18em] mb-2 flex items-center justify-between"
          >
            <span className="text-zinc-300">
              Email for download link
              <span className="text-red-400 ml-1">*</span>
            </span>
            <span
              className={`normal-case tracking-normal text-[10px] ${
                validEmail ? "text-emerald-500" : "text-red-400"
              }`}
            >
              {validEmail ? "✓ Ready" : "Required"}
            </span>
          </label>
          <input
            id="purchase-email"
            ref={emailRef}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
            required
            placeholder="you@example.com"
            data-testid="purchase-email-input"
            className={`w-full bg-zinc-900 border px-3 py-2 font-mono text-[12px] text-zinc-100 focus:outline-none focus:border-zinc-500 ${
              validEmail ? "border-zinc-800" : "border-red-500/70"
            }`}
          />
          {!validEmail && (
            <div className="font-mono text-[9px] text-red-400/80 mt-1">
              We&apos;ll email your download link here as a backup.
            </div>
          )}
        </div>

        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2 block">
            Card details
          </label>
          {initError ? (
            <div
              data-testid="dropin-error"
              className="font-mono text-[10px] text-red-400 border border-red-900 bg-red-950/40 px-2 py-2"
            >
              {initError}
            </div>
          ) : (
            <div
              ref={containerRef}
              data-testid="braintree-dropin-container"
              className="bg-zinc-900 border border-zinc-800 p-2 min-h-[110px]"
            />
          )}
          {!dropinReady && !initError && (
            <div
              data-testid="dropin-loading"
              className="font-mono text-[10px] text-zinc-500 mt-1"
            >
              Loading secure card form…
            </div>
          )}
        </div>

        {error && (
          <div
            data-testid="purchase-error"
            className="font-mono text-[10px] text-red-400 border border-red-900 bg-red-950/40 px-2 py-1.5"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !dropinReady}
          data-testid="purchase-submit-btn"
          className="w-full flex items-center justify-center gap-2 bg-zinc-100 text-zinc-950 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white transition-colors"
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          {(() => {
            if (submitting) return "Processing payment…";
            if (!dropinReady) return "Loading card form…";
            if (!validEmail) return `Pay $${price.toFixed(2)} (enter email)`;
            const amt = `$${price.toFixed(2)}`;
            if (!paymentMethodReady) {
              if (methodKind === "paypal") return `Pay ${amt} with PayPal`;
              return `Pay ${amt} (finish card details)`;
            }
            if (methodKind === "paypal") return `Pay ${amt} with PayPal`;
            if (methodKind === "venmo") return `Pay ${amt} with Venmo`;
            if (methodKind === "applePay") return `Pay ${amt} with Apple Pay`;
            if (methodKind === "googlePay") return `Pay ${amt} with Google Pay`;
            return `Pay ${amt} with card`;
          })()}
        </button>

        <div className="font-mono text-[9px] text-zinc-600 text-center leading-relaxed">
          Payments by Braintree (a PayPal company). Cards processed in
          Braintree&apos;s PCI-compliant iframe — we never see your card data.
        </div>
      </form>
    </div>
  );
};

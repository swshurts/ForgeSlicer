import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Check, Loader2, CreditCard, AlertCircle } from "lucide-react";
import { API } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import UserMenu from "./UserMenu";
import BraintreeDialog from "./BraintreeDialog";

/**
 * Pricing page.
 *
 * Single source of truth for package data is the BACKEND (`/api/billing/packages`)
 * so the displayed prices can NEVER drift from what's charged at checkout.
 *
 * Flow (iter-98 — Braintree replaces the Stripe redirect):
 *  1. User clicks Upgrade on a tier → BraintreeDialog opens.
 *  2. Dialog fetches a client token, mounts Drop-in (PayPal + Venmo + cards).
 *  3. On submit, dialog POSTs the nonce to /api/billing/braintree/checkout.
 *  4. Backend charges + grants the tier in one round-trip; on success
 *     we refresh the user from AuthContext so the UI reflects the new tier.
 *
 * The old Stripe path (/api/billing/checkout → hosted redirect) is still
 * mounted server-side so historical session_ids in /billing/success keep
 * resolving — but no UI on this page kicks off a new Stripe session.
 */
export default function PricingPage() {
  const { user, refresh: refreshAuth } = useAuth();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Iter-98 — the Braintree dialog runs in-app, not as a hard redirect,
  // so we track which package the user picked and surface a single
  // dialog instance for it.
  const [selectedPkg, setSelectedPkg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/billing/packages`);
        if (!cancelled) setPackages(r.data || []);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.detail || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCheckout = (pkg) => {
    setError("");
    setSelectedPkg(pkg);
  };

  const handleSuccess = async () => {
    // Backend already flipped the tier; pull the fresh user record so
    // the "Current plan" pip lights up immediately.
    try { await refreshAuth?.(); } catch { /* noop */ }
  };

  const currentTier = user?.subscription_tier || "free";

  return (
    <div className="min-h-screen bg-slate-950 text-white" data-testid="pricing-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/" className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Home</span>
        </Link>
        <div className="flex-1" />
        <Link to="/" className="flex items-center gap-2 select-none">
          <img src="/forgeslicer-logo.webp" alt="ForgeSlicer" width={28} height={28} className="rounded shadow-lg shadow-orange-900/30" />
          <span className="text-sm font-bold tracking-tight">ForgeSlicer</span>
        </Link>
        <UserMenu returnPath="/pricing" />
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">Plans &amp; Pricing</h1>
          <p className="text-slate-400 text-sm mt-3 max-w-lg mx-auto">
            Free for hobbyists. Upgrade when you want more AI generations, commercial-use licenses, or bigger projects. One-year billing — cancel any time before renewal.
          </p>
          {!user && (
            <div className="text-amber-300 text-xs mt-4 flex items-center justify-center gap-1.5">
              <AlertCircle size={12} /> Sign in first so we can grant your tier the moment payment succeeds.
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-300 text-sm rounded-lg p-3 mb-6" data-testid="pricing-error">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 size={28} className="text-orange-400 animate-spin" /></div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-4" data-testid="pricing-grid">
            {/* Free tier — always rendered first */}
            <PlanCard
              id="free"
              name="Free"
              price="$0"
              period="forever"
              perks={[
                "Unlimited slicing + STL/3MF export",
                "10 AI generations / month",
                "Unlimited public designs",
                "Manifold ✓ watertight booleans",
              ]}
              current={currentTier === "free"}
              ctaLabel={currentTier === "free" ? "Current plan" : "Downgrade not supported"}
              disabled
            />
            {packages.map((p) => (
              <PlanCard
                key={p.id}
                id={p.id}
                name={p.name}
                price={`$${Math.floor(p.amount)}`}
                period="per year"
                perks={p.perks}
                current={currentTier === p.id}
                ctaLabel={currentTier === p.id ? "Current plan" : (user ? `Upgrade to ${p.name}` : "Sign in to upgrade")}
                disabled={!user || currentTier === p.id}
                busy={false}
                onClick={() => handleCheckout(p)}
              />
            ))}
          </div>
        )}

        <p className="text-[10px] text-slate-500 text-center mt-10">
          Payments processed by Braintree (a PayPal company). Pay with PayPal, Venmo, or any major card. We never see your card details. You&apos;ll receive a receipt by email after every charge.
        </p>
      </main>

      {/* Iter-98 — Braintree Drop-in checkout dialog. Mounts when a
          package is selected; teardown is automatic on close. */}
      <BraintreeDialog
        open={!!selectedPkg}
        onClose={() => setSelectedPkg(null)}
        packageId={selectedPkg?.id}
        packageName={selectedPkg?.name}
        amountDisplay={selectedPkg ? `$${Math.floor(selectedPkg.amount)} / yr` : ""}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

function PlanCard({ id, name, price, period, perks, current, ctaLabel, disabled, busy, onClick }) {
  const accent = id === "pro" ? "border-orange-500/60 bg-orange-500/5" : id === "maker" ? "border-cyan-500/40 bg-cyan-500/5" : "border-slate-800 bg-slate-900";
  return (
    <div
      data-testid={`pricing-card-${id}`}
      className={`rounded-xl border ${accent} p-6 flex flex-col gap-4 ${current ? "ring-2 ring-emerald-500/40" : ""}`}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold tracking-tight">{name}</h2>
        {current && (
          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
            Active
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-4xl font-extrabold">{price}</span>
        <span className="text-xs text-slate-500">{period}</span>
      </div>
      <ul className="flex flex-col gap-1.5 flex-1">
        {perks.map((perk, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-slate-300 leading-snug">
            <Check size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>
      <button
        data-testid={`pricing-cta-${id}`}
        onClick={onClick}
        disabled={disabled}
        className={`h-10 px-4 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
          current ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 cursor-default" :
          disabled ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed" :
          "bg-orange-500 hover:bg-orange-600 text-white"
        }`}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : (id !== "free" && !current && !disabled && <CreditCard size={14} />)}
        {ctaLabel}
      </button>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Check, Loader2, CreditCard, AlertCircle } from "lucide-react";
import { API } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import UserMenu from "./UserMenu";

/**
 * Pricing page.
 *
 * Single source of truth for package data is the BACKEND (`/api/billing/packages`)
 * so the displayed prices can NEVER drift from what's charged at checkout.
 *
 * Flow:
 *  1. User clicks Upgrade on a tier → POST /api/billing/checkout
 *  2. Backend creates a Stripe session, persists a payment_transactions
 *     row with status "initiated", returns a checkout URL.
 *  3. Frontend hard-redirects to Stripe's hosted checkout.
 *  4. After success, Stripe redirects back to /billing/success?session_id=...
 *     which polls /api/billing/status/{session_id} until paid.
 */
export default function PricingPage() {
  const { user } = useAuth();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyPkg, setBusyPkg] = useState(null);
  const [error, setError] = useState("");

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

  const handleCheckout = async (pkgId) => {
    setError(""); setBusyPkg(pkgId);
    try {
      const r = await axios.post(
        `${API}/billing/checkout`,
        { package_id: pkgId, origin_url: window.location.origin },
        { withCredentials: true },
      );
      window.location.href = r.data.url;
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
      setBusyPkg(null);
    }
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
                disabled={!user || currentTier === p.id || busyPkg !== null}
                busy={busyPkg === p.id}
                onClick={() => handleCheckout(p.id)}
              />
            ))}
          </div>
        )}

        <p className="text-[10px] text-slate-500 text-center mt-10">
          Payments processed by Stripe. We never see your card details. You'll receive a receipt by email after every charge.
        </p>
      </main>
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

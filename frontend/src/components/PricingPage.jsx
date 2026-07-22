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

  const currentTier = user ? (user.effective_tier || user.subscription_tier || "free") : null;
  const isTrial = !!user?.is_trial;
  const trialExpires = user?.trial_expires_at;
  const trialDaysLeft = (() => {
    if (!isTrial || !trialExpires) return null;
    const days = Math.ceil((new Date(trialExpires) - Date.now()) / 86400000);
    return days > 0 ? days : null;
  })();

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
          <p className="text-slate-400 text-sm mt-3 max-w-xl mx-auto">
            Free for hobbyists. Upgrade when you want AI generations, multi-plate export, commercial-use licensing, or shared projects. One-year billing — cancel any time before renewal.
          </p>
          {trialDaysLeft != null && (
            <div
              data-testid="pricing-trial-banner"
              className="mt-4 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs font-semibold rounded-full px-4 py-1.5"
            >
              <Check size={12} /> Studio trial — {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left. Convert any time to keep unlimited AI.
            </div>
          )}
          {!user && (
            <div className="text-amber-300 text-xs mt-4 flex items-center justify-center gap-1.5">
              <AlertCircle size={12} /> Sign in first — new accounts get a free 14-day Studio trial.
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
                "Manifold ✓ watertight booleans",
                "Public + private designs",
                "Browse the marketplace + import presets",
                "AI 3D generation not included",
              ]}
              current={currentTier === "free"}
              ctaLabel={currentTier === "free" ? "Current plan" : "Downgrade not supported"}
              disabled
            />
            {packages.map((p) => {
              const early = p.early && p.early.active ? p.early : null;
              return (
                <PlanCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  price={`$${Math.floor(p.effective_amount ?? p.amount)}`}
                  strikePrice={early ? `$${Math.floor(p.amount)}` : null}
                  earlyNote={early ? `Early adopter — ${early.remaining} of ${early.limit} spots left` : null}
                  period="per year"
                  perks={p.perks}
                  current={currentTier === p.id}
                  ctaLabel={currentTier === p.id ? "Current plan" : (user ? `Upgrade to ${p.name}` : "Sign in to upgrade")}
                  disabled={!user || currentTier === p.id}
                  busy={false}
                  onClick={() => handleCheckout(p)}
                />
              );
            })}
          </div>
        )}

        {/* Iter-151.26 — At-a-glance feature matrix. Values are hard-
            coded here rather than sourced from the API so admins can
            edit perk copy in the catalog without breaking the matrix
            alignment. Keep in sync with pricing.py + tier gates. */}
        <div className="mt-14" data-testid="pricing-matrix">
          <h2 className="text-xl font-bold text-center mb-6">What's in each plan</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-300">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Feature</th>
                  <th className="text-center px-4 py-3 font-semibold">Free</th>
                  <th className="text-center px-4 py-3 font-semibold text-cyan-300">Maker</th>
                  <th className="text-center px-4 py-3 font-semibold text-orange-300">Studio</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {[
                  ["Slicing, STL/3MF export, manifold booleans", "✓", "✓", "✓"],
                  ["Public + private designs", "✓", "✓", "✓"],
                  ["Browse marketplace + import Print-Shop presets", "✓", "✓", "✓"],
                  ["AI 3D generation (fal.ai Hunyuan3D)", "—", "25 / mo", "Unlimited"],
                  ["AI 3D generation (Meshy on our key)", "—", "—", "100 / mo"],
                  ["Bring your own Meshy key (unlimited)", "✓", "✓", "✓"],
                  ["Multi-plate 3MF export (Bambu / Elegoo / Flashforge)", "✓", "✓", "✓"],
                  ["Cooperative projects + version history", "✓", "✓", "✓"],
                  ["Publish your own Print-Shop presets", "—", "✓", "✓"],
                  ["Marketplace publishing + PayPal payouts", "—", "✓", "✓"],
                  ["Commercial-use license badge on listings", "—", "—", "✓"],
                  ["1080p turntable thumbnails", "—", "—", "✓"],
                  ["Priority email support", "—", "—", "✓"],
                ].map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-slate-950" : "bg-slate-900/40"}>
                    <td className="px-4 py-2.5">{row[0]}</td>
                    {row.slice(1).map((cell, j) => (
                      <td
                        key={j}
                        className={`text-center px-4 py-2.5 font-mono text-xs ${
                          cell === "—" ? "text-slate-600" :
                          cell === "✓" ? "text-emerald-400" :
                          "text-amber-300 font-semibold"
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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
        amountDisplay={selectedPkg ? `$${Math.floor(selectedPkg.effective_amount ?? selectedPkg.amount)} / yr` : ""}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

function PlanCard({ id, name, price, strikePrice, earlyNote, period, perks, current, ctaLabel, disabled, busy, onClick }) {
  const accent =
    id === "studio" || id === "pro" ? "border-orange-500/60 bg-orange-500/5" :
    id === "maker" ? "border-cyan-500/40 bg-cyan-500/5" :
    "border-slate-800 bg-slate-900";
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
        {strikePrice && (
          <span className="text-lg text-slate-500 line-through font-semibold" data-testid={`pricing-strike-${id}`}>{strikePrice}</span>
        )}
        <span className="text-xs text-slate-500">{period}</span>
      </div>
      {earlyNote && (
        <div
          data-testid={`pricing-early-note-${id}`}
          className="text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1 -mt-2 w-fit"
        >
          {earlyNote}
        </div>
      )}
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

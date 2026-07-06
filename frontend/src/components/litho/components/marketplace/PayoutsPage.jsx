import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  HandCoins,
  Loader2,
  Mail,
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import {
  getPayoutStatus,
  getPayoutTransactions,
  setPaypalEmail,
} from "../../lib/api";

/** /payouts — creator-facing payouts dashboard (PayPal Payouts).
 *  Auth-required. Creator enters PayPal email; we accrue earnings into
 *  a pending balance and dispatch a weekly batch payout every Monday
 *  00:00 UTC once their balance ≥ threshold. */
export const PayoutsPage = () => {
  const { user, loading: authLoading, login } = useAuth();
  const [status, setStatus] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [s, l] = await Promise.all([
        getPayoutStatus(),
        getPayoutTransactions(),
      ]);
      setStatus(s);
      setLedger(l);
      setEmail(s.paypal_email || "");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!user) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSaveEmail = async (e) => {
    e?.preventDefault?.();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const s = await setPaypalEmail(email.trim());
      setStatus(s);
      toast.success("PayPal email saved");
    } catch (err) {
      toast.error(
        err?.response?.data?.detail || "Could not save PayPal email",
      );
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-500 font-mono text-xs">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-6"
        data-testid="payouts-signin-gate"
      >
        <div className="max-w-md text-center space-y-4">
          <h1 className="font-display text-3xl font-black tracking-tight">
            Sign in to manage payouts
          </h1>
          <p className="font-mono text-[11px] text-zinc-500">
            Creator payouts go via PayPal. Sign in so we can store your
            PayPal email and route your share of marketplace sales.
          </p>
          <button
            onClick={login}
            data-testid="payouts-signin-btn"
            className="px-4 py-2 bg-zinc-100 text-zinc-950 font-mono text-[10px] uppercase tracking-[0.18em] font-bold hover:bg-white"
          >
            Sign in to continue
          </button>
          <Link
            to="/litho"
            className="block font-mono text-[10px] text-zinc-500 hover:text-zinc-200 underline mt-4"
          >
            ← Back to studio
          </Link>
        </div>
      </div>
    );
  }

  const hasEmail = !!status?.paypal_email;
  const pending = Number(status?.pending_balance_usd ?? 0);
  const lifetime = Number(status?.lifetime_paid_usd ?? 0);
  const threshold = Number(status?.payout_threshold_usd ?? 1);
  const aboveThreshold = pending >= threshold;
  const mode = status?.mode || "mock";

  return (
    <div
      className="min-h-screen bg-zinc-950 text-zinc-100"
      data-testid="payouts-page"
    >
      <div className="max-w-5xl mx-auto px-5 py-10 space-y-10">
        <header className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
              Creator
            </div>
            <h1 className="font-display text-4xl font-black tracking-tight">
              Payouts
            </h1>
            <p className="font-mono text-[11px] text-zinc-500 mt-2 max-w-xl">
              Earnings accumulate into your pending balance and ship
              every Monday 00:00 UTC once your balance reaches{" "}
              <strong className="text-zinc-300">${threshold.toFixed(2)}</strong>.
              {mode === "mock" && (
                <span className="ml-2 text-amber-300">
                  · Sandbox/mock mode
                </span>
              )}
            </p>
          </div>
          <Link
            to="/litho"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 hover:text-zinc-100 border border-zinc-800 hover:border-zinc-500 px-3 py-2 transition-colors"
          >
            Studio →
          </Link>
        </header>

        {/* PayPal email card */}
        <section
          className="border border-zinc-800 p-6 space-y-4"
          data-testid="paypal-email-card"
        >
          <div className="flex items-center gap-2">
            {hasEmail ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            )}
            <span className="font-display text-xl font-bold">
              {hasEmail ? "PayPal connected" : "Connect PayPal"}
            </span>
          </div>
          <p className="font-mono text-[11px] text-zinc-500 max-w-2xl leading-relaxed">
            Enter the email address associated with your PayPal account.
            PayPal will receive your batched payout — if you don&apos;t yet
            have a PayPal account at that email, PayPal will email you
            an invitation to claim the funds. Platform fee:{" "}
            <strong className="text-zinc-300">6%</strong>; you receive{" "}
            <strong className="text-zinc-300">94%</strong> of each sale.
          </p>
          <form
            onSubmit={handleSaveEmail}
            className="flex items-center gap-2 max-w-md"
          >
            <div className="relative flex-1">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="email"
                required
                placeholder="you@paypal.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="paypal-email-input"
                className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-zinc-500 focus:outline-none font-mono text-[12px] text-zinc-100"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !email.trim()}
              data-testid="paypal-email-save"
              className="px-4 py-2 bg-zinc-100 text-zinc-950 font-mono text-[10px] uppercase tracking-[0.18em] font-bold hover:bg-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
            </button>
          </form>
          {hasEmail && (
            <div className="font-mono text-[10px] text-zinc-600">
              Current · {status.paypal_email}
            </div>
          )}
        </section>

        {/* Balance summary */}
        <section className="grid grid-cols-3 gap-3">
          <div
            className={`border p-4 ${
              aboveThreshold ? "border-emerald-900" : "border-zinc-800"
            }`}
            data-testid="pending-balance-card"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">
              Pending balance
            </div>
            <div
              className={`font-display text-3xl font-black tabular-nums ${
                aboveThreshold ? "text-emerald-300" : "text-zinc-100"
              }`}
              data-testid="pending-balance-amount"
            >
              ${pending.toFixed(2)}
            </div>
            <div className="font-mono text-[10px] text-zinc-600 mt-1">
              {hasEmail
                ? aboveThreshold
                  ? "Will ship on next Monday batch"
                  : `Ships at $${threshold.toFixed(2)} threshold`
                : "Connect PayPal to receive"}
            </div>
          </div>
          <div className="border border-zinc-800 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">
              Lifetime paid
            </div>
            <div
              className="font-display text-3xl font-black tabular-nums text-zinc-100"
              data-testid="lifetime-paid-amount"
            >
              ${lifetime.toFixed(2)}
            </div>
          </div>
          <div className="border border-zinc-800 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">
              Payout threshold
            </div>
            <div className="font-display text-3xl font-black tabular-nums text-zinc-500">
              ${threshold.toFixed(2)}
            </div>
          </div>
        </section>

        {/* Recent payouts (PayPal batches) */}
        <section data-testid="payouts-batches">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-3">
            Recent payouts
          </div>
          {!ledger?.payouts?.length ? (
            <div className="font-mono text-[11px] text-zinc-600 border border-dashed border-zinc-800 p-6 text-center">
              No payouts yet. Once a Monday batch runs you&apos;ll see it here.
            </div>
          ) : (
            <div className="border border-zinc-800">
              {ledger.payouts.map((p) => (
                <div
                  key={p.batch_id}
                  className="grid grid-cols-12 gap-3 border-b border-zinc-900 py-3 px-4 font-mono text-[11px]"
                  data-testid={`batch-${p.batch_id}`}
                >
                  <div className="col-span-3 text-zinc-500 truncate">
                    {p.created_at && new Date(p.created_at).toLocaleString()}
                  </div>
                  <div className="col-span-3 truncate text-zinc-400">
                    → {p.paypal_email}
                  </div>
                  <div className="col-span-2 tabular-nums text-zinc-100">
                    ${Number(p.amount_usd).toFixed(2)}
                  </div>
                  <div className="col-span-2 text-zinc-500 uppercase tracking-wider">
                    {p.mode === "mock" ? "MOCK" : p.mode}
                  </div>
                  <div className="col-span-2 text-right">
                    <BatchBadge status={p.item_status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent sales */}
        <section data-testid="payouts-ledger">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-3">
            Recent sales
          </div>
          {!ledger?.transactions?.length && (
            <div className="font-mono text-[11px] text-zinc-600 border border-dashed border-zinc-800 p-6 text-center">
              No sales yet. Once a buyer purchases one of your listings,
              the sale shows up here.
            </div>
          )}
          {ledger?.transactions?.map((t) => (
            <div
              key={t.session_id || t.transaction_id}
              className="grid grid-cols-12 gap-3 border-b border-zinc-900 py-3 font-mono text-[11px]"
              data-testid={`txn-${t.session_id || t.transaction_id}`}
            >
              <div className="col-span-3 text-zinc-500 truncate">
                {t.paid_at && new Date(t.paid_at).toLocaleString()}
              </div>
              <div className="col-span-3 truncate text-zinc-300">
                {t.buyer_email}
              </div>
              <div className="col-span-2 text-zinc-500 tabular-nums">
                ${Number(t.amount_usd).toFixed(2)}
              </div>
              <div className="col-span-2 tabular-nums text-zinc-100">
                ${Number(t.creator_payout_usd).toFixed(2)}
              </div>
              <div className="col-span-2 text-right">
                <PayoutBadge status={t.payout_status} />
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};

const PayoutBadge = ({ status }) => {
  const map = {
    paid: { label: "Paid", cls: "text-emerald-300 border-emerald-900" },
    batched: { label: "Batched", cls: "text-sky-300 border-sky-900" },
    pending: { label: "Pending", cls: "text-amber-300 border-amber-900" },
    failed: { label: "Failed", cls: "text-red-300 border-red-900" },
    unclaimed: { label: "Unclaimed", cls: "text-amber-300 border-amber-900" },
    skipped: { label: "—", cls: "text-zinc-500 border-zinc-800" },
  };
  const cfg = map[status] || map.pending;
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
};

const BatchBadge = ({ status }) => {
  const cls =
    status === "SUCCESS" || status === "SUCCEEDED"
      ? "text-emerald-300 border-emerald-900"
      : status === "FAILED" || status === "RETURNED" || status === "BLOCKED"
        ? "text-red-300 border-red-900"
        : status === "UNCLAIMED"
          ? "text-amber-300 border-amber-900"
          : "text-zinc-400 border-zinc-800";
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] ${cls}`}
    >
      {status || "—"}
    </span>
  );
};

export default PayoutsPage;

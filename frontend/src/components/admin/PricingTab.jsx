import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, DollarSign, Save } from "lucide-react";
import { adminApi } from "../../lib/adminApi";

// Super-admin only pricing editor. Prices are DB-backed (billing_config)
// so saves take effect instantly on the pricing page + both checkout
// providers — no redeploy required. Early-adopter tier: the first
// `early_limit` buyers of a package pay `early_amount` instead.
export default function PricingTab() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const d = await adminApi.getPricing();
      setData(d);
      const f = {};
      for (const [pid, p] of Object.entries(d)) {
        f[pid] = {
          amount: String(p.amount),
          early_amount: p.early_amount != null ? String(p.early_amount) : "",
          early_limit: String(p.early_limit ?? 0),
        };
      }
      setForm(f);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const setField = (pid, key, val) => setForm((f) => ({ ...f, [pid]: { ...f[pid], [key]: val } }));

  const save = async () => {
    const packages = {};
    for (const [pid, f] of Object.entries(form)) {
      const amount = parseFloat(f.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error(`Invalid price for ${pid}`);
        return;
      }
      const entry = { amount };
      const ea = parseFloat(f.early_amount);
      const el = parseInt(f.early_limit, 10);
      if (Number.isFinite(ea) && ea > 0) entry.early_amount = ea;
      if (Number.isFinite(el) && el >= 0) entry.early_limit = el;
      if (entry.early_amount != null && entry.early_amount > amount) {
        toast.error(`Early-adopter price for ${pid} must not exceed the regular price`);
        return;
      }
      packages[pid] = entry;
    }
    setSaving(true);
    try {
      await adminApi.updatePricing(packages);
      toast.success("Pricing saved — live immediately");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 size={24} className="animate-spin text-orange-400" /></div>;
  if (err) return <div className="text-red-400 text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div data-testid="admin-pricing-tab" className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <DollarSign size={16} className="text-emerald-400" />
        <h2 className="text-sm font-bold">Subscription pricing</h2>
      </div>
      <p className="text-[11px] text-slate-500 mb-5">
        Changes apply immediately to the public pricing page and every new checkout (Braintree + Stripe).
        The early-adopter price applies to the first N paid purchases of each tier; once sold out, the regular price kicks in automatically.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {Object.entries(data).map(([pid, p]) => (
          <div key={pid} className="bg-slate-900 border border-slate-800 rounded-lg p-4" data-testid={`pricing-editor-${pid}`}>
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-sm font-bold">{p.name}</span>
              <span className="text-[10px] font-mono text-slate-500">{p.period_days} days / purchase</span>
            </div>

            <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">Yearly price (USD)</label>
            <input
              data-testid={`pricing-amount-${pid}`}
              type="number" min="1" step="1"
              value={form[pid]?.amount ?? ""}
              onChange={(e) => setField(pid, "amount", e.target.value)}
              className="w-full h-9 px-3 mb-3 bg-slate-950 border border-slate-700 rounded text-sm font-mono focus:border-orange-500 outline-none"
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">Early price</label>
                <input
                  data-testid={`pricing-early-amount-${pid}`}
                  type="number" min="1" step="1"
                  value={form[pid]?.early_amount ?? ""}
                  onChange={(e) => setField(pid, "early_amount", e.target.value)}
                  className="w-full h-9 px-3 bg-slate-950 border border-slate-700 rounded text-sm font-mono focus:border-orange-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">Early spots</label>
                <input
                  data-testid={`pricing-early-limit-${pid}`}
                  type="number" min="0" step="1"
                  value={form[pid]?.early_limit ?? ""}
                  onChange={(e) => setField(pid, "early_limit", e.target.value)}
                  className="w-full h-9 px-3 bg-slate-950 border border-slate-700 rounded text-sm font-mono focus:border-orange-500 outline-none"
                />
              </div>
            </div>

            <div className="mt-3 text-[11px] text-slate-500 font-mono" data-testid={`pricing-sold-${pid}`}>
              Sold: {p.sold} · Early spots left: {p.early_remaining}
            </div>
          </div>
        ))}
      </div>

      <button
        data-testid="pricing-save-btn"
        onClick={save}
        disabled={saving}
        className="mt-5 h-9 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded text-sm font-semibold flex items-center gap-2"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save pricing
      </button>
    </div>
  );
}

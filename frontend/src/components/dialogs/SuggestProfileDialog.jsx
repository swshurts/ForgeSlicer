// Iter-90 — community "Suggest a profile" dialog.
//
// Any authenticated user can nominate a printer they'd like the team
// to merge from the SoftFever/OrcaSlicer upstream repo. Loose schema
// (most users don't know GitHub paths): printer name + optional
// vendor + optional URL + notes.
//
// Mounted via window event `forgeslicer:open-suggest-profile` so it
// can be opened from anywhere in the app (slicer popover, settings,
// pricing footer, etc.) without prop-drilling.

import React, { useEffect, useState } from "react";
import { X, Loader2, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { upstreamSuggestionsApi } from "../../lib/api";

export default function SuggestProfileDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState([]);
  const [form, setForm] = useState({
    printer_name: "",
    vendor: "",
    upstream_url: "",
    notes: "",
  });

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setForm({ printer_name: "", vendor: "", upstream_url: "", notes: "" });
      // Pre-fetch user's prior suggestions so the dialog shows their
      // running thread with the admin team. Failure here is fine —
      // the user can still submit a new one.
      upstreamSuggestionsApi.mine().then(setMine).catch(() => setMine([]));
    };
    window.addEventListener("forgeslicer:open-suggest-profile", handler);
    return () => window.removeEventListener("forgeslicer:open-suggest-profile", handler);
  }, []);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.printer_name || form.printer_name.trim().length < 2) {
      toast.warning("Please enter a printer name.");
      return;
    }
    setBusy(true);
    try {
      await upstreamSuggestionsApi.submit({
        printer_name: form.printer_name.trim(),
        vendor: form.vendor.trim() || undefined,
        upstream_url: form.upstream_url.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success("Thanks! Your suggestion is in the admin queue.");
      setForm({ printer_name: "", vendor: "", upstream_url: "", notes: "" });
      const latest = await upstreamSuggestionsApi.mine().catch(() => []);
      setMine(latest);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err.message;
      if (status === 401) {
        toast.error("Sign in to suggest a profile.");
      } else if (status === 429) {
        toast.error(detail || "Too many open suggestions.");
      } else {
        toast.error(`Couldn't submit: ${detail}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="suggest-profile-dialog"
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-orange-400" />
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Suggest a printer profile</h2>
              <div className="text-[10px] text-slate-500 leading-tight">Nominate a model from SoftFever / OrcaSlicer upstream</div>
            </div>
          </div>
          <button onClick={() => setOpen(false)} data-testid="suggest-profile-close" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <form onSubmit={handleSubmit} className="space-y-3" data-testid="suggest-profile-form">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-400">Printer name *</label>
              <input
                data-testid="suggest-profile-name"
                type="text"
                value={form.printer_name}
                onChange={(e) => setForm({ ...form, printer_name: e.target.value })}
                maxLength={140}
                placeholder="e.g. Bambu Lab P1S, Voron 2.4 350"
                className="mt-1 w-full h-9 bg-slate-950 border border-slate-700 focus:border-orange-500 rounded text-sm text-white px-3 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-400">Vendor (optional)</label>
                <input
                  data-testid="suggest-profile-vendor"
                  type="text"
                  value={form.vendor}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                  maxLength={80}
                  placeholder="Bambu, Voron, Creality…"
                  className="mt-1 w-full h-9 bg-slate-950 border border-slate-700 focus:border-orange-500 rounded text-sm text-white px-3 outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-400">GitHub link (optional)</label>
                <input
                  data-testid="suggest-profile-url"
                  type="url"
                  value={form.upstream_url}
                  onChange={(e) => setForm({ ...form, upstream_url: e.target.value })}
                  maxLength={400}
                  placeholder="https://github.com/SoftFever/…"
                  className="mt-1 w-full h-9 bg-slate-950 border border-slate-700 focus:border-orange-500 rounded text-sm text-white px-3 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-400">Notes (optional)</label>
              <textarea
                data-testid="suggest-profile-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                maxLength={1000}
                rows={3}
                placeholder="Anything else the team should know — variants, accessories, why it matters…"
                className="mt-1 w-full bg-slate-950 border border-slate-700 focus:border-orange-500 rounded text-sm text-white px-3 py-2 outline-none resize-none"
              />
            </div>
            <button
              type="submit"
              data-testid="suggest-profile-submit"
              disabled={busy || form.printer_name.trim().length < 2}
              className="w-full h-10 bg-orange-500 hover:bg-orange-400 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? <><Loader2 size={13} className="animate-spin" /> Submitting…</> : "Submit suggestion"}
            </button>
            <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              You can have up to 5 open suggestions at a time. Admins review the queue weekly and respond by email when one's merged or rejected.
            </p>
          </form>

          {mine.length > 0 && (
            <div className="pt-3 border-t border-slate-800 space-y-2" data-testid="suggest-profile-mine">
              <h3 className="text-[10px] uppercase tracking-wider text-slate-400">Your past suggestions</h3>
              <ul className="space-y-1.5">
                {mine.slice(0, 8).map((s) => {
                  const status = s.status || "open";
                  const accent = status === "resolved"
                    ? "border-emerald-500/40 text-emerald-200"
                    : status === "rejected"
                    ? "border-slate-600 text-slate-400"
                    : "border-amber-500/40 text-amber-200";
                  return (
                    <li key={s.id} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${accent}`}>
                          {status}
                        </span>
                        <span className="font-mono text-slate-200 truncate">{s.printer_name}</span>
                        {s.vendor && <span className="text-[10px] text-slate-500">· {s.vendor}</span>}
                      </div>
                      {s.resolution_notes && (
                        <div className="mt-1 text-[10px] text-slate-400 italic flex items-start gap-1">
                          <CheckCircle2 size={10} className="mt-0.5 shrink-0 text-emerald-400" />
                          {s.resolution_notes}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

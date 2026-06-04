import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { authApi } from "../lib/auth";
import {
  Hexagon, ArrowLeft, Loader2, AlertCircle, CheckCircle2, Mail,
} from "lucide-react";

function errMsg(detail, fallback = "Something went wrong.") {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : null)).filter(Boolean).join(" ") || fallback;
  }
  return fallback;
}

export default function ForgotPassword() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const returnPath = params.get("return") || "/workspace";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const clean = (email || "").trim().toLowerCase();
      await authApi.forgotPassword(clean);
      setSent(true);
    } catch (err) {
      setError(errMsg(err?.response?.data?.detail, err.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col" data-testid="forgot-password-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to={`/signin?return=${encodeURIComponent(returnPath)}`} className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Back to sign in</span>
        </Link>
        <div className="flex-1" />
        <Link to="/" className="flex items-center gap-2 select-none">
          <img src="/forgeslicer-logo.webp" alt="ForgeSlicer" width={28} height={28} className="rounded shadow-lg shadow-orange-900/30" />
          <span className="text-sm font-bold tracking-tight">ForgeSlicer</span>
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg p-7">
          <div className="text-center mb-5">
            <div className="w-11 h-11 mx-auto rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center mb-3">
              <Mail size={20} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
            <p className="text-xs text-slate-400 mt-1">Enter your email and we'll send a link to set a new password.</p>
          </div>

          {sent ? (
            <div className="space-y-3" data-testid="forgot-password-sent">
              <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/40 rounded text-xs text-emerald-300 p-3">
                <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
                <span>If an account exists for <strong>{email}</strong>, we just sent a reset link. It expires in 60 minutes.</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Check your inbox (and spam folder). The link can only be used once.
              </p>
              <Link
                data-testid="forgot-password-back-link"
                to={`/signin?return=${encodeURIComponent(returnPath)}`}
                className="block text-center mt-3 text-xs text-slate-400 hover:text-orange-400"
              >← Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3" data-testid="forgot-password-form">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Email</label>
                <input
                  data-testid="forgot-password-email-input"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-300 p-2" data-testid="forgot-password-error">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <button
                data-testid="forgot-password-submit"
                type="submit"
                disabled={busy}
                className="w-full h-10 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold rounded flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                Send reset link
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

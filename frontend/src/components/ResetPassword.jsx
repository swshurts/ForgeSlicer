import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { authApi } from "../lib/auth";
import { toast } from "sonner";
import {
  Hexagon, ArrowLeft, Loader2, AlertCircle, KeyRound,
} from "lucide-react";

function errMsg(detail, fallback = "Something went wrong.") {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : null)).filter(Boolean).join(" ") || fallback;
  }
  return fallback;
}

export default function ResetPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const params = new URLSearchParams(location.search);
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match."); return;
    }
    if (!token) { setError("Missing reset token."); return; }
    setBusy(true); setError("");
    try {
      const user = await authApi.resetPassword({ token, new_password: password });
      setUser(user);
      toast.success("Password updated — you're signed in.");
      navigate("/workspace", { replace: true });
    } catch (err) {
      setError(errMsg(err?.response?.data?.detail, err.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col" data-testid="reset-password-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/signin" className="flex items-center gap-2 text-slate-400 hover:text-white">
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
              <KeyRound size={20} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Choose a new password</h1>
            <p className="text-xs text-slate-400 mt-1">You'll be signed in once your password is set.</p>
          </div>
          {!token && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-300 p-2 mb-3" data-testid="reset-no-token">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>This link is missing the reset token. Please request a fresh reset email.</span>
            </div>
          )}
          <form onSubmit={submit} className="space-y-3" data-testid="reset-password-form">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">New password</label>
              <input
                data-testid="reset-password-input"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">At least 8 characters with a letter and a number.</p>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Confirm password</label>
              <input
                data-testid="reset-password-confirm-input"
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full h-10 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-300 p-2" data-testid="reset-password-error">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button
              data-testid="reset-password-submit"
              type="submit"
              disabled={busy || !token}
              className="w-full h-10 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              Update password & sign in
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

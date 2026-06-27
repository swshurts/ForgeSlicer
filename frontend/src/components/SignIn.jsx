import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { authApi, startLogin } from "../lib/auth";
import { API } from "../lib/api";
import { toast } from "sonner";
import {
  Hexagon, ArrowLeft, Loader2, Mail, KeyRound, Wand2,
  AlertCircle, CheckCircle2, LogIn, AlertTriangle,
} from "lucide-react";

// Normalize email client-side so trivial typos (trailing spaces, mixed
// case) don't get rejected by Pydantic's strict EmailStr validator with
// the unhelpful generic "value is not a valid email address" message.
function normalizeEmail(s) {
  return (s || "").trim().toLowerCase();
}

// Banner the SignIn page renders above the magic-link form when our last
// Resend attempt failed (key rotated, sandbox limit hit, etc.). Without
// this, users get a "we sent the link" success message and stare at an
// empty inbox forever.
function EmailHealthBanner({ status }) {
  if (!status || status.healthy) return null;
  return (
    <div
      data-testid="email-health-banner"
      className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/40 rounded text-xs text-amber-200 p-2 mb-3"
    >
      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
      <span>
        <strong>Email delivery is degraded right now.</strong> {status.message || "Try Google sign-in or email + password instead."}
      </span>
    </div>
  );
}

// FastAPI 422 returns {detail: [{msg, loc, ...}]} — flatten to a string so
// React can render it. Plain-string detail (our 400/401/409) passes through.
function errMsg(detail, fallback = "Something went wrong. Please try again.") {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : null))
      .filter(Boolean)
      .join(" ") || fallback;
  }
  if (typeof detail === "object" && typeof detail.msg === "string") return detail.msg;
  return fallback;
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div
      data-testid="signin-error"
      className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-300 p-2"
    >
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SuccessBanner({ message }) {
  if (!message) return null;
  return (
    <div
      data-testid="signin-success"
      className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/40 rounded text-xs text-emerald-300 p-2"
    >
      <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ---------- Tab: Email + Password ----------
function PasswordTab({ mode, setMode, returnPath, onSuccess }) {
  // mode: "login" | "register"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const cleanEmail = normalizeEmail(email);
      const user = mode === "register"
        ? await authApi.register({ name: name.trim(), email: cleanEmail, password })
        : await authApi.login({ email: cleanEmail, password });
      onSuccess(user);
    } catch (err) {
      setError(errMsg(err?.response?.data?.detail, err.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="password-form">
      {mode === "register" && (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Display name</label>
          <input
            data-testid="signin-name-input"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="How should we credit your designs?"
            className="w-full h-10 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none"
          />
        </div>
      )}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Email</label>
        <input
          data-testid="signin-email-input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full h-10 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none"
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Password</label>
        <input
          data-testid="signin-password-input"
          type="password"
          required
          minLength={mode === "register" ? 8 : 1}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full h-10 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none"
        />
        {mode === "register" && (
          <p className="text-[10px] text-slate-500 mt-1">At least 8 characters with a letter and a number.</p>
        )}
      </div>
      <ErrorBanner message={error} />
      <button
        data-testid={mode === "register" ? "signin-register-submit" : "signin-login-submit"}
        type="submit"
        disabled={busy}
        className="w-full h-10 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
        {mode === "register" ? "Create account" : "Sign in"}
      </button>
      <div className="flex items-center justify-between text-[11px]">
        {mode === "login" ? (
          <>
            <button
              type="button"
              data-testid="signin-switch-register"
              onClick={() => { setMode("register"); setError(""); }}
              className="text-slate-400 hover:text-orange-400"
            >New here? Create an account →</button>
            <Link
              data-testid="signin-forgot-link"
              to={`/forgot-password?return=${encodeURIComponent(returnPath)}`}
              className="text-slate-400 hover:text-orange-400"
            >Forgot password?</Link>
          </>
        ) : (
          <button
            type="button"
            data-testid="signin-switch-login"
            onClick={() => { setMode("login"); setError(""); }}
            className="text-slate-400 hover:text-orange-400"
          >Already have an account? Sign in →</button>
        )}
      </div>
    </form>
  );
}

// ---------- Tab: Magic Link ----------
function MagicLinkTab({ emailHealth }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await authApi.requestMagicLink(normalizeEmail(email));
      setSent(true);
    } catch (err) {
      setError(errMsg(err?.response?.data?.detail, err.message));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-3" data-testid="magic-link-sent">
        <SuccessBanner message={`If an account exists for ${email}, we just sent a sign-in link. It expires in 15 minutes.`} />
        <p className="text-xs text-slate-400 leading-relaxed">
          Check your inbox (and spam folder) and click the button in the email. The link can only be used once.
        </p>
        <button
          data-testid="magic-link-send-another"
          onClick={() => { setSent(false); setEmail(""); }}
          className="w-full h-9 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded border border-slate-700"
        >Send to a different email</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="magic-link-form">
      <EmailHealthBanner status={emailHealth} />
      <p className="text-xs text-slate-400 leading-relaxed">
        We'll email you a one-time sign-in link — no password required.
      </p>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Email</label>
        <input
          data-testid="magic-link-email-input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full h-10 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none"
        />
      </div>
      <ErrorBanner message={error} />
      <button
        data-testid="magic-link-submit"
        type="submit"
        disabled={busy}
        className="w-full h-10 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold rounded flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
        Email me a sign-in link
      </button>
    </form>
  );
}

// ---------- Tab: Google ----------
function GoogleTab({ returnPath }) {
  return (
    <div className="space-y-3" data-testid="google-tab">
      <p className="text-xs text-slate-400 leading-relaxed">
        Use your existing Google account — no password to remember. We only read your name, email, and profile picture.
      </p>
      <button
        data-testid="signin-google-btn"
        onClick={() => startLogin(returnPath)}
        className="w-full h-10 bg-white hover:bg-slate-100 text-slate-900 text-sm font-semibold rounded flex items-center justify-center gap-2"
      >
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.3 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.4 1 7.4 2.7l5.7-5.7C33.5 6.6 28.9 5 24 5 12.4 5 3 14.4 3 26s9.4 21 21 21 21-9.4 21-21c0-1.9-.2-3.7-.4-5.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c2.8 0 5.4 1 7.4 2.7l5.7-5.7C33.5 6.6 28.9 5 24 5 16.3 5 9.7 9.1 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 47c4.9 0 9.4-1.6 12.8-4.4l-5.9-5C29 39.2 26.6 40 24 40c-5.3 0-9.7-2.7-11.3-7l-6.6 5.1C9.6 43 16.2 47 24 47z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.6l5.9 5c-.4.3 6.8-5 6.8-12.6 0-1.9-.2-3.7-.4-5.5z"/>
        </svg>
        Continue with Google
      </button>
    </div>
  );
}

// ---------- Page shell ----------
export default function SignIn() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  // Default post-auth destination is the landing page (not the editor).
  // Flows that need to come back to a specific surface (e.g. the "sign in
  // to save your work" prompt from Workspace) pass `?return=/workspace`
  // explicitly, so they keep working.
  const returnPath = params.get("return") || "/";
  const initialMode = params.get("mode") === "register" ? "register" : "login";
  const [tab, setTab] = useState(params.get("tab") || "password");
  const [pwMode, setPwMode] = useState(initialMode);
  const [emailHealth, setEmailHealth] = useState(null);

  useEffect(() => {
    // Fire-and-forget — if it fails the banner just doesn't show. Better
    // to keep the page snappy than block on a status check.
    axios.get(`${API}/auth/email-status`)
      .then((r) => setEmailHealth(r.data))
      .catch(() => setEmailHealth(null));
  }, []);

  const onSuccess = (user) => {
    setUser(user);
    toast.success(`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}!`);
    navigate(returnPath, { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col" data-testid="signin-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/" className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Home</span>
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
              <LogIn size={20} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in to ForgeSlicer</h1>
            <p className="text-xs text-slate-400 mt-1">Choose any method — your account is the same either way.</p>
          </div>

          {/* Tab strip */}
          <div className="grid grid-cols-3 gap-1 bg-slate-950 border border-slate-800 rounded p-1 mb-5">
            {[
              { key: "password", icon: KeyRound, label: "Email" },
              { key: "magic",    icon: Wand2,    label: "Magic link" },
              { key: "google",   icon: Mail,     label: "Google" },
            ].map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                data-testid={`signin-tab-${key}`}
                onClick={() => setTab(key)}
                className={`h-8 rounded text-[11px] font-semibold flex items-center justify-center gap-1.5 ${
                  tab === key
                    ? "bg-orange-500/20 text-orange-300 border border-orange-500/50"
                    : "text-slate-400 hover:text-white border border-transparent"
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {tab === "password" && (
            <PasswordTab mode={pwMode} setMode={setPwMode} returnPath={returnPath} onSuccess={onSuccess} />
          )}
          {tab === "magic" && <MagicLinkTab emailHealth={emailHealth} />}
          {tab === "google" && <GoogleTab returnPath={returnPath} />}

          <p className="text-[10px] text-slate-500 text-center mt-5 leading-relaxed">
            By signing in you agree to keep things friendly and remix-respectful.
            Profile fields like location and social links are <strong>off by default</strong> and only shared when you tick the box.
          </p>
        </div>
      </main>
    </div>
  );
}

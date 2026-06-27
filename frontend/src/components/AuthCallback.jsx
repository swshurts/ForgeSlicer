import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, popReturnPath } from "../lib/auth";
import { useAuth } from "../contexts/AuthContext";
import { Loader2, AlertCircle, RotateCw, Home } from "lucide-react";

// Handles the OAuth return-leg: extracts `#session_id=...` from the URL
// fragment, exchanges it for a persistent session_token via the backend,
// then navigates the user back to the page they came from (or /workspace).
export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const processed = useRef(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("parsing"); // parsing | exchanging | success

  useEffect(() => {
    // Synchronously guard against StrictMode double-mount, which would
    // otherwise burn the one-shot session_id twice.
    if (processed.current) return;
    processed.current = true;

    const hash = window.location.hash || "";
    const match = hash.match(/session_id=([^&]+)/);
    const sessionId = match ? decodeURIComponent(match[1]) : null;

    // Where to go after auth succeeds — back to the page that triggered the
    // login (gallery / workspace / profile etc.). Pulled from sessionStorage
    // set by startLogin() before the redirect.
    const returnPath = popReturnPath("/");

    // Strip the fragment immediately so a reload won't replay the exchange.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (!sessionId) {
      setError("Missing session_id in callback URL. Try signing in again.");
      return;
    }
    setStage("exchanging");
    (async () => {
      try {
        // eslint-disable-next-line no-console
        console.info("[auth] exchanging session_id with backend…");
        const user = await authApi.exchange(sessionId);
        // Hand the user to AuthProvider authoritatively — do NOT fire a
        // follow-up /auth/me here. The Set-Cookie response header has not
        // always committed to the cookie jar by the time axios fires the
        // next request, and a 401 on /me would clobber the user we just set,
        // causing ProtectedRoute to immediately bounce the user back to the
        // sign-in screen (which looks exactly like "the redirect never came
        // back"). The exchange response is the source of truth.
        setUser(user);
        setStage("success");
        // Pass `user` via location state so ProtectedRoute can trust the
        // brand-new user even if the AuthProvider's state hasn't propagated
        // through context yet (sub-millisecond race in React 18 batching).
        // eslint-disable-next-line no-console
        console.info("[auth] sign-in complete → navigating to", returnPath);
        navigate(returnPath, { replace: true, state: { user } });
      } catch (e) {
        const detail = e?.response?.data?.detail;
        const code = e?.response?.status;
        const msg = detail
          ? `${detail}${code ? ` (HTTP ${code})` : ""}`
          : e?.message || "Sign-in failed";
        // eslint-disable-next-line no-console
        console.error("[auth] exchange failed:", e);
        setError(msg);
      }
    })();
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center" data-testid="auth-callback">
      <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
        {!error ? (
          <>
            <Loader2 size={32} className="mx-auto text-orange-400 animate-spin mb-3" />
            <h2 className="text-base font-semibold">Signing you in…</h2>
            <p className="text-xs text-slate-400 mt-1">
              {stage === "parsing" && "Reading sign-in token…"}
              {stage === "exchanging" && "Establishing your secure session."}
              {stage === "success" && "Welcome — redirecting…"}
            </p>
          </>
        ) : (
          <>
            <AlertCircle size={32} className="mx-auto text-red-400 mb-3" />
            <h2 className="text-base font-semibold">Sign-in failed</h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed" data-testid="auth-callback-error">{error}</p>
            <div className="mt-5 flex items-center gap-2 justify-center">
              <button
                data-testid="auth-callback-retry-btn"
                onClick={() => { window.location.href = "/"; }}
                className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700"
              >
                <Home size={14} /> Home
              </button>
              <button
                data-testid="auth-callback-retry-signin-btn"
                onClick={() => {
                  // Same-tab redirect to the login flow again, preserving
                  // whatever returnPath was originally requested.
                  // eslint-disable-next-line no-console
                  console.info("[auth] retrying sign-in");
                  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
                  const redirect = window.location.origin + "/workspace";
                  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
                }}
                className="h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5"
              >
                <RotateCw size={14} /> Try again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

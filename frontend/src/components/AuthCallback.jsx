import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../lib/auth";
import { useAuth } from "../contexts/AuthContext";
import { Loader2, AlertCircle } from "lucide-react";

// Handles the OAuth return-leg: extracts `#session_id=...` from the URL
// fragment, exchanges it for a persistent session_token via the backend,
// then navigates to the post-login destination.
export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const processed = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Synchronously guard against StrictMode double-mount, which would
    // otherwise burn the one-shot session_id twice.
    if (processed.current) return;
    processed.current = true;

    const hash = window.location.hash || "";
    const match = hash.match(/session_id=([^&]+)/);
    const sessionId = match ? decodeURIComponent(match[1]) : null;

    // Strip the fragment immediately so a reload won't replay the exchange.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (!sessionId) {
      setError("Missing session_id in callback URL.");
      return;
    }
    (async () => {
      try {
        const user = await authApi.exchange(sessionId);
        setUser(user);
        navigate("/workspace", { replace: true, state: { user } });
      } catch (e) {
        setError(e?.response?.data?.detail || e.message || "Sign-in failed");
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
            <p className="text-xs text-slate-400 mt-1">Establishing your secure session.</p>
          </>
        ) : (
          <>
            <AlertCircle size={32} className="mx-auto text-red-400 mb-3" />
            <h2 className="text-base font-semibold">Sign-in failed</h2>
            <p className="text-xs text-slate-400 mt-1">{error}</p>
            <button
              data-testid="auth-callback-retry-btn"
              onClick={() => navigate("/", { replace: true })}
              className="mt-4 h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded"
            >
              Back to home
            </button>
          </>
        )}
      </div>
    </div>
  );
}

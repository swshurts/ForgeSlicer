// Iter-99.2 — Inbound SSO handoff receiver.
//
// Counterpart to `lib/ssoHandoff.js`. When LithoForge redirects a user
// to `https://forgeslicer.com/auth/sso-accept?token=<JWT>&return=/`,
// THIS page runs. It POSTs the token to ForgeSlicer's OWN
// `/api/auth/sso-bridge` endpoint (same-origin so the Set-Cookie lands
// as a first-party cookie — no partitioning, no Firefox/Safari blocks),
// strips the token from the URL so it doesn't end up in browser
// history, and redirects to the requested return path.
//
// On any failure (expired token, bad signature, network error) the
// user is sent to the `/signin` page with a friendly error — so the
// worst case is "one extra click to sign in" rather than a stuck tab.

import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import { API } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

const VALID_RETURN = /^\/[A-Za-z0-9\-_/]*$/;  // protect against open-redirect

export default function SsoAccept() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = params.get("token") || "";
    const ret = params.get("return") || "/";
    const safeReturn = VALID_RETURN.test(ret) ? ret : "/";

    if (!token) {
      queueMicrotask(() => setError("Missing SSO token."));
      return;
    }

    (async () => {
      try {
        const r = await fetch(`${API}/auth/sso-bridge`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Forge-Suite-Token": token },
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || `Sign-in failed (${r.status}).`);
        }
        window.history.replaceState({}, "", safeReturn);
        try { await refresh?.(); } catch { /* noop */ }
        navigate(safeReturn, { replace: true });
      } catch (err) {
        setError(err.message || "Could not sign you in.");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4" data-testid="sso-accept">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
        {!error && (
          <>
            <Loader2 size={28} className="animate-spin text-orange-400 mx-auto mb-4" />
            <h1 className="text-lg font-semibold tracking-tight" data-testid="sso-accept-loading">Signing you in&hellip;</h1>
            <p className="text-xs text-slate-400 mt-2">Bridging your Forge Suite session.</p>
          </>
        )}
        {error && (
          <>
            <AlertCircle size={28} className="text-rose-400 mx-auto mb-4" />
            <h1 className="text-lg font-semibold tracking-tight" data-testid="sso-accept-error">Sign-in failed</h1>
            <p className="text-xs text-slate-400 mt-2">{error}</p>
            <button
              data-testid="sso-accept-fallback"
              onClick={() => navigate("/signin", { replace: true })}
              className="mt-5 h-10 px-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded"
            >
              Sign in manually
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Auth context + helpers wrapping Emergent-managed Google Auth.
//
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
//
// This app is NOT auth-gated — auth is opt-in to sync presets across
// devices. The provider exposes `user` (or `null` for anonymous) plus
// `login()` / `logout()` helpers.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "./api";
// `fanOutSsoBridge` was the silent cross-origin fetch fan-out. It's
// been removed from the login path because browsers (Firefox ETP,
// Safari ITP, Chrome 3p phase-out) partition the resulting Set-Cookie
// into oblivion. The redirect-based `openInPeer()` helper in
// `./ssoHandoff.js` replaces it. Old `./ssoBridge.js` file kept on
// disk for rollback only.

const AuthCtx = createContext({
  user: null,
  loading: true,
  login: () => {},
  logout: async () => {},
  refresh: async () => {},
});

export const useAuth = () => useContext(AuthCtx);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me", { withCredentials: true });
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If we're returning from the OAuth callback, AuthCallback will run
    // /auth/session first; skip /me here so the cookie is set before we
    // poll the server.
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh]);

  const login = useCallback(() => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/";
    window.location.href =
      `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", null, { withCredentials: true });
    } catch {
      /* ignore — local state always wins for UX */
    }
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
};

/** Handles the OAuth return fragment. Mount above the app so it runs
 *  before any /auth/me checks. After a successful session exchange we
 *  refresh the AuthProvider so the UI immediately reflects the signed-
 *  in state without requiring a full page reload (the previous
 *  behavior, which was masked when `/` was the studio because the
 *  studio's first network call would surface the user — now that `/`
 *  is the static landing page nothing was poking auth state). */
export const AuthCallbackHandler = ({ onComplete }) => {
  const { refresh } = useAuth();
  const [processing, setProcessing] = useState(
    () =>
      typeof window !== "undefined" &&
      window.location.hash?.includes("session_id=")
  );
  const hasRun = useRef(false);

  // Hard timeout: if the auth callback hangs for more than 12 seconds
  // (Emergent's auth server unreachable, stale session_id from a tab
  // that was reopened, etc.), force-dismiss so the user can still use
  // the app. The overlay covered the upload zone and never went away.
  useEffect(() => {
    if (!processing) return;
    const t = setTimeout(() => setProcessing(false), 12000);
    return () => clearTimeout(t);
  }, [processing]);

  useEffect(() => {
    if (!processing) return;
    if (hasRun.current) return;
    hasRun.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setProcessing(false);
      return;
    }
    (async () => {
      try {
        await api.post(
          "/auth/session",
          { session_id: sessionId },
          { withCredentials: true, timeout: 10000 }
        );
        // Strip the fragment FIRST — before refresh() — so that any
        // re-render triggered by AuthProvider state updates can never
        // see the session_id hash and accidentally re-fire this
        // callback under StrictMode double-invoke. The browser has
        // already committed the Set-Cookie from the response above,
        // so the upcoming refresh() will carry the new cookie.
        const cleanUrl = window.location.pathname + window.location.search;
        window.history.replaceState({}, document.title, cleanUrl);
        // Pull the just-set cookie into the AuthProvider so the UI
        // updates without a page reload.
        await refresh();
      } catch (err) {
        // Auth-loop bugs in this app have historically been hard to
        // diagnose because the failed exchange happened silently. Log
        // the error so the next regression is debuggable; UX still
        // falls through to anonymous state.
        console.warn("[lithoforge/auth] session exchange failed:", err);
      } finally {
        setProcessing(false);
        if (onComplete) onComplete();
      }
    })();
  }, [processing, onComplete, refresh]);

  if (!processing) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-100"
      data-testid="auth-callback-loader"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-300 animate-pulse">
        Signing you in…
      </div>
      <button
        onClick={() => {
          // Wipe any stale hash so refresh doesn't bring this back.
          const cleanUrl = window.location.pathname + window.location.search;
          window.history.replaceState({}, document.title, cleanUrl);
          setProcessing(false);
        }}
        data-testid="auth-callback-skip"
        className="font-mono text-[10px] uppercase tracking-[0.18em] border border-zinc-700 px-4 py-2 hover:bg-zinc-100 hover:text-zinc-950 transition-colors"
      >
        Skip · continue without signing in
      </button>
    </div>
  );
};

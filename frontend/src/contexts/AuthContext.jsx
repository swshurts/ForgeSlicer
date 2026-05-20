import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authApi } from "../lib/auth";
import { toast } from "sonner";

const AuthContext = createContext({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

// Celebration once per user: when `contributor_lifetime` flips to true (or
// is already true on first sign-in after the milestone was crossed), fire a
// rich sonner toast. We persist a per-user flag in localStorage so the
// celebration doesn't replay on every page load.
const CELEBRATE_KEY = "forge.contributor.celebrated";
function maybeCelebrate(user) {
  if (!user || !user.contributor_lifetime) return;
  try {
    const seen = JSON.parse(window.localStorage.getItem(CELEBRATE_KEY) || "{}");
    if (seen[user.user_id]) return;
    seen[user.user_id] = Date.now();
    window.localStorage.setItem(CELEBRATE_KEY, JSON.stringify(seen));
  } catch {
    // localStorage unavailable (private mode etc) — fall through and still
    // show the toast; worst case the user sees it twice.
  }
  toast.success("🏆 You're a ForgeSlicer Contributor for life!", {
    description: "Thanks for shipping 100+ open-source components and 20+ designs. Free-forever access is now permanent on your account.",
    duration: 12000,
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.me();
      setUser(u);
      maybeCelebrate(u);
      return u;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (err) {
      // Even if the server call fails (e.g. expired session), drop the local
      // user so the UI returns to the anonymous state. Surface the failure
      // so users can retry if they care.
      // eslint-disable-next-line no-console
      console.warn("logout request failed:", err);
    }
    setUser(null);
  }, []);

  useEffect(() => {
    // If a session_id is being processed (returning from OAuth), AuthCallback
    // will set the user. Skip the /me check here to avoid the well-known
    // race: the cookie isn't set until /api/auth/session resolves, so /me
    // would 401 and clobber the in-flight login.
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Wrap setUser so callers (e.g. AuthCallback after a fresh sign-in, or
  // Profile after pulling contributor-status) trigger the celebration check.
  const setUserAndCelebrate = useCallback((u) => {
    setUser(u);
    maybeCelebrate(u);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout, setUser: setUserAndCelebrate }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authApi } from "../lib/auth";

const AuthContext = createContext({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.me();
      setUser(u);
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

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// iter-131 — Bridge to ForgeSlicer's global auth context.
//
// LithoForge originally shipped its own AuthProvider (mounted at app
// root, its own /auth/me polling, its own logout endpoint). After the
// merge we have exactly one source of truth for the signed-in user:
// `@/contexts/AuthContext` in ForgeSlicer. Rather than edit every
// LithoForge component that imports `useAuth` from this file, we
// re-export a compatibility shim that shape-matches the LithoForge
// contract (`{ user, loading, login, logout, refresh }`) but reads
// through to the global provider. This way sign-in state stays
// consistent across `/workspace`, `/litho`, `/litho/marketplace`,
// `/litho/payouts`, etc. — no double-provider surprises.
//
// AuthCallbackHandler is preserved for the LithoStudio page which
// mounted it internally, but it's now a no-op — ForgeSlicer handles
// the OAuth session exchange at its own /auth/callback route so
// LithoForge's fragment handler would double-fire the exchange.

import React from "react";
import { useAuth as useGlobalAuth } from "../../../contexts/AuthContext";

// LithoForge components expect useAuth to return
// `{ user, loading, login, logout, refresh }`. ForgeSlicer's context
// exposes the same shape (plus a few extras like `celebrating`), so we
// just proxy through. Any missing keys are filled with sensible no-ops
// so the LithoForge components don't crash if they touch them.
export function useAuth() {
  const g = useGlobalAuth();
  const login =
    g.login ??
    (() => {
      // Fallback to Emergent Google Auth landing if ForgeSlicer's
      // context is somehow missing a login handler (should never
      // happen). Kept for defensive resilience.
      const redirectUrl = window.location.origin + "/";
      window.location.href =
        "https://auth.emergentagent.com/?redirect=" +
        encodeURIComponent(redirectUrl);
    });
  const logout = g.logout ?? (async () => {});
  const refresh = g.refresh ?? (async () => {});
  return {
    user: g.user ?? null,
    loading: g.loading ?? false,
    login,
    logout,
    refresh,
  };
}

// Kept for import-compatibility with LithoStudio.jsx which mounts
// this handler internally. Renders nothing — ForgeSlicer already
// runs the OAuth callback exchange on /auth/callback.
export const AuthCallbackHandler = () => null;

// AuthProvider is no longer needed (ForgeSlicer's global provider is
// mounted in index.js). Kept as a passthrough so a stale import
// doesn't blow up the tree.
export const AuthProvider = ({ children }) => <>{children}</>;

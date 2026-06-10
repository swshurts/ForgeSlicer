// Iter-99.2 — Redirect-based SSO handoff (replaces the silent fan-out
// approach in `ssoBridge.js` for the user-clickable case).
//
// The silent fan-out works ONLY on browsers that permit cross-site
// cookies. Firefox's Total Cookie Protection, Brave's Shields, Safari's
// ITP, and Chrome's upcoming third-party-cookie phaseout all partition
// the cookies set by `lithoforge.net` during a `forgeslicer.com`-initiated
// fetch into a per-top-site jar — so when the user later visits
// `lithoforge.net` directly, the browser uses the GLOBAL (empty) jar
// and the session cookie isn't there.
//
// The redirect pattern dodges that entire mess:
//
//   1. ForgeSlicer mints a 60 s JWT (existing /sso-bridge/mint endpoint).
//   2. ForgeSlicer's frontend redirects the user to:
//        https://lithoforge.net/auth/sso-accept?token=<JWT>
//   3. The user's browser is NOW on lithoforge.net. LithoForge's
//      sso-accept route POSTs the token SAME-ORIGIN to its own
//      /api/auth/sso-bridge endpoint. The Set-Cookie response lands
//      as a FIRST-PARTY cookie (no partitioning, no browser blocks).
//   4. LithoForge strips ?token= from the URL via history.replaceState
//      and redirects to its home page. User is signed in.
//
// Security properties preserved:
//   - JWT still 60 s TTL — even though it briefly appears in the URL,
//     a leak (referer header, browser history) can't be replayed.
//   - JWT still HS256 + iss-allowlisted — same validation path as the
//     silent bridge.
//   - Same shared FORGE_SUITE_SECRET on both apps.
//
// Tradeoff:
//   - Requires a user click on the SOURCE app ("Open LithoForge" button)
//     instead of being fully silent. We argue this is a UX improvement —
//     users understand what's happening, and the destination tab shows
//     "Signing you in..." for ~500 ms which feels intentional.

import { API } from "./api";

/**
 * Mint a JWT on THIS app and redirect the browser to the peer's
 * `/auth/sso-accept` route. Used by the "Open in LithoForge" /
 * "Continue to Forge Suite" buttons.
 *
 * @param {string} peerOrigin  - e.g. "https://lithoforge.net"
 * @param {string} [returnPath] - Where on the peer to land after sign-in.
 *                                Defaults to "/".
 */
export async function openInPeer(peerOrigin, returnPath = "/") {
  const mintRes = await fetch(`${API}/auth/sso-bridge/mint`, {
    credentials: "include",
  });
  if (!mintRes.ok) {
    // Anonymous user — fall back to just opening the peer's home
    // (the peer will show its own sign-in flow).
    window.open(peerOrigin + returnPath, "_blank");
    return;
  }
  const { token } = await mintRes.json();
  if (!token) {
    window.open(peerOrigin + returnPath, "_blank");
    return;
  }
  const url = new URL(peerOrigin + "/auth/sso-accept");
  url.searchParams.set("token", token);
  url.searchParams.set("return", returnPath);
  // Open in a NEW tab so the user doesn't lose their place on
  // ForgeSlicer. `_blank` is the natural fit for cross-app handoffs.
  window.open(url.toString(), "_blank", "noopener");
}

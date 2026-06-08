// Iter-99 — Forge Suite SSO bridge fan-out (client side).
//
// Called once on every fresh login (from `setUserAndCelebrate` in
// AuthContext). Mints a short-lived JWT against our own backend, then
// fires-and-forgets a `fetch()` to each peer app's `/api/auth/sso-bridge`
// endpoint so that:
//
//   - The peer app upserts the user by email (auto-provision on first
//     visit anywhere in the Forge Suite).
//   - The peer app's `Set-Cookie` lands on its own domain via the
//     cross-origin XHR — so visiting the peer is instantly signed in.
//
// We use `mode: "no-cors"` on the peer call because we don't need the
// response body and the cross-origin response would block reads anyway.
// The cookie still gets set (browsers honour Set-Cookie even on opaque
// responses) — that's the whole point.
//
// Failures are silent on purpose. A peer being down, slow, or
// misconfigured shouldn't block the user's main login. Worst case, the
// next time they visit the peer they sign in normally.

import { API } from "./api";

let inFlight = false;

export async function fanOutSsoBridge() {
  // Guard against StrictMode double-mount triggering two fan-outs.
  // The peer endpoint IS idempotent (mints a fresh session token each
  // time, the old one is still valid until its TTL), but skipping
  // the duplicate keeps things clean and avoids a small audit-log
  // spam burst on every login in dev.
  if (inFlight) return;
  inFlight = true;
  try {
    const mintRes = await fetch(`${API}/auth/sso-bridge/mint`, {
      credentials: "include",
    });
    if (!mintRes.ok) {
      // 401 = anonymous; 500 = secret missing. Either way nothing to do.
      return;
    }
    const { token, peers } = await mintRes.json();
    if (!token || !Array.isArray(peers) || peers.length === 0) return;

    // Fire off every peer call in parallel. We don't await individual
    // results because we don't read the response (no-cors) — but we
    // do await the Promise.allSettled so callers can `await
    // fanOutSsoBridge()` and know all the fan-out network calls have
    // at least dispatched before they move on.
    await Promise.allSettled(
      peers.map((peer) =>
        fetch(`${peer}/api/auth/sso-bridge`, {
          method: "POST",
          mode: "no-cors",
          credentials: "include",
          headers: { "X-Forge-Suite-Token": token },
        })
      )
    );
  } catch (err) {
    console.warn("[forge-suite/sso] bridge fan-out failed:", err);
  } finally {
    inFlight = false;
  }
}

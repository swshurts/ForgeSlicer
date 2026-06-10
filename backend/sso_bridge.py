"""Forge Suite SSO bridge — iter-99.

Lets a user signed into ANY peer app in the Forge Suite (LithoForge
↔ ForgeSlicer today, future siblings later) land on the OTHER apps
already signed in. No extra Google round-trip, no "click sign in again"
on the second app.

How it works
------------

After every successful login on app A:

    1. App A mints a short-lived (60 s) HS256 JWT with the user's email
       in the `sub` claim and app A's name in `iss`.
    2. App A's frontend fan-outs a `fetch()` POST to each peer's
       `/api/auth/sso-bridge` carrying the JWT in the `X-Forge-Suite-Token`
       header. `credentials: "include"` so the response's `Set-Cookie`
       lands on the peer's domain. `mode: "no-cors"` so we don't choke
       on the response we can't read.
    3. Peer app B validates the JWT (signature + exp + iss-allowed),
       upserts the user by email, mints its OWN session_token, and
       returns it as a Set-Cookie. Browser stores the cookie under
       `forgeslicer.com` (or whoever B is). User visits B → cookie
       comes back → instant sign-in.

Security model
--------------

- The JWT is shared-secret HS256, NOT cross-domain OAuth. Every app in
  the suite has the same `FORGE_SUITE_SECRET` in its env. Compromise
  of any app's `.env` compromises the bridge for the whole suite, so
  the secret MUST be rotated on every app simultaneously if exposed.
- 60-second `exp` means a leaked JWT can't be replayed long.
- `iss` claim is checked against `FORGE_SUITE_PEERS` (configured per
  app). Receiving an `iss` that isn't on the allowlist → 403.
- We never trust `aud` from the JWT for ROUTING — the receiving app
  always treats incoming bridges as targeting itself.
- The mint endpoint requires an active session: only an already
  signed-in user can mint a token to bridge themselves. No anonymous
  identity bootstrapping.
- The peer-call doesn't include any user-data beyond `email`/`name`/
  `picture`. The peer is authoritative for its own user record after
  upsert.

Frontend integration
--------------------

```js
// After login success on ForgeSlicer, ping each peer:
fetch("/api/auth/sso-bridge/mint", { credentials: "include" })
  .then((r) => r.json())
  .then((j) => {
    if (!j.token) return;
    for (const peer of j.peers) {
      // no-cors so the Set-Cookie still lands even though we can't read.
      fetch(`${peer}/api/auth/sso-bridge`, {
        method: "POST",
        mode: "no-cors",
        credentials: "include",
        headers: { "X-Forge-Suite-Token": j.token },
      }).catch(() => {});
    }
  });
```

LithoForge does the exact mirror — same module, same env-var names,
same flow.
"""
from __future__ import annotations

import logging
import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# 7-day session, matching the local-auth + Google-OAuth paths.
SESSION_TTL_DAYS = 7
# How long a freshly-minted bridge JWT is valid. Short so a leak can't
# be replayed; the frontend fan-out happens within milliseconds of
# minting, so 60 s is more than enough.
JWT_TTL_SECONDS = 60
JWT_ALGO = "HS256"


class MintTokenResponse(BaseModel):
    token: str
    peers: list[str]


def _peers_from_env() -> list[str]:
    raw = (os.environ.get("FORGE_SUITE_PEERS") or "").strip()
    if not raw:
        return []
    # Comma-separated, whitespace-tolerant. Strip trailing slashes so
    # peer comparisons don't depend on whether the operator typed
    # `https://lithoforge.net` or `https://lithoforge.net/`.
    return [p.strip().rstrip("/") for p in raw.split(",") if p.strip()]


def _allowed_iss_set() -> set[str]:
    """Per-app `iss` allowlist. We treat each entry in
    `FORGE_SUITE_PEERS` as a valid `iss`, after stripping the URL
    scheme + path so the iss can be the short app name (e.g.
    "lithoforge") OR the full origin. Both forms accepted."""
    out: set[str] = set()
    for peer in _peers_from_env():
        # Full origin form.
        out.add(peer)
        # Short hostname form (e.g. "lithoforge.net").
        try:
            host = peer.split("//", 1)[1].split("/", 1)[0]
            out.add(host)
            # Bare app name (strip "www." and the TLD).
            stem = host.replace("www.", "").split(".")[0]
            out.add(stem)
        except Exception:
            pass
    return out


def _get_secret() -> str:
    secret = os.environ.get("FORGE_SUITE_SECRET")
    if not secret:
        raise HTTPException(
            500,
            detail="FORGE_SUITE_SECRET is not configured on this server.",
        )
    return secret


def get_router(
    db,
    get_current_user_optional,
    set_session_cookie,
    public_user,
):
    """Factory mirrors the other billing/admin routers so server.py can
    mount us with all dependencies injected (no circular import on
    server.py's helpers)."""
    router = APIRouter(prefix="/api/auth", tags=["sso-bridge"])

    @router.get("/sso-bridge/mint", response_model=MintTokenResponse)
    async def mint_token(user=Depends(get_current_user_optional)):
        """Mint a short-lived JWT for the currently-signed-in user so
        the frontend can fan-out to peer apps' `/sso-bridge` endpoints.
        Anonymous → 401 so the frontend doesn't try to bridge an empty
        session (which would 401 the peer in turn)."""
        if not user:
            raise HTTPException(401, detail="Sign in first.")
        secret = _get_secret()
        peers = _peers_from_env()
        app_name = (os.environ.get("FORGE_SUITE_APP_NAME") or "forgeslicer").strip()
        now = datetime.now(timezone.utc)
        payload = {
            "sub": user["email"],
            "name": user.get("name") or "",
            "picture": user.get("picture") or "",
            "iss": app_name,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=JWT_TTL_SECONDS)).timestamp()),
            # `jti` lets a future implementation refuse replays even
            # within the 60 s window. We don't enforce that today —
            # the short TTL is the primary defence — but minting the
            # claim now means we can flip on replay-protection
            # without re-issuing tokens.
            "jti": secrets.token_hex(8),
        }
        token = jwt.encode(payload, secret, algorithm=JWT_ALGO)
        return MintTokenResponse(token=token, peers=peers)

    @router.post("/sso-bridge")
    async def accept_bridge(request: Request, response: Response):
        """Receive an inbound JWT from a peer app and translate it into
        a session_token cookie on THIS app's domain. Idempotent — a
        user already signed in via this bridge just gets a fresh
        session cookie (the previous session is still valid until its
        independent TTL).

        Returns 200 + a small payload describing the resulting user so
        the (rare) caller that wants the body can confirm. Most
        callers use `mode: "no-cors"` and don't read the response;
        they only need the `Set-Cookie` side-effect.
        """
        token = request.headers.get("X-Forge-Suite-Token")
        if not token:
            raise HTTPException(400, detail="Missing X-Forge-Suite-Token header.")
        secret = _get_secret()
        try:
            payload = jwt.decode(token, secret, algorithms=[JWT_ALGO])
        except jwt.ExpiredSignatureError as exc:
            raise HTTPException(401, detail="SSO token expired.") from exc
        except jwt.InvalidTokenError as exc:
            # Don't leak the specific PyJWT reason — opaque error is
            # safer (e.g. avoids confirming whether the secret is right).
            logger.warning("SSO bridge rejected token: %s", exc)
            raise HTTPException(401, detail="SSO token invalid.") from exc

        iss = payload.get("iss") or ""
        if iss not in _allowed_iss_set():
            logger.warning("SSO bridge dropped token from non-allowlisted iss=%r", iss)
            raise HTTPException(403, detail="Issuer not in Forge Suite allowlist.")

        email = (payload.get("sub") or "").lower().strip()
        if not email or "@" not in email:
            raise HTTPException(400, detail="Token sub is not a valid email.")

        # Upsert the user using the same path Google-OAuth uses so
        # both methods land on identical user records. We don't call
        # `_upsert_user_from_emergent` directly because that one is
        # tightly coupled to the Emergent profile shape; instead we
        # inline the find-or-create here, then handle the cookie via
        # the injected `set_session_cookie`.
        now_iso = datetime.now(timezone.utc).isoformat()
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            await db.users.update_one(
                {"email": email},
                {"$set": {
                    "name": payload.get("name") or existing.get("name", "User"),
                    "picture": payload.get("picture") or existing.get("picture", ""),
                    "last_login_at": now_iso,
                }},
            )
            user_doc = existing
            user_doc["name"] = payload.get("name") or existing.get("name", "User")
            user_doc["picture"] = payload.get("picture") or existing.get("picture", "")
        else:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            user_doc = {
                "user_id": user_id,
                "email": email,
                "name": payload.get("name") or email.split("@")[0],
                "picture": payload.get("picture") or "",
                "created_at": now_iso,
                "last_login_at": now_iso,
            }
            await db.users.insert_one(user_doc)
            user_doc.pop("_id", None)

        # Mint the session cookie identical to the Google-OAuth path.
        session_token = f"st_{uuid.uuid4().hex}"
        await db.user_sessions.insert_one({
            "user_id": user_doc["user_id"],
            "session_token": session_token,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat(),
            "created_at": now_iso,
            "source": "sso-bridge",
            "source_iss": iss,
        })
        set_session_cookie(response, session_token)
        # Audit row — same shape as admin audit log so super-admins can
        # see "user X signed in via the bridge from LithoForge at T".
        await db.admin_audit_log.insert_one({
            "actor_user_id": user_doc["user_id"],
            "action": "sso_bridge.accept",
            "target_user_id": user_doc["user_id"],
            "payload": {"iss": iss},
            "created_at": now_iso,
        })

        return {
            "ok": True,
            "user": public_user(user_doc),
        }

    return router

# Forge Suite SSO Bridge — LithoForge Integration

ForgeSlicer side is shipped and live at `https://forgeslicer.com`. To
complete the bridge so that signing into one app auto-signs the user
into the other, LithoForge needs the matching pieces below.

## TL;DR

```
                       JWT (HS256, 60s exp)
LithoForge ─────────────────────────────────────▶  ForgeSlicer
   /api/auth/sso-bridge/mint                       /api/auth/sso-bridge
   (LithoForge mints)                              (ForgeSlicer accepts,
                                                    sets session_token cookie)

                       JWT (HS256, 60s exp)
ForgeSlicer ────────────────────────────────────▶  LithoForge
   /api/auth/sso-bridge/mint                       /api/auth/sso-bridge
   (ForgeSlicer mints)                             (LithoForge accepts,
                                                    sets session_token cookie)
```

Both apps mint AND accept. The bridge is symmetric.

## Step 1 — Shared secret (CRITICAL)

LithoForge must use the EXACT same secret as ForgeSlicer. Add to
LithoForge's `backend/.env`:

```
FORGE_SUITE_SECRET=1dffe108d3bb9d19db8d7b126b0de3fb45b9818f2e203e01b0db0109bba9e29b
FORGE_SUITE_PEERS=https://forgeslicer.com,https://www.forgeslicer.com,https://orca-cad-slice.preview.emergentagent.com
FORGE_SUITE_APP_NAME=lithoforge
```

Notice the asymmetry:
- LithoForge's `FORGE_SUITE_PEERS` lists **ForgeSlicer's** URLs (the apps it bridges TO).
- LithoForge's `FORGE_SUITE_APP_NAME` is **`lithoforge`** (the value ForgeSlicer expects in the `iss` claim).

ForgeSlicer has it mirrored: peers = LithoForge URLs, app name = `forgeslicer`.

**Security**: the secret above is the value used in ForgeSlicer's preview AND production today. If you'd rather rotate before going live, swap it on BOTH apps' `.env` in the same deploy window and the bridge will keep working.

## Step 2 — Backend module

Drop this file into LithoForge's backend. It's identical to ForgeSlicer's `sso_bridge.py` apart from log prefixes. PyJWT must already be installed (`pip install pyjwt`).

```python
# backend/sso_bridge.py
"""Forge Suite SSO bridge — LithoForge side.

Accepts a signed JWT from a peer app (ForgeSlicer today) and mints a
LithoForge session cookie for the bridged user. Mints outbound JWTs
so LithoForge logins propagate to peers.
"""
from __future__ import annotations
import logging, os, secrets, uuid
from datetime import datetime, timezone, timedelta
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)
SESSION_TTL_DAYS = 7
JWT_TTL_SECONDS = 60
JWT_ALGO = "HS256"


class MintTokenResponse(BaseModel):
    token: str
    peers: list[str]


def _peers_from_env() -> list[str]:
    raw = (os.environ.get("FORGE_SUITE_PEERS") or "").strip()
    if not raw:
        return []
    return [p.strip().rstrip("/") for p in raw.split(",") if p.strip()]


def _allowed_iss_set() -> set[str]:
    out: set[str] = set()
    for peer in _peers_from_env():
        out.add(peer)
        try:
            host = peer.split("//", 1)[1].split("/", 1)[0]
            out.add(host)
            stem = host.replace("www.", "").split(".")[0]
            out.add(stem)
        except Exception:
            pass
    return out


def _get_secret() -> str:
    secret = os.environ.get("FORGE_SUITE_SECRET")
    if not secret:
        raise HTTPException(500, detail="FORGE_SUITE_SECRET is not configured.")
    return secret


def get_router(db, get_current_user_optional, set_session_cookie, public_user):
    router = APIRouter(prefix="/api/auth", tags=["sso-bridge"])

    @router.get("/sso-bridge/mint", response_model=MintTokenResponse)
    async def mint_token(user=Depends(get_current_user_optional)):
        if not user:
            raise HTTPException(401, detail="Sign in first.")
        now = datetime.now(timezone.utc)
        payload = {
            "sub": user["email"],
            "name": user.get("name") or "",
            "picture": user.get("picture") or "",
            "iss": (os.environ.get("FORGE_SUITE_APP_NAME") or "lithoforge").strip(),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=JWT_TTL_SECONDS)).timestamp()),
            "jti": secrets.token_hex(8),
        }
        token = jwt.encode(payload, _get_secret(), algorithm=JWT_ALGO)
        return MintTokenResponse(token=token, peers=_peers_from_env())

    @router.post("/sso-bridge")
    async def accept_bridge(request: Request, response: Response):
        token = request.headers.get("X-Forge-Suite-Token")
        if not token:
            raise HTTPException(400, detail="Missing X-Forge-Suite-Token header.")
        try:
            payload = jwt.decode(token, _get_secret(), algorithms=[JWT_ALGO])
        except jwt.ExpiredSignatureError:
            raise HTTPException(401, detail="SSO token expired.")
        except jwt.InvalidTokenError:
            raise HTTPException(401, detail="SSO token invalid.")
        iss = payload.get("iss") or ""
        if iss not in _allowed_iss_set():
            raise HTTPException(403, detail="Issuer not in Forge Suite allowlist.")
        email = (payload.get("sub") or "").lower().strip()
        if not email or "@" not in email:
            raise HTTPException(400, detail="Token sub is not a valid email.")

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
        return {"ok": True, "user": public_user(user_doc)}

    return router
```

**Mount in LithoForge's `server.py`** alongside the existing auth routes:

```python
import sso_bridge
sso_bridge_router = sso_bridge.get_router(
    db, get_optional_user, _set_session_cookie, _public_user,
)
app.include_router(sso_bridge_router)
```

The injected helpers are LithoForge's existing equivalents — same names ForgeSlicer uses.

## Step 3 — Frontend fan-out

Drop this into LithoForge's `frontend/src/lib/ssoBridge.js`:

```js
import { API } from "./api";  // wherever you import REACT_APP_BACKEND_URL/api

let inFlight = false;

export async function fanOutSsoBridge() {
  if (inFlight) return;
  inFlight = true;
  try {
    const mintRes = await fetch(`${API}/auth/sso-bridge/mint`, {
      credentials: "include",
    });
    if (!mintRes.ok) return;
    const { token, peers } = await mintRes.json();
    if (!token || !Array.isArray(peers) || peers.length === 0) return;
    await Promise.allSettled(
      peers.map((peer) =>
        // MUST be `mode: "cors"`, not `"no-cors"`. Browsers strip all
        // non-safelisted request headers (including our custom
        // `X-Forge-Suite-Token`) in no-cors mode — the peer receives
        // an empty header and 400/403s. `cors` mode + the peer's
        // matching CORS response headers (see backend section below)
        // is the only way the custom token survives the trip.
        fetch(`${peer}/api/auth/sso-bridge`, {
          method: "POST",
          mode: "cors",
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
```

Then call `fanOutSsoBridge()` from LithoForge's auth context wherever you currently set the user object after a fresh sign-in. ForgeSlicer wires it into the `setUserAndCelebrate` callback so any login path triggers it (Google OAuth, password, magic link).

### CORS requirements on the receiving backend (critical)

For `mode: "cors"` to work end-to-end, both apps' backends MUST respond to the cross-origin POST with these headers:

```
Access-Control-Allow-Origin: <the peer's origin, NOT *>
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: X-Forge-Suite-Token, Content-Type
Access-Control-Allow-Methods: POST, OPTIONS
```

Wildcard `Access-Control-Allow-Origin: *` is **forbidden by the CORS spec when combined with `Allow-Credentials: true`** — the browser refuses to send/store cookies and the bridge silently fails. Each app must reflect the SPECIFIC peer origin (or use a regex that matches it).

For LithoForge's FastAPI app, the simplest fix is to update the `CORSMiddleware` config in `server.py`:

```python
from starlette.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=(
        # LithoForge's own production + preview
        r"^https://lithoforge\.net$"
        r"|^https://www\.lithoforge\.net$"
        # ForgeSlicer (Forge Suite peer)
        r"|^https://forgeslicer\.com$"
        r"|^https://www\.forgeslicer\.com$"
        # Emergent preview/host pattern (covers both apps' previews)
        r"|^https://[a-z0-9-]+\.preview\.emergentagent\.com$"
        r"|^https://[a-z0-9-]+\.emergent\.host$"
        r"|^http://localhost(:\d+)?$"
    ),
    allow_methods=["*"],
    allow_headers=["*"],
)
```

ForgeSlicer has the matching config — its CORS regex now allows `lithoforge.net`/`www.lithoforge.net`.

## Step 4 — Cookie attributes (very important)

LithoForge's session cookie MUST use these attributes for the bridge to work:

```
Set-Cookie: session_token=...; HttpOnly; Secure; SameSite=None; Path=/
```

`SameSite=None; Secure` is what lets the cross-origin fetch from ForgeSlicer set the cookie on LithoForge's domain. `SameSite=Strict` or `Lax` will silently fail (the response cookie is dropped by the browser). ForgeSlicer already uses these attributes via its `_set_session_cookie` helper.

## Step 5 — Smoke test (manual)

After LithoForge ships the bridge:

1. Sign into ForgeSlicer at https://forgeslicer.com
2. Open DevTools → Application → Cookies → look at `lithoforge.net` — you should see a fresh `session_token` cookie
3. In a new tab, hit https://lithoforge.net — should land signed in
4. Reverse the test (sign into LithoForge first, then visit ForgeSlicer)

If step 2 fails:
- DevTools → Network → filter `sso-bridge` — the cross-origin request to lithoforge.net/api/auth/sso-bridge should return 200 (opaque) with `Set-Cookie` in the response headers
- If 401, the secret doesn't match. Recheck `FORGE_SUITE_SECRET` on both `.env` files
- If 403, the `iss` mismatch. ForgeSlicer mints with `iss=forgeslicer`; LithoForge must have `https://forgeslicer.com` (or `forgeslicer`) in its `FORGE_SUITE_PEERS`
- If the cookie isn't set but the response is 200, the cookie attributes on LithoForge's `Set-Cookie` are wrong (probably missing `SameSite=None; Secure`)

## What this does NOT do

- It does NOT sync app-specific records (LithoForge projects, ForgeSlicer designs). Each app keeps its own data; only the user identity is shared.
- It does NOT keep sign-in *state* synced — signing out of ForgeSlicer doesn't sign you out of LithoForge. That's a deliberate UX choice (most users find "sign out of all my apps at once" surprising); if you want it later, mint a `sso_bridge:logout` JWT type and broadcast it on logout.
- It does NOT bridge admin permissions. Being an admin on ForgeSlicer doesn't make you an admin on LithoForge automatically — those are per-app DB flags. (If you want shared admin, that's a separate per-app config check on the LithoForge side.)

## Testing the secret rotation

If you ever need to rotate `FORGE_SUITE_SECRET`:

1. Generate new value: `python3 -c "import secrets; print(secrets.token_hex(32))"`
2. Update `.env` on ForgeSlicer AND LithoForge in the same maintenance window
3. Redeploy both
4. There WILL be a ~30 s window where tokens minted under the old secret get rejected by the rotated peer. Acceptable for a low-traffic suite; if not, build a `FORGE_SUITE_SECRET_PREVIOUS` env var that the accept side ALSO tries before rejecting (~10 lines of code).

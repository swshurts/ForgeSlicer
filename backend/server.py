from fastapi import FastAPI, APIRouter, HTTPException, Request, Response as FastResponse
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import time
import base64
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import httpx

from email_service import send_contributor_celebration
import meshy_service
import email_service
import auth_local
import billing
import braintree_billing
import sso_bridge
import admin as admin_module
import orca_engine
import orca_upstream
import gallery_taxonomy
from routes.projects import build_projects_router
from routes.user_printers import build_user_printers_router
from routes.meshy_key import build_meshy_key_router, resolve_user_meshy_key
from routes.printability import build_printability_router
from routes.custom_textures import build_custom_textures_router
from routes.litho_inbox import build_litho_inbox_router
from routes.mesh_repair import build_mesh_repair_router
from routes.exports import build_exports_router
from routes.release import build_release_router
from routes.shared_printers import build_shared_printers_router, build_publish_router, build_shared_printer_admin_router
from routes.realtime import router as realtime_router


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="ForgeSlicer API")
api_router = APIRouter(prefix="/api")


# ---------- Auth (Emergent-managed Google OAuth) ----------
# Flow: frontend redirects to https://auth.emergentagent.com/ with a redirect_url
# that brings the user back to our app with #session_id=... in the URL fragment.
# The frontend POSTs that session_id to /api/auth/session; we exchange it with
# the Emergent auth service for a 7-day session_token, then set an httpOnly
# cookie so subsequent requests are authenticated transparently.

EMERGENT_AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_TTL_DAYS = 7
SESSION_COOKIE = "session_token"


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: str = ""
    created_at: datetime


class SessionExchangeRequest(BaseModel):
    session_id: str


async def _upsert_user_from_emergent(profile: dict) -> dict:
    """Find-or-create a user from the Emergent auth profile.
    Returns the stored user document (without Mongo _id)."""
    email = (profile.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Auth profile missing email")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        # Refresh name/picture in case it changed in Google.
        await db.users.update_one(
            {"email": email},
            {"$set": {
                "name": profile.get("name") or existing.get("name", "User"),
                "picture": profile.get("picture") or existing.get("picture", ""),
                "last_login_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        existing["name"] = profile.get("name") or existing.get("name", "User")
        existing["picture"] = profile.get("picture") or existing.get("picture", "")
        return existing
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": profile.get("name") or email.split("@")[0],
        "picture": profile.get("picture") or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    # `insert_one` mutates `doc` by adding `_id` (BSON ObjectId). Strip
    # it before returning so callers serialising the dict to JSON don't
    # blow up on the non-JSON-serializable ObjectId.
    doc.pop("_id", None)
    return doc


async def _resolve_session_token(token: Optional[str]) -> Optional[dict]:
    """Validate a session token, return the user dict or None."""
    if not token:
        return None
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        return None
    expires_at = sess.get("expires_at")
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except Exception:
            return None
    if expires_at is None:
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        # Purge expired session opportunistically.
        await db.user_sessions.delete_one({"session_token": token})
        return None
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    # Soft-banned users have their sessions killed at ban time. If a stale
    # session somehow lives on, we refuse it here so banned accounts can't
    # quietly continue to interact with the API.
    if user and user.get("banned"):
        return None
    return user


def _extract_token(request: Request) -> Optional[str]:
    """Prefer the httpOnly cookie; fall back to Authorization: Bearer for tools."""
    tok = request.cookies.get(SESSION_COOKIE)
    if tok:
        return tok
    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth.split(None, 1)[1].strip()
    return None


async def get_current_user(request: Request) -> dict:
    """Require an authenticated user. Returns the user dict."""
    user = await _resolve_session_token(_extract_token(request))
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def get_optional_user(request: Request) -> Optional[dict]:
    """Return the user if authenticated, otherwise None. For endpoints that
    work for anonymous visitors but enrich responses for logged-in users."""
    return await _resolve_session_token(_extract_token(request))


def _set_session_cookie(response: FastResponse, session_token: str) -> None:
    """Single source of truth for the httpOnly session cookie. Used by the
    Google OAuth exchange AND the local-auth (email/password, magic link,
    password reset) endpoints so both methods produce identical cookies."""
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_token,
        max_age=SESSION_TTL_DAYS * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )


def _public_user(user: dict) -> dict:
    """Public-facing user payload. Optional fields default to "" / False
    so the frontend never has to guard against `undefined`. Share toggles
    determine what's exposed to OTHER users on author profiles — but the
    OWNER always sees their own data via this endpoint."""
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name", "User"),
        "picture": user.get("picture", ""),
        "avatar_url": user.get("avatar_url", ""),
        "contact_link": user.get("contact_link", ""),
        "city": user.get("city", ""),
        "state": user.get("state", ""),
        "country": user.get("country", ""),
        "share_contact": bool(user.get("share_contact", False)),
        "share_avatar": bool(user.get("share_avatar", False)),
        "share_location": bool(user.get("share_location", False)),
        "auth_methods": user.get("auth_methods", ["google"]),
        "has_password": bool(user.get("password_hash")),
        "contributor_lifetime": bool(user.get("contributor_lifetime", False)),
        # Admin flags — needed by the frontend so it can conditionally
        # show the /admin link/page. Backend always re-checks via
        # require_admin so a tampered client can't actually USE admin APIs.
        "is_admin": bool(user.get("is_admin", False)),
        "is_super_admin": bool(user.get("is_super_admin", False)),
        # Override quota — the AIGenerateDialog shows the effective cap;
        # if set, it overrides the default + contributor multiplier.
        "ai_quota_override": user.get("ai_quota_override"),
        # Stripe subscription state — used by the frontend to render the
        # current plan in the UserMenu + pricing page. `subscription_tier`
        # is the package_id ("free", "maker", or "pro"); `expires_at` is
        # an ISO timestamp set when the most recent payment was confirmed.
        "subscription_tier": user.get("subscription_tier", "free"),
        "subscription_expires_at": user.get("subscription_expires_at"),
    }


@api_router.post("/auth/session")
async def exchange_session(req: SessionExchangeRequest, response: FastResponse):
    """Exchange an Emergent OAuth session_id (one-time, from URL fragment)
    for our app's persistent session_token. Sets an httpOnly cookie.

    NOTE on retries: the upstream Emergent auth-provider has an eventual-
    consistency window for newly-issued session_ids — the first GET after
    redirect-back can return 401/404 because the session hasn't propagated
    across their nodes yet. We retry up to 4 times with exponential backoff
    (0.4 / 0.9 / 1.6 / 2.5 s) and a 7 s per-attempt httpx timeout. The
    aggregate worst-case is ~33 s (4 × 7 + 5.4 s of backoffs), which fits
    comfortably under the frontend's 45 s axios ceiling defined in
    `auth.js -> authApi.exchange`. The earlier 15 s per-attempt budget
    could push the backend past 60 s when upstream was slow, surfacing
    as "timeout of 45000ms exceeded" on the client while the backend was
    still mid-retry."""
    sid = (req.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="Missing session_id")

    # Retry only on the failure modes we've actually observed from the
    # upstream provider's propagation lag. 400 = bad sid (don't retry);
    # 200 = success (return immediately).
    RETRY_STATUSES = {401, 404, 408, 425, 429, 500, 502, 503, 504}
    backoffs = [0.4, 0.9, 1.6, 2.5]
    last_status = None
    profile = None
    log = logging.getLogger(__name__)
    t_start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=7.0) as cx:
            for attempt, sleep_before in enumerate(backoffs):
                if sleep_before:
                    await asyncio.sleep(sleep_before)
                t_attempt = time.monotonic()
                try:
                    r = await cx.get(EMERGENT_AUTH_SESSION_URL, headers={"X-Session-ID": sid})
                except (httpx.TimeoutException, httpx.ConnectError) as exc:
                    # Treat network/timeout the same as a transient 5xx —
                    # log and retry. Without this, a single slow attempt
                    # would surface as a 502 and the user couldn't retry
                    # (session_id is one-shot at the provider).
                    log.info(
                        "auth-provider attempt %d failed in %.2fs (%s); retrying",
                        attempt + 1, time.monotonic() - t_attempt, type(exc).__name__,
                    )
                    last_status = "timeout"
                    continue
                last_status = r.status_code
                if r.status_code == 200:
                    profile = r.json()
                    if attempt > 0:
                        log.info(
                            "auth-provider succeeded on attempt %d in %.2fs (total %.2fs)",
                            attempt + 1, time.monotonic() - t_attempt, time.monotonic() - t_start,
                        )
                    break
                if r.status_code not in RETRY_STATUSES:
                    # Definitive failure (e.g. 400) — don't waste retries.
                    break
                log.info(
                    "auth-provider attempt %d returned %d in %.2fs; retrying",
                    attempt + 1, r.status_code, time.monotonic() - t_attempt,
                )
        if profile is None:
            log.warning(
                "auth-provider gave up after 4 attempts in %.2fs (last_status=%s)",
                time.monotonic() - t_start, last_status,
            )
            raise HTTPException(status_code=401, detail=f"Auth provider rejected session ({last_status})")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Auth provider unreachable: {e}")
    user = await _upsert_user_from_emergent(profile)
    session_token = profile.get("session_token") or f"st_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    await db.user_sessions.insert_one({
        "user_id": user["user_id"],
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # httpOnly cookie so JS can't read it; SameSite=None+Secure because the
    # preview frontend and backend live on different sub-paths via ingress.
    _set_session_cookie(response, session_token)
    return _public_user(user)


@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await _resolve_session_token(_extract_token(request))
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return _public_user(user)


@api_router.post("/auth/logout")
async def logout(request: Request, response: FastResponse):
    tok = _extract_token(request)
    if tok:
        await db.user_sessions.delete_one({"session_token": tok})
    response.delete_cookie(SESSION_COOKIE, path="/", samesite="none", secure=True)
    return {"ok": True}


@api_router.get("/auth/email-status")
async def auth_email_status():
    """Public — let the SignIn page tell users when magic-link / reset
    emails won't actually be delivered (e.g. Resend key rotated and not
    yet updated). No sensitive info exposed; just a yes/no + a short
    user-facing message."""
    return email_service.get_email_status()


@api_router.get("/users/{user_id}/profile")
async def get_public_user_profile(user_id: str):
    """Public author page — return only the bits the owner has marked as
    publicly shareable via the per-field share_* toggles. Email is never
    exposed; user_id + display name + contributor badge are always public
    (the name is already shown next to every shared design)."""
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Strict whitelist of what we ever return — no chance of leaking
    # password_hash, email, IP, etc.
    public_profile: dict = {
        "user_id": user["user_id"],
        "name": user.get("name", "Maker"),
        "contributor_lifetime": bool(user.get("contributor_lifetime", False)),
        "created_at": user.get("created_at", ""),
    }
    # Optional fields gated by per-field share toggle. Empty string means
    # "user didn't fill this in" — same wire shape so the frontend doesn't
    # need to special-case undefined.
    if user.get("share_avatar") and user.get("avatar_url"):
        public_profile["avatar_url"] = user["avatar_url"]
    if user.get("share_contact") and user.get("contact_link"):
        public_profile["contact_link"] = user["contact_link"]
    if user.get("share_location") and (user.get("city") or user.get("state") or user.get("country")):
        public_profile["location"] = ", ".join(
            p for p in (user.get("city"), user.get("state"), user.get("country")) if p
        )

    # Public counts — same query the gallery uses, so they always match.
    design_count = await db.gallery.count_documents({
        "user_id": user_id,
        "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
    })
    component_count = await db.components.count_documents({
        "user_id": user_id,
        "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
    })
    public_profile["public_design_count"] = design_count
    public_profile["public_component_count"] = component_count

    return public_profile


@api_router.get("/users/{user_id}/designs")
async def get_public_user_designs(user_id: str):
    """Public-only designs by this user, in newest-first order. Same
    projection as the main gallery list (no STL blob)."""
    exists = await db.users.count_documents({"user_id": user_id}, limit=1)
    if not exists:
        raise HTTPException(status_code=404, detail="User not found")
    cursor = db.gallery.find(
        {
            "user_id": user_id,
            "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
        },
        {"_id": 0, "stl_base64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(500)
    return [_gallery_meta_from_doc(d).model_dump() for d in items]


@api_router.get("/users/{user_id}/components")
async def get_public_user_components(user_id: str):
    """Public-only components by this user."""
    exists = await db.users.count_documents({"user_id": user_id}, limit=1)
    if not exists:
        raise HTTPException(status_code=404, detail="User not found")
    cursor = db.components.find(
        {
            "user_id": user_id,
            "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
        },
        {"_id": 0, "data": 0, "stl_base64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(500)
    # Strip Mongo internals and normalize created_at to a string so the
    # response shape matches the main components list.
    return [{**d, "created_at": d.get("created_at", "")} for d in items]


@api_router.get("/users/{user_id}/remix-activity")
async def get_user_remix_activity(user_id: str, limit: int = 25):
    """Activity feed: PUBLIC gallery items that remixed any design owned
    by `user_id`, newest first. Used on the public author profile to give
    creators visibility into how their work is being built upon — a
    lightweight social-signal layer.

    Each entry includes:
      - the remix item's id / name / thumbnail / created_at / author / author_id
      - the source design's id + name (so the UI can render "X remixed your Y")

    Private remixes (private=true) are excluded — viewers should only see
    activity that's already public on the gallery, otherwise we'd leak
    the existence of private projects through the back door."""
    exists = await db.users.count_documents({"user_id": user_id}, limit=1)
    if not exists:
        raise HTTPException(status_code=404, detail="User not found")

    # First, find the IDs of every design this user owns. Then pull the
    # public gallery items whose remix_of points at any of them.
    my_designs_cursor = db.gallery.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "name": 1},
    )
    my_designs = await my_designs_cursor.to_list(2000)
    if not my_designs:
        return []
    source_by_id = {d["id"]: d.get("name", "Untitled") for d in my_designs}

    cursor = db.gallery.find(
        {
            "remix_of": {"$in": list(source_by_id.keys())},
            "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
            # Don't surface the user remixing their own designs — would
            # flood the feed with self-iteration noise.
            "user_id": {"$ne": user_id},
        },
        {"_id": 0, "id": 1, "name": 1, "author": 1, "user_id": 1,
         "thumbnail_base64": 1, "created_at": 1, "remix_of": 1},
    ).sort("created_at", -1).limit(max(1, min(200, int(limit))))

    items = await cursor.to_list(limit)
    return [
        {
            "id": it["id"],
            "name": it.get("name", "Untitled"),
            "author": it.get("author", "Anonymous"),
            "author_id": it.get("user_id"),
            "thumbnail_base64": it.get("thumbnail_base64", ""),
            "created_at": it.get("created_at", ""),
            "source_id": it.get("remix_of"),
            "source_name": source_by_id.get(it.get("remix_of"), "your design"),
        }
        for it in items
    ]



@api_router.put("/me/profile")
async def update_my_profile(req: auth_local.ProfileUpdateRequest, request: Request):
    """Update the optional profile fields. Only supplied keys are touched —
    sending `{share_contact: true}` won't wipe the user's avatar.

    Each `share_*` boolean is the user's explicit consent to show the
    corresponding field on PUBLIC author pages. The owner always sees
    everything via /auth/me regardless of the toggles."""
    user = await get_current_user(request)
    updates: dict = {}
    payload = req.model_dump(exclude_unset=True)
    # Whitelist exactly what we'll write — never pass through Pydantic
    # extras (the model already forbids them, this is belt-and-suspenders).
    for key in (
        "name", "contact_link", "avatar_url", "city", "state", "country",
        "share_contact", "share_avatar", "share_location",
    ):
        if key in payload and payload[key] is not None:
            updates[key] = payload[key]
    if not updates:
        return _public_user(user)
    # Light sanitisation for the string fields — strip + length-clamp.
    for k in ("name", "contact_link", "avatar_url", "city", "state", "country"):
        if k in updates and isinstance(updates[k], str):
            updates[k] = updates[k].strip()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    refreshed = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return _public_user(refreshed or user)


# Mount the local auth router (email/password + magic link + reset).
# Lives at /api/auth/* alongside the existing Google session exchange.
api_router.include_router(auth_local.build_auth_router(
    db=db,
    email_service=email_service,
    set_session_cookie=_set_session_cookie,
    public_user=_public_user,
))

# Mount the admin router at /api/admin/*. Each endpoint enforces its own
# auth via Depends(require_admin) / Depends(require_super_admin).
api_router.include_router(admin_module.build_admin_router(
    db=db,
    get_current_user=get_current_user,
))

# OrcaSlicer engine routes — production-quality slice + install status.
# Lives under /api/slice/orca/* per the router's own prefix declaration.
api_router.include_router(orca_engine.router)

# iter-124 — BYO Meshy AI key. Lets users bring their own Meshy key so
# they can bypass the monthly platform cap (they pay Meshy directly).
# Keys are Fernet-encrypted at rest via `secrets_vault`.
api_router.include_router(build_meshy_key_router(db=db, get_current_user=get_current_user))

# iter-126 — Printability Report scoring engine. Central UX skeleton for
# the "AI-mesh → printable file" workflow: upload STL/OBJ/3MF/GLB, get
# a 0-100 score + itemised issues each tagged with a fix_action that
# maps to a downstream tool (Auto-Clean, Decimate, Add Base, etc.).
api_router.include_router(build_printability_router(get_current_user=get_current_user))


# Hierarchical user projects — /api/projects/* (auth-required).
# The router accepts the auth dependency as a callable so we don't have to
# import server.py in routes/projects.py (circular import).
api_router.include_router(build_projects_router(db, get_current_user))

# iter-105.5 — User-uploaded custom textures (heightmap-source images).
# Persisted server-side so uploads survive reloads and follow the user
# across sessions / devices. Stored inline as small grayscale PNG
# data-URLs (≤200KB each).
api_router.include_router(build_custom_textures_router(db, get_current_user))

# iter-105.11 — LithoForge → ForgeSlicer inbox. Partner tools (LithoForge.net)
# POST a finished STL/3MF here; the user's workspace polls /api/litho/inbox
# and auto-imports onto the build plate the next time they open ForgeSlicer.
# File payloads go through GridFS so the 16MB BSON limit doesn't bite.
api_router.include_router(build_litho_inbox_router(db, get_current_user))

# Server-side mesh repair via MeshLab. /api/mesh/repair takes an STL
# upload and returns a repaired (watertight, manifold) STL. Used by
# the Repair Mesh button on the Imported Inspector to rescue
# non-manifold AI / photogrammetry meshes before Boolean ops.
api_router.include_router(build_mesh_repair_router(get_current_user))

# Slicer-handoff staging. /api/exports/handoff lets the workspace push
# the just-built 3MF to a short-lived public URL so the desktop slicer
# (launched via the orcaslicer:// custom protocol with `?file=<URL>`)
# can fetch and auto-open it — no more manual "Open Project" step.
api_router.include_router(build_exports_router(db, get_current_user))

# Release-info route. /api/release/current parses CHANGELOG.md for the
# latest `## Iteration X.Y` heading and serves it to the frontend so
# the displayed iter label updates automatically whenever a new
# iteration is appended. Replaces the brittle hand-edited constant
# in `lib/iterLabel.js` that kept going stale.
api_router.include_router(build_release_router())

# Per-user custom printer definitions — /api/me/printers/* (auth-required).
# Lets users register printers not in OrcaSlicer's bundled preset library
# (the 2026 wave: SV06 Plus Ace, Voron 2.4 variants, brand-new models the
# upstream Orca preset shipment hasn't caught up to). The slice endpoint
# accepts a `user_printer_id` and resolves through these records.
api_router.include_router(build_user_printers_router(db, get_current_user))
# Iter-83: Shared Profile Library — community-published printer profiles.
api_router.include_router(build_shared_printers_router(db, get_current_user, get_optional_user))
api_router.include_router(build_publish_router(db, get_current_user))


# Iter-85: Scheduled OrcaSlicer upstream sync. Polls SoftFever/OrcaSlicer
# for printer-profile changes, surfaces deltas to admins, lets them merge
# new/changed profiles into bundled_synced_printers (served publicly by
# /api/synced-printers and merged into the frontend's printer dropdown).
async def _require_admin_for_upstream(request: Request) -> dict:
    user = await get_current_user(request)
    if not (user.get("is_admin") or user.get("is_super_admin")):
        raise HTTPException(status_code=403, detail="Admin access required.")
    if user.get("banned"):
        raise HTTPException(status_code=403, detail="Account suspended.")
    return user

api_router.include_router(orca_upstream.build_orca_upstream_router(
    db=db,
    require_admin=_require_admin_for_upstream,
))
api_router.include_router(orca_upstream.build_synced_printers_public_router(db=db))
# Iter-90: public community-suggestions endpoint (auth required to write,
# but no admin needed). Mounted alongside the synced-printers public route.
api_router.include_router(orca_upstream.build_upstream_suggestions_public_router(
    db=db,
    get_current_user=get_current_user,
))
# Iter-90: admin moderation surface for the shared-printer library.
# Reuses the same auth helper so the access model stays uniform.
api_router.include_router(build_shared_printer_admin_router(
    db=db,
    require_admin=_require_admin_for_upstream,
))


@app.on_event("startup")
async def _start_orca_upstream_scheduler() -> None:
    """Spawn the 24h sync daemon. The background task is fire-and-forget;
    it logs every run and never propagates exceptions to the event loop."""
    try:
        orca_upstream.start_scheduler(db)
        logging.getLogger(__name__).info("orca-upstream scheduler started (24h interval)")
    except Exception as e:  # noqa: BLE001
        logging.getLogger(__name__).warning("orca-upstream scheduler failed to start: %s", e)


# Wire the user-printers DB lookup + auth extractor into orca_engine so
# the slice handler can resolve `user_printer_id` without importing the
# motor handle directly (which would create a circular import).
from routes.user_printers import build_profile_from_user_printer  # noqa: E402

async def _resolve_user_printer(user_id: str, user_printer_id: str):
    if not user_id or not user_printer_id:
        return None
    doc = await db.user_printers.find_one(
        {"printer_id": user_printer_id, "user_id": user_id},
        {"_id": 0},
    )
    if not doc:
        return None
    return build_profile_from_user_printer(doc)

async def _extract_user_id_for_slice(request):
    """Return the caller's user_id (or None) for slice ownership checks.
    Uses `get_optional_user` so anonymous slice requests still work for
    bundled-preset combos that don't reference a custom printer."""
    user = await get_optional_user(request)
    return user.get("user_id") if user else None

orca_engine.register_user_printer_resolver(_resolve_user_printer)
orca_engine.register_user_id_extractor(_extract_user_id_for_slice)

# Mount the Stripe billing routers. `/api/billing/*` for checkout +
# status polling (uses the auth helper to attribute checkouts to users)
# and `/api/webhook/stripe` (no prefix — Stripe expects the exact URL
# we registered with them).
billing_api_router = billing.get_router(db, get_optional_user)
billing_webhook_router = billing.get_webhook_router(db)
# Iter-98 — Braintree alongside the Stripe path. New checkout UI on
# the pricing page routes here; Stripe routes stay mounted so any
# historical session ids still resolve via /api/billing/status.
braintree_api_router = braintree_billing.get_router(db, get_optional_user)

# Iter-99 — Forge Suite SSO bridge. Lets a user signed into a peer
# app (LithoForge today, future siblings later) auto-land signed in
# on ForgeSlicer. Mounted at /api/auth/sso-bridge/* alongside the
# existing Google + local-auth flows.
sso_bridge_router = sso_bridge.get_router(
    db,
    get_optional_user,
    _set_session_cookie,
    _public_user,
)


# ---------- Contributor tier ----------
# Open-source licenses that count toward the Contributor Lifetime threshold.
# Non-commercial (NC), no-derivatives (ND), and the ForgeSlicer Standard
# Digital license are explicitly excluded because the deal is "lifetime free
# in exchange for genuinely open work the community can build on".
CONTRIB_OPEN_LICENSES = {
    "cc-by-4.0", "cc-by-sa-4.0", "cc0-1.0",
    "gpl-3.0", "lgpl-3.0", "agpl-3.0",
    "mit", "apache-2.0",
}
CONTRIB_COMPONENT_THRESHOLD = 100
CONTRIB_DESIGN_THRESHOLD = 20


async def _count_open_contributions(user_id: str, collection) -> int:
    """Count unique published+open-licensed items by `user_id`, deduplicated
    on case-insensitive name so a "v1 / v2 / final" trio counts once. We
    only consider items the author has made public — private uploads don't
    earn the badge (the deal is about community contribution)."""
    cursor = collection.find(
        {
            "user_id": user_id,
            "$or": [{"private": False}, {"private": {"$exists": False}}],
            "license": {"$in": list(CONTRIB_OPEN_LICENSES)},
        },
        {"_id": 0, "name": 1},
    )
    seen = set()
    async for d in cursor:
        n = (d.get("name") or "").strip().lower()
        if n:
            seen.add(n)
    return len(seen)


@api_router.get("/me/contributor-status")
async def contributor_status(request: Request):
    """Return the user's progress toward the Contributor Lifetime tier and
    flip `users.contributor_lifetime` to True once the thresholds are met.
    Per spec the flag never demotes — once granted, always granted."""
    user = await get_current_user(request)
    uid = user["user_id"]
    components_count = await _count_open_contributions(uid, db.components)
    designs_count = await _count_open_contributions(uid, db.gallery)
    qualifies = (
        components_count >= CONTRIB_COMPONENT_THRESHOLD
        and designs_count >= CONTRIB_DESIGN_THRESHOLD
    )
    already = bool(user.get("contributor_lifetime", False))
    just_granted = False
    if qualifies and not already:
        await db.users.update_one(
            {"user_id": uid},
            {"$set": {
                "contributor_lifetime": True,
                "contributor_granted_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        already = True
        just_granted = True
    # Fire the celebration email exactly once, when the threshold is crossed
    # in *this* request. Send is async + non-blocking + best-effort: failures
    # never affect the API response.
    if just_granted:
        try:
            await send_contributor_celebration(user.get("email", ""), user.get("name", ""))
        except Exception as e:  # noqa: BLE001 - email is best-effort
            logging.getLogger(__name__).warning("contributor email dispatch failed: %s", e)
    return {
        "user_id": uid,
        "components_count": components_count,
        "designs_count": designs_count,
        "components_threshold": CONTRIB_COMPONENT_THRESHOLD,
        "designs_threshold": CONTRIB_DESIGN_THRESHOLD,
        "contributor_lifetime": already,
        "qualifying_licenses": sorted(list(CONTRIB_OPEN_LICENSES)),
    }


# ---------- AI Mesh Generation (Meshy) ----------
# Per-user monthly cap so a single user can't burn through the Meshy budget.
# Contributor Lifetime users get 2× the cap as a "thanks" perk.
AI_MONTHLY_CAP = 13
AI_CONTRIB_MULTIPLIER = 2


def _month_key(now: Optional[datetime] = None) -> str:
    """Calendar-month bucket key for usage counting (UTC)."""
    n = now or datetime.now(timezone.utc)
    return f"{n.year:04d}-{n.month:02d}"


async def _ai_cap_for(user: dict) -> int:
    """Per-user monthly AI cap.

    Precedence (highest wins):
      1. Admin-set override `ai_quota_override` (1..300) — bypasses
         everything else, used to give specific users custom quotas.
      2. Contributor multiplier on the default cap.
      3. Default cap.
    """
    override = user.get("ai_quota_override")
    if isinstance(override, int) and 1 <= override <= 300:
        return override
    base = AI_MONTHLY_CAP
    return base * AI_CONTRIB_MULTIPLIER if user.get("contributor_lifetime") else base


async def _ai_increment_or_raise(user: dict) -> int:
    """Atomically increment monthly AI usage; raise 429 if user is at cap.

    Returns the count AFTER increment. Uses MongoDB's $inc + upsert so two
    concurrent requests can't both squeak past the boundary."""
    cap = await _ai_cap_for(user)
    mkey = _month_key()
    # Pre-check: cheap read so we don't waste a write if obviously capped.
    cur = await db.ai_usage.find_one({"user_id": user["user_id"], "month_key": mkey})
    if cur and (cur.get("count") or 0) >= cap:
        raise HTTPException(status_code=429, detail=f"Monthly AI generation cap reached ({cap}/month). Resets on the 1st.")
    # Atomic increment.
    result = await db.ai_usage.find_one_and_update(
        {"user_id": user["user_id"], "month_key": mkey},
        {
            "$inc": {"count": 1},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
            "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()},
        },
        upsert=True,
        return_document=True,  # return doc AFTER update (Motor: True == ReturnDocument.AFTER)
    )
    new_count = (result or {}).get("count", 1)
    if new_count > cap:
        # Race: roll back our increment so future caps stay correct.
        await db.ai_usage.update_one(
            {"user_id": user["user_id"], "month_key": mkey},
            {"$inc": {"count": -1}},
        )
        raise HTTPException(status_code=429, detail=f"Monthly AI generation cap reached ({cap}/month).")
    return new_count


class AITextRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=600)
    art_style: str = Field("realistic", max_length=32)  # realistic | sculpture | low-poly


@api_router.get("/ai/usage")
async def ai_usage_for_user(request: Request):
    """Tells the frontend how many gens the user has used this month + their cap."""
    user = await get_current_user(request)
    cap = await _ai_cap_for(user)
    cur = await db.ai_usage.find_one({"user_id": user["user_id"], "month_key": _month_key()})
    used = (cur or {}).get("count", 0)
    has_personal_key = bool(user.get("meshy_api_key_enc"))
    return {
        "used": used,
        "cap": cap,
        "remaining": max(0, cap - used),
        "month": _month_key(),
        "contributor_lifetime": bool(user.get("contributor_lifetime")),
        # When True, the frontend shows "Unlimited (your Meshy key)" instead
        # of the used/cap counter, and never renders the "cap reached" toast.
        "has_personal_key": has_personal_key,
    }


@api_router.post("/ai/generate/text")
async def ai_generate_text(req: AITextRequest, request: Request):
    user = await get_current_user(request)
    personal_key = await resolve_user_meshy_key(user)
    if not personal_key and not meshy_service.is_configured():
        raise HTTPException(status_code=503, detail="AI generation not configured")
    # BYO key holders bypass the monthly quota — they pay Meshy directly.
    # We still record the job in ai_jobs (for stats + status polling) but
    # skip the ai_usage increment so their cap stays untouched.
    if not personal_key:
        await _ai_increment_or_raise(user)
    try:
        meshy_task_id = await meshy_service.create_text_to_3d(req.prompt, req.art_style, api_key=personal_key)
    except httpx.HTTPStatusError as e:
        if not personal_key:
            # Refund the usage counter — they didn't get a generation.
            await db.ai_usage.update_one(
                {"user_id": user["user_id"], "month_key": _month_key()},
                {"$inc": {"count": -1}},
            )
        raise HTTPException(status_code=502, detail=f"Meshy submission failed: {e.response.status_code}")
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.ai_jobs.insert_one({
        "job_id": job_id,
        "user_id": user["user_id"],
        "kind": "text",
        "prompt": req.prompt,
        "art_style": req.art_style,
        "meshy_task_id": meshy_task_id,
        "status": "PENDING",
        "progress": 0,
        "model_url": None,
        "used_personal_key": bool(personal_key),
        "created_at": now,
        "updated_at": now,
    })
    return {"job_id": job_id, "status": "PENDING"}


@api_router.post("/ai/generate/image")
async def ai_generate_image(request: Request):
    user = await get_current_user(request)
    personal_key = await resolve_user_meshy_key(user)
    if not personal_key and not meshy_service.is_configured():
        raise HTTPException(status_code=503, detail="AI generation not configured")
    # Body must be JSON: {image_b64, mime_type}. We accept base64 from the frontend
    # rather than multipart because it's a tiny payload (~1MB) and keeps the
    # backend symmetric with everywhere else we exchange image data.
    body = await request.json()
    image_b64 = (body.get("image_b64") or "").strip()
    mime = (body.get("mime_type") or "image/png").strip()
    if not image_b64:
        raise HTTPException(status_code=400, detail="Missing image_b64")
    if mime not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Unsupported image mime_type")
    data_url = f"data:{mime};base64,{image_b64}"
    if not personal_key:
        await _ai_increment_or_raise(user)
    try:
        meshy_task_id = await meshy_service.create_image_to_3d(data_url, api_key=personal_key)
    except httpx.HTTPStatusError as e:
        if not personal_key:
            await db.ai_usage.update_one(
                {"user_id": user["user_id"], "month_key": _month_key()},
                {"$inc": {"count": -1}},
            )
        raise HTTPException(status_code=502, detail=f"Meshy submission failed: {e.response.status_code}")
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.ai_jobs.insert_one({
        "job_id": job_id,
        "user_id": user["user_id"],
        "kind": "image",
        "meshy_task_id": meshy_task_id,
        "status": "PENDING",
        "progress": 0,
        "model_url": None,
        "used_personal_key": bool(personal_key),
        "created_at": now,
        "updated_at": now,
    })
    return {"job_id": job_id, "status": "PENDING"}


@api_router.post("/ai/generate/multi-image")
async def ai_generate_multi_image(request: Request):
    """Multi-view image-to-3D — fuses 2-4 reference photos (top/front/side/etc)
    into a single mesh via Meshy's multi-image endpoint. The rest of the
    job lifecycle (polling, mesh download) reuses the existing /ai/jobs/*
    handlers with kind='multi_image'.
    """
    user = await get_current_user(request)
    personal_key = await resolve_user_meshy_key(user)
    if not personal_key and not meshy_service.is_configured():
        raise HTTPException(status_code=503, detail="AI generation not configured")
    body = await request.json()
    images = body.get("images") or []
    if not isinstance(images, list) or not (2 <= len(images) <= 4):
        raise HTTPException(status_code=400, detail="Provide 2-4 reference photos.")
    data_urls: list[str] = []
    for i, item in enumerate(images):
        b64 = (item.get("image_b64") or "").strip() if isinstance(item, dict) else ""
        mime = (item.get("mime_type") or "image/png").strip() if isinstance(item, dict) else "image/png"
        if not b64:
            raise HTTPException(status_code=400, detail=f"Image {i+1}: missing image_b64")
        if mime not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
            raise HTTPException(status_code=400, detail=f"Image {i+1}: unsupported mime_type ({mime})")
        data_urls.append(f"data:{mime};base64,{b64}")
    if not personal_key:
        await _ai_increment_or_raise(user)
    try:
        meshy_task_id = await meshy_service.create_multi_image_to_3d(data_urls, api_key=personal_key)
    except httpx.HTTPStatusError as e:
        if not personal_key:
            await db.ai_usage.update_one(
                {"user_id": user["user_id"], "month_key": _month_key()},
                {"$inc": {"count": -1}},
            )
        raise HTTPException(status_code=502, detail=f"Meshy submission failed: {e.response.status_code}")
    except ValueError as ve:
        if not personal_key:
            await db.ai_usage.update_one(
                {"user_id": user["user_id"], "month_key": _month_key()},
                {"$inc": {"count": -1}},
            )
        raise HTTPException(status_code=400, detail=str(ve))
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.ai_jobs.insert_one({
        "job_id": job_id,
        "user_id": user["user_id"],
        "kind": "multi_image",
        "view_count": len(data_urls),
        "meshy_task_id": meshy_task_id,
        "status": "PENDING",
        "progress": 0,
        "model_url": None,
        "used_personal_key": bool(personal_key),
        "created_at": now,
        "updated_at": now,
    })
    return {"job_id": job_id, "status": "PENDING"}


@api_router.get("/ai/jobs/{job_id}")
async def ai_job_status(job_id: str, request: Request):
    """Pull the latest status from Meshy; cache result locally so repeated
    polls don't smash the upstream API."""
    user = await get_current_user(request)
    job = await db.ai_jobs.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # If we already have a terminal SUCCEEDED/FAILED status, return cached.
    if job["status"] in ("SUCCEEDED", "FAILED"):
        return job
    try:
        # Poll with the same key that submitted the task so BYO-key
        # users can see their generation's status. Meshy tasks are
        # namespaced by the API key that created them.
        poll_key = await resolve_user_meshy_key(user) if job.get("used_personal_key") else None
        task = await meshy_service.get_task(job["meshy_task_id"], job["kind"], api_key=poll_key)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Meshy poll failed: {e.response.status_code}")
    status = task.get("status", "PENDING")
    progress = task.get("progress", 0)
    update: dict = {
        "status": status,
        "progress": progress,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if status == "SUCCEEDED":
        update["model_url"] = meshy_service.pick_model_url(task)
    elif status == "FAILED":
        update["error"] = (task.get("task_error") or {}).get("message", "unknown")
    await db.ai_jobs.update_one({"job_id": job_id}, {"$set": update})
    job.update(update)
    return job


@api_router.get("/ai/jobs/{job_id}/mesh")
async def ai_job_mesh(job_id: str, request: Request):
    """Stream the generated mesh binary to the user. The frontend feeds this
    directly into the existing STL/GLB import pipeline (no new code needed)."""
    user = await get_current_user(request)
    job = await db.ai_jobs.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "SUCCEEDED" or not job.get("model_url"):
        raise HTTPException(status_code=409, detail=f"Job not ready (status={job['status']})")
    try:
        data = await meshy_service.download_mesh(job["model_url"])
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Mesh download failed: {e.response.status_code}")
    # Filename hint based on the URL's extension. Strip any query string
    # (Meshy CDN URLs end with .stl?Expires=...) before checking.
    url_path = job["model_url"].split("?")[0].lower()
    ext = "stl" if url_path.endswith(".stl") else ("obj" if url_path.endswith(".obj") else "glb")
    return Response(
        content=data,
        media_type=("model/stl" if ext == "stl" else ("model/obj" if ext == "obj" else "model/gltf-binary")),
        headers={"Content-Disposition": f'attachment; filename="ai-mesh-{job_id[:8]}.{ext}"'},
    )


# ---------- Models ----------
class GalleryItemCreate(BaseModel):
    name: str
    author: str = "Anonymous"
    description: str = ""
    stl_base64: str             # base64-encoded STL bytes
    thumbnail_base64: str = ""  # base64-encoded PNG data url (without prefix)
    triangle_count: int = 0
    object_count: int = 0
    remix_of: Optional[str] = None  # id of the parent gallery item, if this is a remix
    # Editable project JSON (serialized scene). When present, Remix restores
    # the original parts/modifiers/groups instead of importing a flat STL.
    # Stored as a string so the front-end can JSON.parse on load and avoid
    # arbitrary-shape coupling between Pydantic and the scene schema.
    data: Optional[str] = None
    # When true, the item is private to its owner — never returned by the
    # public list endpoint, only by /api/me/designs.
    private: bool = False
    # SPDX-style license identifier (e.g. "cc-by-4.0", "agpl-3.0"). Stored as
    # a free-text id so we can grow the catalog without DB migrations. The
    # frontend canonicalises against /app/frontend/src/lib/licenses.js.
    license: str = "cc-by-4.0"
    # Suggested filament/material for the print (PLA default). Free-text so
    # we can grow the option set without migrations; frontend canonicalises
    # against /app/frontend/src/lib/materials.js.
    material: str = "pla"
    # True when the STL was produced via manifold-3d (guaranteed watertight,
    # zero open edges). Surfaces as a "Manifold ✓" badge on Gallery cards
    # so remixers see at a glance that a design will slice/print cleanly.
    manifold_verified: bool = False
    # Model extents in millimetres (axis-aligned bounding box of the
    # baked STL). Surfaces as an "X×Y×Z mm" chip on Gallery cards + the
    # STL Preview's stats overlay so makers can eyeball whether a design
    # fits their bed before downloading. Optional — legacy items don't
    # have it and will render without the chip.
    bbox_mm: Optional[dict] = None  # {"x": float, "y": float, "z": float}
    # Shoppable category id from `gallery_taxonomy.CATEGORIES` (e.g.
    # "household", "toys"). Free-text validation against the taxonomy
    # set in the route handler so we can grow categories without a
    # schema bump on every release.
    category: str = "misc"
    # Free-form tags — short keywords like "keychain", "outdoor",
    # "bambu". Used for chip-style discovery in the Gallery UI. The
    # route normalises (lower-case, dash-collapsed, ≤24 chars/tag, ≤8
    # tags/item) so the index stays small.
    tags: List[str] = []


class GalleryItemMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    author: str
    description: str
    triangle_count: int
    object_count: int
    thumbnail_base64: str
    created_at: datetime
    downloads: int = 0
    remix_of: Optional[str] = None
    remix_count: int = 0
    # Surfaces ownership + visibility so the UI can show edit/delete buttons
    # only on the user's own items and a "Private" badge on hidden ones.
    user_id: Optional[str] = None
    private: bool = False
    license: str = "cc-by-4.0"
    material: str = "pla"
    # Surfaces in the Gallery as a "Manifold ✓" badge when true.
    manifold_verified: bool = False
    # Model extents in mm (X/Y/Z). Optional — None on legacy items.
    bbox_mm: Optional[dict] = None
    # Discovery metadata — surfaced as chips on the Gallery card.
    category: str = "misc"
    tags: List[str] = []
    # Whether this item has been editorially featured by an admin
    # (hybrid creator-spotlight signal — combined with algorithmic
    # remix-count ranking by /api/gallery/featured-creators).
    is_featured: bool = False


class CommunityPrinterCreate(BaseModel):
    brand: str
    name: str
    submitter: str = "Anonymous"
    build_x: float
    build_y: float
    build_z: float
    max_nozzle_temp: int = 260
    max_bed_temp: int = 100
    default_nozzle: float = 0.4
    default_print_speed: int = 100
    notes: str = ""


class CommunityPrinter(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    brand: str
    name: str
    submitter: str
    build_x: float
    build_y: float
    build_z: float
    max_nozzle_temp: int
    max_bed_temp: int
    default_nozzle: float
    default_print_speed: int
    notes: str
    created_at: datetime
    uses: int = 0
    votes: int = 0
    verified: bool = False


@api_router.get("/")
async def root():
    return {"message": "ForgeSlicer API", "version": "1.0.0"}


@api_router.post("/gallery", response_model=GalleryItemMeta)
async def create_gallery_item(item: GalleryItemCreate, request: Request):
    item_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    user = await get_optional_user(request)
    # Logged-in users get attribution from their profile name and own the
    # item; anonymous users keep the free-text author field.
    author = (user["name"] if user else (item.author or "Anonymous"))
    # Validate category against the shared taxonomy. Unknown values
    # fall back to "misc" rather than erroring — the client may be
    # behind a deploy and shouldn't be punished for it.
    category = item.category if gallery_taxonomy.is_valid_category(item.category) else "misc"
    # Normalise tags: lower-case, dashed, dedup, capped at 8.
    raw_tags = item.tags or []
    seen, tags = set(), []
    for raw in raw_tags:
        t = gallery_taxonomy.normalise_tag(str(raw))
        if t and t not in seen:
            seen.add(t)
            tags.append(t)
        if len(tags) >= 8:
            break
    doc = {
        "id": item_id,
        "name": item.name,
        "author": author,
        "description": item.description or "",
        "stl_base64": item.stl_base64,
        "thumbnail_base64": item.thumbnail_base64 or "",
        "triangle_count": item.triangle_count,
        "object_count": item.object_count,
        "created_at": created_at.isoformat(),
        "downloads": 0,
        "remix_of": item.remix_of,
        "remix_count": 0,
        # Persist the editable project JSON so a future Remix can restore
        # every primitive with its negative/positive modifier and dimensions.
        "data": item.data or None,
        "user_id": user["user_id"] if user else None,
        "private": bool(item.private) if user else False,
        "license": (item.license or "cc-by-4.0").strip()[:40],
        "material": (item.material or "pla").strip().lower()[:20],
        "manifold_verified": bool(item.manifold_verified),
        "bbox_mm": item.bbox_mm if isinstance(item.bbox_mm, dict) else None,
        "category": category,
        "tags": tags,
        "is_featured": False,
    }
    await db.gallery.insert_one(doc)
    if item.remix_of:
        await db.gallery.update_one({"id": item.remix_of}, {"$inc": {"remix_count": 1}})
    return _gallery_meta_from_doc(doc)


def _gallery_meta_from_doc(d: dict) -> GalleryItemMeta:
    ca = d.get("created_at")
    if isinstance(ca, str):
        try:
            ca = datetime.fromisoformat(ca)
        except Exception:
            ca = datetime.now(timezone.utc)
    return GalleryItemMeta(
        id=d["id"],
        name=d.get("name", "Untitled"),
        author=d.get("author", "Anonymous"),
        description=d.get("description", ""),
        triangle_count=d.get("triangle_count", 0),
        object_count=d.get("object_count", 0),
        thumbnail_base64=d.get("thumbnail_base64", ""),
        created_at=ca,
        downloads=d.get("downloads", 0),
        remix_of=d.get("remix_of"),
        remix_count=d.get("remix_count", 0),
        user_id=d.get("user_id"),
        private=bool(d.get("private", False)),
        license=d.get("license", "cc-by-4.0"),
        material=d.get("material", "pla"),
        manifold_verified=bool(d.get("manifold_verified", False)),
        bbox_mm=d.get("bbox_mm") if isinstance(d.get("bbox_mm"), dict) else None,
        category=d.get("category", "misc"),
        tags=list(d.get("tags") or []),
        is_featured=bool(d.get("is_featured", False)),
    )


@api_router.get("/gallery", response_model=List[GalleryItemMeta])
async def list_gallery(
    request: Request,
    material: Optional[str] = None,
    mine: bool = False,
    category: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = 500,
):
    # Public listing — hide private items entirely. When `mine=true` the
    # caller wants their own designs (public + private) instead; we resolve
    # the user from the cookie and switch the query accordingly so users
    # can find their private items from the same gallery import flow.
    if mine:
        user = await get_optional_user(request)
        if not user:
            return []
        query: dict = {"user_id": user["user_id"]}
    else:
        query = {"$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}]}
    extra: list = []
    if material:
        extra.append({"material": material.strip().lower()[:20]})
    if category and gallery_taxonomy.is_valid_category(category):
        extra.append({"category": category})
    if tag:
        t = gallery_taxonomy.normalise_tag(tag)
        if t:
            extra.append({"tags": t})
    if extra:
        # Combine with the visibility filter via $and so we don't lose it.
        query = {"$and": [query, *extra]}
    cursor = db.gallery.find(
        query,
        {"_id": 0, "stl_base64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(max(1, min(500, int(limit))))
    return [_gallery_meta_from_doc(d) for d in items]


@api_router.get("/me/designs", response_model=List[GalleryItemMeta])
async def list_my_designs(request: Request):
    user = await get_current_user(request)
    cursor = db.gallery.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "stl_base64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(500)
    return [_gallery_meta_from_doc(d) for d in items]


@api_router.get("/gallery/{item_id}/download")
async def download_gallery_stl(item_id: str):
    doc = await db.gallery.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    stl_b64 = doc.get("stl_base64", "")
    try:
        stl_bytes = base64.b64decode(stl_b64)
    except Exception as e:
        # Always raise here so we never fall through with an undefined
        # `stl_bytes`. The 500 surfaces "DB blob is malformed" to the client.
        raise HTTPException(status_code=500, detail=f"Corrupted STL data: {e}")
    # Sanity-check the payload before returning it. A valid binary STL
    # needs at LEAST 84 bytes (80-byte header + 4-byte triangle count).
    # ASCII STL files always start with "solid " (case-insensitive, with
    # a trailing space or newline). Without this gate the download
    # endpoint will happily return 3 bytes of zeros from corrupted /
    # seed rows, and the client-side STLLoader throws an opaque
    # "Offset is outside the bounds of the DataView" — what GAL-00
    # reproduced. Returning 422 + an explicit detail string lets the
    # gallery preview dialog show a friendly message instead.
    if len(stl_bytes) < 84:
        is_ascii_stl = (
            len(stl_bytes) >= 6
            and stl_bytes[:6].lower().startswith(b"solid ")
        )
        if not is_ascii_stl:
            raise HTTPException(
                status_code=422,
                detail=(
                    "This gallery item has no usable STL payload "
                    f"(only {len(stl_bytes)} bytes stored). It may be a "
                    "placeholder / seed row; ask the creator to re-publish."
                ),
            )
    await db.gallery.update_one({"id": item_id}, {"$inc": {"downloads": 1}})
    safe_name = "".join(c for c in doc.get("name", "model") if c.isalnum() or c in ("-", "_")) or "model"
    return Response(
        content=stl_bytes,
        media_type="model/stl",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.stl"'},
    )


@api_router.get("/gallery/{item_id}")
async def get_gallery_item(item_id: str):
    """Return the full gallery record (including editable `data` JSON) so the
    workspace can restore the original parts list when a user clicks Remix —
    not just the baked STL, which would lose all negative/positive tagging."""
    doc = await db.gallery.find_one(
        {"id": item_id},
        {"_id": 0, "stl_base64": 0, "thumbnail_base64": 0},  # strip heavy blobs
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    return doc


@api_router.delete("/gallery/{item_id}")
async def delete_gallery_item(item_id: str, request: Request):
    doc = await db.gallery.find_one({"id": item_id}, {"_id": 0, "user_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    owner_id = doc.get("user_id")
    if owner_id:
        # Owner-only delete for items uploaded by authenticated users.
        user = await get_current_user(request)
        if user["user_id"] != owner_id:
            raise HTTPException(status_code=403, detail="Not your design")
    await db.gallery.delete_one({"id": item_id})
    return {"deleted": True, "id": item_id}


# ---------- Gallery taxonomy ----------
@api_router.get("/gallery/_meta/taxonomy")
async def gallery_taxonomy_meta():
    """Public taxonomy endpoint — single source of truth for the
    category dropdown in ShareDialog + the chip row above the Gallery
    grid. Returns ordered `{id, label}` pairs so the frontend doesn't
    need to hard-code the list. Cache-friendly: the response is static
    until a new category is added on the server."""
    return {
        "categories": [{"id": cid, "label": label} for cid, label in gallery_taxonomy.CATEGORIES],
    }


# ---------- Featured creators ----------
@api_router.get("/gallery/_meta/featured-creators")
async def featured_creators(limit: int = 6):
    """Hybrid creator spotlight.

    Selection logic:
      1. Pull the manual editorial pool first — every user who owns at
         least one public gallery item with `is_featured=True`. This is
         the admin-curated lever (see admin set-featured endpoint).
      2. Fill any remaining slots with the algorithmic leaders — top
         authors by sum-of-remix-counts on their public designs in the
         last 90 days, excluding anyone already in the manual pool.

    Returns an ordered list of `{user_id, name, design_count,
    remix_count, featured_thumb_b64}` items the frontend renders as a
    horizontal card strip on the Gallery + Landing pages.
    """
    limit = max(1, min(20, int(limit)))
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=90)).isoformat()

    # --- 1. Manual editorial picks ---
    manual_cursor = db.gallery.aggregate([
        {"$match": {"is_featured": True,
                    "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
                    "user_id": {"$ne": None}}},
        {"$group": {
            "_id": "$user_id",
            "name": {"$first": "$author"},
            "design_count": {"$sum": 1},
            "remix_count": {"$sum": {"$ifNull": ["$remix_count", 0]}},
            "featured_thumb_b64": {"$first": "$thumbnail_base64"},
        }},
        {"$sort": {"remix_count": -1, "design_count": -1}},
        {"$limit": limit},
    ])
    manual = await manual_cursor.to_list(limit)
    out: list[dict] = [
        {
            "user_id": d["_id"],
            "name": d.get("name") or "Maker",
            "design_count": int(d.get("design_count") or 0),
            "remix_count": int(d.get("remix_count") or 0),
            "featured_thumb_b64": d.get("featured_thumb_b64") or "",
            "source": "editorial",
        }
        for d in manual
    ]

    # --- 2. Algorithmic top-up ---
    remaining = limit - len(out)
    if remaining > 0:
        excluded = {item["user_id"] for item in out}
        algo_cursor = db.gallery.aggregate([
            {"$match": {
                "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
                "user_id": {"$ne": None, "$nin": list(excluded)},
                "created_at": {"$gte": since},
            }},
            {"$group": {
                "_id": "$user_id",
                "name": {"$first": "$author"},
                "design_count": {"$sum": 1},
                "remix_count": {"$sum": {"$ifNull": ["$remix_count", 0]}},
                "featured_thumb_b64": {"$first": "$thumbnail_base64"},
            }},
            # Sort by remix_count first (community-validated quality),
            # then design_count (productivity), then take the top N.
            {"$sort": {"remix_count": -1, "design_count": -1}},
            {"$limit": remaining},
        ])
        algo = await algo_cursor.to_list(remaining)
        out.extend(
            {
                "user_id": d["_id"],
                "name": d.get("name") or "Maker",
                "design_count": int(d.get("design_count") or 0),
                "remix_count": int(d.get("remix_count") or 0),
                "featured_thumb_b64": d.get("featured_thumb_b64") or "",
                "source": "algorithmic",
            }
            for d in algo
        )

    return out


# ---------- Admin: feature/unfeature a creator's flagship design ----------
class FeaturedDesignRequest(BaseModel):
    item_id: str
    featured: bool = True


@api_router.post("/admin/gallery/feature-design")
async def admin_feature_design(req: FeaturedDesignRequest, request: Request):
    """Admin lever for the editorial half of /featured-creators. Marks
    a single gallery item as featured; any user who owns at least one
    featured item shows up in the manual pool. We feature an *item*
    rather than a user so admins can spotlight a specific viral design
    (the thumbnail surfaces on the strip)."""
    await _require_admin_for_upstream(request)
    upd = await db.gallery.update_one(
        {"id": req.item_id},
        {"$set": {"is_featured": bool(req.featured)}},
    )
    if upd.matched_count == 0:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    return {"id": req.item_id, "is_featured": bool(req.featured)}


# ---------- Community Printer Profiles ----------
@api_router.post("/printers", response_model=CommunityPrinter)
async def create_community_printer(p: CommunityPrinterCreate):
    pid = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    doc = {
        "id": pid,
        "brand": p.brand.strip()[:40] or "Custom",
        "name": p.name.strip()[:60] or "Printer",
        "submitter": (p.submitter or "Anonymous").strip()[:40] or "Anonymous",
        "build_x": float(p.build_x),
        "build_y": float(p.build_y),
        "build_z": float(p.build_z),
        "max_nozzle_temp": int(p.max_nozzle_temp),
        "max_bed_temp": int(p.max_bed_temp),
        "default_nozzle": float(p.default_nozzle),
        "default_print_speed": int(p.default_print_speed),
        "notes": (p.notes or "").strip()[:280],
        "created_at": created_at.isoformat(),
        "uses": 0,
        "votes": 0,
        "verified": False,
    }
    await db.community_printers.insert_one(doc)
    return CommunityPrinter(**{**doc, "created_at": created_at})


@api_router.get("/printers", response_model=List[CommunityPrinter])
async def list_community_printers():
    # Sort by votes desc, then by created_at desc so top-voted entries surface first.
    cursor = db.community_printers.find({}, {"_id": 0}).sort(
        [("verified", -1), ("votes", -1), ("created_at", -1)]
    )
    items = await cursor.to_list(1000)
    out = []
    for d in items:
        ca = d.get("created_at")
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca)
            except Exception:
                ca = datetime.now(timezone.utc)
        out.append(CommunityPrinter(**{
            **d,
            "created_at": ca,
            "votes": d.get("votes", 0),
            "verified": d.get("verified", False),
        }))
    return out


@api_router.post("/printers/{printer_id}/use")
async def increment_printer_use(printer_id: str):
    res = await db.community_printers.update_one(
        {"id": printer_id}, {"$inc": {"uses": 1}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Printer not found")
    return {"ok": True}


@api_router.post("/printers/{printer_id}/upvote")
async def upvote_printer(printer_id: str):
    res = await db.community_printers.update_one(
        {"id": printer_id}, {"$inc": {"votes": 1}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Printer not found")
    doc = await db.community_printers.find_one({"id": printer_id}, {"_id": 0, "votes": 1})
    return {"ok": True, "votes": doc.get("votes", 0)}


@api_router.delete("/printers/{printer_id}")
async def delete_community_printer(printer_id: str):
    res = await db.community_printers.delete_one({"id": printer_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Printer not found")
    return {"deleted": True, "id": printer_id}


# ---------- Component Library ----------
# A separate collection from the gallery so we can filter/sort independently
# and keep upvote semantics distinct (gallery items track downloads; library
# components track upvotes + uses).
COMPONENT_CATEGORIES = {
    "mechanical", "rack", "mounting", "fasteners", "electronics",
    "brackets", "hinges", "gears", "decorative", "organizers",
    "miniatures", "structural", "toys", "misc",
}


class ComponentCreate(BaseModel):
    name: str
    author: str = "Anonymous"
    description: str = ""
    modifier: str = "positive"          # "positive" or "negative"
    category: str = "misc"              # one of COMPONENT_CATEGORIES
    tags: str = ""                      # free-text, comma-separated
    stl_base64: str
    project_json: str = ""              # ForgeSlicer project JSON for editable add-to-scene
    thumbnail_base64: str = ""
    triangle_count: int = 0
    object_count: int = 0
    private: bool = False               # owner-only when true
    license: str = "cc-by-4.0"          # SPDX-style id; see frontend licenses catalog


class ComponentMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    author: str
    description: str
    modifier: str
    category: str
    tags: str
    thumbnail_base64: str
    triangle_count: int
    object_count: int
    created_at: datetime
    uses: int = 0
    votes: int = 0
    user_id: Optional[str] = None
    private: bool = False
    verified: bool = False
    license: str = "cc-by-4.0"


def _normalize_modifier(m: str) -> str:
    return "negative" if (m or "").lower() == "negative" else "positive"


def _normalize_category(c: str) -> str:
    c = (c or "").lower().strip()
    return c if c in COMPONENT_CATEGORIES else "misc"


@api_router.post("/components", response_model=ComponentMeta)
async def create_component(item: ComponentCreate, request: Request):
    item_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    user = await get_optional_user(request)
    author = (user["name"] if user else ((item.author or "Anonymous").strip()[:40]))
    doc = {
        "id": item_id,
        "name": (item.name or "Untitled").strip()[:80],
        "author": author,
        "description": (item.description or "").strip()[:500],
        "modifier": _normalize_modifier(item.modifier),
        "category": _normalize_category(item.category),
        "tags": (item.tags or "").strip()[:200],
        "stl_base64": item.stl_base64,
        "project_json": item.project_json or "",
        "thumbnail_base64": item.thumbnail_base64 or "",
        "triangle_count": int(item.triangle_count),
        "object_count": int(item.object_count),
        "created_at": created_at.isoformat(),
        "uses": 0,
        "votes": 0,
        "user_id": user["user_id"] if user else None,
        "private": bool(item.private) if user else False,
        "verified": False,
        "license": (item.license or "cc-by-4.0").strip()[:40],
    }
    await db.components.insert_one(doc)
    return ComponentMeta(**{**doc, "created_at": created_at})


@api_router.get("/components", response_model=List[ComponentMeta])
async def list_components(
    request: Request,
    modifier: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
    mine: bool = False,
):
    # When `mine=true`, return the caller's own components (public + private)
    # so they can find/import items they saved as private. Otherwise show
    # only public items.
    if mine:
        user = await get_optional_user(request)
        if not user:
            return []
        query: dict = {"user_id": user["user_id"]}
    else:
        query = {"$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}]}
    if modifier:
        query["modifier"] = _normalize_modifier(modifier)
    if category:
        query["category"] = _normalize_category(category)
    if q:
        # Case-insensitive substring search across name / description / tags / author.
        regex = {"$regex": q.strip()[:80], "$options": "i"}
        # Combine with existing filter using $and.
        query = {"$and": [
            query,
            {"$or": [
                {"name": regex}, {"description": regex},
                {"tags": regex}, {"author": regex},
            ]},
        ]}
    cursor = db.components.find(
        query,
        {"_id": 0, "stl_base64": 0, "project_json": 0},
    ).sort([("verified", -1), ("votes", -1), ("created_at", -1)])
    items = await cursor.to_list(500)
    out = []
    for d in items:
        ca = d.get("created_at")
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca)
            except Exception:
                ca = datetime.now(timezone.utc)
        out.append(ComponentMeta(**{**d, "created_at": ca}))
    return out


@api_router.get("/me/components", response_model=List[ComponentMeta])
async def list_my_components(request: Request):
    user = await get_current_user(request)
    cursor = db.components.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "stl_base64": 0, "project_json": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(500)
    out = []
    for d in items:
        ca = d.get("created_at")
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca)
            except Exception:
                ca = datetime.now(timezone.utc)
        out.append(ComponentMeta(**{**d, "created_at": ca}))
    return out


@api_router.get("/components/{cid}/project")
async def get_component_project(cid: str):
    """Return the editable ForgeSlicer JSON for a component (used by "Add to Scene")."""
    doc = await db.components.find_one(
        {"id": cid},
        {"_id": 0, "project_json": 1, "name": 1, "modifier": 1, "stl_base64": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Component not found")
    await db.components.update_one({"id": cid}, {"$inc": {"uses": 1}})
    return {
        "name": doc.get("name", "Component"),
        "modifier": doc.get("modifier", "positive"),
        "project_json": doc.get("project_json", ""),
        # Fallback: STL bytes (b64) so the frontend can still import even if
        # project_json is missing (older components).
        "stl_base64": doc.get("stl_base64", ""),
    }


@api_router.post("/components/{cid}/upvote")
async def upvote_component(cid: str):
    res = await db.components.update_one({"id": cid}, {"$inc": {"votes": 1}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Component not found")
    doc = await db.components.find_one({"id": cid}, {"_id": 0, "votes": 1})
    return {"ok": True, "votes": doc.get("votes", 0)}


@api_router.post("/components/{cid}/verify")
async def toggle_verified(cid: str, request: Request):
    """Admin-only toggle for the 'verified' badge on a component. Reads the
    allowlist from ADMIN_EMAILS env (comma-separated). With no allowlist set,
    the endpoint is disabled to prevent accidental abuse."""
    admin_emails = [e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()]
    if not admin_emails:
        raise HTTPException(status_code=403, detail="Admin allowlist not configured")
    user = await get_current_user(request)
    if (user.get("email") or "").lower() not in admin_emails:
        raise HTTPException(status_code=403, detail="Not an admin")
    doc = await db.components.find_one({"id": cid}, {"_id": 0, "verified": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Component not found")
    new_state = not bool(doc.get("verified", False))
    await db.components.update_one({"id": cid}, {"$set": {"verified": new_state}})
    return {"ok": True, "id": cid, "verified": new_state}


@api_router.delete("/components/{cid}")
async def delete_component(cid: str, request: Request):
    doc = await db.components.find_one({"id": cid}, {"_id": 0, "user_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Component not found")
    owner_id = doc.get("user_id")
    if owner_id:
        user = await get_current_user(request)
        if user["user_id"] != owner_id:
            raise HTTPException(status_code=403, detail="Not your component")
    await db.components.delete_one({"id": cid})
    return {"deleted": True, "id": cid}


# ---------- Voice Command Parser ----------
# Browser does speech-to-text via Web Speech API; we receive the transcript
# here and use GPT-5.2 to convert it into a strict JSON command the frontend
# can execute. Keeping the LLM call server-side lets us keep the API key
# secret and reuse the prompt across UI surfaces.
#
# Optional /api/voice/transcribe endpoint uses OpenAI Whisper-1 for cases
# where the Web Speech API isn't available (Safari, Firefox) or produces
# poor results for non-US-English accents. Browser records audio with
# MediaRecorder and POSTs the blob; we transcribe and return text.
from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402
from emergentintegrations.llm.openai import OpenAISpeechToText  # noqa: E402
from fastapi import UploadFile, File                            # noqa: E402
import json as _json                                              # noqa: E402
import tempfile                                                   # noqa: E402

VOICE_SYSTEM_PROMPT = """You are ForgeSlicer's voice command parser. The user speaks
CAD commands; you MUST respond with ONLY a JSON object (no prose, no markdown
fences) describing the action. If the user says something you cannot map to a
valid command, return {"action":"unknown","speech":"<echo of input>"}.

ALLOWED ACTIONS and their schemas:

1. Add a primitive:
   {"action":"add","type":"cube"|"sphere"|"cylinder"|"cone"|"torus"|"circle"|"square2d"|"triangle"|"polygon",
    "modifier":"positive"|"negative",
    "dims":{ ... see per-type below ... },
    "position":{x,y,z}?,        # optional — places the CENTRE of the part at (x,y,z) mm.
    "rotation":{x,y,z}?}        # optional — Euler degrees applied at creation.
   dims by type (all values in millimetres unless noted):
     cube     : {x,y,z}
     sphere   : {r}
     cylinder : {r,h}
     cone     : {r,h}
     torus    : {r,tube}
     circle   : {r,h}            # h = thin wafer height
     square2d : {side,h}
     triangle : {r,h}
     polygon  : {r,sides,h}

   POSITION RULES (critical — when the user mentions ANY coordinate or
   anchor, you MUST include `position`. Never drop coordinates silently;
   if you can't be confident, return action="unknown" instead):
   - "at (X, Y, Z)" / "position X Y Z" / "centred at X Y Z" — treat as
     centre coordinates. Convert directly to `{x: X, y: Y, z: Z}`.
   - "upper-left corner at (X, Y)" — the user is specifying where ONE
     CORNER sits. Compute the centre yourself:
       cube w×d at corner C:
         "upper-left at (X, Y)"  → centre = (X + w/2, Y - d/2)
         "lower-left at (X, Y)"  → centre = (X + w/2, Y + d/2)
         "upper-right at (X, Y)" → centre = (X - w/2, Y - d/2)
         "lower-right at (X, Y)" → centre = (X - w/2, Y + d/2)
     "Upper" / "lower" refer to the +Y / -Y bed axis (top-down sketch view).
   - Two-coordinate placement "at (X, Y)" implies Z defaults to half the
     part's height so the bottom sits on the bed (Y=0 in world). E.g. a
     cube 10×10×5 placed "at (-35, -14)" → centre (-35, -14, 2.5).
   - If the user gives BOTH a position and a uniform `bottom on bed` ask,
     respect the position they typed.

2. Transform the current selection:
   {"action":"translate","delta":{x,y,z}}      # mm, additive
   {"action":"rotate","delta":{x,y,z}}          # degrees, additive Euler
   {"action":"scale","factor":{x,y,z}}          # multiplicative ratio
   {"action":"resize","dims":{x?,y?,z?,r?,h?,side?,tube?,sides?}}  # set primitive dims
   {"action":"position","pos":{x,y,z}}          # absolute mm
   {"action":"drop"}                            # drop selection to bed (Y=0)

3. Selection / scene management:
   {"action":"delete"}                  # delete selection
   {"action":"duplicate","mirror":null|"x"|"y"|"z"}
   {"action":"group"}                   # group current multi-selection
   {"action":"ungroup"}
   {"action":"select_all"}
   {"action":"clear_selection"}
   {"action":"undo"}
   {"action":"redo"}

4. Boolean ops on current selection (need 2+ objects):
   {"action":"boolean","op":"union"|"subtract"|"intersect"}

5. Mode switch:
   {"action":"mode","mode":"translate"|"rotate"|"scale"}

6. Open named dialog:
   {"action":"open","dialog":"save_component"|"share_gallery"|"slicer"|"position"|"rotation"|"size"|"ai_generate"}

7. Export:
   {"action":"export","format":"stl"|"3mf"|"gcode"|"project"}

8. AI mesh generation (text-to-3D via Meshy):
   {"action":"ai_generate","prompt":"<the thing to generate>","auto":true|false}
   - Use this when the user clearly says "generate", "create with AI", "AI a …",
     "make me a … with AI", or similar.
   - `prompt` should be the noun phrase / description ONLY (drop the "generate"
     / "ai" verb), e.g. "a small articulated dragon for FDM printing".
   - Set `auto`:true when the user's intent is unambiguous and they want it
     submitted immediately ("Generate a dragon and add it"). Set false when
     the request feels exploratory ("Open the AI generator", "I want to make
     something with AI") — that just opens the dialog with the prompt
     pre-filled so the user can review.
   - If the user only asks to OPEN the AI dialog (no subject yet), use
     action="open" with dialog="ai_generate" and OMIT the prompt.

9. Multi-step plan (NEW — for compound requests):
   {"action":"plan", "steps":[ <step>, <step>, ... ]}
   where each <step> is one of the atomic actions above (typically
   "add" / "boolean" / "group" / "translate" / "rotate"). Use this when
   the user asks for something that needs more than one atomic action,
   e.g. "add a cube and rotate it 30 degrees on Z", "add 4 holes inset
   5mm from each corner of the selection". Number of steps should be
   minimal but complete. Each step may carry an optional "note" string
   explaining what it does — surface it to the user via the preview.

   PLAN AUTHORING RULES:
   - PREFER self-contained "add" steps with the final `position` and
     `rotation` baked in. For "4 holes at the corners", emit FOUR
     separate `add` cylinder steps each with its own `position`, NOT
     one `add` followed by `duplicate`/`position` chains. This makes
     the preview readable and avoids cross-step selection tracking.
   - For "boolean" steps, set `targets` to one of: "all-current"
     (everything this plan added so far), "all-positives", "all-since:<tag>",
     "tag:<tag>", or "step:<index>". DO NOT assume the user's existing
     selection survives the plan.
   - Tag intermediate steps you'll reference later with `tag: "..."`.
   - End the plan with `boolean subtract` (or whatever the user wants)
     and optionally a `group` step so the user gets a tidy assembly.

10. Parametric template (NEW — for catalogued parts):
    {"action":"template", "template_id":"...", "params":{...}}
    Use this when the request maps to a CATALOGUED template (listed
    below). Extract param values from the transcript; omit ones the user
    didn't mention (the backend has defaults). Available templates and
    their parameter shapes:

%TEMPLATE_CATALOG%

    Examples:
      • "Create a faceplate for a Raspberry Pi 4" →
        {"action":"template","template_id":"board_faceplate",
         "params":{"board":"raspberry_pi_4b"}}
        (defaults: a VERTICAL wall faceplate for the +y long-edge
         connectors. NOT a flat tray and NOT a full mounting plate.)
      • "Add a matching backplate for the Pi 4" / "Make a backplate
         for the Pi 4 with the USB-C and HDMI cutouts" →
        {"action":"template","template_id":"board_faceplate",
         "params":{"board":"raspberry_pi_4b", "faces":["-x"]}}
        (Same template, just with `faces:['-x']` — wall-orientation
         honours the FIRST face in the list, so passing -x produces
         a vertical wall sized to the SHORT edge with USB-C / HDMI /
         audio cutouts. Pair it with the default +y faceplate to get
         a front+back set ready to glue into an enclosure.)
      • "Create a Pi 4 mounting tray with the mount holes" →
        {"action":"template","template_id":"board_faceplate",
         "params":{"board":"raspberry_pi_4b", "include_mount_holes":true,
                   "orientation":"tray", "faces":["+y","-x"]}}
      • "Create a Pi 4 faceplate with the HDMI and USB-C cutouts" →
        {"action":"template","template_id":"board_faceplate",
         "params":{"board":"raspberry_pi_4b", "faces":["-x"]}}
      • "Add the three cutouts for the USB and Ethernet connectors of an RPI4" →
        {"action":"template","template_id":"board_faceplate",
         "params":{"board":"raspberry_pi_4b", "faces":["+y"], "skip_plate":true}}
        (DESCRIBING the long-edge connectors of a board → faceplate
         template with faces=["+y"]; "the three cutouts" / "USB +
         Ethernet" / "the connectors on the side" all map to the +y face.
         Use skip_plate:true when the user clearly wants ONLY the cutout
         negatives — not a plate around them — so the template returns
         floating negative pockets the user can drop onto their own plate.)
      • "Add USB, HDMI, and audio cutouts for a Pi 4" →
        {"action":"template","template_id":"board_faceplate",
         "params":{"board":"raspberry_pi_4b","faces":["+y","-x"],"skip_plate":true}}
        (USB+Ethernet → "+y"; HDMI/USB-C/audio jack → "-x".)
      • "Make a 90-degree bracket for a 6 inch deep shelf that's
         1 inch thick and supports 30 pounds" →
        {"action":"template","template_id":"right_angle_bracket",
         "params":{"shelf_depth_in":6,"shelf_thickness_in":1,"load_lb":30}}

    DESCRIPTIVE → TEMPLATE MAPPING (CRITICAL — do NOT return "unknown" when
    the user describes a known PART by its FUNCTION instead of by name):
    - "cutouts for [board] connectors" / "openings for the ports of [board]"
      / "the holes for the [USB/HDMI/Ethernet] on [board]" →
      `board_faceplate` template. Identify the board from any mentioned
      model name (Pi 4, Pi 5, Arduino Mega, etc) and the connector list
      from any face hints (USB+Ethernet → +y, HDMI/USB-C → -x).
    - "mounting plate / tray / front panel for [board]" → `board_faceplate`.
    - "matching backplate / back panel / back wall for [board]" →
      `board_faceplate` with `faces:['-x']` — the short-edge wall that
      pairs with the default +y faceplate to form an enclosure F+B.
    - "shelf bracket / corner brace / L-bracket / angle iron" →
      `right_angle_bracket`.
    - "cabinet handle / drawer handle / pull / knob" → `drawer_pull`.
    - "screwdriver / wrench / pen / brush holder" → `tool_holder`.
    - "cable comb / cable organiser / desk-edge cable manager" → `cable_comb`.
    - "spool spacer / spool adapter / hub adapter for filament" →
      `spool_spacer`.
    - "soft jaws / vise jaws / bench-vise inserts / V-block jaws" →
      `vise_jaws`.
    - "project enclosure / project box / electronics box / parts box" →
      `project_enclosure`.
    - "hose adapter / hose reducer / barbed fitting / fitting between
       two hoses" → `hose_adapter`.

    If the user gives a POSITION for the WHOLE generated template (e.g.
    "with the lower-left corner at (X, Y)" or "centred at (X, Y, Z)"),
    emit a TWO-step PLAN: the template followed by a TRANSLATE applied
    to everything the template just produced. Use `translate` with delta
    (not `position` with absolute coords) because templates emit many
    parts and a translate shifts them all coherently:
       {"action":"plan","steps":[
         {"action":"template","template_id":"board_faceplate","params":{...}},
         {"action":"translate","targets":["all-current"],
          "delta":{"x":X_offset,"y":0,"z":Y_offset}}
       ]}
    The 2D coords the user types map to world (X → world X, Y → world Z).
    For "centred at (X, Y)" use delta = (X, 0, Y). For "lower-left at
    (X, Y)" the user wants the assembly's MIN corner at those coords; if
    you know the template's L×W (e.g. Pi 4 = 85×56 mm), shift the centre
    to (X+L/2, 0, Y+W/2). When unsure of L×W, use delta = (X, 0, Y) and
    note "approximate — adjust if needed" in the step's `note` field.

SCENE CONTEXT (NEW): the request body may include a "scene" field with
{selection:{bbox:{min:[x,y,z],max:[x,y,z]},count}, build_volume:{x,y,z},
object_count, mode}. Use it to ground references like "the selected
item", "each corner", "the cube I just added". If the user references
"the selection" but `scene.selection.count == 0`, return action="unknown"
with speech echoing the transcript — we'd rather fail than guess.

RULES:
- Output MUST be valid JSON, no markdown.
- Omit keys you cannot determine instead of guessing.
- Default modifier is "positive" unless the user says "hole", "cutout", "subtract", "negative".
- If the user gives X×Y×Z but says "cylinder" infer cylinder with r = max(x,y)/2 and h = z.
- "make it 50mm wide" => resize with x=50 (when current selection exists).
- Prefer a TEMPLATE over a hand-rolled PLAN when the request matches one cleanly
  (boards, brackets) — templates are deterministic and well-tested.
- Always prefer the schema; if in doubt, use action="unknown".

DIM CONVENTION (CRITICAL — for plans and ad-hoc adds, NOT for templates which
already know):
  ForgeSlicer uses CAD-standard Z-up axes (matches SolidWorks / Fusion 360 /
  OnShape / FreeCAD):
    • +X = right, +Y = forward (depth into the bed away from the viewer),
      +Z = UP (height, print direction).
    • dims map 1:1 to world axes:
        dims.x → world X (WIDTH, left-right)
        dims.y → world Y (DEPTH, front/back)
        dims.z → world Z (HEIGHT, UP)  ← thickness for a flat plate
    • position is [world_x, world_y_forward, world_z_up].
  For a flat plate / faceplate / bracket arm lying on the bed, set the
  THICKNESS in dims.z. Position the part's centre at world_z = thickness/2
  so the bottom sits on Z=0.

  Cylinder axis defaults to world Z (UP). A hole going through a flat
  plate's thickness needs NO rotation; just set h slightly larger than
  the plate thickness and position the cylinder's centre at
  world_z = plate_centre_z (i.e. thickness/2). To make a hole pierce a
  vertical wall along world X, use rotation=[0, 90, 0] (rotate around Y).
  To make a hole pierce along world Y, use rotation=[90, 0, 0] (rotate
  around X).

  For a "hole at each corner of the selected item" with the scene
  bbox provided: read scene.selection.bbox.min and .max, inset by the
  requested margin in X and Y (the bed-plane axes), and emit one cube
  or cylinder per corner with world_z = (bbox.min.z + bbox.max.z) / 2
  and h = (bbox.max.z - bbox.min.z) + 2 so it pokes cleanly through.
"""


class VoiceCommandRequest(BaseModel):
    transcript: str
    model: Optional[str] = "gpt-5.2"
    # iter-100.9 — optional scene snapshot lets the LLM ground references
    # like "the selected item" or "each corner" in actual geometry. The
    # frontend collects this via store.getSceneSnapshot(). Shape:
    #   {selection: {bbox: {min:[x,y,z], max:[x,y,z]}, count}, ...}
    scene: Optional[Dict[str, Any]] = None
    # iter-105.1 — optional chat history for Design Chat multi-turn mode.
    # Each entry: {role: "user"|"assistant", text: str}. Empty / omitted
    # for one-shot voice commands so we don't pay LLM context for them.
    history: Optional[List[Dict[str, Any]]] = None


class VoiceCommandResponse(BaseModel):
    action: str
    raw: dict
    transcript: str


@api_router.post("/voice/command", response_model=VoiceCommandResponse)
async def parse_voice_command(req: VoiceCommandRequest):
    """Parse a free-form voice transcript into a structured CAD command."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="EMERGENT_LLM_KEY not configured")
    text = (req.transcript or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty transcript")
    # Lazy import so the templates package only loads when voice is hit
    # (kept the cold-start cost off every other API call).
    from voice_templates import prompt_descriptions
    system_prompt = VOICE_SYSTEM_PROMPT.replace(
        "%TEMPLATE_CATALOG%", prompt_descriptions()
    )
    # Compose the user message — transcript plus optional compact scene
    # snapshot so the LLM can reason about the current plate.
    user_text = text
    if req.scene:
        # Keep scene payload small — JSON-dump only the keys that
        # actually inform planning. Avoid sending object geometry
        # (worker only needs counts + bbox).
        scene_snip = {
            k: v for k, v in (req.scene or {}).items()
            if k in ("selection", "build_volume", "object_count", "mode")
        }
        user_text = (
            f"USER: {text}\n\n"
            f"SCENE: {_json.dumps(scene_snip, separators=(',',':'))}"
        )
    # iter-105.1 — Design Chat multi-turn: prepend the recent chat history
    # (last ~8 turns, capped) so the LLM has continuity across messages.
    # We summarise instead of dumping raw — assistant replies often
    # include "Done." or step counts that don't help future turns, so we
    # keep the conversational text but strip our standardised "Ran N/N
    # steps." footers.
    if req.history:
        hist_lines = []
        # Keep only the last 8 turns to control token cost. Order is
        # chronological; trim from the front.
        recent = req.history[-8:]
        for h in recent:
            if not isinstance(h, dict):
                continue
            role = (h.get("role") or "").strip().lower()
            t = (h.get("text") or "").strip()
            if not t or role not in ("user", "assistant"):
                continue
            label = "USER" if role == "user" else "YOU"
            hist_lines.append(f"{label}: {t[:600]}")
        if hist_lines:
            user_text = (
                "PRIOR CHAT (oldest → newest):\n"
                + "\n".join(hist_lines)
                + "\n\n---\nLATEST TURN:\n"
                + user_text
            )
    try:
        chat = LlmChat(
            api_key=key,
            session_id=f"voice-{uuid.uuid4().hex[:8]}",
            system_message=system_prompt,
        ).with_model("openai", req.model or "gpt-5.2")
        response = await chat.send_message(UserMessage(text=user_text))
        # Strip any accidental code fences
        body = (response or "").strip()
        if body.startswith("```"):
            # Remove first fence line + optional language hint, then trailing fence
            body = body.split("\n", 1)[1] if "\n" in body else body
            if body.endswith("```"):
                body = body[: -3]
            body = body.strip()
        try:
            data = _json.loads(body)
        except Exception:
            data = {"action": "unknown", "speech": text, "_raw": body[:400]}
        if not isinstance(data, dict) or "action" not in data:
            data = {"action": "unknown", "speech": text}
        return VoiceCommandResponse(action=data["action"], raw=data, transcript=text)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Voice command parse failed")
        raise HTTPException(status_code=500, detail=f"LLM error: {e}")


# Vocabulary hint sent with every Whisper call. The CAD terms ForgeSlicer
# uses ("cylinder", "cube", "union", "subtract", "millimetre", "degrees"...)
# are over-represented in our transcripts, so seeding Whisper with that
# vocab as a `prompt` parameter measurably improves rare-word accuracy
# without slowing it down or constraining outputs.
WHISPER_VOCAB_HINT = (
    "CAD voice commands: add cube, add sphere, add cylinder, add cone, add torus, "
    "positive, negative, union, subtract, intersect, mirror, group, ungroup, "
    "rotate, scale, duplicate, delete, save, undo, redo, drop to bed, "
    "millimetre, millimeters, mm, degrees, X axis, Y axis, Z axis."
)


@api_router.post("/voice/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Server-side STT via OpenAI Whisper. Browser records audio with
    MediaRecorder and POSTs the blob as multipart/form-data. We hand it to
    Whisper-1 and return `{transcript: str}`. Used as a fallback when the
    browser's Web Speech API is unavailable or produces poor results for
    non-US-English accents."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="EMERGENT_LLM_KEY not configured")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB limit")

    # OpenAISpeechToText needs a file-like with a recognised extension. The
    # browser typically uploads `audio/webm;codecs=opus` from MediaRecorder;
    # we keep the original filename so Whisper picks the right decoder.
    # Falls back to .webm because that's the most likely format from Chrome.
    name = (file.filename or "audio.webm").lower()
    if not any(name.endswith(ext) for ext in (".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm")):
        name = "audio.webm"
    suffix = "." + name.rsplit(".", 1)[-1]

    # Use a tempfile so the SDK gets a real file handle (some browsers send
    # streamed bodies that don't survive being re-opened).
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(raw)
        tmp.close()
        stt = OpenAISpeechToText(api_key=key)
        with open(tmp.name, "rb") as fh:
            resp = await stt.transcribe(
                file=fh,
                model="whisper-1",
                language="en",
                prompt=WHISPER_VOCAB_HINT,
                response_format="json",
                temperature=0,
            )
        text = (getattr(resp, "text", None) or "").strip()
        return {"transcript": text}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Whisper transcription failed")
        raise HTTPException(status_code=500, detail=f"Whisper error: {e}")
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


# Voice template expansion. Frontend calls this with the {template_id,
# params} the LLM returned; we run the deterministic builder and return
# the step list. Kept separate from /voice/command so the LLM cost only
# happens once per utterance and the (cheap, pure-Python) expansion can
# be retried / replayed without re-asking the model.
class TemplateExpandRequest(BaseModel):
    template_id: str
    params: Optional[Dict[str, Any]] = None


class TemplateExpandResponse(BaseModel):
    template_id: str
    steps: List[Dict[str, Any]]
    summary: str


@api_router.post("/voice/expand-template", response_model=TemplateExpandResponse)
async def expand_voice_template(req: TemplateExpandRequest):
    """Run a registered template's deterministic builder. Returns the
    ordered step list the frontend Plan Preview will display + execute."""
    from voice_templates import expand, TEMPLATES
    tid = (req.template_id or "").strip()
    if tid not in TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown template_id={tid!r}; known: {sorted(TEMPLATES.keys())}",
        )
    try:
        steps = expand(tid, req.params or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Template expansion failed")
        raise HTTPException(status_code=500, detail=f"Template build error: {e}")
    label = TEMPLATES[tid].META.get("label", tid)
    return TemplateExpandResponse(
        template_id=tid,
        steps=steps,
        summary=f"{label} — {len(steps)} step{'s' if len(steps) != 1 else ''}",
    )


@api_router.get("/voice/templates")
async def list_voice_templates():
    """Public catalogue of voice templates — handy for docs / debug UI."""
    from voice_templates import list_templates
    return {"templates": list_templates()}


app.include_router(api_router)
# Billing routers are mounted on `app` directly because the checkout
# router already has its own /api/billing prefix, and the webhook router
# uses the exact `/api/webhook/stripe` path Stripe expects (no prefix).
app.include_router(billing_api_router)
app.include_router(billing_webhook_router)
app.include_router(braintree_api_router)
app.include_router(sso_bridge_router)
# OpenAI Realtime API (live voice transcription) — mounted under
# /api/v1 to match the integration playbook's documented prefix so the
# frontend WebRTC client can call /api/v1/realtime/session and
# /api/v1/realtime/negotiate without us hand-rolling the paths.
app.include_router(realtime_router, prefix="/api/v1")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    # Wildcard origins + allow_credentials=True is FORBIDDEN by the CORS
    # spec — browsers refuse to store/send the session_token cookie when
    # the response includes `Access-Control-Allow-Origin: *`. That's what
    # was silently logging users out between visits. We reflect a specific
    # origin via regex so cookies stay first-party AND every legitimate
    # deploy host (prod custom domain + preview subdomains + localhost)
    # is supported without hard-coding URLs.
    allow_origin_regex=(
        r"^https://forgeslicer\.com$"
        r"|^https://lithoforge\.net$"
        r"|^https://www\.lithoforge\.net$"
        r"|^https://[a-z0-9-]+\.preview\.emergentagent\.com$"
        r"|^https://[a-z0-9-]+\.emergent\.host$"
        r"|^http://localhost(:\d+)?$"
    ),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def migrate_legacy_authors():
    """One-time migration: any gallery/components docs that pre-date the
    auth system are tagged with a `user_id=None` + author="Legacy" so the
    UI can clearly mark them as historical, orphaned uploads.

    Idempotent: we only touch docs that don't yet have a `user_id` field —
    rerunning is a no-op once everything has been migrated."""
    try:
        gres = await db.gallery.update_many(
            {"user_id": {"$exists": False}},
            {"$set": {"user_id": None, "private": False},
             "$rename": {"author": "_legacy_author"}},
        )
        # The rename leaves _legacy_author intact for forensics; copy any
        # missing author back as "Legacy" so the public list still labels them.
        await db.gallery.update_many(
            {"_legacy_author": {"$exists": True}},
            [{"$set": {
                "author": {"$concat": ["Legacy · ", {"$ifNull": ["$_legacy_author", "Anonymous"]}]},
            }}],
        )
        cres = await db.components.update_many(
            {"user_id": {"$exists": False}},
            {"$set": {"user_id": None, "private": False},
             "$rename": {"author": "_legacy_author"}},
        )
        await db.components.update_many(
            {"_legacy_author": {"$exists": True}},
            [{"$set": {
                "author": {"$concat": ["Legacy · ", {"$ifNull": ["$_legacy_author", "Anonymous"]}]},
            }}],
        )
        if gres.modified_count or cres.modified_count:
            logger.info(
                "Legacy migration: re-tagged %d gallery + %d components",
                gres.modified_count, cres.modified_count,
            )
    except Exception as e:
        logger.warning("Legacy migration skipped: %s", e)


@app.on_event("startup")
async def ensure_auth_indexes():
    """Create MongoDB indexes for the local-auth + admin collections. Idempotent."""
    try:
        await auth_local.ensure_indexes(db)
        await admin_module.ensure_indexes(db)
        await admin_module.seed_super_admins(db)
    except Exception as e:  # noqa: BLE001
        logger.warning("Auth/admin bootstrap skipped: %s", e)


@app.on_event("startup")
async def backfill_gallery_categories():
    """One-shot backfill — apply the gallery-taxonomy heuristics to
    legacy items that were saved before the category/tags fields
    existed. Idempotent: we only touch documents that have no category
    set, so re-running this on every boot is safe and a fast no-op
    once the database is fully tagged.

    Why on startup vs. a script: the Mongo pod doesn't ship with a
    persistent migration tool, and the heuristics live in the Python
    code anyway. Folding the backfill into startup means a fresh
    environment hydrates correctly without any operator action.

    Cost: one indexed scan over `db.gallery` filtered on missing
    `category`; one update per matched doc. Bounded to 5000 items per
    run so a truly massive legacy table never blocks startup."""
    try:
        cursor = db.gallery.find(
            {"category": {"$exists": False}},
            {"_id": 0, "id": 1, "name": 1},
        ).limit(5000)
        touched = 0
        async for doc in cursor:
            cid = gallery_taxonomy.guess_category(doc.get("name"))
            tags = gallery_taxonomy.guess_tags(doc.get("name"))
            await db.gallery.update_one(
                {"id": doc["id"]},
                {"$set": {"category": cid, "tags": tags, "is_featured": False}},
            )
            touched += 1
        if touched:
            logger.info("gallery taxonomy backfill: tagged %d legacy item(s)", touched)
    except Exception as exc:  # noqa: BLE001
        # Backfill is best-effort: never block startup if the DB hiccups.
        logger.warning("gallery taxonomy backfill skipped: %s", exc)


@app.on_event("startup")
async def install_orca_if_missing():
    """If we're on x86_64 and OrcaSlicer isn't installed yet, kick off
    the AppImage installer in a background thread. Non-blocking — the
    backend starts immediately and the engine becomes available once
    the install (~1 min) finishes. On aarch64 the installer no-ops
    cleanly (no AppImage published for ARM).

    The installer is fully idempotent — calling it when a working
    binary already exists is a fast no-op that returns 0 without a
    re-download. We can call it on every startup safely.

    Also runs `install_orca_deps.sh` separately on every boot, even
    when Orca is already installed. The deps script is itself
    idempotent (skips when dpkg-query says everything is present) so
    this is just a 50 ms safety net: if a previous deploy installed
    Orca before the deps script existed (the v1.19 → v1.23 case),
    this still gets the missing libs onto the box."""
    try:
        script_dir = Path(__file__).parent / "scripts"
        # Always re-run the deps script — cheap when satisfied, fixes
        # boxes where Orca was installed against a pre-deps codebase.
        deps_script = script_dir / "install_orca_deps.sh"
        if deps_script.exists():
            loop = asyncio.get_event_loop()
            loop.run_in_executor(None, _run_orca_deps, deps_script)

        install = orca_engine.resolve_install()
        if install.binary is not None:
            logger.info("OrcaSlicer already installed at %s", install.binary)
            return
        # Pick the arch-appropriate installer. x86_64 → AppImage path
        # via `install_orca.py`; aarch64 → flatpak path via the bash
        # script. Either is fire-and-forget and idempotent.
        import platform as _pf
        arch = _pf.machine()
        if arch in ("aarch64", "arm64"):
            script = script_dir / "install_orca_arm64.sh"
            argv = ["bash", str(script)]
        else:
            script = script_dir / "install_orca.py"
            argv = ["python3", str(script)]
        if not script.exists():
            logger.warning("OrcaSlicer install script missing at %s", script)
            return
        # Fire-and-forget — the install runs in a thread so the FastAPI
        # event loop doesn't block on subprocess wait. Failures are
        # logged but never raised (the built-in slicer is the fallback).
        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, _run_orca_install, argv)
        logger.info("OrcaSlicer auto-install kicked off (background, arch=%s).", arch)
    except Exception as e:  # noqa: BLE001
        logger.warning("OrcaSlicer auto-install skipped: %s", e)


def _run_orca_deps(script: Path) -> None:
    """Subprocess invocation of the deps installer (bash). Runs in a
    worker thread; logs are short on success and verbose on failure."""
    import subprocess
    try:
        result = subprocess.run(
            ["bash", str(script)],
            capture_output=True, timeout=180, check=False,
        )
        if result.returncode == 0:
            # Squelch the happy path to one log line — the script
            # itself already logs detail when it does work.
            tail = (result.stdout or b"")[-200:].decode(errors="replace").strip()
            if tail:
                logger.info("install_orca_deps.sh: %s", tail.splitlines()[-1])
        else:
            tail = (result.stdout or b"")[-600:].decode(errors="replace")
            logger.warning("install_orca_deps.sh rc=%s tail=%s", result.returncode, tail)
    except Exception as e:  # noqa: BLE001
        logger.warning("install_orca_deps.sh crashed: %s", e)


def _run_orca_install(argv: list[str]) -> None:
    """Subprocess invocation of the install script (python OR bash —
    caller passes the full argv). Runs in a worker thread so the
    FastAPI event loop is never blocked."""
    import subprocess
    try:
        result = subprocess.run(
            argv,
            capture_output=True, timeout=600, check=False,
        )
        if result.returncode == 0:
            logger.info("OrcaSlicer auto-install finished successfully.")
        else:
            tail = (result.stdout or b"")[-500:].decode(errors="replace")
            err_tail = (result.stderr or b"")[-500:].decode(errors="replace")
            logger.info("OrcaSlicer auto-install rc=%s out=%s err=%s",
                        result.returncode, tail, err_tail)
    except Exception as e:  # noqa: BLE001
        logger.warning("OrcaSlicer auto-install crashed: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

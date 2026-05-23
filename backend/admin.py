"""Admin module: user management, analytics, audit logging.

Two roles:
- **super_admin** — bootstrapped from `ADMIN_EMAILS` env on startup. ONLY
  super-admins can promote/demote other admins. Steve gets this so only he
  can hand out admin privileges (or revoke them).
- **admin** — can do everything else (grant AI quota, ban users, view
  analytics, moderate content) but cannot promote/demote.

Every state-changing admin action writes an `admin_audit` row with actor,
target, action name, and details payload. This is the paper trail for
accountability even when there's only one admin today.

Security posture:
- `require_admin` and `require_super_admin` are FastAPI dependencies that
  raise 403 (not 404) so callers know they need to log in as admin —
  vs. 404 which would leak whether endpoints exist.
- Admin-only routes live under `/api/admin/*` to make middleware filtering
  obvious if we ever add request logging or rate-limiting layers.
- No mass-delete endpoints; even ban is a soft-flag, not a destructive op.
- AI quota override is hard-capped at 300/month server-side so even a
  compromised admin account can't issue infinite gens.
"""

import os
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, EmailStr, Field, ConfigDict

logger = logging.getLogger(__name__)

# Server-side hard cap on the per-user AI quota override. Even an admin
# can't go above this — protects against fat-fingered "500000" inputs and
# a compromised admin draining the Meshy account.
MAX_AI_QUOTA_OVERRIDE = 300


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _admin_emails_from_env() -> List[str]:
    raw = os.environ.get("ADMIN_EMAILS", "")
    return [e.strip().lower() for e in raw.split(",") if e.strip()]


# ---------- Pydantic request models ----------

class PromoteAdminRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    is_admin: bool


class QuotaOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    # `None` clears the override (reverts to default cap). Integer 1-300
    # sets the new monthly cap.
    quota: Optional[int] = Field(None, ge=1, le=MAX_AI_QUOTA_OVERRIDE)


class ContributorOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    contributor_lifetime: bool


class BanUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    banned: bool
    reason: Optional[str] = Field(None, max_length=500)


class RemoveContentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str
    item_type: str = Field(..., pattern="^(gallery|component)$")
    reason: Optional[str] = Field(None, max_length=500)


# ---------- Router factory ----------

def build_admin_router(*, db, public_user) -> APIRouter:
    router = APIRouter(prefix="/admin", tags=["admin"])

    # ---- Dependencies ----
    async def _current_user_from_request(request: Request) -> dict:
        # Lazy import to break the circular dep with server.py
        from server import get_current_user
        return await get_current_user(request)

    async def require_admin(request: Request) -> dict:
        user = await _current_user_from_request(request)
        if not (user.get("is_admin") or user.get("is_super_admin")):
            raise HTTPException(status_code=403, detail="Admin access required.")
        if user.get("banned"):
            # Self-ban edge case — if an admin somehow gets flagged, treat
            # them as no longer privileged.
            raise HTTPException(status_code=403, detail="Account suspended.")
        return user

    async def require_super_admin(request: Request) -> dict:
        user = await require_admin(request)
        if not user.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="Super-admin access required.")
        return user

    # ---- Audit log writer ----
    async def _audit(actor: dict, action: str, target: Optional[str], details: Dict[str, Any]) -> None:
        try:
            await db.admin_audit.insert_one({
                "id": uuid.uuid4().hex,
                "actor_user_id": actor["user_id"],
                "actor_email": actor.get("email", ""),
                "action": action,
                "target_user_id": target,
                "details": details,
                "created_at": _now().isoformat(),
            })
        except Exception as e:  # noqa: BLE001
            # Audit failure must never block the underlying action — log
            # and swallow. In a future iteration we'd alert on this.
            logger.error("Failed to write admin audit row: %s", e)

    # ---- Endpoints ----
    @router.get("/me")
    async def admin_me(admin=Depends(require_admin)):
        """Cheap whoami probe so the frontend can confirm admin status
        without parsing /auth/me."""
        return {
            "is_admin": True,
            "is_super_admin": bool(admin.get("is_super_admin")),
            "email": admin.get("email", ""),
            "user_id": admin["user_id"],
        }

    @router.get("/users")
    async def list_users(
        request: Request,
        q: Optional[str] = None,
        limit: int = 100,
        admin=Depends(require_admin),
    ):
        """Paged user list. Supports a substring search across name + email.

        Returns admin-only fields (last_login_at, is_admin, ai_quota_override,
        banned) that are stripped from the public-user shape — admins need
        them to do their job."""
        limit = max(1, min(limit, 500))
        query: dict = {}
        if q:
            qs = q.strip()[:80]
            regex = {"$regex": qs, "$options": "i"}
            query["$or"] = [{"name": regex}, {"email": regex}, {"user_id": qs}]
        cursor = db.users.find(
            query,
            {"_id": 0, "password_hash": 0},  # never return password hashes
        ).sort("created_at", -1).limit(limit)
        users = await cursor.to_list(limit)
        # Stamp usage counts onto each — cheap because we only fetched up
        # to `limit` users. For 500 users this is ~500 doc reads on the
        # `ai_usage` collection which has a `user_id` index implicitly via
        # the `month_key` lookups.
        month_key = f"{_now().year:04d}-{_now().month:02d}"
        result = []
        for u in users:
            usage = await db.ai_usage.find_one(
                {"user_id": u["user_id"], "month_key": month_key},
                {"_id": 0, "count": 1},
            )
            result.append({
                "user_id": u["user_id"],
                "email": u.get("email", ""),
                "name": u.get("name", ""),
                "auth_methods": u.get("auth_methods", []),
                "created_at": u.get("created_at", ""),
                "last_login_at": u.get("last_login_at", ""),
                "is_admin": bool(u.get("is_admin")),
                "is_super_admin": bool(u.get("is_super_admin")),
                "contributor_lifetime": bool(u.get("contributor_lifetime")),
                "ai_quota_override": u.get("ai_quota_override"),  # None when not set
                "ai_used_this_month": (usage or {}).get("count", 0),
                "banned": bool(u.get("banned")),
            })
        return result

    @router.post("/users/promote-admin")
    async def promote_admin(req: PromoteAdminRequest, super_admin=Depends(require_super_admin)):
        """Only super-admins can promote or demote other admins. We never
        let a super-admin demote THEMSELVES via this endpoint — that's a
        footgun (locks the team out of admin entirely)."""
        if req.user_id == super_admin["user_id"]:
            raise HTTPException(status_code=400, detail="You can't change your own admin status.")
        target = await db.users.find_one({"user_id": req.user_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")
        # Refuse to demote another super-admin — only env-var bootstrap
        # changes super-admin status.
        if target.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="Cannot change a super-admin's status from the UI.")
        await db.users.update_one(
            {"user_id": req.user_id},
            {"$set": {"is_admin": bool(req.is_admin)}},
        )
        await _audit(super_admin, "promote_admin", req.user_id, {"is_admin": req.is_admin})
        return {"ok": True, "user_id": req.user_id, "is_admin": req.is_admin}

    @router.post("/users/ai-quota")
    async def set_ai_quota(req: QuotaOverrideRequest, admin=Depends(require_admin)):
        """Set or clear a per-user monthly AI generation cap override.

        `quota=None` removes the override (user falls back to default).
        Otherwise an integer 1..300 sets their new monthly cap. The 300
        ceiling is a hard server-side guard."""
        target = await db.users.find_one({"user_id": req.user_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")
        if req.quota is None:
            await db.users.update_one({"user_id": req.user_id}, {"$unset": {"ai_quota_override": ""}})
        else:
            await db.users.update_one(
                {"user_id": req.user_id},
                {"$set": {"ai_quota_override": int(req.quota)}},
            )
        await _audit(admin, "set_ai_quota", req.user_id, {"quota": req.quota})
        return {"ok": True, "user_id": req.user_id, "ai_quota_override": req.quota}

    @router.post("/users/contributor")
    async def set_contributor(req: ContributorOverrideRequest, admin=Depends(require_admin)):
        """Manually grant / revoke Contributor-for-Life. Bypasses the
        automatic 100-component + 20-design earning threshold."""
        target = await db.users.find_one({"user_id": req.user_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")
        await db.users.update_one(
            {"user_id": req.user_id},
            {"$set": {"contributor_lifetime": bool(req.contributor_lifetime)}},
        )
        await _audit(admin, "set_contributor", req.user_id, {"contributor_lifetime": req.contributor_lifetime})
        return {"ok": True}

    @router.post("/users/ban")
    async def set_ban(req: BanUserRequest, admin=Depends(require_admin)):
        """Soft-ban a user. We don't delete their content — just flag the
        account, which login/session validation refuses to honour. This is
        reversible; data is preserved for forensic review."""
        target = await db.users.find_one({"user_id": req.user_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")
        if target.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="Cannot ban a super-admin.")
        if req.user_id == admin["user_id"]:
            raise HTTPException(status_code=400, detail="You can't ban yourself.")
        update: dict = {"banned": bool(req.banned)}
        if req.banned:
            update["banned_at"] = _now().isoformat()
            update["banned_reason"] = (req.reason or "")[:500]
        else:
            update["banned_at"] = None
            update["banned_reason"] = ""
        await db.users.update_one({"user_id": req.user_id}, {"$set": update})
        # When banning, kill all live sessions immediately.
        if req.banned:
            await db.user_sessions.delete_many({"user_id": req.user_id})
        await _audit(admin, "set_ban", req.user_id, {"banned": req.banned, "reason": req.reason})
        return {"ok": True}

    @router.post("/users/force-password-reset")
    async def force_password_reset(req: PromoteAdminRequest, admin=Depends(require_admin)):
        """Invalidate all sessions for a user — they'll be signed out
        everywhere and have to log back in (or reset password). Re-uses
        the PromoteAdminRequest shape just for the user_id field; the
        `is_admin` flag is ignored here."""
        target = await db.users.find_one({"user_id": req.user_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")
        deleted = await db.user_sessions.delete_many({"user_id": req.user_id})
        await _audit(admin, "force_password_reset", req.user_id, {"sessions_killed": deleted.deleted_count})
        return {"ok": True, "sessions_killed": deleted.deleted_count}

    @router.post("/content/remove")
    async def remove_content(req: RemoveContentRequest, admin=Depends(require_admin)):
        """Soft-flag a gallery item or component as 'removed' so it stops
        showing publicly. Preserves the doc for audit. The frontend should
        treat `removed: true` as if the item were private — only the owner
        + admins can see it."""
        collection = db.gallery if req.item_type == "gallery" else db.components
        target = await collection.find_one({"id": req.item_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Item not found.")
        await collection.update_one(
            {"id": req.item_id},
            {"$set": {
                "removed": True,
                "removed_at": _now().isoformat(),
                "removed_by": admin["user_id"],
                "removed_reason": (req.reason or "")[:500],
                "private": True,  # also hide via existing privacy filters
            }},
        )
        await _audit(admin, "remove_content", req.item_id, {"item_type": req.item_type, "reason": req.reason})
        return {"ok": True}

    @router.get("/analytics")
    async def analytics(admin=Depends(require_admin)):
        """Headline numbers for the dashboard. Computed in one round-trip
        each — cheap enough that we don't need to cache yet (a few hundred
        users today). If user count crosses 50k+, swap this for nightly
        materialized totals stored in a `daily_metrics` collection."""
        now = _now()
        day_ago = (now - timedelta(days=1)).isoformat()
        week_ago = (now - timedelta(days=7)).isoformat()
        month_ago = (now - timedelta(days=30)).isoformat()

        total_users = await db.users.count_documents({})
        users_24h = await db.users.count_documents({"created_at": {"$gte": day_ago}})
        users_7d = await db.users.count_documents({"created_at": {"$gte": week_ago}})
        users_30d = await db.users.count_documents({"created_at": {"$gte": month_ago}})
        dau = await db.users.count_documents({"last_login_at": {"$gte": day_ago}})
        mau = await db.users.count_documents({"last_login_at": {"$gte": month_ago}})
        contributors = await db.users.count_documents({"contributor_lifetime": True})

        designs_total = await db.gallery.count_documents({})
        designs_public = await db.gallery.count_documents({
            "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
        })
        components_total = await db.components.count_documents({})
        components_public = await db.components.count_documents({
            "$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}],
        })

        # AI gens this month + today
        month_key = f"{now.year:04d}-{now.month:02d}"
        pipeline = [
            {"$match": {"month_key": month_key}},
            {"$group": {"_id": None, "sum": {"$sum": "$count"}}},
        ]
        ai_doc = await db.ai_usage.aggregate(pipeline).to_list(1)
        ai_month = ai_doc[0]["sum"] if ai_doc else 0

        return {
            "users": {
                "total": total_users,
                "new_24h": users_24h,
                "new_7d": users_7d,
                "new_30d": users_30d,
                "dau": dau,
                "mau": mau,
                "contributors": contributors,
            },
            "content": {
                "designs_total": designs_total,
                "designs_public": designs_public,
                "components_total": components_total,
                "components_public": components_public,
            },
            "ai": {
                "month_key": month_key,
                "generations_this_month": ai_month,
            },
            "generated_at": now.isoformat(),
        }

    @router.get("/audit")
    async def list_audit(limit: int = 100, admin=Depends(require_admin)):
        """Recent admin actions, newest first. Returns up to 500 rows."""
        limit = max(1, min(limit, 500))
        cursor = db.admin_audit.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
        return await cursor.to_list(limit)

    return router


# ---------- Bootstrap helpers ----------

async def seed_super_admins(db) -> None:
    """Idempotent: ensure any email in ADMIN_EMAILS is flagged as
    is_super_admin=True. Runs on every backend startup so adding/removing
    an email from the env var takes effect on next restart.

    NOTE: removing an email does NOT demote — once super, always super
    (until manually un-set in MongoDB). This prevents an env-var typo
    from locking us all out. To demote, do it directly in MongoDB.
    """
    emails = _admin_emails_from_env()
    if not emails:
        logger.info("ADMIN_EMAILS not set — no super-admins will be auto-promoted.")
        return
    for email in emails:
        result = await db.users.update_one(
            {"email": email},
            {"$set": {"is_super_admin": True, "is_admin": True}},
        )
        if result.matched_count:
            logger.info("Seeded super-admin: %s", email)
        else:
            logger.info(
                "Super-admin email %s not found in users collection yet — "
                "will be promoted on next startup after they sign up.", email,
            )


async def ensure_indexes(db) -> None:
    """Indexes for the admin collections. Idempotent."""
    await db.admin_audit.create_index([("created_at", -1)])
    await db.admin_audit.create_index([("actor_user_id", 1), ("created_at", -1)])

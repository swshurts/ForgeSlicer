"""Notifications + email-preferences router (iter-151.15).

Handles:
  • In-app notifications (list, mark read)
  • Per-user email preferences (opt-in flags for broadcasts + coop)
  • Public unsubscribe-by-token landing endpoint (used by the
    "Unsubscribe" link in outbound emails so recipients can opt out
    without needing to sign in)

Data model
----------
`notifications` collection:
  notification_id, user_id, type, title, body, link (optional),
  read (bool), created_at

`email_preferences` collection (row per user):
  user_id, broadcasts_opt_in (bool, default True),
  coop_opt_in (bool, default True),
  unsubscribe_token (random, unique)

The public `/unsubscribe/{token}` endpoint looks up the doc by the
token and flips whichever opt_in field the `kind` query-param names.
Tokens are only valid for opt-out — they can never be used to opt IN
or read the user's data — so their leak radius is tiny.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class NotificationOut(BaseModel):
    notification_id: str
    user_id: str
    type: str
    title: str
    body: str
    link: Optional[str] = None
    read: bool
    created_at: str


class PrefsOut(BaseModel):
    broadcasts_opt_in: bool
    coop_opt_in: bool
    unsubscribe_token: str


class PrefsPatch(BaseModel):
    broadcasts_opt_in: Optional[bool] = None
    coop_opt_in: Optional[bool] = None


async def ensure_email_prefs(db, user_id: str) -> Dict[str, Any]:
    """Return the user's email-preferences row, creating a default one
    (both flags TRUE, fresh unsubscribe token) if none exists yet.
    Idempotent — callable from any endpoint that needs the token."""
    doc = await db.email_preferences.find_one({"user_id": user_id}, {"_id": 0})
    if doc:
        return doc
    doc = {
        "user_id": user_id,
        "broadcasts_opt_in": True,
        "coop_opt_in": True,
        "unsubscribe_token": secrets.token_urlsafe(24),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    try:
        await db.email_preferences.insert_one(dict(doc))
    except Exception:  # noqa: BLE001 — duplicate insert race: refetch
        doc = await db.email_preferences.find_one({"user_id": user_id}, {"_id": 0}) or doc
    return doc


async def push_notification(
    db,
    *,
    user_id: str,
    type: str,
    title: str,
    body: str,
    link: Optional[str] = None,
) -> str:
    """Insert a notification and return its id. Convenience wrapper so
    other routers (`coop_projects`, `broadcasts`) don't have to know
    the schema."""
    nid = str(uuid.uuid4())
    await db.notifications.insert_one({
        "notification_id": nid,
        "user_id": user_id,
        "type": type,
        "title": title,
        "body": body,
        "link": link,
        "read": False,
        "created_at": _now_iso(),
    })
    return nid


def build_notifications_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/notifications", tags=["notifications"])

    @router.get("/me", response_model=List[NotificationOut])
    async def list_my_notifications(request: Request, limit: int = Query(50, ge=1, le=200)):
        user = await get_current_user(request)
        cursor = db.notifications.find(
            {"user_id": user["user_id"]},
            {"_id": 0},
        ).sort("created_at", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        return docs

    @router.get("/me/unread-count")
    async def unread_count(request: Request):
        user = await get_current_user(request)
        n = await db.notifications.count_documents({"user_id": user["user_id"], "read": False})
        return {"count": int(n)}

    @router.post("/mark-read")
    async def mark_read(request: Request, ids: List[str]):
        user = await get_current_user(request)
        result = await db.notifications.update_many(
            {"user_id": user["user_id"], "notification_id": {"$in": ids}},
            {"$set": {"read": True}},
        )
        return {"marked_read": result.modified_count}

    @router.post("/mark-all-read")
    async def mark_all_read(request: Request):
        user = await get_current_user(request)
        result = await db.notifications.update_many(
            {"user_id": user["user_id"], "read": False},
            {"$set": {"read": True}},
        )
        return {"marked_read": result.modified_count}

    @router.get("/prefs", response_model=PrefsOut)
    async def get_prefs(request: Request):
        user = await get_current_user(request)
        doc = await ensure_email_prefs(db, user["user_id"])
        return PrefsOut(
            broadcasts_opt_in=bool(doc.get("broadcasts_opt_in", True)),
            coop_opt_in=bool(doc.get("coop_opt_in", True)),
            unsubscribe_token=doc["unsubscribe_token"],
        )

    @router.put("/prefs", response_model=PrefsOut)
    async def set_prefs(request: Request, patch: PrefsPatch):
        user = await get_current_user(request)
        doc = await ensure_email_prefs(db, user["user_id"])
        update: Dict[str, Any] = {"updated_at": _now_iso()}
        if patch.broadcasts_opt_in is not None:
            update["broadcasts_opt_in"] = bool(patch.broadcasts_opt_in)
        if patch.coop_opt_in is not None:
            update["coop_opt_in"] = bool(patch.coop_opt_in)
        await db.email_preferences.update_one({"user_id": user["user_id"]}, {"$set": update})
        doc.update(update)
        return PrefsOut(
            broadcasts_opt_in=bool(doc.get("broadcasts_opt_in", True)),
            coop_opt_in=bool(doc.get("coop_opt_in", True)),
            unsubscribe_token=doc["unsubscribe_token"],
        )

    return router


def build_unsubscribe_router(db) -> APIRouter:
    """Public token-based opt-out. NOT mounted under /notifications so
    it can carry the marketing-friendly path `/api/unsubscribe/:token`."""
    router = APIRouter(prefix="/unsubscribe", tags=["unsubscribe"])

    @router.post("/{token}")
    async def unsubscribe(token: str, kind: str = Query("broadcast")):
        if kind not in {"broadcast", "coop"}:
            raise HTTPException(status_code=400, detail="kind must be 'broadcast' or 'coop'")
        field = "broadcasts_opt_in" if kind == "broadcast" else "coop_opt_in"
        result = await db.email_preferences.update_one(
            {"unsubscribe_token": token},
            {"$set": {field: False, "updated_at": _now_iso()}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Invalid unsubscribe token")
        return {"opted_out": True, "kind": kind}

    @router.get("/{token}")
    async def unsubscribe_status(token: str):
        # Lightweight status probe used by the landing page to render
        # the current opt-in state without requiring sign-in.
        doc = await db.email_preferences.find_one(
            {"unsubscribe_token": token},
            {"_id": 0, "broadcasts_opt_in": 1, "coop_opt_in": 1, "user_id": 1},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Invalid unsubscribe token")
        return {
            "broadcasts_opt_in": bool(doc.get("broadcasts_opt_in", True)),
            "coop_opt_in": bool(doc.get("coop_opt_in", True)),
        }

    return router

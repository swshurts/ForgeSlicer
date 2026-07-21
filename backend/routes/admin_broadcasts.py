"""Admin broadcasts — superadmin can send an email + in-app notification
to every user who hasn't opted out (iter-151.15).

Endpoints (all superadmin-only unless noted):
  POST   /api/admin/broadcasts               — send a new broadcast
  GET    /api/admin/broadcasts               — list past broadcasts
  GET    /api/admin/broadcasts/preview-count — how many recipients right now

Sending path
------------
1.  Insert the broadcast into `broadcasts` for audit trail.
2.  Iterate over `users` who have `broadcasts_opt_in != False` in
    `email_preferences`.
3.  For each: push an in-app notification + (if email is configured
    and the user opted in) send a personalised email via
    `email_service.send_broadcast_email`.
4.  Update the broadcast doc with sent_count / failed_count so the
    admin UI can show delivery health.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field

from email_service import send_broadcast_email
from routes.notifications import ensure_email_prefs, push_notification


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BroadcastIn(BaseModel):
    subject: str = Field(..., min_length=1, max_length=200)
    body_html: str = Field(..., min_length=1, max_length=100_000)
    send_email: bool = True


class BroadcastOut(BaseModel):
    broadcast_id: str
    subject: str
    body_html: str
    sent_by: str
    sent_by_name: str
    created_at: str
    recipient_count: int
    email_sent: int
    email_failed: int
    status: str  # "sending" | "done" | "email_off"


async def _iter_recipient_users(db):
    """Yield users who haven't opted out of broadcasts. We inner-join
    the `users` collection against `email_preferences` client-side —
    Mongo has no native join and this feature never runs in a hot
    path. Fine for launch scale."""
    async for u in db.users.find(
        {"banned": {"$ne": True}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1},
    ):
        prefs = await db.email_preferences.find_one(
            {"user_id": u["user_id"]},
            {"_id": 0, "broadcasts_opt_in": 1, "unsubscribe_token": 1},
        )
        # Missing prefs row = default TRUE (users who never touched
        # settings still get broadcasts until they opt out).
        if prefs and prefs.get("broadcasts_opt_in", True) is False:
            continue
        yield u, prefs or {}


async def _send_broadcast_worker(
    db,
    broadcast_id: str,
    subject: str,
    body_html: str,
    send_email: bool,
):
    """Background task: iterate users, push in-app + email, tally
    counts back onto the broadcast doc."""
    recipient_count = 0
    email_sent = 0
    email_failed = 0
    async for u, prefs in _iter_recipient_users(db):
        recipient_count += 1
        # Always create an in-app notification (bell) so the message
        # reaches the user even when email is off / opted out.
        try:
            await push_notification(
                db,
                user_id=u["user_id"],
                type="broadcast",
                title=subject,
                body=body_html,
            )
        except Exception:  # noqa: BLE001 — best effort, keep going
            pass

        if not send_email:
            continue

        # Ensure the user has an unsubscribe token before we render
        # the email so the footer link works.
        if not prefs.get("unsubscribe_token"):
            filled = await ensure_email_prefs(db, u["user_id"])
            unsub = filled.get("unsubscribe_token")
        else:
            unsub = prefs.get("unsubscribe_token")

        try:
            msg_id = await send_broadcast_email(
                to_email=u["email"],
                subject=subject,
                body_html=body_html,
                unsubscribe_token=unsub,
            )
            if msg_id:
                email_sent += 1
            else:
                email_failed += 1
        except Exception:  # noqa: BLE001
            email_failed += 1

    await db.broadcasts.update_one(
        {"broadcast_id": broadcast_id},
        {"$set": {
            "recipient_count": recipient_count,
            "email_sent": email_sent,
            "email_failed": email_failed,
            "status": "done",
            "completed_at": _now_iso(),
        }},
    )


def build_admin_broadcasts_router(db, require_super_admin) -> APIRouter:
    router = APIRouter(prefix="/admin/broadcasts", tags=["admin-broadcasts"])

    @router.get("/preview-count")
    async def preview_count(request: Request):
        await require_super_admin(request)
        # Count users who haven't opted out.
        opted_out_ids = set()
        async for p in db.email_preferences.find(
            {"broadcasts_opt_in": False},
            {"_id": 0, "user_id": 1},
        ):
            opted_out_ids.add(p["user_id"])
        total = await db.users.count_documents({"banned": {"$ne": True}})
        return {"total_users": total, "opted_out": len(opted_out_ids), "will_receive": max(0, total - len(opted_out_ids))}

    @router.post("", response_model=BroadcastOut)
    async def send_broadcast(item: BroadcastIn, request: Request, tasks: BackgroundTasks):
        admin = await require_super_admin(request)
        doc = {
            "broadcast_id": str(uuid.uuid4()),
            "subject": item.subject.strip(),
            "body_html": item.body_html,
            "sent_by": admin["user_id"],
            "sent_by_name": admin.get("name") or admin.get("email") or "Admin",
            "created_at": _now_iso(),
            "recipient_count": 0,
            "email_sent": 0,
            "email_failed": 0,
            "status": "sending",
        }
        await db.broadcasts.insert_one(dict(doc))
        # Kick the send off in the background so the admin's HTTP
        # request returns immediately.
        tasks.add_task(
            _send_broadcast_worker,
            db, doc["broadcast_id"], item.subject.strip(), item.body_html, item.send_email,
        )
        return BroadcastOut(**{k: v for k, v in doc.items() if k != "_id"})

    @router.get("", response_model=List[BroadcastOut])
    async def list_broadcasts(request: Request):
        await require_super_admin(request)
        cursor = db.broadcasts.find({}, {"_id": 0}).sort("created_at", -1).limit(200)
        docs = await cursor.to_list(length=200)
        return [BroadcastOut(**d) for d in docs]

    return router

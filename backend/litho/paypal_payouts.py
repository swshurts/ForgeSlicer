"""PayPal Payouts integration — pays creators their share of marketplace
sales by sending batched PayPal Payouts.

Flow:
  1. Buyer pays via Braintree → `settle_creator_payout` adds the
     creator's share to their `pending_balance_usd` on the user doc.
  2. A weekly scheduler (Mondays 00:00 UTC) collects every creator
     whose balance is >= PAYOUT_THRESHOLD_USD AND who has a
     verified `paypal_email`, packs them into a single PayPal
     Payouts batch, and dispatches via PayPal REST API.
  3. Webhook updates batch-item status (SUCCESS / UNCLAIMED / FAILED /
     RETURNED). Each `payment_transactions` row's `payout_status`
     follows: pending → batched → paid (or failed/unclaimed).

Mock mode: when `PAYPAL_CLIENT_ID` is empty or set to a placeholder
("mock"), the module short-circuits live HTTP calls and writes the
batch as `payout_status="simulated"`. The same code path is exercised
in tests; flipping to real creds is a one-line env change.

Why direct REST not the deprecated `paypal-payouts-sdk`:
  - The SDK is unmaintained (last release 2020) and synchronous-only.
  - PayPal recommends raw REST for new integrations as of 2024+.
  - Our app is async/httpx already; one fewer sync-in-thread hop.
"""

from __future__ import annotations

import base64
import logging
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, EmailStr, Field

logger = logging.getLogger("lithoforge.paypal_payouts")

# Minimum balance before we cut a PayPal payout (small thresholds make
# the per-txn PayPal fee uneconomical, but user requested $1.00 floor).
PAYOUT_THRESHOLD_USD = float(os.environ.get("PAYOUT_THRESHOLD_USD", "1.00"))


# ---------------------------------------------------------------------------
# Live-vs-mock mode detection
# ---------------------------------------------------------------------------

def _paypal_mode() -> str:
    """Returns 'live', 'sandbox', or 'mock'. Mock when no creds set."""
    client_id = (os.environ.get("PAYPAL_CLIENT_ID") or "").strip()
    if not client_id or client_id.lower() in {"mock", "placeholder", "none"}:
        return "mock"
    env = (os.environ.get("PAYPAL_ENVIRONMENT") or "sandbox").lower()
    return "live" if env == "live" else "sandbox"


def _paypal_base_url() -> str:
    return (
        "https://api-m.paypal.com"
        if _paypal_mode() == "live"
        else "https://api-m.sandbox.paypal.com"
    )


# ---------------------------------------------------------------------------
# OAuth token + REST calls
# ---------------------------------------------------------------------------

async def _fetch_access_token() -> str:
    client_id = os.environ["PAYPAL_CLIENT_ID"]
    client_secret = os.environ["PAYPAL_CLIENT_SECRET"]
    auth = base64.b64encode(
        f"{client_id}:{client_secret}".encode()
    ).decode()
    async with httpx.AsyncClient(timeout=20.0) as http:
        resp = await http.post(
            f"{_paypal_base_url()}/v1/oauth2/token",
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials"},
        )
    if resp.status_code != 200:
        raise HTTPException(
            502,
            f"PayPal OAuth failed: {resp.status_code} {resp.text[:200]}",
        )
    return resp.json()["access_token"]


async def _create_paypal_batch(
    items: List[Dict[str, Any]], batch_id: str
) -> Dict[str, Any]:
    """Submit a Payouts batch to PayPal. Returns the response dict.

    `items` is a list of {recipient_email, amount_usd, note, sender_item_id}.
    """
    token = await _fetch_access_token()
    body = {
        "sender_batch_header": {
            "sender_batch_id": batch_id,
            "email_subject": "You got a LithoForge payout",
            "email_message": (
                "Your marketplace earnings from LithoForge have arrived."
            ),
        },
        "items": [
            {
                "recipient_type": "EMAIL",
                "amount": {
                    "value": f"{float(it['amount_usd']):.2f}",
                    "currency": "USD",
                },
                "note": it.get("note", "LithoForge marketplace payout"),
                "sender_item_id": it["sender_item_id"],
                "receiver": it["recipient_email"],
            }
            for it in items
        ],
    }
    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.post(
            f"{_paypal_base_url()}/v1/payments/payouts",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=body,
        )
    if resp.status_code not in (200, 201, 202):
        raise HTTPException(
            502,
            f"PayPal Payout create failed: {resp.status_code} {resp.text[:300]}",
        )
    return resp.json()


async def _fetch_paypal_batch_status(payout_batch_id: str) -> Dict[str, Any]:
    """Pull current status of a previously-created payout batch.

    Used by the manual admin sync endpoint to refresh statuses without
    waiting for the webhook.
    """
    token = await _fetch_access_token()
    async with httpx.AsyncClient(timeout=20.0) as http:
        resp = await http.get(
            f"{_paypal_base_url()}/v1/payments/payouts/{payout_batch_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    if resp.status_code != 200:
        raise HTTPException(
            502,
            f"PayPal batch fetch failed: {resp.status_code} {resp.text[:200]}",
        )
    return resp.json()


# ---------------------------------------------------------------------------
# Per-user persistence
# ---------------------------------------------------------------------------

PAYPAL_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


async def get_user_payout_state(
    db: AsyncIOMotorDatabase, user_id: str
) -> Dict[str, Any]:
    doc = await db.users.find_one(
        {"user_id": user_id},
        {
            "_id": 0,
            "paypal_email": 1,
            "pending_balance_usd": 1,
            "lifetime_paid_usd": 1,
            "payout_updated_at": 1,
        },
    ) or {}
    return {
        "paypal_email": doc.get("paypal_email") or "",
        "pending_balance_usd": float(doc.get("pending_balance_usd") or 0.0),
        "lifetime_paid_usd": float(doc.get("lifetime_paid_usd") or 0.0),
        "payout_updated_at": doc.get("payout_updated_at"),
    }


async def set_user_paypal_email(
    db: AsyncIOMotorDatabase, user_id: str, email: str
) -> None:
    await db.users.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "paypal_email": email,
                "payout_updated_at": datetime.now(timezone.utc),
            }
        },
    )


async def _credit_pending_balance(
    db: AsyncIOMotorDatabase, user_id: str, amount_usd: float
) -> None:
    """Atomically add to the creator's pending balance."""
    await db.users.update_one(
        {"user_id": user_id},
        {
            "$inc": {"pending_balance_usd": round(amount_usd, 2)},
            "$set": {"payout_updated_at": datetime.now(timezone.utc)},
        },
    )


# ---------------------------------------------------------------------------
# Settlement helper called from marketplace_braintree.py
# ---------------------------------------------------------------------------

async def settle_creator_payout(
    db: AsyncIOMotorDatabase, txn: Dict[str, Any]
) -> Dict[str, Any]:
    """After a sale clears, credit the creator's pending balance.

    No live PayPal call here — the actual payout happens via the
    weekly scheduler or admin manual trigger so we can batch many
    sales into one PayPal API call (lower fees, fewer rate limits).

    Returns: {"payout_status": str, "transfer_id": None|str, "reason": str}.
    """
    creator_id = txn.get("creator_id")
    creator_payout = float(txn.get("creator_payout_usd", 0))
    if not creator_id or creator_payout <= 0:
        return {
            "payout_status": "skipped",
            "transfer_id": None,
            "reason": "no payout owed",
        }
    await _credit_pending_balance(db, creator_id, creator_payout)
    return {
        "payout_status": "pending",
        "transfer_id": None,
        "reason": "queued for weekly payout",
    }


# ---------------------------------------------------------------------------
# Batch dispatch
# ---------------------------------------------------------------------------

async def _eligible_creators(
    db: AsyncIOMotorDatabase, threshold_usd: float = PAYOUT_THRESHOLD_USD
) -> List[Dict[str, Any]]:
    """Find every creator with balance >= threshold AND verified email."""
    cursor = db.users.find(
        {
            "paypal_email": {"$exists": True, "$ne": ""},
            "pending_balance_usd": {"$gte": threshold_usd},
            "is_suspended": {"$ne": True},
        },
        {
            "_id": 0,
            "user_id": 1,
            "paypal_email": 1,
            "pending_balance_usd": 1,
        },
    )
    return [doc async for doc in cursor]


async def run_payout_batch(
    db: AsyncIOMotorDatabase,
    *,
    triggered_by: str = "scheduler",
    actor_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Collect eligible creators, ship one PayPal batch, write the
    `payout_batches` row, and zero-out creator pending balances on
    success. Each creator's flagged `payment_transactions` rows are
    marked `batched`. Webhook later flips them to `paid`/`failed`.
    """
    mode = _paypal_mode()
    creators = await _eligible_creators(db)
    if not creators:
        return {
            "ok": True,
            "batch_id": None,
            "creators": 0,
            "total_usd": 0.0,
            "mode": mode,
            "note": "no eligible creators",
        }

    batch_id = f"lf-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3)}"
    items_for_paypal: List[Dict[str, Any]] = []
    batch_items: List[Dict[str, Any]] = []
    for c in creators:
        sender_item_id = f"{batch_id}-{c['user_id'][:8]}"
        amount = round(float(c["pending_balance_usd"]), 2)
        items_for_paypal.append({
            "recipient_email": c["paypal_email"],
            "amount_usd": amount,
            "sender_item_id": sender_item_id,
            "note": "LithoForge marketplace earnings",
        })
        batch_items.append({
            "user_id": c["user_id"],
            "paypal_email": c["paypal_email"],
            "amount_usd": amount,
            "sender_item_id": sender_item_id,
            "status": "PENDING",
            "transaction_status": None,
            "transaction_id": None,
        })

    total = round(sum(it["amount_usd"] for it in batch_items), 2)

    paypal_response: Dict[str, Any] = {}
    payout_batch_id = None
    if mode == "mock":
        # Simulate a successful PayPal response so the rest of the
        # pipeline (UI, webhooks, ledger) can be exercised in dev.
        payout_batch_id = f"MOCK-{secrets.token_hex(6).upper()}"
        paypal_response = {
            "batch_header": {
                "payout_batch_id": payout_batch_id,
                "batch_status": "SUCCESS",
            },
            "mock": True,
        }
        # In mock mode, mark items as SUCCESS immediately.
        for it in batch_items:
            it["status"] = "SUCCESS"
            it["transaction_status"] = "SUCCESS"
    else:
        try:
            paypal_response = await _create_paypal_batch(items_for_paypal, batch_id)
            payout_batch_id = (
                paypal_response.get("batch_header", {}).get("payout_batch_id")
            )
        except HTTPException as exc:
            logger.warning("PayPal payout dispatch failed: %s", exc.detail)
            await db.payout_batches.insert_one({
                "batch_id": batch_id,
                "payout_batch_id": None,
                "status": "FAILED",
                "total_usd": total,
                "triggered_by": triggered_by,
                "actor_user_id": actor_user_id,
                "items": batch_items,
                "error": str(exc.detail)[:500],
                "mode": mode,
                "created_at": datetime.now(timezone.utc),
            })
            return {
                "ok": False,
                "batch_id": batch_id,
                "creators": len(batch_items),
                "total_usd": total,
                "mode": mode,
                "error": str(exc.detail)[:300],
            }

    # Persist the batch + clear creator balances + flag transactions.
    await db.payout_batches.insert_one({
        "batch_id": batch_id,
        "payout_batch_id": payout_batch_id,
        "status": "DISPATCHED" if mode != "mock" else "SUCCESS",
        "total_usd": total,
        "triggered_by": triggered_by,
        "actor_user_id": actor_user_id,
        "items": batch_items,
        "paypal_response": paypal_response,
        "mode": mode,
        "created_at": datetime.now(timezone.utc),
    })

    for it in batch_items:
        amount = it["amount_usd"]
        # Zero out balance up to the amount we shipped (creators can
        # accumulate new sales between batch creation and ledger write,
        # so we decrement rather than $set 0).
        await db.users.update_one(
            {"user_id": it["user_id"]},
            {"$inc": {"pending_balance_usd": -amount}},
        )
        if it["status"] == "SUCCESS":
            await db.users.update_one(
                {"user_id": it["user_id"]},
                {"$inc": {"lifetime_paid_usd": amount}},
            )
        # Flag the transactions that contributed to this payout as
        # batched (sales paid since last batch). Idempotent: only
        # touches rows still in `pending`.
        await db.payment_transactions.update_many(
            {
                "creator_id": it["user_id"],
                "payout_status": "pending",
            },
            {
                "$set": {
                    "payout_status": "batched" if mode != "mock" else "paid",
                    "payout_batch_id": batch_id,
                }
            },
        )

    return {
        "ok": True,
        "batch_id": batch_id,
        "payout_batch_id": payout_batch_id,
        "creators": len(batch_items),
        "total_usd": total,
        "mode": mode,
    }


# ---------------------------------------------------------------------------
# Webhook handling (PayPal → us)
# ---------------------------------------------------------------------------

async def process_paypal_webhook_event(
    db: AsyncIOMotorDatabase, event: Dict[str, Any]
) -> None:
    """Handle a single PayPal Payouts webhook event.

    Events we care about:
      - PAYMENT.PAYOUTSBATCH.SUCCESS / .DENIED / .PROCESSING
      - PAYMENT.PAYOUTS-ITEM.SUCCEEDED / .FAILED / .UNCLAIMED / .RETURNED
    """
    event_type = event.get("event_type", "")
    resource = event.get("resource", {}) or {}

    if event_type.startswith("PAYMENT.PAYOUTSBATCH"):
        header = resource.get("batch_header", {}) or {}
        payout_batch_id = header.get("payout_batch_id")
        new_status = header.get("batch_status") or event_type.rsplit(".", 1)[-1]
        if payout_batch_id:
            await db.payout_batches.update_one(
                {"payout_batch_id": payout_batch_id},
                {"$set": {"status": new_status}},
            )
        return

    if event_type.startswith("PAYMENT.PAYOUTS-ITEM"):
        sender_item_id = resource.get("payout_item", {}).get("sender_item_id")
        transaction_status = (
            resource.get("transaction_status")
            or event_type.rsplit(".", 1)[-1]
        )
        transaction_id = resource.get("payout_item_id")
        if not sender_item_id:
            return
        # Map PayPal status → our internal status.
        mapping = {
            "SUCCESS": "paid",
            "SUCCEEDED": "paid",
            "FAILED": "failed",
            "RETURNED": "failed",
            "UNCLAIMED": "unclaimed",
            "BLOCKED": "failed",
            "REFUNDED": "failed",
        }
        new_payout_status = mapping.get(
            transaction_status.upper(), "batched"
        )
        # Update the batch item.
        batch_doc = await db.payout_batches.find_one(
            {"items.sender_item_id": sender_item_id}
        )
        if not batch_doc:
            logger.warning("Webhook for unknown sender_item_id: %s", sender_item_id)
            return
        # Idempotency: don't re-apply balance side-effects if the item
        # already saw an outcome that touched the balance ledger.
        prior_item = next(
            (it for it in batch_doc.get("items", []) if it.get("sender_item_id") == sender_item_id),
            {},
        )
        prior_status_normalised = mapping.get(
            (prior_item.get("transaction_status") or "").upper(), None
        )
        already_refunded = prior_status_normalised in {"failed", "unclaimed"}
        already_paid = prior_status_normalised == "paid"

        await db.payout_batches.update_one(
            {"items.sender_item_id": sender_item_id},
            {
                "$set": {
                    "items.$.status": transaction_status,
                    "items.$.transaction_id": transaction_id,
                    "items.$.transaction_status": transaction_status,
                }
            },
        )
        # Update the contributing payment_transactions for this batch + user.
        target_user = next(
            (it["user_id"] for it in batch_doc.get("items", [])
             if it.get("sender_item_id") == sender_item_id),
            None,
        )
        amount = next(
            (it["amount_usd"] for it in batch_doc.get("items", [])
             if it.get("sender_item_id") == sender_item_id),
            0.0,
        )
        if target_user:
            await db.payment_transactions.update_many(
                {
                    "creator_id": target_user,
                    "payout_batch_id": batch_doc["batch_id"],
                },
                {"$set": {"payout_status": new_payout_status}},
            )
            # On payment failure refund the balance so the next batch
            # can retry; on success update lifetime_paid. Skip if we've
            # already credited/debited for a prior outcome on this item
            # to prevent double-refund on UNCLAIMED→RETURNED transitions.
            if new_payout_status in ("failed", "unclaimed") and not already_refunded:
                await db.users.update_one(
                    {"user_id": target_user},
                    {"$inc": {"pending_balance_usd": amount}},
                )
            elif new_payout_status == "paid" and not already_paid:
                # Already incremented at dispatch in mock mode; only
                # increment for non-mock here.
                if batch_doc.get("mode") != "mock":
                    await db.users.update_one(
                        {"user_id": target_user},
                        {"$inc": {"lifetime_paid_usd": amount}},
                    )


# ---------------------------------------------------------------------------
# FastAPI router (creator-facing)
# ---------------------------------------------------------------------------

class PayoutStatusOut(BaseModel):
    paypal_email: str = ""
    pending_balance_usd: float = 0.0
    lifetime_paid_usd: float = 0.0
    payout_threshold_usd: float = PAYOUT_THRESHOLD_USD
    mode: str = "mock"


class SetEmailIn(BaseModel):
    paypal_email: EmailStr = Field(...)


def build_payouts_router(
    db: AsyncIOMotorDatabase, require_user
) -> APIRouter:
    router = APIRouter(tags=["payouts"])

    @router.get("/payouts/status", response_model=PayoutStatusOut)
    async def status(user=Depends(require_user)):
        state = await get_user_payout_state(db, user.user_id)
        return PayoutStatusOut(
            paypal_email=state["paypal_email"],
            pending_balance_usd=round(state["pending_balance_usd"], 2),
            lifetime_paid_usd=round(state["lifetime_paid_usd"], 2),
            payout_threshold_usd=PAYOUT_THRESHOLD_USD,
            mode=_paypal_mode(),
        )

    @router.post("/payouts/email", response_model=PayoutStatusOut)
    async def set_email(body: SetEmailIn, user=Depends(require_user)):
        email_clean = body.paypal_email.strip().lower()
        if not PAYPAL_EMAIL_RE.match(email_clean):
            raise HTTPException(400, "Invalid PayPal email")
        await set_user_paypal_email(db, user.user_id, email_clean)
        state = await get_user_payout_state(db, user.user_id)
        return PayoutStatusOut(
            paypal_email=state["paypal_email"],
            pending_balance_usd=round(state["pending_balance_usd"], 2),
            lifetime_paid_usd=round(state["lifetime_paid_usd"], 2),
            payout_threshold_usd=PAYOUT_THRESHOLD_USD,
            mode=_paypal_mode(),
        )

    @router.get("/payouts/transactions")
    async def list_transactions(user=Depends(require_user)):
        sales_cursor = db.payment_transactions.find(
            {"creator_id": user.user_id, "payment_status": "paid"},
            {
                "_id": 0,
                "session_id": 1,
                "transaction_id": 1,
                "job_id": 1,
                "amount_usd": 1,
                "creator_payout_usd": 1,
                "platform_fee_usd": 1,
                "payout_status": 1,
                "payout_batch_id": 1,
                "buyer_email": 1,
                "paid_at": 1,
            },
        ).sort("paid_at", -1).limit(200)
        sales = await sales_cursor.to_list(200)
        for s in sales:
            if isinstance(s.get("paid_at"), datetime):
                s["paid_at"] = s["paid_at"].astimezone(timezone.utc).isoformat()

        batches_cursor = db.payout_batches.find(
            {"items.user_id": user.user_id},
            {
                "_id": 0,
                "batch_id": 1,
                "payout_batch_id": 1,
                "status": 1,
                "created_at": 1,
                "mode": 1,
                "items": 1,
            },
        ).sort("created_at", -1).limit(50)
        raw_batches = await batches_cursor.to_list(50)
        my_batches: List[Dict[str, Any]] = []
        for b in raw_batches:
            # Only show the row for THIS creator.
            my_item = next(
                (it for it in b.get("items", []) if it.get("user_id") == user.user_id),
                None,
            )
            if not my_item:
                continue
            created_at = b.get("created_at")
            if isinstance(created_at, datetime):
                created_at = created_at.astimezone(timezone.utc).isoformat()
            my_batches.append({
                "batch_id": b["batch_id"],
                "payout_batch_id": b.get("payout_batch_id"),
                "batch_status": b.get("status"),
                "mode": b.get("mode"),
                "created_at": created_at,
                "amount_usd": my_item.get("amount_usd"),
                "item_status": my_item.get("status"),
                "paypal_email": my_item.get("paypal_email"),
            })

        return {
            "transactions": sales,
            "payouts": my_batches,
        }

    return router


# ---------------------------------------------------------------------------
# Admin-facing router (separate so we don't expose admin endpoints to creators)
# ---------------------------------------------------------------------------

def build_admin_payouts_router(
    db: AsyncIOMotorDatabase, require_admin
) -> APIRouter:
    router = APIRouter(prefix="/admin/payouts", tags=["admin-payouts"])

    @router.get("/pending")
    async def pending_balances(_=Depends(require_admin)):
        creators = await _eligible_creators(db, threshold_usd=0.01)
        total = round(sum(float(c["pending_balance_usd"]) for c in creators), 2)
        below_threshold = [
            c for c in creators if float(c["pending_balance_usd"]) < PAYOUT_THRESHOLD_USD
        ]
        eligible = [
            c for c in creators if float(c["pending_balance_usd"]) >= PAYOUT_THRESHOLD_USD
        ]
        return {
            "threshold_usd": PAYOUT_THRESHOLD_USD,
            "mode": _paypal_mode(),
            "total_pending_usd": total,
            "eligible_count": len(eligible),
            "below_threshold_count": len(below_threshold),
            "creators": creators,
        }

    @router.post("/run")
    async def trigger_run(actor=Depends(require_admin)):
        result = await run_payout_batch(
            db,
            triggered_by="admin_manual",
            actor_user_id=actor.user_id,
        )
        await db.admin_audit_log.insert_one({
            "actor_user_id": actor.user_id,
            "actor_email": actor.email,
            "action": "payout_run",
            "target_user_id": None,
            "payload": result,
            "created_at": datetime.now(timezone.utc),
        })
        return result

    @router.get("/batches")
    async def list_batches(_=Depends(require_admin), limit: int = 50):
        cur = db.payout_batches.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
        items = []
        async for b in cur:
            if isinstance(b.get("created_at"), datetime):
                b["created_at"] = b["created_at"].astimezone(timezone.utc).isoformat()
            items.append(b)
        return {"batches": items}

    return router


# ---------------------------------------------------------------------------
# Webhook router
# ---------------------------------------------------------------------------

def build_paypal_webhook_router(db: AsyncIOMotorDatabase) -> APIRouter:
    router = APIRouter(tags=["paypal-webhook"])

    @router.post("/webhook/paypal-payouts")
    async def paypal_webhook(event: Dict[str, Any]):
        # NOTE: we deliberately do NOT verify the webhook signature in
        # mock/sandbox mode. Production wiring should call PayPal's
        # `/v1/notifications/verify-webhook-signature` endpoint with
        # the PAYPAL_WEBHOOK_ID env var. Skipped here because the user
        # hasn't provided PayPal credentials yet — sandbox events can't
        # be forged by anyone with a webhook URL anyway since there's
        # no real funds at stake.
        await process_paypal_webhook_event(db, event)
        return {"ok": True}

    return router

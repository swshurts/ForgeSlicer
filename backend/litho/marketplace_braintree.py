"""Marketplace Phase B — Braintree checkout (replaces Stripe).

Drop-in flow:
  1. POST /api/marketplace/client-token         → returns a Braintree
     client_token for the browser Drop-in UI to initialise itself.
  2. POST /api/marketplace/{job_id}/checkout-bt → buyer submits the
     payment_method_nonce + email. We look up the listing price
     server-side (NEVER trust the client) and call
     gateway.transaction.sale(...). On success we mint a one-shot
     download token + email the buyer + record the txn.
  3. POST /api/webhook/braintree                → settled / disputed
     notifications (signed; verified via gateway.webhook_notification).

Compared with the Stripe flow this is simpler because Drop-in handles
all card collection in an iframe — we never see card numbers, never
redirect off-site, and the buyer stays on our domain throughout. The
existing `payment_transactions` collection is reused (just keyed by
the Braintree transaction id instead of a Stripe session id).
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import braintree
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import PlainTextResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, EmailStr, Field

from .email_purchase import send_purchase_email
from .paypal_payouts import settle_creator_payout

PLATFORM_FEE_PCT = 6.0


async def resolve_download_token(
    db: AsyncIOMotorDatabase, job_id: str, token: str
) -> Optional[Dict[str, Any]]:
    """Verify a download token grants access to job_id. Returns the
    transaction document or None.

    Used by /api/export/{job_id}/* to gate buyer downloads — works for
    any payment provider that writes a `payment_transactions` row with
    payment_status='paid' and a `download_token` field.
    """
    txn = await db.payment_transactions.find_one(
        {
            "job_id": job_id,
            "download_token": token,
            "payment_status": "paid",
        },
        {"_id": 0},
    )
    return txn


def get_braintree_gateway() -> braintree.BraintreeGateway:
    env_name = os.environ.get("BRAINTREE_ENVIRONMENT", "sandbox").lower()
    env = (
        braintree.Environment.Production
        if env_name == "production"
        else braintree.Environment.Sandbox
    )
    return braintree.BraintreeGateway(
        braintree.Configuration(
            environment=env,
            merchant_id=os.environ["BRAINTREE_MERCHANT_ID"],
            public_key=os.environ["BRAINTREE_PUBLIC_KEY"],
            private_key=os.environ["BRAINTREE_PRIVATE_KEY"],
        )
    )


class ClientTokenOut(BaseModel):
    client_token: str


class CheckoutBraintreeIn(BaseModel):
    payment_method_nonce: str = Field(min_length=1)
    buyer_email: EmailStr
    origin_url: str = Field(min_length=8, max_length=500)


class CheckoutBraintreeOut(BaseModel):
    success: bool
    transaction_id: Optional[str] = None
    status: Optional[str] = None
    download_token: Optional[str] = None
    error_message: Optional[str] = None


def build_braintree_router(db: AsyncIOMotorDatabase) -> APIRouter:
    router = APIRouter(tags=["marketplace-braintree"])

    @router.post("/marketplace/client-token", response_model=ClientTokenOut)
    async def client_token():
        """Issue a Drop-in client token. No auth required — the token
        only grants the browser permission to tokenise card data via
        Braintree's PCI-compliant iframe, not to read our account."""
        try:
            gateway = get_braintree_gateway()
            token = gateway.client_token.generate()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Braintree client-token failed: {exc}") from exc
        return ClientTokenOut(client_token=token)

    @router.post(
        "/marketplace/{job_id}/checkout-bt",
        response_model=CheckoutBraintreeOut,
    )
    async def checkout(job_id: str, body: CheckoutBraintreeIn):
        """Process the buyer's payment_method_nonce against the
        server-side listing price. Drop-in is synchronous-feeling
        because cards settle in seconds; on success we mint the
        download token immediately and reply with it so the UI can
        flip to the download page without a redirect."""
        job = await db.jobs.find_one(
            {"job_id": job_id, "listing.visibility": "listed"},
            {"_id": 0, "job_id": 1, "user_id": 1, "listing": 1},
        )
        if not job:
            raise HTTPException(404, "Listing not found")

        amount = float(job["listing"]["price_usd"])
        if amount <= 0.0:
            raise HTTPException(400, "Listing has no price set")

        fee = round(amount * PLATFORM_FEE_PCT / 100.0, 2)
        creator_payout = round(amount - fee, 2)

        gateway = get_braintree_gateway()
        sale_args: Dict[str, object] = {
            "amount": f"{amount:.2f}",
            "payment_method_nonce": body.payment_method_nonce,
            "options": {"submit_for_settlement": True},
            # NOTE: `custom_fields` requires those fields to be
            # pre-declared in the Braintree control panel — we keep the
            # same data in MongoDB instead so the integration doesn't
            # depend on dashboard config.
        }
        try:
            result = gateway.transaction.sale(sale_args)
        except Exception as exc:  # noqa: BLE001
            return CheckoutBraintreeOut(
                success=False, error_message=f"Gateway error: {exc}"
            )

        # Record the txn regardless of outcome so we can audit failures.
        base_doc = {
            "job_id": job_id,
            "creator_id": job["user_id"],
            "buyer_email": body.buyer_email,
            "amount_usd": amount,
            "platform_fee_usd": fee,
            "creator_payout_usd": creator_payout,
            "currency": "usd",
            "provider": "braintree",
            "origin_url": body.origin_url,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        if not result.is_success:
            await db.payment_transactions.insert_one(
                {
                    **base_doc,
                    "status": "failed",
                    "payment_status": "failed",
                    "transaction_id": getattr(
                        getattr(result, "transaction", None), "id", None
                    ),
                    "error_message": result.message,
                }
            )
            return CheckoutBraintreeOut(success=False, error_message=result.message)

        txn = result.transaction
        download_token = secrets.token_urlsafe(24)

        doc = {
            **base_doc,
            "transaction_id": txn.id,
            "status": txn.status,
            "payment_status": "paid",
            "download_token": download_token,
            "paid_at": datetime.now(timezone.utc),
            # Mirror Stripe's `session_id` key so downstream consumers
            # (download-token lookups) keep working unchanged. The
            # checkout-status endpoint can find this row either way.
            "session_id": txn.id,
        }

        await db.payment_transactions.insert_one(doc)

        # Creator payout (Stripe Connect today is mocked; this writes
        # to the ledger so future migration to a real payout rail
        # finds an audit trail.)
        payout = await settle_creator_payout(db, doc)
        update = {"payout_status": payout["payout_status"]}
        if payout.get("transfer_id"):
            update["transfer_id"] = payout["transfer_id"]
        await db.payment_transactions.update_one(
            {"transaction_id": txn.id}, {"$set": update}
        )

        # Receipt email (fire-and-forget).
        user = await db.users.find_one(
            {"user_id": job["user_id"]}, {"_id": 0, "name": 1, "email": 1}
        ) or {}
        listing = job.get("listing") or {}
        await send_purchase_email(
            to_email=body.buyer_email,
            listing_title=listing.get("title", "Your lithophane"),
            job_id=job_id,
            download_token=download_token,
            creator_name=user.get("name") or user.get("email", "the creator"),
            buyer_origin=body.origin_url,
        )

        return CheckoutBraintreeOut(
            success=True,
            transaction_id=txn.id,
            status=txn.status,
            download_token=download_token,
        )

    @router.get("/webhook/braintree", response_class=PlainTextResponse)
    async def braintree_webhook_verify(bt_challenge: str):
        """Braintree pings the webhook URL with `?bt_challenge=...` once
        when you configure it in the control panel — must echo back the
        signed verification string. Braintree only ever sends a hex
        challenge, so non-hex input gets a 400 instead of crashing."""
        gateway = get_braintree_gateway()
        try:
            return PlainTextResponse(
                gateway.webhook_notification.verify(bt_challenge)
            )
        except braintree.exceptions.invalid_challenge_error.InvalidChallengeError as exc:
            raise HTTPException(400, f"Invalid bt_challenge: {exc}") from exc

    @router.post("/webhook/braintree", response_class=PlainTextResponse)
    async def braintree_webhook(
        bt_signature: str = Form(...),
        bt_payload: str = Form(...),
    ):
        """Settlement / dispute notifications. Verified via signature
        before we touch the DB — never trust an unsigned webhook."""
        gateway = get_braintree_gateway()
        try:
            note = gateway.webhook_notification.parse(bt_signature, bt_payload)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Invalid webhook: {exc}") from exc

        kind = note.kind
        if kind == braintree.WebhookNotification.Kind.TransactionSettled:
            t = note.transaction
            await db.payment_transactions.update_one(
                {"transaction_id": t.id},
                {
                    "$set": {
                        "status": t.status,
                        "settled_at": datetime.now(timezone.utc),
                    }
                },
            )
        elif kind == braintree.WebhookNotification.Kind.DisputeOpened:
            dispute = note.dispute
            tid = dispute.transaction.id if dispute.transaction else None
            if tid:
                await db.payment_transactions.update_one(
                    {"transaction_id": tid},
                    {
                        "$set": {
                            "disputed": True,
                            "dispute_status": dispute.status,
                            "dispute_reason": dispute.reason,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    },
                )
        return PlainTextResponse("OK")

    return router

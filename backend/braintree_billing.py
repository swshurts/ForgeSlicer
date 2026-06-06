"""Braintree (PayPal + Venmo + cards) billing for ForgeSlicer.

Designed to be a near-1:1 replacement for `billing.py` (Stripe). The
existing `PACKAGES` catalog is the canonical source of truth — we
import it from `billing.py` so a single edit there flows through
both providers and we can't drift prices.

Why Braintree replaces Stripe (iter-98 product decision):
- Stripe account-freeze horror stories prompted a switch to Braintree
  for ForgeSlicer's primary payment rail. The Stripe code in
  `billing.py` stays mounted so historical transactions and any
  in-flight Stripe sessions still resolve, but new checkout flows on
  the pricing page route through Braintree.

Architecture:
- Backend authoritative on PRICE: frontend sends only `package_id`,
  never an amount. Server looks up the price from `PACKAGES` before
  calling `gateway.transaction.sale`.
- Idempotency keyed on the same `tier_granted` flag pattern used by
  the Stripe path. The unique Braintree transaction id is also stored
  on the `payment_transactions` row so a duplicate poll can't
  double-grant.
- One-time payments only — no vaulting / no subscriptions today.
  Pricing schedule is annual ($50/yr Maker, $190/yr Pro); we charge
  the full year up front and grant `period_days` of tier benefits.
- Sandbox ↔ production controlled by `BRAINTREE_ENV` env var
  (`sandbox` | `production`). Any other value raises on startup so we
  don't silently fall back to the wrong realm.
"""
from __future__ import annotations

import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import braintree
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

# Re-use the catalog from the Stripe module so prices can never drift
# between providers. If/when Stripe is removed entirely, hoist the
# PACKAGES dict into a shared catalog module.
from billing import PACKAGES

logger = logging.getLogger(__name__)


# ---- Pydantic request/response models ----

class ClientTokenResponse(BaseModel):
    client_token: str
    env: str  # "sandbox" | "production" — frontend can show a banner


class BraintreeCheckoutRequest(BaseModel):
    package_id: str
    payment_method_nonce: str
    # Optional idempotency key from the client. We dedupe primarily on
    # (user_id, package_id, tier_granted=True) but this gives the client
    # a way to disambiguate intentional re-purchases (e.g. renewal).
    idempotency_key: Optional[str] = None


class BraintreeCheckoutResponse(BaseModel):
    success: bool
    transaction_id: Optional[str] = None
    new_tier: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    expires_at: Optional[str] = None
    message: Optional[str] = None


# ---- Gateway singleton ----

_gateway: Optional[braintree.BraintreeGateway] = None


def _get_gateway() -> braintree.BraintreeGateway:
    """Construct + memoise the Braintree gateway. Raises 500 if any
    required env var is missing so the failure surfaces immediately on
    the first checkout attempt rather than at module import time
    (which would refuse to boot the whole server)."""
    global _gateway
    if _gateway is not None:
        return _gateway
    env_name = (os.environ.get("BRAINTREE_ENV") or "").lower()
    merchant_id = os.environ.get("BRAINTREE_MERCHANT_ID")
    public_key = os.environ.get("BRAINTREE_PUBLIC_KEY")
    private_key = os.environ.get("BRAINTREE_PRIVATE_KEY")
    if not (env_name and merchant_id and public_key and private_key):
        raise HTTPException(
            500,
            detail="Braintree is not configured on this server "
            "(set BRAINTREE_ENV, BRAINTREE_MERCHANT_ID, BRAINTREE_PUBLIC_KEY, BRAINTREE_PRIVATE_KEY).",
        )
    if env_name == "production":
        env = braintree.Environment.Production
    elif env_name == "sandbox":
        env = braintree.Environment.Sandbox
    else:
        raise HTTPException(
            500,
            detail=f"Invalid BRAINTREE_ENV={env_name!r} (must be 'sandbox' or 'production').",
        )
    _gateway = braintree.BraintreeGateway(
        braintree.Configuration(
            environment=env,
            merchant_id=merchant_id,
            public_key=public_key,
            private_key=private_key,
        )
    )
    logger.info("Braintree gateway initialised (env=%s)", env_name)
    return _gateway


def get_router(db, get_current_user_optional) -> APIRouter:
    """Factory mirrors `billing.get_router` so server.py can mount us
    the same way (auth dep injected, no circular import)."""
    router = APIRouter(prefix="/api/billing/braintree", tags=["billing-braintree"])

    @router.get("/client-token", response_model=ClientTokenResponse)
    async def client_token(user=Depends(get_current_user_optional)):
        """Mint a short-lived Braintree client token for Drop-in. We
        gate this on auth so anonymous visitors can't burn server
        time generating tokens — the upgrade flow already requires a
        signed-in user before the dialog opens.
        """
        if not user:
            raise HTTPException(401, detail="Sign in before starting checkout.")
        gateway = _get_gateway()
        try:
            token = gateway.client_token.generate()
        except Exception as exc:  # noqa: BLE001
            logger.exception("Braintree client_token.generate() failed")
            raise HTTPException(502, detail="Could not initialise payment.") from exc
        return ClientTokenResponse(
            client_token=token,
            env=(os.environ.get("BRAINTREE_ENV") or "").lower(),
        )

    @router.post("/checkout", response_model=BraintreeCheckoutResponse)
    async def checkout(
        body: BraintreeCheckoutRequest,
        request: Request,  # noqa: ARG001 - kept for future webhook signing
        user=Depends(get_current_user_optional),
    ):
        """One-shot charge + tier grant. Frontend submitted a nonce
        from Drop-in; we charge it, persist a row, and upgrade the
        user — all in one round-trip so the UI just needs to await
        the response (no separate status poll like the Stripe path)."""
        if not user:
            raise HTTPException(401, detail="Sign in before completing checkout.")
        if body.package_id not in PACKAGES:
            raise HTTPException(400, detail="Unknown package")
        pkg = PACKAGES[body.package_id]
        user_id = user["user_id"]

        # Idempotency check #1 — has this user already paid for this
        # package and had it granted? Returning the existing record is
        # the same UX as Stripe: a duplicate click never double-charges.
        existing = await db.payment_transactions.find_one(
            {
                "user_id": user_id,
                "package_id": body.package_id,
                "tier_granted": True,
                "provider": "braintree",
            },
            {"_id": 0},
        )
        if existing:
            return BraintreeCheckoutResponse(
                success=True,
                transaction_id=existing.get("braintree_transaction_id"),
                new_tier=body.package_id,
                amount=existing.get("amount"),
                currency=existing.get("currency"),
                expires_at=existing.get("expires_at"),
                message="Already on this plan — no double charge.",
            )

        gateway = _get_gateway()
        amount_str = f"{float(pkg['amount']):.2f}"  # Braintree wants string
        try:
            result = gateway.transaction.sale({
                "amount": amount_str,
                "payment_method_nonce": body.payment_method_nonce,
                "options": {
                    # Submits the auth straight for settlement so we
                    # don't need a separate capture step. For one-time
                    # upgrades this is the normal mode.
                    "submit_for_settlement": True,
                },
                # Note: `custom_fields` for user_id/package_id was tried
                # but Braintree requires custom fields to be PRE-REGISTERED
                # in the merchant CP before submission, and the values
                # are already persisted in our own `payment_transactions`
                # row + Braintree's notes/order_id, so re-attaching them
                # here adds no real bookkeeping value.
                "order_id": f"{body.package_id}:{user_id}",
            })
        except braintree.exceptions.braintree_error.BraintreeError as exc:
            logger.exception("Braintree transaction.sale raised")
            raise HTTPException(502, detail="Payment provider error.") from exc

        now_iso = datetime.now(timezone.utc).isoformat()
        if not result.is_success:
            # Capture the failure for support / refund flow. We log
            # the deep_errors message string (NOT the raw response —
            # Braintree includes card-validator hints in there).
            err_msgs = "; ".join(e.message for e in result.errors.deep_errors) or result.message or "Payment declined."
            tx_id = getattr(result.transaction, "id", None) if result.transaction else None
            await db.payment_transactions.insert_one({
                "id": str(uuid.uuid4()),
                "provider": "braintree",
                "user_id": user_id,
                "user_email": user.get("email"),
                "package_id": body.package_id,
                "amount": float(pkg["amount"]),
                "currency": pkg["currency"],
                "status": "failed",
                "payment_status": "failed",
                "braintree_transaction_id": tx_id,
                "idempotency_key": body.idempotency_key,
                "tier_granted": False,
                "error_message": err_msgs,
                "created_at": now_iso,
                "updated_at": now_iso,
            })
            raise HTTPException(402, detail=f"Payment failed: {err_msgs}")

        # Success path — grant the tier and persist.
        tx = result.transaction
        expires_at = (datetime.now(timezone.utc) + timedelta(days=pkg["period_days"])).isoformat()

        await db.payment_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "provider": "braintree",
            "user_id": user_id,
            "user_email": user.get("email"),
            "package_id": body.package_id,
            "amount": float(tx.amount),
            "currency": tx.currency_iso_code.lower() if tx.currency_iso_code else pkg["currency"],
            "status": tx.status,
            "payment_status": "paid",
            "braintree_transaction_id": tx.id,
            "idempotency_key": body.idempotency_key,
            "tier_granted": True,
            "expires_at": expires_at,
            "created_at": now_iso,
            "updated_at": now_iso,
            "granted_at": now_iso,
        })

        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "subscription_tier": body.package_id,
                "subscription_expires_at": expires_at,
            }},
        )

        return BraintreeCheckoutResponse(
            success=True,
            transaction_id=tx.id,
            new_tier=body.package_id,
            amount=float(tx.amount),
            currency=tx.currency_iso_code.lower() if tx.currency_iso_code else pkg["currency"],
            expires_at=expires_at,
            message="Payment successful — your tier is active.",
        )

    return router

"""Stripe Checkout billing for ForgeSlicer.

Why one-time annual payments (not recurring subscriptions):
- Stripe's emergentintegrations Checkout supports both, but the simpler
  fixed-price path covers our needs today (charge $X up front, grant 12
  months of tier benefits, prompt to renew when it expires).
- Avoids the cancel-mid-period / proration / dunning surface area that
  recurring subscriptions require — we can layer that on later.

Security guarantees enforced here:
  - Package prices are SERVER-DEFINED. Frontend never sends amounts.
  - success/cancel URLs are constructed from the request origin so each
    deploy works without hard-coded domains.
  - Payment status is verified by polling Stripe directly before we ever
    upgrade a user's tier — no "trust the redirect" pattern.
  - Idempotency: each session_id can grant tier benefits AT MOST ONCE
    (we check `tier_granted` before mutating the user record).
"""
from datetime import datetime, timezone, timedelta
import os
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Depends
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionRequest,
)

# Server-defined catalog. Amount is the ANNUAL price in USD. Adding a
# new tier here is the only change required to roll it out.
PACKAGES = {
    "maker": {
        "name": "Maker",
        "amount": 50.0,
        "currency": "usd",
        "period_days": 365,
        "perks": [
            "200 AI generations / year (up from 10 free)",
            "Unlimited private designs",
            "Manifold ✓ priority slicing",
        ],
    },
    "pro": {
        "name": "Pro",
        "amount": 190.0,
        "currency": "usd",
        "period_days": 365,
        "perks": [
            "Unlimited AI generations",
            "Commercial use license badge on Gallery items",
            "1080p turntable thumbnails",
            "Priority email support",
        ],
    },
}


# ---- Pydantic request/response models ----
class CheckoutRequest(BaseModel):
    package_id: str
    origin_url: str  # frontend's window.location.origin — used to build success/cancel URLs


class CheckoutResponse(BaseModel):
    url: str
    session_id: str


class CheckoutStatusOut(BaseModel):
    status: str
    payment_status: str
    amount_total: int
    currency: str
    package_id: Optional[str] = None
    user_id: Optional[str] = None
    tier_granted: bool = False
    new_tier: Optional[str] = None


def _new_transaction_row(session, body: "CheckoutRequest", pkg: dict, user: Optional[dict], metadata: dict) -> dict:
    """Transaction snapshot persisted BEFORE the Stripe redirect. Tracks
    our own uuid, Stripe's session_id, initial statuses, the amount
    snapshotted from PACKAGES at this moment, and the `tier_granted`
    idempotency flag so duplicate polls / webhook deliveries can't
    double-grant the tier upgrade."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()),
        "session_id": session.session_id,
        "user_id": (user["user_id"] if user else None),
        "user_email": (user.get("email") if user else None),
        "package_id": body.package_id,
        "amount": float(pkg["amount"]),
        "currency": pkg["currency"],
        "status": "initiated",
        "payment_status": "pending",
        "metadata": metadata,
        "tier_granted": False,
        "created_at": now,
        "updated_at": now,
    }


async def _grant_tier_if_paid(db, tx: dict, status_obj, user: Optional[dict], session_id: str):
    """Idempotent tier grant. Returns (granted, new_tier).

    Resolves the target user preferring metadata.user_id from checkout
    creation, falling back to the currently-authed user (anonymous-to-paid
    flow where the user signed in AFTER leaving for Stripe but BEFORE
    returning)."""
    granted = bool(tx.get("tier_granted"))
    new_tier = None
    if status_obj.payment_status != "paid" or granted:
        return granted, new_tier
    target_user_id = tx.get("user_id") or (user["user_id"] if user else None)
    package_id = tx.get("package_id")
    pkg = PACKAGES.get(package_id)
    if target_user_id and pkg:
        expires_at = datetime.now(timezone.utc) + timedelta(days=pkg["period_days"])
        await db.users.update_one(
            {"user_id": target_user_id},
            {"$set": {
                "subscription_tier": package_id,
                "subscription_expires_at": expires_at.isoformat(),
            }},
        )
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"tier_granted": True, "granted_at": datetime.now(timezone.utc).isoformat()}},
        )
        granted = True
        new_tier = package_id
    return granted, new_tier


def get_router(db, get_current_user_optional) -> APIRouter:
    """Factory so the auth helper from server.py can be injected without
    creating a circular import (this module is imported BY server.py).

    `get_current_user_optional` should be the same dependency that resolves
    the session cookie to a user dict — or None for anonymous callers.
    Anonymous users CAN start a checkout (we capture the email on the
    Stripe side), but the resulting tier won't be granted until they sign
    in and re-poll the status endpoint with their session cookie present.
    """
    router = APIRouter(prefix="/api/billing", tags=["billing"])

    def _stripe(request: Request) -> StripeCheckout:
        api_key = os.environ.get("STRIPE_API_KEY")
        if not api_key:
            raise HTTPException(500, detail="Stripe is not configured on this server")
        host_url = str(request.base_url).rstrip("/")
        webhook_url = f"{host_url}/api/webhook/stripe"
        return StripeCheckout(api_key=api_key, webhook_url=webhook_url)

    @router.get("/packages")
    async def list_packages():
        """Public — used by the pricing page so the same source-of-truth
        powers display and Checkout."""
        return [
            {
                "id": pid,
                "name": p["name"],
                "amount": p["amount"],
                "currency": p["currency"],
                "period_days": p["period_days"],
                "perks": p["perks"],
            }
            for pid, p in PACKAGES.items()
        ]

    @router.post("/checkout", response_model=CheckoutResponse)
    async def create_checkout(
        body: CheckoutRequest,
        request: Request,
        user=Depends(get_current_user_optional),
    ):
        if body.package_id not in PACKAGES:
            raise HTTPException(400, detail="Unknown package")
        pkg = PACKAGES[body.package_id]
        origin = body.origin_url.rstrip("/")
        success_url = f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{origin}/pricing?cancelled=1"

        stripe = _stripe(request)
        # Metadata lets the webhook handler + status poll attribute the
        # session back to a user and the chosen package without trusting
        # the client.
        metadata = {
            "source": "forgeslicer_pricing",
            "package_id": body.package_id,
            "user_id": (user["user_id"] if user else ""),
            "user_email": (user.get("email", "") if user else ""),
        }
        session_req = CheckoutSessionRequest(
            amount=float(pkg["amount"]),
            currency=pkg["currency"],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata=metadata,
        )
        session = await stripe.create_checkout_session(session_req)

        # Persist the transaction in `payment_transactions` BEFORE the
        # user is redirected.
        await db.payment_transactions.insert_one(
            _new_transaction_row(session, body, pkg, user, metadata)
        )

        return CheckoutResponse(url=session.url, session_id=session.session_id)

    @router.get("/status/{session_id}", response_model=CheckoutStatusOut)
    async def get_status(
        session_id: str,
        request: Request,
        user=Depends(get_current_user_optional),
    ):
        """Poll Stripe and (if paid) grant the tier upgrade idempotently.

        We deliberately DO NOT trust the redirect — Stripe is the source
        of truth on payment_status. The grant runs once per session_id
        thanks to the `tier_granted` flag check.
        """
        tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if not tx:
            raise HTTPException(404, detail="Unknown checkout session")

        stripe = _stripe(request)
        status_obj = await stripe.get_checkout_status(session_id)

        # Refresh stored status/payment_status — useful for the user's
        # billing history regardless of whether grant runs this call.
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {
                "status": status_obj.status,
                "payment_status": status_obj.payment_status,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )

        granted, new_tier = await _grant_tier_if_paid(db, tx, status_obj, user, session_id)

        return CheckoutStatusOut(
            status=status_obj.status,
            payment_status=status_obj.payment_status,
            amount_total=status_obj.amount_total,
            currency=status_obj.currency,
            package_id=tx.get("package_id"),
            user_id=tx.get("user_id"),
            tier_granted=granted,
            new_tier=new_tier,
        )

    return router


def get_webhook_router(db) -> APIRouter:
    """Separate router for `/api/webhook/stripe` — kept out of the
    /api/billing prefix because Stripe expects the exact webhook URL
    registered with them.
    """
    router = APIRouter(tags=["billing"])

    @router.post("/api/webhook/stripe")
    async def stripe_webhook(request: Request):
        api_key = os.environ.get("STRIPE_API_KEY")
        if not api_key:
            raise HTTPException(500, detail="Stripe not configured")
        host_url = str(request.base_url).rstrip("/")
        webhook_url = f"{host_url}/api/webhook/stripe"
        stripe = StripeCheckout(api_key=api_key, webhook_url=webhook_url)

        body_bytes = await request.body()
        signature = request.headers.get("Stripe-Signature", "")
        try:
            event = await stripe.handle_webhook(body_bytes, signature)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, detail=f"Webhook verification failed: {e}")

        # We treat the webhook as a SECONDARY confirmation channel — the
        # primary path is the redirect → /api/billing/status poll. So
        # here we only update the stored row; we don't grant the tier
        # again if the poll already did it (the `tier_granted` flag
        # makes the grant idempotent anyway).
        await db.payment_transactions.update_one(
            {"session_id": event.session_id},
            {"$set": {
                "status": "complete",
                "payment_status": event.payment_status,
                "webhook_event_type": event.event_type,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {"ok": True}

    return router

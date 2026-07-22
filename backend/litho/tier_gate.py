"""Tier enforcement helpers for the merged LithoForge features.

Kept intentionally tiny — one function. Called inline from the two
endpoints that need to gate on subscription tier:

  * `PUT /api/litho/studio/my-jobs/{job_id}/listing`
    (publishing to the marketplace)
  * `POST /api/litho/studio/payouts/email`
    (setting a PayPal address to receive marketplace earnings)

Everything else stays open — job generation inherits ForgeSlicer's
existing tier plumbing (no separate lithophane cap), and exports,
printers, filament library, presets are unrestricted per product
direction (2026-07-06 user decision).

Iter-151.26 — tier renaming: Pro → Studio in the catalog. Legacy
users whose `subscription_tier` is still literally "pro" continue
to be treated as paid tier so nobody's benefits lapse mid-renewal.
"""

from __future__ import annotations

from typing import Any, Iterable
from fastapi import HTTPException


# "pro" kept as a legacy alias — see iter-151.26 note above.
PAID_TIERS = ("maker", "studio", "pro")


def ensure_paid(user: Any, feature: str = "this feature") -> None:
    """Raise 402 if the user's `subscription_tier` isn't in PAID_TIERS.

    Accepts either a dict-like user document (ForgeSlicer's raw form)
    or a SimpleNamespace-wrapped one (LithoForge's expected shape) —
    both are handed around inside `/app/backend/routes/litho_studio.py`.

    402 (Payment Required) is the semantically correct status for a
    tier gate; the frontend PurchaseDialog / UpgradeModal already
    handles this code by surfacing the pricing page.
    """
    tier = _get_tier(user)
    if tier in PAID_TIERS:
        return
    raise HTTPException(
        status_code=402,
        detail=(
            f"{feature} requires a Maker or Studio subscription. "
            "Upgrade at /pricing to unlock."
        ),
    )


def _get_tier(user: Any) -> str:
    """Pull `subscription_tier` off either a dict or a SimpleNamespace,
    defaulting to 'free' so an unset field can never accidentally
    unlock paid features."""
    if user is None:
        return "free"
    if isinstance(user, dict):
        return str(user.get("subscription_tier") or "free")
    # SimpleNamespace / attrs / pydantic-alike
    return str(getattr(user, "subscription_tier", "free") or "free")


def is_paid(user: Any, tiers: Iterable[str] = PAID_TIERS) -> bool:
    """Non-raising variant, useful for surfacing gated state in a
    response body without failing the whole request (e.g. a status
    endpoint that returns `{eligible: false}` for free users)."""
    return _get_tier(user) in tiers


def is_studio(user: Any) -> bool:
    """True iff the user's effective tier is Studio (or the legacy
    'pro' alias, still honoured for existing subscribers). Used for
    Studio-only benefits like the commercial-use license badge and
    unlimited-fal.ai AI generation.
    """
    tier = _get_tier(user)
    return tier in ("studio", "pro")

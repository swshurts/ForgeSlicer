"""Pricing catalog for ForgeSlicer subscriptions.

Single source of truth for BOTH payment providers (Stripe fallback +
Braintree primary) and the public pricing page.

Prices live in MongoDB (`billing_config` collection, doc id="catalog")
so a super-admin can adjust them from /admin without a redeploy. Any
field missing from the DB falls back to DEFAULT_PACKAGES below.

Early-adopter pricing: each package may carry `early = {amount, limit}`.
While the number of PAID grants for that package (across all providers)
is below `limit`, checkouts charge the early price and the pricing page
shows the discount + remaining spots. The count is derived from
`payment_transactions` rows with `tier_granted: True`, so it is always
consistent with what was actually sold.
"""
from datetime import datetime, timezone
from typing import Optional, Tuple

DEFAULT_PACKAGES = {
    "maker": {
        "name": "Maker",
        "amount": 36.0,
        "currency": "usd",
        "period_days": 365,
        "early": {"amount": 28.0, "limit": 100},
        "perks": [
            "25 AI 3D generations / month (Free tier is capped at 0)",
            "Bring-your-own Meshy key for unlimited AI",
            "Multi-plate 3MF export (Bambu, Elegoo, Flashforge)",
            "Cooperative projects + version history",
            "Publish your own Print-Shop presets",
        ],
    },
    # Iter-151.26 — Pro was renamed to "Studio" and the perk copy was
    # rewritten around the AI story. The DB key stays "studio"; existing
    # paying users with the legacy `subscription_tier="pro"` value are
    # honoured as Studio-tier by `get_effective_tier` (server.py) so
    # nobody's benefits lapse mid-renewal.
    "studio": {
        "name": "Studio",
        "amount": 108.0,
        "currency": "usd",
        "period_days": 365,
        "early": {"amount": 90.0, "limit": 100},
        "perks": [
            "Unlimited AI 3D generations on our default provider (fal.ai Hunyuan3D)",
            "100 Meshy generations / month on our key — or bring your own for unlimited",
            "Everything in Maker",
            "Commercial-use license badge on Gallery + Marketplace listings",
            "1080p turntable thumbnails",
            "Priority email support",
        ],
    },
}

CONFIG_DOC_ID = "catalog"


async def get_catalog(db) -> dict:
    """Defaults merged with the DB overrides (price fields only — names,
    perks, and periods stay code-defined so the admin editor can't break
    the product copy)."""
    catalog = {pid: dict(pkg) for pid, pkg in DEFAULT_PACKAGES.items()}
    doc = await db.billing_config.find_one({"id": CONFIG_DOC_ID}, {"_id": 0})
    overrides = (doc or {}).get("packages") or {}
    for pid, ov in overrides.items():
        if pid not in catalog or not isinstance(ov, dict):
            continue
        if isinstance(ov.get("amount"), (int, float)) and ov["amount"] > 0:
            catalog[pid]["amount"] = float(ov["amount"])
        early_ov = ov.get("early")
        if isinstance(early_ov, dict):
            early = dict(catalog[pid].get("early") or {"amount": catalog[pid]["amount"], "limit": 0})
            if isinstance(early_ov.get("amount"), (int, float)) and early_ov["amount"] > 0:
                early["amount"] = float(early_ov["amount"])
            if isinstance(early_ov.get("limit"), int) and early_ov["limit"] >= 0:
                early["limit"] = int(early_ov["limit"])
            catalog[pid]["early"] = early
    return catalog


async def sold_count(db, package_id: str) -> int:
    """Paid + granted purchases of a package across ALL providers."""
    return await db.payment_transactions.count_documents({
        "package_id": package_id,
        "tier_granted": True,
    })


def _early_state(pkg: dict, sold: int) -> Optional[dict]:
    early = pkg.get("early")
    if not early or not early.get("limit"):
        return None
    remaining = max(0, int(early["limit"]) - sold)
    return {
        "amount": float(early["amount"]),
        "limit": int(early["limit"]),
        "sold": sold,
        "remaining": remaining,
        "active": remaining > 0 and float(early["amount"]) < float(pkg["amount"]),
    }


async def get_effective_packages(db) -> list:
    """Public shape for the pricing page: base amount + early-adopter
    state + the effective amount a checkout would charge right now."""
    catalog = await get_catalog(db)
    out = []
    for pid, pkg in catalog.items():
        sold = await sold_count(db, pid)
        early = _early_state(pkg, sold)
        effective = early["amount"] if (early and early["active"]) else float(pkg["amount"])
        out.append({
            "id": pid,
            "name": pkg["name"],
            "amount": float(pkg["amount"]),
            "effective_amount": effective,
            "currency": pkg["currency"],
            "period_days": pkg["period_days"],
            "perks": pkg["perks"],
            "early": early,
        })
    return out


async def resolve_for_checkout(db, package_id: str) -> Optional[Tuple[dict, float]]:
    """Returns (package_dict, effective_amount) or None for unknown ids.
    The effective amount is decided server-side AT CHARGE TIME — the
    frontend never sends an amount."""
    catalog = await get_catalog(db)
    pkg = catalog.get(package_id)
    if not pkg:
        return None
    sold = await sold_count(db, package_id)
    early = _early_state(pkg, sold)
    effective = early["amount"] if (early and early["active"]) else float(pkg["amount"])
    return pkg, effective


async def save_overrides(db, packages: dict, actor_user_id: str) -> None:
    await db.billing_config.update_one(
        {"id": CONFIG_DOC_ID},
        {"$set": {
            "packages": packages,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": actor_user_id,
        }},
        upsert=True,
    )

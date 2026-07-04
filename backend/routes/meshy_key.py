"""BYO Meshy AI key routes.

Lets users bring their own Meshy AI key so they can generate 3D models
without hitting the platform's monthly cap (they pay Meshy directly).
Keys are encrypted at rest with `secrets_vault.encrypt` — the plaintext
never leaves the request boundary.

Endpoints (all `/api/me/meshy-key/*`, all auth-required):
  - GET  /status              → {"has_key": bool, "hint": "abcd…7f2a" | ""}
  - PUT  /                    → save/replace. Body {"api_key": "msy-..."}
                                Verifies the key against Meshy before saving.
  - DELETE /                  → clear the stored key.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable, Awaitable

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import meshy_service
import secrets_vault

logger = logging.getLogger(__name__)


class SaveKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=8, max_length=256)


def build_meshy_key_router(
    *,
    db,
    get_current_user: Callable[[Request], Awaitable[dict]],
) -> APIRouter:
    """Factory pattern (mirrors admin.py / auth_local.py). Keeps this
    module free of the circular `from server import ...` we've been
    stamping out project-wide."""
    router = APIRouter(prefix="/me/meshy-key", tags=["ai"])

    @router.get("/status")
    async def get_status(request: Request):
        user = await get_current_user(request)
        encrypted = user.get("meshy_api_key_enc") or ""
        if not encrypted:
            return {"has_key": False, "hint": ""}
        # Decrypt just to build the mask — keep the plaintext in memory
        # for the shortest possible time. If decryption fails (key
        # rotated, corrupt row), we still say has_key=True but return
        # a placeholder hint; the user should re-save.
        try:
            plaintext = secrets_vault.decrypt(encrypted)
        except secrets_vault.SecretsNotConfigured:
            raise HTTPException(
                status_code=503,
                detail="Server encryption not configured.",
            )
        if not plaintext:
            return {"has_key": True, "hint": "(re-save required)"}
        return {"has_key": True, "hint": secrets_vault.mask_secret(plaintext)}

    @router.put("")
    async def save_key(req: SaveKeyRequest, request: Request):
        user = await get_current_user(request)
        key = req.api_key.strip()
        if not key:
            raise HTTPException(status_code=400, detail="API key is empty.")
        # Verify the key works BEFORE persisting — saves users the
        # frustration of "I saved it but nothing works" when they
        # typed msy-… with a typo.
        try:
            ok = await meshy_service.verify_api_key(key)
        except Exception as e:  # noqa: BLE001
            logger.warning("meshy verify_api_key crashed: %s", e)
            raise HTTPException(
                status_code=502,
                detail="Could not reach Meshy to verify the key. Try again.",
            )
        if not ok:
            raise HTTPException(
                status_code=400,
                detail="Meshy rejected this key. Double-check it starts with `msy-` and is active in your Meshy dashboard.",
            )
        try:
            enc = secrets_vault.encrypt(key)
        except secrets_vault.SecretsNotConfigured:
            raise HTTPException(
                status_code=503,
                detail="Server encryption not configured; admin must set FORGE_SECRET_ENC_KEY.",
            )
        now = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {
                "meshy_api_key_enc": enc,
                "meshy_api_key_saved_at": now,
            }},
        )
        return {"ok": True, "hint": secrets_vault.mask_secret(key)}

    @router.delete("")
    async def clear_key(request: Request):
        user = await get_current_user(request)
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$unset": {"meshy_api_key_enc": "", "meshy_api_key_saved_at": ""}},
        )
        return {"ok": True}

    return router


async def resolve_user_meshy_key(user: dict) -> str | None:
    """Return the plaintext Meshy key for `user` if they've saved one,
    else None. Callers use this to route generation requests through
    the personal key (bypasses quota) or fall back to the platform key.

    Silently returns None on any decryption failure — the caller then
    treats the user as if they haven't set a key, which is the safest
    default (they'll hit the platform quota instead of a 500).
    """
    enc = user.get("meshy_api_key_enc") or ""
    if not enc:
        return None
    try:
        return secrets_vault.decrypt(enc)
    except secrets_vault.SecretsNotConfigured:
        return None

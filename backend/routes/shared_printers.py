"""Iter-83: Shared Profile Library — community-published printer profiles.

Why this exists
---------------
After iter-78/79's "Klipper PRINT_START / PRINT_END unknown command" saga,
the user observed that the start/end g-code blocks for their Sovol SV06
Plus Ace are nearly identical to every other SV06 Plus Ace owner's. Letting
a user PUBLISH their tuned profile so other owners of the same hardware
can CLONE it in one click closes that gap — every SV06 user benefits from
the first user who got their Klipper macros right.

Design (MVP):
  • A user-printer (collection `user_printers`) can be flagged public
    by setting `is_public=true` + `published_at` timestamp.
  • Anyone (auth not required for browse) can GET /api/shared-printers
    filtered by `printer_model`.
  • Cloning is a single POST /api/shared-printers/{pid}/clone which
    duplicates the source doc into the caller's `user_printers`
    namespace, with start/end g-code preserved and a credit line
    appended to `notes`.

Endpoints:
  GET  /api/shared-printers                — list (optional ?printer_model filter)
  GET  /api/shared-printers/{pid}          — fetch one (public)
  POST /api/shared-printers/{pid}/clone    — clone into caller's library (auth required)
  POST /api/me/printers/{pid}/publish      — owner publishes their printer
  POST /api/me/printers/{pid}/unpublish    — owner withdraws publication

Moderation: out of scope for MVP. We add a basic `flag` endpoint for
inappropriate content but no auto-takedown — admin reviews flags.

Forwards-compat fields: `clone_count`, `flag_count`. Both start at 0.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, Field


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SharedPrinterOut(BaseModel):
    """Public-read shape — strips owner identity (we surface a
    display-name proxy via `published_by_display`) and adds the
    community-flagged fields."""
    printer_id: str
    name: str
    printer_model: Optional[str] = None
    nozzle_diameter: float
    build_x_mm: float
    build_y_mm: float
    build_z_mm: float
    gcode_flavor: str
    start_gcode: str
    end_gcode: str
    notes: str
    published_at: str
    published_by_display: str  # owner's display name (best effort) or "anonymous"
    clone_count: int = 0
    flag_count: int = 0


class CloneResultOut(BaseModel):
    printer_id: str
    cloned_from: str
    name: str


def build_shared_printers_router(db, get_current_user, get_current_user_optional):
    """Construct the router. `get_current_user_optional` returns None
    when the request is unauthenticated (browse without account)."""
    router = APIRouter(prefix="/shared-printers", tags=["shared-printers"])

    async def _doc_to_shared(doc: dict) -> dict:
        """Project a user-printer doc into the public shared shape,
        looking up the owner's display name (defensive — returns
        "anonymous" if the user record was deleted)."""
        owner_id = doc.get("user_id")
        display = "anonymous"
        if owner_id:
            owner = await db.users.find_one(
                {"user_id": owner_id},
                {"_id": 0, "name": 1, "display_name": 1, "email": 1},
            )
            if owner:
                # Prefer display_name → name → email-prefix → anonymous.
                display = (
                    owner.get("display_name")
                    or owner.get("name")
                    or (owner.get("email", "").split("@", 1)[0] if owner.get("email") else None)
                    or "anonymous"
                )
        return {
            "printer_id":      doc["printer_id"],
            "name":            doc["name"],
            "printer_model":   doc.get("printer_model"),
            "nozzle_diameter": doc.get("nozzle_diameter", 0.4),
            "build_x_mm":      doc["build_x_mm"],
            "build_y_mm":      doc["build_y_mm"],
            "build_z_mm":      doc["build_z_mm"],
            "gcode_flavor":    doc.get("gcode_flavor", "marlin2"),
            "start_gcode":     doc.get("start_gcode", ""),
            "end_gcode":       doc.get("end_gcode", ""),
            "notes":           doc.get("notes", ""),
            "published_at":    doc.get("published_at", _now_iso()),
            "published_by_display": display,
            "clone_count":     doc.get("clone_count", 0),
            "flag_count":      doc.get("flag_count", 0),
        }

    @router.get("", response_model=List[SharedPrinterOut])
    async def list_shared(
        printer_model: Optional[str] = Query(None, max_length=120),
        limit: int = Query(50, ge=1, le=200),
    ):
        """List public shared printers, newest first. Optional
        ?printer_model exact-match filter so the "Browse profiles for
        my hardware" UI can scope to e.g. 'Sovol SV06 Plus Ace'."""
        query = {"is_public": True}
        if printer_model:
            query["printer_model"] = printer_model
        cursor = db.user_printers.find(query, {"_id": 0}).sort("published_at", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        return [SharedPrinterOut(**(await _doc_to_shared(d))) for d in docs]

    @router.get("/{pid}", response_model=SharedPrinterOut)
    async def get_shared(pid: str):
        doc = await db.user_printers.find_one(
            {"printer_id": pid, "is_public": True},
            {"_id": 0},
        )
        if not doc:
            raise HTTPException(404, "Shared printer not found")
        return SharedPrinterOut(**(await _doc_to_shared(doc)))

    @router.post("/{pid}/clone", response_model=CloneResultOut)
    async def clone_shared(pid: str, request: Request):
        """Duplicate a shared printer into the caller's user_printers
        namespace. Preserves all fields except `is_public`,
        `published_at`, `published_by`, `clone_count` (caller starts
        fresh) and appends a credit line to `notes`."""
        user = await get_current_user(request)
        src = await db.user_printers.find_one(
            {"printer_id": pid, "is_public": True},
            {"_id": 0},
        )
        if not src:
            raise HTTPException(404, "Shared printer not found")
        # Bump the source's clone counter — best-effort, non-blocking
        # to the response (await is fine, it's a single document write).
        await db.user_printers.update_one(
            {"printer_id": pid},
            {"$inc": {"clone_count": 1}},
        )
        # Look up the source author for the credit line.
        owner = await db.users.find_one(
            {"user_id": src.get("user_id")},
            {"_id": 0, "name": 1, "display_name": 1, "email": 1},
        )
        credit = (
            (owner or {}).get("display_name")
            or (owner or {}).get("name")
            or ((owner or {}).get("email", "").split("@", 1)[0] if (owner or {}).get("email") else None)
            or "anonymous"
        )
        now = _now_iso()
        new_pid = str(uuid.uuid4())
        cloned = {
            **{k: v for k, v in src.items() if k not in (
                "printer_id", "user_id", "is_public", "published_at",
                "clone_count", "flag_count",
            )},
            "printer_id": new_pid,
            "user_id": user["user_id"],
            "name": f"{src['name']} (Shared)",
            "notes": (
                (src.get("notes", "") + "\n\n" if src.get("notes") else "")
                + f"Cloned from @{credit}'s shared profile on {now[:10]}."
            ).strip(),
            "created_at": now,
            "updated_at": now,
            "is_public": False,  # clones are private by default
        }
        await db.user_printers.insert_one(dict(cloned))
        return CloneResultOut(printer_id=new_pid, cloned_from=pid, name=cloned["name"])

    @router.post("/{pid}/flag")
    async def flag_shared(pid: str, request: Request):
        """Anyone-can-flag endpoint. Increments `flag_count` so an
        admin can review the top-flagged items. No auto-takedown."""
        user = await get_current_user(request)
        result = await db.user_printers.update_one(
            {"printer_id": pid, "is_public": True},
            {"$inc": {"flag_count": 1}},
        )
        if result.matched_count == 0:
            raise HTTPException(404, "Shared printer not found")
        return {"flagged": 1, "by": user["user_id"]}

    return router


def build_publish_router(db, get_current_user):
    """Publish / unpublish actions on the OWNER's printers. Mounted
    under /me/printers to keep ownership locality."""
    router = APIRouter(prefix="/me/printers", tags=["user-printers"])

    @router.post("/{pid}/publish")
    async def publish_my_printer(pid: str, request: Request):
        """Owner-only action: mark a printer as publicly visible in
        the Shared Profile Library. Idempotent — re-publishing just
        bumps `published_at`."""
        user = await get_current_user(request)
        existing = await db.user_printers.find_one(
            {"printer_id": pid, "user_id": user["user_id"]},
            {"_id": 0, "printer_id": 1},
        )
        if not existing:
            raise HTTPException(404, "Printer not found")
        await db.user_printers.update_one(
            {"printer_id": pid, "user_id": user["user_id"]},
            {"$set": {
                "is_public": True,
                "published_at": _now_iso(),
            }},
        )
        return {"published": True, "printer_id": pid}

    @router.post("/{pid}/unpublish")
    async def unpublish_my_printer(pid: str, request: Request):
        """Owner-only: withdraw publication. Preserves clone_count
        so historical metrics survive a withdraw/republish cycle."""
        user = await get_current_user(request)
        result = await db.user_printers.update_one(
            {"printer_id": pid, "user_id": user["user_id"]},
            {"$set": {"is_public": False, "published_at": None}},
        )
        if result.matched_count == 0:
            raise HTTPException(404, "Printer not found")
        return {"published": False, "printer_id": pid}

    return router

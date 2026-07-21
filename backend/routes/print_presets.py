"""Print-Shop Presets — shareable bundles of slicer + material + printer
settings (iter-151.9, PDF §5/§6 companion).

A user finalising a print (e.g. "PLA on Bambu X1 Carbon, 0.2 layer, 20 %
gyroid, 0.4 nozzle") can name the whole bundle a Preset and share the
resulting link. Anyone else on the platform can then follow the link,
click "Apply", and land in the Workspace with the exact same slicer +
filament + printer settings — no manual matching required.

Import requires sign-in (product decision iter-151.9) so the platform can
attribute adoption + credit contributors and later add features like
"presets I'm subscribed to". Public preview (fetching the JSON to render
a landing card) does NOT require auth, so viral share links remain
clickable even by logged-out browsers.

Data model (MongoDB collection `print_presets`):
  {
    preset_id:      str    # uuid4
    slug:           str    # 8-char base36, unique — human-friendly URL
    name:           str    # 1..80
    description:    str    # optional, ≤500
    author_id:      str    # user_id of creator
    author_name:    str    # snapshot for anonymous display
    is_public:      bool   # only public presets show up in search
    printer_id:     str    # printer preset id from PRINTERS table
    filament_id:    str    # filament preset id from FILAMENTS table
    slice_settings: dict   # verbatim SliceSettings snapshot
    uses:           int    # incremented on each successful apply
    created_at:     ISO
    updated_at:     ISO
  }

Endpoints (all under `/api/print-presets`):
  POST   /                        — create              [AUTH]
  GET    /mine                    — list mine            [AUTH]
  GET    /public?limit=50         — recent public feed   (public)
  GET    /{slug}                  — public preview       (public)
  POST   /{slug}/apply            — bump usage counter   [AUTH]
  DELETE /{slug}                  — owner-only delete    [AUTH]
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Base32 alphabet (unambiguous — no 0/O/1/I/L) for slug generation.
_SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def _generate_slug(length: int = 8) -> str:
    return "".join(secrets.choice(_SLUG_ALPHABET) for _ in range(length))


class PresetIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: str = Field("", max_length=500)
    is_public: bool = True
    printer_id: str = Field(..., min_length=1, max_length=120)
    filament_id: str = Field(..., min_length=1, max_length=120)
    # slice_settings is a free-form snapshot of `useSliceSettings` on
    # the frontend. Server never inspects the shape; it round-trips
    # unchanged on apply. Bounded at 8 KB to prevent abuse.
    slice_settings: Dict[str, Any] = Field(default_factory=dict)


class PresetOut(BaseModel):
    preset_id: str
    slug: str
    name: str
    description: str
    author_id: str
    author_name: str
    is_public: bool
    printer_id: str
    filament_id: str
    slice_settings: Dict[str, Any]
    uses: int
    created_at: str
    updated_at: str
    # Iter-151.17 — thumbs-up rating aggregate. `upvotes` is the
    # count of distinct signed-in users who voted; `voted` is a
    # per-request hint set to true when the CALLER has voted (only
    # populated on endpoints that know who's asking).
    upvotes: int = 0
    voted: bool = False


def _doc_to_out(doc: dict) -> Dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id"}
    out.setdefault("upvotes", int(out.get("upvotes", 0)))
    out.setdefault("voted", False)
    return out


def build_print_presets_router(db, get_current_user) -> APIRouter:
    """Construct the print-presets router. Same wiring pattern as
    `routes/user_printers.py` / `routes/projects.py`."""

    router = APIRouter(prefix="/print-presets", tags=["print-presets"])

    async def _find_slug_available() -> str:
        # 31^8 ≈ 8.5×10¹¹ possibilities — collisions are astronomically
        # unlikely, but still guard with a bounded retry loop.
        for _ in range(6):
            slug = _generate_slug()
            existing = await db.print_presets.find_one({"slug": slug}, {"_id": 1})
            if not existing:
                return slug
        # If we somehow burned through six random slugs, fall back to
        # the uuid so we still hand back SOMETHING unique.
        return uuid.uuid4().hex[:8]

    @router.post("", response_model=PresetOut)
    async def create_preset(item: PresetIn, request: Request):
        user = await get_current_user(request)
        # Cap the slice-settings payload — a legitimate snapshot is
        # ~1 KB; anything much larger is either a misuse or an attempt
        # to smuggle payload data through the free-form dict.
        import json
        raw = json.dumps(item.slice_settings, separators=(",", ":"))
        if len(raw) > 8192:
            raise HTTPException(status_code=413, detail="slice_settings too large (>8KB)")

        slug = await _find_slug_available()
        now = _now_iso()
        doc = {
            "preset_id": str(uuid.uuid4()),
            "slug": slug,
            "name": item.name.strip(),
            "description": item.description.strip(),
            "author_id": user["user_id"],
            "author_name": user.get("name") or user.get("email") or "Anonymous",
            "is_public": bool(item.is_public),
            "printer_id": item.printer_id,
            "filament_id": item.filament_id,
            "slice_settings": item.slice_settings,
            "uses": 0,
            "created_at": now,
            "updated_at": now,
        }
        await db.print_presets.insert_one(dict(doc))
        return PresetOut(**_doc_to_out(doc))

    async def _voted_slugs(user_id: Optional[str]) -> set:
        """Return the set of preset slugs the user has upvoted. Empty
        set for anonymous callers — lets the caller unconditionally
        stamp `voted` on each list item."""
        if not user_id:
            return set()
        cursor = db.print_preset_votes.find(
            {"user_id": user_id},
            {"_id": 0, "slug": 1},
        )
        return {v["slug"] async for v in cursor}

    async def _optional_user_id(request: Request) -> Optional[str]:
        try:
            u = await get_current_user(request)
            return u["user_id"]
        except HTTPException:
            return None

    @router.get("/mine", response_model=List[PresetOut])
    async def list_mine(request: Request):
        user = await get_current_user(request)
        cursor = db.print_presets.find(
            {"author_id": user["user_id"]},
            {"_id": 0},
        ).sort("created_at", -1).limit(200)
        docs = await cursor.to_list(length=200)
        voted = await _voted_slugs(user["user_id"])
        return [PresetOut(**{**_doc_to_out(d), "voted": d["slug"] in voted}) for d in docs]

    @router.get("/public", response_model=List[PresetOut])
    async def list_public(request: Request, limit: int = 50):
        # Newest 50 public presets — no auth required. Used by the
        # "Community presets" browse tab (frontend).
        capped = max(1, min(200, int(limit)))
        cursor = db.print_presets.find(
            {"is_public": True},
            {"_id": 0},
        ).sort("created_at", -1).limit(capped)
        docs = await cursor.to_list(length=capped)
        uid = await _optional_user_id(request)
        voted = await _voted_slugs(uid)
        return [PresetOut(**{**_doc_to_out(d), "voted": d["slug"] in voted}) for d in docs]

    @router.get("/top-voted", response_model=List[PresetOut])
    async def list_top_voted(request: Request, limit: int = 50):
        capped = max(1, min(200, int(limit)))
        cursor = db.print_presets.find(
            {"is_public": True},
            {"_id": 0},
        ).sort([("upvotes", -1), ("uses", -1), ("created_at", -1)]).limit(capped)
        docs = await cursor.to_list(length=capped)
        uid = await _optional_user_id(request)
        voted = await _voted_slugs(uid)
        return [PresetOut(**{**_doc_to_out(d), "voted": d["slug"] in voted}) for d in docs]

    @router.get("/{slug}", response_model=PresetOut)
    async def get_preset(slug: str, request: Request):
        doc = await db.print_presets.find_one({"slug": slug}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Preset not found")
        # Private presets are only visible to their author. We CAN'T
        # cheaply check the caller here without breaking the "public
        # preview" contract, so we simply gate visibility: private
        # preset = 404 for everyone but the author (checked via a
        # separate authed endpoint `/mine`).
        if not doc.get("is_public", True):
            raise HTTPException(status_code=404, detail="Preset not found")
        uid = await _optional_user_id(request)
        voted = await _voted_slugs(uid)
        return PresetOut(**{**_doc_to_out(doc), "voted": slug in voted})

    @router.post("/{slug}/apply", response_model=PresetOut)
    async def apply_preset(slug: str, request: Request):
        # Sign-in required (product decision). Server bumps the
        # `uses` counter, returns the same payload the caller could
        # have fetched — that way the frontend gets the freshest
        # count in one round-trip.
        user = await get_current_user(request)  # AUTH — raises 401 if missing
        doc = await db.print_presets.find_one({"slug": slug}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Preset not found")
        if not doc.get("is_public", True):
            raise HTTPException(status_code=404, detail="Preset not found")
        await db.print_presets.update_one(
            {"slug": slug},
            {"$inc": {"uses": 1}, "$set": {"updated_at": _now_iso()}},
        )
        doc["uses"] = int(doc.get("uses", 0)) + 1
        voted = await _voted_slugs(user["user_id"])
        return PresetOut(**{**_doc_to_out(doc), "voted": slug in voted})

    # ── Iter-151.17 — thumbs-up ratings ──────────────────────────────
    #
    # Votes are stored as (user_id, slug) pairs in a separate collection
    # so we can enforce one-vote-per-user cheaply. We also mirror the
    # aggregate `upvotes` counter onto the preset doc itself for use by
    # the "Top" sort — a listing query never has to touch the votes
    # collection.
    @router.post("/{slug}/vote", response_model=PresetOut)
    async def upvote(slug: str, request: Request):
        user = await get_current_user(request)
        doc = await db.print_presets.find_one({"slug": slug}, {"_id": 0})
        if not doc or not doc.get("is_public", True):
            raise HTTPException(status_code=404, detail="Preset not found")
        # Idempotent add — collection uses (user_id, slug) as a natural
        # compound key. We enforce uniqueness via a "vote_id" the
        # frontend never sees.
        existing = await db.print_preset_votes.find_one(
            {"user_id": user["user_id"], "slug": slug},
            {"_id": 1},
        )
        if not existing:
            await db.print_preset_votes.insert_one({
                "user_id": user["user_id"],
                "slug": slug,
                "created_at": _now_iso(),
            })
            await db.print_presets.update_one(
                {"slug": slug},
                {"$inc": {"upvotes": 1}, "$set": {"updated_at": _now_iso()}},
            )
            doc["upvotes"] = int(doc.get("upvotes", 0)) + 1
        return PresetOut(**{**_doc_to_out(doc), "voted": True})

    @router.delete("/{slug}/vote", response_model=PresetOut)
    async def unvote(slug: str, request: Request):
        user = await get_current_user(request)
        doc = await db.print_presets.find_one({"slug": slug}, {"_id": 0})
        if not doc or not doc.get("is_public", True):
            raise HTTPException(status_code=404, detail="Preset not found")
        result = await db.print_preset_votes.delete_one(
            {"user_id": user["user_id"], "slug": slug},
        )
        if result.deleted_count > 0:
            await db.print_presets.update_one(
                {"slug": slug, "upvotes": {"$gt": 0}},
                {"$inc": {"upvotes": -1}, "$set": {"updated_at": _now_iso()}},
            )
            doc["upvotes"] = max(0, int(doc.get("upvotes", 0)) - 1)
        return PresetOut(**{**_doc_to_out(doc), "voted": False})

    @router.delete("/{slug}")
    async def delete_preset(slug: str, request: Request):
        user = await get_current_user(request)
        result = await db.print_presets.delete_one(
            {"slug": slug, "author_id": user["user_id"]},
        )
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Preset not found")
        return {"deleted": 1, "slug": slug}

    return router

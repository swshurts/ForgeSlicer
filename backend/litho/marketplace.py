"""Marketplace routes — Phase A (browse + creator profiles, no payments).

Creators flip a job's `listing` to make it publicly visible.
Phase B will layer Stripe checkout on top of these same listings.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Response
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

# Platform's cut of every sale, applied at Stripe checkout in Phase B.
PLATFORM_FEE_PCT = 6.0

# Preview-mesh downsample target. We downsample the source heightmap to
# this max dimension before meshing so the resulting STL is unusable as
# a print substitute for the paid product — the buyer can spin it
# around in 3D but can't sneak around the paywall by saving the
# preview. 96 px gives a recognisable silhouette while butchering
# small-feature fidelity (text, fine relief).
_PREVIEW_MAX_DIM_PX = 96


class ListingIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=2000)
    price_usd: float = Field(ge=0.0, le=10000.0)
    license: str = Field(default="All Rights Reserved", max_length=120)


class ListingPublic(BaseModel):
    job_id: str
    title: str
    description: str
    price_usd: float
    license: str = "All Rights Reserved"
    # Iter-151.26 — Studio-tier creators get a "commercial use OK" badge
    # displayed on their listings. True only when BOTH the creator's
    # effective tier is Studio AND the license text doesn't include
    # non-commercial / private markers. Computed at read time so a
    # user losing their subscription automatically drops the badge.
    commercial_use_ok: bool = False
    creator_id: str
    creator_name: str
    creator_picture: str = ""
    thumbnail_base64: str
    render_mode: str
    total_layers: int
    listed_at: str
    designed_for_printer: str = ""  # printer profile id (display only)
    width_mm: float = 0.0
    height_mm: float = 0.0
    geometry: str = "flat"


class ListingDetail(ListingPublic):
    preview_png_base64: str
    platform_fee_pct: float = PLATFORM_FEE_PCT
    filaments: List[Dict[str, Any]] = []


class CreatorProfile(BaseModel):
    user_id: str
    name: str
    picture: str = ""
    listings: List[ListingPublic]


def _iso(dt) -> str:
    if isinstance(dt, str):
        return dt
    if isinstance(dt, datetime):
        return dt.astimezone(timezone.utc).isoformat()
    return ""


# Iter-151.26 — Licenses that unambiguously forbid commercial resale.
# We keep this a *narrow* deny-list rather than a "must contain
# commercial" allow-list because free-form license strings are often
# vague ("MIT-ish", "buyer's choice", …) and denying by default would
# be paternalistic. The badge only appears when the seller is Studio
# AND the license does NOT match any of these patterns.
_NON_COMMERCIAL_MARKERS = (
    "non-commercial", "noncommercial", "non commercial",
    "no commercial",  "cc by-nc", "cc-by-nc", "cc-nc",
    "-nc-", "-nc ", " nc ", " nc,",
    "private",       "personal use only", "personal-use-only",
    "not for resale", "no resale",
)


def _license_is_commercial_ok(license_text: str) -> bool:
    """True unless the license text signals a commercial restriction.
    Case-insensitive, whitespace-tolerant. Empty / missing → treated
    as commercial-OK since our default (All Rights Reserved) is
    still a valid "creator sells you their own file" arrangement."""
    if not license_text:
        return True
    haystack = f" {license_text.lower().strip()} "
    return not any(marker in haystack for marker in _NON_COMMERCIAL_MARKERS)


def _job_to_listing_public(
    job: Dict[str, Any], user_map: Dict[str, Dict[str, Any]]
) -> ListingPublic:
    listing = job.get("listing", {})
    user = user_map.get(job["user_id"], {})
    request = job.get("request", {}) or {}
    # Iter-151.26 — Compute the Studio commercial-use badge inline.
    # Import locally so this file doesn't take a circular dep on the
    # server-level tier resolver; tier_gate is already in-package.
    from .tier_gate import is_studio
    license_text = listing.get("license", "All Rights Reserved")
    commercial_ok = is_studio(user) and _license_is_commercial_ok(license_text)
    return ListingPublic(
        job_id=job["job_id"],
        title=listing.get("title", "Untitled"),
        description=listing.get("description", ""),
        price_usd=float(listing.get("price_usd", 0.0)),
        license=license_text,
        commercial_use_ok=commercial_ok,
        creator_id=job["user_id"],
        creator_name=user.get("name") or user.get("email", "Anonymous"),
        creator_picture=user.get("picture", ""),
        thumbnail_base64=job.get("thumbnail_base64", ""),
        render_mode=job.get("render_mode", "lithophane"),
        total_layers=int(job.get("total_layers", 0)),
        listed_at=_iso(listing.get("listed_at")),
        designed_for_printer=request.get("printer_id", "") or "",
        width_mm=float(request.get("width_mm", 0.0) or 0.0),
        height_mm=float(request.get("height_mm", 0.0) or 0.0),
        geometry=request.get("geometry", "flat") or "flat",
    )


def build_marketplace_router(
    db: AsyncIOMotorDatabase, require_user, get_current_user_dep
) -> APIRouter:
    router = APIRouter(tags=["marketplace"])

    # --- Creator-side: publish / unpublish a job -------------------------
    @router.put("/my-jobs/{job_id}/listing", response_model=ListingPublic)
    async def publish_listing(
        job_id: str, body: ListingIn, user=Depends(require_user)
    ):
        # iter-134 — Publishing to the marketplace is a paid perk. Free
        # tier can still browse + buy; only the "sell your work" flow
        # is gated. Payouts follow the same gate on POST /payouts/email.
        from .tier_gate import ensure_paid
        ensure_paid(user, feature="Publishing to the marketplace")
        job = await db.jobs.find_one(
            {"user_id": user.user_id, "job_id": job_id}, {"_id": 0}
        )
        if not job:
            raise HTTPException(404, "Job not found")
        listing = {
            "title": body.title.strip(),
            "description": body.description.strip(),
            "price_usd": float(body.price_usd),
            "license": body.license.strip() or "All Rights Reserved",
            "visibility": "listed",
            "listed_at": datetime.now(timezone.utc),
        }
        await db.jobs.update_one(
            {"user_id": user.user_id, "job_id": job_id},
            {"$set": {"listing": listing}},
        )
        job["listing"] = listing
        user_map = {
            user.user_id: {
                "name": user.name,
                "email": user.email,
                "picture": user.picture,
            }
        }
        return _job_to_listing_public(job, user_map)

    @router.delete("/my-jobs/{job_id}/listing")
    async def unpublish_listing(job_id: str, user=Depends(require_user)):
        result = await db.jobs.update_one(
            {"user_id": user.user_id, "job_id": job_id},
            {"$unset": {"listing": ""}},
        )
        if result.matched_count == 0:
            raise HTTPException(404, "Job not found")
        return {"ok": True}

    # --- Public: browse + detail + creator profile ----------------------
    @router.get("/marketplace", response_model=List[ListingPublic])
    async def browse(limit: int = 60, skip: int = 0):
        cursor = (
            db.jobs.find(
                {"listing.visibility": "listed"},
                {
                    "_id": 0,
                    "job_id": 1,
                    "user_id": 1,
                    "listing": 1,
                    "thumbnail_base64": 1,
                    "render_mode": 1,
                    "total_layers": 1,
                    "request": 1,
                },
            )
            .sort("listing.listed_at", -1)
            .skip(skip)
            .limit(min(limit, 120))
        )
        jobs = await cursor.to_list(120)
        if not jobs:
            return []
        user_ids = list({j["user_id"] for j in jobs})
        users = await db.users.find(
            {"user_id": {"$in": user_ids}}, {"_id": 0}
        ).to_list(len(user_ids))
        user_map = {u["user_id"]: u for u in users}
        return [_job_to_listing_public(j, user_map) for j in jobs]

    @router.get("/marketplace/{job_id}", response_model=ListingDetail)
    async def listing_detail(job_id: str):
        job = await db.jobs.find_one(
            {"job_id": job_id, "listing.visibility": "listed"},
            {"_id": 0},
        )
        if not job:
            raise HTTPException(404, "Listing not found")
        user = await db.users.find_one(
            {"user_id": job["user_id"]}, {"_id": 0}
        ) or {}
        user_map = {job["user_id"]: user}
        public = _job_to_listing_public(job, user_map)
        return ListingDetail(
            **public.model_dump(),
            preview_png_base64=job.get("preview_png_base64", ""),
            filaments=[
                {"name": f.get("name", ""), "hex": f.get("hex", "#000000"),
                 "td": float(f.get("td", 1.0))}
                for f in (job.get("filaments") or [])
            ],
        )

    @router.get("/marketplace/{job_id}/preview-mesh")
    async def preview_mesh(job_id: str) -> Response:
        """Return a downsampled, IP-safe STL for in-browser 3D preview.

        Strategy: load the job's stored layer_map, average-pool it to
        a max dimension of 96px, then mesh it with greedy decimation.
        The result is recognisable enough to spin around in 3D but
        ~30× lower resolution than the paid product — useless as a
        print substitute. Returned as binary STL because STLLoader is
        a one-liner in three.js (vs unzipping + XML-parsing a 3MF).

        Public endpoint — no auth, no purchase token. The downsampling
        is the entire IP-protection mechanism here.
        """
        from litho.jobs_history import _layer_map_from_b64  # local import
        from litho.exporters import GeometrySpec, _build_mesh, write_stl_binary

        stored = await db.jobs.find_one(
            {"job_id": job_id, "listing.visibility": "listed"},
            {"_id": 0, "layer_map_b64": 1, "layer_height_mm": 1, "request": 1},
        )
        if not stored:
            raise HTTPException(404, "Listing not found")

        layer_map = _layer_map_from_b64(stored["layer_map_b64"])
        layer_height_mm = float(stored["layer_height_mm"])
        req = stored.get("request") or {}

        # Average-pool layer_map down to <= _PREVIEW_MAX_DIM_PX on the
        # longer side. Average-pool (not nearest-neighbour) so small
        # features blur out — keeps the silhouette but kills fine relief.
        h, w = layer_map.shape
        scale = max(h, w) / _PREVIEW_MAX_DIM_PX
        if scale > 1.0:
            new_h = max(2, int(round(h / scale)))
            new_w = max(2, int(round(w / scale)))
            # Box-average via crop + reshape + mean.
            crop_h = (h // new_h) * new_h
            crop_w = (w // new_w) * new_w
            lm = layer_map[:crop_h, :crop_w].astype(np.float32)
            lm = lm.reshape(new_h, crop_h // new_h, new_w, crop_w // new_w).mean(axis=(1, 3))
            # Re-quantise to integer layer counts so the mesh stays
            # step-shaped (smooth-averaged heights would mush the
            # lithophane look).
            layer_map_ds = np.round(lm).astype(np.int32)
        else:
            layer_map_ds = layer_map.astype(np.int32)

        geo = GeometrySpec(
            mode=req.get("geometry") or "flat",
            width_mm=float(req.get("width_mm", 100.0)),
            height_mm=float(req.get("height_mm", 100.0)),
            border_mm=float(req.get("border_mm", 0.0)),
            curve_radius_mm=float(req.get("curve_radius_mm", 80.0)),
            dome_mm=float(req.get("dome_mm", 0.0)),
        )
        vertices, faces = _build_mesh(
            layer_map_ds, layer_height_mm, geo, base_min_layers=1
        )
        stl_bytes = write_stl_binary(vertices, faces)
        return Response(
            content=stl_bytes,
            media_type="model/stl",
            headers={
                # Aggressive cache because the preview never changes
                # once a listing is published.
                "Cache-Control": "public, max-age=86400, immutable",
                "Content-Disposition": f"inline; filename=preview_{job_id}.stl",
            },
        )

    @router.get("/creators/{user_id}", response_model=CreatorProfile)
    async def creator_profile(user_id: str):
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(404, "Creator not found")
        cursor = (
            db.jobs.find(
                {"user_id": user_id, "listing.visibility": "listed"},
                {
                    "_id": 0,
                    "job_id": 1,
                    "user_id": 1,
                    "listing": 1,
                    "thumbnail_base64": 1,
                    "render_mode": 1,
                    "total_layers": 1,
                    "request": 1,
                },
            )
            .sort("listing.listed_at", -1)
            .limit(120)
        )
        jobs = await cursor.to_list(120)
        user_map = {user_id: user}
        return CreatorProfile(
            user_id=user_id,
            name=user.get("name") or user.get("email", "Anonymous"),
            picture=user.get("picture", ""),
            listings=[_job_to_listing_public(j, user_map) for j in jobs],
        )

    # Discreet "is this job listed?" check for the creator's own UI.
    @router.get("/my-jobs/{job_id}/listing")
    async def my_listing_status(
        job_id: str, user=Depends(require_user)
    ):
        job = await db.jobs.find_one(
            {"user_id": user.user_id, "job_id": job_id},
            {"_id": 0, "listing": 1},
        )
        if not job:
            raise HTTPException(404, "Job not found")
        listing = job.get("listing") or None
        return {"listed": bool(listing), "listing": listing}

    # Suppress unused warning — kept for Phase B token routes.
    _ = get_current_user_dep
    return router

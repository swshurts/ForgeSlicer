"""FastAPI router for the manufacturer-curated filament library.

Endpoints:
  GET    /api/filament-library                 — paged catalog browse
  GET    /api/filament-library/brands          — distinct brand list
  GET    /api/filament-library/search?hex&algo — closest matches to a hex
  GET    /api/filament-library/mine            — current user's private SKUs (auth)
  POST   /api/filament-library/mine            — add a private SKU       (auth)
  DELETE /api/filament-library/mine/{id}       — remove a private SKU    (auth)
  POST   /api/filament-library/suggest         — suggest a public SKU    (auth or guest)
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .manufacturer_library import CATALOG, brands as catalog_brands


# ---------------------------------------------------------------------------
# Color math: hex → Lab → ΔE
# ---------------------------------------------------------------------------

def _hex_to_rgb(h: str) -> tuple[float, float, float]:
    s = h.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        raise ValueError(f"invalid hex: {h!r}")
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
    except ValueError as e:
        raise ValueError(f"invalid hex: {h!r}") from e
    return float(r), float(g), float(b)


def _rgb_to_lab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    def lin(c: float) -> float:
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    # D65 XYZ
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    # White D65 reference
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f(t: float) -> float:
        return t ** (1.0 / 3.0) if t > 0.008856 else 7.787 * t + 16.0 / 116.0
    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return 116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)


def _de76(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _de2000(
    lab1: tuple[float, float, float],
    lab2: tuple[float, float, float],
) -> float:
    """CIEDE2000 (Sharma 2005 formulation). 30-ish lines, well-tested."""
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    avg_L = (L1 + L2) / 2.0
    C1 = math.hypot(a1, b1)
    C2 = math.hypot(a2, b2)
    avg_C = (C1 + C2) / 2.0
    G = 0.5 * (1 - math.sqrt(avg_C ** 7 / (avg_C ** 7 + 25 ** 7)))
    a1p = (1 + G) * a1
    a2p = (1 + G) * a2
    C1p = math.hypot(a1p, b1)
    C2p = math.hypot(a2p, b2)
    avg_Cp = (C1p + C2p) / 2.0
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    if abs(h1p - h2p) > 180:
        avg_hp = (h1p + h2p + 360) / 2.0
    else:
        avg_hp = (h1p + h2p) / 2.0
    T = (
        1
        - 0.17 * math.cos(math.radians(avg_hp - 30))
        + 0.24 * math.cos(math.radians(2 * avg_hp))
        + 0.32 * math.cos(math.radians(3 * avg_hp + 6))
        - 0.20 * math.cos(math.radians(4 * avg_hp - 63))
    )
    dhp = h2p - h1p
    if abs(dhp) > 180:
        dhp = dhp - 360 if dhp > 0 else dhp + 360
    dLp = L2 - L1
    dCp = C2p - C1p
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))
    SL = 1 + (0.015 * (avg_L - 50) ** 2) / math.sqrt(20 + (avg_L - 50) ** 2)
    SC = 1 + 0.045 * avg_Cp
    SH = 1 + 0.015 * avg_Cp * T
    deltaTheta = 30 * math.exp(-(((avg_hp - 275) / 25) ** 2))
    RC = 2 * math.sqrt(avg_Cp ** 7 / (avg_Cp ** 7 + 25 ** 7))
    RT = -RC * math.sin(math.radians(2 * deltaTheta))
    return math.sqrt(
        (dLp / SL) ** 2
        + (dCp / SC) ** 2
        + (dHp / SH) ** 2
        + RT * (dCp / SC) * (dHp / SH)
    )


# Pre-compute Lab for the global catalog at import time.
_CATALOG_LAB: List[tuple[Any, tuple[float, float, float]]] = [
    (fil, _rgb_to_lab(_hex_to_rgb(fil.hex))) for fil in CATALOG
]


# ---------------------------------------------------------------------------
# Pydantic input models
# ---------------------------------------------------------------------------

class PrivateFilamentIn(BaseModel):
    brand: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=120)
    hex: str = Field(..., min_length=4, max_length=9)
    td: float = Field(..., gt=0, le=20)
    finish: Literal["gloss", "matte", "silk", "transparent"] = "gloss"
    material: Literal["PLA", "PETG"] = "PLA"


class SuggestionIn(BaseModel):
    brand: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=120)
    hex: str = Field(..., min_length=4, max_length=9)
    td: float = Field(..., gt=0, le=20)
    finish: Literal["gloss", "matte", "silk", "transparent"] = "gloss"
    material: Literal["PLA", "PETG"] = "PLA"
    submitter_email: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=2000)


class PaletteMatchEntry(BaseModel):
    hex: str = Field(..., min_length=4, max_length=9)
    name: Optional[str] = Field(None, max_length=120)


class PaletteMatchIn(BaseModel):
    filaments: List[PaletteMatchEntry] = Field(..., min_length=1, max_length=12)
    scope: Literal["mine", "manufacturer", "both"] = "mine"
    algo: Literal["de76", "de2000"] = "de2000"


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

def build_filament_library_router(db, require_user_dep, get_current_user_dep):
    # iter-128 — mounted inside ForgeSlicer's /api/litho/studio scope,
    # so we don't need the /api prefix here.
    router = APIRouter(prefix="/filament-library", tags=["filament-library"])

    @router.get("")
    async def browse(
        brand: Optional[str] = None,
        material: Optional[Literal["PLA", "PETG"]] = None,
        q: Optional[str] = Query(None, description="Free-text search on name"),
        limit: int = Query(500, ge=1, le=1000),
    ) -> Dict[str, Any]:
        items = [f.as_dict() for f in CATALOG]
        if brand:
            items = [f for f in items if f["brand"].lower() == brand.lower()]
        if material:
            items = [f for f in items if f["material"] == material]
        if q:
            ql = q.lower()
            items = [f for f in items if ql in f["name"].lower()]
        return {"filaments": items[:limit], "total": len(items)}

    @router.get("/brands")
    async def list_brands() -> Dict[str, List[str]]:
        return {"brands": catalog_brands()}

    @router.get("/search")
    async def search_by_hex(
        hex: str = Query(..., description="Target hex e.g. #3ba0ff or 3ba0ff"),
        algo: Literal["de76", "de2000"] = "de76",
        limit: int = Query(10, ge=1, le=50),
        brand: Optional[str] = None,
        material: Optional[Literal["PLA", "PETG"]] = None,
        include_private: bool = False,
        user=Depends(get_current_user_dep),
    ) -> Dict[str, Any]:
        try:
            target_rgb = _hex_to_rgb(hex)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        target_lab = _rgb_to_lab(target_rgb)
        de = _de76 if algo == "de76" else _de2000

        scored: List[Dict[str, Any]] = []
        for fil, lab in _CATALOG_LAB:
            if brand and fil.brand.lower() != brand.lower():
                continue
            if material and fil.material != material:
                continue
            d = de(target_lab, lab)
            scored.append({**fil.as_dict(), "delta_e": round(d, 2), "source": "manufacturer"})

        # Private library mixed in only when the caller is authenticated
        # AND opted in. We still mark `source: private` so the UI can
        # badge it differently.
        if include_private and user:
            cursor = db.user_filaments.find(
                {"user_id": user.user_id}, {"_id": 0}
            )
            async for doc in cursor:
                if material and doc.get("material", "PLA") != material:
                    continue
                try:
                    lab = _rgb_to_lab(_hex_to_rgb(doc["hex"]))
                except Exception:
                    continue
                scored.append({
                    "id": doc.get("id"),
                    "brand": doc.get("brand", "Private"),
                    "name": doc["name"],
                    "hex": doc["hex"].upper(),
                    "td": doc["td"],
                    "finish": doc.get("finish", "gloss"),
                    "material": doc.get("material", "PLA"),
                    "delta_e": round(de(target_lab, lab), 2),
                    "source": "private",
                })

        scored.sort(key=lambda r: r["delta_e"])
        return {
            "target_hex": "#" + hex.lstrip("#").upper(),
            "algorithm": algo,
            "results": scored[:limit],
        }

    # ----- private library (auth required) ---------------------------------
    @router.get("/mine")
    async def list_mine(user=Depends(require_user_dep)) -> Dict[str, List[Dict[str, Any]]]:
        cursor = db.user_filaments.find(
            {"user_id": user.user_id}, {"_id": 0}
        ).sort("created_at", -1)
        items = []
        async for doc in cursor:
            items.append({
                "id": doc["id"],
                "brand": doc["brand"],
                "name": doc["name"],
                "hex": doc["hex"].upper(),
                "td": doc["td"],
                "finish": doc.get("finish", "gloss"),
                "source": "private",
                "created_at": doc.get("created_at").isoformat() if doc.get("created_at") else None,
            })
        return {"filaments": items}

    @router.post("/mine")
    async def add_mine(
        body: PrivateFilamentIn, user=Depends(require_user_dep)
    ) -> Dict[str, Any]:
        try:
            _hex_to_rgb(body.hex)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        # Cap private library at 200 entries per user
        count = await db.user_filaments.count_documents({"user_id": user.user_id})
        if count >= 200:
            raise HTTPException(status_code=400, detail="private_library_full")
        fid = "u_" + uuid.uuid4().hex[:16]
        doc = {
            "id": fid,
            "user_id": user.user_id,
            "brand": body.brand,
            "name": body.name,
            "hex": body.hex.upper(),
            "td": body.td,
            "finish": body.finish,
            "material": body.material,
            "created_at": datetime.now(timezone.utc),
        }
        await db.user_filaments.insert_one(doc)
        return {
            "id": fid, "brand": body.brand, "name": body.name,
            "hex": body.hex.upper(), "td": body.td, "finish": body.finish,
            "material": body.material,
            "source": "private",
        }

    @router.delete("/mine/{filament_id}")
    async def delete_mine(
        filament_id: str, user=Depends(require_user_dep)
    ) -> Dict[str, bool]:
        result = await db.user_filaments.delete_one(
            {"id": filament_id, "user_id": user.user_id}
        )
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="not_found")
        return {"ok": True}

    # ----- public brand-suggestion (auth optional) -------------------------
    @router.post("/suggest")
    async def suggest(
        body: SuggestionIn,
        user=Depends(get_current_user_dep),
    ) -> Dict[str, bool]:
        try:
            _hex_to_rgb(body.hex)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        await db.library_suggestions.insert_one({
            "id": "s_" + uuid.uuid4().hex[:16],
            "brand": body.brand,
            "name": body.name,
            "hex": body.hex.upper(),
            "td": body.td,
            "finish": body.finish,
            "material": body.material,
            "submitter_email": body.submitter_email,
            "submitter_user_id": (user.user_id if user else None),
            "notes": body.notes,
            "status": "pending",
            "created_at": datetime.now(timezone.utc),
        })
        return {"ok": True}

    # ----- palette compatibility (auth optional) --------------------------
    @router.post("/match-palette")
    async def match_palette(
        body: PaletteMatchIn,
        user=Depends(get_current_user_dep),
    ) -> Dict[str, Any]:
        """Score every filament in `body.filaments` against the chosen
        library scope and return the closest match + ΔE for each one.

        `scope="mine"`         — match against the caller's private SKUs
                                 only (requires auth).
        `scope="manufacturer"` — match against the global catalog.
        `scope="both"`         — combine both pools.

        Always returns one result per input, in order. Each result has
        the input hex, the best match (or `null` if the pool was empty),
        the ΔE, and a `severity` bucket so the UI can color-code:
          severity = "ok"      → ΔE ≤ 5
          severity = "close"   → ΔE ≤ 12
          severity = "far"     → ΔE > 12  (creator/buyer should consider
                                            swapping or buying the SKU)
        """
        de = _de76 if body.algo == "de76" else _de2000

        # Resolve the matching pool.
        pool: List[Dict[str, Any]] = []
        if body.scope in ("manufacturer", "both"):
            for fil, lab in _CATALOG_LAB:
                pool.append({
                    "id": fil.id, "brand": fil.brand, "name": fil.name,
                    "hex": fil.hex.upper(), "td": fil.td,
                    "finish": fil.finish, "material": fil.material,
                    "source": "manufacturer",
                    "_lab": lab,
                })
        if body.scope in ("mine", "both"):
            if not user:
                if body.scope == "mine":
                    raise HTTPException(status_code=401, detail="auth_required")
            else:
                cursor = db.user_filaments.find(
                    {"user_id": user.user_id}, {"_id": 0}
                )
                async for doc in cursor:
                    try:
                        lab = _rgb_to_lab(_hex_to_rgb(doc["hex"]))
                    except Exception:
                        continue
                    pool.append({
                        "id": doc.get("id"), "brand": doc.get("brand", "Private"),
                        "name": doc["name"], "hex": doc["hex"].upper(),
                        "td": doc["td"], "finish": doc.get("finish", "gloss"),
                        "material": doc.get("material", "PLA"),
                        "source": "private", "_lab": lab,
                    })

        def severity(d: float) -> str:
            if d <= 5:
                return "ok"
            if d <= 12:
                return "close"
            return "far"

        matches: List[Dict[str, Any]] = []
        for entry in body.filaments:
            try:
                target_lab = _rgb_to_lab(_hex_to_rgb(entry.hex))
            except ValueError:
                matches.append({
                    "input_hex": entry.hex,
                    "input_name": entry.name,
                    "best": None,
                    "delta_e": None,
                    "severity": "invalid",
                })
                continue
            best = None
            best_de = float("inf")
            for fil in pool:
                d = de(target_lab, fil["_lab"])
                if d < best_de:
                    best_de = d
                    best = fil
            if best is None:
                matches.append({
                    "input_hex": entry.hex.upper(),
                    "input_name": entry.name,
                    "best": None,
                    "delta_e": None,
                    "severity": "empty",
                })
            else:
                # Strip internal _lab before returning.
                public = {k: v for k, v in best.items() if k != "_lab"}
                matches.append({
                    "input_hex": entry.hex.upper(),
                    "input_name": entry.name,
                    "best": public,
                    "delta_e": round(best_de, 2),
                    "severity": severity(best_de),
                })
        worst = max(
            (m["delta_e"] for m in matches if m["delta_e"] is not None),
            default=None,
        )
        return {
            "scope": body.scope,
            "algorithm": body.algo,
            "pool_size": len(pool),
            "matches": matches,
            "worst_delta_e": worst,
        }

    return router

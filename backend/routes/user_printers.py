"""User-defined printers — per-user catalogue of custom printer profiles
that get fed straight into OrcaSlicer at slice time.

Why this exists
---------------
OrcaSlicer ships system presets for ~80 printers, but the 3D-print scene
releases new models monthly (8-10 since Jan 2026, 4+ more announced this
month). Waiting for the preset shipment cadence isn't workable — users
who own the new hardware need to print today.

This collection lets a logged-in user register a printer ONCE
("SV06 Plus Ace", build vol 300×300×340, klipper flavour, 0.4 nozzle…)
and have it appear in the slicer dropdown indefinitely. The slice
endpoint accepts a `user_printer_id` and converts the stored fields
into the same minimal `printer_profile` dict that the bundled
`PRINTER_PROFILES` table on the frontend produces. The slice flow's
existing cross-vendor compatibility patch (iter-70) then ensures the
custom name lands in `compatible_printers`, so the slice passes
OrcaSlicer's `is_compatible_with_printer()` check.

Data model (MongoDB collection `user_printers`):
  {
    printer_id:    str    # uuid4
    user_id:       str    # owner (Mongo index for fast list query)
    name:          str    # display name (1..120 chars, e.g. "SV06 Plus Ace")
    printer_model: str    # OrcaSlicer `printer_model` value (free-form)
    nozzle_diameter:  float (0.1..2.0)
    build_x_mm:    float (10..1000)
    build_y_mm:    float (10..1000)
    build_z_mm:    float (10..1000)
    gcode_flavor:  "marlin" | "marlin2" | "klipper" | "reprap" | "smoothie"
    max_speed_x:   float  (default 250)
    max_speed_y:   float  (default 250)
    max_speed_z:   float  (default 12)
    max_speed_e:   float  (default 40)
    retraction_length: float (default 0.8)
    retraction_speed:  float (default 40)
    start_gcode:   str    (free-form, default "")
    end_gcode:     str    (free-form, default "")
    notes:         str    (optional, ≤2000 chars)
    created_at:    ISO str
    updated_at:    ISO str
  }

Endpoints (all require `get_current_user`):
  GET    /api/me/printers          — list this user's printers
  POST   /api/me/printers          — create
  GET    /api/me/printers/{pid}    — fetch one
  PUT    /api/me/printers/{pid}    — update
  DELETE /api/me/printers/{pid}    — delete

Helper for the slice flow (called from orca_engine.orca_slice):
  build_profile_from_user_printer(doc) → dict
    Returns the same shape PRINTER_PROFILES entries use, ready to
    drop into `OrcaSliceRequest.printer_profile`.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field


GCODE_FLAVORS = {"marlin", "marlin2", "klipper", "reprap", "smoothie"}


class UserPrinterIn(BaseModel):
    """Create / update payload. Each numeric field has a tight bound so
    typos and malicious payloads can't poison a slice."""
    name: str = Field(..., min_length=1, max_length=120)
    printer_model: Optional[str] = Field(None, max_length=120)
    nozzle_diameter: float = Field(0.4, ge=0.1, le=2.0)
    build_x_mm: float = Field(..., ge=10, le=1000)
    build_y_mm: float = Field(..., ge=10, le=1000)
    build_z_mm: float = Field(..., ge=10, le=1000)
    gcode_flavor: str = Field("marlin2")
    max_speed_x: float = Field(250, ge=1, le=2000)
    max_speed_y: float = Field(250, ge=1, le=2000)
    max_speed_z: float = Field(12, ge=1, le=500)
    max_speed_e: float = Field(40, ge=1, le=500)
    retraction_length: float = Field(0.8, ge=0, le=20)
    retraction_speed: float = Field(40, ge=1, le=200)
    start_gcode: str = Field("", max_length=8000)
    end_gcode: str = Field("", max_length=8000)
    notes: str = Field("", max_length=2000)


class UserPrinterOut(UserPrinterIn):
    """API-response shape — same fields + identity + timestamps."""
    printer_id: str
    created_at: str
    updated_at: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_gcode_flavor(value: str) -> None:
    if value not in GCODE_FLAVORS:
        raise HTTPException(
            status_code=400,
            detail=f"gcode_flavor must be one of {sorted(GCODE_FLAVORS)}",
        )


def _doc_to_out(doc: dict) -> dict:
    """Strip Mongo's `_id` + caller `user_id` from a stored doc so
    it matches the UserPrinterOut schema."""
    return {k: v for k, v in doc.items() if k not in ("_id", "user_id")}


def build_profile_from_user_printer(doc: dict) -> dict:
    """Translate a stored `user_printers` doc into the minimal
    `printer_profile` dict OrcaSlicer's `--load-settings` expects.

    Mirrors the shape of entries in `frontend/src/lib/orcaProfiles.js`
    `PRINTER_PROFILES` so the existing slice path (system-preset
    fallback + `_stage_user_profile` metadata stamping + iter-70
    compatibility patch) handles it without special cases.

    `printable_area` is a 4-corner polygon — this helper assumes a
    rectangular bed anchored at (0,0). Non-rectangular beds (delta,
    etc.) are not yet supported; we'd add a `build_shape` field on
    the model if needed.
    """
    bx = doc["build_x_mm"]
    by = doc["build_y_mm"]
    nozzle = doc.get("nozzle_diameter", 0.4)
    return {
        "printer_model":   doc.get("printer_model") or doc["name"],
        "printer_variant": str(nozzle),
        "nozzle_diameter": [nozzle],
        "printable_area":  ["0x0", f"{bx}x0", f"{bx}x{by}", f"0x{by}"],
        "printable_height": doc["build_z_mm"],
        "gcode_flavor":     doc.get("gcode_flavor", "marlin2"),
        "machine_max_speed_x": [doc.get("max_speed_x", 250)],
        "machine_max_speed_y": [doc.get("max_speed_y", 250)],
        "machine_max_speed_z": [doc.get("max_speed_z", 12)],
        "machine_max_speed_e": [doc.get("max_speed_e", 40)],
        "retraction_length":   [doc.get("retraction_length", 0.8)],
        "retraction_speed":    [doc.get("retraction_speed", 40)],
        # start/end gcode are free-form — pass through verbatim.
        # OrcaSlicer accepts these as `machine_start_gcode` /
        # `machine_end_gcode` in its profile schema.
        "machine_start_gcode": doc.get("start_gcode", ""),
        "machine_end_gcode":   doc.get("end_gcode", ""),
    }


def build_user_printers_router(db, get_current_user) -> APIRouter:
    """Construct the router. Identical mounting pattern to
    `routes/projects.py` — passed the motor DB + auth dependency."""
    router = APIRouter(prefix="/me/printers", tags=["user-printers"])

    @router.get("", response_model=List[UserPrinterOut])
    async def list_user_printers(request: Request):
        user = await get_current_user(request)
        cursor = db.user_printers.find(
            {"user_id": user["user_id"]},
            {"_id": 0, "user_id": 0},
        ).sort("created_at", 1)
        docs = await cursor.to_list(length=200)
        return [UserPrinterOut(**d) for d in docs]

    @router.post("", response_model=UserPrinterOut)
    async def create_user_printer(item: UserPrinterIn, request: Request):
        user = await get_current_user(request)
        _validate_gcode_flavor(item.gcode_flavor)
        now = _now_iso()
        pid = str(uuid.uuid4())
        doc = {
            "printer_id": pid,
            "user_id": user["user_id"],
            **item.model_dump(),
            "created_at": now,
            "updated_at": now,
        }
        # Strip mutable `_id` before returning by inserting a copy.
        await db.user_printers.insert_one(dict(doc))
        return UserPrinterOut(**_doc_to_out(doc))

    @router.get("/{pid}", response_model=UserPrinterOut)
    async def get_user_printer(pid: str, request: Request):
        user = await get_current_user(request)
        doc = await db.user_printers.find_one(
            {"printer_id": pid, "user_id": user["user_id"]},
            {"_id": 0, "user_id": 0},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Printer not found")
        return UserPrinterOut(**doc)

    @router.put("/{pid}", response_model=UserPrinterOut)
    async def update_user_printer(pid: str, item: UserPrinterIn, request: Request):
        user = await get_current_user(request)
        _validate_gcode_flavor(item.gcode_flavor)
        existing = await db.user_printers.find_one(
            {"printer_id": pid, "user_id": user["user_id"]},
            {"_id": 0, "printer_id": 1, "created_at": 1},
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Printer not found")
        patch = {**item.model_dump(), "updated_at": _now_iso()}
        await db.user_printers.update_one(
            {"printer_id": pid, "user_id": user["user_id"]},
            {"$set": patch},
        )
        new_doc = await db.user_printers.find_one(
            {"printer_id": pid, "user_id": user["user_id"]},
            {"_id": 0, "user_id": 0},
        )
        return UserPrinterOut(**new_doc)

    @router.delete("/{pid}")
    async def delete_user_printer(pid: str, request: Request):
        user = await get_current_user(request)
        result = await db.user_printers.delete_one(
            {"printer_id": pid, "user_id": user["user_id"]},
        )
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Printer not found")
        return {"deleted": 1, "printer_id": pid}

    return router

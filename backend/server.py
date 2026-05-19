from fastapi import FastAPI, APIRouter, HTTPException, Request, Response as FastResponse
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import base64
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import httpx


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="ForgeSlicer API")
api_router = APIRouter(prefix="/api")


# ---------- Auth (Emergent-managed Google OAuth) ----------
# Flow: frontend redirects to https://auth.emergentagent.com/ with a redirect_url
# that brings the user back to our app with #session_id=... in the URL fragment.
# The frontend POSTs that session_id to /api/auth/session; we exchange it with
# the Emergent auth service for a 7-day session_token, then set an httpOnly
# cookie so subsequent requests are authenticated transparently.

EMERGENT_AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_TTL_DAYS = 7
SESSION_COOKIE = "session_token"


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: str = ""
    created_at: datetime


class SessionExchangeRequest(BaseModel):
    session_id: str


async def _upsert_user_from_emergent(profile: dict) -> dict:
    """Find-or-create a user from the Emergent auth profile.
    Returns the stored user document (without Mongo _id)."""
    email = (profile.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Auth profile missing email")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        # Refresh name/picture in case it changed in Google.
        await db.users.update_one(
            {"email": email},
            {"$set": {
                "name": profile.get("name") or existing.get("name", "User"),
                "picture": profile.get("picture") or existing.get("picture", ""),
                "last_login_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        existing["name"] = profile.get("name") or existing.get("name", "User")
        existing["picture"] = profile.get("picture") or existing.get("picture", "")
        return existing
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": profile.get("name") or email.split("@")[0],
        "picture": profile.get("picture") or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    return doc


async def _resolve_session_token(token: Optional[str]) -> Optional[dict]:
    """Validate a session token, return the user dict or None."""
    if not token:
        return None
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        return None
    expires_at = sess.get("expires_at")
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except Exception:
            return None
    if expires_at is None:
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        # Purge expired session opportunistically.
        await db.user_sessions.delete_one({"session_token": token})
        return None
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    return user


def _extract_token(request: Request) -> Optional[str]:
    """Prefer the httpOnly cookie; fall back to Authorization: Bearer for tools."""
    tok = request.cookies.get(SESSION_COOKIE)
    if tok:
        return tok
    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth.split(None, 1)[1].strip()
    return None


async def get_current_user(request: Request) -> dict:
    """Require an authenticated user. Returns the user dict."""
    user = await _resolve_session_token(_extract_token(request))
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def get_optional_user(request: Request) -> Optional[dict]:
    """Return the user if authenticated, otherwise None. For endpoints that
    work for anonymous visitors but enrich responses for logged-in users."""
    return await _resolve_session_token(_extract_token(request))


@api_router.post("/auth/session")
async def exchange_session(req: SessionExchangeRequest, response: FastResponse):
    """Exchange an Emergent OAuth session_id (one-time, from URL fragment)
    for our app's persistent session_token. Sets an httpOnly cookie."""
    sid = (req.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="Missing session_id")
    try:
        async with httpx.AsyncClient(timeout=15.0) as cx:
            r = await cx.get(EMERGENT_AUTH_SESSION_URL, headers={"X-Session-ID": sid})
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail=f"Auth provider rejected session ({r.status_code})")
        profile = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Auth provider unreachable: {e}")
    user = await _upsert_user_from_emergent(profile)
    session_token = profile.get("session_token") or f"st_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    await db.user_sessions.insert_one({
        "user_id": user["user_id"],
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # httpOnly cookie so JS can't read it; SameSite=None+Secure because the
    # preview frontend and backend live on different sub-paths via ingress.
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_token,
        max_age=SESSION_TTL_DAYS * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture", ""),
    }


@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await _resolve_session_token(_extract_token(request))
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture", ""),
    }


@api_router.post("/auth/logout")
async def logout(request: Request, response: FastResponse):
    tok = _extract_token(request)
    if tok:
        await db.user_sessions.delete_one({"session_token": tok})
    response.delete_cookie(SESSION_COOKIE, path="/", samesite="none", secure=True)
    return {"ok": True}


# ---------- Models ----------
class GalleryItemCreate(BaseModel):
    name: str
    author: str = "Anonymous"
    description: str = ""
    stl_base64: str             # base64-encoded STL bytes
    thumbnail_base64: str = ""  # base64-encoded PNG data url (without prefix)
    triangle_count: int = 0
    object_count: int = 0
    remix_of: Optional[str] = None  # id of the parent gallery item, if this is a remix
    # Editable project JSON (serialized scene). When present, Remix restores
    # the original parts/modifiers/groups instead of importing a flat STL.
    # Stored as a string so the front-end can JSON.parse on load and avoid
    # arbitrary-shape coupling between Pydantic and the scene schema.
    data: Optional[str] = None
    # When true, the item is private to its owner — never returned by the
    # public list endpoint, only by /api/me/designs.
    private: bool = False
    # SPDX-style license identifier (e.g. "cc-by-4.0", "agpl-3.0"). Stored as
    # a free-text id so we can grow the catalog without DB migrations. The
    # frontend canonicalises against /app/frontend/src/lib/licenses.js.
    license: str = "cc-by-4.0"
    # Suggested filament/material for the print (PLA default). Free-text so
    # we can grow the option set without migrations; frontend canonicalises
    # against /app/frontend/src/lib/materials.js.
    material: str = "pla"


class GalleryItemMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    author: str
    description: str
    triangle_count: int
    object_count: int
    thumbnail_base64: str
    created_at: datetime
    downloads: int = 0
    remix_of: Optional[str] = None
    remix_count: int = 0
    # Surfaces ownership + visibility so the UI can show edit/delete buttons
    # only on the user's own items and a "Private" badge on hidden ones.
    user_id: Optional[str] = None
    private: bool = False
    license: str = "cc-by-4.0"
    material: str = "pla"


class CommunityPrinterCreate(BaseModel):
    brand: str
    name: str
    submitter: str = "Anonymous"
    build_x: float
    build_y: float
    build_z: float
    max_nozzle_temp: int = 260
    max_bed_temp: int = 100
    default_nozzle: float = 0.4
    default_print_speed: int = 100
    notes: str = ""


class CommunityPrinter(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    brand: str
    name: str
    submitter: str
    build_x: float
    build_y: float
    build_z: float
    max_nozzle_temp: int
    max_bed_temp: int
    default_nozzle: float
    default_print_speed: int
    notes: str
    created_at: datetime
    uses: int = 0
    votes: int = 0
    verified: bool = False


@api_router.get("/")
async def root():
    return {"message": "ForgeSlicer API", "version": "1.0.0"}


@api_router.post("/gallery", response_model=GalleryItemMeta)
async def create_gallery_item(item: GalleryItemCreate, request: Request):
    item_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    user = await get_optional_user(request)
    # Logged-in users get attribution from their profile name and own the
    # item; anonymous users keep the free-text author field.
    author = (user["name"] if user else (item.author or "Anonymous"))
    doc = {
        "id": item_id,
        "name": item.name,
        "author": author,
        "description": item.description or "",
        "stl_base64": item.stl_base64,
        "thumbnail_base64": item.thumbnail_base64 or "",
        "triangle_count": item.triangle_count,
        "object_count": item.object_count,
        "created_at": created_at.isoformat(),
        "downloads": 0,
        "remix_of": item.remix_of,
        "remix_count": 0,
        # Persist the editable project JSON so a future Remix can restore
        # every primitive with its negative/positive modifier and dimensions.
        "data": item.data or None,
        "user_id": user["user_id"] if user else None,
        "private": bool(item.private) if user else False,
        "license": (item.license or "cc-by-4.0").strip()[:40],
        "material": (item.material or "pla").strip().lower()[:20],
    }
    await db.gallery.insert_one(doc)
    if item.remix_of:
        await db.gallery.update_one({"id": item.remix_of}, {"$inc": {"remix_count": 1}})
    return GalleryItemMeta(
        id=item_id,
        name=doc["name"],
        author=doc["author"],
        description=doc["description"],
        triangle_count=doc["triangle_count"],
        object_count=doc["object_count"],
        thumbnail_base64=doc["thumbnail_base64"],
        created_at=created_at,
        downloads=0,
        remix_of=item.remix_of,
        remix_count=0,
        user_id=doc["user_id"],
        private=doc["private"],
        license=doc["license"],
        material=doc.get("material", "pla"),
    )


def _gallery_meta_from_doc(d: dict) -> GalleryItemMeta:
    ca = d.get("created_at")
    if isinstance(ca, str):
        try:
            ca = datetime.fromisoformat(ca)
        except Exception:
            ca = datetime.now(timezone.utc)
    return GalleryItemMeta(
        id=d["id"],
        name=d.get("name", "Untitled"),
        author=d.get("author", "Anonymous"),
        description=d.get("description", ""),
        triangle_count=d.get("triangle_count", 0),
        object_count=d.get("object_count", 0),
        thumbnail_base64=d.get("thumbnail_base64", ""),
        created_at=ca,
        downloads=d.get("downloads", 0),
        remix_of=d.get("remix_of"),
        remix_count=d.get("remix_count", 0),
        user_id=d.get("user_id"),
        private=bool(d.get("private", False)),
        license=d.get("license", "cc-by-4.0"),
        material=d.get("material", "pla"),
    )


@api_router.get("/gallery", response_model=List[GalleryItemMeta])
async def list_gallery(material: Optional[str] = None):
    # Public listing — hide private items entirely.
    query = {"$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}]}
    if material:
        # Combine with the private filter via $and so we don't lose it.
        query = {"$and": [query, {"material": material.strip().lower()[:20]}]}
    cursor = db.gallery.find(
        query,
        {"_id": 0, "stl_base64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(500)
    return [_gallery_meta_from_doc(d) for d in items]


@api_router.get("/me/designs", response_model=List[GalleryItemMeta])
async def list_my_designs(request: Request):
    user = await get_current_user(request)
    cursor = db.gallery.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "stl_base64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(500)
    return [_gallery_meta_from_doc(d) for d in items]


@api_router.get("/gallery/{item_id}/download")
async def download_gallery_stl(item_id: str):
    doc = await db.gallery.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    await db.gallery.update_one({"id": item_id}, {"$inc": {"downloads": 1}})
    stl_b64 = doc.get("stl_base64", "")
    try:
        stl_bytes = base64.b64decode(stl_b64)
    except Exception as e:
        # Always raise here so we never fall through with an undefined
        # `stl_bytes`. The 500 surfaces "DB blob is malformed" to the client.
        raise HTTPException(status_code=500, detail=f"Corrupted STL data: {e}")
    safe_name = "".join(c for c in doc.get("name", "model") if c.isalnum() or c in ("-", "_")) or "model"
    return Response(
        content=stl_bytes,
        media_type="model/stl",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.stl"'},
    )


@api_router.get("/gallery/{item_id}")
async def get_gallery_item(item_id: str):
    """Return the full gallery record (including editable `data` JSON) so the
    workspace can restore the original parts list when a user clicks Remix —
    not just the baked STL, which would lose all negative/positive tagging."""
    doc = await db.gallery.find_one(
        {"id": item_id},
        {"_id": 0, "stl_base64": 0, "thumbnail_base64": 0},  # strip heavy blobs
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    return doc


@api_router.delete("/gallery/{item_id}")
async def delete_gallery_item(item_id: str, request: Request):
    doc = await db.gallery.find_one({"id": item_id}, {"_id": 0, "user_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    owner_id = doc.get("user_id")
    if owner_id:
        # Owner-only delete for items uploaded by authenticated users.
        user = await get_current_user(request)
        if user["user_id"] != owner_id:
            raise HTTPException(status_code=403, detail="Not your design")
    await db.gallery.delete_one({"id": item_id})
    return {"deleted": True, "id": item_id}


# ---------- Community Printer Profiles ----------
@api_router.post("/printers", response_model=CommunityPrinter)
async def create_community_printer(p: CommunityPrinterCreate):
    pid = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    doc = {
        "id": pid,
        "brand": p.brand.strip()[:40] or "Custom",
        "name": p.name.strip()[:60] or "Printer",
        "submitter": (p.submitter or "Anonymous").strip()[:40] or "Anonymous",
        "build_x": float(p.build_x),
        "build_y": float(p.build_y),
        "build_z": float(p.build_z),
        "max_nozzle_temp": int(p.max_nozzle_temp),
        "max_bed_temp": int(p.max_bed_temp),
        "default_nozzle": float(p.default_nozzle),
        "default_print_speed": int(p.default_print_speed),
        "notes": (p.notes or "").strip()[:280],
        "created_at": created_at.isoformat(),
        "uses": 0,
        "votes": 0,
        "verified": False,
    }
    await db.community_printers.insert_one(doc)
    return CommunityPrinter(**{**doc, "created_at": created_at})


@api_router.get("/printers", response_model=List[CommunityPrinter])
async def list_community_printers():
    # Sort by votes desc, then by created_at desc so top-voted entries surface first.
    cursor = db.community_printers.find({}, {"_id": 0}).sort(
        [("verified", -1), ("votes", -1), ("created_at", -1)]
    )
    items = await cursor.to_list(1000)
    out = []
    for d in items:
        ca = d.get("created_at")
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca)
            except Exception:
                ca = datetime.now(timezone.utc)
        out.append(CommunityPrinter(**{
            **d,
            "created_at": ca,
            "votes": d.get("votes", 0),
            "verified": d.get("verified", False),
        }))
    return out


@api_router.post("/printers/{printer_id}/use")
async def increment_printer_use(printer_id: str):
    res = await db.community_printers.update_one(
        {"id": printer_id}, {"$inc": {"uses": 1}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Printer not found")
    return {"ok": True}


@api_router.post("/printers/{printer_id}/upvote")
async def upvote_printer(printer_id: str):
    res = await db.community_printers.update_one(
        {"id": printer_id}, {"$inc": {"votes": 1}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Printer not found")
    doc = await db.community_printers.find_one({"id": printer_id}, {"_id": 0, "votes": 1})
    return {"ok": True, "votes": doc.get("votes", 0)}


@api_router.delete("/printers/{printer_id}")
async def delete_community_printer(printer_id: str):
    res = await db.community_printers.delete_one({"id": printer_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Printer not found")
    return {"deleted": True, "id": printer_id}


# ---------- Component Library ----------
# A separate collection from the gallery so we can filter/sort independently
# and keep upvote semantics distinct (gallery items track downloads; library
# components track upvotes + uses).
COMPONENT_CATEGORIES = {
    "mechanical", "rack", "mounting", "fasteners", "electronics",
    "brackets", "hinges", "gears", "decorative", "organizers",
    "miniatures", "structural", "toys", "misc",
}


class ComponentCreate(BaseModel):
    name: str
    author: str = "Anonymous"
    description: str = ""
    modifier: str = "positive"          # "positive" or "negative"
    category: str = "misc"              # one of COMPONENT_CATEGORIES
    tags: str = ""                      # free-text, comma-separated
    stl_base64: str
    project_json: str = ""              # ForgeSlicer project JSON for editable add-to-scene
    thumbnail_base64: str = ""
    triangle_count: int = 0
    object_count: int = 0
    private: bool = False               # owner-only when true
    license: str = "cc-by-4.0"          # SPDX-style id; see frontend licenses catalog


class ComponentMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    author: str
    description: str
    modifier: str
    category: str
    tags: str
    thumbnail_base64: str
    triangle_count: int
    object_count: int
    created_at: datetime
    uses: int = 0
    votes: int = 0
    user_id: Optional[str] = None
    private: bool = False
    verified: bool = False
    license: str = "cc-by-4.0"


def _normalize_modifier(m: str) -> str:
    return "negative" if (m or "").lower() == "negative" else "positive"


def _normalize_category(c: str) -> str:
    c = (c or "").lower().strip()
    return c if c in COMPONENT_CATEGORIES else "misc"


@api_router.post("/components", response_model=ComponentMeta)
async def create_component(item: ComponentCreate, request: Request):
    item_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    user = await get_optional_user(request)
    author = (user["name"] if user else ((item.author or "Anonymous").strip()[:40]))
    doc = {
        "id": item_id,
        "name": (item.name or "Untitled").strip()[:80],
        "author": author,
        "description": (item.description or "").strip()[:500],
        "modifier": _normalize_modifier(item.modifier),
        "category": _normalize_category(item.category),
        "tags": (item.tags or "").strip()[:200],
        "stl_base64": item.stl_base64,
        "project_json": item.project_json or "",
        "thumbnail_base64": item.thumbnail_base64 or "",
        "triangle_count": int(item.triangle_count),
        "object_count": int(item.object_count),
        "created_at": created_at.isoformat(),
        "uses": 0,
        "votes": 0,
        "user_id": user["user_id"] if user else None,
        "private": bool(item.private) if user else False,
        "verified": False,
        "license": (item.license or "cc-by-4.0").strip()[:40],
    }
    await db.components.insert_one(doc)
    return ComponentMeta(**{**doc, "created_at": created_at})


@api_router.get("/components", response_model=List[ComponentMeta])
async def list_components(
    modifier: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
):
    query = {"$or": [{"private": {"$ne": True}}, {"private": {"$exists": False}}]}
    if modifier:
        query["modifier"] = _normalize_modifier(modifier)
    if category:
        query["category"] = _normalize_category(category)
    if q:
        # Case-insensitive substring search across name / description / tags / author.
        regex = {"$regex": q.strip()[:80], "$options": "i"}
        # Combine with existing private filter using $and.
        query = {"$and": [
            query,
            {"$or": [
                {"name": regex}, {"description": regex},
                {"tags": regex}, {"author": regex},
            ]},
        ]}
    cursor = db.components.find(
        query,
        {"_id": 0, "stl_base64": 0, "project_json": 0},
    ).sort([("verified", -1), ("votes", -1), ("created_at", -1)])
    items = await cursor.to_list(500)
    out = []
    for d in items:
        ca = d.get("created_at")
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca)
            except Exception:
                ca = datetime.now(timezone.utc)
        out.append(ComponentMeta(**{**d, "created_at": ca}))
    return out


@api_router.get("/me/components", response_model=List[ComponentMeta])
async def list_my_components(request: Request):
    user = await get_current_user(request)
    cursor = db.components.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "stl_base64": 0, "project_json": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(500)
    out = []
    for d in items:
        ca = d.get("created_at")
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca)
            except Exception:
                ca = datetime.now(timezone.utc)
        out.append(ComponentMeta(**{**d, "created_at": ca}))
    return out


@api_router.get("/components/{cid}/project")
async def get_component_project(cid: str):
    """Return the editable ForgeSlicer JSON for a component (used by "Add to Scene")."""
    doc = await db.components.find_one(
        {"id": cid},
        {"_id": 0, "project_json": 1, "name": 1, "modifier": 1, "stl_base64": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Component not found")
    await db.components.update_one({"id": cid}, {"$inc": {"uses": 1}})
    return {
        "name": doc.get("name", "Component"),
        "modifier": doc.get("modifier", "positive"),
        "project_json": doc.get("project_json", ""),
        # Fallback: STL bytes (b64) so the frontend can still import even if
        # project_json is missing (older components).
        "stl_base64": doc.get("stl_base64", ""),
    }


@api_router.post("/components/{cid}/upvote")
async def upvote_component(cid: str):
    res = await db.components.update_one({"id": cid}, {"$inc": {"votes": 1}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Component not found")
    doc = await db.components.find_one({"id": cid}, {"_id": 0, "votes": 1})
    return {"ok": True, "votes": doc.get("votes", 0)}


@api_router.post("/components/{cid}/verify")
async def toggle_verified(cid: str, request: Request):
    """Admin-only toggle for the 'verified' badge on a component. Reads the
    allowlist from ADMIN_EMAILS env (comma-separated). With no allowlist set,
    the endpoint is disabled to prevent accidental abuse."""
    admin_emails = [e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()]
    if not admin_emails:
        raise HTTPException(status_code=403, detail="Admin allowlist not configured")
    user = await get_current_user(request)
    if (user.get("email") or "").lower() not in admin_emails:
        raise HTTPException(status_code=403, detail="Not an admin")
    doc = await db.components.find_one({"id": cid}, {"_id": 0, "verified": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Component not found")
    new_state = not bool(doc.get("verified", False))
    await db.components.update_one({"id": cid}, {"$set": {"verified": new_state}})
    return {"ok": True, "id": cid, "verified": new_state}


@api_router.delete("/components/{cid}")
async def delete_component(cid: str, request: Request):
    doc = await db.components.find_one({"id": cid}, {"_id": 0, "user_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Component not found")
    owner_id = doc.get("user_id")
    if owner_id:
        user = await get_current_user(request)
        if user["user_id"] != owner_id:
            raise HTTPException(status_code=403, detail="Not your component")
    await db.components.delete_one({"id": cid})
    return {"deleted": True, "id": cid}


# ---------- Voice Command Parser ----------
# Browser does speech-to-text via Web Speech API; we receive the transcript
# here and use GPT-5.2 to convert it into a strict JSON command the frontend
# can execute. Keeping the LLM call server-side lets us keep the API key
# secret and reuse the prompt across UI surfaces.
from emergentintegrations.llm.chat import LlmChat, UserMessage  # noqa: E402
import json as _json                                              # noqa: E402

VOICE_SYSTEM_PROMPT = """You are ForgeSlicer's voice command parser. The user speaks
CAD commands; you MUST respond with ONLY a JSON object (no prose, no markdown
fences) describing the action. If the user says something you cannot map to a
valid command, return {"action":"unknown","speech":"<echo of input>"}.

ALLOWED ACTIONS and their schemas:

1. Add a primitive:
   {"action":"add","type":"cube"|"sphere"|"cylinder"|"cone"|"torus"|"circle"|"square2d"|"triangle"|"polygon",
    "modifier":"positive"|"negative",
    "dims":{ ... see per-type below ... }}
   dims by type (all values in millimetres unless noted):
     cube     : {x,y,z}
     sphere   : {r}
     cylinder : {r,h}
     cone     : {r,h}
     torus    : {r,tube}
     circle   : {r,h}            # h = thin wafer height
     square2d : {side,h}
     triangle : {r,h}
     polygon  : {r,sides,h}

2. Transform the current selection:
   {"action":"translate","delta":{x,y,z}}      # mm, additive
   {"action":"rotate","delta":{x,y,z}}          # degrees, additive Euler
   {"action":"scale","factor":{x,y,z}}          # multiplicative ratio
   {"action":"resize","dims":{x?,y?,z?,r?,h?,side?,tube?,sides?}}  # set primitive dims
   {"action":"position","pos":{x,y,z}}          # absolute mm
   {"action":"drop"}                            # drop selection to bed (Y=0)

3. Selection / scene management:
   {"action":"delete"}                  # delete selection
   {"action":"duplicate","mirror":null|"x"|"y"|"z"}
   {"action":"group"}                   # group current multi-selection
   {"action":"ungroup"}
   {"action":"select_all"}
   {"action":"clear_selection"}
   {"action":"undo"}
   {"action":"redo"}

4. Boolean ops on current selection (need 2+ objects):
   {"action":"boolean","op":"union"|"subtract"|"intersect"}

5. Mode switch:
   {"action":"mode","mode":"translate"|"rotate"|"scale"}

6. Open named dialog:
   {"action":"open","dialog":"save_component"|"share_gallery"|"slicer"|"position"|"rotation"|"size"}

7. Export:
   {"action":"export","format":"stl"|"3mf"|"gcode"|"project"}

RULES:
- Output MUST be valid JSON, no markdown.
- Omit keys you cannot determine instead of guessing.
- Default modifier is "positive" unless the user says "hole", "cutout", "subtract", "negative".
- If the user gives X×Y×Z but says "cylinder" infer cylinder with r = max(x,y)/2 and h = z.
- "make it 50mm wide" => resize with x=50 (when current selection exists).
- Always prefer the schema; if in doubt, use action="unknown".
"""


class VoiceCommandRequest(BaseModel):
    transcript: str
    model: Optional[str] = "gpt-5.2"


class VoiceCommandResponse(BaseModel):
    action: str
    raw: dict
    transcript: str


@api_router.post("/voice/command", response_model=VoiceCommandResponse)
async def parse_voice_command(req: VoiceCommandRequest):
    """Parse a free-form voice transcript into a structured CAD command."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="EMERGENT_LLM_KEY not configured")
    text = (req.transcript or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty transcript")
    try:
        chat = LlmChat(
            api_key=key,
            session_id=f"voice-{uuid.uuid4().hex[:8]}",
            system_message=VOICE_SYSTEM_PROMPT,
        ).with_model("openai", req.model or "gpt-5.2")
        response = await chat.send_message(UserMessage(text=text))
        # Strip any accidental code fences
        body = (response or "").strip()
        if body.startswith("```"):
            # Remove first fence line + optional language hint, then trailing fence
            body = body.split("\n", 1)[1] if "\n" in body else body
            if body.endswith("```"):
                body = body[: -3]
            body = body.strip()
        try:
            data = _json.loads(body)
        except Exception:
            data = {"action": "unknown", "speech": text, "_raw": body[:400]}
        if not isinstance(data, dict) or "action" not in data:
            data = {"action": "unknown", "speech": text}
        return VoiceCommandResponse(action=data["action"], raw=data, transcript=text)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Voice command parse failed")
        raise HTTPException(status_code=500, detail=f"LLM error: {e}")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def migrate_legacy_authors():
    """One-time migration: any gallery/components docs that pre-date the
    auth system are tagged with a `user_id=None` + author="Legacy" so the
    UI can clearly mark them as historical, orphaned uploads.

    Idempotent: we only touch docs that don't yet have a `user_id` field —
    rerunning is a no-op once everything has been migrated."""
    try:
        gres = await db.gallery.update_many(
            {"user_id": {"$exists": False}},
            {"$set": {"user_id": None, "private": False},
             "$rename": {"author": "_legacy_author"}},
        )
        # The rename leaves _legacy_author intact for forensics; copy any
        # missing author back as "Legacy" so the public list still labels them.
        await db.gallery.update_many(
            {"_legacy_author": {"$exists": True}},
            [{"$set": {
                "author": {"$concat": ["Legacy · ", {"$ifNull": ["$_legacy_author", "Anonymous"]}]},
            }}],
        )
        cres = await db.components.update_many(
            {"user_id": {"$exists": False}},
            {"$set": {"user_id": None, "private": False},
             "$rename": {"author": "_legacy_author"}},
        )
        await db.components.update_many(
            {"_legacy_author": {"$exists": True}},
            [{"$set": {
                "author": {"$concat": ["Legacy · ", {"$ifNull": ["$_legacy_author", "Anonymous"]}]},
            }}],
        )
        if gres.modified_count or cres.modified_count:
            logger.info(
                "Legacy migration: re-tagged %d gallery + %d components",
                gres.modified_count, cres.modified_count,
            )
    except Exception as e:
        logger.warning("Legacy migration skipped: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

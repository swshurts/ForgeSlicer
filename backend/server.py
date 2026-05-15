from fastapi import FastAPI, APIRouter, HTTPException
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
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="ForgeSlicer API")
api_router = APIRouter(prefix="/api")


# ---------- Models ----------
class GalleryItemCreate(BaseModel):
    name: str
    author: str = "Anonymous"
    description: str = ""
    stl_base64: str             # base64-encoded STL bytes
    thumbnail_base64: str = ""  # base64-encoded PNG data url (without prefix)
    triangle_count: int = 0
    object_count: int = 0


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


@api_router.get("/")
async def root():
    return {"message": "ForgeSlicer API", "version": "1.0.0"}


@api_router.post("/gallery", response_model=GalleryItemMeta)
async def create_gallery_item(item: GalleryItemCreate):
    item_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    doc = {
        "id": item_id,
        "name": item.name,
        "author": item.author or "Anonymous",
        "description": item.description or "",
        "stl_base64": item.stl_base64,
        "thumbnail_base64": item.thumbnail_base64 or "",
        "triangle_count": item.triangle_count,
        "object_count": item.object_count,
        "created_at": created_at.isoformat(),
        "downloads": 0,
    }
    await db.gallery.insert_one(doc)
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
    )


@api_router.get("/gallery", response_model=List[GalleryItemMeta])
async def list_gallery():
    cursor = db.gallery.find(
        {},
        {"_id": 0, "stl_base64": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(500)
    result = []
    for d in items:
        ca = d.get("created_at")
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca)
            except Exception:
                ca = datetime.now(timezone.utc)
        result.append(
            GalleryItemMeta(
                id=d["id"],
                name=d.get("name", "Untitled"),
                author=d.get("author", "Anonymous"),
                description=d.get("description", ""),
                triangle_count=d.get("triangle_count", 0),
                object_count=d.get("object_count", 0),
                thumbnail_base64=d.get("thumbnail_base64", ""),
                created_at=ca,
                downloads=d.get("downloads", 0),
            )
        )
    return result


@api_router.get("/gallery/{item_id}/download")
async def download_gallery_stl(item_id: str):
    doc = await db.gallery.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    await db.gallery.update_one({"id": item_id}, {"$inc": {"downloads": 1}})
    stl_b64 = doc.get("stl_base64", "")
    try:
        stl_bytes = base64.b64decode(stl_b64)
    except Exception:
        raise HTTPException(status_code=500, detail="Corrupted STL data")
    safe_name = "".join(c for c in doc.get("name", "model") if c.isalnum() or c in ("-", "_")) or "model"
    return Response(
        content=stl_bytes,
        media_type="model/stl",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.stl"'},
    )


@api_router.delete("/gallery/{item_id}")
async def delete_gallery_item(item_id: str):
    res = await db.gallery.delete_one({"id": item_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Gallery item not found")
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
    }
    await db.community_printers.insert_one(doc)
    return CommunityPrinter(**{**doc, "created_at": created_at})


@api_router.get("/printers", response_model=List[CommunityPrinter])
async def list_community_printers():
    cursor = db.community_printers.find({}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(1000)
    out = []
    for d in items:
        ca = d.get("created_at")
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca)
            except Exception:
                ca = datetime.now(timezone.utc)
        out.append(CommunityPrinter(**{**d, "created_at": ca}))
    return out


@api_router.post("/printers/{printer_id}/use")
async def increment_printer_use(printer_id: str):
    res = await db.community_printers.update_one(
        {"id": printer_id}, {"$inc": {"uses": 1}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Printer not found")
    return {"ok": True}


@api_router.delete("/printers/{printer_id}")
async def delete_community_printer(printer_id: str):
    res = await db.community_printers.delete_one({"id": printer_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Printer not found")
    return {"deleted": True, "id": printer_id}


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

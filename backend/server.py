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
    remix_of: Optional[str] = None  # id of the parent gallery item, if this is a remix
    # Editable project JSON (serialized scene). When present, Remix restores
    # the original parts/modifiers/groups instead of importing a flat STL.
    # Stored as a string so the front-end can JSON.parse on load and avoid
    # arbitrary-shape coupling between Pydantic and the scene schema.
    data: Optional[str] = None


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
        "remix_of": item.remix_of,
        "remix_count": 0,
        # Persist the editable project JSON so a future Remix can restore
        # every primitive with its negative/positive modifier and dimensions.
        "data": item.data or None,
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
                remix_of=d.get("remix_of"),
                remix_count=d.get("remix_count", 0),
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
COMPONENT_CATEGORIES = {"mechanical", "rack", "mounting", "misc"}


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


def _normalize_modifier(m: str) -> str:
    return "negative" if (m or "").lower() == "negative" else "positive"


def _normalize_category(c: str) -> str:
    c = (c or "").lower().strip()
    return c if c in COMPONENT_CATEGORIES else "misc"


@api_router.post("/components", response_model=ComponentMeta)
async def create_component(item: ComponentCreate):
    item_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    doc = {
        "id": item_id,
        "name": (item.name or "Untitled").strip()[:80],
        "author": (item.author or "Anonymous").strip()[:40],
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
    }
    await db.components.insert_one(doc)
    return ComponentMeta(**{**doc, "created_at": created_at})


@api_router.get("/components", response_model=List[ComponentMeta])
async def list_components(
    modifier: Optional[str] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
):
    query = {}
    if modifier:
        query["modifier"] = _normalize_modifier(modifier)
    if category:
        query["category"] = _normalize_category(category)
    if q:
        # Case-insensitive substring search across name / description / tags / author.
        regex = {"$regex": q.strip()[:80], "$options": "i"}
        query["$or"] = [
            {"name": regex}, {"description": regex},
            {"tags": regex}, {"author": regex},
        ]
    cursor = db.components.find(
        query,
        {"_id": 0, "stl_base64": 0, "project_json": 0},
    ).sort([("votes", -1), ("created_at", -1)])
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


@api_router.delete("/components/{cid}")
async def delete_component(cid: str):
    res = await db.components.delete_one({"id": cid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Component not found")
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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

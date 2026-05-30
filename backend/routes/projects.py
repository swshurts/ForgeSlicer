"""Hierarchical project storage — a per-user tree of named project nodes.

Use case: the user thinks in terms of a high-level goal ("build a rocket")
that decomposes into sub-systems (engine, fuselage, guidance) which each
decompose into parts (fuel pump, mixer, combustion chamber, nozzle). Each
node can either:
  • Hold actual scene geometry (the `forge_json` field — same shape as a
    standalone .forge.json file), AND/OR
  • Contain child nodes (referenced via `parent_id`).

Nodes are scoped to the authenticated user — no public sharing here (the
existing /components and /gallery routes handle public sharing). Project
tree storage is private workspace organisation.

Data model (MongoDB collection `projects`):
  {
    project_id:  str    # uuid4, primary key in our app layer
    user_id:     str    # owner, indexed for fast list queries
    name:        str    # display name (1..120 chars)
    description: str    # optional notes (≤2000 chars)
    parent_id:   str|None  # null = root project for this user
    forge_json:  dict   # the saved scene (objects, settings, etc); can be empty {}
    created_at:  ISO str
    updated_at:  ISO str
  }

There is intentionally NO `children` array — children are discovered by
`parent_id` queries. This keeps writes simple (no two-sided rewrites when
re-parenting a subtree).

Endpoints:
  GET    /api/projects             — list ALL of the user's nodes (flat, client builds the tree)
  POST   /api/projects             — create a new node (root or child)
  GET    /api/projects/{pid}       — fetch one node (incl. forge_json)
  PUT    /api/projects/{pid}       — update name/description/parent_id/forge_json
  DELETE /api/projects/{pid}       — delete a node AND all its descendants (cascade)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import uuid

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field


# ---- Pydantic shapes ----
class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field("", max_length=2000)
    parent_id: Optional[str] = None
    forge_json: Optional[Dict[str, Any]] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    parent_id: Optional[str] = None  # set to "__ROOT__" sentinel to detach (cannot set null via JSON)
    forge_json: Optional[Dict[str, Any]] = None


class ProjectMeta(BaseModel):
    """Listing shape — excludes the heavy forge_json blob for fast tree loads."""
    project_id: str
    name: str
    description: str
    parent_id: Optional[str]
    has_geometry: bool         # whether forge_json has any objects (UI hint)
    object_count: int          # quick stat for UI badges
    created_at: str
    updated_at: str


class ProjectDetail(ProjectMeta):
    """Detail shape — includes the full forge_json blob."""
    forge_json: Dict[str, Any]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _meta_from_doc(doc: dict) -> dict:
    fj = doc.get("forge_json") or {}
    objs = fj.get("objects") if isinstance(fj, dict) else None
    object_count = len(objs) if isinstance(objs, list) else 0
    return {
        "project_id": doc["project_id"],
        "name": doc["name"],
        "description": doc.get("description", ""),
        "parent_id": doc.get("parent_id"),
        "has_geometry": object_count > 0,
        "object_count": object_count,
        "created_at": doc.get("created_at") or _now_iso(),
        "updated_at": doc.get("updated_at") or doc.get("created_at") or _now_iso(),
    }


def build_projects_router(db, get_current_user) -> APIRouter:
    """Construct the projects router. `db` is the motor MongoDB instance,
    `get_current_user` is the auth dependency (raises 401 if missing)."""
    router = APIRouter(prefix="/projects", tags=["projects"])

    @router.get("", response_model=List[ProjectMeta])
    async def list_projects(request: Request):
        """Return a flat list of the user's project nodes (no forge_json
        blobs). The client builds the tree from `parent_id`. Cheap query
        — usually < 100 docs per user."""
        user = await get_current_user(request)
        cursor = db.projects.find(
            {"user_id": user["user_id"]},
            {"_id": 0, "user_id": 0, "forge_json": 0},
        ).sort("created_at", 1)
        docs = await cursor.to_list(length=1000)
        # We still need a count from forge_json; re-fetch per-doc with a
        # projection that just pulls objects.length. To avoid N+1, we do
        # one extra batch query with explicit forge_json projection and
        # merge.
        ids = [d["project_id"] for d in docs]
        size_cursor = db.projects.find(
            {"user_id": user["user_id"], "project_id": {"$in": ids}},
            {"_id": 0, "project_id": 1, "forge_json": 1},
        )
        sizes = {s["project_id"]: s.get("forge_json") for s in await size_cursor.to_list(length=1000)}
        out: List[ProjectMeta] = []
        for d in docs:
            d_with_fj = {**d, "forge_json": sizes.get(d["project_id"]) or {}}
            out.append(ProjectMeta(**_meta_from_doc(d_with_fj)))
        return out

    @router.post("", response_model=ProjectMeta)
    async def create_project(item: ProjectCreate, request: Request):
        user = await get_current_user(request)
        # If parent_id supplied, verify it exists and belongs to this user.
        if item.parent_id:
            parent = await db.projects.find_one(
                {"project_id": item.parent_id, "user_id": user["user_id"]},
                {"_id": 0, "project_id": 1},
            )
            if not parent:
                raise HTTPException(status_code=404, detail="Parent project not found")
        now = _now_iso()
        pid = str(uuid.uuid4())
        doc = {
            "project_id": pid,
            "user_id": user["user_id"],
            "name": item.name.strip(),
            "description": (item.description or "").strip(),
            "parent_id": item.parent_id,
            "forge_json": item.forge_json or {},
            "created_at": now,
            "updated_at": now,
        }
        await db.projects.insert_one(doc)
        return ProjectMeta(**_meta_from_doc(doc))

    @router.get("/{pid}", response_model=ProjectDetail)
    async def get_project(pid: str, request: Request):
        user = await get_current_user(request)
        doc = await db.projects.find_one(
            {"project_id": pid, "user_id": user["user_id"]},
            {"_id": 0, "user_id": 0},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Project not found")
        meta = _meta_from_doc(doc)
        return ProjectDetail(**meta, forge_json=doc.get("forge_json") or {})

    @router.put("/{pid}", response_model=ProjectMeta)
    async def update_project(pid: str, item: ProjectUpdate, request: Request):
        user = await get_current_user(request)
        doc = await db.projects.find_one(
            {"project_id": pid, "user_id": user["user_id"]},
            {"_id": 0},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Project not found")
        patch: Dict[str, Any] = {"updated_at": _now_iso()}
        if item.name is not None:
            patch["name"] = item.name.strip()
        if item.description is not None:
            patch["description"] = item.description.strip()
        if item.forge_json is not None:
            patch["forge_json"] = item.forge_json
        if item.parent_id is not None:
            # Special-case "__ROOT__" sentinel to detach (move to root).
            if item.parent_id == "__ROOT__":
                patch["parent_id"] = None
            else:
                # Verify candidate parent exists and is NOT a descendant of
                # this node (would create a cycle).
                if item.parent_id == pid:
                    raise HTTPException(status_code=400, detail="Cannot parent a project to itself")
                cand = await db.projects.find_one(
                    {"project_id": item.parent_id, "user_id": user["user_id"]},
                    {"_id": 0, "project_id": 1},
                )
                if not cand:
                    raise HTTPException(status_code=404, detail="Parent project not found")
                # Walk up from candidate to root; reject if we hit `pid`.
                cur_id = item.parent_id
                visited = set()
                while cur_id and cur_id not in visited:
                    visited.add(cur_id)
                    if cur_id == pid:
                        raise HTTPException(status_code=400, detail="Cycle detected — cannot move a project under one of its descendants")
                    parent_doc = await db.projects.find_one(
                        {"project_id": cur_id, "user_id": user["user_id"]},
                        {"_id": 0, "parent_id": 1},
                    )
                    cur_id = parent_doc.get("parent_id") if parent_doc else None
                patch["parent_id"] = item.parent_id
        await db.projects.update_one(
            {"project_id": pid, "user_id": user["user_id"]},
            {"$set": patch},
        )
        new_doc = await db.projects.find_one(
            {"project_id": pid, "user_id": user["user_id"]},
            {"_id": 0, "user_id": 0},
        )
        return ProjectMeta(**_meta_from_doc(new_doc))

    @router.delete("/{pid}")
    async def delete_project(pid: str, request: Request):
        """Delete a node AND all of its descendants. We walk the parent_id
        graph downward (BFS) to collect every id in the subtree, then issue
        a single $in delete."""
        user = await get_current_user(request)
        doc = await db.projects.find_one(
            {"project_id": pid, "user_id": user["user_id"]},
            {"_id": 0, "project_id": 1},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Project not found")
        # BFS descendants
        to_visit = [pid]
        all_ids = []
        while to_visit:
            batch = to_visit
            to_visit = []
            all_ids.extend(batch)
            cursor = db.projects.find(
                {"user_id": user["user_id"], "parent_id": {"$in": batch}},
                {"_id": 0, "project_id": 1},
            )
            children = await cursor.to_list(length=10000)
            for c in children:
                to_visit.append(c["project_id"])
        result = await db.projects.delete_many(
            {"user_id": user["user_id"], "project_id": {"$in": all_ids}},
        )
        return {"deleted": result.deleted_count, "ids": all_ids}

    return router

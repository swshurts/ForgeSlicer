"""Cooperative Projects — multi-user projects with approval-based edit
flow (iter-151.10).

The user requested cooperative editing where the CREATOR must approve
every change before it lands. This turns the technical problem from
"realtime CRDT sync" into "proposal queue with a review UI" — much
simpler to build and reason about, and it's the semantic the user
actually asked for (they don't want a co-author to accidentally over-
write their work).

Concept
-------
- A **Project** has an owner, a visibility (private / public), a member
  list (users who can propose changes), and a scene payload (the last
  ACCEPTED state).
- **Private** projects: members are added directly by the owner via
  email lookup.
- **Public** projects: any signed-in user can REQUEST to join; owner
  approves or denies. Approved requesters become members.
- Any member (including the owner) can submit a **Proposal** — a full
  scene snapshot + title + description. Proposals go into a queue.
- The owner reviews the queue and either **Accepts** (proposal's scene
  becomes the project's committed scene, snapshot moves to history) or
  **Rejects** (with an optional note back to the proposer).

Data model
----------
Collections:
  `coop_projects`
    project_id, slug (8-char base32), name, description, owner_id,
    owner_name, visibility ("private"|"public"), members [user_id],
    pending_requests [user_id], scene (dict), scene_version (int),
    created_at, updated_at

  `coop_proposals`
    proposal_id, project_id, proposer_id, proposer_name, title,
    description, scene (dict), status ("pending"|"accepted"|"rejected"),
    owner_note, created_at, decided_at (nullable), decided_by (nullable)

All endpoints under `/api/coop-projects`; all require auth unless noted.
"""
from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from email_service import send_coop_notification_email
from routes.notifications import ensure_email_prefs, push_notification


_SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
MAX_SCENE_BYTES = 512 * 1024  # 512 KB per scene payload — enough for
                              # ~thousand objects, prevents Mongo bloat


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(length: int = 8) -> str:
    return "".join(secrets.choice(_SLUG_ALPHABET) for _ in range(length))


def _check_scene_size(scene: Dict[str, Any]) -> None:
    try:
        raw = json.dumps(scene, separators=(",", ":"))
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"scene is not JSON-serialisable: {e}")
    if len(raw) > MAX_SCENE_BYTES:
        raise HTTPException(status_code=413, detail=f"scene payload > {MAX_SCENE_BYTES // 1024} KB")


# ---- Request / response shapes ----
class CoopProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    visibility: str = Field("private")
    scene: Dict[str, Any] = Field(default_factory=dict)


class CoopProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    visibility: Optional[str] = None


class MemberOp(BaseModel):
    email: EmailStr


class RequestOp(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=120)


class ProposalCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    scene: Dict[str, Any] = Field(default_factory=dict)


class ProposalDecision(BaseModel):
    owner_note: str = Field("", max_length=1000)


# ---- Small serialisers ----
def _project_to_out(doc: dict) -> Dict[str, Any]:
    return {k: v for k, v in doc.items() if k != "_id"}


def _proposal_to_out(doc: dict) -> Dict[str, Any]:
    return {k: v for k, v in doc.items() if k != "_id"}


def build_coop_projects_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/coop-projects", tags=["coop-projects"])

    async def _notify(user_id: str, email: Optional[str], name: Optional[str], *,
                      type: str, title: str, body: str, link: str, cta_text: str) -> None:
        """In-app + (opt-in) email notification. Best-effort; never
        raises so a delivery failure doesn't roll back the caller's
        primary mutation."""
        try:
            await push_notification(db, user_id=user_id, type=type, title=title, body=body, link=link)
        except Exception:  # noqa: BLE001
            pass
        if not email:
            return
        try:
            prefs = await ensure_email_prefs(db, user_id)
            if not prefs.get("coop_opt_in", True):
                return
            import os
            origin = (os.environ.get("APP_ORIGIN") or "").rstrip("/") or "https://forgeslicer.app"
            await send_coop_notification_email(
                to_email=email,
                to_name=name or "",
                title=title,
                body_html=body,
                cta_url=f"{origin}{link}" if link.startswith("/") else link,
                cta_text=cta_text,
                unsubscribe_token=prefs.get("unsubscribe_token"),
            )
        except Exception:  # noqa: BLE001
            pass

    async def _load_project(slug: str) -> Dict[str, Any]:
        doc = await db.coop_projects.find_one({"slug": slug}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Project not found")
        return doc

    async def _require_owner(slug: str, user_id: str) -> Dict[str, Any]:
        doc = await _load_project(slug)
        if doc["owner_id"] != user_id:
            raise HTTPException(status_code=403, detail="Only the owner can do that")
        return doc

    async def _require_member(slug: str, user_id: str) -> Dict[str, Any]:
        doc = await _load_project(slug)
        if doc["owner_id"] != user_id and user_id not in (doc.get("members") or []):
            raise HTTPException(status_code=403, detail="Not a member of this project")
        return doc

    async def _find_available_slug() -> str:
        for _ in range(6):
            s = _slug()
            if not await db.coop_projects.find_one({"slug": s}, {"_id": 1}):
                return s
        return uuid.uuid4().hex[:8]

    async def _lookup_user_by_email(email: str) -> Dict[str, Any]:
        u = await db.users.find_one({"email": email.lower()}, {"_id": 0, "user_id": 1, "name": 1, "email": 1})
        if not u:
            # Case sensitivity fallback — some legacy docs may not have
            # been lower-cased.
            u = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1, "name": 1, "email": 1})
        if not u:
            raise HTTPException(status_code=404, detail=f"No user with email '{email}'")
        return u

    # ---- CRUD ----
    @router.post("")
    async def create_project(item: CoopProjectCreate, request: Request):
        user = await get_current_user(request)
        if item.visibility not in {"private", "public"}:
            raise HTTPException(status_code=400, detail="visibility must be 'private' or 'public'")
        _check_scene_size(item.scene)
        slug = await _find_available_slug()
        now = _now_iso()
        doc = {
            "project_id": str(uuid.uuid4()),
            "slug": slug,
            "name": item.name.strip(),
            "description": item.description.strip(),
            "owner_id": user["user_id"],
            "owner_name": user.get("name") or user.get("email") or "Owner",
            "visibility": item.visibility,
            "members": [],
            "pending_requests": [],
            "scene": item.scene,
            "scene_version": 1,
            "created_at": now,
            "updated_at": now,
        }
        await db.coop_projects.insert_one(dict(doc))
        return _project_to_out(doc)

    @router.get("/mine")
    async def list_mine(request: Request):
        user = await get_current_user(request)
        uid = user["user_id"]
        # Every project where I'm owner OR in members.
        cursor = db.coop_projects.find(
            {"$or": [{"owner_id": uid}, {"members": uid}]},
            {"_id": 0, "scene": 0},  # skip the heavy scene for listing
        ).sort("updated_at", -1)
        docs = await cursor.to_list(length=200)
        return docs

    @router.get("/public")
    async def list_public(limit: int = 30):
        # Public discovery — no scene, no member list; just enough to
        # decide whether to click through.
        capped = max(1, min(100, int(limit)))
        cursor = db.coop_projects.find(
            {"visibility": "public"},
            {"_id": 0, "scene": 0, "members": 0, "pending_requests": 0},
        ).sort("updated_at", -1).limit(capped)
        return await cursor.to_list(length=capped)

    @router.get("/{slug}")
    async def get_project(slug: str, request: Request):
        # Full doc, incl. scene. Visible to:
        #   • Owner
        #   • Members
        #   • Any signed-in user when the project is PUBLIC (so pending
        #     requesters can see what they're joining).
        try:
            user = await get_current_user(request)
        except HTTPException:
            user = None
        doc = await _load_project(slug)
        uid = user["user_id"] if user else None
        is_owner = uid and doc["owner_id"] == uid
        is_member = uid and uid in (doc.get("members") or [])
        if doc["visibility"] == "private" and not (is_owner or is_member):
            raise HTTPException(status_code=403, detail="Private project")
        # Include a viewer_role hint so the frontend can decide what to
        # show without a separate probe.
        role = "owner" if is_owner else "member" if is_member else "viewer"
        if uid and uid in (doc.get("pending_requests") or []):
            role = "pending"
        return {**_project_to_out(doc), "viewer_role": role}

    @router.put("/{slug}")
    async def update_project(slug: str, item: CoopProjectUpdate, request: Request):
        user = await get_current_user(request)
        doc = await _require_owner(slug, user["user_id"])
        patch: Dict[str, Any] = {"updated_at": _now_iso()}
        if item.name is not None:
            patch["name"] = item.name.strip()
        if item.description is not None:
            patch["description"] = item.description.strip()
        if item.visibility is not None:
            if item.visibility not in {"private", "public"}:
                raise HTTPException(status_code=400, detail="visibility must be 'private' or 'public'")
            patch["visibility"] = item.visibility
            # If the owner flips a public project to private, we don't
            # kick existing members but we clear the pending queue —
            # requesters won't be able to become members anymore.
            if item.visibility == "private":
                patch["pending_requests"] = []
        await db.coop_projects.update_one({"slug": slug}, {"$set": patch})
        return _project_to_out({**doc, **patch})

    @router.delete("/{slug}")
    async def delete_project(slug: str, request: Request):
        user = await get_current_user(request)
        await _require_owner(slug, user["user_id"])
        await db.coop_projects.delete_one({"slug": slug})
        # Cascade — proposals belong to this project.
        await db.coop_proposals.delete_many({"project_id_slug": slug})
        return {"deleted": 1, "slug": slug}

    # ---- Membership ----
    @router.post("/{slug}/invite")
    async def invite_member(slug: str, op: MemberOp, request: Request):
        user = await get_current_user(request)
        doc = await _require_owner(slug, user["user_id"])
        invitee = await _lookup_user_by_email(op.email)
        uid = invitee["user_id"]
        if uid == doc["owner_id"]:
            raise HTTPException(status_code=400, detail="Owner is already on the project")
        if uid in (doc.get("members") or []):
            return {"already_member": True, "user_id": uid, "name": invitee.get("name")}
        await db.coop_projects.update_one(
            {"slug": slug},
            {"$addToSet": {"members": uid}, "$pull": {"pending_requests": uid}, "$set": {"updated_at": _now_iso()}},
        )
        # Iter-151.15 — notify the invitee.
        await _notify(
            user_id=uid,
            email=invitee.get("email"),
            name=invitee.get("name"),
            type="coop_invited",
            title=f'You\'ve been added to "{doc["name"]}"',
            body=f'{doc["owner_name"]} invited you to collaborate on their project.',
            link=f"/coop?slug={slug}",
            cta_text="Open project",
        )
        return {"added": True, "user_id": uid, "name": invitee.get("name"), "email": invitee.get("email")}

    @router.post("/{slug}/remove-member")
    async def remove_member(slug: str, op: RequestOp, request: Request):
        user = await get_current_user(request)
        await _require_owner(slug, user["user_id"])
        result = await db.coop_projects.update_one(
            {"slug": slug},
            {"$pull": {"members": op.user_id}, "$set": {"updated_at": _now_iso()}},
        )
        return {"removed": result.modified_count > 0, "user_id": op.user_id}

    @router.post("/{slug}/request-join")
    async def request_join(slug: str, request: Request):
        user = await get_current_user(request)
        doc = await _load_project(slug)
        if doc["visibility"] != "public":
            raise HTTPException(status_code=400, detail="This is a private project")
        uid = user["user_id"]
        if uid == doc["owner_id"] or uid in (doc.get("members") or []):
            return {"already_in": True}
        await db.coop_projects.update_one(
            {"slug": slug},
            {"$addToSet": {"pending_requests": uid}, "$set": {"updated_at": _now_iso()}},
        )
        return {"requested": True}

    @router.post("/{slug}/approve-request")
    async def approve_request(slug: str, op: RequestOp, request: Request):
        user = await get_current_user(request)
        doc = await _require_owner(slug, user["user_id"])
        if op.user_id not in (doc.get("pending_requests") or []):
            raise HTTPException(status_code=404, detail="No such pending request")
        await db.coop_projects.update_one(
            {"slug": slug},
            {"$pull": {"pending_requests": op.user_id}, "$addToSet": {"members": op.user_id}, "$set": {"updated_at": _now_iso()}},
        )
        # Iter-151.15 — notify the newly-approved member.
        approved = await db.users.find_one({"user_id": op.user_id}, {"_id": 0, "email": 1, "name": 1})
        if approved:
            await _notify(
                user_id=op.user_id,
                email=approved.get("email"),
                name=approved.get("name"),
                type="join_approved",
                title=f'You\'re in — welcome to "{doc["name"]}"',
                body=f'{doc["owner_name"]} approved your request to join this project.',
                link=f"/coop?slug={slug}",
                cta_text="Open project",
            )
        return {"approved": True, "user_id": op.user_id}

    @router.post("/{slug}/deny-request")
    async def deny_request(slug: str, op: RequestOp, request: Request):
        user = await get_current_user(request)
        await _require_owner(slug, user["user_id"])
        result = await db.coop_projects.update_one(
            {"slug": slug},
            {"$pull": {"pending_requests": op.user_id}, "$set": {"updated_at": _now_iso()}},
        )
        return {"denied": result.modified_count > 0, "user_id": op.user_id}

    # ---- Proposals ----
    @router.post("/{slug}/proposals")
    async def create_proposal(slug: str, item: ProposalCreate, request: Request):
        user = await get_current_user(request)
        doc = await _require_member(slug, user["user_id"])
        _check_scene_size(item.scene)
        proposal = {
            "proposal_id": str(uuid.uuid4()),
            "project_id_slug": slug,
            "project_id": doc["project_id"],
            "proposer_id": user["user_id"],
            "proposer_name": user.get("name") or user.get("email") or "Anonymous",
            "title": item.title.strip(),
            "description": item.description.strip(),
            "scene": item.scene,
            "status": "pending",
            "owner_note": "",
            "created_at": _now_iso(),
            "decided_at": None,
            "decided_by": None,
        }
        await db.coop_proposals.insert_one(dict(proposal))

        # Iter-151.15 — notify the owner that a new proposal landed.
        owner = await db.users.find_one({"user_id": doc["owner_id"]}, {"_id": 0, "email": 1, "name": 1})
        if owner:
            await _notify(
                user_id=doc["owner_id"],
                email=owner.get("email"),
                name=owner.get("name"),
                type="proposal_submitted",
                title=f'New proposal on "{doc["name"]}"',
                body=f'{proposal["proposer_name"]} submitted: "{proposal["title"]}"',
                link=f"/coop?slug={slug}",
                cta_text="Review proposal",
            )

        return _proposal_to_out(proposal)

    @router.get("/{slug}/proposals")
    async def list_proposals(slug: str, request: Request):
        user = await get_current_user(request)
        doc = await _load_project(slug)
        uid = user["user_id"]
        is_owner = doc["owner_id"] == uid
        is_member = uid in (doc.get("members") or [])
        if not (is_owner or is_member):
            raise HTTPException(status_code=403, detail="Not a member")
        query = {"project_id_slug": slug}
        # Non-owners only see their own proposals — they can't peek at
        # what other members submitted.
        if not is_owner:
            query["proposer_id"] = uid
        cursor = db.coop_proposals.find(query, {"_id": 0}).sort("created_at", -1).limit(300)
        docs = await cursor.to_list(length=300)
        return docs

    @router.post("/{slug}/proposals/{proposal_id}/accept")
    async def accept_proposal(slug: str, proposal_id: str, item: ProposalDecision, request: Request):
        user = await get_current_user(request)
        doc = await _require_owner(slug, user["user_id"])
        prop = await db.coop_proposals.find_one({"proposal_id": proposal_id, "project_id_slug": slug}, {"_id": 0})
        if not prop:
            raise HTTPException(status_code=404, detail="Proposal not found")
        if prop["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Proposal already {prop['status']}")
        now = _now_iso()
        # Commit: replace the project scene with the proposal's scene,
        # bump the version, and mark the proposal as accepted.
        await db.coop_projects.update_one(
            {"slug": slug},
            {"$set": {
                "scene": prop["scene"],
                "scene_version": int(doc.get("scene_version", 1)) + 1,
                "updated_at": now,
            }},
        )
        await db.coop_proposals.update_one(
            {"proposal_id": proposal_id},
            {"$set": {
                "status": "accepted",
                "owner_note": item.owner_note.strip(),
                "decided_at": now,
                "decided_by": user["user_id"],
            }},
        )
        # Iter-151.15 — notify the proposer their change was accepted.
        proposer = await db.users.find_one({"user_id": prop["proposer_id"]}, {"_id": 0, "email": 1, "name": 1})
        if proposer:
            await _notify(
                user_id=prop["proposer_id"],
                email=proposer.get("email"),
                name=proposer.get("name"),
                type="proposal_accepted",
                title=f'"{prop["title"]}" was accepted',
                body=(f'Your proposal on "{doc["name"]}" was accepted by {doc["owner_name"]}. '
                      + (f'Note: {item.owner_note.strip()}' if item.owner_note.strip() else '')),
                link=f"/coop?slug={slug}",
                cta_text="Open project",
            )
        return {"accepted": True, "proposal_id": proposal_id, "scene_version": int(doc.get("scene_version", 1)) + 1}

    @router.post("/{slug}/proposals/{proposal_id}/reject")
    async def reject_proposal(slug: str, proposal_id: str, item: ProposalDecision, request: Request):
        user = await get_current_user(request)
        await _require_owner(slug, user["user_id"])
        prop = await db.coop_proposals.find_one({"proposal_id": proposal_id, "project_id_slug": slug}, {"_id": 0})
        if not prop:
            raise HTTPException(status_code=404, detail="Proposal not found")
        if prop["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Proposal already {prop['status']}")
        now = _now_iso()
        await db.coop_proposals.update_one(
            {"proposal_id": proposal_id},
            {"$set": {
                "status": "rejected",
                "owner_note": item.owner_note.strip(),
                "decided_at": now,
                "decided_by": user["user_id"],
            }},
        )
        # Iter-151.15 — notify the proposer their change was rejected.
        # (Includes the owner's note so the proposer knows WHY.)
        prop_doc = await db.coop_projects.find_one({"slug": slug}, {"_id": 0, "name": 1, "owner_name": 1})
        proposer = await db.users.find_one({"user_id": prop["proposer_id"]}, {"_id": 0, "email": 1, "name": 1})
        if prop_doc and proposer:
            await _notify(
                user_id=prop["proposer_id"],
                email=proposer.get("email"),
                name=proposer.get("name"),
                type="proposal_rejected",
                title=f'"{prop["title"]}" was declined',
                body=(f'Your proposal on "{prop_doc["name"]}" was declined by {prop_doc["owner_name"]}. '
                      + (f'Note: {item.owner_note.strip()}' if item.owner_note.strip() else '')),
                link=f"/coop?slug={slug}",
                cta_text="Open project",
            )
        return {"rejected": True, "proposal_id": proposal_id}

    return router

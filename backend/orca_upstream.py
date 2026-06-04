"""OrcaSlicer upstream profile sync.

Polls the SoftFever/OrcaSlicer GitHub repo for `resources/profiles/*/machine/*.json`
files (the bundled printer presets), tracks per-file SHAs in MongoDB, and surfaces
the deltas (new files / changed files) so an admin can review and one-click
merge them into our globally-available `bundled_synced_printers` collection.

Why this exists
---------------
OrcaSlicer ships new printer presets continuously (10+ new models since
Jan 2026). We can't ask users to wait for our next ForgeSlicer release —
they need today's hardware today. This module gives admins a single
dashboard where new and changed upstream profiles surface within 24 h
of being merged upstream, with a one-click "Accept" that adds them to
our slicer dropdown for every user.

Architecture
------------
Three MongoDB collections:
  - orca_upstream_cache    : {path, vendor, name, sha, raw_json, fetched_at}
                             One row per upstream JSON. SHA is the git blob
                             sha, used to detect "unchanged" without
                             re-downloading the blob.
  - orca_upstream_deltas   : {id, path, vendor, name, kind, prev_sha, new_sha,
                              detected_at, status, action_by, action_at,
                              merged_doc_id}
                             Each detected change creates a pending delta.
                             status ∈ {pending, merged, dismissed}.
                             kind ∈ {new, changed}.
  - bundled_synced_printers: Merged profiles, ready for the frontend to
                              consume via /api/synced-printers (public read).

Sync flow:
  1. GET /repos/SoftFever/OrcaSlicer/git/trees/main?recursive=1 (one call)
  2. Filter tree entries matching `resources/profiles/*/machine/*.json`
  3. For each: if sha matches cache → skip. Else fetch raw JSON,
     upsert cache, append a pending delta row.
  4. Admin reviews deltas in the dashboard, accepts or dismisses.
  5. On accept: parse JSON → upsert into bundled_synced_printers.

Scheduling: a daemon task started by server.py's startup hook runs the
sync every 24 h. Admins can force-run via POST /api/admin/orca-upstream/sync.

Rate limits: the GitHub unauthenticated rate is 60 req/h per IP, which
is plenty for our use case — we make 1 tree call + at most ~10 raw JSON
fetches per run (deltas are tiny most days).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ----------------------------- Constants ------------------------------

GITHUB_REPO = "SoftFever/OrcaSlicer"
GITHUB_BRANCH = "main"
GITHUB_TREE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/git/trees/{GITHUB_BRANCH}?recursive=1"
GITHUB_RAW_BASE = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}"

# Path pattern that matches printer (machine) profiles:
#   resources/profiles/{vendor}/machine/{name}.json
# Examples:
#   resources/profiles/Creality/machine/Creality Ender-3 V3 SE 0.4 nozzle.json
#   resources/profiles/Voron/machine/Voron 2.4 350 0.4 nozzle.json
MACHINE_PATH_RE = re.compile(
    r"^resources/profiles/([^/]+)/machine/([^/]+)\.json$"
)

# Skip profiles whose name suggests they're a base/inherits abstract — these
# never show up on their own in the slicer dropdown, only as parents. Most
# bundled abstracts have "common" / "base" / "fdm_" in the filename.
SKIP_PATTERNS = re.compile(r"(?i)(_common|fdm_machine_common|^base_|_base$|abstract)")

SYNC_INTERVAL_SECONDS = 24 * 60 * 60  # 24h
# Digest cadence — fire one summary email per week per admin even when
# the daily sync ran every day. Spam control: silent weeks send nothing.
DIGEST_INTERVAL_SECONDS = 7 * 24 * 60 * 60
HTTP_TIMEOUT = 20.0


# ----------------------------- Models ---------------------------------

class SyncResult(BaseModel):
    """Returned by POST /admin/orca-upstream/sync."""
    started_at: str
    finished_at: str
    duration_ms: int
    candidates_seen: int
    new_count: int
    changed_count: int
    unchanged_count: int
    skipped_count: int
    error: Optional[str] = None


class UpstreamDelta(BaseModel):
    """Single row in the deltas list shown to admins."""
    id: str
    path: str
    vendor: str
    name: str
    kind: str                # "new" or "changed"
    prev_sha: Optional[str] = None
    new_sha: str
    detected_at: str
    status: str              # "pending" | "merged" | "dismissed"
    action_by: Optional[str] = None
    action_at: Optional[str] = None
    merged_doc_id: Optional[str] = None


class SyncedPrinter(BaseModel):
    """Public-facing synced printer profile served by /api/synced-printers."""
    id: str
    vendor: str
    name: str
    source_path: str
    nozzle_diameter: Optional[float] = None
    build_x_mm: Optional[float] = None
    build_y_mm: Optional[float] = None
    build_z_mm: Optional[float] = None
    gcode_flavor: Optional[str] = None
    raw_profile: dict = Field(default_factory=dict)
    merged_at: str


class UpstreamSuggestionIn(BaseModel):
    """Iter-90: a community user nominates a printer they'd like merged.
    Schema is intentionally loose — most users don't know GitHub paths,
    so a printer name + vendor + optional URL is the minimum bar."""
    printer_name: str = Field(..., min_length=2, max_length=140)
    vendor: Optional[str] = Field(None, max_length=80)
    notes: Optional[str] = Field(None, max_length=1000)
    upstream_url: Optional[str] = Field(None, max_length=400)  # GitHub blob URL or any reference


class UpstreamSuggestion(UpstreamSuggestionIn):
    id: str
    submitted_at: str
    submitted_by: Optional[str] = None
    submitter_email: Optional[str] = None
    status: str = "open"          # "open" | "resolved" | "rejected"
    resolved_by: Optional[str] = None
    resolved_at: Optional[str] = None
    resolution_notes: Optional[str] = None


# ----------------------- Sync implementation --------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gh_headers() -> dict:
    """Add a token from env if present — bumps rate limit from 60/h to
    5000/h. Optional; sync works without it."""
    h = {"Accept": "application/vnd.github+json"}
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


async def _fetch_tree(client: httpx.AsyncClient) -> list[dict]:
    r = await client.get(GITHUB_TREE_URL, headers=_gh_headers())
    if r.status_code == 403:
        raise HTTPException(
            status_code=502,
            detail=("GitHub rate limit hit. Set GITHUB_TOKEN env var "
                    "on the backend to raise the limit from 60/h to 5000/h."),
        )
    r.raise_for_status()
    data = r.json()
    if data.get("truncated"):
        # OrcaSlicer's tree is large but historically well under the 100k
        # entry cap — log if we ever hit it so we know to switch strategies.
        logger.warning("orca-upstream: GitHub tree truncated — some profiles may be missed.")
    return data.get("tree", [])


async def _fetch_raw_json(client: httpx.AsyncClient, path: str) -> dict:
    # `path` is already URL-safe (GitHub returns it as-is from the tree),
    # but contains spaces in profile names. httpx encodes the URL for us.
    url = f"{GITHUB_RAW_BASE}/{path}"
    r = await client.get(url, headers=_gh_headers())
    r.raise_for_status()
    return r.json()


def _coerce_first_nozzle(value) -> Optional[float]:
    """OrcaSlicer's `nozzle_diameter` shows up in three shapes:
      - number: 0.4
      - list of numbers / strings: [0.4] or ["0.4", "0.6"]
      - SEMICOLON-DELIMITED string (machine_model abstracts): "0.4;0.6;0.8"
        These represent profiles that COVER multiple nozzle SKUs. We
        pick the smallest as the canonical / default — that's the
        nozzle most concrete-machine variants ship as.
    Returns None when nothing parseable is present.
    """
    if value is None:
        return None
    candidates: list[float] = []

    def _push(v):
        try:
            if isinstance(v, (int, float)):
                candidates.append(float(v))
            elif isinstance(v, str) and v.strip():
                # A single string may itself contain ";" or "," — split.
                for piece in re.split(r"[;,]", v):
                    piece = piece.strip()
                    if piece:
                        candidates.append(float(piece))
        except (TypeError, ValueError):
            pass

    if isinstance(value, list):
        for item in value:
            _push(item)
    else:
        _push(value)
    if not candidates:
        return None
    # Smallest nozzle = the "default" SKU for an abstract machine_model.
    return min(candidates)


def _parse_quickfields(profile: dict) -> dict:
    """Extract a few human-readable fields from an OrcaSlicer machine JSON
    so the admin dashboard / synced-printers endpoint can render summary
    chips without re-parsing the whole profile on the frontend.

    Handles three flavours of upstream JSON:
      - Concrete `machine` profiles (one nozzle / build vol — most rows)
      - Abstract `machine_model` parents (multi-nozzle strings like
        "0.4;0.6;0.8", build volume usually still present)
      - Files that omit fields entirely — we just skip them quietly
    """
    fields: dict = {}
    nz = _coerce_first_nozzle(profile.get("nozzle_diameter"))
    if nz is not None:
        fields["nozzle_diameter"] = nz
    # Build volume — printable_area is a 4-corner polygon ["XxY","XxY",...]
    try:
        area = profile.get("printable_area")
        if isinstance(area, list) and len(area) >= 3:
            xs, ys = [], []
            for pt in area:
                m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*[x,]\s*(-?\d+(?:\.\d+)?)", str(pt), re.I)
                if m:
                    xs.append(float(m.group(1)))
                    ys.append(float(m.group(2)))
            if xs and ys:
                fields["build_x_mm"] = max(xs) - min(xs)
                fields["build_y_mm"] = max(ys) - min(ys)
        ph = profile.get("printable_height")
        # Printable height shows up as a number, a numeric string, OR
        # — on machine_model abstracts — a semicolon-delimited string
        # like "250;330;500" (one entry per concrete machine variant).
        # Take the SMALLEST so we don't claim a build volume the
        # smallest variant can't reach.
        if isinstance(ph, str):
            nums: list[float] = []
            for piece in re.split(r"[;,]", ph):
                piece = piece.strip()
                if not piece:
                    continue
                try:
                    nums.append(float(piece))
                except ValueError:
                    pass
            ph = min(nums) if nums else None
        if isinstance(ph, (int, float)):
            fields["build_z_mm"] = float(ph)
    except (TypeError, ValueError):
        pass
    flav = profile.get("gcode_flavor")
    if isinstance(flav, str):
        fields["gcode_flavor"] = flav.lower().strip()
    return fields


async def run_sync(db) -> SyncResult:
    """Single sync pass. Idempotent — safe to call repeatedly. Returns
    counts so the admin UI can show "found 3 new, 1 changed" toasts."""
    started = datetime.now(timezone.utc)
    counts = {"new": 0, "changed": 0, "unchanged": 0, "skipped": 0, "seen": 0}
    error: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as cx:
            tree = await _fetch_tree(cx)
            # Build a {path: sha} map of upstream machine profiles.
            upstream: dict[str, dict] = {}
            for entry in tree:
                if entry.get("type") != "blob":
                    continue
                path = entry.get("path", "")
                m = MACHINE_PATH_RE.match(path)
                if not m:
                    continue
                vendor, name = m.group(1), m.group(2)
                if SKIP_PATTERNS.search(name):
                    counts["skipped"] += 1
                    continue
                upstream[path] = {"sha": entry["sha"], "vendor": vendor, "name": name}
            counts["seen"] = len(upstream)

            # Pull our cached SHAs in one query so we can diff in-memory.
            cached_docs = await db.orca_upstream_cache.find(
                {"path": {"$in": list(upstream.keys())}},
                {"_id": 0, "path": 1, "sha": 1},
            ).to_list(length=10000)
            cached = {d["path"]: d["sha"] for d in cached_docs}

            # For every changed / new path, fetch the raw JSON (sequentially
            # to stay polite to GitHub; bursts of changed files are rare).
            for path, info in upstream.items():
                upstream_sha = info["sha"]
                prev_sha = cached.get(path)
                if prev_sha == upstream_sha:
                    counts["unchanged"] += 1
                    continue
                # Fetch the raw JSON to populate cache + delta payload.
                try:
                    raw = await _fetch_raw_json(cx, path)
                except (httpx.HTTPError, json.JSONDecodeError) as e:
                    # Skip this one but continue — a single bad file should
                    # never block the rest of the sync.
                    logger.warning("orca-upstream: failed to fetch %s: %s", path, e)
                    continue
                kind = "changed" if prev_sha else "new"
                counts["new" if kind == "new" else "changed"] += 1
                # Upsert cache.
                await db.orca_upstream_cache.update_one(
                    {"path": path},
                    {"$set": {
                        "path": path,
                        "vendor": info["vendor"],
                        "name": info["name"],
                        "sha": upstream_sha,
                        "raw_json": raw,
                        "fetched_at": _now_iso(),
                    }},
                    upsert=True,
                )
                # Append a delta row. Use vendor+name+new_sha as a natural
                # idempotency key — if the same sha already has a pending
                # delta we don't create another.
                exists = await db.orca_upstream_deltas.find_one(
                    {"path": path, "new_sha": upstream_sha, "status": "pending"},
                    {"_id": 0, "id": 1},
                )
                if exists:
                    continue
                await db.orca_upstream_deltas.insert_one({
                    "id": uuid.uuid4().hex,
                    "path": path,
                    "vendor": info["vendor"],
                    "name": info["name"],
                    "kind": kind,
                    "prev_sha": prev_sha,
                    "new_sha": upstream_sha,
                    "detected_at": _now_iso(),
                    "status": "pending",
                })
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - we always want to record the error
        logger.exception("orca-upstream: sync run failed")
        error = str(e)

    finished = datetime.now(timezone.utc)
    return SyncResult(
        started_at=started.isoformat(),
        finished_at=finished.isoformat(),
        duration_ms=int((finished - started).total_seconds() * 1000),
        candidates_seen=counts["seen"],
        new_count=counts["new"],
        changed_count=counts["changed"],
        unchanged_count=counts["unchanged"],
        skipped_count=counts["skipped"],
        error=error,
    )


async def _scheduler_loop(db) -> None:
    """Background task — runs run_sync once at boot (after a short delay
    so app startup is snappy) and then every 24h."""
    await asyncio.sleep(60)  # Give the server time to fully come up.
    while True:
        try:
            result = await run_sync(db)
            logger.info(
                "orca-upstream daily sync: %d new, %d changed, %d unchanged, %d skipped (took %dms)",
                result.new_count, result.changed_count, result.unchanged_count,
                result.skipped_count, result.duration_ms,
            )
            # Record run timestamp so the admin UI can show "last sync".
            await db.orca_upstream_runs.insert_one({
                "id": uuid.uuid4().hex,
                **result.model_dump(),
                "trigger": "scheduled",
            })
            # Weekly admin digest — fires at most once per
            # DIGEST_INTERVAL_SECONDS even though sync runs daily.
            # `send_admin_digest_if_due` no-ops when not yet due, when
            # Resend is unconfigured, or when no admins exist.
            try:
                await send_admin_digest_if_due(db)
            except Exception as digest_err:  # noqa: BLE001
                logger.warning("orca-upstream digest send failed (non-fatal): %s", digest_err)
        except Exception as e:  # noqa: BLE001
            logger.warning("orca-upstream scheduled sync failed: %s", e)
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)


def start_scheduler(db) -> asyncio.Task:
    """Spawn the background sync loop. Called once from server.py's
    @app.on_event('startup') hook. Returns the task handle so callers
    could cancel it during tests."""
    return asyncio.create_task(_scheduler_loop(db))


async def send_admin_digest_if_due(db) -> dict:
    """Email every admin a "here's what changed upstream since last
    digest" summary. Returns counts so callers (and tests) can verify
    behaviour. Pure no-op when:
      - Resend isn't configured (logged once at boot)
      - Less than DIGEST_INTERVAL_SECONDS since the last successful send
      - No new/changed pending deltas have appeared since `since_iso`

    State is persisted in a singleton `orca_upstream_digest_state` doc
    keyed by `_id='singleton'` so the scheduler can survive restarts
    without re-spamming admins.
    """
    # Lazy import — `email_service` lives at the same level but pulling
    # it in here keeps the dependency graph in one place.
    import email_service  # noqa: WPS433 - intentional lazy import

    now = datetime.now(timezone.utc)
    state = await db.orca_upstream_digest_state.find_one({"_id": "singleton"}) or {}
    last_iso = state.get("last_sent_at")
    if last_iso:
        try:
            last_dt = datetime.fromisoformat(last_iso.replace("Z", "+00:00"))
            if (now - last_dt).total_seconds() < DIGEST_INTERVAL_SECONDS:
                return {"sent": 0, "skipped": "cooldown", "next_due_seconds":
                        int(DIGEST_INTERVAL_SECONDS - (now - last_dt).total_seconds())}
        except (TypeError, ValueError):
            # Corrupt state row → treat as never-sent and continue.
            last_dt = None
    since_iso = last_iso or (now - timedelta(seconds=DIGEST_INTERVAL_SECONDS)).isoformat()

    # Pull deltas newer than `since_iso`. We deliberately do NOT filter
    # by status — admins want to know about changes regardless of
    # whether someone already merged/dismissed mid-week. The status is
    # surfaced in the email row table.
    cursor = db.orca_upstream_deltas.find(
        {"detected_at": {"$gt": since_iso}},
        {"_id": 0, "vendor": 1, "name": 1, "kind": 1, "status": 1, "path": 1},
    )
    deltas = await cursor.to_list(length=2000)
    new_deltas = [d for d in deltas if d.get("kind") == "new"]
    changed_deltas = [d for d in deltas if d.get("kind") == "changed"]
    if not new_deltas and not changed_deltas:
        # Update last_sent_at anyway so a slow week doesn't accumulate
        # into a flood the moment something changes.
        await db.orca_upstream_digest_state.update_one(
            {"_id": "singleton"},
            {"$set": {"_id": "singleton", "last_sent_at": now.isoformat(), "last_status": "no-changes"}},
            upsert=True,
        )
        return {"sent": 0, "skipped": "no-changes"}

    # Fetch admin recipients. Mirrors `_require_admin_for_upstream` in
    # server.py — anyone with `is_admin=True` OR `is_super_admin=True`
    # and a non-empty email gets the digest.
    admin_cursor = db.users.find(
        {"$or": [{"is_admin": True}, {"is_super_admin": True}],
         "email": {"$exists": True, "$ne": ""},
         "banned": {"$ne": True}},
        {"_id": 0, "email": 1, "name": 1},
    )
    admins = await admin_cursor.to_list(length=200)
    if not admins:
        return {"sent": 0, "skipped": "no-admins"}

    sent_count = 0
    failed_count = 0
    for admin in admins:
        msg_id = await email_service.send_upstream_digest(
            admin["email"],
            admin.get("name") or "Admin",
            new_deltas=new_deltas,
            changed_deltas=changed_deltas,
            period_label="since the last digest",
        )
        if msg_id:
            sent_count += 1
        else:
            failed_count += 1

    await db.orca_upstream_digest_state.update_one(
        {"_id": "singleton"},
        {"$set": {
            "_id": "singleton",
            "last_sent_at": now.isoformat(),
            "last_status": "sent",
            "last_recipients": sent_count,
            "last_new_count": len(new_deltas),
            "last_changed_count": len(changed_deltas),
        }},
        upsert=True,
    )
    logger.info(
        "orca-upstream digest: %d admins notified (%d new, %d changed, %d failed)",
        sent_count, len(new_deltas), len(changed_deltas), failed_count,
    )
    return {
        "sent": sent_count, "failed": failed_count,
        "new": len(new_deltas), "changed": len(changed_deltas),
    }


# ----------------------------- Router ---------------------------------

def build_orca_upstream_router(*, db, require_admin) -> APIRouter:
    """Admin-only router mounted under /api/admin/orca-upstream/*.
    Public read endpoint /api/synced-printers is mounted SEPARATELY by
    server.py so it can stay open."""
    router = APIRouter(prefix="/admin/orca-upstream", tags=["admin", "orca-upstream"])

    @router.post("/sync", response_model=SyncResult)
    async def trigger_sync(admin=Depends(require_admin)):
        """Force an immediate sync. Useful when admins know something
        changed upstream and don't want to wait for the daily cron."""
        result = await run_sync(db)
        await db.orca_upstream_runs.insert_one({
            "id": uuid.uuid4().hex,
            **result.model_dump(),
            "trigger": f"manual ({admin.get('email', 'admin')})",
        })
        return result

    @router.post("/digest/send-now")
    async def trigger_digest(admin=Depends(require_admin)):
        """Bypass the weekly cooldown and send the digest email
        immediately to every admin. Used for QA + dry-runs by the
        super-admin who's tuning the email copy. Returns the same
        counts dict the scheduler logs."""
        # Reset the cooldown so this path always fires.
        await db.orca_upstream_digest_state.update_one(
            {"_id": "singleton"},
            {"$set": {"last_sent_at": None}},
            upsert=True,
        )
        return await send_admin_digest_if_due(db)

    @router.get("/digest/state")
    async def get_digest_state(admin=Depends(require_admin)):
        """Surface the digest singleton row so the admin UI can show
        'Last digest sent N days ago to M admins'."""
        state = await db.orca_upstream_digest_state.find_one(
            {"_id": "singleton"}, {"_id": 0},
        )
        return state or {"last_sent_at": None}

    @router.get("/runs")
    async def list_runs(limit: int = 20, admin=Depends(require_admin)):
        """Sync-history table for the admin dashboard."""
        cursor = db.orca_upstream_runs.find(
            {}, {"_id": 0},
        ).sort("started_at", -1).limit(max(1, min(100, limit)))
        return await cursor.to_list(length=limit)

    @router.get("/deltas")
    async def list_deltas(
        status: Optional[str] = "pending",
        limit: int = 200,
        admin=Depends(require_admin),
    ):
        """List deltas filtered by status. Default to pending so the
        dashboard's primary view shows only actionable items."""
        query: dict[str, Any] = {}
        if status and status in ("pending", "merged", "dismissed"):
            query["status"] = status
        cursor = db.orca_upstream_deltas.find(query, {"_id": 0}).sort("detected_at", -1).limit(max(1, min(500, limit)))
        return await cursor.to_list(length=limit)

    @router.get("/deltas/{delta_id}/diff")
    async def get_delta_diff(delta_id: str, admin=Depends(require_admin)):
        """Return the upstream JSON + previously-cached JSON (if changed)
        so the admin can eyeball the change before merging. The cache stores
        only the CURRENT version, so for 'changed' deltas the prev_json is
        retrieved by re-fetching from GitHub at the prev_sha — for the MVP
        we just expose the new JSON and the kind / sha pair."""
        delta = await db.orca_upstream_deltas.find_one({"id": delta_id}, {"_id": 0})
        if not delta:
            raise HTTPException(status_code=404, detail="Delta not found")
        cache = await db.orca_upstream_cache.find_one(
            {"path": delta["path"]},
            {"_id": 0, "raw_json": 1, "sha": 1},
        )
        return {
            "delta": delta,
            "current_json": cache.get("raw_json") if cache else None,
            "current_sha": cache.get("sha") if cache else None,
        }

    @router.post("/deltas/{delta_id}/merge")
    async def merge_delta(delta_id: str, admin=Depends(require_admin)):
        """Promote a delta into bundled_synced_printers. Uses the CURRENT
        cached JSON for the path (which is the version the sync just
        recorded). Idempotent — re-running on an already-merged delta is
        a no-op."""
        delta = await db.orca_upstream_deltas.find_one({"id": delta_id}, {"_id": 0})
        if not delta:
            raise HTTPException(status_code=404, detail="Delta not found")
        if delta["status"] == "merged":
            return {"ok": True, "already_merged": True, "merged_doc_id": delta.get("merged_doc_id")}
        cache = await db.orca_upstream_cache.find_one(
            {"path": delta["path"]},
            {"_id": 0, "raw_json": 1, "sha": 1},
        )
        if not cache or not isinstance(cache.get("raw_json"), dict):
            raise HTTPException(status_code=409, detail="No cached JSON for this delta — re-run sync first.")
        # Upsert into the publicly-served collection. We key on path so
        # repeated merges of the same printer (after upstream changes)
        # overwrite the previous synced doc instead of stacking duplicates.
        synced_id = uuid.uuid4().hex
        quick = _parse_quickfields(cache["raw_json"])
        synced_doc = {
            "id": synced_id,
            "vendor": delta["vendor"],
            "name": delta["name"],
            "source_path": delta["path"],
            "source_sha": cache["sha"],
            "raw_profile": cache["raw_json"],
            "merged_at": _now_iso(),
            "merged_by": admin.get("email", "admin"),
            **quick,
        }
        existing = await db.bundled_synced_printers.find_one(
            {"source_path": delta["path"]},
            {"_id": 0, "id": 1},
        )
        if existing:
            synced_id = existing["id"]
            synced_doc["id"] = synced_id
            await db.bundled_synced_printers.update_one(
                {"source_path": delta["path"]},
                {"$set": synced_doc},
            )
        else:
            await db.bundled_synced_printers.insert_one(synced_doc)
        await db.orca_upstream_deltas.update_one(
            {"id": delta_id},
            {"$set": {
                "status": "merged",
                "action_by": admin.get("email", "admin"),
                "action_at": _now_iso(),
                "merged_doc_id": synced_id,
            }},
        )
        return {"ok": True, "merged_doc_id": synced_id}

    @router.post("/deltas/{delta_id}/dismiss")
    async def dismiss_delta(delta_id: str, admin=Depends(require_admin)):
        """Mark a delta as ignored — won't surface again unless the
        upstream SHA changes again (which would create a NEW pending delta)."""
        result = await db.orca_upstream_deltas.update_one(
            {"id": delta_id, "status": "pending"},
            {"$set": {
                "status": "dismissed",
                "action_by": admin.get("email", "admin"),
                "action_at": _now_iso(),
            }},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Delta not found or not pending")
        return {"ok": True}

    # ---- Iter-90: community suggestions (admin-side) ----

    @router.get("/suggestions")
    async def list_suggestions(
        status: Optional[str] = "open",
        limit: int = Query(200, ge=1, le=500),
        admin=Depends(require_admin),
    ):
        """Show user-submitted "merge this printer please" suggestions.
        Defaults to status=open so the main view is actionable; the
        admin can flip to resolved/rejected via query param."""
        query: dict = {}
        if status and status in ("open", "resolved", "rejected"):
            query["status"] = status
        cursor = db.orca_upstream_suggestions.find(query, {"_id": 0}).sort("submitted_at", -1).limit(limit)
        return await cursor.to_list(length=limit)

    @router.post("/suggestions/{sid}/resolve")
    async def resolve_suggestion(sid: str, payload: dict = None, admin=Depends(require_admin)):
        """Mark the suggestion as resolved — typically because the admin
        merged the matching upstream profile."""
        notes = (payload or {}).get("notes") or ""
        result = await db.orca_upstream_suggestions.update_one(
            {"id": sid, "status": "open"},
            {"$set": {
                "status": "resolved",
                "resolved_by": admin.get("email"),
                "resolved_at": _now_iso(),
                "resolution_notes": notes[:1000],
            }},
        )
        if result.matched_count == 0:
            raise HTTPException(404, "Suggestion not found or not open")
        return {"ok": True}

    @router.post("/suggestions/{sid}/reject")
    async def reject_suggestion(sid: str, payload: dict = None, admin=Depends(require_admin)):
        """Reject a suggestion (out of scope, duplicate, spam, etc.)."""
        notes = (payload or {}).get("notes") or ""
        result = await db.orca_upstream_suggestions.update_one(
            {"id": sid, "status": "open"},
            {"$set": {
                "status": "rejected",
                "resolved_by": admin.get("email"),
                "resolved_at": _now_iso(),
                "resolution_notes": notes[:1000],
            }},
        )
        if result.matched_count == 0:
            raise HTTPException(404, "Suggestion not found or not open")
        return {"ok": True}

    return router


def build_upstream_suggestions_public_router(*, db, get_current_user) -> APIRouter:
    """Iter-90: public-write endpoint for users to suggest upstream
    profiles. Any authenticated user may POST one suggestion at a time.
    Rate-limited at the application layer below (max 5 open per user)
    so a spammer can't drown the admin queue."""
    router = APIRouter(tags=["upstream-suggestions"])

    @router.post("/upstream-suggestions", response_model=UpstreamSuggestion)
    async def submit_suggestion(payload: UpstreamSuggestionIn, request: Request):
        user = await get_current_user(request)
        # Spam guard: cap each user at 5 open suggestions. Admins clear
        # the queue by resolving/rejecting — once they do, the user
        # can submit again.
        open_for_user = await db.orca_upstream_suggestions.count_documents({
            "submitted_by": user["user_id"], "status": "open",
        })
        if open_for_user >= 5:
            raise HTTPException(
                429,
                "You already have 5 open suggestions — wait for an admin to review them before adding more.",
            )
        sid = uuid.uuid4().hex
        doc = {
            "id": sid,
            "submitted_at": _now_iso(),
            "submitted_by": user["user_id"],
            "submitter_email": user.get("email"),
            "status": "open",
            "printer_name": payload.printer_name.strip(),
            "vendor": (payload.vendor or "").strip() or None,
            "notes": (payload.notes or "").strip() or None,
            "upstream_url": (payload.upstream_url or "").strip() or None,
            "resolved_by": None,
            "resolved_at": None,
            "resolution_notes": None,
        }
        await db.orca_upstream_suggestions.insert_one(dict(doc))
        return UpstreamSuggestion(**{k: v for k, v in doc.items() if k != "_id"})

    @router.get("/upstream-suggestions/mine", response_model=list[UpstreamSuggestion])
    async def my_suggestions(request: Request):
        """Lets a user see whether their suggestion is still open or
        resolved — closes the feedback loop so they know the team
        read it."""
        user = await get_current_user(request)
        cursor = db.orca_upstream_suggestions.find(
            {"submitted_by": user["user_id"]},
            {"_id": 0},
        ).sort("submitted_at", -1).limit(50)
        items = await cursor.to_list(length=50)
        return [UpstreamSuggestion(**i) for i in items]

    return router


def build_synced_printers_public_router(*, db) -> APIRouter:
    """Public read-only endpoint serving merged synced printers. Mounted
    at /api/synced-printers so the slicer popover can fetch the augmented
    catalog without auth."""
    router = APIRouter(tags=["synced-printers"])

    @router.get("/synced-printers", response_model=list[SyncedPrinter])
    async def list_synced_printers():
        cursor = db.bundled_synced_printers.find({}, {"_id": 0}).sort("name", 1)
        docs = await cursor.to_list(length=2000)
        out: list[SyncedPrinter] = []
        for d in docs:
            raw = d.get("raw_profile") if isinstance(d.get("raw_profile"), dict) else {}
            # Re-parse quickfields on read: old merges may have been
            # promoted before the multi-nozzle parser landed (iter-86).
            # The stored doc keeps whatever was set at merge time, but
            # the public response always shows the BEST available data.
            fresh = _parse_quickfields(raw) if raw else {}
            out.append(SyncedPrinter(
                id=d.get("id", uuid.uuid4().hex),
                vendor=d.get("vendor", "Unknown"),
                name=d.get("name", "Untitled"),
                source_path=d.get("source_path", ""),
                nozzle_diameter=d.get("nozzle_diameter") if d.get("nozzle_diameter") is not None else fresh.get("nozzle_diameter"),
                build_x_mm=d.get("build_x_mm") if d.get("build_x_mm") is not None else fresh.get("build_x_mm"),
                build_y_mm=d.get("build_y_mm") if d.get("build_y_mm") is not None else fresh.get("build_y_mm"),
                build_z_mm=d.get("build_z_mm") if d.get("build_z_mm") is not None else fresh.get("build_z_mm"),
                gcode_flavor=d.get("gcode_flavor") or fresh.get("gcode_flavor"),
                raw_profile=raw,
                merged_at=d.get("merged_at", ""),
            ))
        return out

    return router

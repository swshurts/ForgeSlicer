"""
OrcaSlicer CLI integration.

Wraps a locally-installed OrcaSlicer binary so the frontend can request
"production-quality" GCODE (multi-perimeter walls, proper infill, real
supports, AMS profiles, etc.) without leaving the browser. The built-in
JavaScript slicer remains the default — Orca is opt-in via the Engine
selector in the Slicer popover.

### Binary resolution
We look for `OrcaSlicer` in this order:
  1. `ORCA_BIN` env var — explicit override.
  2. `/app/backend/bin/orca-aarch64/OrcaSlicer` — the source-built ARM64
     binary baked in by our build script during preview-pod provisioning.
  3. `/app/backend/bin/orca-x86_64/OrcaSlicer` — official AppImage,
     extracted (`--appimage-extract`) and dropped in for production.
  4. PATH lookup — last resort if the system happens to have it.

This list intentionally checks the persistent `/app` path first so a
hand-built binary survives container restarts.

### Endpoints exposed (mounted in server.py)
  - `GET  /api/slice/orca/status` — quick "is the engine ready?" probe so
    the UI can show "installing…" / "ready" / "unsupported" without
    actually attempting a slice. Cheap, no fork.
  - `POST /api/slice/orca` — slice request. Accepts STL bytes (base64) +
    a config bundle (printer profile, process settings, filament). Shells
    out to the CLI, returns the produced GCODE as text plus stats.

### CLI invocation
  Documented OrcaSlicer CLI pattern:
    OrcaSlicer --load-settings "printer.json;process.json" \
               --load-filaments filament.json \
               --slice 0 \
               --export-3mf out.gcode.3mf model.stl
  We extract the embedded `Metadata/plate_1.gcode` from the resulting
  `.gcode.3mf` (which is just a zip file) and return it as plain text.

### Safety
  - Hard 5-min timeout per slice — kills the child if it stalls.
  - Each slice gets its own temp dir, deleted in `finally`.
  - STL upload capped at 50 MB; larger uploads return 413 without
    even spawning Orca.
  - Stdout/stderr captured and returned in the error payload so the UI
    can show a useful failure message instead of a generic 500.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import platform
import secrets
import shutil
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

MAX_STL_BYTES = 50 * 1024 * 1024  # 50 MB cap on uploaded STL
SLICE_TIMEOUT_SEC = 300            # hard kill the CLI after 5 min


# ---------- Binary resolution ----------

@dataclass
class OrcaInstall:
    """Resolved Orca install location + status snapshot.

    Held in-memory across requests so we don't `os.stat` on every status
    poll. Refreshed by `resolve_install(force=True)` whenever the user
    explicitly asks (or `/status` is called).
    """
    binary: Optional[Path]
    resources_dir: Optional[Path]
    arch: str
    version: Optional[str]
    source: str          # "env" / "app-aarch64" / "app-x86_64" / "path" / "missing"
    build_in_progress: bool   # heuristic: build dir exists & no binary yet
    error: Optional[str]


def _file_executable(p: Path) -> bool:
    return p.exists() and p.is_file() and os.access(p, os.X_OK)


def _resolve_appimage_entry(install_dir: Path) -> Optional[Path]:
    """For AppImage installs the launcher is `AppRun` (sets up
    LD_LIBRARY_PATH for any bundled libs + workarounds for locale +
    NVIDIA). The real binary is `bin/orca-slicer`. We prefer AppRun
    because it does the env setup; everything else is fallback for
    layout drift or source-builds."""
    for rel in (
        "AppRun",                  # AppImage v2.x — preferred
        "OrcaSlicer",              # legacy source-build
        "bin/orca-slicer",         # real binary, fallback if AppRun missing
        "usr/bin/OrcaSlicer",
        "usr/bin/orca-slicer",
    ):
        c = install_dir / rel
        if _file_executable(c):
            return c
    return None


def _install_in_progress() -> bool:
    """True while the AppImage installer is running. The script writes
    `/app/backend/bin/.orca_install_lock` for the duration of its run
    so we can surface "installing…" in the status badge without
    polling the script's stdout.

    Includes a stale-lock guard — if the lock file is older than 15
    minutes, we treat it as abandoned (the install crashed or was
    killed without cleanup) and let the next call reset it. Without
    this, a single crashed install leaves the UI stuck on "installing"
    forever, and the only fix would be SSH access to delete the file.

    15 min is generous — a worst-case install is apt-get update (~30s)
    + 30 packages (~60s) + 119 MB download (~10s) + extract (~10s) =
    ~2 min. Padded heavily so a slow network never gets false-cleared."""
    lock = Path("/app/backend/bin/.orca_install_lock")
    if not lock.exists():
        return False
    try:
        age = time.time() - lock.stat().st_mtime
    except OSError:
        return True
    if age > 15 * 60:
        # Stale — clean it up so the next install can run. Best-effort;
        # if the unlink races against a legitimate fast retry we'll
        # just report False this time and the new install will write
        # a fresh lock.
        try:
            lock.unlink()
            logger.warning("Cleared stale OrcaSlicer install lock (age %.0f s).", age)
        except FileNotFoundError:
            pass
        return False
    return True


def _build_in_progress() -> bool:
    """Backward-compat alias used by the status endpoint. Originally
    meant "the C++ source compile is running"; now it also covers the
    AppImage install path (which is the only one we ship)."""
    if _install_in_progress():
        return True
    # The legacy source-build heuristic — kept so a re-introduced
    # source-build path doesn't have to touch this file.
    return Path("/opt/orca-build/src").exists() and not (
        Path("/app/backend/bin/orca-aarch64/OrcaSlicer").exists()
        or Path("/app/backend/bin/orca-x86_64/OrcaSlicer").exists()
        or Path("/app/backend/bin/orca-x86_64/AppRun").exists()
    )


def resolve_install() -> OrcaInstall:
    arch = platform.machine()
    candidates: list[tuple[str, Path, Optional[Path]]] = []
    if (env := os.environ.get("ORCA_BIN")):
        candidates.append(("env", Path(env), None))
    # arch-specific persistent installs under /app. Both flows
    # (source-build → OrcaSlicer binary, AppImage → AppRun launcher)
    # are resolved by _resolve_appimage_entry below.
    if arch in ("aarch64", "arm64"):
        b = Path("/app/backend/bin/orca-aarch64")
        if b.exists():
            entry = _resolve_appimage_entry(b)
            if entry:
                candidates.append(("app-aarch64", entry, b / "resources"))
    if arch in ("x86_64", "amd64"):
        b = Path("/app/backend/bin/orca-x86_64")
        if b.exists():
            entry = _resolve_appimage_entry(b)
            if entry:
                candidates.append(("app-x86_64", entry, b / "resources"))
    # PATH fallback
    which = shutil.which("OrcaSlicer") or shutil.which("orca-slicer")
    if which:
        candidates.append(("path", Path(which), None))

    for source, binp, resp in candidates:
        if _file_executable(binp):
            return OrcaInstall(
                binary=binp,
                resources_dir=resp if resp and resp.exists() else None,
                arch=arch,
                version=None,  # filled lazily by `_probe_version`
                source=source,
                build_in_progress=False,
                error=None,
            )

    return OrcaInstall(
        binary=None,
        resources_dir=None,
        arch=arch,
        version=None,
        source="missing",
        build_in_progress=_build_in_progress(),
        error=None,
    )


async def _probe_version(binp: Path) -> Optional[str]:
    """Best-effort `--version` probe so the status panel can show
    'OrcaSlicer v2.3.2 (aarch64)'. Returns None if Orca doesn't respond
    in 5 s — version is decorative, never a blocker."""
    try:
        proc = await asyncio.create_subprocess_exec(
            str(binp), "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
            return stdout.decode().strip().splitlines()[0] if stdout else None
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return None
    except Exception as e:
        logger.warning("orca --version probe failed: %s", e)
        return None


# ---------- Request / response models ----------

class OrcaSliceRequest(BaseModel):
    """Slice request payload from the frontend.

    `stl_base64` is the binary STL of the merged scene (post-CSG).

    Two ways to specify the slicer config:

    1. **Preset-by-name (recommended)** — set `printer_preset_name` /
       `process_preset_name` / `filament_preset_name` to the name of
       a bundled OrcaSlicer system preset (e.g., "Bambu Lab A1 0.4
       nozzle"). The backend resolves the inheritance chain against
       Orca's bundled `resources/profiles/<vendor>/...` and applies
       any user overrides from `*_profile` on top. This is rock-solid
       because the system presets are guaranteed to pass Orca's
       validator.

    2. **Raw profile JSON (legacy)** — pass the entire profile dict in
       `*_profile`. Subject to OrcaSlicer's strict schema (requires
       `type`, `name`, `from`, `instantiation`, plus a valid `inherits`
       chain). Use only if you know what you're doing.

    The two paths can be mixed: passing `printer_preset_name` plus a
    sparse `printer_profile` applies the overrides from `printer_profile`
    on top of the resolved preset.
    """
    stl_base64: str = Field(..., description="Base64-encoded binary STL")
    printer_profile: dict = Field(default_factory=dict)
    process_profile: dict = Field(default_factory=dict)
    filament_profile: dict = Field(default_factory=dict)
    # Preferred path — name a bundled system preset, server resolves
    # the inheritance chain. Empty / missing → use the raw *_profile
    # path above.
    printer_preset_name: Optional[str] = None
    printer_vendor: Optional[str] = None  # default "BBL"
    process_preset_name: Optional[str] = None
    process_vendor: Optional[str] = None  # default "BBL"
    filament_preset_name: Optional[str] = None
    filament_vendor: Optional[str] = None  # default "BBL"
    # Optional client-supplied job id. When provided, the client can
    # subscribe to /api/slice/orca/progress/<id> BEFORE the slice POST
    # returns and see live % progress as the slicer runs. When omitted
    # the server generates a fresh id (response includes it).
    job_id: Optional[str] = None
    # User-friendly summary so the response stats can reference what
    # was requested (echoed back, not validated server-side).
    description: Optional[str] = None

    model_config = {"populate_by_name": True}


def _resources_root(install: OrcaInstall) -> Optional[Path]:
    """Locate Orca's bundled `resources/profiles/` directory. The
    AppImage layout has it at `<install>/resources/profiles/`; some
    source builds put it under `usr/share/OrcaSlicer/`. We probe both."""
    if install.binary is None:
        return None
    parent = install.binary.parent
    for candidate in (
        parent / "resources" / "profiles",
        parent / "usr" / "share" / "OrcaSlicer" / "profiles",
        # binary might be at install_dir/bin/orca-slicer — go up two.
        parent.parent / "resources" / "profiles",
    ):
        if candidate.is_dir():
            return candidate
    return None


_PROFILE_KINDS = {
    "machine": "machine",
    "process": "process",
    "filament": "filament",
}


# Universal fallback presets — ALWAYS present in OrcaSlicer's bundled
# `resources/profiles/` tree regardless of which AppImage release we
# extract. When the frontend doesn't specify a system preset name
# (e.g., picked a printer we haven't mapped), we resolve through these
# so the JSON we emit is built on top of a fully-flat real preset chain
# instead of a hand-rolled config dict.
#
# Verified at https://github.com/SoftFever/OrcaSlicer/tree/main/resources/profiles/Custom
# Custom/machine/MyKlipper 0.4 nozzle.json — generic Klipper printer
# Custom/process/0.20mm Standard @MyKlipper.json — generic standard profile
# OrcaFilamentLibrary/filament/Generic PLA @System.json — universal PLA
_FALLBACK_PRESETS = {
    "machine": ("Custom", "MyKlipper 0.4 nozzle"),
    "process": ("Custom", "0.20mm Standard @MyKlipper"),
    "filament": ("OrcaFilamentLibrary", "Generic PLA @System"),
}


def _resolve_fallback_preset(
    profiles_root: Path,
    kind: str,
) -> tuple[dict, str, str]:
    """Walk the fallback preset chain. Returns (flat_config_dict,
    vendor, preset_name). Raises FileNotFoundError if even the
    fallback is missing — meaning this OrcaSlicer install is broken
    or non-standard, and the caller should surface a 503.
    """
    vendor, name = _FALLBACK_PRESETS[kind]
    config = _load_system_preset(profiles_root, vendor, kind, name)
    return config, vendor, name


def _load_system_preset(
    profiles_root: Path,
    vendor: str,
    kind: str,
    name: str,
) -> dict:
    """Read a system preset JSON, walking the `inherits` chain to
    produce a single fully-flat config. The result mirrors what
    OrcaSlicer's own preset loader would compute at runtime.

    `vendor` and `kind` map directly onto the on-disk layout:
        `<profiles_root>/<vendor>/<kind>/<name>.json`
    `inherits` references resolve relative to the same directory.

    Raises FileNotFoundError if any link in the chain is missing —
    the caller should surface that as a clean 400 instead of letting
    it crash the request.
    """
    if kind not in _PROFILE_KINDS:
        raise ValueError(f"Unknown profile kind {kind!r}; expected one of {list(_PROFILE_KINDS)}")
    base_dir = profiles_root / vendor / kind
    visited: set[str] = set()
    chain: list[dict] = []
    cursor = name
    while cursor:
        if cursor in visited:
            raise RuntimeError(f"Circular inherits in {vendor}/{kind} starting at {name!r}")
        visited.add(cursor)
        path = base_dir / f"{cursor}.json"
        if not path.is_file():
            raise FileNotFoundError(
                f"System preset {vendor}/{kind}/{cursor}.json not found in {base_dir}"
            )
        with path.open("r", encoding="utf-8") as f:
            doc = json.load(f)
        chain.append(doc)
        cursor = doc.get("inherits") or ""

    # Merge bottom-up: deepest base first, child overrides parent.
    # Metadata fields (type/name/from/setting_id/instantiation/inherits)
    # are taken from the LEAF (the originally-requested preset), so the
    # final JSON declares itself as the user-facing one with `from`
    # flipped to "User" — see _stage_user_profile below.
    merged: dict = {}
    for layer in reversed(chain):
        merged.update(layer)
    return merged


def _orca_stringify(value):
    """Coerce a JSON value into OrcaSlicer's expected on-disk format.

    OrcaSlicer's bundled preset JSONs store EVERY config value as a
    string (even numbers like `"0.4"`, `"350"`, `[true]` → `["1"]`),
    because its `load_from_json` parser uses `set_deserialize(key,
    string_value, ...)` for every config option. When it encounters
    a JSON array-of-numbers like `[0.4]`, `parse_str_arr` returns
    false and the parse loop is BROKEN early — leaving any later
    keys (including the critical `type` metadata) unread, which
    surfaces as the cryptic "unknown config type" CLI error.

    This helper converts:
        * bools  → "1" / "0"   (Orca's serialization format)
        * ints   → "<int>"     (e.g., 350 → "350")
        * floats → "<float>"   (e.g., 0.4 → "0.4" — strip trailing
                                zeros so "0.40000" doesn't appear)
        * lists  → list of stringified scalars (recurses one level)
        * dicts  → dict of stringified values (recurses one level —
                   OrcaSlicer doesn't actually use nested dicts for
                   config keys, but handle it gracefully)
        * other  → str(value) (last-resort coercion)
        * strings → unchanged
    """
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        # Format floats compactly — `repr` keeps precision but adds
        # noise like "0.4" → "0.4" (ok) vs "0.30000000000000004"
        # (bad). Strip a trailing ".0" so "350.0" becomes "350" to
        # match the integer-ish format Orca's bundled JSONs use.
        if isinstance(value, float):
            if value.is_integer():
                return str(int(value))
            return ("%g" % value)
        return str(value)
    if isinstance(value, list):
        return [_orca_stringify(item) for item in value]
    if isinstance(value, dict):
        return {k: _orca_stringify(v) for k, v in value.items()}
    if value is None:
        return ""
    return value  # str — unchanged


def _stage_user_profile(
    base: dict,
    overrides: dict,
    kind: str,
    leaf_name: str,
) -> dict:
    """Compose the final JSON that gets written to `workdir/X.json`
    and handed to the OrcaSlicer CLI.

    Strips the `inherits` field (we've already flattened it) and
    rewrites the metadata so OrcaSlicer's CLI sees a self-contained
    user profile. `from: "User"` is required for any non-system path
    per OrcaSlicer.cpp's `--load-settings` validator.

    KEY-ORDERING INVARIANT
    ----------------------
    OrcaSlicer's `load_from_json` parses keys in JSON-iteration order
    and BREAKS out of the loop the moment it hits a malformed config
    key (e.g., a JSON array containing numbers instead of strings).
    Any keys after the breakpoint are silently dropped. To guarantee
    the metadata fields (`type`, `from`, `name`, `instantiation`,
    `version`) make it into `key_values` regardless of which config
    keys may be malformed, we stamp them FIRST in the output dict.
    Python 3.7+ guarantees dict insertion order is preserved in
    `json.dumps`, so this works as long as `out` is built head-down.

    VALUE-FORMAT INVARIANT
    ----------------------
    OrcaSlicer's bundled JSONs store config values as STRINGS
    (`"350"`, `["0.4"]`). Numeric / array-of-number values trigger
    `parse_str_arr → false → break`. We coerce every non-metadata
    value via `_orca_stringify` so any caller that sends raw Python
    numbers still produces an Orca-valid file.
    """
    type_name = {
        "machine": "machine",
        "process": "process",
        "filament": "filament",
    }[kind]
    leaf_overrides = overrides or {}
    chosen_name = leaf_overrides.get("name") or leaf_name or f"ForgeSlicer {type_name}"

    # 1) Build the metadata header FIRST. These four keys MUST land
    #    in OrcaSlicer's `key_values` map even if a later config-key
    #    parse breaks the loop, so they ride at the top.
    out: dict = {
        "type": type_name,
        "name": chosen_name,
        "from": "User",
        "instantiation": "true",
        # Orca's parser also reads `version` into key_values; not
        # required by `--load-settings` validation, but cheap to
        # include and helps when the file gets diffed during import.
        "version": "01.10.00.00",
    }

    # 2) Layer in the resolved system-preset base (already flattened
    #    by `_load_system_preset`). Drop its metadata keys — we own
    #    those — and drop `inherits` since we're producing a flat
    #    user profile.
    metadata_keys = {"type", "name", "from", "setting_id",
                     "instantiation", "inherits", "version"}
    for k, v in (base or {}).items():
        if k in metadata_keys:
            continue
        out[k] = _orca_stringify(v)

    # 3) Apply user overrides on top so they win over base defaults.
    for k, v in leaf_overrides.items():
        if k in metadata_keys:
            continue
        out[k] = _orca_stringify(v)
    return out



class OrcaSliceStats(BaseModel):
    gcode_lines: int
    gcode_bytes: int
    duration_seconds: float
    layers: Optional[int] = None
    filament_mm: Optional[float] = None


class OrcaSliceResponse(BaseModel):
    gcode: str
    stats: OrcaSliceStats
    engine: str = "orca"
    # Progress job id — the client can subscribe to live updates via
    # /api/slice/orca/progress/<job_id> while the slice runs. Most
    # clients won't need this since /slice blocks until done; it's
    # only useful for slow slices where a progress bar improves UX.
    job_id: Optional[str] = None


class OrcaStatusResponse(BaseModel):
    installed: bool
    arch: str
    source: str
    version: Optional[str] = None
    build_in_progress: bool = False
    binary_path: Optional[str] = None
    # Free-form blob for whatever extra context we want to surface in the
    # UI without having to mint a new field for each one (e.g., build
    # progress percentage if we wire that up later).
    detail: Optional[str] = None


# ---------- Router ----------

router = APIRouter(prefix="/slice/orca", tags=["slice"])



# ---- Slice progress tracking (SSE) -----------------------------------------
# The OrcaSlicer CLI prints `=> Slicing plate N` and `Generating support`
# style status lines as it works. We tail stdout via a background reader
# and surface the parsed percent + stage to an in-memory `_PROGRESS`
# dict keyed by a short job id. The /slice endpoint returns the job id;
# the /progress/<id> SSE endpoint streams updates until the slice
# finishes (or errors out). When `done == True` the client closes the
# stream and reads the final result via the slice POST's HTTP response.
_PROGRESS: dict[str, dict] = {}

# OrcaSlicer 1.x stdout includes percentage hints in two flavours:
#   "Slicing plate 1/1, 23%"  ← from --slice paths
#   "[23%] export"            ← from --export-3mf paths (some builds)
# We match the % token greedily; the stage label is the rest of the line.
_PROGRESS_RE = re.compile(r"\b(\d{1,3})\s*%")


async def _tail_stdout(proc: asyncio.subprocess.Process, job_id: str) -> bytes:
    """Drain `proc.stdout` line-by-line, parse % progress, and update
    the shared progress slot. Returns the full captured stdout bytes
    so the caller can keep its existing error-detection logic."""
    chunks: list[bytes] = []
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        chunks.append(line)
        text = line.decode(errors="replace").strip()
        m = _PROGRESS_RE.search(text)
        if m:
            pct = max(0, min(100, int(m.group(1))))
            stage = text.replace(m.group(0), "").strip(" -:[]") or "slicing"
            slot = _PROGRESS.get(job_id)
            if slot is not None:
                slot.update(percent=pct, stage=stage[:80])
        elif text and not text.startswith("Orca"):
            slot = _PROGRESS.get(job_id)
            if slot is not None and not slot.get("done"):
                slot["stage"] = text[:80]
    return b"".join(chunks)


@router.get("/progress/{job_id}")
async def orca_progress(job_id: str):
    """Server-Sent Events stream of slice progress.
    The client opens an EventSource on this endpoint right after kicking
    off the slice POST. Each `data:` frame is the JSON progress dict.
    Closes when `done == True` or after ~150s of no updates.

    To support the "subscribe BEFORE the slice POST" pattern (so the
    progress bar starts at 0% the moment the user clicks Slice rather
    than first appearing after the first stdout line), this endpoint
    creates an empty progress slot when called for an unknown id. The
    slice POST then finds the existing slot and updates it in place.
    Slot ids must look like a typical token (≤ 32 chars, urlsafe) to
    prevent users from creating arbitrary keys in the dict.
    """
    if not (1 <= len(job_id) <= 32 and all(c.isalnum() or c in "-_" for c in job_id)):
        raise HTTPException(status_code=400, detail="malformed job id")
    if job_id not in _PROGRESS:
        _PROGRESS[job_id] = {"percent": 0, "stage": "waiting for slicer", "done": False, "error": None}
    from fastapi.responses import StreamingResponse
    async def gen():
        idle = 0
        last = None
        while True:
            slot = _PROGRESS.get(job_id)
            if slot is None:
                break
            snap = dict(slot)
            if snap != last:
                yield f"data: {json.dumps(snap)}\n\n"
                last = snap
                idle = 0
            else:
                idle += 1
            if snap.get("done") or snap.get("error"):
                break
            if idle > 300:
                yield f"data: {json.dumps({'percent': snap.get('percent', 0), 'stage': 'no updates', 'done': True, 'error': 'progress stream timed out'})}\n\n"
                break
            await asyncio.sleep(0.5)
    return StreamingResponse(gen(), media_type="text/event-stream")

@router.get("/status", response_model=OrcaStatusResponse)
async def orca_status():
    """Cheap probe — does NOT spawn Orca unless we already think it's
    installed. Frontend polls this when the user toggles the Engine
    selector to give immediate feedback on availability."""
    install = resolve_install()
    version = None
    if install.binary:
        version = await _probe_version(install.binary)

    # Surface the lock file's age in the status detail so a stuck
    # "installing" pill is debuggable just from the JSON — no SSH
    # needed. The 15-min stale-lock guard in _install_in_progress
    # auto-clears it next call, but the user/admin still wants to know
    # "is this really running or did it crash?"
    lock_age_s = None
    lock_path = Path("/app/backend/bin/.orca_install_lock")
    if lock_path.exists():
        try:
            lock_age_s = int(time.time() - lock_path.stat().st_mtime)
        except OSError:
            pass

    detail = None
    if install.source == "missing":
        if install.build_in_progress:
            if lock_age_s is not None and lock_age_s > 5 * 60:
                # Past the 5-min mark — install is taking longer than
                # expected. Surface that so users don't think it's
                # frozen at 30 seconds.
                detail = (
                    f"OrcaSlicer install is still running ({lock_age_s} s elapsed). "
                    f"It auto-aborts after 15 min if hung. Built-in slicer remains "
                    f"available."
                )
            else:
                detail = (
                    "OrcaSlicer is installing on the server (~1-2 min). The "
                    "built-in slicer remains fully functional in the meantime — "
                    "refresh in a minute to see the engine appear."
                )
        elif install.arch not in ("x86_64", "amd64"):
            detail = (
                f"OrcaSlicer ships an x86_64-only AppImage; this server is "
                f"{install.arch}. The built-in slicer remains available."
            )
        else:
            detail = (
                "OrcaSlicer engine is not installed on this server. "
                "Falling back to the built-in JavaScript slicer."
            )
    return OrcaStatusResponse(
        installed=bool(install.binary),
        arch=install.arch,
        source=install.source,
        version=version,
        build_in_progress=install.build_in_progress,
        binary_path=str(install.binary) if install.binary else None,
        detail=detail,
    )
@router.get("/preset")
async def orca_preset(vendor: str, kind: str, name: str):
    """Return the fully-flattened (inherits-walked) bundled OrcaSlicer
    preset JSON so the UI can show the user exactly what config the
    slicer will load.

    Validates the requested `kind` against the known profile kinds —
    refuses anything else as a 400 — so the endpoint can't be tricked
    into reading arbitrary files off the install's `resources/` tree.
    The `name` is joined onto a fixed `<root>/<vendor>/<kind>/` prefix
    by `_load_system_preset`, which already constrains the lookup to
    direct children of that directory.
    """
    if kind not in _PROFILE_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown profile kind {kind!r}; expected one of {sorted(_PROFILE_KINDS)}",
        )
    install = resolve_install()
    if not install.binary:
        raise HTTPException(
            status_code=503,
            detail="OrcaSlicer engine not installed on this server.",
        )
    profiles_root = _resources_root(install)
    if profiles_root is None:
        raise HTTPException(
            status_code=503,
            detail="OrcaSlicer resources/profiles directory was not found on this server.",
        )
    try:
        merged = _load_system_preset(profiles_root, vendor, kind, name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (RuntimeError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve preset: {e}")
    return {
        "vendor": vendor,
        "kind": kind,
        "name": name,
        "preset": merged,
    }


@router.post("/reinstall")
async def orca_reinstall(force: bool = False):
    """Admin: trigger a fresh OrcaSlicer install in the background.
    Useful when an admin wants to refresh the bundled presets / pick
    up a new upstream release without redeploying the whole app.

    Returns 202 (Accepted) immediately with the job's lock-file path —
    the install runs in a background process (`scripts/install_orca.py`)
    and the existing `/api/slice/orca/status` endpoint surfaces its
    progress via the same `lock_age_s` / "installing" detail it uses
    for the first-boot install. No SSE needed; clients poll status.

    `force=true` removes the existing extracted AppImage so the
    installer re-downloads from GitHub even if the binary already
    works (use sparingly — it's a ~119 MB download).
    """
    if _install_in_progress():
        raise HTTPException(
            status_code=409,
            detail="An OrcaSlicer install is already running. Poll /api/slice/orca/status for progress.",
        )
    arch = platform.machine()
    if arch not in ("x86_64", "amd64"):
        # The AppImage is x86_64-only. Returning 400 here so the admin
        # UI can show "not supported on this server" instead of silently
        # firing a no-op install.
        raise HTTPException(
            status_code=400,
            detail=f"OrcaSlicer AppImage is x86_64-only; this server reports {arch!r}. The built-in slicer remains available.",
        )
    script = Path(__file__).resolve().parent / "scripts" / "install_orca.py"
    if not script.exists():
        raise HTTPException(status_code=500, detail=f"Installer script not found at {script}")
    argv = [sys.executable, str(script)]
    if force:
        argv.append("--force")
    # Fire-and-forget: spawn the installer as a detached subprocess so
    # the request returns immediately. The installer manages its own
    # `.orca_install_lock` file (which the status endpoint already
    # surfaces), so we don't need to track the PID here.
    try:
        await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,   # decouple from this request's process group
        )
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to launch installer: {e}")
    return {
        "status": "started",
        "force": bool(force),
        "argv": argv,
        "lock_file": "/app/backend/bin/.orca_install_lock",
    }




@router.post("/slice", response_model=OrcaSliceResponse)
async def orca_slice(req: OrcaSliceRequest):
    """Shell out to OrcaSlicer CLI to produce production-quality GCODE.

    Returns 503 (Service Unavailable) when the engine isn't installed
    instead of a generic 500, so the UI can fall back to the built-in
    slicer gracefully.
    """
    install = resolve_install()
    if not install.binary:
        detail = "OrcaSlicer engine not installed on this server."
        if install.build_in_progress:
            detail += " A build is in progress — try again later."
        raise HTTPException(status_code=503, detail=detail)

    # Decode + size-cap STL upload.
    try:
        stl_bytes = base64.b64decode(req.stl_base64, validate=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 STL: {e}")
    if len(stl_bytes) > MAX_STL_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"STL exceeds {MAX_STL_BYTES // (1024*1024)} MB cap",
        )

    workdir = Path(tempfile.mkdtemp(prefix="orca-"))
    # Use the client-supplied job id if present so the SSE subscription
    # they opened pre-slice ties to the same progress slot. Otherwise
    # generate a fresh one for the response.
    job_id = (req.job_id or secrets.token_urlsafe(8))[:32]
    _PROGRESS[job_id] = {"percent": 0, "stage": "starting", "done": False, "error": None}
    try:
        stl_path = workdir / "model.stl"
        stl_path.write_bytes(stl_bytes)

        # Build the OrcaSlicer CLI argv. We pass profiles as separate
        # files because that's the CLI's documented format; passing them
        # inline is not supported.
        profile_args: list[str] = []
        # Resolve the profile triple. If the request named a system
        # preset (the recommended path), load + flatten the inheritance
        # chain from Orca's bundled resources, then layer overrides.
        # If only the legacy *_profile dict is set, use that as-is —
        # the user is opting out of preset resolution.
        profiles_root = _resources_root(install)
        if profiles_root is None:
            logger.warning("Couldn't locate resources/profiles under %s; using raw profile dicts.", install.binary)
        preset_specs = [
            ("printer", "machine", req.printer_preset_name, req.printer_vendor, req.printer_profile),
            ("process", "process", req.process_preset_name, req.process_vendor, req.process_profile),
            ("filament", "filament", req.filament_preset_name, req.filament_vendor, req.filament_profile),
        ]
        profile_args: list[str] = []
        for file_key, kind, preset_name, vendor, raw_profile in preset_specs:
            base: dict = {}
            resolved_preset_name: Optional[str] = None
            if preset_name:
                if profiles_root is None:
                    # The caller asked for a system preset but we have no
                    # way to resolve it — fail loudly with a 503 instead
                    # of silently writing an empty JSON that OrcaSlicer's
                    # validator would later reject with the cryptic
                    # `unknown config type` error.
                    raise HTTPException(
                        status_code=503,
                        detail=(
                            f"OrcaSlicer engine is installed but its "
                            f"resources/profiles directory was not found "
                            f"on the server, so the requested {file_key} "
                            f"preset {preset_name!r} cannot be resolved. "
                            f"Built-in slicer remains available."
                        ),
                    )
                try:
                    base = _load_system_preset(
                        profiles_root, vendor or "BBL", kind, preset_name,
                    )
                    resolved_preset_name = preset_name
                except FileNotFoundError:
                    # Named preset wasn't found — drop to the fallback
                    # below instead of failing the whole slice. This is
                    # the common case when the frontend picks a printer
                    # we haven't mapped to a bundled preset.
                    logger.warning(
                        "OrcaSlicer system preset %r not found under vendor "
                        "%r (kind=%s); falling back to bundled %s preset.",
                        preset_name, vendor, kind, kind,
                    )
                except (RuntimeError, json.JSONDecodeError) as e:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to resolve {file_key} preset {preset_name!r}: {e}",
                    )

            # When no system preset was loaded (no name given OR the
            # named preset was missing), ride the universal fallback
            # chain so the file we write is built on top of a real
            # OrcaSlicer-validated config rather than synthesised
            # from scratch.
            if not base and profiles_root is not None:
                try:
                    base, _, resolved_preset_name = _resolve_fallback_preset(
                        profiles_root, kind,
                    )
                except FileNotFoundError as e:
                    # Even the fallback's missing — this OrcaSlicer
                    # install is broken. Surface 503 so the UI can
                    # fall back to the built-in slicer cleanly.
                    raise HTTPException(
                        status_code=503,
                        detail=(
                            f"OrcaSlicer is installed but its bundled "
                            f"fallback {kind} preset is missing "
                            f"({e}). The install may be corrupted; "
                            f"try `POST /api/slice/orca/reinstall?force=true`."
                        ),
                    )

            # Skip writing the file entirely only when BOTH the system-preset
            # base AND the raw override are empty — otherwise we'd produce a
            # bogus zero-key JSON that OrcaSlicer can't validate.
            if not base and not raw_profile:
                continue
            # ALWAYS run through `_stage_user_profile` so the required
            # metadata fields (type / name / from / instantiation) are
            # stamped onto the final JSON, regardless of which path got us
            # here. This protects against the new-frontend / no-preset-root
            # combination that previously produced an empty `{}` file.
            leaf_name = (
                resolved_preset_name
                or preset_name
                or (raw_profile.get("name") if isinstance(raw_profile, dict) else None)
                or f"ForgeSlicer {kind}"
            )
            final = _stage_user_profile(base, raw_profile, kind, leaf_name)
            p = workdir / f"{file_key}.json"
            p.write_text(json.dumps(final, indent=2))
            if file_key == "filament":
                profile_args += ["--load-filaments", str(p)]
            else:
                profile_args.append(str(p))

        # If neither printer nor process was provided we still need
        # something to satisfy --load-settings; fall back to Orca's bundled
        # generic FFF default. The resources path varies between source
        # builds and AppImages, so we just let Orca find them.
        if any(p.exists() for p in (workdir / "printer.json", workdir / "process.json")):
            settings_files = ";".join(
                str(p) for p in (workdir / "printer.json", workdir / "process.json")
                if p.exists()
            )
            load_settings = ["--load-settings", settings_files]
        else:
            load_settings = []

        out_3mf = workdir / "out.gcode.3mf"
        argv = [
            str(install.binary),
            *load_settings,
            *[a for a in profile_args if a in ("--load-filaments",) or a.endswith(".json") and "filament" in a],
            "--slice", "0",
            "--export-3mf", str(out_3mf),
            str(stl_path),
        ]
        logger.info("orca slice argv: %s", argv)

        import time
        t0 = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(workdir),
            env={**os.environ, "HOME": str(workdir)},   # avoid touching the real $HOME
        )
        try:
            # Drain stdout via our tail-reader (parses % progress into
            # _PROGRESS[job_id] for the SSE endpoint), and collect
            # stderr in parallel. asyncio.gather lets both pumps run
            # concurrently — without this stderr can fill its pipe
            # and deadlock the slicer for large outputs.
            stdout, stderr = await asyncio.wait_for(
                asyncio.gather(_tail_stdout(proc, job_id), proc.stderr.read()),
                timeout=SLICE_TIMEOUT_SEC,
            )
            await proc.wait()
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            slot = _PROGRESS.get(job_id)
            if slot is not None:
                slot.update(done=True, error="slice timeout", percent=100)
            raise HTTPException(
                status_code=504,
                detail=f"OrcaSlicer slice exceeded {SLICE_TIMEOUT_SEC}s and was killed.",
            )
        duration = time.monotonic() - t0

        if proc.returncode != 0:
            tail = (stderr or b"")[-2000:].decode(errors="replace")
            logger.warning("orca slice rc=%s err=%s", proc.returncode, tail)
            # Detect the "missing shared library" pattern (rc=127 +
            # ld.so error). This is the production-container failure
            # mode we hit before `install_orca_deps.sh` was wired
            # in — return a friendly 503 with the exact missing lib
            # so an admin can install it (or just redeploy if they've
            # already merged the deps script).
            missing_lib = None
            if "error while loading shared libraries" in tail or "cannot open shared object" in tail:
                m = re.search(r"(lib[\w.+-]+\.so[\.\d]*)", tail)
                if m:
                    missing_lib = m.group(1)
            if missing_lib:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"OrcaSlicer engine couldn't start — system library "
                        f"'{missing_lib}' is missing in the server container. "
                        f"An admin should run `bash backend/scripts/install_orca_deps.sh` "
                        f"or rebuild with the OrcaSlicer runtime deps in the Dockerfile. "
                        f"Built-in slicer is unaffected."
                    ),
                )
            # Detect OrcaSlicer's profile-JSON validator errors. The
            # CLI prints `operator():file X.json's from <value> is
            # unsupported` when a profile JSON is missing required
            # metadata or has bad values. Surface a clean message
            # rather than the raw C++ trace.
            if "operator()" in tail and "json" in tail and ("unsupported" in tail or "is invalid" in tail):
                m = re.search(r"file\s+(\S+\.json)", tail)
                bad_file = m.group(1).rsplit("/", 1)[-1] if m else "a profile"
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"OrcaSlicer rejected {bad_file} — the profile JSON is missing "
                        f"required metadata (type / name / from / instantiation) or "
                        f"contains a value the slicer doesn't recognise. This is a "
                        f"client-side bug; please report it. Built-in slicer is unaffected."
                    ),
                )
            raise HTTPException(
                status_code=500,
                detail=f"OrcaSlicer exited with code {proc.returncode}: {tail}",
            )

        if not out_3mf.exists():
            raise HTTPException(
                status_code=500,
                detail="OrcaSlicer returned success but produced no output 3MF.",
            )

        # Extract embedded GCODE from the gcode.3mf bundle. OrcaSlicer
        # writes Metadata/plate_1.gcode by default; we accept any
        # `*.gcode` inside the archive as a defensive fallback.
        gcode_text = _extract_gcode_from_3mf(out_3mf)
        layers, filament_mm = _scan_gcode_stats(gcode_text)
        slot = _PROGRESS.get(job_id)
        if slot is not None:
            slot.update(percent=100, stage="done", done=True)
        return OrcaSliceResponse(
            gcode=gcode_text,
            stats=OrcaSliceStats(
                gcode_lines=gcode_text.count("\n") + 1,
                gcode_bytes=len(gcode_text.encode()),
                duration_seconds=round(duration, 2),
                layers=layers,
                filament_mm=filament_mm,
            ),
            engine="orca",
            job_id=job_id,
        )
    except HTTPException as e:
        # Surface the failure on the SSE stream so the UI can stop the
        # spinner instead of waiting for the 150s idle timeout.
        slot = _PROGRESS.get(job_id)
        if slot is not None:
            slot.update(done=True, error=str(e.detail)[:200])
        raise
    finally:
        # Always clean the workdir — profiles + STL + the 3MF can be
        # several megabytes each and we don't want them piling up on the
        # backend.
        shutil.rmtree(workdir, ignore_errors=True)


def _extract_gcode_from_3mf(path: Path) -> str:
    with zipfile.ZipFile(path, "r") as zf:
        gcode_entries = [n for n in zf.namelist() if n.lower().endswith(".gcode")]
        if not gcode_entries:
            raise HTTPException(
                status_code=500,
                detail=f"3MF archive contained no .gcode file: {zf.namelist()[:5]}",
            )
        # Prefer plate_1 if present (OrcaSlicer default); fall back to
        # the first .gcode entry alphabetically for unusual configs.
        preferred = next((n for n in gcode_entries if "plate_1" in n), gcode_entries[0])
        with zf.open(preferred) as fh:
            return fh.read().decode("utf-8", errors="replace")


def _scan_gcode_stats(gcode: str) -> tuple[Optional[int], Optional[float]]:
    """Best-effort layer-count + filament estimate extraction from the
    GCODE so the UI's stats card can show useful numbers. Both fields
    are optional — None means we couldn't parse them, not an error."""
    layers = 0
    filament_mm: Optional[float] = None
    for line in gcode.splitlines():
        if line.startswith(";LAYER:") or line.startswith("; LAYER:"):
            layers += 1
        elif "filament used [mm]" in line.lower():
            try:
                # OrcaSlicer footer: "; filament used [mm] = 1234.56"
                filament_mm = float(line.split("=", 1)[1].strip())
            except Exception:
                pass
    return (layers or None, filament_mm)

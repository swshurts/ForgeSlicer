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
    # Per-user custom printer (P1, iter-72). When set, the server
    # loads `/api/me/printers/{user_printer_id}`, derives the printer
    # profile dict from its fields, and overrides any
    # printer_preset_name / printer_profile in this same request.
    # Stays None for users on a bundled OrcaSlicer system preset.
    user_printer_id: Optional[str] = None
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
    # Profile-base files moved to a `base/` sub-directory in OrcaSlicer
    # v2.3.x (e.g. `OrcaFilamentLibrary/filament/base/fdm_filament_pla.json`)
    # while user-facing presets still live directly under the kind folder.
    # We probe BOTH so this loader works against both old and new layouts.
    base_alt = base_dir / "base"
    visited: set[str] = set()
    chain: list[dict] = []
    cursor = name
    while cursor:
        if cursor in visited:
            raise RuntimeError(f"Circular inherits in {vendor}/{kind} starting at {name!r}")
        visited.add(cursor)
        path: Optional[Path] = None
        for candidate in (base_dir / f"{cursor}.json", base_alt / f"{cursor}.json"):
            if candidate.is_file():
                path = candidate
                break
        if path is None:
            raise FileNotFoundError(
                f"System preset {vendor}/{kind}/{cursor}.json not found in {base_dir} or {base_alt}"
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
    #    `from: "system"` (not "User") is required for the v2.3.x
    #    compatibility check — OrcaSlicer uses the file's own `name`
    #    as the "inherited from" identity ONLY for system presets,
    #    which is what the process's `compatible_printers` list
    #    matches against. With `from: User` and no `inherits`, the
    #    check fails with rc -17 ("process not compatible with
    #    printer") even when names align.
    out: dict = {
        "type": type_name,
        "name": chosen_name,
        "from": "system",
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

    # 4) OrcaSlicer v2.3.x adds a slicer-side validation: when the
    #    machine uses relative-E addressing (Marlin / Klipper default
    #    in 2.3+), the layer-change gcode MUST contain `G92 E0` to
    #    reset extrusion floating-point accumulation. The bundled
    #    `Custom/MyKlipper 0.4 nozzle` machine ships an empty layer
    #    gcode, which fails this check with rc -51 / 239 / "Relative
    #    extruder addressing requires resetting the extruder position
    #    at each layer". Inject the directive on machine profiles
    #    where it's missing so a vanilla preset chain just slices.
    if kind == "machine":
        rel = out.get("use_relative_e_distances")
        # Treat undefined as TRUE — that matches Orca's runtime default
        # for non-BBL Klipper-style machines per the 2.3.x release notes.
        relative_e = (rel is None) or (str(rel).lower() in ("1", "true", "yes"))
        layer_gcode = out.get("layer_change_gcode") or out.get("layer_gcode") or ""
        if relative_e and "G92 E0" not in layer_gcode:
            # Preserve any existing layer-change directives the user
            # / bundled preset already set up — just prepend G92 E0.
            new_gcode = "G92 E0\n" + layer_gcode if layer_gcode else "G92 E0"
            out["layer_change_gcode"] = new_gcode
    return out


def _patch_cross_profile_compatibility(staged: dict) -> dict:
    """Rewrite `compatible_printers` / `compatible_prints` across the
    staged process + filament dicts so OrcaSlicer's
    `Preset::is_compatible_with_printer()` accepts whichever
    printer + process combo the caller picked.

    BACKGROUND
    ----------
    OrcaSlicer ships every process JSON with a `compatible_printers`
    array enumerating the exact printer profile names it was authored
    for (e.g. `Bambu Lab A1`). When the CLI loads a process whose
    list doesn't include the loaded printer's name, it exits with
    `run 2559: process not compatible with printer (-17)`. The
    desktop GUI sidesteps this by rewriting the user-side process
    JSON when you toggle "compatible with this printer" in its
    Compatibility panel — this helper does the equivalent rewrite on
    our temp JSONs, so cross-vendor combos (e.g. a Bambu process on
    a Sovol SV06 Plus Ace) slice cleanly without per-vendor mapping
    tables.

    Mutates `staged` in place AND returns it so callers can chain or
    inspect the result. Safe to call when `staged` is missing any of
    the three keys (no-op for the absent slot).

    Also strips `*_condition` keys — those are boolean expressions
    evaluated against printer notes / variables; leaving a stale
    expression in place can flip the verdict back to "not compatible"
    even after we've fixed the list.
    """
    printer_name = (staged.get("printer") or {}).get("name") or ""
    process_name = (staged.get("process") or {}).get("name") or ""

    if "process" in staged and printer_name:
        proc = staged["process"]
        current = proc.get("compatible_printers") or []
        if not isinstance(current, list) or printer_name not in current:
            logger.info(
                "orca: patching process %r compatible_printers to include %r "
                "(was: %r)", process_name, printer_name, current,
            )
            proc["compatible_printers"] = [printer_name]
        proc.pop("compatible_printers_condition", None)

    if "filament" in staged:
        fil = staged["filament"]
        if printer_name:
            cur = fil.get("compatible_printers") or []
            if not isinstance(cur, list) or printer_name not in cur:
                fil["compatible_printers"] = [printer_name]
            fil.pop("compatible_printers_condition", None)
        if process_name:
            cur = fil.get("compatible_prints") or []
            if not isinstance(cur, list) or process_name not in cur:
                fil["compatible_prints"] = [process_name]
            fil.pop("compatible_prints_condition", None)

    return staged


class OrcaSliceStats(BaseModel):
    gcode_lines: int
    gcode_bytes: int
    duration_seconds: float
    layers: Optional[int] = None
    filament_mm: Optional[float] = None
    # Non-fatal warnings extracted from OrcaSlicer's per-slice log.
    # Populated when the CLI reported "Object can't be printed for empty
    # layer", "floating regions", or other slicing warnings that still
    # produced GCODE — but where the user almost certainly wants to
    # re-orient or enable supports before sending to the printer.
    # Iter-79.
    warnings: list[str] = []


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
        # Emit an initial comment frame so the EventSource fires
        # `open` immediately and intermediate proxies commit headers
        # before the first real `data:` frame arrives.
        yield ": connected\n\n"
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
                # Keep-alive comment every ~5 s (idle ticks at 0.5 s
                # cadence). SSE comments are silently dropped by the
                # browser, but they force Cloudflare / Nginx to
                # acknowledge bytes-on-the-wire so the idle timeout
                # doesn't fire while Orca is still in `--load-settings`
                # parsing (which can take 5-15 s before any stdout).
                if idle % 10 == 0:
                    yield ": ping\n\n"
            if snap.get("done") or snap.get("error"):
                break
            if idle > 300:
                yield f"data: {json.dumps({'percent': snap.get('percent', 0), 'stage': 'no updates', 'done': True, 'error': 'progress stream timed out'})}\n\n"
                break
            await asyncio.sleep(0.5)
    # Disable buffering at every layer (Nginx, Cloudflare, browser
    # cache) so each `data:` frame is flushed immediately. Without
    # `X-Accel-Buffering: no`, edge proxies hold the response body
    # in a buffer until the connection closes, which manifests as
    # the SSE "Lost connection to slicer progress stream" the user
    # was hitting on production. Iter-78.
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

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
    # Route to the arch-appropriate installer. x86_64 → Python script
    # that fetches the AppImage; aarch64/arm64 → shell script that
    # installs the upstream flatpak + wires a sandbox-free launcher.
    if arch in ("x86_64", "amd64"):
        script = Path(__file__).resolve().parent / "scripts" / "install_orca.py"
        if not script.exists():
            raise HTTPException(status_code=500, detail=f"Installer script not found at {script}")
        argv = [sys.executable, str(script)]
        if force:
            argv.append("--force")
    elif arch in ("aarch64", "arm64"):
        script = Path(__file__).resolve().parent / "scripts" / "install_orca_arm64.sh"
        if not script.exists():
            raise HTTPException(status_code=500, detail=f"Installer script not found at {script}")
        argv = ["bash", str(script)]
        if force:
            argv.append("--force")
    else:
        raise HTTPException(
            status_code=400,
            detail=f"OrcaSlicer not supported on {arch!r} — only x86_64 and aarch64 have packaged binaries. Built-in slicer remains available.",
        )
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




class OrcaSliceAccepted(BaseModel):
    """202 response from the new async-job slice endpoint.

    The slice work runs in a background task; clients should subscribe
    to `/api/slice/orca/progress/{job_id}` for live % updates, then
    fetch `/api/slice/orca/result/{job_id}` to retrieve the GCODE.
    """
    job_id: str
    status: str = "accepted"
    engine: str = "orca"


# Job result TTL: how long we keep a completed job's result in memory
# before evicting it. The client should fetch /result/{job_id}
# immediately after seeing SSE done=true, so 10 minutes is plenty of
# headroom while still bounding memory if the client never comes back
# (e.g. browser tab closed).
_JOB_RESULT_TTL_SEC = 10 * 60


# Pluggable resolver for `user_printer_id` → printer_profile dict.
# `server.py` calls `register_user_printer_resolver(fn)` at startup to
# wire in the MongoDB lookup. Kept here so `orca_engine` remains free
# of motor / DB imports while still supporting the per-user printers
# feature (iter-72). The callable signature is:
#   async def resolver(user_id: str | None, user_printer_id: str) -> dict | None
# Return None to indicate "not found / not owned by this user"; the
# slice will then surface a 400 to the client. Return a dict shaped
# like `PRINTER_PROFILES` entries on the frontend
# (printer_model / nozzle_diameter / printable_area / etc.).
_user_printer_resolver = None
# Companion hook: `server.py` registers an `async fn(request) -> user_id|None`
# so the slice handler can identify the caller without importing the
# auth machinery (which would create a circular import).
_user_id_extractor = None


def register_user_printer_resolver(fn):
    """Wire the `user_printer_id` → printer_profile dict resolver.
    `server.py` registers this once at startup so the slice flow can
    pull custom printers from the `user_printers` collection without
    `orca_engine.py` having to import motor / the DB handle."""
    global _user_printer_resolver
    _user_printer_resolver = fn


def register_user_id_extractor(fn):
    """Wire the `Request → user_id | None` extractor. Called when the
    slice request includes `user_printer_id` so we can verify the
    caller actually owns it."""
    global _user_id_extractor
    _user_id_extractor = fn


async def _extract_user_id(request) -> Optional[str]:
    """Internal — call the registered extractor or return None."""
    if _user_id_extractor is None:
        return None
    return await _user_id_extractor(request)


def _evict_stale_progress_slots(now: float) -> None:
    """Drop progress slots whose `done` timestamp is older than the
    TTL. Runs opportunistically on every /result fetch so we don't
    need a background sweeper — bounded by O(progress_slots) per
    call, which is negligible at our scale."""
    stale: list[str] = []
    for jid, slot in _PROGRESS.items():
        if slot.get("done") and slot.get("done_at"):
            if now - slot["done_at"] > _JOB_RESULT_TTL_SEC:
                stale.append(jid)
    for jid in stale:
        _PROGRESS.pop(jid, None)


async def _perform_slice(
    req: "OrcaSliceRequest",
    job_id: str,
    workdir: Path,
    install: OrcaInstall,
    stl_bytes: bytes,
) -> None:
    """Run the actual OrcaSlicer CLI slice. Designed to be called
    via `asyncio.create_task` so the POST /slice endpoint can return
    202 immediately and avoid the Cloudflare 100s origin-timeout
    (HTTP 524) that surfaces for slices longer than ~100s.

    Everything that used to raise HTTPException now writes the
    failure to `_PROGRESS[job_id]['error_detail']` + status code, so
    /result/{job_id} can surface the same response shape the
    synchronous endpoint used to return. The result dict
    (`OrcaSliceResponse` payload) is stored in `slot['result']`.
    """
    import time as _time
    try:
        stl_path = workdir / "model.stl"
        stl_path.write_bytes(stl_bytes)

        # Build the OrcaSlicer CLI argv. We pass profiles as separate
        # files because that's the CLI's documented format; passing them
        # inline is not supported.
        profile_args: list[str] = []
        profiles_root = _resources_root(install)
        if profiles_root is None:
            logger.warning("Couldn't locate resources/profiles under %s; using raw profile dicts.", install.binary)
        preset_specs = [
            ("printer", "machine", req.printer_preset_name, req.printer_vendor, req.printer_profile),
            ("process", "process", req.process_preset_name, req.process_vendor, req.process_profile),
            ("filament", "filament", req.filament_preset_name, req.filament_vendor, req.filament_profile),
        ]
        # Stage each profile (printer / process / filament) into memory
        # FIRST, then post-process compatibility fields across the trio
        # before writing to disk. See `_patch_cross_profile_compatibility`
        # for why this matters across vendor combos.
        staged: dict[str, dict] = {}
        for file_key, kind, preset_name, vendor, raw_profile in preset_specs:
            base: dict = {}
            resolved_preset_name: Optional[str] = None
            if preset_name:
                if profiles_root is None:
                    _job_error(
                        job_id,
                        status_code=503,
                        detail=(
                            f"OrcaSlicer engine is installed but its "
                            f"resources/profiles directory was not found "
                            f"on the server, so the requested {file_key} "
                            f"preset {preset_name!r} cannot be resolved. "
                            f"Built-in slicer remains available."
                        ),
                    )
                    return
                try:
                    base = _load_system_preset(
                        profiles_root, vendor or "BBL", kind, preset_name,
                    )
                    resolved_preset_name = preset_name
                except FileNotFoundError:
                    logger.warning(
                        "OrcaSlicer system preset %r not found under vendor "
                        "%r (kind=%s); falling back to bundled %s preset.",
                        preset_name, vendor, kind, kind,
                    )
                except (RuntimeError, json.JSONDecodeError) as e:
                    _job_error(job_id, 500, f"Failed to resolve {file_key} preset {preset_name!r}: {e}")
                    return

            if not base and profiles_root is not None:
                try:
                    base, _, resolved_preset_name = _resolve_fallback_preset(
                        profiles_root, kind,
                    )
                except FileNotFoundError as e:
                    _job_error(
                        job_id, 503,
                        f"OrcaSlicer is installed but its bundled "
                        f"fallback {kind} preset is missing ({e}). "
                        f"The install may be corrupted; try "
                        f"`POST /api/slice/orca/reinstall?force=true`.",
                    )
                    return

            if not base and not raw_profile:
                continue
            leaf_name = (
                resolved_preset_name
                or preset_name
                or (raw_profile.get("name") if isinstance(raw_profile, dict) else None)
                or f"ForgeSlicer {kind}"
            )
            staged[file_key] = _stage_user_profile(base, raw_profile, kind, leaf_name)

        _patch_cross_profile_compatibility(staged)

        # Write staged profiles + assemble CLI argv.
        for file_key, final in staged.items():
            p = workdir / f"{file_key}.json"
            p.write_text(json.dumps(final, indent=2))
            if file_key == "filament":
                profile_args += ["--load-filaments", str(p)]
            else:
                profile_args.append(str(p))

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
            # Max verbosity so OrcaSlicer's BOOST_LOG_TRIVIAL writes
            # `[error]` lines to stderr instead of swallowing them at
            # the default `info` severity threshold. Without this we
            # get rc=156 + empty stderr + no log file for any
            # validation failure. Iter-78.
            "--debug", "5",
            *load_settings,
            *[a for a in profile_args if a in ("--load-filaments",) or a.endswith(".json") and "filament" in a],
            "--slice", "0",
            "--export-3mf", str(out_3mf),
            str(stl_path),
        ]
        logger.info("orca slice job=%s argv=%s", job_id, argv)

        t0 = _time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(workdir),
            env={**os.environ, "HOME": str(workdir)},
        )
        # Stash the subprocess on the progress slot so DELETE /job/{id}
        # can kill it (iter-77 cancel-slice). The cancel handler reads
        # this AND sets `cancelled=True` so the rc-handling below treats
        # the kill-from-cancel path as a user-initiated cancel rather
        # than a generic "rc != 0" failure.
        slot = _PROGRESS.get(job_id)
        if slot is not None:
            slot["proc"] = proc
        try:
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
            _job_error(
                job_id, 504,
                f"OrcaSlicer slice exceeded {SLICE_TIMEOUT_SEC}s and was killed.",
            )
            return
        duration = _time.monotonic() - t0

        if proc.returncode != 0:
            # If the user clicked Cancel, the DELETE handler killed the
            # subprocess and stamped `cancelled=True` on the slot. Skip
            # the generic rc-error reporting and surface a clean 499 (a
            # non-standard but widely-used "client closed request"
            # status code) so the UI can show "Slice cancelled" rather
            # than "OrcaSlicer exited with code -9".
            slot_now = _PROGRESS.get(job_id) or {}
            if slot_now.get("cancelled"):
                _job_error(job_id, 499, "Slice cancelled by user.")
                return
            # Bump tail from 2 KB → 8 KB so the real `[error]` line — which
            # OrcaSlicer prints *before* the generic
            # "run found error, return -100" wrapper — actually fits in
            # the response when Orca is verbose (multiple plates,
            # progress dots, etc.). Iter-78.
            stdout_full = (stdout or b"").decode(errors="replace")
            stderr_full = (stderr or b"").decode(errors="replace")
            stdout_tail = stdout_full[-8000:]
            stderr_tail = stderr_full[-8000:]
            # Persist full logs to a path that survives workdir cleanup
            # so an admin / the user can fetch the unabridged output via
            # GET /api/slice/orca/fail-log/{job_id}. OrcaSlicer's CLI
            # writes its REAL diagnostic logs to a file under
            # `$HOME/.config/OrcaSlicer/log/OrcaSlicer.*.log` (not
            # stderr), so we also scoop those up here — without this
            # we get rc=156 + empty stderr and zero signal. Iter-78.
            slicer_log_text = ""
            slicer_log_files = []
            try:
                log_dir = workdir / ".config" / "OrcaSlicer" / "log"
                if log_dir.is_dir():
                    for p in sorted(log_dir.rglob("*.log")):
                        try:
                            txt = p.read_text(errors="replace")
                            slicer_log_files.append(str(p))
                            slicer_log_text += (
                                f"\n----- {p.name} ({len(txt)} bytes) -----\n{txt}"
                            )
                        except Exception:
                            pass
            except Exception as _slog_err:
                logger.warning("orca slicer-log scrape failed: %s", _slog_err)
            try:
                fail_log = Path(tempfile.gettempdir()) / f"orca-fail-{job_id}.log"
                # Also include the actual JSON config files we handed
                # to OrcaSlicer. When stderr is empty and no Orca log
                # gets written, these are the only signal left — they
                # let us inspect the staged printer/process/filament
                # dicts post-hoc and spot the bad field. Iter-78.
                profile_jsons = ""
                for fname in ("printer.json", "process.json", "filament.json"):
                    p = workdir / fname
                    if p.exists():
                        try:
                            profile_jsons += (
                                f"\n----- {fname} ({p.stat().st_size} bytes) -----\n"
                                f"{p.read_text(errors='replace')}\n"
                            )
                        except Exception:
                            pass
                fail_log.write_text(
                    f"=== argv ===\n{argv}\n\n"
                    f"=== rc ===\n{proc.returncode}\n\n"
                    f"=== stderr ===\n{stderr_full}\n\n"
                    f"=== stdout ===\n{stdout_full}\n\n"
                    f"=== orca config logs ({len(slicer_log_files)} file(s)) ==={slicer_log_text}\n\n"
                    f"=== staged profile JSONs ==={profile_jsons}\n"
                )
            except Exception as _flog_err:
                logger.warning("orca fail-log write failed: %s", _flog_err)
            # Distill the real cause: OrcaSlicer's CLI prints the actual
            # validation failure ABOVE the generic
            # "run found error, return -100, exit code: -100" footer.
            # Scan the *whole* stderr (not just the tail) for lines that
            # look like the real reason and prepend them so the user
            # sees the actionable bit first.
            cause_lines: list[str] = []
            cause_re = re.compile(
                r"(?i)(\[error\]|\berror:|\bcannot\b|\binvalid\b|"
                r"\bmismatched?\b|\bout of range\b|\bnot found\b|"
                r"\bunknown\b|\bunsupported\b|\bfailed to\b|"
                r"\bexceeds?\b|\btoo (small|large|big|short|tall)\b|"
                r"\bvalidate\b|"
                # OrcaSlicer's CLI prints these as `[warning]` but
                # still bails with rc=156, so we treat them as the
                # real cause. Empty-layer / floating-region warnings
                # are the most common reason a model fails to slice
                # without supports. Iter-78.
                r"\bempty layer\b|\bfloating regions?\b|"
                r"\bcan't be printed\b|\bfaulty mesh\b|"
                r"\bslicing warnings?\b)"
            )
            for line in (stderr_full + "\n" + stdout_full + "\n" + slicer_log_text).splitlines():
                s = line.strip()
                if not s:
                    continue
                # Skip the generic wrapper footers — they hide the cause.
                if "run found error" in s or s.startswith("exit code"):
                    continue
                if cause_re.search(s):
                    cause_lines.append(s)
                if len(cause_lines) >= 6:
                    break
            cause_summary = " | ".join(cause_lines)
            tail = (stderr_tail + "\n" + stdout_tail).strip()
            if cause_summary:
                tail = cause_summary + "\n---\n" + tail
            logger.warning("orca slice rc=%s cause=%s", proc.returncode, cause_summary or "(none parsed)")
            missing_lib = None
            if "error while loading shared libraries" in tail or "cannot open shared object" in tail:
                m = re.search(r"(lib[\w.+-]+\.so[\.\d]*)", tail)
                if m:
                    missing_lib = m.group(1)
            if missing_lib:
                _job_error(
                    job_id, 503,
                    f"OrcaSlicer engine couldn't start — system library "
                    f"'{missing_lib}' is missing in the server container. "
                    f"An admin should run `bash backend/scripts/install_orca_deps.sh` "
                    f"or rebuild with the OrcaSlicer runtime deps in the Dockerfile. "
                    f"Built-in slicer is unaffected.",
                )
                return
            if "operator()" in tail and "json" in tail and ("unsupported" in tail or "is invalid" in tail):
                m = re.search(r"file\s+(\S+\.json)", tail)
                bad_file = m.group(1).rsplit("/", 1)[-1] if m else "a profile"
                _job_error(
                    job_id, 400,
                    f"OrcaSlicer rejected {bad_file} — the profile JSON is missing "
                    f"required metadata (type / name / from / instantiation) or "
                    f"contains a value the slicer doesn't recognise. This is a "
                    f"client-side bug; please report it. Built-in slicer is unaffected.",
                )
                return
            _job_error(job_id, 500, f"OrcaSlicer exited with code {proc.returncode}: {tail}\n\nFull log: GET /api/slice/orca/fail-log/{job_id}")
            return

        if not out_3mf.exists():
            _job_error(job_id, 500, "OrcaSlicer returned success but produced no output 3MF.")
            return

        try:
            gcode_text = _extract_gcode_from_3mf(out_3mf)
        except HTTPException as e:
            _job_error(job_id, e.status_code, str(e.detail))
            return
        layers, filament_mm = _scan_gcode_stats(gcode_text)
        # Scan OrcaSlicer's stdout for non-fatal warnings that still
        # produced GCODE — most importantly the "empty layer between
        # Z=X and Z=Y" / "floating regions" pair that tells the user
        # the slicer dropped some geometry. Surfacing these as a
        # `warnings` array in the response (rather than failing the
        # slice) lets the UI display a clear "re-orient or enable
        # supports" banner alongside the GCODE the user just got.
        # Iter-79.
        stdout_full_ok = (stdout or b"").decode(errors="replace")
        warning_re = re.compile(
            r"(?i)(empty layer|floating regions?|can't be printed|"
            r"faulty mesh|object collides|gcode conflicts)"
        )
        warnings: list[str] = []
        for line in stdout_full_ok.splitlines():
            s = line.strip()
            if not s:
                continue
            if warning_re.search(s):
                # Trim Orca's timestamp/thread-id prefix so the UI
                # message is short and actionable.
                cleaned = re.sub(
                    r"^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*\[[^\]]+\]\s*\[\w+\]\s*",
                    "",
                    s,
                ).strip()
                if cleaned and cleaned not in warnings:
                    warnings.append(cleaned)
            if len(warnings) >= 12:
                break
        slot = _PROGRESS.get(job_id)
        if slot is not None:
            slot["result"] = {
                "gcode": gcode_text,
                "stats": {
                    "gcode_lines": gcode_text.count("\n") + 1,
                    "gcode_bytes": len(gcode_text.encode()),
                    "duration_seconds": round(duration, 2),
                    "layers": layers,
                    "filament_mm": filament_mm,
                    "warnings": warnings,
                },
                "engine": "orca",
                "job_id": job_id,
            }
            slot.update(percent=100, stage="done", done=True, done_at=_time.time())
    except Exception as e:
        # Anything we didn't explicitly handle bubbles here. Surface
        # via the same slot mechanism so /result returns a clean error
        # instead of the request hanging forever.
        logger.exception("orca slice job=%s crashed", job_id)
        _job_error(job_id, 500, f"OrcaSlicer slice crashed: {e}")
    finally:
        if os.environ.get("ORCA_KEEP_WORKDIR") == "1":
            logger.warning("ORCA_KEEP_WORKDIR=1 — preserving %s for inspection", workdir)
        else:
            shutil.rmtree(workdir, ignore_errors=True)


def _job_error(job_id: str, status_code: int, detail: str) -> None:
    """Stamp a terminal error onto the progress slot. The /result
    endpoint reads `error_status` + `error_detail` to mint a clean
    HTTPException with the same status code the synchronous endpoint
    used to raise."""
    import time as _time
    slot = _PROGRESS.get(job_id)
    if slot is not None:
        slot.update(
            done=True,
            error=detail[:200],
            error_status=status_code,
            error_detail=detail,
            done_at=_time.time(),
        )


@router.post("/slice", status_code=202, response_model=OrcaSliceAccepted)
async def orca_slice(req: OrcaSliceRequest, request: Request):
    """Kick off an OrcaSlicer slice job and return immediately with
    the `job_id`. The actual work runs in a background task.

    This async-job pattern replaces the previous synchronous endpoint
    so slices longer than Cloudflare's 100s origin-timeout (HTTP 524)
    can complete reliably on production. Clients should:

    1. POST here → receive 202 with `{job_id}` (this call).
    2. Subscribe to `/api/slice/orca/progress/{job_id}` for live %.
    3. When SSE reports `done: true`, fetch
       `/api/slice/orca/result/{job_id}` for the final GCODE.

    Returns 503 (Service Unavailable) when the engine isn't installed
    so the UI can fall back to the built-in slicer gracefully.
    """
    install = resolve_install()
    if not install.binary:
        detail = "OrcaSlicer engine not installed on this server."
        if install.build_in_progress:
            detail += " A build is in progress — try again later."
        raise HTTPException(status_code=503, detail=detail)

    # Decode + size-cap STL upload BEFORE spawning the task so the
    # client gets a synchronous 400 / 413 on malformed input rather
    # than a deferred error they'd only see via /result.
    try:
        stl_bytes = base64.b64decode(req.stl_base64, validate=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 STL: {e}")
    if len(stl_bytes) > MAX_STL_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"STL exceeds {MAX_STL_BYTES // (1024*1024)} MB cap",
        )

    # Resolve `user_printer_id` synchronously so an unknown / not-owned
    # custom printer surfaces as a 400 the client can immediately
    # surface, rather than as a deferred /result error. The resolver
    # is registered by server.py at startup; if it's missing
    # (e.g. tests that monkey-patch the slice handler) we skip the
    # lookup and fall through to the legacy preset path.
    if req.user_printer_id and _user_printer_resolver is not None:
        # Extract caller's user_id from the auth session (cookie or
        # bearer token). Anonymous users can't have custom printers,
        # so missing auth → 401.
        user_id = await _extract_user_id(request)
        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Custom printers require sign-in.",
            )
        resolved = await _user_printer_resolver(user_id, req.user_printer_id)
        if not resolved:
            raise HTTPException(
                status_code=404,
                detail=f"Custom printer {req.user_printer_id!r} not found.",
            )
        # Override printer_profile + clear preset hints so the slice
        # path uses the resolved dict instead of trying to walk a
        # bundled `inherits` chain that doesn't exist for custom
        # printers.
        req.printer_profile = resolved
        req.printer_preset_name = None
        req.printer_vendor = None

    workdir = Path(tempfile.mkdtemp(prefix="orca-"))
    job_id = (req.job_id or secrets.token_urlsafe(8))[:32]
    _PROGRESS[job_id] = {
        "percent": 0,
        "stage": "starting",
        "done": False,
        "error": None,
    }

    # Fire-and-forget — the task drives the rest of the lifecycle
    # (subprocess, progress, result, workdir cleanup). We DON'T await
    # it so the POST can return immediately and the response makes it
    # back through Cloudflare before its 100s origin-timeout kicks in.
    asyncio.create_task(_perform_slice(req, job_id, workdir, install, stl_bytes))

    return OrcaSliceAccepted(job_id=job_id, status="accepted", engine="orca")


@router.get("/result/{job_id}", response_model=OrcaSliceResponse)
async def orca_result(job_id: str):
    """Return the final GCODE + stats for a slice job kicked off via
    POST /api/slice/orca/slice. Status semantics:

      • 200 — job complete, response body is the full OrcaSliceResponse.
      • 202 — job still running; client should keep listening on the
              SSE progress stream and retry once it sees done=true.
      • 404 — unknown job id (never existed OR evicted after TTL).
      • 4xx / 5xx — job failed; body's `detail` matches what the old
                    synchronous endpoint used to raise.
    """
    import time as _time
    if not (1 <= len(job_id) <= 32 and all(c.isalnum() or c in "-_" for c in job_id)):
        raise HTTPException(status_code=400, detail="malformed job id")
    # Opportunistic eviction so completed jobs whose clients never
    # came back don't pile up in memory.
    _evict_stale_progress_slots(_time.time())
    slot = _PROGRESS.get(job_id)
    if slot is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown job {job_id!r}. It may have expired or never existed.",
        )
    if not slot.get("done"):
        # Still running. 202 + the current progress snapshot helps
        # debugging without breaking the contract.
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=202,
            content={
                "status": "running",
                "job_id": job_id,
                "percent": slot.get("percent", 0),
                "stage": slot.get("stage", ""),
            },
        )
    if slot.get("error_detail"):
        raise HTTPException(
            status_code=slot.get("error_status") or 500,
            detail=slot["error_detail"],
        )
    result = slot.get("result")
    if not result:
        # Done but no result and no error — shouldn't happen, but
        # surface it cleanly instead of returning a malformed payload.
        raise HTTPException(
            status_code=500,
            detail=f"Job {job_id} finished but produced no result and no error.",
        )
    return OrcaSliceResponse(
        gcode=result["gcode"],
        stats=OrcaSliceStats(**result["stats"]),
        engine=result.get("engine", "orca"),
        job_id=result.get("job_id", job_id),
    )


@router.delete("/job/{job_id}")
async def orca_cancel_job(job_id: str):
    """Cancel an in-flight slice job (iter-77).

    Looks up the running subprocess via the progress slot's `proc`
    handle (stashed by `_perform_slice` when the subprocess was
    spawned) and SIGKILLs it. The slot is also flagged with
    `cancelled=True` so `_perform_slice`'s rc-handling path can
    surface a clean "slice cancelled by user" message instead of the
    generic "rc=-9" error.

    Status semantics:
      • 200 — kill signal sent (or job was already done; idempotent).
      • 400 — malformed job id.
      • 404 — unknown job id.
    """
    if not (1 <= len(job_id) <= 32 and all(c.isalnum() or c in "-_" for c in job_id)):
        raise HTTPException(status_code=400, detail="malformed job id")
    slot = _PROGRESS.get(job_id)
    if slot is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown job {job_id!r}. It may have expired or never existed.",
        )
    if slot.get("done"):
        # Already terminal — nothing to kill. Return 200 so the client
        # treats this as a successful cancel (the result is whatever
        # the job already produced, which they can ignore).
        return {"status": "already_done", "job_id": job_id}
    slot["cancelled"] = True
    proc = slot.get("proc")
    if proc is not None:
        try:
            proc.kill()
        except ProcessLookupError:
            pass     # already exited between our check and kill
        except Exception as e:
            logger.warning("orca cancel job=%s kill failed: %s", job_id, e)
    return {"status": "cancelling", "job_id": job_id}


@router.get("/fail-log/{job_id}")
async def orca_fail_log(job_id: str):
    """Return the full stderr + stdout captured for a failed slice
    job. Lets a user (or admin) read the unabridged OrcaSlicer output
    when the truncated /result error message isn't enough to diagnose
    a CLI_VALIDATE_ERROR (rc=156 / -100) or similar.

    The log file is written to the OS tmpdir by `_perform_slice` when
    Orca exits non-zero, and survives the workdir cleanup. Files are
    not auto-pruned but get cleaned with the system tmpdir on reboot.

    Status semantics:
      • 200 — log file exists; body is the raw text (text/plain).
      • 400 — malformed job id.
      • 404 — no log file for that job id (the slice succeeded, never
              ran, or the file was wiped).
    """
    from fastapi.responses import PlainTextResponse
    if not (1 <= len(job_id) <= 32 and all(c.isalnum() or c in "-_" for c in job_id)):
        raise HTTPException(status_code=400, detail="malformed job id")
    fail_log = Path(tempfile.gettempdir()) / f"orca-fail-{job_id}.log"
    if not fail_log.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No fail-log for job {job_id!r}. The slice may have "
                   f"succeeded, the job never ran, or the log was cleaned.",
        )
    return PlainTextResponse(
        fail_log.read_text(errors="replace"),
        headers={"Cache-Control": "no-store"},
    )



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
    are optional — None means we couldn't parse them, not an error.

    Layer markers vary by slicer:
      • Marlin-flavour built-in / Cura / PrusaSlicer: `;LAYER:N`
      • OrcaSlicer / PrusaSlicer / Bambu Studio: `;LAYER_CHANGE`
    We count both so OrcaSlicer's gcode reports a non-zero layer count
    (was showing `0` / `—` in the Engine Comparison card before this).
    """
    layers = 0
    filament_mm: Optional[float] = None
    for line in gcode.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(";LAYER:") or stripped.startswith("; LAYER:"):
            layers += 1
        elif stripped.startswith(";LAYER_CHANGE") or stripped.startswith("; LAYER_CHANGE"):
            layers += 1
        elif "filament used [mm]" in line.lower():
            try:
                # OrcaSlicer footer: "; filament used [mm] = 1234.56"
                filament_mm = float(line.split("=", 1)[1].strip())
            except Exception:
                pass
    return (layers or None, filament_mm)

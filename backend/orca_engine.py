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
import platform
import shutil
import tempfile
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
    """For AppImage installs the launcher is `AppRun` (which sets up
    LD_LIBRARY_PATH for bundled libs). Source-built installs put the
    binary at `OrcaSlicer` directly. We try AppRun first, then fall
    back to the historical name so both flows work."""
    for candidate_name in ("AppRun", "OrcaSlicer"):
        c = install_dir / candidate_name
        if _file_executable(c):
            return c
    # Some AppImage builds nest the binary under usr/bin/.
    nested = install_dir / "usr" / "bin" / "OrcaSlicer"
    if _file_executable(nested):
        return nested
    return None


def _install_in_progress() -> bool:
    """True while the AppImage installer is running. The script writes
    `/app/backend/bin/.orca_install_lock` for the duration of its run
    so we can surface "installing…" in the status badge without
    polling the script's stdout."""
    return Path("/app/backend/bin/.orca_install_lock").exists()


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

    `stl_base64` is the binary STL of the merged scene (post-CSG). The
    config bundle mirrors OrcaSlicer's own JSON profile schema — we
    accept it as opaque dicts so we don't have to re-implement the
    profile validator. Sensible defaults are filled server-side when a
    key is missing.
    """
    stl_base64: str = Field(..., description="Base64-encoded binary STL")
    printer_profile: dict = Field(default_factory=dict)
    process_profile: dict = Field(default_factory=dict)
    filament_profile: dict = Field(default_factory=dict)
    # User-friendly summary so the response stats can reference what
    # was requested (echoed back, not validated server-side).
    description: Optional[str] = None


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


@router.get("/status", response_model=OrcaStatusResponse)
async def orca_status():
    """Cheap probe — does NOT spawn Orca unless we already think it's
    installed. Frontend polls this when the user toggles the Engine
    selector to give immediate feedback on availability."""
    install = resolve_install()
    version = None
    if install.binary:
        version = await _probe_version(install.binary)
    detail = None
    if install.source == "missing":
        if install.build_in_progress:
            detail = (
                "OrcaSlicer is installing on the server (~1 min). The "
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
    try:
        stl_path = workdir / "model.stl"
        stl_path.write_bytes(stl_bytes)

        # Build the OrcaSlicer CLI argv. We pass profiles as separate
        # files because that's the CLI's documented format; passing them
        # inline is not supported.
        profile_args: list[str] = []
        for key, prof in (
            ("printer", req.printer_profile),
            ("process", req.process_profile),
            ("filament", req.filament_profile),
        ):
            if not prof:
                continue
            p = workdir / f"{key}.json"
            p.write_text(json.dumps(prof, indent=2))
            if key == "filament":
                profile_args += ["--load-filaments", str(p)]
            else:
                # Printer + process get loaded together via --load-settings,
                # joined by semicolons per the CLI spec.
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
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=SLICE_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            raise HTTPException(
                status_code=504,
                detail=f"OrcaSlicer slice exceeded {SLICE_TIMEOUT_SEC}s and was killed.",
            )
        duration = time.monotonic() - t0

        if proc.returncode != 0:
            tail = (stderr or b"")[-2000:].decode(errors="replace")
            logger.warning("orca slice rc=%s err=%s", proc.returncode, tail)
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
        )
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

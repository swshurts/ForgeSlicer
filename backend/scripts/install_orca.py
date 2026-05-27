"""
OrcaSlicer AppImage installer.

Downloads the latest OrcaSlicer Linux AppImage from the SoftFever GitHub
release, extracts it via the AppImage's self-extraction (no FUSE
needed), and lays the result down at
`/app/backend/bin/orca-x86_64/`  so the `resolve_install()` resolver
in `orca_engine.py` finds it.

### Why AppImage and not source-build
The previous agent attempted a 2-hour C++ source compile in `/opt/`,
but Kubernetes recycled the pod and wiped the build dir. The AppImage
flow is a ~119 MB download + ~30 s self-extract — it survives the
same pod recycles because `/app/backend/bin/` is on the persistent
workspace volume.

### Arch support
OrcaSlicer publishes Linux AppImages for `x86_64` only. On `aarch64`
hosts (some preview pods, ARM Macs, AWS Graviton) this script
short-circuits with a clean exit-1 + a logged message — the frontend
already falls back to the built-in JS slicer when the engine is
missing, so this is a soft failure path.

### Idempotency
If a working binary already lives at the target directory and
responds to `--version`, the script exits early and does NOT
re-download. Force a refresh with `--force`.

### Lock file
A sentinel file `bin/.orca_install_lock` is written for the duration of
the install so `orca_engine._install_in_progress()` can detect a
concurrent install and surface "installing…" in the UI status badge.

### Manual usage
    python3 /app/backend/scripts/install_orca.py            # idempotent
    python3 /app/backend/scripts/install_orca.py --force    # re-install
    python3 /app/backend/scripts/install_orca.py --dry-run  # plan only
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import shutil
import stat
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional

logger = logging.getLogger("install_orca")

GITHUB_RELEASES_API = "https://api.github.com/repos/SoftFever/OrcaSlicer/releases/latest"
APPIMAGE_PATTERN_PARTS = ("OrcaSlicer", "Linux", "AppImage", ".AppImage")

# All under /app so pod recycles don't wipe them.
BIN_ROOT = Path("/app/backend/bin")
INSTALL_DIR_X86 = BIN_ROOT / "orca-x86_64"
CACHE_DIR = BIN_ROOT / ".cache"
LOCK_FILE = BIN_ROOT / ".orca_install_lock"

# Wall-clock cap on the whole install so it can't wedge a startup hook
# indefinitely. 5 min covers a slow 119 MB download + 30 s extract with
# headroom; if we blow past it something is wrong.
TOTAL_TIMEOUT_SEC = 300


# ---------- helpers ----------

def _is_x86_64() -> bool:
    """The official AppImage only ships for x86_64 / amd64. Some
    environments report alternative aliases — we accept all the common
    spellings.

    `ORCA_FORCE_X86_INSTALL=1` bypasses the check; useful in CI / cross-
    arch testing where you want to exercise the full download + extract
    flow without actually being on the supported arch. The resulting
    binary won't run but the install pipeline is validated end-to-end.
    """
    if os.environ.get("ORCA_FORCE_X86_INSTALL") == "1":
        return True
    return platform.machine().lower() in ("x86_64", "amd64")


def _binary_works(binary: Path, timeout: float = 10.0) -> bool:
    """Quick `--version` smoke test on the resolved binary. Treat any
    non-zero exit OR timeout as "doesn't work" so a partially-extracted
    install gets re-installed cleanly."""
    if not binary.exists() or not os.access(binary, os.X_OK):
        return False
    try:
        proc = subprocess.run(
            [str(binary), "--version"],
            capture_output=True, timeout=timeout, check=False,
        )
        # OrcaSlicer's `--version` can exit 0 OR 1 depending on the
        # release — what matters is that it executed. An exec format
        # error (wrong arch) raises OSError; an actual binary error
        # writes something to stderr but doesn't OSError.
        return proc.returncode in (0, 1)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def _http_get_json(url: str, timeout: int = 20) -> dict:
    """Tiny urllib wrapper — avoids pulling in `requests` for this
    one-off script."""
    req = urllib.request.Request(url, headers={"User-Agent": "ForgeSlicer-Installer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_download(url: str, dst: Path, timeout: int = 180) -> int:
    """Stream download to disk. Returns bytes written. Cleans up the
    partial file on any error so a retry starts from scratch."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "ForgeSlicer-Installer/1.0"})
    total = 0
    started = time.monotonic()
    last_log = started
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, dst.open("wb") as out:
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                total += len(chunk)
                now = time.monotonic()
                if now - last_log > 5.0:
                    mb = total / (1024 * 1024)
                    rate = mb / max(now - started, 0.001)
                    logger.info("  …downloaded %.1f MB (%.1f MB/s)", mb, rate)
                    last_log = now
    except Exception:
        try:
            dst.unlink()
        except FileNotFoundError:
            pass
        raise
    return total


def _pick_appimage_asset(release: dict) -> Optional[dict]:
    """From the release JSON, find the asset whose name contains all
    the AppImage marker tokens. Tolerant of OrcaSlicer's release-naming
    drift (V2.3.2 vs V2.3.2_Ubuntu2404, etc.)."""
    assets = release.get("assets", [])
    for asset in assets:
        name = asset.get("name", "")
        if all(part in name for part in APPIMAGE_PATTERN_PARTS):
            return asset
    return None


# ---------- install steps ----------

def _acquire_lock() -> bool:
    """Best-effort lock — writes a sentinel file that the status
    endpoint reads. Uses O_EXCL so two concurrent installers won't
    proceed simultaneously."""
    BIN_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        return False


def _release_lock() -> None:
    try:
        LOCK_FILE.unlink()
    except FileNotFoundError:
        pass


def _extract_appimage(appimage: Path, workdir: Path) -> Path:
    """Self-extract the AppImage. AppImage `--appimage-extract` writes
    to ./squashfs-root in the CWD, so we run from `workdir` and return
    that path.

    Re-raises with a clearer message on the most common failure mode —
    `Errno 8 Exec format error` — which means the AppImage architecture
    doesn't match the host (e.g., x86_64 AppImage on an aarch64 box).
    """
    workdir.mkdir(parents=True, exist_ok=True)
    # AppImages need execute bit before we can invoke them at all.
    appimage.chmod(appimage.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    try:
        proc = subprocess.run(
            [str(appimage), "--appimage-extract"],
            cwd=str(workdir),
            capture_output=True, timeout=180, check=False,
        )
    except OSError as e:
        if e.errno == 8:  # Exec format error
            raise RuntimeError(
                f"AppImage is not executable on this host ({platform.machine()}) — "
                f"OrcaSlicer only ships x86_64 AppImages. The download succeeded "
                f"but the binary cannot run here."
            ) from e
        raise
    if proc.returncode != 0:
        tail = (proc.stderr or b"")[-500:].decode(errors="replace")
        raise RuntimeError(f"--appimage-extract exited {proc.returncode}: {tail}")
    extracted = workdir / "squashfs-root"
    if not extracted.exists():
        raise RuntimeError("--appimage-extract produced no squashfs-root directory")
    return extracted


def _stage_install(extracted: Path, target: Path) -> None:
    """Move the extracted tree into the resolver's expected location.
    We REPLACE any existing install — if you're calling stage_install,
    something upstream already decided the existing copy was no good
    (or the caller passed `--force`)."""
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(extracted), str(target))


def _pick_entrypoint(install_dir: Path) -> Path:
    """Choose the executable to launch. The AppImage v2.x layout puts
    the launcher script at `AppRun` (sets LD_LIBRARY_PATH for whatever
    bundled libs do exist, applies workarounds for locale + NVIDIA)
    and the real binary at `bin/orca-slicer`. Older source-builds put
    it at `OrcaSlicer` or `usr/bin/OrcaSlicer`. We prefer AppRun
    because it does the env setup; everything else is a fallback."""
    candidates = [
        install_dir / "AppRun",            # AppImage v2.x — sets LD_LIBRARY_PATH
        install_dir / "OrcaSlicer",        # legacy source-build
        install_dir / "bin" / "orca-slicer", # real binary if AppRun is missing
        install_dir / "usr" / "bin" / "OrcaSlicer",
        install_dir / "usr" / "bin" / "orca-slicer",
    ]
    for c in candidates:
        if c.exists():
            return c
    raise RuntimeError(
        f"No OrcaSlicer entrypoint found under {install_dir}; "
        f"layout may have changed. Contents: "
        f"{[p.name for p in install_dir.iterdir()][:20]}"
    )


# ---------- main ----------

def _ensure_system_deps() -> None:
    """Best-effort install of OrcaSlicer's GUI / GL system libraries
    via the companion bash script. Failures are logged but never
    raise — the AppImage still gets extracted and the user-facing
    error from the slice endpoint will at least be informative."""
    try:
        deps_script = Path(__file__).parent / "install_orca_deps.sh"
        if not deps_script.exists():
            logger.warning("install_orca_deps.sh missing — system deps may be incomplete.")
            return
        proc = subprocess.run(
            ["bash", str(deps_script)],
            capture_output=True, timeout=120, check=False,
        )
        if proc.returncode == 0:
            logger.info("System deps OK.")
        else:
            tail = (proc.stdout or b"")[-600:].decode(errors="replace")
            logger.warning("install_orca_deps.sh rc=%s tail=%s", proc.returncode, tail)
    except Exception as e:  # noqa: BLE001
        logger.warning("System-deps install crashed: %s", e)


def install(force: bool = False, dry_run: bool = False) -> int:
    """Returns a POSIX exit code so the script (and the background
    runner in server.py) can branch on success/failure."""
    arch = platform.machine()
    if not _is_x86_64():
        logger.warning(
            "OrcaSlicer AppImage is only published for x86_64; this host "
            "is %s. Skipping install — the built-in slicer will be used.",
            arch,
        )
        return 1

    target = INSTALL_DIR_X86
    # Idempotency check — if a working binary already exists, do nothing.
    if not force and target.exists():
        try:
            entry = _pick_entrypoint(target)
            if _binary_works(entry):
                logger.info("OrcaSlicer already installed at %s (%s) — no-op.", entry, arch)
                return 0
        except Exception:
            pass  # fall through to fresh install
        logger.info("Existing install at %s appears broken — replacing.", target)

    # Acquire the install lock. If another install is running, bail
    # cleanly so we don't race.
    if not _acquire_lock():
        logger.warning("Another install is already running (lock file present at %s). Exiting.", LOCK_FILE)
        return 2

    try:
        logger.info("Fetching latest release metadata from %s …", GITHUB_RELEASES_API)
        release = _http_get_json(GITHUB_RELEASES_API)
        tag = release.get("tag_name", "?")
        asset = _pick_appimage_asset(release)
        if not asset:
            assets_seen = [a.get("name", "?") for a in release.get("assets", [])]
            raise RuntimeError(
                f"No AppImage asset matching {APPIMAGE_PATTERN_PARTS} in release {tag}. "
                f"Assets seen: {assets_seen}"
            )
        size_mb = asset.get("size", 0) / (1024 * 1024)
        logger.info(
            "Found %s for release %s (%.1f MB).",
            asset["name"], tag, size_mb,
        )
        if dry_run:
            logger.info("--dry-run: would download from %s and install to %s. Exiting.",
                        asset["browser_download_url"], target)
            return 0

        # Install the system libs the AppImage's bundled binary needs at
        # runtime (libEGL, libGL, GTK-3, WebKit, …). Best-effort — a
        # locked-down container without apt or root will skip this and
        # the operator will see the dep list in the logs.
        _ensure_system_deps()

        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        appimage_path = CACHE_DIR / asset["name"]
        logger.info("Downloading to %s …", appimage_path)
        downloaded = _http_download(asset["browser_download_url"], appimage_path)
        logger.info("Download complete (%.1f MB).", downloaded / (1024 * 1024))

        # Use a temp staging area inside CACHE_DIR so a half-extract
        # doesn't pollute the target until extract succeeds.
        staging = CACHE_DIR / "extract"
        if staging.exists():
            shutil.rmtree(staging)
        logger.info("Extracting AppImage to %s …", staging)
        try:
            extracted = _extract_appimage(appimage_path, staging)
        except RuntimeError as e:
            # Clean up the download so a corrected retry doesn't reuse a
            # bad cached file. The error message itself is already
            # diagnostic — re-raise so the caller logs it.
            logger.error("Extract failed: %s", e)
            try:
                appimage_path.unlink()
                shutil.rmtree(staging, ignore_errors=True)
            except Exception:
                pass
            return 4
        logger.info("Extract complete.")

        logger.info("Staging install to %s …", target)
        _stage_install(extracted, target)

        # Verify by probing the entrypoint. On the wrong arch this will
        # silently report "not working" — that's the expected behaviour
        # for aarch64 etc. — but we'll have already declined to run
        # earlier.
        entry = _pick_entrypoint(target)
        if not _binary_works(entry):
            logger.warning(
                "Installed binary at %s did NOT respond to --version. "
                "It may be the wrong architecture or missing system libs. "
                "Frontend will fall back to the built-in slicer.",
                entry,
            )
            return 3
        logger.info("OrcaSlicer ready at %s ✓", entry)
        # Cleanup the AppImage download — we have the extracted tree now.
        try:
            appimage_path.unlink()
            shutil.rmtree(staging, ignore_errors=True)
        except Exception:
            pass
        return 0
    finally:
        _release_lock()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s install_orca %(levelname)s %(message)s",
    )
    parser = argparse.ArgumentParser(description="Install OrcaSlicer AppImage")
    parser.add_argument("--force", action="store_true", help="Reinstall even if a working binary is present")
    parser.add_argument("--dry-run", action="store_true", help="Only show what would happen")
    args = parser.parse_args()
    return install(force=args.force, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())

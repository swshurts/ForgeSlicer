"""
Smoke tests for the OrcaSlicer AppImage installer.

These tests exercise pure-function helpers (no network, no subprocess)
so they pass anywhere — preview pod, CI, dev box. Integration tests
that actually download the AppImage live in a separate slow-suite
runner; we don't want a 119 MB GitHub fetch on every CI run.
"""

from pathlib import Path

from scripts import install_orca as installer


def test_pick_appimage_asset_finds_linux_appimage():
    release = {
        "tag_name": "v2.3.2",
        "assets": [
            {"name": "OrcaSlicer-Linux-flatpak_V2.3.2_aarch64.flatpak", "size": 1},
            {"name": "OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.2.AppImage", "size": 124672504, "browser_download_url": "https://example/x"},
            {"name": "OrcaSlicer_Mac_universal_V2.3.2.dmg", "size": 1},
            {"name": "OrcaSlicer_Windows_Installer_V2.3.2.exe", "size": 1},
        ],
    }
    asset = installer._pick_appimage_asset(release)
    assert asset is not None
    assert "AppImage" in asset["name"]
    assert "Linux" in asset["name"]


def test_pick_appimage_asset_returns_none_when_missing():
    release = {"tag_name": "v0", "assets": [
        {"name": "windows.exe", "size": 1},
        {"name": "mac.dmg", "size": 1},
    ]}
    assert installer._pick_appimage_asset(release) is None


def test_arch_check_default_only_accepts_x86_64(monkeypatch):
    """The check should reject aarch64/arm64/anything-non-x86_64 unless
    the override env var is set."""
    monkeypatch.delenv("ORCA_FORCE_X86_INSTALL", raising=False)
    monkeypatch.setattr(installer.platform, "machine", lambda: "aarch64")
    assert installer._is_x86_64() is False
    monkeypatch.setattr(installer.platform, "machine", lambda: "x86_64")
    assert installer._is_x86_64() is True
    monkeypatch.setattr(installer.platform, "machine", lambda: "amd64")
    assert installer._is_x86_64() is True


def test_arch_check_force_env_var_overrides(monkeypatch):
    monkeypatch.setattr(installer.platform, "machine", lambda: "aarch64")
    monkeypatch.setenv("ORCA_FORCE_X86_INSTALL", "1")
    assert installer._is_x86_64() is True


def test_install_skips_cleanly_on_non_x86_arch(monkeypatch, tmp_path):
    """The most important behaviour for ARM hosts — `install()` should
    return a non-zero exit code WITHOUT touching disk or the network."""
    monkeypatch.delenv("ORCA_FORCE_X86_INSTALL", raising=False)
    monkeypatch.setattr(installer.platform, "machine", lambda: "aarch64")
    # Point the install paths at a temp dir so any accidental write
    # would be visible to us.
    monkeypatch.setattr(installer, "BIN_ROOT", tmp_path / "bin")
    monkeypatch.setattr(installer, "INSTALL_DIR_X86", tmp_path / "bin" / "orca-x86_64")
    monkeypatch.setattr(installer, "CACHE_DIR", tmp_path / "bin" / ".cache")
    monkeypatch.setattr(installer, "LOCK_FILE", tmp_path / "bin" / ".orca_install_lock")
    rc = installer.install()
    assert rc == 1
    # No files should have been written.
    assert not (tmp_path / "bin").exists() or not list((tmp_path / "bin").iterdir())


def test_resolve_appimage_entry_prefers_apprun(tmp_path):
    """The orca_engine resolver should pick AppRun (AppImage launcher)
    over the raw OrcaSlicer binary when both exist — AppRun handles
    the bundled LD_LIBRARY_PATH that a direct invocation would miss."""
    from orca_engine import _resolve_appimage_entry
    bin_dir = tmp_path / "orca-x86_64"
    bin_dir.mkdir()
    apprun = bin_dir / "AppRun"
    apprun.write_text("#!/bin/sh\nexit 0\n")
    apprun.chmod(0o755)
    orca = bin_dir / "OrcaSlicer"
    orca.write_text("#!/bin/sh\nexit 0\n")
    orca.chmod(0o755)
    entry = _resolve_appimage_entry(bin_dir)
    assert entry == apprun


def test_resolve_appimage_entry_finds_bin_orca_slicer(tmp_path):
    """v2.x AppImage real layout: AppRun at root + bin/orca-slicer.
    If AppRun is somehow missing (e.g. extract failure, wrong chmod)
    we still find the binary so the resolver doesn't return None."""
    from orca_engine import _resolve_appimage_entry
    bin_dir = tmp_path / "orca-x86_64"
    (bin_dir / "bin").mkdir(parents=True)
    real = bin_dir / "bin" / "orca-slicer"
    real.write_text("#!/bin/sh\nexit 0\n")
    real.chmod(0o755)
    entry = _resolve_appimage_entry(bin_dir)
    assert entry == real


def test_resolve_appimage_entry_falls_back_to_nested(tmp_path):
    """Some AppImage variants nest the binary under usr/bin/. The
    resolver should still find it even when neither AppRun nor a
    top-level OrcaSlicer is present."""
    from orca_engine import _resolve_appimage_entry
    bin_dir = tmp_path / "orca-x86_64"
    nested = bin_dir / "usr" / "bin"
    nested.mkdir(parents=True)
    orca = nested / "OrcaSlicer"
    orca.write_text("#!/bin/sh\nexit 0\n")
    orca.chmod(0o755)
    entry = _resolve_appimage_entry(bin_dir)
    assert entry == orca


def test_resolve_appimage_entry_returns_none_when_nothing_installed(tmp_path):
    from orca_engine import _resolve_appimage_entry
    empty = tmp_path / "orca-x86_64"
    empty.mkdir()
    assert _resolve_appimage_entry(empty) is None


def test_install_in_progress_reads_lock_file(tmp_path, monkeypatch):
    """The status endpoint reads this to surface 'installing…' in the
    UI status badge. Must read the lock file the installer writes."""
    from orca_engine import _install_in_progress
    lock = Path("/app/backend/bin/.orca_install_lock")
    # We're using the real path because the helper isn't parameterised
    # — the test is deliberately defensive about cleaning up after
    # itself so we don't break neighbouring tests.
    assert not _install_in_progress(), "test precondition: no install running"
    try:
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text("12345")
        assert _install_in_progress() is True
    finally:
        try: lock.unlink()
        except FileNotFoundError: pass


def test_install_in_progress_clears_stale_lock():
    """A lock file older than 15 min must be treated as abandoned —
    otherwise a crashed install leaves the UI stuck on 'installing'
    forever, and the only fix without this is SSH. The helper should
    return False AND clean the file up so the next install can run."""
    import os, time as _time
    from orca_engine import _install_in_progress
    lock = Path("/app/backend/bin/.orca_install_lock")
    assert not _install_in_progress()
    try:
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text("99999")
        # Backdate mtime by 16 minutes.
        old = _time.time() - 16 * 60
        os.utime(lock, (old, old))
        assert _install_in_progress() is False, "stale lock should be ignored"
        assert not lock.exists(), "stale lock should be removed by the helper"
    finally:
        try: lock.unlink()
        except FileNotFoundError: pass

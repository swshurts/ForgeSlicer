"""
Integration tests for the new async-job slice flow.

The previous synchronous `POST /api/slice/orca/slice` endpoint
blocked until the OrcaSlicer CLI finished, which made slices longer
than Cloudflare's 100s origin-timeout surface as `HTTP 524` on
production. Iter 71 split it into:

    POST /slice/orca/slice  → 202 { job_id, status: "accepted" }
    GET  /slice/orca/result/{job_id}
                            → 200 { gcode, stats, engine, job_id }   when done
                            → 202 { status: "running", percent, stage } while running
                            → 404 when unknown / expired
                            → 4xx/5xx { detail } when the job failed

These tests cover the contract WITHOUT requiring a real OrcaSlicer
binary on the test host (which would make them too slow / flaky):

  1. Result endpoint validates the job-id shape (400 on garbage).
  2. Result endpoint returns 404 for an unknown job.
  3. POST returns 202 + job_id immediately when the engine is
     installed (we wrap install resolution so the path can be
     exercised without a real binary).
  4. POST still returns 503 when engine is missing.
  5. Result endpoint surfaces the same 4xx/5xx detail the
     synchronous endpoint used to raise — we drive it by writing
     a fake error directly into the in-memory progress slot.
  6. Result endpoint returns 200 with the OrcaSliceResponse shape
     when a fake completed result is parked in the slot.
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import app  # noqa: E402
import orca_engine  # noqa: E402


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean_progress_slots():
    """Each test starts with a fresh in-memory _PROGRESS dict so we
    don't see jobs leaked from earlier runs."""
    orca_engine._PROGRESS.clear()
    yield
    orca_engine._PROGRESS.clear()


# ---------- /result endpoint shape contract ----------

def test_result_rejects_malformed_job_id(client):
    """The endpoint mirrors the SSE progress-stream validator: ≤32
    chars, alnum + `-_` only. Anything else → 400."""
    r = client.get("/api/slice/orca/result/has spaces!@#")
    assert r.status_code == 400, r.text
    assert "malformed" in r.json()["detail"].lower()


def test_result_returns_404_for_unknown_job(client):
    r = client.get("/api/slice/orca/result/unknown_job_id")
    assert r.status_code == 404, r.text
    assert "unknown" in r.json()["detail"].lower()


def test_result_returns_202_while_running(client):
    """A live (not-done) slot should return 202 + the live progress
    snapshot so the client knows to keep polling SSE."""
    orca_engine._PROGRESS["live_job"] = {
        "percent": 42, "stage": "infill", "done": False, "error": None,
    }
    r = client.get("/api/slice/orca/result/live_job")
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "running"
    assert body["percent"] == 42
    assert body["stage"] == "infill"
    assert body["job_id"] == "live_job"


def test_result_surfaces_done_payload(client):
    """When the backend task has stamped a `result` onto the slot,
    /result must return 200 with the OrcaSliceResponse shape."""
    orca_engine._PROGRESS["done_job"] = {
        "percent": 100,
        "stage": "done",
        "done": True,
        "error": None,
        "result": {
            "gcode": "G1 X0 Y0\nG1 X10 Y0\n",
            "stats": {
                "gcode_lines": 2,
                "gcode_bytes": 20,
                "duration_seconds": 1.23,
                "layers": 1,
                "filament_mm": 5.4,
            },
            "engine": "orca",
            "job_id": "done_job",
        },
    }
    r = client.get("/api/slice/orca/result/done_job")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gcode"].startswith("G1")
    assert body["stats"]["layers"] == 1
    assert body["stats"]["filament_mm"] == 5.4
    assert body["engine"] == "orca"
    assert body["job_id"] == "done_job"


def test_result_surfaces_error_with_original_status_code(client):
    """If the backend task failed, /result raises an HTTPException
    with the SAME status code + detail the synchronous endpoint used
    to raise — that's how the frontend's apiErrorMessage keeps working
    unchanged after the refactor."""
    orca_engine._PROGRESS["bad_job"] = {
        "percent": 100,
        "stage": "failed",
        "done": True,
        "error": "missing libstdc++.so.6",
        "error_status": 503,
        "error_detail": "OrcaSlicer engine couldn't start — system library 'libstdc++.so.6' is missing in the server container.",
    }
    r = client.get("/api/slice/orca/result/bad_job")
    assert r.status_code == 503, r.text
    assert "libstdc++" in r.json()["detail"]


def test_result_500_when_done_but_no_payload(client):
    """Belt-and-braces — if a slot is marked done but somehow has
    neither `result` nor `error_detail`, /result must surface a 500
    instead of returning a malformed body."""
    orca_engine._PROGRESS["weird_job"] = {
        "percent": 100, "stage": "done", "done": True,
    }
    r = client.get("/api/slice/orca/result/weird_job")
    assert r.status_code == 500, r.text
    assert "no result" in r.json()["detail"].lower()


# ---------- /slice endpoint behaviour ----------

def test_slice_returns_503_when_engine_missing(client, monkeypatch):
    """Engine-missing 503 path is unchanged — frontend still uses it
    to fall back to the built-in slicer."""
    monkeypatch.setattr(orca_engine, "resolve_install", lambda: orca_engine.OrcaInstall(
        binary=None, resources_dir=None, arch="aarch64",
        version=None, source="missing", build_in_progress=False, error=None,
    ))
    import base64
    payload = {
        "stl_base64": base64.b64encode(b"fake stl").decode(),
        "printer_profile": {}, "process_profile": {}, "filament_profile": {},
    }
    r = client.post("/api/slice/orca/slice", json=payload)
    assert r.status_code == 503, r.text


def test_slice_returns_400_for_invalid_base64(client, monkeypatch):
    """Synchronous validation runs BEFORE the task is spawned so
    clients get an immediate 400 (not a deferred error via /result)."""
    fake_bin = Path("/tmp/fake-orca")
    fake_bin.write_text("#!/bin/sh\nexit 0\n")
    fake_bin.chmod(0o755)
    monkeypatch.setattr(orca_engine, "resolve_install", lambda: orca_engine.OrcaInstall(
        binary=fake_bin, resources_dir=None, arch="aarch64",
        version="test", source="env", build_in_progress=False, error=None,
    ))
    r = client.post("/api/slice/orca/slice", json={
        "stl_base64": "@@@not-base64@@@",
        "printer_profile": {}, "process_profile": {}, "filament_profile": {},
    })
    assert r.status_code == 400, r.text
    assert "base64" in r.json()["detail"].lower()


def test_slice_returns_413_for_oversized_stl(client, monkeypatch):
    """STL size cap is enforced synchronously."""
    fake_bin = Path("/tmp/fake-orca")
    fake_bin.write_text("#!/bin/sh\nexit 0\n")
    fake_bin.chmod(0o755)
    monkeypatch.setattr(orca_engine, "resolve_install", lambda: orca_engine.OrcaInstall(
        binary=fake_bin, resources_dir=None, arch="aarch64",
        version="test", source="env", build_in_progress=False, error=None,
    ))
    # Build a base64 payload that's >50 MB decoded.
    import base64
    big = b"x" * (orca_engine.MAX_STL_BYTES + 1)
    payload = {
        "stl_base64": base64.b64encode(big).decode(),
        "printer_profile": {}, "process_profile": {}, "filament_profile": {},
    }
    r = client.post("/api/slice/orca/slice", json=payload)
    assert r.status_code == 413, r.text


def test_slice_returns_202_with_job_id_when_engine_installed(client, monkeypatch):
    """Happy path: engine present, STL valid → 202 + job_id. We
    monkeypatch _perform_slice to a no-op so the test doesn't try to
    actually shell out to a binary."""
    fake_bin = Path("/tmp/fake-orca")
    fake_bin.write_text("#!/bin/sh\nexit 0\n")
    fake_bin.chmod(0o755)
    monkeypatch.setattr(orca_engine, "resolve_install", lambda: orca_engine.OrcaInstall(
        binary=fake_bin, resources_dir=None, arch="aarch64",
        version="test", source="env", build_in_progress=False, error=None,
    ))

    async def fake_perform_slice(req, job_id, workdir, install, stl_bytes):
        # Pretend the slice ran instantly with a tiny result.
        import time as _time
        slot = orca_engine._PROGRESS.get(job_id)
        if slot is not None:
            slot.update(
                percent=100, stage="done", done=True, done_at=_time.time(),
                result={
                    "gcode": "G1 X0 Y0\n", "stats": {
                        "gcode_lines": 1, "gcode_bytes": 9,
                        "duration_seconds": 0.01, "layers": None, "filament_mm": None,
                    },
                    "engine": "orca", "job_id": job_id,
                },
            )
    monkeypatch.setattr(orca_engine, "_perform_slice", fake_perform_slice)

    import base64
    payload = {
        "stl_base64": base64.b64encode(b"fake stl bytes").decode(),
        "job_id": "test_async_job",
        "printer_profile": {}, "process_profile": {}, "filament_profile": {},
    }
    r = client.post("/api/slice/orca/slice", json=payload)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["job_id"] == "test_async_job"
    assert body["status"] == "accepted"
    assert body["engine"] == "orca"


# ---------- Stale-slot eviction ----------

def test_stale_progress_slots_evicted_after_ttl(client):
    """`_evict_stale_progress_slots` drops completed jobs older than
    `_JOB_RESULT_TTL_SEC` so /result 404s for them. Run by every
    /result fetch."""
    import time as _time
    now = _time.time()
    orca_engine._PROGRESS["old_done"] = {
        "percent": 100, "stage": "done", "done": True,
        "done_at": now - (orca_engine._JOB_RESULT_TTL_SEC + 60),
        "result": {"gcode": "x"},
    }
    orca_engine._PROGRESS["fresh_done"] = {
        "percent": 100, "stage": "done", "done": True,
        "done_at": now,
        "result": {
            "gcode": "y", "stats": {
                "gcode_lines": 1, "gcode_bytes": 1,
                "duration_seconds": 0, "layers": None, "filament_mm": None,
            },
            "engine": "orca", "job_id": "fresh_done",
        },
    }
    # Touching /result for the fresh job triggers eviction.
    r_fresh = client.get("/api/slice/orca/result/fresh_done")
    assert r_fresh.status_code == 200
    # The old one is now gone.
    r_old = client.get("/api/slice/orca/result/old_done")
    assert r_old.status_code == 404

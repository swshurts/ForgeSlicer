"""
Tests for the cancel-slice endpoint (iter-77).

The endpoint at `DELETE /api/slice/orca/job/{job_id}` lets users abort
a running slice — useful when they realise they picked the wrong
process/filament after the slice has started and would rather restart
than wait out a 2-minute slice.

Tests don't depend on a real OrcaSlicer binary; they exercise the
endpoint's state transitions by parking fake progress slots in
`_PROGRESS` and calling the handler directly.
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
    orca_engine._PROGRESS.clear()
    yield
    orca_engine._PROGRESS.clear()


def test_cancel_rejects_malformed_id(client):
    r = client.delete("/api/slice/orca/job/has spaces!@#")
    assert r.status_code == 400, r.text
    assert "malformed" in r.json()["detail"].lower()


def test_cancel_unknown_job_returns_404(client):
    r = client.delete("/api/slice/orca/job/unknown_job_id")
    assert r.status_code == 404, r.text


def test_cancel_running_job_signals_cancellation(client):
    """A live (not-done) slot gets `cancelled=True` stamped on it. The
    response advertises `cancelling` so the UI can show the right
    spinner copy."""
    class FakeProc:
        killed = False
        def kill(self):
            FakeProc.killed = True

    orca_engine._PROGRESS["live_job"] = {
        "percent": 35, "stage": "infill", "done": False, "error": None,
        "proc": FakeProc(),
    }
    r = client.delete("/api/slice/orca/job/live_job")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "cancelling"
    assert body["job_id"] == "live_job"
    assert orca_engine._PROGRESS["live_job"]["cancelled"] is True
    assert FakeProc.killed, "subprocess.kill() should have been invoked"


def test_cancel_already_done_job_is_idempotent(client):
    """Cancelling a job that's already finished returns 200 with
    `already_done` — never an error, so UIs that fire-and-forget the
    cancel on tab close don't surface noisy errors."""
    orca_engine._PROGRESS["done_job"] = {
        "percent": 100, "stage": "done", "done": True, "error": None,
    }
    r = client.delete("/api/slice/orca/job/done_job")
    assert r.status_code == 200
    assert r.json()["status"] == "already_done"
    # `cancelled` flag should NOT be set on already-done jobs.
    assert "cancelled" not in orca_engine._PROGRESS["done_job"]


def test_cancel_when_subprocess_already_exited(client):
    """If the subprocess died between our check and the kill (e.g.
    finished normally a millisecond before the cancel arrived), the
    ProcessLookupError must be swallowed silently. No 500."""
    class ExitedProc:
        def kill(self):
            raise ProcessLookupError("No such process")

    orca_engine._PROGRESS["race_job"] = {
        "percent": 99, "stage": "ironing", "done": False, "error": None,
        "proc": ExitedProc(),
    }
    r = client.delete("/api/slice/orca/job/race_job")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelling"


def test_cancel_without_proc_handle(client):
    """If the slot doesn't have a `proc` (e.g. cancel arrives before
    _perform_slice has spawned the subprocess), we still flag
    `cancelled=True` so the subprocess won't run when it is spawned."""
    orca_engine._PROGRESS["early_job"] = {
        "percent": 0, "stage": "starting", "done": False, "error": None,
    }
    r = client.delete("/api/slice/orca/job/early_job")
    assert r.status_code == 200
    assert orca_engine._PROGRESS["early_job"]["cancelled"] is True

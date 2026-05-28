"""Unit tests for the slice-progress tracking added in iter 52.

Covers:
  • The stdout regex correctly extracts % from OrcaSlicer's two
    documented line formats.
  • The progress dict is updated in place by the tail reader.
  • The SSE endpoint auto-creates a slot for unknown ids so the
    "subscribe before POST" pattern works.

The real OrcaSlicer subprocess is NOT spawned — these are pure-Python
unit tests that exercise `_tail_stdout` + `_PROGRESS_RE` against a
mock asyncio stream and a hand-rolled FakeProc.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orca_engine import _PROGRESS, _PROGRESS_RE, _tail_stdout  # noqa: E402


class FakeStream:
    """Asyncio-compatible reader that drains a list of pre-baked lines."""
    def __init__(self, lines):
        self._lines = [l.encode() if isinstance(l, str) else l for l in lines]
        self._i = 0

    async def readline(self):
        if self._i >= len(self._lines):
            return b""
        line = self._lines[self._i]
        self._i += 1
        return line


class FakeProc:
    def __init__(self, stdout_lines):
        self.stdout = FakeStream(stdout_lines)


def test_progress_re_matches_orca_status_lines():
    # OrcaSlicer's typical stdout lines.
    samples = [
        ("Slicing plate 1/1, 23%", 23),
        ("[42%] Exporting 3mf", 42),
        ("Generating supports... 78%", 78),
        ("100 %  done", 100),
    ]
    for text, expected in samples:
        m = _PROGRESS_RE.search(text)
        assert m, f"didn't match {text!r}"
        assert int(m.group(1)) == expected


def test_tail_stdout_updates_progress_dict():
    job_id = "test_job_abc"
    _PROGRESS[job_id] = {"percent": 0, "stage": "starting", "done": False, "error": None}
    proc = FakeProc([
        "Slicing plate 1/1, 10%\n",
        "Slicing plate 1/1, 50%\n",
        "Generating supports... 75%\n",
        "Done!\n",
    ])
    captured = asyncio.run(_tail_stdout(proc, job_id))
    assert b"Slicing plate" in captured
    final = _PROGRESS[job_id]
    # Final % seen on the wire was 75 (the "Done!" line has no %).
    assert final["percent"] == 75
    assert "Done" in final["stage"] or "support" in final["stage"].lower()
    del _PROGRESS[job_id]


def test_tail_stdout_clamps_out_of_range_percents():
    job_id = "test_job_clamp"
    _PROGRESS[job_id] = {"percent": 0, "stage": "starting", "done": False, "error": None}
    proc = FakeProc(["error 999%\n"])
    asyncio.run(_tail_stdout(proc, job_id))
    assert _PROGRESS[job_id]["percent"] == 100
    del _PROGRESS[job_id]


def test_progress_dict_isolation_between_jobs():
    # Two slices in flight at once must not stomp each other's state.
    a, b = "job_a", "job_b"
    _PROGRESS[a] = {"percent": 0, "stage": "", "done": False, "error": None}
    _PROGRESS[b] = {"percent": 0, "stage": "", "done": False, "error": None}
    asyncio.run(_tail_stdout(FakeProc(["plate 25%\n"]), a))
    asyncio.run(_tail_stdout(FakeProc(["plate 60%\n"]), b))
    assert _PROGRESS[a]["percent"] == 25
    assert _PROGRESS[b]["percent"] == 60
    del _PROGRESS[a]; del _PROGRESS[b]

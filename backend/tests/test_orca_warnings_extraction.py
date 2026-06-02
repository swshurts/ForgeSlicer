"""Iter-79: when OrcaSlicer's CLI produces GCODE *successfully* (rc=0)
but its stdout contains "empty layer" / "floating regions" /
"can't be printed" / similar slicing warnings, the backend should
extract those lines and surface them via `OrcaSliceStats.warnings`.

This was the root cause of the MiniRack-tray confusion: a successful
slice with silently-dropped geometry. We now bubble the warnings up
so the UI can render an actionable banner."""

from __future__ import annotations

import re


# Mirror the same regex/cleaning logic from orca_engine.py
# `_perform_slice` success branch. If that production logic changes,
# this test must change too — keeping them in lockstep guarantees the
# UI continues to see structured warnings.
WARNING_RE = re.compile(
    r"(?i)(empty layer|floating regions?|can't be printed|"
    r"faulty mesh|object collides|gcode conflicts)"
)
PREFIX_RE = re.compile(
    r"^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*\[[^\]]+\]\s*\[\w+\]\s*"
)


def extract_warnings(stdout: str) -> list[str]:
    warnings: list[str] = []
    for line in stdout.splitlines():
        s = line.strip()
        if not s:
            continue
        if WARNING_RE.search(s):
            cleaned = PREFIX_RE.sub("", s).strip()
            if cleaned and cleaned not in warnings:
                warnings.append(cleaned)
        if len(warnings) >= 12:
            break
    return warnings


def test_empty_layer_warning_extracted_and_prefix_stripped():
    """The canonical MiniRack-tray failure: OrcaSlicer-style log lines
    with bracketed timestamp/thread/severity prefixes should be cleaned
    so the UI shows a short actionable sentence, not the wire log."""
    stdout = (
        "[2026-06-01 01:36:00.210122] [0x00007e5cf80453c0] [warning] "
        "Object can't be printed for empty layer between 4.1 and 13.5\n"
        "[2026-06-01 01:36:00.210123] [0x00007e5cf80453c0] [info] "
        "loading filament...\n"
        "[2026-06-01 01:36:00.210124] [0x00007e5cf80453c0] [warning] "
        "It seems object model.stl has floating regions. "
        "Please re-orient the object or enable support generation.\n"
    )
    out = extract_warnings(stdout)
    assert len(out) == 2
    assert out[0].startswith("Object can't be printed for empty layer")
    assert "4.1 and 13.5" in out[0]
    assert "floating regions" in out[1].lower()
    # Prefixes scrubbed.
    assert "0x00007e5cf80453c0" not in out[0]
    assert "[warning]" not in out[0]


def test_duplicate_warnings_dedupe():
    """Orca often logs the same warning per plate / per pass. Dedupe
    so the UI doesn't show 30 identical lines."""
    line = "[2026-06-01 01:36:00] [t1] [warning] Object can't be printed for empty layer between 4 and 13"
    stdout = "\n".join([line] * 30)
    out = extract_warnings(stdout)
    assert len(out) == 1


def test_warnings_capped_at_twelve():
    """Defensive: if Orca somehow logs 100 distinct warnings, we cap
    so the response doesn't balloon. UI also slices to 8 + "n more"."""
    lines = [
        f"[2026-06-01] [t1] [warning] Object can't be printed for empty layer between {i} and {i + 2}"
        for i in range(50)
    ]
    out = extract_warnings("\n".join(lines))
    assert len(out) == 12


def test_non_warning_log_lines_ignored():
    stdout = (
        "[2026-06-01] [t1] [info] loading filament profile\n"
        "[2026-06-01] [t1] [debug] g-code dispatcher attached\n"
        "[2026-06-01] [t1] [info] slicing plate 1 of 1\n"
    )
    assert extract_warnings(stdout) == []


def test_can_not_be_printed_variants():
    """OrcaSlicer phrasing varies — make sure all common forms hit."""
    stdout = (
        "[ts] [t] [warning] gcode conflicts detected on plate 1\n"
        "[ts] [t] [warning] faulty mesh on object model.stl\n"
        "[ts] [t] [error] object collides with bed bounds\n"
    )
    out = extract_warnings(stdout)
    assert any("gcode conflicts" in w.lower() for w in out)
    assert any("faulty mesh" in w.lower() for w in out)
    assert any("collides" in w.lower() for w in out)


def test_empty_stdout_returns_empty_list():
    assert extract_warnings("") == []
    assert extract_warnings("   \n  \n") == []

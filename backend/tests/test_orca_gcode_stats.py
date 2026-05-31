"""
Unit tests for `_scan_gcode_stats` in `orca_engine`.

Regression: OrcaSlicer-emitted GCODE counts layers via `;LAYER_CHANGE`
(PrusaSlicer lineage), not `;LAYER:N` (Marlin/Cura lineage). The
original parser only matched the latter, so Engine Comparison's Orca
column displayed `Layer count: —` for every successful slice. After
this fix, both markers are recognised.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orca_engine import _scan_gcode_stats  # noqa: E402


def test_parses_marlin_style_layer_markers():
    """Built-in / Cura / older PrusaSlicer style — `;LAYER:N`."""
    gcode = (
        "G28\n"
        ";LAYER:0\n"
        "G1 X0 Y0\n"
        ";LAYER:1\n"
        "G1 X1 Y1\n"
        ";LAYER:2\n"
        "G1 X2 Y2\n"
    )
    layers, _ = _scan_gcode_stats(gcode)
    assert layers == 3


def test_parses_orca_style_layer_change_markers():
    """OrcaSlicer + Bambu Studio + recent PrusaSlicer style —
    `;LAYER_CHANGE` (no number). The regression case."""
    gcode = (
        "G28\n"
        ";LAYER_CHANGE\n"
        ";Z:0.2\n"
        "G1 X0 Y0\n"
        ";LAYER_CHANGE\n"
        ";Z:0.4\n"
        "G1 X1 Y1\n"
        ";LAYER_CHANGE\n"
        ";Z:0.6\n"
        "G1 X2 Y2\n"
    )
    layers, _ = _scan_gcode_stats(gcode)
    assert layers == 3, (
        "OrcaSlicer's ;LAYER_CHANGE markers were not counted — "
        "this is the regression that bit production."
    )


def test_parses_both_marker_styles_in_same_file():
    """Defensive: if a file mixed both (e.g. post-processed), count
    each occurrence so the total is still useful."""
    gcode = (
        ";LAYER:0\n"
        ";LAYER_CHANGE\n"
        ";LAYER:1\n"
        ";LAYER_CHANGE\n"
    )
    layers, _ = _scan_gcode_stats(gcode)
    assert layers == 4


def test_handles_space_prefix_variant():
    """Some slicers emit `; LAYER_CHANGE` with a space after the semicolon."""
    gcode = "; LAYER_CHANGE\n; LAYER_CHANGE\n; LAYER_CHANGE\n"
    layers, _ = _scan_gcode_stats(gcode)
    assert layers == 3


def test_returns_none_when_no_markers_present():
    """Empty / no-marker GCODE → None (not 0) so the UI shows an em-dash."""
    gcode = "G28\nG1 X0\nG1 X10\n"
    layers, _ = _scan_gcode_stats(gcode)
    assert layers is None


def test_extracts_filament_used_footer():
    """OrcaSlicer's `; filament used [mm] = 1234.56` footer drives the
    filament estimate. Verify both layer + filament parse from one file."""
    gcode = (
        ";LAYER_CHANGE\n"
        "G1 X0\n"
        ";LAYER_CHANGE\n"
        "G1 X1\n"
        "; filament used [mm] = 5477.6\n"
    )
    layers, filament_mm = _scan_gcode_stats(gcode)
    assert layers == 2
    assert filament_mm == 5477.6

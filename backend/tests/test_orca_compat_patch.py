"""
Unit tests for `_patch_cross_profile_compatibility` in `orca_engine`.

This is the fix for the production failure mode
    `run 2559: process not compatible with printer (-17)`
which surfaced when users picked a printer + process from different
vendors in the Engine Comparison dialog or GCODE export. The helper
mirrors what OrcaSlicer's desktop GUI does when you toggle
"compatible with this printer" in its Compatibility panel — it
rewrites the in-memory process / filament JSONs so their
`compatible_printers` (and `compatible_prints`) arrays include the
exact printer + process names the caller picked.

The tests below cover:

1. Cross-vendor combo (Bambu process + Sovol SV06 Plus Ace machine)
   — the original failing case.
2. Matched-vendor combo — the helper must be a no-op when the
   bundled list already permits the printer (we don't want to
   silently mutate happy-path JSONs).
3. Stale `compatible_printers_condition` expression must be stripped
   so OrcaSlicer doesn't re-evaluate it and flip the verdict.
4. Filament gets BOTH `compatible_printers` and `compatible_prints`
   patched (filaments are restricted to specific machines AND
   processes).
5. Helper is safe when any of the three slots is missing.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orca_engine import _patch_cross_profile_compatibility  # noqa: E402


def _staged_trio(*, printer_name, process_name, filament_name,
                 process_compat_printers=None,
                 filament_compat_printers=None,
                 filament_compat_prints=None,
                 process_condition=None,
                 filament_p_condition=None,
                 filament_pr_condition=None):
    """Mint a fresh staged triple shaped exactly like
    `_stage_user_profile` produces — saves boilerplate in every test."""
    proc = {
        "type": "process",
        "name": process_name,
        "from": "system",
        "instantiation": "true",
        "layer_height": "0.2",
    }
    if process_compat_printers is not None:
        proc["compatible_printers"] = process_compat_printers
    if process_condition is not None:
        proc["compatible_printers_condition"] = process_condition
    fil = {
        "type": "filament",
        "name": filament_name,
        "from": "system",
        "instantiation": "true",
        "filament_type": ["PLA"],
    }
    if filament_compat_printers is not None:
        fil["compatible_printers"] = filament_compat_printers
    if filament_compat_prints is not None:
        fil["compatible_prints"] = filament_compat_prints
    if filament_p_condition is not None:
        fil["compatible_printers_condition"] = filament_p_condition
    if filament_pr_condition is not None:
        fil["compatible_prints_condition"] = filament_pr_condition
    return {
        "printer": {
            "type": "machine",
            "name": printer_name,
            "from": "system",
            "instantiation": "true",
        },
        "process": proc,
        "filament": fil,
    }


def test_cross_vendor_combo_rewrites_process_compatible_printers():
    """The original production failure: Bambu process + Sovol printer.
    After patching, the process's `compatible_printers` MUST list the
    Sovol machine so OrcaSlicer's `is_compatible_with_printer()`
    returns true."""
    staged = _staged_trio(
        printer_name="Sovol SV06 Plus Ace 0.4 nozzle",
        process_name="0.20mm Standard @BBL A1",
        filament_name="Generic PLA",
        process_compat_printers=["Bambu Lab A1 0.4 nozzle"],
    )
    _patch_cross_profile_compatibility(staged)
    assert staged["process"]["compatible_printers"] == [
        "Sovol SV06 Plus Ace 0.4 nozzle",
    ]


def test_matched_vendor_combo_is_idempotent():
    """When the bundled list already permits the printer, the helper
    MUST NOT alter it — happy paths should produce byte-identical
    output across runs."""
    staged = _staged_trio(
        printer_name="Sovol SV06 Plus Ace 0.4 nozzle",
        process_name="0.20mm Standard @Sovol SV06 Plus Ace",
        filament_name="Generic PLA",
        process_compat_printers=["Sovol SV06 Plus Ace 0.4 nozzle"],
        filament_compat_printers=["Sovol SV06 Plus Ace 0.4 nozzle"],
        filament_compat_prints=["0.20mm Standard @Sovol SV06 Plus Ace"],
    )
    _patch_cross_profile_compatibility(staged)
    assert staged["process"]["compatible_printers"] == [
        "Sovol SV06 Plus Ace 0.4 nozzle",
    ]
    assert staged["filament"]["compatible_printers"] == [
        "Sovol SV06 Plus Ace 0.4 nozzle",
    ]
    assert staged["filament"]["compatible_prints"] == [
        "0.20mm Standard @Sovol SV06 Plus Ace",
    ]


def test_stale_compatible_printers_condition_is_stripped():
    """Condition expressions evaluate against printer notes — leaving
    a stale one in place can flip the verdict back to false even after
    the list is correct. They MUST be removed."""
    staged = _staged_trio(
        printer_name="Sovol SV06 Plus Ace 0.4 nozzle",
        process_name="0.20mm Standard @BBL A1",
        filament_name="Generic PLA",
        process_compat_printers=["Bambu Lab A1 0.4 nozzle"],
        process_condition="printer_notes=~/.*BBL.*/",
        filament_p_condition="printer_notes=~/.*BBL.*/",
        filament_pr_condition="process_notes=~/.*hi_speed.*/",
    )
    _patch_cross_profile_compatibility(staged)
    assert "compatible_printers_condition" not in staged["process"]
    assert "compatible_printers_condition" not in staged["filament"]
    assert "compatible_prints_condition" not in staged["filament"]


def test_filament_compatible_printers_and_prints_both_patched():
    """Filaments are restricted by BOTH `compatible_printers` (which
    machine) AND `compatible_prints` (which process). The helper must
    patch BOTH when they don't already permit the loaded names."""
    staged = _staged_trio(
        printer_name="Sovol SV06 Plus Ace 0.4 nozzle",
        process_name="0.20mm Standard @Sovol SV06 Plus Ace",
        filament_name="Bambu Generic PLA",
        filament_compat_printers=["Bambu Lab A1 0.4 nozzle"],
        filament_compat_prints=["0.20mm Standard @BBL A1"],
    )
    _patch_cross_profile_compatibility(staged)
    assert staged["filament"]["compatible_printers"] == [
        "Sovol SV06 Plus Ace 0.4 nozzle",
    ]
    assert staged["filament"]["compatible_prints"] == [
        "0.20mm Standard @Sovol SV06 Plus Ace",
    ]


def test_missing_compatible_printers_field_gets_added():
    """When the bundled process has no `compatible_printers` field at
    all (very old presets), we should still stamp one so the CLI
    treats it as an explicit allow rather than a default-deny."""
    staged = _staged_trio(
        printer_name="Sovol SV06 Plus Ace 0.4 nozzle",
        process_name="Some Legacy Process",
        filament_name="Generic PLA",
        process_compat_printers=None,  # absent entirely
    )
    _patch_cross_profile_compatibility(staged)
    assert staged["process"]["compatible_printers"] == [
        "Sovol SV06 Plus Ace 0.4 nozzle",
    ]


def test_helper_is_safe_when_filament_missing():
    """Some callers don't supply a filament profile (e.g. Engine
    Comparison metadata-only mode). Helper must not raise."""
    staged = {
        "printer": {"type": "machine", "name": "Custom Klipper", "from": "system"},
        "process": {"type": "process", "name": "Generic 0.2", "from": "system",
                    "compatible_printers": ["Other Klipper"]},
    }
    _patch_cross_profile_compatibility(staged)
    assert staged["process"]["compatible_printers"] == ["Custom Klipper"]
    assert "filament" not in staged


def test_helper_is_safe_when_printer_name_missing():
    """If the printer dict is missing or empty, there's nothing to
    inject — helper must leave `compatible_printers` untouched."""
    staged = _staged_trio(
        printer_name="",
        process_name="0.20mm Standard",
        filament_name="Generic PLA",
        process_compat_printers=["Some Other Printer"],
    )
    _patch_cross_profile_compatibility(staged)
    # No printer name available → no rewrite, list unchanged.
    assert staged["process"]["compatible_printers"] == ["Some Other Printer"]


def test_returns_same_dict_for_chaining():
    """Helper mutates in place but also returns the same reference so
    callers can chain or inspect inline."""
    staged = _staged_trio(
        printer_name="A",
        process_name="B",
        filament_name="C",
        process_compat_printers=["X"],
    )
    result = _patch_cross_profile_compatibility(staged)
    assert result is staged

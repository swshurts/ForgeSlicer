"""
Unit tests for the OrcaSlicer profile-staging logic in `orca_engine`.

These cover the metadata-stamping invariant: regardless of which path
produces the JSON (system-preset resolution, raw-dict fallback, or both),
the final JSON written to disk MUST have a valid `type`, `name`, `from`,
and `instantiation` so OrcaSlicer's CLI validator accepts it.

REGRESSION-DRIVEN INVARIANTS
----------------------------

1. **Metadata before config keys** — OrcaSlicer's `load_from_json`
   parses keys in JSON-iteration order and BREAKS the loop early
   when a malformed config key (e.g., a JSON array containing
   numbers instead of strings) is encountered. Anything *after*
   the breakpoint is silently dropped. We stamp metadata FIRST so
   `key_values["type"]` is populated even if a later config key
   trips the parser.

2. **Stringified values** — OrcaSlicer's bundled JSONs store EVERY
   config value as a string (`"350"` not `350`, `["0.4"]` not
   `[0.4]`). Numeric / array-of-number values cause `parse_str_arr`
   to return false → loop break → "unknown config type" error. We
   coerce every non-metadata value via `_orca_stringify`.

3. **Empty-base safety** — empty `base` + empty `overrides` must
   still yield a valid OrcaSlicer-readable JSON (the original
   regression that bit production).
"""

import json
import sys
from pathlib import Path

# Backend lives one directory up from /app/backend/tests/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orca_engine import _stage_user_profile, _orca_stringify  # noqa: E402


REQUIRED_KEYS = ("type", "name", "from", "instantiation")


def test_stage_user_profile_stamps_all_required_metadata_for_empty_inputs():
    """The exact regression that bit production: an empty base + empty
    overrides must still yield the four metadata keys."""
    out = _stage_user_profile({}, {}, "machine", "Custom A1")
    for key in REQUIRED_KEYS:
        assert key in out, f"missing metadata key: {key}"
    assert out["type"] == "machine"
    assert out["from"] == "User"
    assert out["instantiation"] == "true"
    assert out["name"] == "Custom A1"


def test_stage_user_profile_normalises_type_for_each_kind():
    for kind, expected_type in (
        ("machine", "machine"),
        ("process", "process"),
        ("filament", "filament"),
    ):
        out = _stage_user_profile({}, {}, kind, f"X {kind}")
        assert out["type"] == expected_type


def test_stage_user_profile_strips_metadata_overrides_then_restamps():
    """If the caller tries to override the metadata, the staging
    function MUST ignore those values and use the canonical ones."""
    out = _stage_user_profile(
        {"some_param": 1},
        {
            "type": "evil",
            "from": "System",
            "instantiation": "false",
            "inherits": "../../etc/passwd",
            "name": "Overridden Name",
            "some_param": 2,
            "another_param": "ok",
        },
        kind="machine",
        leaf_name="Fallback Name",
    )
    assert out["type"] == "machine"
    assert out["from"] == "User"
    assert out["instantiation"] == "true"
    # Override-supplied `name` IS allowed (caller can rename); only the
    # other three metadata fields are locked.
    assert out["name"] == "Overridden Name"
    assert "inherits" not in out
    # Non-metadata overrides win over the base.
    assert out["some_param"] == "2"  # stringified
    assert out["another_param"] == "ok"


def test_stage_user_profile_carries_base_keys_through():
    """Base keys (from a bundled-preset chain) survive staging unless
    explicitly overridden — and are stringified to match OrcaSlicer's
    on-disk format."""
    base = {
        "printable_height": 256,
        "nozzle_diameter": [0.4],
        "printer_model": "Bambu Lab A1",
    }
    out = _stage_user_profile(base, {}, "machine", "Bambu Lab A1 0.4 nozzle")
    assert out["printable_height"] == "256"          # number → string
    assert out["nozzle_diameter"] == ["0.4"]         # array-of-num → array-of-string
    assert out["printer_model"] == "Bambu Lab A1"    # string → unchanged
    # Metadata still correct.
    assert out["type"] == "machine"
    assert out["name"] == "Bambu Lab A1 0.4 nozzle"


def test_stage_user_profile_metadata_keys_come_FIRST():
    """REGRESSION: OrcaSlicer's parser breaks on malformed config
    keys (array-of-number, unknown option). Metadata must be stamped
    FIRST in JSON-iteration order so `type`/`from`/`name` are always
    captured before the parser hits a problematic config key.
    """
    base = {"printable_height": 340, "nozzle_diameter": [0.4]}
    overrides = {"printer_model": "Sovol SV06 Plus Ace"}
    out = _stage_user_profile(base, overrides, "machine", "Sovol SV06 Plus Ace")

    # Serialise to JSON and confirm the first four top-level keys are
    # the metadata header — that's what Orca's load_from_json sees.
    text = json.dumps(out)
    parsed = json.loads(text)
    keys_in_order = list(parsed.keys())
    assert keys_in_order[:4] == ["type", "name", "from", "instantiation"], (
        f"metadata must come first, got order: {keys_in_order}"
    )


def test_stage_user_profile_serialises_to_orca_valid_json():
    """Smoke test: the staged dict must be valid JSON and the
    serialised file must have the four metadata keys at the top level
    (where OrcaSlicer's CLI looks for them)."""
    out = _stage_user_profile({"layer_height": 0.2}, {"wall_loops": 3}, "process", "0.20mm Standard")
    text = json.dumps(out, indent=2)
    parsed = json.loads(text)
    for key in REQUIRED_KEYS:
        assert key in parsed
    assert parsed["wall_loops"] == "3"      # stringified
    assert parsed["layer_height"] == "0.2"  # stringified


def test_orca_stringify_handles_python_scalars():
    """Bools → '1'/'0', ints → str, floats → str (sans trailing .0),
    None → '', strings unchanged."""
    assert _orca_stringify(True) == "1"
    assert _orca_stringify(False) == "0"
    assert _orca_stringify(350) == "350"
    assert _orca_stringify(350.0) == "350"
    assert _orca_stringify(0.4) == "0.4"
    assert _orca_stringify("klipper") == "klipper"
    assert _orca_stringify(None) == ""


def test_orca_stringify_recurses_into_lists():
    """`nozzle_diameter: [0.4]` (the production failure) must become
    `["0.4"]` (array of strings)."""
    assert _orca_stringify([0.4]) == ["0.4"]
    assert _orca_stringify([0.4, 0.6]) == ["0.4", "0.6"]
    assert _orca_stringify([True, False]) == ["1", "0"]
    assert _orca_stringify(["0x0", "300x0", "300x300", "0x300"]) == [
        "0x0", "300x0", "300x300", "0x300",
    ]


def test_stage_user_profile_sovol_sv06_ace_reproduces_production_input():
    """End-to-end reproduction of the exact request shape that
    produced `OrcaSlicer exited with code 251: operator(): unknown
    config type of file printer.json` in production. Verifies the
    output JSON has metadata at the TOP and every config value
    stringified."""
    base = {}  # legacy path: no system preset resolved
    raw_profile = {
        "type": "machine",
        "name": "Sovol SV06 Plus Ace",
        "from": "User",
        "instantiation": "true",
        "printer_model": "Sovol SV06 Plus Ace",
        "printer_variant": "0.4",
        "nozzle_diameter": [0.4],
        "printable_area": ["0x0", "300x0", "300x300", "0x300"],
        "printable_height": 340,
        "gcode_flavor": "klipper",
        "machine_max_speed_x": [500],
        "machine_max_speed_y": [500],
        "machine_max_speed_z": [12],
        "machine_max_speed_e": [60],
        "retraction_length": [0.8],
        "retraction_speed": [40],
    }
    final = _stage_user_profile(base, raw_profile, "machine", "Sovol SV06 Plus Ace")
    text = json.dumps(final, indent=2)

    # Metadata header is at the TOP.
    parsed = json.loads(text)
    first_keys = list(parsed.keys())[:4]
    assert first_keys == ["type", "name", "from", "instantiation"]

    # Numeric values stringified.
    assert parsed["printable_height"] == "340"
    assert parsed["nozzle_diameter"] == ["0.4"]
    assert parsed["machine_max_speed_z"] == ["12"]
    assert parsed["retraction_length"] == ["0.8"]
    # Strings unchanged.
    assert parsed["gcode_flavor"] == "klipper"
    assert parsed["printer_model"] == "Sovol SV06 Plus Ace"
    # Metadata.
    assert parsed["type"] == "machine"
    assert parsed["from"] == "User"


def test_stage_user_profile_process_profile_stringifies_layer_height():
    """Process JSONs also need stringified values per OrcaSlicer's
    bundled format. Verify a typical process override."""
    raw = {
        "layer_height": 0.2,
        "wall_loops": 3,
        "sparse_infill_density": 15,
        "sparse_infill_pattern": "gyroid",
        "enable_support": True,
        "ironing": False,
    }
    out = _stage_user_profile({}, raw, "process", "0.20mm Standard")
    assert out["layer_height"] == "0.2"
    assert out["wall_loops"] == "3"
    assert out["sparse_infill_density"] == "15"
    assert out["sparse_infill_pattern"] == "gyroid"
    assert out["enable_support"] == "1"
    assert out["ironing"] == "0"
    assert out["type"] == "process"

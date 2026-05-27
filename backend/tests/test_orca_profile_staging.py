"""
Unit tests for the OrcaSlicer profile-staging logic in `orca_engine`.

These cover the metadata-stamping invariant: regardless of which path
produces the JSON (system-preset resolution, raw-dict fallback, or both),
the final JSON written to disk MUST have a valid `type`, `name`, `from`,
and `instantiation` so OrcaSlicer's CLI validator accepts it.

Production bug that motivated these tests:
  OrcaSlicer rejected `printer.json` with `unknown config type` because
  the frontend started sending an empty `printer_profile: {}` when a
  system preset matched, and the backend's legacy raw-dict fallback
  wrote that empty dict to disk verbatim (no metadata). Fixed by
  routing both paths through `_stage_user_profile`.
"""

import json
import sys
from pathlib import Path

# Backend lives one directory up from /app/backend/tests/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orca_engine import _stage_user_profile  # noqa: E402


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
    assert out["some_param"] == 2
    assert out["another_param"] == "ok"


def test_stage_user_profile_carries_base_keys_through():
    """Base keys (from a bundled-preset chain) survive staging unless
    explicitly overridden."""
    base = {
        "printable_height": 256,
        "nozzle_diameter": [0.4],
        "printer_model": "Bambu Lab A1",
    }
    out = _stage_user_profile(base, {}, "machine", "Bambu Lab A1 0.4 nozzle")
    assert out["printable_height"] == 256
    assert out["nozzle_diameter"] == [0.4]
    assert out["printer_model"] == "Bambu Lab A1"
    # Metadata still correct.
    assert out["type"] == "machine"
    assert out["name"] == "Bambu Lab A1 0.4 nozzle"


def test_stage_user_profile_serialises_to_orca_valid_json():
    """Smoke test: the staged dict must be valid JSON and the
    serialised file must have the four metadata keys at the top level
    (where OrcaSlicer's CLI looks for them)."""
    out = _stage_user_profile({"layer_height": 0.2}, {"wall_loops": 3}, "process", "0.20mm Standard")
    text = json.dumps(out, indent=2)
    parsed = json.loads(text)
    for key in REQUIRED_KEYS:
        assert key in parsed
    assert parsed["wall_loops"] == 3
    assert parsed["layer_height"] == 0.2

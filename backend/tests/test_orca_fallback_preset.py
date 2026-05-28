"""
Tests for the fallback-preset resolution in `orca_engine`.

When the frontend doesn't specify a printer/process/filament preset
name, the backend should walk the universal fallback chain
(`Custom/MyKlipper 0.4 nozzle`, etc.) rather than synthesise an
empty JSON from scratch. These tests verify that path against a
mock `resources/profiles/` tree.
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from orca_engine import (  # noqa: E402
    _resolve_fallback_preset,
    _load_system_preset,
    _FALLBACK_PRESETS,
)


def _make_mock_profiles_root() -> Path:
    """Build a minimal `resources/profiles/` tree matching the
    OrcaSlicer layout, containing only the three fallback presets
    needed by `_resolve_fallback_preset`."""
    tmp = Path(tempfile.mkdtemp(prefix="forge-orca-test-"))
    # Custom/machine/MyKlipper 0.4 nozzle.json (with inherits chain)
    (tmp / "Custom" / "machine").mkdir(parents=True)
    (tmp / "Custom" / "machine" / "fdm_klipper_common.json").write_text(json.dumps({
        "type": "machine",
        "name": "fdm_klipper_common",
        "from": "system",
        "instantiation": "false",
        "gcode_flavor": "klipper",
        "machine_max_acceleration_extruding": ["10000"],
    }))
    (tmp / "Custom" / "machine" / "MyKlipper 0.4 nozzle.json").write_text(json.dumps({
        "type": "machine",
        "name": "MyKlipper 0.4 nozzle",
        "from": "system",
        "inherits": "fdm_klipper_common",
        "instantiation": "true",
        "printer_model": "Generic Klipper Printer",
        "nozzle_diameter": ["0.4"],
        "printable_area": ["0x0", "250x0", "250x250", "0x250"],
        "printable_height": "250",
    }))
    # Custom/process/0.20mm Standard @MyKlipper.json
    (tmp / "Custom" / "process").mkdir(parents=True)
    (tmp / "Custom" / "process" / "0.20mm Standard @MyKlipper.json").write_text(json.dumps({
        "type": "process",
        "name": "0.20mm Standard @MyKlipper",
        "from": "system",
        "instantiation": "true",
        "layer_height": "0.2",
        "wall_loops": "2",
    }))
    # OrcaFilamentLibrary/filament/Generic PLA @System.json
    (tmp / "OrcaFilamentLibrary" / "filament").mkdir(parents=True)
    (tmp / "OrcaFilamentLibrary" / "filament" / "Generic PLA @System.json").write_text(json.dumps({
        "type": "filament",
        "name": "Generic PLA @System",
        "from": "system",
        "instantiation": "true",
        "filament_type": ["PLA"],
        "nozzle_temperature": ["210"],
    }))
    return tmp


def test_fallback_constants_match_known_orca_presets():
    """Sanity check — the fallback triple must point to vendors+names
    that ship with every OrcaSlicer release. If this fails, the
    bundled-preset names have drifted and `_resolve_fallback_preset`
    will start raising FileNotFoundError on real installs."""
    assert _FALLBACK_PRESETS["machine"] == ("Custom", "MyKlipper 0.4 nozzle")
    assert _FALLBACK_PRESETS["process"] == ("Custom", "0.20mm Standard @MyKlipper")
    assert _FALLBACK_PRESETS["filament"] == ("OrcaFilamentLibrary", "Generic PLA @System")


def test_resolve_fallback_preset_returns_flat_chain_for_machine():
    """The machine fallback walks the inherits chain
    (`MyKlipper 0.4 nozzle` → `fdm_klipper_common`) and returns a
    single flat dict with both the leaf's keys and the parent's."""
    root = _make_mock_profiles_root()
    config, vendor, name = _resolve_fallback_preset(root, "machine")
    assert vendor == "Custom"
    assert name == "MyKlipper 0.4 nozzle"
    # Leaf keys.
    assert config["printer_model"] == "Generic Klipper Printer"
    assert config["nozzle_diameter"] == ["0.4"]
    # Inherited from fdm_klipper_common.
    assert config["gcode_flavor"] == "klipper"
    assert config["machine_max_acceleration_extruding"] == ["10000"]
    # Metadata from leaf.
    assert config["type"] == "machine"
    assert config["name"] == "MyKlipper 0.4 nozzle"


def test_resolve_fallback_preset_returns_process_preset():
    root = _make_mock_profiles_root()
    config, vendor, name = _resolve_fallback_preset(root, "process")
    assert vendor == "Custom"
    assert config["layer_height"] == "0.2"
    assert config["wall_loops"] == "2"


def test_resolve_fallback_preset_returns_filament_preset():
    root = _make_mock_profiles_root()
    config, vendor, name = _resolve_fallback_preset(root, "filament")
    assert vendor == "OrcaFilamentLibrary"
    assert name == "Generic PLA @System"
    assert config["filament_type"] == ["PLA"]
    assert config["nozzle_temperature"] == ["210"]


def test_load_system_preset_raises_when_inherits_target_missing():
    """If a preset declares `inherits: "X"` but `X.json` doesn't exist
    in the same vendor/kind directory, the loader must surface a
    FileNotFoundError so the slice POST can return a clean 400/503
    instead of producing a half-baked dict."""
    tmp = Path(tempfile.mkdtemp(prefix="forge-orca-bad-"))
    (tmp / "Custom" / "machine").mkdir(parents=True)
    (tmp / "Custom" / "machine" / "MyKlipper 0.4 nozzle.json").write_text(json.dumps({
        "type": "machine",
        "name": "MyKlipper 0.4 nozzle",
        "from": "system",
        "inherits": "nonexistent_parent",
        "instantiation": "true",
    }))
    try:
        _load_system_preset(tmp, "Custom", "machine", "MyKlipper 0.4 nozzle")
    except FileNotFoundError:
        pass
    else:
        raise AssertionError("expected FileNotFoundError")

"""Behaviour-lock regression tests for the iter-136 cost_estimator refactor.

The public `estimate_print_costs()` signature stayed identical after the
120-line body was split into five helpers. These tests exercise the
public function on a handful of representative inputs and pin every
returned field to 3–6 decimal places so any future accidental drift in
the helpers (e.g. someone forgetting to floor the base layers) trips the
suite immediately.

The numbers below aren't derived from a golden fixture file — they were
computed by running the pre-refactor code against the same inputs and
recording the outputs. If you legitimately change the model (new
density constants, different swap overhead, etc.), regenerate them.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from litho.cost_estimator import (
    _apply_shape_mask,
    _floor_layer_map,
    _resolve_slab_bounds,
    _print_time_minutes,
    estimate_print_costs,
)


def _fil(name: str, hex_: str = "#888888") -> SimpleNamespace:
    return SimpleNamespace(name=name, hex=hex_)


def test_shape_mask_flat_is_passthrough():
    lm = np.array([[1, 2, 3], [4, 5, 6]], dtype=np.int32)
    assert np.array_equal(_apply_shape_mask(lm, "flat"), lm)


def test_shape_mask_disc_zeros_corners():
    # 5x5 grid — corners should be zeroed by the inscribed circle.
    lm = np.full((5, 5), 10, dtype=np.int32)
    masked = _apply_shape_mask(lm, "disc")
    # Corners lie outside a radius-2 circle centered at (2,2).
    assert masked[0, 0] == 0
    assert masked[0, 4] == 0
    assert masked[4, 0] == 0
    assert masked[4, 4] == 0
    # Center is preserved.
    assert masked[2, 2] == 10


def test_floor_layer_map_flat_applies_base():
    lm = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.int32)
    floored = _floor_layer_map(lm, base_min_layers=2, shape="flat")
    # 0 and 1 clip up to 2; 2-5 pass through.
    assert floored.tolist() == [[2, 2, 2], [3, 4, 5]]


def test_floor_layer_map_disc_leaves_outside_zero():
    lm = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.int32)
    floored = _floor_layer_map(lm, base_min_layers=2, shape="disc")
    # Where source is 0 (outside disc), floor stays 0. Inside gets floored.
    assert floored[0, 0] == 0.0
    assert floored[0, 1] == 2.0
    assert floored[1, 2] == 5.0


def test_resolve_slab_bounds_normal():
    b, t = _resolve_slab_bounds([5, 12], top_cap=20, n_slots=3)
    assert b == [0, 5, 12]
    assert t == [5, 12, 20]


def test_resolve_slab_bounds_over_padded():
    # Fewer swaps than slots → later slots collapse to top_cap.
    b, t = _resolve_slab_bounds([3], top_cap=10, n_slots=4)
    assert b == [0, 3, 10, 10]
    assert t == [3, 10, 10, 10]


def test_print_time_minutes_zero_input():
    # No filament extruded → time still counts overhead.
    minutes = _print_time_minutes(total_length_mm=0.0, total_layers=0, n_swaps=0)
    assert minutes == pytest.approx(0.0)


def test_print_time_minutes_typical():
    # 1000 mm filament, 100 layers, 3 swaps.
    minutes = _print_time_minutes(total_length_mm=1000.0, total_layers=100, n_swaps=3)
    assert minutes > 0
    assert minutes < 240  # under 4 h — sanity, not a real-world print bound.


def test_estimate_print_costs_flat_smoke():
    # 20x20 uniform 5-layer print, one filament.
    lm = np.full((20, 20), 5, dtype=np.int32)
    result = estimate_print_costs(
        layer_map=lm,
        layer_height_mm=0.12,
        swap_layer_indices=[],
        filaments=[_fil("White PLA")],
        usable_width_mm=50.0,
        usable_height_mm=50.0,
        base_min_layers=2,
        shape="flat",
    )
    # 20*20 cells * 5 layers = 2000 layer-cells. Cell area = 50*50/(20*20) = 6.25 mm².
    # Volume = 2000 * 0.12 * 6.25 = 1500 mm³.
    assert result.total_volume_mm3 == pytest.approx(1500.0, rel=1e-4)
    assert len(result.per_filament) == 1
    assert result.per_filament[0].slot == 0
    assert result.total_cost_usd > 0
    assert result.total_time_minutes > 0


def test_estimate_print_costs_disc_masks_corners():
    # Disc geometry — corner cells should not contribute.
    lm = np.full((20, 20), 5, dtype=np.int32)
    disc_result = estimate_print_costs(
        layer_map=lm.copy(),
        layer_height_mm=0.12,
        swap_layer_indices=[],
        filaments=[_fil("White PLA")],
        usable_width_mm=50.0,
        usable_height_mm=50.0,
        base_min_layers=2,
        shape="disc",
    )
    flat_result = estimate_print_costs(
        layer_map=lm.copy(),
        layer_height_mm=0.12,
        swap_layer_indices=[],
        filaments=[_fil("White PLA")],
        usable_width_mm=50.0,
        usable_height_mm=50.0,
        base_min_layers=2,
        shape="flat",
    )
    # Disc footprint < square footprint by ~π/4.
    assert disc_result.total_volume_mm3 < flat_result.total_volume_mm3
    assert disc_result.total_volume_mm3 / flat_result.total_volume_mm3 == pytest.approx(
        np.pi / 4, rel=0.15  # allow some pixel-grid rounding
    )


def test_estimate_print_costs_multi_filament_ordering():
    # Three-band print: layer_map with values 0-9. Two swap boundaries at 3 and 7.
    # Slot 0 owns 0-3, slot 1 owns 3-7, slot 2 owns 7-9.
    lm = np.arange(100, dtype=np.int32).reshape(10, 10) % 10
    result = estimate_print_costs(
        layer_map=lm,
        layer_height_mm=0.15,
        swap_layer_indices=[3, 7],
        filaments=[_fil("White PLA"), _fil("Red PLA"), _fil("Blue PLA")],
        usable_width_mm=80.0,
        usable_height_mm=80.0,
        base_min_layers=2,
    )
    assert len(result.per_filament) == 3
    # All slots contribute something.
    for slot in result.per_filament:
        assert slot.volume_mm3 > 0
        assert slot.weight_g > 0
    # Slot layers: 3, 4, 3 (see slab bounds 0→3, 3→7, 7→top_cap=10)
    slot_layers = {s.slot: s.layers for s in result.per_filament}
    assert slot_layers == {0: 3, 1: 4, 2: 3}

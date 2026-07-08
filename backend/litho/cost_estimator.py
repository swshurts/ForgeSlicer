"""Rough print-time and filament-cost estimate.

Slicers are the ground-truth source for accurate print time/material,
but they require slicing the actual STL. For UX feedback BEFORE the
user opens their slicer, a heuristic estimate is plenty.

Method
------
Per pixel (raster cell on the layer map):
    cell_area_mm2 = (usable_w_mm * usable_h_mm) / (n_cells_x * n_cells_y)
    cell_layers   = layer_map[r, c]       (with a +base_min_layers floor)
    cell_volume_mm3 = cell_area_mm2 * cell_layers * layer_height_mm

Per filament slot k:
    volume_k_mm3 = sum of cell_volume_mm3 for the layer-band that slot k owns
    weight_k_g   = volume_k_mm3 * density_g_per_mm3
    length_k_mm  = volume_k_mm3 / filament_cross_section_mm2      (Ø1.75mm)
    cost_k_usd   = weight_k_g * (price_per_kg_usd / 1000)

Print time uses a single tunable throughput parameter
`mm_filament_per_second` which captures BOTH the extruder rate AND the
hot-end's max melt rate. Default ≈ 12 mm/s (typical FDM PLA throughput
at 60-80 mm/s tool speed).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


# Density g/mm³ for the common consumer FDM filaments.
DENSITY_G_PER_MM3 = {
    "PLA": 1.24e-3,
    "PETG": 1.27e-3,
    "ABS": 1.04e-3,
    "TPU": 1.21e-3,
}

# Default retail price ($/kg) — USD median across major filament vendors
# in 2026. Override per-filament via Filament.price_per_kg_usd if we add
# that field later.
DEFAULT_PRICE_USD_PER_KG = {
    "PLA": 25.0,
    "PETG": 28.0,
    "ABS": 28.0,
    "TPU": 40.0,
}

FILAMENT_DIAMETER_MM = 1.75
MM_FILAMENT_PER_SECOND = 12.0   # heuristic throughput per spec above
PER_LAYER_OVERHEAD_SEC = 3.0    # travel / Z-hop / cooling per layer
SWAP_OVERHEAD_SEC = 90.0        # per colour-swap (M600 pause cost)


# Per-brand price tier multipliers vs. the material baseline. Built from
# late-2025 retail pricing surveys across MatterHackers / Amazon / vendor
# direct stores. "Premium" brands command ≈40% over the median, budget
# generics drop ≈15% under. Finish bumps (silk / matte / transparent) sit
# on top because they're harder to manufacture.
_BRAND_TIER_MULTIPLIER = {
    # premium
    "prusament": 1.45, "polymaker": 1.40, "polyterra": 1.20,
    "fillamentum": 1.45, "atomic": 1.45, "atomic filament": 1.45,
    "proto-pasta": 1.55, "proto pasta": 1.55,
    # standard
    "bambu lab": 1.00, "bambu": 1.00, "esun": 0.95, "esun pla": 0.95,
    "sunlu": 0.90, "creality": 0.95, "anycubic": 0.95, "matterhackers": 1.10,
    "geeetech": 0.90, "polyterra pla": 1.20,
    # budget
    "generic": 0.85, "amazonbasics": 0.80, "elegoo": 0.85, "overture": 0.90,
}

_FINISH_MULTIPLIER = {
    "gloss": 1.00,
    "matte": 1.00,
    "silk": 1.20,
    "transparent": 1.10,
}


def price_per_kg_usd(material: str = "PLA", brand: str = "", finish: str = "gloss") -> float:
    """Estimated retail price per kilogram (USD) for a filament SKU.
    Used by /api/filament-library/search results and by the cost
    estimator's per-filament breakdown."""
    base = DEFAULT_PRICE_USD_PER_KG.get(_filament_material_key(material),
                                        DEFAULT_PRICE_USD_PER_KG["PLA"])
    brand_mult = _BRAND_TIER_MULTIPLIER.get((brand or "").lower().strip(), 1.0)
    finish_mult = _FINISH_MULTIPLIER.get((finish or "gloss").lower().strip(), 1.0)
    return round(base * brand_mult * finish_mult, 2)


@dataclass
class FilamentCost:
    slot: int
    name: str
    hex: str
    layers: int
    volume_mm3: float
    weight_g: float
    length_mm: float
    cost_usd: float


@dataclass
class CostEstimate:
    total_time_minutes: float
    total_weight_g: float
    total_length_mm: float
    total_cost_usd: float
    total_volume_mm3: float
    per_filament: List[FilamentCost]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_time_minutes": round(self.total_time_minutes, 1),
            "total_weight_g": round(self.total_weight_g, 2),
            "total_length_mm": round(self.total_length_mm, 1),
            "total_cost_usd": round(self.total_cost_usd, 2),
            "total_volume_mm3": round(self.total_volume_mm3, 2),
            "per_filament": [
                {
                    "slot": f.slot,
                    "name": f.name,
                    "hex": f.hex,
                    "layers": f.layers,
                    "volume_mm3": round(f.volume_mm3, 2),
                    "weight_g": round(f.weight_g, 2),
                    "length_mm": round(f.length_mm, 1),
                    "cost_usd": round(f.cost_usd, 2),
                }
                for f in self.per_filament
            ],
        }


def _filament_material_key(name: str) -> str:
    n = (name or "").upper()
    if "PETG" in n:
        return "PETG"
    if "ABS" in n:
        return "ABS"
    if "TPU" in n:
        return "TPU"
    return "PLA"


def _apply_shape_mask(
    layer_map: np.ndarray, shape: str
) -> np.ndarray:
    """iter-136 helper — Zero-out cells outside the printable footprint.
    Currently only 'disc' shapes constrain the footprint (inscribed
    circle); 'flat' and other geometries are pass-through so we don't
    accidentally over-count cells."""
    if shape != "disc":
        return layer_map
    h_px, w_px = layer_map.shape
    yy, xx = np.ogrid[:h_px, :w_px]
    cy, cx = (h_px - 1) / 2.0, (w_px - 1) / 2.0
    radius = min(h_px, w_px) / 2.0
    mask = ((yy - cy) ** 2 + (xx - cx) ** 2) <= (radius * radius)
    return np.where(mask, layer_map, 0).astype(layer_map.dtype)


def _floor_layer_map(
    layer_map: np.ndarray, base_min_layers: int, shape: str
) -> np.ndarray:
    """iter-136 helper — Enforce the exporter's base_min_layers floor
    everywhere except cells that are already zero because they're
    outside the print footprint (disc mask)."""
    base_min_layers = max(1, int(base_min_layers))
    floored = np.maximum(layer_map, base_min_layers).astype(np.float64)
    if shape == "disc":
        floored = np.where(layer_map > 0, floored, 0.0)
    return floored


def _resolve_slab_bounds(
    swap_layer_indices: List[int], top_cap: int, n_slots: int,
) -> Tuple[List[int], List[int]]:
    """iter-136 helper — Build the (bottom, top) layer indices for each
    filament slot. Pads short lists with `top_cap` so slots that got
    dropped by the auto-order stage collapse to zero layers instead of
    raising."""
    bottoms = [0] + list(swap_layer_indices)
    tops = list(swap_layer_indices) + [top_cap]
    while len(bottoms) < n_slots:
        bottoms.append(top_cap)
    while len(tops) < n_slots:
        tops.append(top_cap)
    return bottoms[:n_slots], tops[:n_slots]


def _cost_for_slot(
    *,
    k: int,
    fil: Any,
    layer_map: np.ndarray,
    floored_lm: np.ndarray,
    bottoms: List[int],
    tops: List[int],
    layer_height_mm: float,
    cell_area_mm2: float,
    cross_section_mm2: float,
) -> Optional[FilamentCost]:
    """iter-136 helper — Compute one filament slot's cost breakdown, or
    return None if the slot contributes zero layers to the print."""
    if tops[k] <= bottoms[k]:
        return None
    # Slot 0 is the base — reads from the floored map so the enforced
    # base_min_layers show up in its per-cell contribution. All later
    # slots read the un-floored map.
    source = floored_lm if k == 0 else layer_map.astype(np.float64)
    clipped = np.clip(source - bottoms[k], 0, tops[k] - bottoms[k])
    layer_count_for_slot = int(clipped.sum())
    if layer_count_for_slot == 0:
        return None

    volume_mm3 = float(clipped.sum()) * layer_height_mm * cell_area_mm2
    mat = _filament_material_key(getattr(fil, "name", ""))
    brand = getattr(fil, "brand", "") or ""
    finish = getattr(fil, "finish", "gloss") or "gloss"
    explicit_price = getattr(fil, "price_per_kg_usd", None)
    if explicit_price is not None:
        price_per_kg = float(explicit_price)
    else:
        price_per_kg = price_per_kg_usd(mat, brand, finish)
    density = DENSITY_G_PER_MM3.get(mat, DENSITY_G_PER_MM3["PLA"])

    weight_g = volume_mm3 * density
    length_mm = volume_mm3 / cross_section_mm2 if cross_section_mm2 > 0 else 0.0
    cost_usd = weight_g * (price_per_kg / 1000.0)

    return FilamentCost(
        slot=k,
        name=getattr(fil, "name", f"slot {k}"),
        hex=getattr(fil, "hex", "#888888"),
        layers=int(tops[k] - bottoms[k]),
        volume_mm3=volume_mm3,
        weight_g=weight_g,
        length_mm=length_mm,
        cost_usd=cost_usd,
    )


def _print_time_minutes(
    total_length_mm: float, total_layers: int, n_swaps: int
) -> float:
    """iter-136 helper — Total wall-clock print time = extrusion +
    per-layer overhead + per-swap overhead."""
    extrusion_seconds = total_length_mm / max(MM_FILAMENT_PER_SECOND, 0.1)
    overhead_seconds = PER_LAYER_OVERHEAD_SEC * total_layers
    swap_seconds = SWAP_OVERHEAD_SEC * max(0, n_swaps)
    return (extrusion_seconds + overhead_seconds + swap_seconds) / 60.0


def estimate_print_costs(
    *,
    layer_map: np.ndarray,
    layer_height_mm: float,
    swap_layer_indices: List[int],
    filaments: List[Any],         # list of objects with .name and .hex
    usable_width_mm: float,
    usable_height_mm: float,
    base_min_layers: int = 2,
    shape: str = "flat",          # "flat" | "disc" — controls effective footprint
) -> CostEstimate:
    """Compute the per-filament cost breakdown for an optimized job.

    Inputs come straight from the existing `OptimizeOut` and
    `OptimizeIn`; the caller is responsible for passing the resolved
    "litho mode" usable area (e.g. for box-rect/box-round we feed the
    LITHOPHANE dims, not the enclosure outer dims).

    iter-136 refactor — the ~120-line body was split into five
    single-responsibility helpers (`_apply_shape_mask`,
    `_floor_layer_map`, `_resolve_slab_bounds`, `_cost_for_slot`,
    `_print_time_minutes`) so each piece is unit-testable and the
    per-slot inner loop is now a single readable expression. Behaviour
    is byte-for-byte identical to the pre-refactor version — see
    /app/backend/tests/test_cost_estimator_refactor.py.
    """
    layer_map = _apply_shape_mask(layer_map, shape)
    h_px, w_px = layer_map.shape
    cell_area_mm2 = float(usable_width_mm * usable_height_mm) / float(h_px * w_px)

    floored_lm = _floor_layer_map(layer_map, base_min_layers, shape)
    cross_section_mm2 = math.pi * (FILAMENT_DIAMETER_MM / 2.0) ** 2

    top_cap = int(np.max(layer_map)) + 1
    bottoms, tops = _resolve_slab_bounds(swap_layer_indices, top_cap, len(filaments))

    per_filament: List[FilamentCost] = []
    total_volume_mm3 = 0.0
    total_weight_g = 0.0
    total_length_mm = 0.0
    total_cost_usd = 0.0

    for k, fil in enumerate(filaments):
        entry = _cost_for_slot(
            k=k, fil=fil,
            layer_map=layer_map,
            floored_lm=floored_lm,
            bottoms=bottoms, tops=tops,
            layer_height_mm=layer_height_mm,
            cell_area_mm2=cell_area_mm2,
            cross_section_mm2=cross_section_mm2,
        )
        if entry is None:
            continue
        per_filament.append(entry)
        total_volume_mm3 += entry.volume_mm3
        total_weight_g += entry.weight_g
        total_length_mm += entry.length_mm
        total_cost_usd += entry.cost_usd

    total_layers = int(np.max(layer_map)) if layer_map.size else 0
    total_time_minutes = _print_time_minutes(
        total_length_mm=total_length_mm,
        total_layers=total_layers,
        n_swaps=len(swap_layer_indices),
    )

    return CostEstimate(
        total_time_minutes=total_time_minutes,
        total_weight_g=total_weight_g,
        total_length_mm=total_length_mm,
        total_cost_usd=total_cost_usd,
        total_volume_mm3=total_volume_mm3,
        per_filament=per_filament,
    )

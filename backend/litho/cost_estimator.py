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
from typing import Any, Dict, List

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
    """
    h_px, w_px = layer_map.shape
    cell_area_mm2 = float(usable_width_mm * usable_height_mm) / float(h_px * w_px)

    # Disc geometry: zero-out cells outside the inscribed circle so we
    # don't overcount the print footprint.
    if shape == "disc":
        yy, xx = np.ogrid[:h_px, :w_px]
        cy, cx = (h_px - 1) / 2.0, (w_px - 1) / 2.0
        radius = min(h_px, w_px) / 2.0
        mask = ((yy - cy) ** 2 + (xx - cx) ** 2) <= (radius * radius)
        # Effective footprint is a circle inscribed in (usable_w × usable_h).
        # Adjust cell_area_mm2 down by (π/4) ratio if W==H, else use the
        # average. The cell area itself is unchanged for cells inside the
        # circle; we just suppress the out-of-circle cells.
        layer_map = np.where(mask, layer_map, 0).astype(layer_map.dtype)

    # Enforce base_min_layers floor (matches the exporter's behaviour).
    base_min_layers = max(1, int(base_min_layers))
    floored_lm = np.maximum(layer_map, base_min_layers).astype(np.float64)

    # If a cell is outside the print footprint (layer_map==0 after the
    # disc mask), keep it at zero — do NOT floor those.
    if shape == "disc":
        floored_lm = np.where(layer_map > 0, floored_lm, 0.0)

    cross_section_mm2 = math.pi * (FILAMENT_DIAMETER_MM / 2.0) ** 2

    # Slab boundaries:
    bottoms = [0] + list(swap_layer_indices)
    top_cap = int(np.max(layer_map)) + 1
    tops = list(swap_layer_indices) + [top_cap]
    n_slots = len(filaments)
    while len(bottoms) < n_slots:
        bottoms.append(top_cap)
    while len(tops) < n_slots:
        tops.append(top_cap)
    bottoms = bottoms[:n_slots]
    tops = tops[:n_slots]

    per_filament: List[FilamentCost] = []
    total_volume_mm3 = 0.0
    total_weight_g = 0.0
    total_length_mm = 0.0
    total_cost_usd = 0.0

    for k, fil in enumerate(filaments):
        if tops[k] <= bottoms[k]:
            continue
        # Slot k's contribution at each cell = clipped layer count × layer_h × cell_area
        source = floored_lm if k == 0 else layer_map.astype(np.float64)
        clipped = np.clip(source - bottoms[k], 0, tops[k] - bottoms[k])
        layer_count_for_slot = int(clipped.sum())
        if layer_count_for_slot == 0:
            continue
        volume_mm3 = float(clipped.sum()) * layer_height_mm * cell_area_mm2

        mat = _filament_material_key(getattr(fil, "name", ""))
        # Prefer an explicit price_per_kg_usd attached to the filament
        # (set by the swap simulator); otherwise fall back to brand-tier
        # pricing if a brand is available, else the material baseline.
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

        per_filament.append(FilamentCost(
            slot=k,
            name=getattr(fil, "name", f"slot {k}"),
            hex=getattr(fil, "hex", "#888888"),
            layers=int(tops[k] - bottoms[k]),
            volume_mm3=volume_mm3,
            weight_g=weight_g,
            length_mm=length_mm,
            cost_usd=cost_usd,
        ))
        total_volume_mm3 += volume_mm3
        total_weight_g += weight_g
        total_length_mm += length_mm
        total_cost_usd += cost_usd

    # Time = extrusion time + per-layer overhead + per-swap overhead.
    extrusion_seconds = total_length_mm / max(MM_FILAMENT_PER_SECOND, 0.1)
    total_layers = int(np.max(layer_map)) if layer_map.size else 0
    overhead_seconds = PER_LAYER_OVERHEAD_SEC * total_layers
    swap_seconds = SWAP_OVERHEAD_SEC * max(0, len(swap_layer_indices))
    total_seconds = extrusion_seconds + overhead_seconds + swap_seconds
    total_time_minutes = total_seconds / 60.0

    return CostEstimate(
        total_time_minutes=total_time_minutes,
        total_weight_g=total_weight_g,
        total_length_mm=total_length_mm,
        total_cost_usd=total_cost_usd,
        total_volume_mm3=total_volume_mm3,
        per_filament=per_filament,
    )

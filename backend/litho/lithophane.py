"""CMYKW Lithophane optimizer.

Converts a photograph into a per-pixel layer height-map using Beer-Lambert
filament transmission modeling and ΔE (CIE76) nearest-neighbour matching
in CIE Lab color space.

Pipeline
--------
1. Convert target image to sRGB float, then to Lab.
2. Build a stack of CMYKW filaments (user-configurable hex + Transmission
   Distance per channel). The stack order (bottom→top) is fixed per job and
   max_swaps+1 filaments are used.
3. Allocate `total_layers` across the chosen filaments using a histogram-
   based heuristic that reflects how much "presence" of each color the
   image needs.
4. For each discrete height 0..total_layers compute the simulated light
   output using Beer-Lambert: L_out = L_in * exp(-thickness / TD) per
   channel. This produces an RGB look-up table (LUT).
5. For every pixel pick the LUT entry with the smallest ΔE against the
   target. That index is the printed height for that pixel (in layers).
6. Return the layer map, rendered preview, color-swap heights, and stats.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import List, Tuple

import numpy as np
from PIL import Image
from skimage import color as skcolor


# ---------------------------------------------------------------------------
# Filament model
# ---------------------------------------------------------------------------

@dataclass
class Filament:
    """Filament description used by the optimizer."""

    name: str          # e.g. "Cyan"
    hex: str           # "#06b6d4"
    td: float          # transmission distance in mm (higher => more translucent)

    @property
    def rgb(self) -> np.ndarray:
        h = self.hex.lstrip("#")
        return np.array(
            [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)],
            dtype=np.float64,
        )


# Printing order: bottom of the print (first layer, closest to the build
# plate — the side facing the back-light) to top (the side facing the
# viewer). A photographer-oriented 6-filament set: we drop Cyan (its role
# is covered by the combination of Green and Blue) and add dedicated G and
# B so saturated foliage and skies are reproducible without subtractive
# muddying. W sits at the base so thin regions stay bright, K caps the
# thickest shadows.
DEFAULT_FILAMENTS: List[Filament] = [
    Filament("White",   "#f5f5f5", td=5.0),
    Filament("Yellow",  "#eab308", td=1.8),
    Filament("Orange",  "#f57f20", td=1.5),
    Filament("Red",     "#d01e32", td=1.2),
    Filament("Magenta", "#ec4899", td=1.5),
    Filament("Green",   "#2ea043", td=1.5),
    Filament("Blue",    "#1e45a8", td=1.3),
    Filament("Key",     "#111111", td=0.8),
]


# ---------------------------------------------------------------------------
# Beer-Lambert stack simulation
# ---------------------------------------------------------------------------

def _beer_lambert_transmission(filament: Filament, thickness_mm: float) -> np.ndarray:
    """Per-channel RGB transmittance (0..1) through `thickness_mm` of filament.

    Uses the standard photographic-filament approximation
        T_channel(t) = rgb_channel ** (t / TD)
    where TD is the transmission distance in mm at which the filament reaches
    its characteristic color. This naturally reproduces subtractive color
    mixing (cyan attenuates R, magenta attenuates G, yellow attenuates B) and
    keeps each channel independent."""
    rgb = np.clip(filament.rgb, 0.01, 1.0)  # avoid log(0)
    td = max(filament.td, 0.05)
    return rgb ** (thickness_mm / td)


def simulate_stack(
    layer_allocation: List[int],
    filaments: List[Filament],
    layer_height_mm: float,
) -> np.ndarray:
    """Return the RGB LUT (shape: [total_layers+1, 3]) of light transmitted
    through stacked layers from bottom up to each layer index.

    layer_allocation[i] = number of layers of filaments[i] (bottom to top).
    LUT[k] is the color seen when the printed height is k layers.
    """
    total = sum(layer_allocation)
    lut = np.ones((total + 1, 3), dtype=np.float64)  # start with white light
    current = np.ones(3, dtype=np.float64)
    idx = 0
    for fil, n_layers in zip(filaments, layer_allocation):
        t_per_layer = _beer_lambert_transmission(fil, layer_height_mm)
        for _ in range(n_layers):
            current = current * t_per_layer
            idx += 1
            lut[idx] = current
    return lut


# ---------------------------------------------------------------------------
# Layer allocation heuristic
# ---------------------------------------------------------------------------

def _filament_chroma(filaments: List[Filament]) -> np.ndarray:
    """Per-filament Lab chroma (sqrt(a^2 + b^2)). W and K ≈ 0, saturated
    primaries 50+."""
    fil_rgb = np.array([f.rgb for f in filaments])
    fil_lab = skcolor.rgb2lab(fil_rgb.reshape(-1, 1, 3)).reshape(-1, 3)
    return np.sqrt(fil_lab[:, 1] ** 2 + fil_lab[:, 2] ** 2)


def _clamp_to_caps(alloc: List[int], caps: List[int], total: int) -> List[int]:
    """Clamp each allocation entry to its TD cap, then redistribute the
    overflow to filaments that still have headroom (proportional to
    existing allocation so the visual mix is preserved).

    If no filament has headroom (e.g. caps too tight to hit `total`),
    the function gives up on the budget — the print will simply be
    slightly thinner than requested, which is the correct lithophane
    behavior rather than padding with opaque layers.
    """
    result = list(alloc)
    while True:
        overflow = sum(max(0, result[i] - caps[i]) for i in range(len(result)))
        if overflow == 0:
            break
        # Clamp every over-cap entry.
        for i in range(len(result)):
            result[i] = min(result[i], caps[i])
        # Redistribute overflow to filaments with headroom.
        headroom = [caps[i] - result[i] for i in range(len(result))]
        if sum(headroom) == 0:
            break
        total_curr = sum(result)
        needed = total - total_curr
        if needed <= 0:
            break
        # Weight by current allocation so dominant filaments soak up
        # the redistributed budget first.
        weights = np.array(result, dtype=np.float64) + 1e-6
        weights *= np.array(headroom, dtype=np.float64) > 0
        if weights.sum() == 0:
            break
        share = weights / weights.sum() * needed
        floors = np.floor(share).astype(int)
        for i in range(len(result)):
            add = min(floors[i], headroom[i])
            result[i] += int(add)
        # Distribute fractional leftovers to filaments still with headroom.
        fracs = share - floors
        order = np.argsort(-fracs)
        remaining = total - sum(result)
        for idx in order:
            if remaining <= 0:
                break
            if result[idx] < caps[idx]:
                result[idx] += 1
                remaining -= 1
        # If headroom hit zero for every filament we exit on next iteration.
        if remaining == sum(max(0, result[i] - caps[i]) for i in range(len(result))):
            break
    return result


def _stack_luminance(alloc: List[int], filaments: List[Filament], layer_height_mm: float) -> float:
    """Perceptual luminance (Rec.709 Y) of the deepest pixel after passing
    through the full layer stack. Returns 0..1 — 0.08 == 8% bright."""
    lut = simulate_stack(alloc, filaments, layer_height_mm)
    rgb = lut[-1]
    # Rec.709 luminance — matches what the eye sees as "brightness".
    return float(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2])


def _enforce_brightness_floor(
    alloc: List[int],
    filaments: List[Filament],
    layer_height_mm: float,
    min_brightness: float,
    min_per_color: int = 1,
    max_iterations: int = 200,
) -> List[int]:
    """Greedily swap opaque-filament layers for the highest-TD filament
    until predicted deepest-pixel brightness >= min_brightness, OR no
    progress can be made.

    Strategy each iteration:
      1. Pick the filament with the LOWEST TD whose alloc > min_per_color
         (this is the most opaque filament we're allowed to thin).
      2. Pick the filament with the HIGHEST TD whose alloc < td_cap
         (most translucent filament with room to grow — typically white).
      3. Move one layer from #1 → #2 and re-measure brightness.

    Stops when no source filament can be thinned OR no sink filament has
    headroom OR brightness target is met. The result is "the same total
    thickness, redistributed for maximum back-light".
    """
    if not filaments or sum(alloc) == 0:
        return alloc
    result = list(alloc)
    if _stack_luminance(result, filaments, layer_height_mm) >= min_brightness:
        return result
    # Sort filaments by TD ascending (most opaque first).
    by_td_asc = sorted(range(len(filaments)), key=lambda i: filaments[i].td)
    by_td_desc = list(reversed(by_td_asc))

    for _ in range(max_iterations):
        # Sink: highest-TD filament with headroom (cap from 1.5×TD to give
        # the optimizer some slack — exceeding 1.0×TD for high-TD whites
        # is fine because they're translucent anyway).
        sink_caps = _td_layer_caps(filaments, layer_height_mm, td_multiplier=1.5)
        sink = next(
            (i for i in by_td_desc if result[i] < sink_caps[i]),
            None,
        )
        # Source: lowest-TD filament with layers to spare (> min_per_color).
        source = next(
            (i for i in by_td_asc if result[i] > min_per_color and i != sink),
            None,
        )
        if sink is None or source is None:
            break
        result[source] -= 1
        result[sink] += 1
        if _stack_luminance(result, filaments, layer_height_mm) >= min_brightness:
            break
    return result



def _td_layer_caps(
    filaments: List[Filament],
    layer_height_mm: float,
    td_multiplier: float = 1.5,
) -> List[int]:
    """Per-filament max-layer cap derived from Transmission Distance.

    Beyond ~1.5×TD a filament has absorbed >75% of incident light per
    channel and additional layers only darken the print without
    changing the perceived hue. Capping each filament here is the
    single most important fix for back-lit lithophane brightness.

    Returns a list of integer caps (always >= min_per_color), one per
    input filament.
    """
    caps: List[int] = []
    for f in filaments:
        td = max(f.td, 0.05)
        raw = td_multiplier * td / max(layer_height_mm, 0.01)
        # Subtract a tiny epsilon before ceil so 0.8 * 1.5 / 0.08 = 15.0000…2
        # rounds to 15 (the mathematical answer), not 16.
        caps.append(max(1, int(math.ceil(raw - 1e-9))))
    return caps


def allocate_layers(
    image_rgb: np.ndarray,
    filaments: List[Filament],
    total_layers: int,
    min_per_color: int = 1,
    layer_height_mm: float = 0.08,
    td_cap_multiplier: float = 1.0,
    min_brightness: float = 0.08,
) -> List[int]:
    """Distribute `total_layers` across the provided filaments with a
    chroma-aware strategy.

    Neutral filaments (White, Key, Grey, etc.) only need a handful of layers
    to perform their luminance role — extra thickness there just wastes
    budget. Chromatic filaments need more layers to accumulate visible
    color density. We therefore:

    1. Cap W / K / very-low-chroma filaments at a small fixed budget
       (scaled with total thickness so very tall prints still leave room).
    2. Cap EVERY filament at ~td_cap_multiplier × TD layers — beyond
       that thickness the filament is fully saturated and additional
       layers only block back-light without changing color. Default
       1.5× matches HueForge's "max useful thickness" rule.
    3. Split the remaining layer budget among the chromatic filaments,
       weighted by how much each is actually "useful" for the image
       (histogram of nearest-filament match) boosted by its chroma so
       primaries aren't starved when the image has muted midtones.
    """
    n = len(filaments)
    if n == 0:
        return []

    td_caps = _td_layer_caps(filaments, layer_height_mm, td_cap_multiplier)

    if n * min_per_color >= total_layers:
        base = total_layers // n
        rem = total_layers - base * n
        alloc = [base] * n
        for i in range(rem):
            alloc[i] += 1
        # Even the even-split path must respect TD caps.
        return _clamp_to_caps(alloc, td_caps, total_layers)

    chroma = _filament_chroma(filaments)
    # Anything below this chroma (W, K, Grey, very muted) is treated as
    # neutral and capped.
    neutral_mask = chroma < 18.0

    # Neutral cap scales with total thickness: at 25 layers cap at 3 each,
    # at 50 layers cap at 5. Always at least `min_per_color`.
    neutral_cap = max(min_per_color, min(3 + total_layers // 25, total_layers // 3))

    # Nearest-filament histogram in Lab.
    img_lab = skcolor.rgb2lab(image_rgb.reshape(-1, 1, 3)).reshape(-1, 3)
    fil_rgb = np.array([f.rgb for f in filaments])
    fil_lab = skcolor.rgb2lab(fil_rgb.reshape(-1, 1, 3)).reshape(-1, 3)
    sample = img_lab[:: max(1, len(img_lab) // 20000)]
    d = np.linalg.norm(sample[:, None, :] - fil_lab[None, :, :], axis=-1)
    nearest = np.argmin(d, axis=1)
    counts = np.bincount(nearest, minlength=n).astype(np.float64)

    # Chroma boost: boost chromatic filaments' share so primaries don't
    # get starved when the image is mostly midtones.
    chroma_weight = 1.0 + chroma / 40.0
    weighted = counts * chroma_weight + counts.sum() * 0.03

    alloc = [min_per_color] * n
    remaining = total_layers - sum(alloc)

    # Phase 1: give neutral filaments at most (neutral_cap - min_per_color)
    # extra layers based on their histogram presence — bounded by TD cap.
    for i in range(n):
        if neutral_mask[i] and remaining > 0:
            extra = min(
                neutral_cap - min_per_color,
                td_caps[i] - alloc[i],
                max(0, int(round(weighted[i] / max(1e-9, weighted.sum())
                                 * total_layers))),
            )
            extra = max(0, min(extra, remaining))
            alloc[i] += extra
            remaining -= extra

    # Phase 2: distribute all remaining layers across chromatic filaments,
    # respecting per-filament TD caps so a single low-TD filament can't
    # snowball into a brightness-killing slab.
    chromatic_idx = [i for i in range(n) if not neutral_mask[i]]
    if chromatic_idx and remaining > 0:
        # Iterate: each pass spreads what we can, then re-checks caps.
        for _ in range(4):
            if remaining <= 0:
                break
            open_idx = [i for i in chromatic_idx if alloc[i] < td_caps[i]]
            if not open_idx:
                break
            w = weighted[open_idx]
            if w.sum() <= 0:
                per = max(1, remaining // len(open_idx))
                for i in open_idx:
                    take = min(per, td_caps[i] - alloc[i], remaining)
                    alloc[i] += take
                    remaining -= take
                    if remaining <= 0:
                        break
                continue
            raw = w / w.sum() * remaining
            for idx, i in enumerate(open_idx):
                want = int(math.floor(raw[idx]))
                take = min(want, td_caps[i] - alloc[i], remaining)
                alloc[i] += take
                remaining -= take
            # Distribute fractional leftovers greedily to filaments that
            # still have headroom.
            if remaining > 0:
                fracs = raw - np.floor(raw)
                order = np.argsort(-fracs)
                for k in order:
                    if remaining <= 0:
                        break
                    i = open_idx[int(k)]
                    if alloc[i] < td_caps[i]:
                        alloc[i] += 1
                        remaining -= 1

    # Phase 3: anything still left (e.g. chromatic caps all hit) goes to
    # whichever NEUTRAL filament still has headroom — preserves the
    # remaining budget without overshooting any single filament's TD.
    if remaining > 0:
        order = np.argsort(-weighted)
        guard = 0
        while remaining > 0 and guard < total_layers * 4:
            placed = False
            for i_arr in order:
                i = int(i_arr)
                if alloc[i] < td_caps[i]:
                    alloc[i] += 1
                    remaining -= 1
                    placed = True
                    if remaining <= 0:
                        break
            if not placed:
                # Every filament hit its TD cap. The print is now thinner
                # than the user asked for, which is the correct
                # behavior — better than an opaque slab.
                break
            guard += 1

    # Phase 4: brightness-floor enforcement. If the deepest pixel of the
    # stack would be darker than `min_brightness`, swap opaque layers for
    # the highest-TD filament until we hit the floor (or run out of swaps).
    if min_brightness > 0:
        alloc = _enforce_brightness_floor(
            alloc, filaments, layer_height_mm, min_brightness, min_per_color,
        )
    return alloc


# ---------------------------------------------------------------------------
# Main optimization
# ---------------------------------------------------------------------------

@dataclass
class OptimizeResult:
    layer_map: np.ndarray          # int array (H, W) of layer heights 0..total_layers
    rendered_rgb: np.ndarray       # float (H, W, 3) simulated output
    lut: np.ndarray                # (total_layers+1, 3) float
    layer_allocation: List[int]
    filaments: List[Filament]
    total_layers: int
    layer_height_mm: float
    delta_e_mean: float
    delta_e_p95: float
    swap_heights_mm: List[float]   # Z heights at which color changes
    swap_colors: List[str]         # hex of the color active *above* the swap
    light_throughput_pct: float = 0.0  # Predicted back-light brightness 0..100


def _evaluate_order(
    arr: np.ndarray,
    target_lab: np.ndarray,
    order: List[Filament],
    total_layers: int,
    layer_height_mm: float,
) -> Tuple[float, np.ndarray, np.ndarray, List[int], np.ndarray]:
    """Build LUT for `order` and match every pixel. Returns
    (mean_delta_e, layer_map_flat, min_d_flat, allocation, lut_clipped)."""
    allocation = allocate_layers(arr, order, total_layers, layer_height_mm=layer_height_mm)
    lut = simulate_stack(allocation, order, layer_height_mm)
    lut_clipped = np.clip(lut, 0.0, 1.0)
    lut_lab = skcolor.rgb2lab(lut_clipped.reshape(-1, 1, 3)).reshape(-1, 3)

    flat = target_lab.reshape(-1, 3)
    chunk = 16384
    layer_map_flat = np.empty(flat.shape[0], dtype=np.int32)
    min_d_flat = np.empty(flat.shape[0], dtype=np.float64)
    for start in range(0, flat.shape[0], chunk):
        end = min(start + chunk, flat.shape[0])
        d = np.linalg.norm(
            flat[start:end, None, :] - lut_lab[None, :, :], axis=-1
        )
        idx = np.argmin(d, axis=1)
        layer_map_flat[start:end] = idx
        min_d_flat[start:end] = d[np.arange(end - start), idx]
    return float(min_d_flat.mean()), layer_map_flat, min_d_flat, allocation, lut_clipped


from itertools import permutations


def _fast_mean_delta_e(
    sample_lab: np.ndarray,
    order: List[Filament],
    total_layers: int,
    layer_height_mm: float,
    allocation: List[int],
) -> float:
    """Fast order-ranking score combining mean and worst-case ΔE.

    Using pure mean favours muddy orderings that trade saturation for
    average fit; adding a p90 term pushes the search toward orderings that
    can *reach* the saturated endpoints of the image.
    """
    lut = simulate_stack(allocation, order, layer_height_mm)
    lut_clipped = np.clip(lut, 0.0, 1.0)
    lut_lab = skcolor.rgb2lab(lut_clipped.reshape(-1, 1, 3)).reshape(-1, 3)
    d = np.linalg.norm(sample_lab[:, None, :] - lut_lab[None, :, :], axis=-1)
    per_pixel = d.min(axis=1)
    return float(0.7 * per_pixel.mean() + 0.3 * np.percentile(per_pixel, 90))


_LUMINANCE_ENDPOINT_NAMES = {"White", "Key"}


def _generate_candidate_orders(base_palette: List[Filament]) -> List[List[Filament]]:
    """Generate physically-plausible stack orderings to search.

    If White and Key are both present we fix them at the luminance extremes
    (either W-bottom/K-top or K-bottom/W-top) and permute the remaining
    chromatic filaments. Otherwise we only try the user-supplied order.
    For 4+ middle filaments (e.g. 6-filament CMYKW+RGB) this generates
    48 candidates which is fast enough when evaluated on a small sample.
    """
    candidates: List[List[Filament]] = [list(base_palette)]

    names = [f.name for f in base_palette]
    if "White" in names and "Key" in names:
        w = next(f for f in base_palette if f.name == "White")
        k = next(f for f in base_palette if f.name == "Key")
        middle = [f for f in base_palette if f.name not in {"White", "Key"}]
        # Cap middle permutations to avoid blow-up beyond 6 chromatic fils.
        if len(middle) <= 5:
            for perm in permutations(middle):
                for order in (
                    [w] + list(perm) + [k],  # W base, K cap
                    [k] + list(perm) + [w],  # K base, W cap (dark-first)
                ):
                    if order not in candidates:
                        candidates.append(order)
    return candidates


def _median_filter_lab(lab: np.ndarray, radius: int) -> np.ndarray:
    """Per-channel 2D median filter on a Lab image. Returns a copy with
    smoothed channels — used by painting mode to suppress noise-induced
    speckling at filament-zone boundaries (chromatic simplification)."""
    if radius <= 0:
        return lab
    try:
        from scipy.ndimage import median_filter  # type: ignore
        out = np.empty_like(lab)
        size = (2 * radius + 1, 2 * radius + 1)
        for c in range(3):
            out[..., c] = median_filter(lab[..., c], size=size, mode="reflect")
        return out
    except Exception:
        # scipy isn't strictly required; fall back to a cheap box mean.
        from scipy.signal import convolve2d  # type: ignore
        k = np.ones((2 * radius + 1, 2 * radius + 1)) / float((2 * radius + 1) ** 2)
        out = np.empty_like(lab)
        for c in range(3):
            out[..., c] = convolve2d(lab[..., c], k, mode="same", boundary="symm")
        return out


def _optimize_painting(
    arr: np.ndarray,
    target_lab: np.ndarray,
    filaments: List[Filament],
    total_layers: int,
    layer_height_mm: float,
    relief: float,
    smoothing: float = 0.0,
    frame_px: int = 0,
) -> "OptimizeResult":
    """Painting mode: each pixel shows the single filament color nearest to
    its Lab target. No subtractive mixing; color fidelity is bounded by the
    palette itself. Stack is ordered dark→light bottom→top so dark regions
    recess and light regions rise as relief.

    `smoothing` (0..1) controls a Lab-space median pre-pass that softens
    speckled filament-zone boundaries on continuous photographs. 0 = off
    (faithful but speckly); 1 = strong (radius ~5px on 512px image).

    `frame_px` (>=0) draws an inset matboard frame `frame_px` pixels wide
    around the painted region. The frame is rendered with the brightest
    filament (top of the stack) at full thickness — the same look a real
    matboard gives a framed photo. Pixels inside the frame are unchanged.
    """
    # Pre-pass: chromatic simplification via per-channel median in Lab.
    if smoothing > 0:
        # Scale radius with the image's smaller dimension so the visual
        # effect is roughly resolution-independent.
        small_dim = min(target_lab.shape[:2])
        max_radius = max(1, small_dim // 100)  # ~5 px on a 500-px image
        radius = max(1, int(round(smoothing * max_radius)))
        target_lab = _median_filter_lab(target_lab, radius)

    n = len(filaments)
    # Sort filaments by Lab L* ascending (darkest first, lightest last).
    fil_lab = skcolor.rgb2lab(
        np.array([f.rgb for f in filaments]).reshape(-1, 1, 3)
    ).reshape(-1, 3)
    order_idx = np.argsort(fil_lab[:, 0])
    ordered = [filaments[i] for i in order_idx]
    ordered_lab = fil_lab[order_idx]

    # Allocate layers: equal zones by default, distributing remainder to
    # the brightest (top) filament so it has the most vertical head-room.
    base = total_layers // n
    remainder = total_layers - base * n
    allocation = [base] * n
    for i in range(remainder):
        allocation[-1 - i] += 1  # pad from the top
    # Guarantee at least 1 layer per filament (for printability).
    # (Trivially satisfied when base >= 1; covered for tiny stacks.)

    # Zone end-indices (1-based, cumulative).
    zone_end = np.cumsum(allocation)  # (n,)
    zone_start = np.concatenate([[0], zone_end[:-1]])  # (n,)

    # Nearest filament per pixel in Lab.
    flat = target_lab.reshape(-1, 3)
    chunk = 32768
    nearest = np.empty(flat.shape[0], dtype=np.int32)
    min_d = np.empty(flat.shape[0], dtype=np.float64)
    for start in range(0, flat.shape[0], chunk):
        end = min(start + chunk, flat.shape[0])
        d = np.linalg.norm(
            flat[start:end, None, :] - ordered_lab[None, :, :], axis=-1
        )
        idx = np.argmin(d, axis=1)
        nearest[start:end] = idx
        min_d[start:end] = d[np.arange(end - start), idx]

    # Pixel height within its filament's zone: relief modulated by the
    # pixel's normalised luminance relative to the filament's own L*.
    zone_h = np.array(allocation)[nearest]  # (N,)
    zs = zone_start[nearest]
    L = flat[:, 0] / 100.0
    # Centered on the filament's own L* so its natural tone sits mid-zone.
    fil_L = ordered_lab[nearest, 0] / 100.0
    delta_L = np.clip(L - fil_L, -0.5, 0.5)  # -0.5 (darker) .. +0.5 (lighter)
    # Map to [0..zone_h-1] with relief control.
    offset = (0.5 + delta_L) * (zone_h - 1) * relief + (zone_h - 1) * (1 - relief)
    offset = np.clip(np.round(offset), 0, zone_h - 1).astype(np.int32)
    layer_map_flat = zs + offset

    layer_map = layer_map_flat.reshape(arr.shape[:2]).astype(np.int32)

    # Rendered preview: each pixel shows its chosen filament's RGB.
    fil_rgb = np.array([f.rgb for f in ordered])
    rendered = fil_rgb[nearest].reshape(arr.shape)

    # Matboard frame: paint a `frame_px`-wide border around the print
    # using the brightest filament at full stack height. We pick the
    # top-of-stack filament because matboards are traditionally a light
    # neutral (cream / white) and that's where bright filaments end up
    # in the dark→light ordering above.
    if frame_px > 0:
        h_px, w_px = layer_map.shape
        fp = min(frame_px, h_px // 2, w_px // 2)
        if fp > 0:
            # frame_idx points to the brightest filament in the ordered
            # stack (highest L*) — that's the last entry since sorting
            # was ascending by L*.
            frame_idx = n - 1
            frame_top = int(zone_end[frame_idx] - 1)
            frame_rgb = fil_rgb[frame_idx]
            mask = np.zeros((h_px, w_px), dtype=bool)
            mask[:fp, :] = True
            mask[-fp:, :] = True
            mask[:, :fp] = True
            mask[:, -fp:] = True
            layer_map = np.where(mask, frame_top, layer_map).astype(np.int32)
            rendered = np.where(mask[:, :, None], frame_rgb, rendered)

    # Build LUT-equivalent for downstream consumers (preview PNG helper etc).
    # In painting mode the "LUT" is just the palette repeated per zone layer;
    # a compact version suffices.
    lut = np.zeros((total_layers + 1, 3), dtype=np.float64)
    for i in range(n):
        lut[zone_start[i]: zone_end[i]] = fil_rgb[i]
    lut[-1] = fil_rgb[-1]  # cap
    lut_clipped = np.clip(lut, 0.0, 1.0)

    swap_heights: List[float] = []
    swap_colors: List[str] = []
    z = 0.0
    for fil, nlayers in zip(ordered, allocation):
        swap_heights.append(round(z, 4))
        swap_colors.append(fil.hex)
        z += nlayers * layer_height_mm

    return OptimizeResult(
        layer_map=layer_map,
        rendered_rgb=rendered,
        lut=lut_clipped,
        layer_allocation=list(allocation),
        filaments=ordered,
        total_layers=total_layers,
        layer_height_mm=layer_height_mm,
        delta_e_mean=float(min_d.mean()),
        delta_e_p95=float(np.percentile(min_d, 95)),
        swap_heights_mm=swap_heights,
        swap_colors=swap_colors,
        light_throughput_pct=100.0 * _stack_luminance(list(allocation), ordered, layer_height_mm),
    )


def optimize(
    image: Image.Image,
    filaments: List[Filament],
    layer_height_mm: float,
    total_thickness_mm: float,
    max_swaps: int,
    max_dimension_px: int = 512,
    auto_order: bool = True,
    render_mode: str = "lithophane",
    relief: float = 0.5,
    smoothing: float = 0.0,
    frame_mm: float = 0.0,
    frame_target_mm: float = 100.0,
) -> OptimizeResult:
    """Optimize a photograph into either a back-lit lithophane (subtractive
    Beer-Lambert) or a reflective painting (nearest-filament mapping).

    `render_mode`:
        "lithophane" — stacked color from transmitted light (default)
        "painting"   — each pixel shows one filament's reflective color

    `relief` (painting mode only): 0 = flat plateaus per color region,
    1 = within-zone height modulated by pixel luminance for bas-relief
    texture.
    """

    # Down-sample for speed while preserving aspect.
    img = image.convert("RGB")
    w, h = img.size
    scale = max(w, h) / max_dimension_px
    if scale > 1:
        img = img.resize(
            (max(1, int(w / scale)), max(1, int(h / scale))), Image.LANCZOS
        )
    arr = np.asarray(img, dtype=np.float64) / 255.0  # (H, W, 3)
    target_lab = skcolor.rgb2lab(arr)

    # Constrain filaments to max_swaps+1.
    n_filaments = min(len(filaments), max_swaps + 1)
    base_palette = filaments[:n_filaments]
    total_layers = max(1, int(round(total_thickness_mm / layer_height_mm)))

    if render_mode == "painting":
        # Translate frame_mm to a pixel count using the down-sampled
        # array's pixels-per-mm. `frame_target_mm` is the print's
        # shorter usable side in mm — passed from server.py so the
        # frame width on screen matches the printed dimensions.
        frame_px = 0
        if frame_mm > 0 and frame_target_mm > 0:
            pixels_per_mm = min(arr.shape[:2]) / max(1.0, frame_target_mm)
            frame_px = max(1, int(round(frame_mm * pixels_per_mm)))
        return _optimize_painting(
            arr, target_lab, base_palette, total_layers, layer_height_mm,
            relief, smoothing, frame_px,
        )

    # Always use one allocation (histogram-based on the user's palette).
    # Allocation is a function of the palette, not the order.
    allocation = allocate_layers(
        arr, base_palette, total_layers,
        layer_height_mm=layer_height_mm,
    )

    if auto_order:
        candidates = _generate_candidate_orders(base_palette)
        # Use a sampled pixel set to rank candidates cheaply.
        flat_lab = target_lab.reshape(-1, 3)
        sample_size = min(4096, flat_lab.shape[0])
        step = max(1, flat_lab.shape[0] // sample_size)
        sample_lab = flat_lab[::step][:sample_size]

        best_order = base_palette
        best_mean = float("inf")
        for cand in candidates:
            # Reallocate per candidate since ordering affects which layers
            # get assigned to which filament under the heuristic (it
            # actually does not — allocate_layers doesn't depend on order —
            # but pairing is clearer this way and cheap).
            m = _fast_mean_delta_e(
                sample_lab, cand, total_layers, layer_height_mm, allocation
            )
            if m < best_mean:
                best_mean = m
                best_order = cand
        used_filaments = best_order
    else:
        used_filaments = list(base_palette)

    # Full-resolution evaluation of the chosen order.
    _, layer_map_flat, min_d_flat, allocation, lut_clipped = _evaluate_order(
        arr, target_lab, used_filaments, total_layers, layer_height_mm
    )
    layer_map = layer_map_flat.reshape(arr.shape[:2]).astype(np.int32)
    rendered = lut_clipped[layer_map_flat].reshape(arr.shape)

    # Swap heights (Z at which filament changes, from bottom).
    swap_heights: List[float] = []
    swap_colors: List[str] = []
    z = 0.0
    for fil, nlayers in zip(used_filaments, allocation):
        swap_heights.append(round(z, 4))
        swap_colors.append(fil.hex)
        z += nlayers * layer_height_mm

    return OptimizeResult(
        layer_map=layer_map,
        rendered_rgb=rendered,
        lut=lut_clipped,
        layer_allocation=allocation,
        filaments=used_filaments,
        total_layers=total_layers,
        layer_height_mm=layer_height_mm,
        delta_e_mean=float(min_d_flat.mean()),
        delta_e_p95=float(np.percentile(min_d_flat, 95)),
        swap_heights_mm=swap_heights,
        swap_colors=swap_colors,
        light_throughput_pct=100.0 * _stack_luminance(list(allocation), used_filaments, layer_height_mm),
    )


# ---------------------------------------------------------------------------
# Preview PNG helper
# ---------------------------------------------------------------------------

def rendered_to_png_bytes(rendered_rgb: np.ndarray) -> bytes:
    arr = np.clip(rendered_rgb * 255.0, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def layer_map_to_png_bytes(layer_map: np.ndarray, total_layers: int) -> bytes:
    """Visualize the heightmap as a grey-scale image (brighter = thicker)."""
    arr = (layer_map.astype(np.float64) / max(1, total_layers) * 255.0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG", optimize=True)
    return buf.getvalue()

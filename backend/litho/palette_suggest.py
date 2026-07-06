"""Photography-oriented filament library + palette suggestion.

Given an image, suggest a 6-filament palette that actually expands the
reachable gamut for the picture. The selector always seeds with White and
Key (luminance endpoints) and then picks chromatic filaments using a
combined score that rewards:

* how many image pixels become better-matched (ΔE_mean reduction), and
* how *saturated* the filament is (Lab chroma) so primaries get real
  consideration even when a photo is dominated by muted midtones.

It also caps neutral library entries (W, K, Grey, Brown …) at 3 of the 6
slots so you always end up with at least 3 chromatic filaments extending
the gamut.
"""

from __future__ import annotations

from typing import List

import numpy as np
from PIL import Image
from skimage import color as skcolor

from .lithophane import Filament


FILAMENT_LIBRARY: List[Filament] = [
    Filament("White",      "#f5f5f5", td=5.0),
    Filament("Cream",      "#f2e7c3", td=4.5),
    Filament("Skin",       "#e8b998", td=3.8),
    Filament("Yellow",     "#eab308", td=1.8),
    Filament("Orange",     "#f57f20", td=1.5),
    Filament("Red",        "#d01e32", td=1.2),
    Filament("Pink",       "#f08a9c", td=2.5),
    Filament("Magenta",    "#ec4899", td=1.5),
    Filament("Purple",     "#6d28d9", td=1.2),
    Filament("Blue",       "#1e45a8", td=1.3),
    Filament("Cyan",       "#06b6d4", td=1.5),
    Filament("Teal",       "#0f766e", td=1.3),
    Filament("Green",      "#2ea043", td=1.5),
    Filament("Olive",      "#556b1e", td=1.4),
    Filament("Brown",      "#78350f", td=1.0),
    Filament("Grey",       "#6b7280", td=1.5),
    Filament("Key",        "#111111", td=0.8),
]


# Filaments considered "neutral" for palette-balance purposes (low chroma).
_NEUTRAL_NAMES = {"White", "Cream", "Grey", "Brown", "Key"}


def _sample_image_lab(image: Image.Image, max_samples: int = 4096) -> np.ndarray:
    img = image.convert("RGB")
    img.thumbnail((256, 256))
    arr = np.asarray(img, dtype=np.float64) / 255.0
    lab = skcolor.rgb2lab(arr).reshape(-1, 3)
    if lab.shape[0] > max_samples:
        step = max(1, lab.shape[0] // max_samples)
        lab = lab[::step][:max_samples]
    return lab


def _filaments_to_lab(filaments: List[Filament]) -> np.ndarray:
    rgb = np.array([f.rgb for f in filaments])
    return skcolor.rgb2lab(rgb.reshape(-1, 1, 3)).reshape(-1, 3)


def _chroma(lab: np.ndarray) -> np.ndarray:
    return np.sqrt(lab[..., 1] ** 2 + lab[..., 2] ** 2)


def _hue_angle(lab: np.ndarray) -> np.ndarray:
    """Hue angle in radians, atan2(b, a). Returns shape lab.shape[:-1]."""
    return np.arctan2(lab[..., 2], lab[..., 1])


def _hue_wheel_gap(angle: float, taken: np.ndarray) -> float:
    """Smallest angular distance (radians, 0..pi) from `angle` to any of
    the already-selected hue angles. Returns pi when nothing is selected
    so the first chromatic pick is unconstrained."""
    if taken.size == 0:
        return np.pi
    diff = np.abs(angle - taken)
    diff = np.minimum(diff, 2 * np.pi - diff)
    return float(diff.min())


def suggest_palette(
    image: Image.Image,
    palette_size: int = 6,
    include_white: bool = True,
    include_key: bool = True,
    max_neutral_slots: int = 3,
    vibrancy: float = 0.0,
) -> List[Filament]:
    """Greedy forward-selection with chroma + hue-wheel coverage bonus.

    `vibrancy` in [0, 1]:
        0.0 → pure ΔE minimization (accurate muted tones)
        1.0 → strong hue-wheel-coverage bias (distinct punchy hues)
    Intermediate values blend the two. At high vibrancy the selector
    favours filaments whose hue angle (atan2(b*, a*)) sits farthest from
    every already-picked chromatic filament — guaranteeing primary
    accents are spread around the wheel rather than clustering near the
    image's dominant hue family.
    """
    sample_lab = _sample_image_lab(image)
    library = list(FILAMENT_LIBRARY)
    library_lab = _filaments_to_lab(library)
    library_chroma = _chroma(library_lab)
    library_hue = _hue_angle(library_lab)
    name_idx = {f.name: i for i, f in enumerate(library)}

    selected: List[int] = []
    if include_white:
        selected.append(name_idx["White"])
    if include_key:
        selected.append(name_idx["Key"])

    if selected:
        d = np.linalg.norm(
            sample_lab[:, None, :] - library_lab[selected][None, :, :], axis=-1
        )
        nearest_d = d.min(axis=1)
    else:
        nearest_d = np.full(sample_lab.shape[0], 1e9)

    # At high vibrancy the chroma bonus dominates and hue-wheel gap
    # ensures the picks cover distinct sectors of the color wheel.
    chroma_bonus_weight = 0.05 + 0.35 * vibrancy
    hue_gap_weight = 0.0 + 1.0 * vibrancy
    # Minimum chroma to count a filament as "chromatic" when measuring
    # hue-wheel coverage. Neutrals would otherwise wildly skew the angle.
    CHROMA_THRESH = 12.0

    def neutral_count(sel: List[int]) -> int:
        return sum(1 for i in sel if library[i].name in _NEUTRAL_NAMES)

    while len(selected) < palette_size:
        best_score = -1e9
        best_idx = -1
        current_neutrals = neutral_count(selected)
        chromatic_idx = [
            i for i in selected if library_chroma[i] >= CHROMA_THRESH
        ]
        taken_hues = library_hue[chromatic_idx] if chromatic_idx else np.array([])

        for cand in range(len(library)):
            if cand in selected:
                continue
            is_neutral = library[cand].name in _NEUTRAL_NAMES
            if is_neutral and current_neutrals >= max_neutral_slots:
                continue

            cand_d = np.linalg.norm(sample_lab - library_lab[cand], axis=-1)
            merged = np.minimum(nearest_d, cand_d)
            delta_e_gain = nearest_d.mean() - merged.mean()

            chroma_bonus = library_chroma[cand] * chroma_bonus_weight

            # Hue-wheel coverage: only meaningful for chromatic candidates.
            if library_chroma[cand] >= CHROMA_THRESH:
                gap = _hue_wheel_gap(library_hue[cand], taken_hues)
                # Normalize gap to 0..1 (pi = max possible gap), then weight
                # by candidate chroma so saturated outliers win over muted
                # ones at the same angular distance.
                hue_bonus = (
                    (gap / np.pi)
                    * (library_chroma[cand] / 60.0)
                    * hue_gap_weight
                    * 25.0
                )
            else:
                hue_bonus = 0.0

            score = delta_e_gain + chroma_bonus + hue_bonus
            if score > best_score:
                best_score = score
                best_idx = cand

        if best_idx == -1:
            break
        selected.append(best_idx)
        cand_d = np.linalg.norm(sample_lab - library_lab[best_idx], axis=-1)
        nearest_d = np.minimum(nearest_d, cand_d)

    chosen = [library[i] for i in selected]

    # Order bottom→top: White first, Key last, chromatic ordered by a mix of
    # descending L* so warm highlights come first after W and deeper cools
    # sit nearer K.
    w = next((f for f in chosen if f.name == "White"), None)
    k = next((f for f in chosen if f.name == "Key"), None)
    middle = [f for f in chosen if f.name not in {"White", "Key"}]
    if middle:
        mid_lab = _filaments_to_lab(middle)
        order = sorted(range(len(middle)), key=lambda i: -mid_lab[i, 0])
        middle = [middle[i] for i in order]

    result: List[Filament] = []
    if w is not None:
        result.append(w)
    result.extend(middle)
    if k is not None:
        result.append(k)
    return result

"""Shared primitives for ForgeSlicer voice-template builders.

A "step" is one atomic CAD operation. Templates emit ordered lists of
steps; the frontend Plan Preview shows them and the executor runs them
as a single undo group.

Step schemas — strict so the frontend can validate before running.

    {"action": "add",
     "type": "cube"|"sphere"|"cylinder"|"cone"|"torus"|"polygon"|"circle"|"square2d"|"triangle"|"text",
     "modifier": "positive"|"negative",
     "dims": {...},                           # per primitive type
     "position": [x, y, z],                   # mm
     "rotation": [x, y, z],                   # degrees, Euler XYZ
     "tag": "string_handle",                  # optional; lets later steps refer to it
     "note": "Human-readable description"}

    {"action": "boolean",
     "op": "union"|"subtract"|"intersect",
     "targets": ["all-positives"|"all-since:<tag>"|"tag:<tag>"|"step:<index>"],
     "note": "..."}

    {"action": "group",
     "name": "Assembly",
     "targets": [...same selector grammar],
     "note": "..."}

Selector grammar resolved by the frontend executor — kept declarative
so the backend templates don't have to know the live scene state.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def step_add(
    type: str,
    *,
    dims: Dict[str, float],
    modifier: str = "positive",
    position: Optional[List[float]] = None,
    rotation: Optional[List[float]] = None,
    tag: Optional[str] = None,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Build an `add` step. Defaults: positive modifier, origin position,
    zero rotation."""
    step: Dict[str, Any] = {
        "action": "add",
        "type": type,
        "modifier": modifier,
        "dims": dict(dims),
        "position": list(position or [0.0, 0.0, 0.0]),
        "rotation": list(rotation or [0.0, 0.0, 0.0]),
    }
    if tag:
        step["tag"] = tag
    if note:
        step["note"] = note
    return step


def step_boolean(
    op: str,
    *,
    targets: List[str],
    note: Optional[str] = None,
) -> Dict[str, Any]:
    s: Dict[str, Any] = {"action": "boolean", "op": op, "targets": list(targets)}
    if note:
        s["note"] = note
    return s


def step_group(
    name: str,
    *,
    targets: List[str],
    note: Optional[str] = None,
) -> Dict[str, Any]:
    s: Dict[str, Any] = {"action": "group", "name": name, "targets": list(targets)}
    if note:
        s["note"] = note
    return s


# Unit helpers — templates accept inches OR mm and normalise to mm.
def to_mm(value: float, unit: str) -> float:
    """Convert a numeric value+unit to millimetres."""
    u = (unit or "mm").lower()
    if u in ("mm", "millimetre", "millimeter", "millimetres", "millimeters"):
        return float(value)
    if u in ("cm", "centimetre", "centimeter"):
        return float(value) * 10.0
    if u in ("in", "inch", "inches", "\""):
        return float(value) * 25.4
    if u in ("ft", "foot", "feet", "'"):
        return float(value) * 304.8
    raise ValueError(f"Unsupported unit: {unit!r}")


def kg_from(value: float, unit: str) -> float:
    """Convert a load value+unit to kilograms (for engineering tables)."""
    u = (unit or "kg").lower()
    if u in ("kg", "kilogram", "kilograms"):
        return float(value)
    if u in ("g", "gram", "grams"):
        return float(value) / 1000.0
    if u in ("lb", "lbs", "lbf", "pound", "pounds", "#"):
        return float(value) * 0.4535924
    if u in ("oz", "ounce", "ounces"):
        return float(value) * 0.02834952
    raise ValueError(f"Unsupported load unit: {unit!r}")

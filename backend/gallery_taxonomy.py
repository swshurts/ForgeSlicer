"""Gallery taxonomy — shared categories for Designs and Components.

Why this lives in its own module:
    The category list is referenced in three places (the create/meta
    Pydantic models, the list filter validator, and the backfill
    migration on startup). Putting it in one file means a new
    category gets added by changing exactly one constant; the rest
    falls in line.

The taxonomy was chosen to match how *beginner makers* describe what
they're building — these are the categories Etsy/Printables/Thingiverse
buyers actually search for. Internal engineering categories (gears,
hinges, brackets) live underneath "tools" / "replacement-parts" so the
top-level remains shoppable.
"""
from __future__ import annotations

import re
from typing import Final, List, Tuple


# Stable ids (used in DB + URL params) → human labels for the UI.
# Order here is the order the chips render — most-shoppable first.
CATEGORIES: Final[List[Tuple[str, str]]] = [
    ("household",        "Household"),
    ("tools",            "Tools"),
    ("organizers",       "Organizers"),
    ("replacement_parts", "Replacement Parts"),
    ("toys",             "Toys"),
    ("education",        "Education"),
    ("cosplay",          "Cosplay"),
    ("mechanical",       "Mechanical"),
    ("decorative",       "Decorative"),
    ("misc",             "Misc"),
]
CATEGORY_IDS: Final[set] = {cid for cid, _ in CATEGORIES}

# Default falls back to "misc" so legacy and unspecified items stay in
# the "All" view but don't surface in any specific category page.
DEFAULT_CATEGORY: Final[str] = "misc"


def is_valid_category(cid: str) -> bool:
    return cid in CATEGORY_IDS


def normalise_tag(tag: str) -> str:
    """Lower-case, trimmed, alphanumeric+dash, capped at 24 chars."""
    cleaned = re.sub(r"[^a-z0-9-]+", "-", tag.strip().lower())
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned[:24]


# ─── Backfill heuristics ──────────────────────────────────────────
# Maps a regex (matched against the design name, case-insensitive)
# to the category to assign. First match wins, so order matters —
# more specific patterns first.
#
# This is intentionally lenient: a few false positives are fine
# because owners can re-categorise with one click in the Save dialog.
# The goal is ~85% useful guesses so visitors don't see a Gallery
# full of "Misc" tiles on day one.
_BACKFILL_RULES: Final[List[Tuple[re.Pattern, str]]] = [
    # Replacement parts — call out FIRST so "replacement knob" doesn't
    # get caught by the knob/handle rule below.
    (re.compile(r"\breplac(e|ement|ing)?\b",       re.I), "replacement_parts"),
    (re.compile(r"\b(missing|broken|spare)\b",      re.I), "replacement_parts"),

    # Cosplay first too — props can otherwise look like toys.
    (re.compile(r"\b(cosplay|costume|prop|armor|armour|helmet|mask|sword|shield|wand|saber|lightsaber|larp)\b", re.I), "cosplay"),

    # Education / STEM kits, anatomy models, planet displays etc.
    (re.compile(r"\b(stem|education|anatomy|atom|molecul|cell|planet|globe|skull|skeleton|microscope|abacus|math|geometr(y|ic)?\s+(model|set|tile)|puzzle)\b", re.I), "education"),

    # Toys — wheels, figures, action poses, dice, animals.
    (re.compile(r"\b(toy|figur(e|ine)|dice|d20|wheel|car|robot|train|plane|helicopter|truck|boat|dragon|dinosaur|monster|action|dollhouse|playset|fidget|spinner|squishy)\b", re.I), "toys"),

    # Organizers / storage / trays / racks.
    (re.compile(r"\b(organiz(er|ation)?|tray|bin|drawer|caddy|holder|rack|stand|shelf|sorter|divider|compartment)\b", re.I), "organizers"),

    # Tools — wrenches, jigs, gauges, calipers, vises.
    (re.compile(r"\b(tool|wrench|gauge|jig|vise|vice|caliper|punch|sander|template|fixture|clamp|bit|socket|drill|plier)\b", re.I), "tools"),

    # Mechanical — gears, bearings, hinges, brackets, mounts, mechanisms.
    (re.compile(r"\b(gear|bearing|hinge|bracket|mount|cam|cog|sprocket|pulley|coupler|joint|axle|spring|linkage|mechan(ism|ical))\b", re.I), "mechanical"),

    # Household — hooks, pegs, knobs, kitchen, bathroom.
    (re.compile(r"\b(hook|peg|knob|handle|coaster|napkin|kitchen|bathroom|soap|spice|jar|bottle|cup|mug|bowl|plate|cabinet|door|window|fridge|cable[- ]clip|cable[- ]?manage|wall[- ]?spacer)\b", re.I), "household"),

    # Decorative — vase, planter, art, sculpture, light, lamp.
    (re.compile(r"\b(vase|planter|sculpture|art|decor|lamp|light|lithophane|frame|ornament|figurine|statue|bust)\b", re.I), "decorative"),
]


def guess_category(name: str | None) -> str:
    """Pick a category from a design's name. Returns DEFAULT_CATEGORY
    when nothing matches. Pure function — safe to call from a
    backfill migration without side-effects."""
    if not name:
        return DEFAULT_CATEGORY
    for pattern, cid in _BACKFILL_RULES:
        if pattern.search(name):
            return cid
    return DEFAULT_CATEGORY


def guess_tags(name: str | None, limit: int = 4) -> List[str]:
    """Extract a handful of useful tags from the design name. The
    heuristic is dumb-on-purpose: every meaningful word (≥3 chars,
    not a stop-word) becomes a tag, deduped, capped at `limit`. Owners
    refine these in the Save dialog later."""
    if not name:
        return []
    stop = {
        "the", "and", "for", "with", "from", "into", "your", "this",
        "that", "are", "but", "not", "you", "all", "any", "can",
        "new", "old", "use", "out",
    }
    seen, out = set(), []
    for raw in re.split(r"[^A-Za-z0-9]+", name):
        t = normalise_tag(raw)
        if not t or len(t) < 3 or t in stop or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= limit:
            break
    return out

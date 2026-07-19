"""Shared taxonomy-backfill logic used by BOTH:
  * ``scripts/backfill_gallery_categories.py`` (operator CLI, dry-run
    or apply, works locally against MONGO_URL from .env)
  * ``/api/admin/taxonomy-backfill`` (admin HTTP endpoint — same logic,
    against the running server's Mongo. Lets an operator dry-run
    against production without shell access.)

Keeping this in one place ensures the CLI and the HTTP endpoint can
never disagree on which docs are eligible or how they're re-classified.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

import gallery_taxonomy


async def process_collection(
    coll,
    *,
    label: str,
    apply: bool,
    limit: int = 5000,
) -> tuple[int, Counter]:
    """Scan ``coll`` for docs whose ``category`` is missing OR not in
    the current ``gallery_taxonomy.CATEGORY_IDS`` set. Returns
    ``(num_matched, remap_counter)`` where ``remap_counter`` tallies
    ``(old, new)`` → count so a dry-run can print a useful summary.

    When ``apply`` is True we write the new category + tags via
    per-document updates (never bulk — legacy docs may need slightly
    different handling of ``is_featured`` on gallery items).

    Idempotent: once every doc has a valid category, subsequent runs
    match 0 documents.
    """
    valid = list(gallery_taxonomy.CATEGORY_IDS)
    match_filter: dict[str, Any] = {
        "$or": [
            {"category": {"$exists": False}},
            {"category": {"$nin": valid}},
        ],
    }
    cursor = coll.find(
        match_filter,
        {"_id": 0, "id": 1, "name": 1, "category": 1},
    ).limit(limit)

    remaps: Counter = Counter()
    matched = 0
    async for doc in cursor:
        old = doc.get("category") or "(none)"
        new = gallery_taxonomy.guess_category(doc.get("name"))
        remaps[(old, new)] += 1
        matched += 1
        if apply:
            tags = gallery_taxonomy.guess_tags(doc.get("name"))
            update = {"category": new, "tags": tags}
            if label == "gallery":
                # Preserve existing ``is_featured`` values; only set
                # ``False`` when the field is absent (legacy schema).
                await coll.update_one(
                    {"id": doc["id"], "is_featured": {"$exists": False}},
                    {"$set": {**update, "is_featured": False}},
                )
                await coll.update_one(
                    {"id": doc["id"], "is_featured": {"$exists": True}},
                    {"$set": update},
                )
            else:
                await coll.update_one({"id": doc["id"]}, {"$set": update})
    return matched, remaps


def summarise(matched: int, remaps: Counter) -> dict:
    """Serialise ``process_collection``'s result into a JSON-friendly
    shape for the admin endpoint."""
    return {
        "matched": int(matched),
        "remaps": [
            {"old": old, "new": new, "count": int(n)}
            for (old, new), n in sorted(remaps.items(), key=lambda kv: -kv[1])
        ],
    }

"""Standalone one-shot backfill for gallery + components taxonomy.

The same logic runs at server startup (see ``backfill_gallery_categories``
in ``server.py``), but this script lets an operator:
  * dry-run against a staging DB and see the proposed re-classifications
    before writing anything;
  * apply the migration on demand without restarting the API pod;
  * verify how many legacy documents got re-tagged after a deploy.

Usage:
    # Dry run — prints the plan, writes nothing.
    python -m scripts.backfill_gallery_categories --dry-run

    # Apply the plan.
    python -m scripts.backfill_gallery_categories --apply

    # Restrict to one collection.
    python -m scripts.backfill_gallery_categories --apply --only gallery
    python -m scripts.backfill_gallery_categories --apply --only components

Env: reads ``MONGO_URL`` + ``DB_NAME`` from the backend .env exactly like
the server does — no separate config needed.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections import Counter
from pathlib import Path

# Make the parent (backend/) importable when this file is run as
# ``python -m scripts.backfill_gallery_categories`` OR bare
# ``python scripts/backfill_gallery_categories.py``.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import gallery_taxonomy  # noqa: E402,F401  (imported for side-effect / CATEGORY_IDS sanity)
from taxonomy_backfill import process_collection  # noqa: E402

# Load /app/backend/.env from the repo root so MONGO_URL / DB_NAME
# resolve identically to server.py.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def print_summary(label: str, matched: int, remaps: Counter) -> None:
    print(f"\n=== {label} ({matched} docs matched) ===")
    if not remaps:
        print("  nothing to migrate")
        return
    for (old, new), n in sorted(remaps.items(), key=lambda kv: -kv[1]):
        arrow = "→" if old != new else "="
        print(f"  {n:5d}  {old!r:24s} {arrow} {new!r}")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write updates to Mongo. Without this flag we only print the plan.")
    parser.add_argument("--dry-run", action="store_true", help="Explicit dry-run (default when --apply is absent).")
    parser.add_argument(
        "--only", choices=["gallery", "components"], default=None,
        help="Restrict the migration to one collection.",
    )
    args = parser.parse_args()

    if args.apply and args.dry_run:
        parser.error("--apply and --dry-run are mutually exclusive")

    apply = args.apply and not args.dry_run
    mode = "APPLY (writing)" if apply else "DRY-RUN (no writes)"

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("MONGO_URL and DB_NAME must be set in backend/.env", file=sys.stderr)
        return 2

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    print(f"[{mode}] target db: {db_name}")

    total_matched = 0
    if args.only in (None, "gallery"):
        m, r = await process_collection(db.gallery, label="gallery", apply=apply)
        print_summary("db.gallery", m, r)
        total_matched += m
    if args.only in (None, "components"):
        m, r = await process_collection(db.components, label="components", apply=apply)
        print_summary("db.components", m, r)
        total_matched += m

    print(f"\nTotal matched: {total_matched}")
    if apply:
        print("Applied. Re-run in dry-run mode to confirm all docs are on the new taxonomy.")
    else:
        print("Dry-run only. Re-run with --apply to write the changes.")
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

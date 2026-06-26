"""Release-info endpoints.

Single source of truth for the "current iteration" string displayed in
the frontend. Parses `/app/memory/CHANGELOG.md` server-side for the
newest `## Iteration X.Y` heading and serves it to the workspace.

Why this exists
---------------
The user has flagged a recurring "iter label is stale" bug multiple
times — the previous mechanism was a hand-edited constant in
`lib/iterLabel.js` that the agent kept forgetting to bump alongside
the changelog. Wiring the frontend to fetch the value from the
authoritative changelog file eliminates the manual sync step
entirely: any iteration heading added to CHANGELOG.md immediately
becomes the displayed iter on the next page load.

Failure mode: if the changelog is missing or malformed, the route
returns an empty payload and the frontend falls back to its
hardcoded `ITER_LABEL` constant (so the page never breaks).
"""
from __future__ import annotations

from pathlib import Path
import re

from fastapi import APIRouter

_CHANGELOG_PATH = Path("/app/memory/CHANGELOG.md")

# Match the iteration heading we use in CHANGELOG.md:
#     ## Iteration 105.24 (2026-06-26) — ...
# Captures the version (`105.24`), optional date, and rest-of-line
# title text. Anchored to a leading `## Iteration ` so we don't
# accidentally grab "## Iter-105" in a comment block.
_ITER_RE = re.compile(
    r"^##\s+Iteration\s+([0-9]+(?:\.[0-9]+)*)"
    r"(?:\s*\(([^)]+)\))?"
    r"(?:\s*[—–-]\s*(.+))?$",
    re.MULTILINE,
)


def build_release_router() -> APIRouter:
    router = APIRouter(prefix="/release", tags=["release"])

    @router.get("/current")
    async def current_iteration():
        """Return the newest iteration heading from CHANGELOG.md.

        Response shape (always present, possibly empty):
            { iter: "105.24", label: "iter-105.24",
              date: "2026-06-26", title: "...short headline..." }
        """
        try:
            text = _CHANGELOG_PATH.read_text(encoding="utf-8", errors="ignore")
        except FileNotFoundError:
            return {"iter": "", "label": "", "date": "", "title": ""}

        # Iterate ALL matches, take the highest-versioned one. We can't
        # just take the last `## Iteration` heading because CHANGELOG.md
        # sometimes grows with iterations appended out-of-order during
        # hot-fixes — sorting by numeric components is the safe bet.
        best = None
        for m in _ITER_RE.finditer(text):
            version = m.group(1)
            try:
                parts = tuple(int(p) for p in version.split("."))
            except ValueError:
                continue
            if best is None or parts > best[0]:
                best = (parts, version, m.group(2) or "", (m.group(3) or "").strip())

        if best is None:
            return {"iter": "", "label": "", "date": "", "title": ""}

        _, version, date, title = best
        return {
            "iter": version,
            "label": f"iter-{version}",
            "date": date,
            "title": title,
        }

    return router

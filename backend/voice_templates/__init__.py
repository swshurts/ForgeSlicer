"""Voice-template registry.

A template is an importable submodule that exports:
  • META   — dict {id, label, description, params}
  • build  — (params: dict) -> List[Step]  (deterministic, no side-effects)

To register a new template, drop the module in `/app/backend/voice_templates/`
and add a single import below. The voice prompt + endpoint will pick it
up on next backend restart — no router or schema changes needed.

This decoupling is the "don't paint yourself into a corner" promise:
brackets, gussets, organisers, drawer pulls, project enclosures, vise
jaws, hose adaptors — all the same shape from the voice pipeline's
perspective.
"""
from __future__ import annotations

from typing import Any, Dict, List

from . import boards as _boards
from . import bracket as _bracket
from . import cable_comb as _cable_comb
from . import drawer_pull as _drawer_pull
from . import hose_adapter as _hose_adapter
from . import project_enclosure as _project_enclosure
from . import spool_spacer as _spool_spacer
from . import tool_holder as _tool_holder
from . import vise_jaws as _vise_jaws


# Each template module contributes one entry.
_TEMPLATE_MODULES = [
    _boards,
    _bracket,
    _cable_comb,
    _drawer_pull,
    _hose_adapter,
    _project_enclosure,
    _spool_spacer,
    _tool_holder,
    _vise_jaws,
]

# Built once at import time.
TEMPLATES: Dict[str, Any] = {m.META["id"]: m for m in _TEMPLATE_MODULES}


def list_templates() -> List[Dict[str, Any]]:
    """Return concise metadata for every registered template.

    Used by:
      • the system-prompt builder so GPT-5.2 can pick a template id
        and the right param keys without seeing every implementation
        detail;
      • the future docs / debug UI that wants to enumerate what the
        voice can do today.
    """
    out = []
    for tid, mod in TEMPLATES.items():
        meta = dict(mod.META)
        # Boards has a dynamic catalogue; expose it.
        if tid == "board_faceplate" and hasattr(mod, "list_boards"):
            meta = {**meta, "boards": mod.list_boards()}
        out.append(meta)
    return out


def expand(template_id: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Run the template's deterministic builder. Raises ValueError on
    bad id; the builder itself may raise ValueError on bad params."""
    if template_id not in TEMPLATES:
        raise ValueError(
            f"Unknown template_id={template_id!r}. "
            f"Known: {sorted(TEMPLATES.keys())}"
        )
    return TEMPLATES[template_id].build(params or {})


def prompt_descriptions() -> str:
    """Render the template catalogue as a single string suitable for
    injection into the LLM system prompt. Kept compact — names,
    descriptions, accepted params and enum values only. No example
    payloads (the LLM is good at extrapolating those).
    """
    lines = []
    for tid, mod in TEMPLATES.items():
        meta = mod.META
        lines.append(f"- {tid} — {meta['label']}: {meta['description']}")
        for pname, pspec in meta["params"].items():
            req = " (REQUIRED)" if pspec.get("required") else ""
            extra = ""
            if pspec.get("type") == "enum" and "values" in pspec:
                vals = pspec["values"]
                shown = vals if len(vals) <= 10 else (list(vals[:10]) + ["…"])
                extra = f"; one of: {shown}"
            elif "default" in pspec:
                extra = f"; default {pspec['default']}"
            lines.append(f"    • {pname}{req}: {pspec.get('describe','')}{extra}")
        # Boards bonus catalogue.
        if tid == "board_faceplate" and hasattr(mod, "list_boards"):
            ids = ", ".join(b["id"] for b in mod.list_boards())
            lines.append(f"    boards: {ids}")
    return "\n".join(lines)

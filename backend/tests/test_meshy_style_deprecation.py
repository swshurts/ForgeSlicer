"""Regression: Meshy `art_style` deprecation handling.

iter-127.1 — Meshy's meshy-6 model ignores the `art_style` API field and
"some combinations may cause errors" (per Meshy's own docs), which is
what caused users to see a Cloudflare 502 when selecting the Sculpture
style. We now drop `art_style` from the API payload entirely and instead
prepend a short style hint to the prompt so the model still steers
toward the requested aesthetic.

These tests lock in that behaviour so a future refactor doesn't
accidentally re-introduce the deprecated field.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("FORGE_SECRET_ENC_KEY", "VPz7lnPbwuFLQO8nmX9MV19jNn6XFxTpf0y1HoVnyNs=")
os.environ.setdefault("MESHY_API_KEY", "test-key")

import meshy_service  # noqa: E402


class _FakeResp:
    """Minimal drop-in for httpx.Response — only exposes the members
    meshy_service actually touches."""
    def __init__(self, task_id: str = "task_abc"):
        self._tid = task_id

    def raise_for_status(self):
        return None

    def json(self):
        return {"result": self._tid}


class _FakeClient:
    """AsyncClient replacement that records the .post payload for
    assertion. Used as an async context manager just like the real
    thing."""
    def __init__(self, **_kwargs):
        self.last_json = None
        self.last_url = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, headers=None, json=None):
        self.last_url = url
        self.last_json = json
        # Store on the class so tests can inspect after context exits.
        _FakeClient.LAST = self
        return _FakeResp()


def _run(coro):
    return asyncio.run(coro)


def test_art_style_field_is_not_sent_to_meshy():
    """`art_style` was DEPRECATED by Meshy in meshy-6 — sending it can
    trigger 5xx errors. This test would fail if a future refactor
    puts the field back into the payload."""
    with patch.object(meshy_service.httpx, "AsyncClient", _FakeClient):
        _run(meshy_service.create_text_to_3d("a red vase", art_style="sculpture"))
    assert "art_style" not in _FakeClient.LAST.last_json, (
        "art_style must NOT be sent to Meshy — it's deprecated in meshy-6 "
        "and can cause 5xx errors."
    )


def test_sculpture_style_injects_prompt_hint():
    """When the user picks Sculpture, the prompt should be prepended
    with a short style hint so the model still steers toward the
    requested aesthetic even without the deprecated field."""
    with patch.object(meshy_service.httpx, "AsyncClient", _FakeClient):
        _run(meshy_service.create_text_to_3d("a warrior figure", art_style="sculpture"))
    prompt = _FakeClient.LAST.last_json["prompt"]
    assert "sculpture" in prompt.lower(), f"expected 'sculpture' hint in prompt, got: {prompt}"
    assert "a warrior figure" in prompt


def test_realistic_style_still_prompt_hinted():
    """Realistic should also add a lightweight prompt hint. Behaviour is
    symmetric across styles so we don't accidentally special-case one."""
    with patch.object(meshy_service.httpx, "AsyncClient", _FakeClient):
        _run(meshy_service.create_text_to_3d("a car", art_style="realistic"))
    prompt = _FakeClient.LAST.last_json["prompt"]
    assert "realistic" in prompt.lower()
    assert "a car" in prompt


def test_prompt_is_still_capped_at_600_chars():
    """Style hint is prepended — the combined string must still be
    clipped to Meshy's 600-char hard limit."""
    long_prompt = "x" * 700
    with patch.object(meshy_service.httpx, "AsyncClient", _FakeClient):
        _run(meshy_service.create_text_to_3d(long_prompt, art_style="realistic"))
    assert len(_FakeClient.LAST.last_json["prompt"]) <= 600


def test_unknown_style_falls_through_without_hint():
    """A garbled/unrecognized style shouldn't add a nonsense hint. We
    just send the raw prompt through (matches previous fallback
    behaviour where unknown values silently coerced to realistic)."""
    with patch.object(meshy_service.httpx, "AsyncClient", _FakeClient):
        _run(meshy_service.create_text_to_3d("a table", art_style="futurepunk_grunge"))
    prompt = _FakeClient.LAST.last_json["prompt"]
    assert prompt == "a table", f"unknown style should pass prompt through unchanged, got: {prompt}"
    assert "art_style" not in _FakeClient.LAST.last_json

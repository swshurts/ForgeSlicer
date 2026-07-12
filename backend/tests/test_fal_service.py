"""Regression: fal.ai (Hunyuan3D v2 Pro) provider selection + response
normalisation. Iter-132.

Locks in the invariants the router relies on:
  1. is_configured() reflects the FAL_KEY env var + fal-client import.
  2. create_text_to_3d packs the request_id + reference image URL
     into a single ``<rid>|<url>`` string so the poll route can hydrate
     the reference image without a second DB write.
  3. get_task normalises fal_client.Queued / InProgress / Completed
     into Meshy-shaped {status, progress, model_urls, task_error}
     dicts so ``server.py`` can consume both providers identically.
  4. Multi-image submission uses the FIRST image and logs the extras
     (Hunyuan3D v2 is single-view on fal.ai as of Feb 2026).
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["FAL_KEY"] = "test-fal-key"

import fal_service  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class TestIsConfigured:
    def test_configured_when_key_set(self):
        os.environ["FAL_KEY"] = "test-fal-key"
        assert fal_service.is_configured() is True

    def test_not_configured_when_key_missing(self):
        os.environ.pop("FAL_KEY", None)
        try:
            assert fal_service.is_configured() is False
        finally:
            os.environ["FAL_KEY"] = "test-fal-key"


class TestCreateTextTo3D:
    def test_packs_request_id_and_reference_image_url(self):
        """Text-to-3D returns "<request_id>|<reference_image_url>" so
        the frontend can preview the intermediate Flux image while
        Hunyuan3D crunches. Verifies the delimiter format and that
        both parts round-trip through ``_split_text_id``."""
        fake_flux = {"images": [{"url": "https://cdn.fal.ai/flux/img.png"}]}
        fake_handle = MagicMock()
        fake_handle.request_id = "hy_req_abc123"

        with patch.object(fal_service.fal_client, "subscribe_async",
                          new=AsyncMock(return_value=fake_flux)) as sub, \
             patch.object(fal_service.fal_client, "submit_async",
                          new=AsyncMock(return_value=fake_handle)) as submit:
            task_id = _run(fal_service.create_text_to_3d("a robot"))

        assert task_id == "hy_req_abc123|https://cdn.fal.ai/flux/img.png"
        # Sanity: pipeline used Flux for step 1 and Hunyuan for step 2.
        assert sub.call_args[0][0] == fal_service.TEXT_TO_IMAGE_MODEL
        assert submit.call_args[0][0] == fal_service.IMAGE_TO_3D_MODEL
        # Hunyuan received the Flux URL as input_image_url.
        assert submit.call_args[1]["arguments"]["input_image_url"] == fake_flux["images"][0]["url"]

    def test_split_text_id_roundtrip(self):
        rid, ref = fal_service._split_text_id("hy_req_abc|https://x.png")
        assert rid == "hy_req_abc"
        assert ref == "https://x.png"

    def test_split_text_id_no_delimiter(self):
        rid, ref = fal_service._split_text_id("bare_id")
        assert rid == "bare_id"
        assert ref is None


class TestGetTaskNormalisation:
    """fal.ai raw responses come back as ``Completed`` / ``InProgress`` /
    ``Queued`` sentinel dataclasses; the router expects a Meshy-shaped
    dict."""

    def test_completed_returns_meshy_shape(self):
        fake_completed = fal_service.fal_client.Completed(logs=[], metrics={})
        fake_result = {"model_mesh": {"url": "https://cdn.fal.ai/mesh.glb"}}
        with patch.object(fal_service.fal_client, "status_async",
                          new=AsyncMock(return_value=fake_completed)), \
             patch.object(fal_service.fal_client, "result_async",
                          new=AsyncMock(return_value=fake_result)):
            out = _run(fal_service.get_task("req_xyz|https://ref.png", "text"))
        assert out["status"] == "SUCCEEDED"
        assert out["progress"] == 100
        assert out["model_urls"] == {"glb": "https://cdn.fal.ai/mesh.glb"}
        # Reference image threads back through so /ai/jobs/{id} can
        # persist it to Mongo for the UI preview panel.
        assert out["reference_image_url"] == "https://ref.png"

    def test_in_progress_normalises(self):
        fake_in_progress = fal_service.fal_client.InProgress(logs=[])
        with patch.object(fal_service.fal_client, "status_async",
                          new=AsyncMock(return_value=fake_in_progress)):
            out = _run(fal_service.get_task("req_xyz", "image"))
        assert out["status"] == "IN_PROGRESS"
        # 50% is a synthetic value — fal doesn't report a real percentage,
        # but the UI needs a monotonically-increasing signal to animate.
        assert out["progress"] == 50
        assert out["model_urls"] == {}

    def test_queued_normalises(self):
        # `Queued` and anything else falls to PENDING.
        fake_queued = MagicMock()  # any non-Completed / non-InProgress
        with patch.object(fal_service.fal_client, "status_async",
                          new=AsyncMock(return_value=fake_queued)):
            out = _run(fal_service.get_task("req_xyz", "image"))
        assert out["status"] == "PENDING"


class TestMultiImage:
    def test_first_image_wins(self):
        fake_handle = MagicMock()
        fake_handle.request_id = "hy_multi_req"
        with patch.object(fal_service.fal_client, "submit_async",
                          new=AsyncMock(return_value=fake_handle)) as submit:
            task_id = _run(fal_service.create_multi_image_to_3d([
                "data:image/png;base64,AAAA",
                "data:image/png;base64,BBBB",
                "data:image/png;base64,CCCC",
            ]))
        assert task_id == "hy_multi_req"
        # Confirmed: single-view fal endpoint receives only view #1.
        assert submit.call_args[1]["arguments"]["input_image_url"] == "data:image/png;base64,AAAA"

    def test_rejects_zero_or_over_four(self):
        import pytest
        with pytest.raises(ValueError):
            _run(fal_service.create_multi_image_to_3d([]))
        with pytest.raises(ValueError):
            _run(fal_service.create_multi_image_to_3d(["a", "b", "c", "d", "e"]))


class TestPickModelUrl:
    def test_prefers_glb_over_stl(self):
        # fal only ships GLB but the helper keeps back-compat with a
        # future STL export toggle.
        assert fal_service.pick_model_url({"model_urls": {"glb": "x.glb"}}) == "x.glb"
        assert fal_service.pick_model_url({"model_urls": {"glb": "x.glb", "stl": "x.stl"}}) == "x.glb"
        assert fal_service.pick_model_url({"model_urls": {}}) is None
        assert fal_service.pick_model_url({}) is None

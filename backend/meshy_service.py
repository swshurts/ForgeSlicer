"""Meshy AI integration — text-to-3D and image-to-3D generation.

Designed around Meshy's async task model:
  1. POST to create a task → returns a Meshy task_id
  2. Periodically GET /<endpoint>/{task_id} → status (PENDING/IN_PROGRESS/SUCCEEDED/FAILED)
  3. When SUCCEEDED, task_object.model_urls.{stl,glb} contains a CDN URL

Module-level helpers wrap (a) submission, (b) status polling, (c) mesh download.
The FastAPI routes in server.py orchestrate user-cap enforcement + persistence.

Test-mode key `msy_dummy_api_key_for_test_mode_12345678` exists for development;
real keys start with `msy-`.
"""

import os
import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

MESHY_BASE = "https://api.meshy.ai"
TEXT_ENDPOINT = "/openapi/v2/text-to-3d"
IMAGE_ENDPOINT = "/openapi/v1/image-to-3d"
MULTI_IMAGE_ENDPOINT = "/openapi/v1/multi-image-to-3d"

# Preview-only for text (geometry, no textures) keeps cost at 5–20 credits per gen
# and matches what we want for 3D printing workflows.
TARGET_FORMATS = ["stl", "glb"]


def _api_key() -> Optional[str]:
    return (os.environ.get("MESHY_API_KEY") or "").strip() or None


def is_configured() -> bool:
    return bool(_api_key())


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }


async def create_text_to_3d(prompt: str, art_style: str = "realistic") -> str:
    """Submit a text-to-3D preview task; returns Meshy task_id.

    Meshy text-to-3d v2 only accepts ``art_style`` values of ``realistic``
    or ``sculpture`` — anything else (e.g. ``low_poly``) returns 400. For
    sculpture, the docs explicitly require ``enable_pbr: false`` because
    that style generates its own PBR maps. We disable PBR unconditionally
    since we're geometry-only for 3D printing anyway.
    """
    if art_style not in ("realistic", "sculpture"):
        art_style = "realistic"
    payload = {
        "mode": "preview",
        "prompt": prompt[:600],  # API hard-limits prompt length
        "art_style": art_style,
        "enable_pbr": False,
        "should_remesh": True,
        "target_formats": TARGET_FORMATS,
    }
    async with httpx.AsyncClient(base_url=MESHY_BASE, timeout=60.0) as cx:
        r = await cx.post(TEXT_ENDPOINT, headers=_headers(), json=payload)
        r.raise_for_status()
        data = r.json()
        return data["result"]


async def create_image_to_3d(image_data_url: str) -> str:
    """Submit an image-to-3D task; returns Meshy task_id.

    `image_data_url` must be `data:image/<mime>;base64,<b64-payload>` per Meshy spec.
    """
    payload = {
        "image_url": image_data_url,
        "enable_pbr": False,
        "should_remesh": True,
        "should_texture": False,  # geometry only — cheaper + 3D-print friendly
        "target_formats": TARGET_FORMATS,
    }
    async with httpx.AsyncClient(base_url=MESHY_BASE, timeout=60.0) as cx:
        r = await cx.post(IMAGE_ENDPOINT, headers=_headers(), json=payload)
        r.raise_for_status()
        data = r.json()
        return data["result"]


async def create_multi_image_to_3d(image_data_urls: list) -> str:
    """Submit a multi-image-to-3D task; returns Meshy task_id.

    Accepts 1-4 reference photos as data: URLs (typically top / front /
    side / extra view). Meshy fuses them into a single mesh. We keep
    `should_texture=False` because the printable-geometry workflow
    doesn't need textures (saves ~10 credits per generation).
    """
    if not (1 <= len(image_data_urls) <= 4):
        raise ValueError("create_multi_image_to_3d expects between 1 and 4 reference images")
    payload = {
        "image_urls": image_data_urls,
        "enable_pbr": False,
        "should_remesh": True,
        "should_texture": False,
        "target_formats": TARGET_FORMATS,
        "ai_model": "meshy-5",  # current multi-view default; auto-rolls forward
    }
    async with httpx.AsyncClient(base_url=MESHY_BASE, timeout=60.0) as cx:
        r = await cx.post(MULTI_IMAGE_ENDPOINT, headers=_headers(), json=payload)
        r.raise_for_status()
        data = r.json()
        return data["result"]


async def get_task(task_id: str, kind: str) -> Dict[str, Any]:
    """Fetch task status. `kind` is 'text', 'image', or 'multi_image'
    — picks the right endpoint.

    Retries transient 5xx responses up to 3 times with exponential backoff
    so a single Meshy hiccup mid-generation doesn't bubble up as a 502 to
    the user (and ditch their in-flight job).
    """
    if kind == "text":
        endpoint = TEXT_ENDPOINT
    elif kind == "multi_image":
        endpoint = MULTI_IMAGE_ENDPOINT
    else:
        endpoint = IMAGE_ENDPOINT
    last_err: Optional[httpx.HTTPStatusError] = None
    async with httpx.AsyncClient(base_url=MESHY_BASE, timeout=30.0) as cx:
        for attempt in range(3):
            try:
                r = await cx.get(f"{endpoint}/{task_id}", headers=_headers())
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as e:
                # Retry only transient upstream failures. 4xx is a real
                # client error (auth/missing task) — bail immediately.
                if e.response.status_code < 500:
                    raise
                last_err = e
                logger.warning("Meshy poll attempt %d/3 failed: %s", attempt + 1, e)
                await _sleep_backoff(attempt)
        # Exhausted retries — re-raise the last upstream error.
        assert last_err is not None
        raise last_err


async def download_mesh(url: str) -> bytes:
    """Download the generated mesh binary.

    Retries on transient 5xx from the Meshy CDN so a flaky download doesn't
    waste the user's already-paid generation credit.
    """
    last_err: Optional[httpx.HTTPStatusError] = None
    async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as cx:
        for attempt in range(3):
            try:
                r = await cx.get(url)
                r.raise_for_status()
                return r.content
            except httpx.HTTPStatusError as e:
                if e.response.status_code < 500:
                    raise
                last_err = e
                logger.warning("Meshy mesh download attempt %d/3 failed: %s", attempt + 1, e)
                await _sleep_backoff(attempt)
        assert last_err is not None
        raise last_err


async def _sleep_backoff(attempt: int) -> None:
    """Exponential-ish backoff: 1s, 2s, 4s."""
    import asyncio
    await asyncio.sleep(2 ** attempt)


def pick_model_url(task_obj: Dict[str, Any]) -> Optional[str]:
    """Return the best download URL: STL preferred, GLB fallback."""
    urls = task_obj.get("model_urls") or {}
    return urls.get("stl") or urls.get("glb") or urls.get("obj")

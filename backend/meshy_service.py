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
    """Submit a text-to-3D preview task; returns Meshy task_id."""
    payload = {
        "mode": "preview",
        "prompt": prompt[:600],  # API hard-limits prompt length
        "art_style": art_style,
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


async def get_task(task_id: str, kind: str) -> Dict[str, Any]:
    """Fetch task status. `kind` is 'text' or 'image' — picks the right endpoint."""
    endpoint = TEXT_ENDPOINT if kind == "text" else IMAGE_ENDPOINT
    async with httpx.AsyncClient(base_url=MESHY_BASE, timeout=30.0) as cx:
        r = await cx.get(f"{endpoint}/{task_id}", headers=_headers())
        r.raise_for_status()
        return r.json()


async def download_mesh(url: str) -> bytes:
    """Download the generated mesh binary."""
    async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as cx:
        r = await cx.get(url)
        r.raise_for_status()
        return r.content


def pick_model_url(task_obj: Dict[str, Any]) -> Optional[str]:
    """Return the best download URL: STL preferred, GLB fallback."""
    urls = task_obj.get("model_urls") or {}
    return urls.get("stl") or urls.get("glb") or urls.get("obj")

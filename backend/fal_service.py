"""fal.ai integration — image-to-3D (Hunyuan3D v2 Pro) as the default 3D AI
provider for ForgeSlicer, plus a 2-step text→image→3D pipeline that
reuses the same async queue for text prompts (Flux Schnell for the
reference image, then Hunyuan3D v2 for the geometry).

Interface mirrors ``meshy_service`` so ``server.py`` can pick a provider
per user (BYO Meshy key → Meshy premium path; otherwise → fal.ai default)
without branching every route. The functions all return / accept the
same primitive types Meshy uses:
  - submission helpers → ``request_id`` (fal's queue id, opaque string)
  - status polling  → dict with keys ``status``, ``progress``, ``model_urls``
  - ``pick_model_url`` → best download URL
  - ``download_mesh`` → raw bytes

Model choice:
  Iter-132 — User selected Hunyuan3D Pro (``fal-ai/hunyuan3d/v2``) at
  ~$0.16/gen for higher-fidelity geometry over the ~$0.05 Turbo variant.
  Swap the constant below if this ever needs to be a runtime toggle.
"""

import os
import asyncio
import logging
from typing import Any, Dict, List, Optional

import httpx

try:
    import fal_client
    # fal_client's typed exceptions — we normalise to HTTPStatusError-ish
    # shape so the router doesn't need a special code path per provider.
    from fal_client.client import FalClientHTTPError as _FalHTTPError  # noqa: N814
except ImportError:  # pragma: no cover — installed via requirements.txt
    fal_client = None  # noqa: N816
    _FalHTTPError = Exception  # type: ignore[misc]

logger = logging.getLogger(__name__)

# Model endpoints on fal.ai.
IMAGE_TO_3D_MODEL = "fal-ai/hunyuan3d/v2"       # Pro variant (higher quality)
TEXT_TO_IMAGE_MODEL = "fal-ai/flux/schnell"      # fast, ~1.5s per image

# Local status vocabulary — matches the Meshy service so ai_jobs docs
# only ever see PENDING / IN_PROGRESS / SUCCEEDED / FAILED regardless
# of which provider actually produced the mesh.
_STATUS_PENDING = "PENDING"
_STATUS_IN_PROGRESS = "IN_PROGRESS"
_STATUS_SUCCEEDED = "SUCCEEDED"
_STATUS_FAILED = "FAILED"


# Re-exported so server.py can catch fal.ai submission errors without
# having to import fal_client itself.
FalHTTPError = _FalHTTPError


def _api_key() -> Optional[str]:
    return (os.environ.get("FAL_KEY") or "").strip() or None


def is_configured() -> bool:
    """True iff the server has a FAL_KEY env var AND the fal-client
    library is importable. Both are required — a missing lib silently
    downgrades all fal.ai routes to 503 instead of surfacing an
    ImportError deep in the request handler."""
    return bool(_api_key()) and fal_client is not None


def _ensure_configured() -> None:
    if fal_client is None:
        raise RuntimeError("fal-client is not installed; run pip install fal-client")
    if not _api_key():
        raise RuntimeError("FAL_KEY missing from environment")
    # fal_client reads the FAL_KEY env var itself; we mirror it here so
    # tests that stub os.environ before importing the module still work.
    os.environ["FAL_KEY"] = _api_key() or ""


async def _text_to_image(prompt: str) -> str:
    """Step 1 of the text-to-3D pipeline. Returns a URL for the
    generated reference image. Uses ``subscribe_async`` because Flux
    Schnell finishes in ~1.5s — cheap to block briefly rather than
    tracking two queue ids per text generation."""
    _ensure_configured()
    result = await fal_client.subscribe_async(  # type: ignore[union-attr]
        TEXT_TO_IMAGE_MODEL,
        arguments={
            "prompt": prompt[:600],
            "image_size": "square_hd",
        },
    )
    images = result.get("images") or []
    if not images or "url" not in images[0]:
        raise RuntimeError("Flux Schnell returned no image URL")
    return images[0]["url"]


async def generate_preview_images(prompt: str, num_images: int = 4) -> List[str]:
    """Iter-132.2 — Generate ``num_images`` reference images from a text
    prompt via Flux Schnell (~$0.001 each, ~1.5s each). Returns a list
    of CDN URLs. Enables the "pick the best preview" UX: users iterate
    on ~$0.004 previews before spending the ~$0.16 on Hunyuan3D.

    ``num_images`` is clamped 1..4 to match Flux Schnell's max batch."""
    _ensure_configured()
    n = max(1, min(4, int(num_images)))
    result = await fal_client.subscribe_async(  # type: ignore[union-attr]
        TEXT_TO_IMAGE_MODEL,
        arguments={
            "prompt": prompt[:600],
            "image_size": "square_hd",
            "num_images": n,
        },
    )
    images = result.get("images") or []
    urls = [img.get("url") for img in images if isinstance(img, dict) and img.get("url")]
    if not urls:
        raise RuntimeError("Flux Schnell returned no images")
    return urls


async def create_text_to_3d(prompt: str, art_style: str = "realistic", api_key: Optional[str] = None) -> str:  # noqa: ARG001
    """Text prompt → 3D mesh via a 2-step pipeline.

    ``art_style`` is accepted for interface parity with Meshy but folded
    into the prompt (no dedicated fal.ai field). Returns the Hunyuan3D
    request_id which the frontend polls exactly like a Meshy task id.
    """
    _ensure_configured()
    style_hint = ""
    if art_style == "sculpture":
        style_hint = "sculpture style, artistic surface treatment, "
    elif art_style == "realistic":
        style_hint = "realistic photograph, cinematic lighting, "
    effective_prompt = f"{style_hint}{prompt}"[:600]

    image_url = await _text_to_image(effective_prompt)
    handle = await fal_client.submit_async(  # type: ignore[union-attr]
        IMAGE_TO_3D_MODEL,
        arguments={
            "input_image_url": image_url,
            "textured_mesh": False,  # geometry-only workflow for 3D printing
        },
    )
    # Stash the reference image URL on the handle so callers who care
    # (currently server.py logs it) can retrieve it. fal handles don't
    # normally carry arbitrary user data, so we return a delimited id.
    return f"{handle.request_id}|{image_url}"


async def create_image_to_3d(image_data_url: str, api_key: Optional[str] = None) -> str:  # noqa: ARG001
    """Image → 3D mesh. Accepts either an http(s) URL or a
    ``data:image/…;base64,…`` payload — Hunyuan3D on fal.ai accepts
    both formats natively."""
    _ensure_configured()
    handle = await fal_client.submit_async(  # type: ignore[union-attr]
        IMAGE_TO_3D_MODEL,
        arguments={
            "input_image_url": image_data_url,
            "textured_mesh": False,
        },
    )
    return handle.request_id


async def create_multi_image_to_3d(image_data_urls: List[str], api_key: Optional[str] = None) -> str:  # noqa: ARG001
    """Multi-view → 3D mesh.

    Hunyuan3D v2 on fal.ai as of Feb 2026 primarily consumes a single
    reference image. We submit the FIRST image and log the rest — this
    keeps the multi-image UI functional (users still get a 3D mesh)
    but doesn't fabricate a false multi-view signal. If/when fal
    exposes a genuine multi-view endpoint we can switch here without
    touching the rest of the pipeline.
    """
    if not (1 <= len(image_data_urls) <= 4):
        raise ValueError("create_multi_image_to_3d expects between 1 and 4 reference images")
    if len(image_data_urls) > 1:
        logger.info(
            "fal.ai Hunyuan3D v2 is single-image; using first of %d supplied views",
            len(image_data_urls),
        )
    _ensure_configured()
    handle = await fal_client.submit_async(  # type: ignore[union-attr]
        IMAGE_TO_3D_MODEL,
        arguments={
            "input_image_url": image_data_urls[0],
            "textured_mesh": False,
        },
    )
    return handle.request_id


def _split_text_id(task_id: str) -> tuple[str, Optional[str]]:
    """Text-mode ids are ``<request_id>|<reference_image_url>``. Every
    other kind is a bare request_id. This helper returns ``(id, ref_or_None)``
    so ``get_task`` can hydrate the poll result with the reference image."""
    if "|" in task_id:
        rid, ref = task_id.split("|", 1)
        return rid.strip(), (ref.strip() or None)
    return task_id.strip(), None


async def get_task(task_id: str, kind: str, api_key: Optional[str] = None) -> Dict[str, Any]:  # noqa: ARG001
    """Poll fal.ai for the request's current state.

    Returns a normalised dict shaped like Meshy's response so the
    router code can consume both providers identically:
        {
          "status": "PENDING|IN_PROGRESS|SUCCEEDED|FAILED",
          "progress": 0-100,
          "model_urls": {"glb": "…"} | {},
          "task_error": {"message": "…"} | {},
          "reference_image_url": "…"  # text-to-3d only
        }
    """
    _ensure_configured()
    del kind  # fal uses one endpoint for all three kinds; ``kind`` retained for API parity
    request_id, ref_image = _split_text_id(task_id)

    status_res = await fal_client.status_async(  # type: ignore[union-attr]
        IMAGE_TO_3D_MODEL, request_id, with_logs=False
    )

    if isinstance(status_res, fal_client.Completed):  # type: ignore[union-attr]
        result = await fal_client.result_async(  # type: ignore[union-attr]
            IMAGE_TO_3D_MODEL, request_id
        )
        # fal returns {"model_mesh": {"url": "...glb"}}; sometimes also
        # {"textured_model_mesh": {...}} on textured runs. We forced
        # textured_mesh=False so only model_mesh is present.
        mesh_url = ((result.get("model_mesh") or {}).get("url")
                    or (result.get("textured_model_mesh") or {}).get("url"))
        out: Dict[str, Any] = {
            "status": _STATUS_SUCCEEDED,
            "progress": 100,
            "model_urls": {"glb": mesh_url} if mesh_url else {},
            "task_error": {},
        }
        if ref_image:
            out["reference_image_url"] = ref_image
        return out

    if isinstance(status_res, fal_client.InProgress):  # type: ignore[union-attr]
        return {
            "status": _STATUS_IN_PROGRESS,
            "progress": 50,
            "model_urls": {},
            "task_error": {},
            **({"reference_image_url": ref_image} if ref_image else {}),
        }

    # fal_client.Queued or any other pending shape.
    return {
        "status": _STATUS_PENDING,
        "progress": 10,
        "model_urls": {},
        "task_error": {},
        **({"reference_image_url": ref_image} if ref_image else {}),
    }


def pick_model_url(task_obj: Dict[str, Any]) -> Optional[str]:
    """Return the best download URL. fal.ai only ships GLB for
    Hunyuan3D v2 (no native STL) — the frontend already imports GLB
    for AI-generated meshes so this is a no-op difference from Meshy."""
    urls = task_obj.get("model_urls") or {}
    return urls.get("glb") or urls.get("stl") or urls.get("obj")


async def download_mesh(url: str, api_key: Optional[str] = None) -> bytes:  # noqa: ARG001
    """Download the generated GLB. fal CDN URLs are pre-signed +
    short-lived — no auth header needed. Retries transient 5xx three
    times with exponential backoff so a flaky download doesn't waste
    a paid gen."""
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
                logger.warning("fal.ai mesh download attempt %d/3 failed: %s", attempt + 1, e)
                await asyncio.sleep(2 ** attempt)
        assert last_err is not None
        raise last_err

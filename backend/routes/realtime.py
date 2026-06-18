"""
OpenAI Realtime API routes — used by the frontend Voice button for live
streaming transcription. The bundled emergentintegrations helper defaults
to the full `gpt-4o-realtime-preview` model which is ~4x more expensive
than mini; we override to `gpt-4o-mini-realtime-preview` here so the
per-command cost lands around $0.005-0.01 instead of $0.02-0.04.

Two endpoints expected by the frontend WebRTC client:
  POST /api/v1/realtime/session
      → Mint a short-lived `client_secret` the browser uses to authenticate
        its WebRTC offer. The OpenAI API key NEVER leaves the backend.
        Returns the OpenAI session JSON (includes `client_secret.value`).

  POST /api/v1/realtime/negotiate
      Body: raw SDP offer (Content-Type: application/sdp)
      → Forwards the SDP to OpenAI's /v1/realtime endpoint and returns
        the SDP answer. The browser sets this as its remote description
        to complete the WebRTC handshake.

We use the model parameters that turn audio output OFF (we only want
transcription), and enable `input_audio_transcription` so we get text
events back over the data channel as the user speaks.
"""
import os

import aiohttp
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

# Model id — explicit `mini` so cost stays low. If OpenAI renames this in
# the future, only this constant changes.
REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17"

router = APIRouter()


def _api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY not configured. Add it to backend/.env to enable real-time voice.",
        )
    return key


@router.post("/realtime/session")
async def create_realtime_session():
    """Mint an ephemeral Realtime session token + return it to the browser.

    Uses the GA `/v1/realtime/client_secrets` endpoint (the older
    `/v1/realtime/sessions` was deprecated in early 2026). The browser
    consumes `response.value` (the ephemeral token) and the session
    config from `response.session`.

    Session is configured for SPEECH-TO-TEXT only: no audio output
    (`output_modalities: ["text"]`), and input transcription enabled
    via Whisper so the user sees their words appear as they talk.
    """
    api_key = _api_key()
    # New GA schema wraps the session config under a `session` key and
    # requires `type: "realtime"`. Audio settings now live under
    # `session.audio.input.transcription` instead of being top-level.
    payload = {
        "session": {
            "type": "realtime",
            "model": REALTIME_MODEL,
            # Only text out — we don't want the model to speak back. This
            # alone cuts cost roughly in half vs the default audio-out
            # mode and removes ~200ms of TTS synthesis latency.
            "output_modalities": ["text"],
            "audio": {
                "input": {
                    # Whisper-quality transcription as the user speaks.
                    "transcription": {"model": "whisper-1"},
                    # Aggressive VAD so the transcript commits ~400ms
                    # after the user pauses, vs the default ~500ms.
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 200,
                        "silence_duration_ms": 400,
                    },
                },
            },
            # No instructions needed — we use Realtime ONLY for live
            # transcription. The final transcript is shipped to our
            # existing /api/voice/command endpoint for plan parsing.
            "instructions": "Transcribe audio only. Do not respond.",
        },
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(
            "https://api.openai.com/v1/realtime/client_secrets",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        ) as resp:
            data = await resp.json()
            if resp.status >= 400:
                raise HTTPException(
                    status_code=resp.status,
                    detail=data.get("error", data),
                )
            return JSONResponse(content=data)


@router.post("/realtime/negotiate")
async def negotiate_realtime_connection(request: Request):
    """Forward a WebRTC SDP offer from the browser to OpenAI and return
    the SDP answer. The browser then sets the answer as its remote
    description, completing the connection.

    OpenAI's Realtime API supports the SAME ephemeral-token auth as the
    session endpoint, but in practice the browser sends the SDP through
    us (the backend) so we don't leak the key, and we use the standard
    Bearer auth here.
    """
    api_key = _api_key()
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty SDP offer body")
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"https://api.openai.com/v1/realtime?model={REALTIME_MODEL}",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/sdp",
            },
            data=body,
        ) as resp:
            sdp = await resp.text()
            if resp.status >= 400:
                raise HTTPException(status_code=resp.status, detail=sdp)
            return JSONResponse(content={"sdp": sdp})


@router.get("/realtime/status")
async def realtime_status():
    """Cheap health check the frontend hits on Voice button mount to
    decide whether to surface the Realtime path at all. Returns 200 with
    {available: true} when the key is present, else 200 + available=false
    so the UI can show a graceful "config required" hint instead of a
    hard error mid-stream.
    """
    return {"available": bool(os.environ.get("OPENAI_API_KEY")), "model": REALTIME_MODEL}

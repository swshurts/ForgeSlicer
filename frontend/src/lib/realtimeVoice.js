// realtimeVoice.js — OpenAI Realtime API client for live streaming
// voice transcription. Replaces the record-then-Whisper pipeline in
// VoiceButton.jsx with a WebRTC connection that emits partial
// transcripts as the user speaks.
//
// Flow:
//   1. Caller invokes `startRealtimeVoice({ onPartial, onFinal, onError })`.
//   2. We mint an ephemeral token via POST /api/v1/realtime/session
//      (the backend keeps the OpenAI API key secret).
//   3. Open an RTCPeerConnection, add the user's mic as an audio track,
//      open a data channel for transcription events.
//   4. Send the SDP offer through POST /api/v1/realtime/negotiate which
//      proxies to OpenAI and returns the SDP answer.
//   5. As OpenAI receives audio, it emits
//        - `conversation.item.input_audio_transcription.delta`  → onPartial
//        - `conversation.item.input_audio_transcription.completed` → onFinal
//   6. Caller calls `session.stop()` to tear down the connection.
//
// The caller is responsible for taking the final transcript and feeding
// it to /api/voice/command for plan parsing — same as the old flow.

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api/v1";

export async function startRealtimeVoice({ onPartial, onFinal, onError, onStateChange }) {
  let pc = null;
  let dc = null;
  let mediaStream = null;
  let stopped = false;
  let lastFinal = "";

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try { dc?.close(); } catch (_) { /* noop */ }
    try { mediaStream?.getTracks().forEach((t) => t.stop()); } catch (_) { /* noop */ }
    try { pc?.close(); } catch (_) { /* noop */ }
    onStateChange?.("closed");
  };

  try {
    onStateChange?.("connecting");

    // ── 1. Mint ephemeral session token ──
    const sessRes = await fetch(`${API}/realtime/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!sessRes.ok) {
      const err = await sessRes.json().catch(() => ({}));
      throw new Error(`Session mint failed: ${err.detail?.message || err.detail || sessRes.status}`);
    }
    const sessData = await sessRes.json();
    if (!sessData?.value) throw new Error("Session response missing ephemeral token");

    // ── 2. Open WebRTC peer connection ──
    pc = new RTCPeerConnection();

    // OpenAI may attempt to send audio back; we requested text-only output
    // but still need a placeholder receiver so the SDP negotiation succeeds.
    pc.addTransceiver("audio", { direction: "sendrecv" });

    // ── 3. Acquire mic + add as outbound track ──
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of mediaStream.getTracks()) pc.addTrack(track, mediaStream);

    // ── 4. Data channel for transcription events ──
    dc = pc.createDataChannel("oai-events");
    dc.onopen = () => onStateChange?.("listening");
    dc.onclose = cleanup;
    dc.onerror = (e) => {
      // eslint-disable-next-line no-console
      console.warn("Realtime data channel error:", e);
    };
    dc.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      const t = msg.type;
      // Partial transcript — fires repeatedly as the user speaks.
      if (t === "conversation.item.input_audio_transcription.delta") {
        const delta = msg.delta || "";
        if (delta) onPartial?.(delta);
      }
      // Final transcript — fires once VAD detects pause and the segment
      // is committed. The transcript text is on `transcript`.
      else if (t === "conversation.item.input_audio_transcription.completed") {
        const transcript = msg.transcript || "";
        lastFinal = transcript;
        onFinal?.(transcript);
      }
      // Surface a server-side error verbatim so the UI can show it
      // instead of silently hanging on a dead connection.
      else if (t === "error") {
        onError?.(msg.error?.message || "Realtime API error");
      }
    };

    // ── 5. SDP offer → backend → OpenAI → answer ──
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const negRes = await fetch(`${API}/realtime/negotiate`, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp,
      credentials: "include",
    });
    if (!negRes.ok) {
      const errTxt = await negRes.text();
      throw new Error(`Negotiate failed (${negRes.status}): ${errTxt.slice(0, 200)}`);
    }
    const { sdp: answerSdp } = await negRes.json();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    // ── 6. Return session controller ──
    return {
      stop: () => {
        // Commit any pending audio before tearing down, so the final
        // segment doesn't get dropped if the user stops mid-word.
        try { dc?.readyState === "open" && dc.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch (_) { /* noop */ }
        cleanup();
      },
      getLastFinal: () => lastFinal,
    };
  } catch (err) {
    cleanup();
    onError?.(err.message || String(err));
    throw err;
  }
}

/**
 * Cheap availability probe — used by the VoiceButton on mount to decide
 * whether to surface the Realtime path or fall back to the legacy
 * record-then-Whisper flow. Returns { available, model } or null on
 * network error.
 */
export async function checkRealtimeAvailable() {
  try {
    const r = await fetch(`${API}/realtime/status`, { credentials: "include" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

import axios from "axios";
import { API } from "./api";

// Server-side Speech-to-Text via OpenAI Whisper. Used as a more accurate
// alternative to the browser's Web Speech API (which is Chrome-only and
// struggles with non-US-English accents). We record audio with the standard
// MediaRecorder API, POST the blob to the backend, and get back the
// transcript text.

// MIME-type fallback chain — Chrome and Edge prefer `audio/webm;codecs=opus`,
// Safari/iOS fallback to `audio/mp4`. We pick the first one the browser
// will accept so we always have working capture.
const PREFERRED_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "",                     // last resort: let the browser pick
];

export function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of PREFERRED_MIMES) {
    if (!m) return "";
    try { if (MediaRecorder.isTypeSupported(m)) return m; }
    catch { /* some browsers throw on unknown mimes */ }
  }
  return null;
}

export function isWhisperSupported() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

// Returns an object with .start(), .stop() which resolves to a Blob, and
// .cancel() to abort. Throws if the user denies microphone access.
export async function startRecorder({ onStart, onError } = {}) {
  const mime = pickRecorderMime();
  if (mime === null) throw new Error("MediaRecorder not supported in this browser");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const msg = err?.name === "NotAllowedError"
      ? "Microphone access blocked — allow it in your browser's site settings, then try again."
      : (err?.message || String(err));
    if (onError) onError(msg);
    throw new Error(msg);
  }
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  let resolveStop;
  let rejectStop;
  const stopped = new Promise((res, rej) => { resolveStop = res; rejectStop = rej; });
  rec.onstop = () => {
    try {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
      resolveStop(blob);
    } catch (e) { rejectStop(e); }
  };
  rec.onerror = (e) => { rejectStop(e?.error || new Error("recording failed")); };
  rec.start();
  if (onStart) onStart();
  return {
    mimeType: rec.mimeType || mime || "audio/webm",
    stop: () => { try { rec.stop(); } catch { /* already stopped */ } return stopped; },
    cancel: () => {
      try { rec.stop(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

// POST the recorded blob to /api/voice/transcribe and return the text.
export async function transcribeBlob(blob) {
  const ext = (blob.type.includes("mp4") ? "mp4"
            : blob.type.includes("ogg") ? "ogg"
            : "webm");
  const fd = new FormData();
  fd.append("file", blob, `audio.${ext}`);
  const { data } = await axios.post(`${API}/voice/transcribe`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60000,
  });
  return (data?.transcript || "").trim();
}

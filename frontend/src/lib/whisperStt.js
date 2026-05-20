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

// Voice Activity Detection — watches an audio stream and tells the caller
// whenever it's "speaking" vs "silent". Used to auto-stop recording when the
// user pauses, so the hands-free flow doesn't need a click to wrap up.
//
// `onSilenceTrigger` fires once when silence exceeds `silenceMs` AFTER any
// speech has been detected. (Without the "after speech" gate we'd fire the
// instant recording starts, before the user could say anything.)
function attachVAD(stream, {
  silenceMs = 1500,       // tail-of-utterance hold time
  thresholdDb = -45,      // RMS dB threshold for "speech"
  onSilenceTrigger,
} = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return () => {};
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let everSpoke = false;
  let silentSince = null;
  let fired = false;
  let rafId = null;

  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    // RMS → dB. Cheap, robust enough for "is the user talking" detection
    // in a fairly quiet desktop environment. Won't survive a fan, but
    // we've also got the manual Stop button as fallback.
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    const rms = Math.sqrt(sumSq / buf.length);
    const db = 20 * Math.log10(rms || 1e-9);
    const speaking = db > thresholdDb;
    if (speaking) {
      everSpoke = true;
      silentSince = null;
    } else if (everSpoke && silentSince == null) {
      silentSince = performance.now();
    } else if (everSpoke && silentSince != null && !fired) {
      if (performance.now() - silentSince > silenceMs) {
        fired = true;
        onSilenceTrigger && onSilenceTrigger();
        return;     // caller will tear us down via the cleanup fn
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    try { src.disconnect(); } catch { /* already gone */ }
    try { analyser.disconnect(); } catch { /* already gone */ }
    try { ctx.close(); } catch { /* already closed */ }
  };
}

// Returns an object with .start(), .stop() which resolves to a Blob, and
// .cancel() to abort. Throws if the user denies microphone access.
//
// `onAutoStop` fires when the VAD has decided the user's utterance is done
// (1.5 s of trailing silence). The caller is expected to call .stop() right
// after — we don't auto-stop ourselves because some callers (the confirm-
// listener) want a hard maximum-duration cap on top of VAD.
export async function startRecorder({
  onStart, onError, onAutoStop,
  silenceMs = 1500,
} = {}) {
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
  // Attach VAD only if the caller wants the auto-stop callback. We still
  // tear it down on cancel/stop either way.
  const detachVAD = onAutoStop
    ? attachVAD(stream, { silenceMs, onSilenceTrigger: onAutoStop })
    : () => {};
  rec.onstop = () => {
    try {
      detachVAD();
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
      resolveStop(blob);
    } catch (e) { rejectStop(e); }
  };
  rec.onerror = (e) => { detachVAD(); rejectStop(e?.error || new Error("recording failed")); };
  rec.start();
  if (onStart) onStart();
  return {
    mimeType: rec.mimeType || mime || "audio/webm",
    stop: () => { try { rec.stop(); } catch { /* already stopped */ } return stopped; },
    cancel: () => {
      try { rec.stop(); } catch { /* ignore */ }
      detachVAD();
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

// Simple keyword classifier for the post-transcript confirm phrase. The
// user can say anything natural — we look for affirmative words to fire and
// negative words to drop. Order matters because we want "no, cancel" to be
// treated as a cancel (negative wins).
export function classifyConfirmation(text) {
  const t = (text || "").toLowerCase();
  if (/\b(cancel|stop|abort|nevermind|never mind|no|nope|undo)\b/.test(t)) return "cancel";
  if (/\b(run|go|yes|execute|confirm|do it|fire|launch|proceed|okay|ok)\b/.test(t)) return "run";
  return "unknown";
}

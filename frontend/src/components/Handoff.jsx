// Iter-92 — Cross-site handoff receiver page.
//
// LithoForge (or any future sister-app on the allowlist) opens this URL
// in a new tab via `window.open("https://forgeslicer.com/handoff", "_blank")`,
// listens for the "forgeslicer:handoff:ready" message we post back to the
// opener, then sends the STL ArrayBuffer in a single message. We stash
// the payload in the in-memory `pendingImport` slot and route into
// `/workspace?from=<source>`, which is exempt from the auth gate so
// brand-new visitors land directly on the model (guest mode).
//
// Security model
// --------------
// 1. Origin allowlist — `event.origin` must match one of the entries in
//    `ALLOWED_ORIGINS`. Anything else is dropped silently. The list is
//    intentionally hard-coded (vs an env var) because broadening it
//    requires a code review.
// 2. Payload shape validation — the message must be an object with
//    `type === "forgeslicer:handoff:stl"`, a non-empty filename, and
//    either an `ArrayBuffer` `data` field or a `dataUrl` data: URI we
//    can decode locally. We cap at 50 MB.
// 3. One-shot — once we receive a valid payload we tear down the
//    listener so a misbehaving opener can't keep injecting files.
//
// LithoForge integration snippet (drop into LithoForge's "Send to
// ForgeSlicer" button handler):
//
//   const w = window.open("https://forgeslicer.com/handoff", "_blank");
//   const post = () => w.postMessage({
//     type: "forgeslicer:handoff:stl",
//     filename: "my-lithophane.stl",
//     data: stlArrayBuffer,            // OR `dataUrl: "data:application/sla;base64,..."`
//     sourceLabel: "LithoForge",       // shown as attribution chip
//     sourceUrl: "https://lithoforge.com/projects/abc123",
//   }, "https://forgeslicer.com");
//   window.addEventListener("message", (e) => {
//     if (e.origin !== "https://forgeslicer.com") return;
//     if (e.data?.type === "forgeslicer:handoff:ready") post();
//   });

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { setPendingImport } from "../lib/pendingImport";

// Origins we accept handoffs from. Add new entries here when wiring up
// another Forge Suite sister-app. The bare hostnames keep the list
// reviewable; we compare against `event.origin` (which is the full
// `scheme://host[:port]` triple).
const ALLOWED_ORIGINS = [
  "https://lithoforge.com",
  "https://www.lithoforge.com",
  "https://lithoforge.preview.emergentagent.com",
  // LithoForge's current preview/staging URL (pre-domain-cutover).
  "https://color-match-slicer.preview.emergentagent.com",
  // Local dev — same host as preview, so any localhost dev server on
  // either app side can rehearse the flow without code changes.
  "http://localhost:3000",
  "http://localhost:3001",
];

// 50 MB safety cap. Single-mesh lithophanes are typically <5 MB; STLs
// over this likely indicate a runaway export.
const MAX_PAYLOAD_BYTES = 50 * 1024 * 1024;

function decodeDataUrl(dataUrl) {
  // data:[<mediatype>][;base64],<data>
  const match = /^data:([^;]*);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const bin = window.atob(match[2]);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  } catch {
    return null;
  }
}

export default function Handoff() {
  const [status, setStatus] = useState("waiting"); // waiting | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const navigate = useNavigate();
  // Guard against React-StrictMode double-mount creating two listeners.
  const handledRef = useRef(false);

  useEffect(() => {
    function onMessage(event) {
      if (handledRef.current) return;
      // Only react to OUR protocol messages — ignore everything else
      // (React DevTools, browser extensions, etc.) without spamming
      // the console. If the type matches but the origin is wrong, log
      // a warning so the LithoForge dev can see WHY the handoff was
      // dropped (otherwise it just looks like a 20s timeout).
      const isOurProtocol =
        event.data && typeof event.data === "object" &&
        typeof event.data.type === "string" &&
        event.data.type.startsWith("forgeslicer:handoff:");
      if (!isOurProtocol) return;
      if (!ALLOWED_ORIGINS.includes(event.origin)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[forgeslicer/handoff] Dropping message from non-allowlisted origin "${event.origin}". ` +
          `Add it to ALLOWED_ORIGINS in /app/frontend/src/components/Handoff.jsx.`
        );
        return;
      }

      const msg = event.data;
      if (msg.type !== "forgeslicer:handoff:stl") return;

      const filename = String(msg.filename || "model.stl").slice(0, 200);
      if (!/\.(stl|obj|3mf|glb)$/i.test(filename)) {
        handledRef.current = true;
        setStatus("error");
        setErrorMsg(`Unsupported file extension on "${filename}" (need .stl/.obj/.3mf/.glb).`);
        return;
      }

      let buffer = null;
      if (msg.data instanceof ArrayBuffer) {
        buffer = msg.data;
      } else if (ArrayBuffer.isView(msg.data)) {
        // Typed array — extract the underlying buffer slice.
        buffer = msg.data.buffer.slice(msg.data.byteOffset, msg.data.byteOffset + msg.data.byteLength);
      } else if (typeof msg.dataUrl === "string") {
        buffer = decodeDataUrl(msg.dataUrl);
      }

      if (!buffer) {
        handledRef.current = true;
        setStatus("error");
        setErrorMsg("Handoff payload missing or unreadable (need `data: ArrayBuffer` or `dataUrl: \"data:...\"`).");
        return;
      }
      if (buffer.byteLength > MAX_PAYLOAD_BYTES) {
        handledRef.current = true;
        setStatus("error");
        setErrorMsg(`Model is too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB · max 50 MB).`);
        return;
      }

      // Materialise as a File so the existing `importAnyMeshFile`
      // dispatcher works unchanged.
      const file = new File([buffer], filename, { type: "application/octet-stream" });
      const meta = {
        sourceLabel: typeof msg.sourceLabel === "string" ? msg.sourceLabel.slice(0, 60) : "Sister app",
        sourceUrl: typeof msg.sourceUrl === "string" ? msg.sourceUrl.slice(0, 500) : null,
        sourceKey: sourceKeyFromOrigin(event.origin),
      };
      setPendingImport(file, meta);
      handledRef.current = true;
      setStatus("success");
      setSourceLabel(meta.sourceLabel);

      // Acknowledge receipt so the opener can close its tab / show a
      // "Sent!" toast on its side. Best-effort; we don't block on it.
      try {
        event.source?.postMessage(
          { type: "forgeslicer:handoff:received", filename, bytes: buffer.byteLength },
          event.origin,
        );
      } catch {
        // postMessage to a closed window throws — fine to swallow.
      }

      // Brief success flash, then route to the workspace. The
      // `?from=<sourceKey>` flag tells ProtectedRoute to allow guest
      // access (sign-up nudge appears post-import inside Workspace).
      setTimeout(() => {
        navigate(`/workspace?from=${encodeURIComponent(meta.sourceKey)}`, { replace: true });
      }, 600);
    }

    window.addEventListener("message", onMessage);

    // Announce readiness to the opener. We post to "*" because at this
    // point we don't know which allowed origin opened us — the *next*
    // inbound message gets validated by the strict allowlist check
    // above. The ready ping carries no sensitive data.
    //
    // We re-send the ping every second for the first ~5 seconds in
    // case the opener's listener wasn't attached yet when the first
    // ping fired (slow JS startup on the opener side, hydration
    // delays, etc.). Cheap insurance; LithoForge's listener
    // de-duplicates by setting `readyReceived=true`.
    let readyPings = 0;
    const sendReady = () => {
      if (handledRef.current) return;
      if (!window.opener) return;
      try {
        window.opener.postMessage({ type: "forgeslicer:handoff:ready" }, "*");
      } catch {
        // Opener is cross-origin and may reject — we still listen.
      }
    };
    if (window.opener) {
      sendReady();
    } else {
      // Opened directly (no opener) — show guidance instead of waiting forever.
      setStatus("error");
      setErrorMsg(
        "This page is the receiver for a sister-app handoff. " +
        "Open it via your sister app's \"Send to ForgeSlicer\" button instead of typing the URL directly.",
      );
    }
    const readyInterval = setInterval(() => {
      readyPings += 1;
      if (readyPings >= 5 || handledRef.current) {
        clearInterval(readyInterval);
        return;
      }
      sendReady();
    }, 1000);

    // Timeout for waiting state — bumped from 20s to 90s (iter-93)
    // to match LithoForge's 90s side. Large STLs on slow connections
    // can take 30-60 s to fetch + transfer, so 20 s was firing
    // prematurely. 90s lines up with both sides' patience budget.
    const t = setTimeout(() => {
      if (!handledRef.current) {
        setStatus("error");
        setErrorMsg(
          "No payload received from the opener (timed out after 90s). " +
          "If this keeps happening, check the browser console on the LithoForge tab — " +
          "ForgeSlicer logs a warning when it drops a message from a non-allowlisted origin."
        );
      }
    }, 90000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(readyInterval);
      clearTimeout(t);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4" data-testid="handoff-page">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
        <div className="flex items-center justify-center mb-4">
          <img src="/forgeslicer-logo.webp" alt="ForgeSlicer" width={48} height={48} className="rounded shadow-lg shadow-orange-900/30" />
        </div>
        {status === "waiting" && (
          <>
            <div className="w-10 h-10 mx-auto rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center mb-3">
              <Loader2 size={18} className="animate-spin" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight" data-testid="handoff-waiting">Receiving your model…</h1>
            <p className="text-xs text-slate-400 mt-2">Waiting for the sister app to hand off the STL.</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
              <CheckCircle2 size={20} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight" data-testid="handoff-success">Got it! Opening the slicer…</h1>
            <p className="text-xs text-slate-400 mt-2">Imported from {sourceLabel}.</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-10 h-10 mx-auto rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
              <AlertCircle size={20} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight" data-testid="handoff-error">Handoff didn't complete</h1>
            <p className="text-xs text-slate-400 mt-2">{errorMsg}</p>
            <button
              data-testid="handoff-go-workspace"
              onClick={() => navigate("/workspace", { replace: true })}
              className="mt-5 h-10 px-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded"
            >
              Open the slicer anyway
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Maps an allowed origin back to a short identifier used in the
// `?from=<source>` query string and in the workspace attribution chip.
function sourceKeyFromOrigin(origin) {
  if (origin.includes("lithoforge") || origin.includes("color-match-slicer")) return "lithoforge";
  if (origin.includes("localhost")) return "dev";
  return "sister-app";
}

import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, Sparkles, X, Send } from "lucide-react";
import { parseTranscript, executeCommand } from "../lib/voiceCommands";
import { isWhisperSupported, startRecorder, transcribeBlob, classifyConfirmation } from "../lib/whisperStt";

// Hands-free voice flow:
//
//   1. Click Voice once.
//   2. Speak your command. Recording auto-stops after ~1.5 s of silence.
//   3. Whisper transcribes (~1 s).
//   4. Banner shows the transcript; a 2 s grace period gives you a chance
//      to glance at it without doing anything.
//   5. A "Say RUN to execute" mic re-opens and listens briefly (≤4 s).
//      • Say "run / go / yes / execute" → the command fires.
//      • Say "cancel / no / stop" → it's dropped.
//      • Stay silent → the banner stays open and a manual Run / Cancel
//        appears so you can finish by click if you want.
//
// Manual controls (Stop / Cancel / Edit transcript / Run) are kept available
// at every stage as escape hatches.

const SILENCE_TAIL_MS = 1500;   // primary recording auto-stop trigger
const CONFIRM_GRACE_MS = 2000;  // brief pause so user can read transcript
const CONFIRM_WINDOW_MS = 4000; // max length of the confirmation listen
const CONFIRM_SILENCE_MS = 1000;

export default function VoiceButton() {
  const supported = isWhisperSupported();
  // State machine: idle → recording → transcribing → grace → confirming →
  //                confirm-transcribing → manual → parsing → idle (+ feedback)
  const [stage, setStage] = useState("idle");
  const [pendingTranscript, setPendingTranscript] = useState("");
  const [feedback, setFeedback] = useState(null); // { kind, text, heard }
  const [confirmHeard, setConfirmHeard] = useState("");
  const recRef = useRef(null);
  const graceTimer = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    // Cleanup on unmount: kill any active recorder and pending timer.
    return () => {
      if (graceTimer.current) clearTimeout(graceTimer.current);
      if (recRef.current) { try { recRef.current.cancel(); } catch { /* ignore */ } }
    };
  }, []);

  useEffect(() => {
    // When the manual editor opens, autofocus + select for instant typing.
    if (stage === "manual" && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [stage]);

  // ---------- Primary recording (user's command) ----------
  const beginCommandRecording = async () => {
    if (!supported || stage !== "idle") return;
    setFeedback(null);
    setPendingTranscript("");
    setConfirmHeard("");
    try {
      recRef.current = await startRecorder({
        silenceMs: SILENCE_TAIL_MS,
        onAutoStop: () => {
          // VAD fired — wrap recording. We do this inline so the user
          // doesn't need to click. recRef.current.stop() is idempotent
          // (re-stopping a finished recorder no-ops).
          finishCommandRecording();
        },
      });
      setStage("recording");
    } catch (e) {
      setFeedback({ kind: "err", text: e.message || String(e) });
      setTimeout(() => setFeedback(null), 6000);
    }
  };

  const finishCommandRecording = async () => {
    // Allow this to be called from either the auto-stop callback or the
    // manual Stop button. Guarding on stage prevents a race where both fire.
    if (!recRef.current) return;
    setStage("transcribing");
    try {
      const rec = recRef.current;
      recRef.current = null;
      const blob = await rec.stop();
      if (!blob || blob.size < 500) {
        setStage("idle");
        setFeedback({ kind: "warn", text: "Recording too short — try again and speak for at least half a second." });
        setTimeout(() => setFeedback(null), 6000);
        return;
      }
      const text = await transcribeBlob(blob);
      if (!text) {
        setStage("idle");
        setFeedback({ kind: "warn", text: "Whisper returned an empty transcript. Try speaking more clearly or in a quieter environment." });
        setTimeout(() => setFeedback(null), 6000);
        return;
      }
      setPendingTranscript(text);
      setStage("grace");
      // 2-second pause so the user can read the transcript before the
      // confirmation mic re-opens. This is the "pause for two seconds"
      // requested.
      graceTimer.current = setTimeout(() => {
        graceTimer.current = null;
        beginConfirmListening(text);
      }, CONFIRM_GRACE_MS);
    } catch (e) {
      setStage("idle");
      const msg = e?.response?.data?.detail || e?.message || String(e);
      setFeedback({ kind: "err", text: `Transcription failed: ${msg}` });
      setTimeout(() => setFeedback(null), 8000);
    }
  };

  // ---------- Confirmation listening (says "run" / "cancel") ----------
  const beginConfirmListening = async (transcript) => {
    if (!transcript) return;
    setStage("confirming");
    setConfirmHeard("");
    let autoCap = null;
    try {
      recRef.current = await startRecorder({
        silenceMs: CONFIRM_SILENCE_MS,
        onAutoStop: () => finishConfirmListening(transcript),
      });
      // Hard cap on the confirmation window so we don't sit listening
      // forever if the VAD never triggers (e.g. fan noise above threshold).
      autoCap = setTimeout(() => finishConfirmListening(transcript), CONFIRM_WINDOW_MS);
      recRef.current.__autoCap = autoCap;
    } catch (e) {
      // Mic permission failed mid-flow — drop into manual mode.
      // eslint-disable-next-line no-console
      console.warn("Confirm-listen failed, falling back to manual:", e);
      setStage("manual");
    }
  };

  const finishConfirmListening = async (originalTranscript) => {
    if (!recRef.current) return;
    const rec = recRef.current;
    if (rec.__autoCap) clearTimeout(rec.__autoCap);
    recRef.current = null;
    setStage("confirm-transcribing");
    try {
      const blob = await rec.stop();
      let heard = "";
      // Whisper has a non-zero cost per call so we only transcribe if we
      // captured at least a tiny amount of audio. Very short blobs (<500
      // bytes) are nothing-to-say and we drop straight into manual mode.
      if (blob && blob.size >= 500) {
        try { heard = await transcribeBlob(blob); }
        catch (err) {
          // eslint-disable-next-line no-console
          console.warn("confirm transcribe failed:", err);
        }
      }
      setConfirmHeard(heard);
      const cls = classifyConfirmation(heard);
      if (cls === "run") {
        runCommand(originalTranscript);
      } else if (cls === "cancel") {
        setStage("idle");
        setPendingTranscript("");
        setFeedback({ kind: "warn", text: "Cancelled.", heard: originalTranscript });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        // Silence or ambiguous → fall back to manual buttons so the user
        // can finish by click. We do NOT auto-run on ambiguity to avoid
        // surprise mutations to the scene.
        setStage("manual");
      }
    } catch (e) {
      setStage("manual");
      // eslint-disable-next-line no-console
      console.warn("confirm stop failed:", e);
    }
  };

  // ---------- Final action: parse + execute via GPT-5.2 ----------
  const runCommand = async (transcript) => {
    setStage("parsing");
    try {
      const cmd = await parseTranscript(transcript);
      const msg = await executeCommand(cmd);
      setFeedback({ kind: cmd.action === "unknown" ? "warn" : "ok", text: msg, heard: transcript });
    } catch (e) {
      setFeedback({
        kind: "err",
        text: e?.response?.data?.detail || e.message || String(e),
        heard: transcript,
      });
    } finally {
      setStage("idle");
      setPendingTranscript("");
      setConfirmHeard("");
      setTimeout(() => setFeedback(null), 6000);
    }
  };

  // ---------- Manual escape hatches ----------
  const cancelEverything = () => {
    if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
    if (recRef.current) {
      try { recRef.current.cancel(); } catch { /* already stopped */ }
      recRef.current = null;
    }
    setStage("idle");
    setPendingTranscript("");
    setConfirmHeard("");
  };

  // ---------- Render ----------
  if (!supported) {
    return (
      <button
        data-testid="voice-btn"
        title="Voice commands require microphone access (MediaRecorder API)."
        disabled
        className="h-8 px-2.5 rounded text-[11px] font-semibold uppercase tracking-wider border bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed flex items-center gap-1.5"
      >
        <MicOff size={12} /> Voice
      </button>
    );
  }

  const onMainClick = () => {
    if (stage === "idle") beginCommandRecording();
    else if (stage === "recording") finishCommandRecording();
    else cancelEverything();
  };
  const busyStages = ["transcribing", "confirm-transcribing", "parsing"];
  const busy = busyStages.includes(stage);
  const showBanner = stage !== "idle" || feedback;

  const buttonLabel =
    stage === "transcribing" ? "Transcribing…" :
    stage === "confirm-transcribing" ? "Confirming…" :
    stage === "parsing" ? "Thinking…" :
    stage === "recording" ? "Stop" :
    stage === "grace" ? "Cancel" :
    stage === "confirming" ? "Cancel" :
    stage === "manual" ? "Cancel" :
    "Voice";

  return (
    <>
      <button
        data-testid="voice-btn"
        onClick={onMainClick}
        disabled={busy}
        title={
          stage === "recording" ? "Listening… stops automatically when you pause." :
          stage === "grace" ? "Reviewing transcript — say 'Run' or 'Cancel' in a moment." :
          stage === "confirming" ? "Listening for 'Run' or 'Cancel'…" :
          stage === "manual" ? "Voice didn't catch a Run/Cancel — finish by click." :
          "Click and speak. Recording stops when you pause; say 'Run' to execute."
        }
        className={`h-8 px-2.5 rounded text-[11px] font-semibold uppercase tracking-wider border flex items-center gap-1.5 transition-colors ${
          stage === "recording" || stage === "confirming"
            ? "bg-red-500/20 border-red-500/70 text-red-300 animate-pulse"
            : busy
              ? "bg-slate-800 border-slate-700 text-slate-400"
              : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" />
         : stage === "recording" || stage === "confirming" ? <Mic size={12} />
         : <Sparkles size={12} className="text-orange-400" />}
        {buttonLabel}
      </button>

      {showBanner && (
        <div
          data-testid="voice-feedback"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] min-w-[360px] max-w-[680px] px-4 py-3 rounded-md shadow-xl border bg-slate-950/95 backdrop-blur-sm flex items-start gap-3"
          style={{
            borderColor:
              feedback?.kind === "err" ? "#dc2626" :
              feedback?.kind === "warn" ? "#d97706" :
              stage === "recording" || stage === "confirming" ? "#dc2626" :
              busy ? "#f97316" :
              stage === "grace" || stage === "manual" ? "#f97316" :
              "#16a34a",
          }}
        >
          {stage === "recording" || stage === "confirming" ? (
            <Mic size={16} className="text-red-400 animate-pulse mt-0.5" />
          ) : busy ? (
            <Loader2 size={16} className="text-orange-400 animate-spin mt-0.5" />
          ) : stage === "grace" || stage === "manual" ? (
            <Sparkles size={16} className="text-orange-400 mt-0.5" />
          ) : feedback?.kind === "err" ? (
            <MicOff size={16} className="text-red-400 mt-0.5" />
          ) : (
            <Sparkles size={16} className={`mt-0.5 ${feedback?.kind === "warn" ? "text-yellow-400" : "text-green-400"}`} />
          )}
          <div className="flex-1 text-xs min-w-0">
            {/* Stage-specific body */}
            {stage === "recording" && (
              <div className="font-mono text-red-300">Listening… speak now. (Pauses when you stop.)</div>
            )}
            {stage === "transcribing" && (
              <div className="text-orange-300">Transcribing with Whisper…</div>
            )}
            {stage === "grace" && pendingTranscript && (
              <>
                <div className="text-slate-300">Heard:</div>
                <div className="text-white font-mono text-sm mt-0.5 mb-2 italic">"{pendingTranscript}"</div>
                <div className="text-orange-300 font-semibold">Pausing 2 s — get ready to say <span className="text-orange-100">Run</span> or <span className="text-orange-100">Cancel</span>…</div>
              </>
            )}
            {stage === "confirming" && (
              <>
                <div className="text-slate-300">Heard:</div>
                <div className="text-white font-mono text-sm mt-0.5 mb-2 italic">"{pendingTranscript}"</div>
                <div className="font-mono text-red-300 animate-pulse">Listening for <span className="text-white">"Run"</span> or <span className="text-white">"Cancel"</span>…</div>
              </>
            )}
            {stage === "confirm-transcribing" && (
              <>
                <div className="text-slate-300">Heard:</div>
                <div className="text-white font-mono text-sm mt-0.5 mb-2 italic">"{pendingTranscript}"</div>
                <div className="text-orange-300">Checking confirmation…</div>
              </>
            )}
            {stage === "parsing" && (
              <>
                <div className="text-slate-300">Running:</div>
                <div className="text-white font-mono text-sm mt-0.5 italic">"{pendingTranscript}"</div>
              </>
            )}
            {stage === "manual" && (
              <div data-testid="voice-confirm-row">
                <div className="text-orange-300 font-semibold mb-1.5">
                  {confirmHeard
                    ? <>Didn't catch a confirmation (heard <span className="italic text-white">"{confirmHeard}"</span>). Click or edit:</>
                    : <>No confirmation heard. Click Run, edit the transcript, or cancel:</>}
                </div>
                <input
                  ref={editInputRef}
                  data-testid="voice-confirm-input"
                  value={pendingTranscript}
                  onChange={(e) => setPendingTranscript(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runCommand(pendingTranscript);
                    else if (e.key === "Escape") cancelEverything();
                  }}
                  className="w-full bg-slate-900 border border-orange-500/50 rounded text-sm text-white px-2 py-1.5 font-mono focus:outline-none focus:border-orange-400"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    data-testid="voice-confirm-run"
                    onClick={() => runCommand(pendingTranscript)}
                    disabled={!pendingTranscript.trim()}
                    className="h-7 px-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
                  >
                    <Send size={11} /> Run
                  </button>
                  <button
                    data-testid="voice-confirm-cancel"
                    onClick={cancelEverything}
                    className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
                  >
                    <X size={11} /> Cancel
                  </button>
                  <button
                    data-testid="voice-confirm-retry"
                    onClick={() => { cancelEverything(); setTimeout(beginCommandRecording, 60); }}
                    className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
                    title="Discard and re-record"
                  >
                    <Mic size={11} /> Retry
                  </button>
                </div>
              </div>
            )}
            {stage === "idle" && feedback && (
              <>
                {feedback.heard && (
                  <div className="text-slate-400 mb-0.5">
                    Heard: <span className="text-white italic">"{feedback.heard}"</span>
                  </div>
                )}
                <div className={`font-semibold ${
                  feedback.kind === "err" ? "text-red-300" :
                  feedback.kind === "warn" ? "text-yellow-300" :
                  "text-green-300"
                }`}>{feedback.text}</div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

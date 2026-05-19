import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, Sparkles, X, Send } from "lucide-react";
import { parseTranscript, executeCommand } from "../lib/voiceCommands";
import { isWhisperSupported, startRecorder, transcribeBlob } from "../lib/whisperStt";

// Voice command button. Primary path: record audio with MediaRecorder and
// transcribe server-side via OpenAI Whisper (better accent / noise handling
// than Chrome's Web Speech API). Transcript is then shown for review/edit
// before being parsed by GPT-5.2 into a structured CAD command.
//
// Flow:
//   idle  → click → recording (red pulse)
//   recording → click → transcribing (orange spinner)
//   transcribing → confirm banner (editable transcript + Run/Cancel/Retry)
//   confirm → Run → busy (LLM parse) → feedback banner
export default function VoiceButton() {
  const supported = isWhisperSupported();
  const [stage, setStage] = useState("idle"); // idle | recording | transcribing | parsing
  const [feedback, setFeedback] = useState(null); // { kind, text, heard }
  const [pendingTranscript, setPendingTranscript] = useState("");
  const recRef = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (pendingTranscript && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [pendingTranscript]);

  const startRecording = async () => {
    if (!supported || stage !== "idle") return;
    setFeedback(null);
    setPendingTranscript("");
    try {
      recRef.current = await startRecorder();
      setStage("recording");
    } catch (e) {
      setFeedback({ kind: "err", text: e.message || String(e) });
    }
  };

  const finishRecording = async () => {
    if (stage !== "recording") return;
    setStage("transcribing");
    try {
      const blob = await recRef.current.stop();
      recRef.current = null;
      if (!blob || blob.size < 500) {
        setStage("idle");
        setFeedback({ kind: "warn", text: "Recording too short — try again and speak for at least half a second." });
        setTimeout(() => setFeedback(null), 6000);
        return;
      }
      const text = await transcribeBlob(blob);
      setStage("idle");
      if (!text) {
        setFeedback({ kind: "warn", text: "Whisper returned an empty transcript. Try speaking more clearly or in a quieter environment." });
        setTimeout(() => setFeedback(null), 6000);
        return;
      }
      setPendingTranscript(text);
    } catch (e) {
      setStage("idle");
      const msg = e?.response?.data?.detail || e?.message || String(e);
      setFeedback({ kind: "err", text: `Transcription failed: ${msg}` });
      setTimeout(() => setFeedback(null), 8000);
    }
  };

  const cancelRecording = () => {
    if (recRef.current) {
      try { recRef.current.cancel(); } catch { /* already stopped */ }
      recRef.current = null;
    }
    setStage("idle");
    setPendingTranscript("");
  };

  const handleExecute = async (transcript) => {
    setPendingTranscript("");
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
      setTimeout(() => setFeedback(null), 6000);
    }
  };

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

  const onClick = () => {
    if (stage === "idle") startRecording();
    else if (stage === "recording") finishRecording();
  };
  const busy = stage === "transcribing" || stage === "parsing";

  return (
    <>
      <button
        data-testid="voice-btn"
        onClick={onClick}
        disabled={busy}
        title={
          stage === "recording" ? "Click to stop recording" :
          stage === "transcribing" ? "Transcribing with Whisper…" :
          stage === "parsing" ? "Parsing command…" :
          "Click to record a CAD command. Whisper transcribes it; you'll review the text before it runs."
        }
        className={`h-8 px-2.5 rounded text-[11px] font-semibold uppercase tracking-wider border flex items-center gap-1.5 transition-colors ${
          stage === "recording"
            ? "bg-red-500/20 border-red-500/70 text-red-300 animate-pulse"
            : busy
              ? "bg-slate-800 border-slate-700 text-slate-400"
              : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" />
         : stage === "recording" ? <Mic size={12} />
         : <Sparkles size={12} className="text-orange-400" />}
        {stage === "transcribing" ? "Transcribing…"
         : stage === "parsing" ? "Thinking…"
         : stage === "recording" ? "Recording"
         : "Voice"}
      </button>

      {(stage !== "idle" || feedback || pendingTranscript) && (
        <div
          data-testid="voice-feedback"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] min-w-[320px] max-w-[640px] px-4 py-3 rounded-md shadow-xl border bg-slate-950/95 backdrop-blur-sm flex items-start gap-3"
          style={{
            borderColor:
              feedback?.kind === "err" ? "#dc2626" :
              feedback?.kind === "warn" ? "#d97706" :
              pendingTranscript ? "#f97316" :
              stage === "recording" ? "#dc2626" :
              busy ? "#f97316" :
              "#16a34a",
          }}
        >
          {stage === "recording" ? <Mic size={16} className="text-red-400 animate-pulse mt-0.5" />
            : busy ? <Loader2 size={16} className="text-orange-400 animate-spin mt-0.5" />
            : pendingTranscript ? <Sparkles size={16} className="text-orange-400 mt-0.5" />
            : feedback?.kind === "err" ? <MicOff size={16} className="text-red-400 mt-0.5" />
            : <Sparkles size={16} className={`mt-0.5 ${feedback?.kind === "warn" ? "text-yellow-400" : "text-green-400"}`} />}
          <div className="flex-1 text-xs min-w-0">
            {stage === "recording" && (
              <>
                <div className="font-mono text-red-300 mb-1">Recording — click the Voice button (or the button below) when done.</div>
                <button
                  data-testid="voice-stop-btn"
                  onClick={finishRecording}
                  className="h-7 px-3 bg-red-500 hover:bg-red-600 text-white text-[11px] font-semibold rounded inline-flex items-center gap-1.5 uppercase tracking-wider"
                >
                  <Mic size={11} /> Stop
                </button>
                <button
                  data-testid="voice-cancel-recording-btn"
                  onClick={cancelRecording}
                  className="h-7 px-3 ml-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded inline-flex items-center gap-1.5 uppercase tracking-wider"
                >
                  <X size={11} /> Cancel
                </button>
              </>
            )}
            {stage === "transcribing" && (
              <div className="text-orange-300">Transcribing with Whisper…</div>
            )}
            {pendingTranscript && (
              <div data-testid="voice-confirm-row">
                <div className="text-orange-300 font-semibold mb-1.5">Heard — edit if needed, then run:</div>
                <input
                  ref={editInputRef}
                  data-testid="voice-confirm-input"
                  value={pendingTranscript}
                  onChange={(e) => setPendingTranscript(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleExecute(pendingTranscript);
                    else if (e.key === "Escape") setPendingTranscript("");
                  }}
                  className="w-full bg-slate-900 border border-orange-500/50 rounded text-sm text-white px-2 py-1.5 font-mono focus:outline-none focus:border-orange-400"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    data-testid="voice-confirm-run"
                    onClick={() => handleExecute(pendingTranscript)}
                    disabled={!pendingTranscript.trim()}
                    className="h-7 px-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
                  >
                    <Send size={11} /> Run
                  </button>
                  <button
                    data-testid="voice-confirm-cancel"
                    onClick={() => setPendingTranscript("")}
                    className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
                  >
                    <X size={11} /> Cancel
                  </button>
                  <button
                    data-testid="voice-confirm-retry"
                    onClick={() => { setPendingTranscript(""); setTimeout(startRecording, 60); }}
                    className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
                    title="Discard and re-record"
                  >
                    <Mic size={11} /> Retry
                  </button>
                </div>
              </div>
            )}
            {stage === "idle" && !pendingTranscript && feedback && (
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

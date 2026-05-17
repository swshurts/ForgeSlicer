import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, Sparkles } from "lucide-react";
import { getSpeechRecognition, isVoiceSupported, parseTranscript, executeCommand } from "../lib/voiceCommands";

// Click → starts listening; click again to stop. While listening the button
// glows red. After the user stops, the transcript is sent to GPT-5.2 and the
// resulting command is executed against the scene. A small floating banner
// shows the recognized phrase + the action taken so the user knows what
// happened.
export default function VoiceButton() {
  const supported = isVoiceSupported();
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind, text }
  const [livePartial, setLivePartial] = useState("");
  const recogRef = useRef(null);

  useEffect(() => {
    if (!supported) return;
    const SR = getSpeechRecognition();
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (ev) => {
      let interim = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      setLivePartial(interim || final);
      if (final) {
        setLivePartial(final);
        handleFinal(final);
      }
    };
    r.onerror = (e) => {
      setListening(false);
      setFeedback({ kind: "err", text: `Mic error: ${e.error || "unknown"}` });
    };
    r.onend = () => { setListening(false); };
    recogRef.current = r;
    return () => { try { r.abort(); } catch (_) {} };
  }, [supported]);

  const start = () => {
    if (!supported || listening || busy) return;
    setFeedback(null);
    setLivePartial("");
    try { recogRef.current.start(); setListening(true); }
    catch (e) { setFeedback({ kind: "err", text: e.message || String(e) }); }
  };
  const stop = () => {
    try { recogRef.current && recogRef.current.stop(); } catch (_) {}
    setListening(false);
  };

  const handleFinal = async (transcript) => {
    stop();
    setBusy(true);
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
      setBusy(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  };

  if (!supported) {
    return (
      <button
        data-testid="voice-btn"
        title="Voice commands require Chrome or Edge (Web Speech API)."
        disabled
        className="h-8 px-2.5 rounded text-[11px] font-semibold uppercase tracking-wider border bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed flex items-center gap-1.5"
      >
        <MicOff size={12} /> Voice
      </button>
    );
  }

  return (
    <>
      <button
        data-testid="voice-btn"
        onClick={listening ? stop : start}
        disabled={busy}
        title={listening ? "Listening… click to stop" : "Click to speak a CAD command (e.g. 'add a cube 20 by 20 by 20')"}
        className={`h-8 px-2.5 rounded text-[11px] font-semibold uppercase tracking-wider border flex items-center gap-1.5 transition-colors ${
          listening
            ? "bg-red-500/20 border-red-500/70 text-red-300 animate-pulse"
            : busy
              ? "bg-slate-800 border-slate-700 text-slate-400"
              : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : listening ? <Mic size={12} /> : <Sparkles size={12} className="text-orange-400" />}
        {busy ? "Thinking…" : listening ? "Listening" : "Voice"}
      </button>

      {(listening || feedback || livePartial) && (
        <div
          data-testid="voice-feedback"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] min-w-[280px] max-w-[640px] px-4 py-2.5 rounded-md shadow-xl border bg-slate-950/95 backdrop-blur-sm flex items-center gap-3"
          style={{
            borderColor:
              feedback?.kind === "err" ? "#dc2626" :
              feedback?.kind === "warn" ? "#d97706" :
              listening ? "#dc2626" :
              "#16a34a",
          }}
        >
          {listening ? (
            <Mic size={16} className="text-red-400 animate-pulse" />
          ) : busy ? (
            <Loader2 size={16} className="text-orange-400 animate-spin" />
          ) : feedback?.kind === "err" ? (
            <MicOff size={16} className="text-red-400" />
          ) : (
            <Sparkles size={16} className={feedback?.kind === "warn" ? "text-yellow-400" : "text-green-400"} />
          )}
          <div className="flex-1 text-xs">
            {listening && (
              <>
                <div className="font-mono text-red-300">Listening…</div>
                {livePartial && <div className="text-slate-300 mt-0.5 italic">"{livePartial}"</div>}
              </>
            )}
            {!listening && feedback && (
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
                }`}>
                  {feedback.text}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

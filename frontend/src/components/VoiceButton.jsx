import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, Sparkles, X, Send } from "lucide-react";
import { getSpeechRecognition, isVoiceSupported, parseTranscript, executeCommand } from "../lib/voiceCommands";

// Click → starts listening; click again to stop. While listening the button
// glows red. After the user stops speaking, the transcript is shown for
// confirmation/edit (so misrecognitions can be fixed before they fire). The
// confirmed transcript is sent to GPT-5.2 and the resulting command is
// executed against the scene. A small floating banner shows the heard
// phrase + the action taken so the user knows what happened.
export default function VoiceButton() {
  const supported = isVoiceSupported();
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind, text, heard }
  const [livePartial, setLivePartial] = useState("");
  // The transcript pending user confirmation. When non-empty, the banner
  // shows an editable text box + "Execute" / "Cancel" buttons instead of
  // auto-firing — gives users a chance to correct misrecognitions before
  // GPT-5.2 commits to an action. This is the practical fix for accent /
  // ambient-noise issues: the Web Speech API itself can't be "trained".
  const [pendingTranscript, setPendingTranscript] = useState("");
  const recogRef = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (!supported) return;
    const SR = getSpeechRecognition();
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    // Request up to 3 candidates per utterance so we can offer alternatives
    // when the top guess is clearly wrong. Cheap server-side; some browsers
    // ignore the hint, which is fine.
    r.maxAlternatives = 3;
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
        setLivePartial("");
        // Show the transcript in the editable confirm banner instead of
        // firing immediately.
        setPendingTranscript(final.trim());
      }
    };
    r.onerror = (e) => {
      setListening(false);
      setFeedback({ kind: "err", text: `Mic error: ${e.error || "unknown"}` });
    };
    r.onend = () => { setListening(false); };
    recogRef.current = r;
    return () => {
      try { r.abort(); }
      catch (err) {
        // SpeechRecognition.abort() throws InvalidStateError if already
        // stopped — safe to ignore but log once for traceability.
        // eslint-disable-next-line no-console
        console.debug("SpeechRecognition.abort() ignored:", err?.message || err);
      }
    };
  }, [supported]);

  // When the confirm banner opens, focus the input so the user can correct
  // typos immediately via keyboard.
  useEffect(() => {
    if (pendingTranscript && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [pendingTranscript]);

  const start = () => {
    if (!supported || listening || busy) return;
    setFeedback(null);
    setLivePartial("");
    setPendingTranscript("");
    try { recogRef.current.start(); setListening(true); }
    catch (e) { setFeedback({ kind: "err", text: e.message || String(e) }); }
  };
  const stop = () => {
    try { recogRef.current && recogRef.current.stop(); }
    catch (err) {
      // Common in browsers that throw when stopping an already-stopped
      // recognizer. Non-fatal, just continue.
      // eslint-disable-next-line no-console
      console.debug("SpeechRecognition.stop() ignored:", err?.message || err);
    }
    setListening(false);
  };

  const handleExecute = async (transcript) => {
    stop();
    setPendingTranscript("");
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

  const handleCancel = () => {
    setPendingTranscript("");
    setLivePartial("");
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
        title={listening ? "Listening… click to stop" : "Click to speak a CAD command (e.g. 'add a cube 20 by 20 by 20'). You'll get a chance to edit the transcript before it runs."}
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

      {(listening || feedback || livePartial || pendingTranscript) && (
        <div
          data-testid="voice-feedback"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] min-w-[320px] max-w-[640px] px-4 py-3 rounded-md shadow-xl border bg-slate-950/95 backdrop-blur-sm flex items-start gap-3"
          style={{
            borderColor:
              feedback?.kind === "err" ? "#dc2626" :
              feedback?.kind === "warn" ? "#d97706" :
              pendingTranscript ? "#f97316" :
              listening ? "#dc2626" :
              "#16a34a",
          }}
        >
          {listening ? (
            <Mic size={16} className="text-red-400 animate-pulse mt-0.5" />
          ) : busy ? (
            <Loader2 size={16} className="text-orange-400 animate-spin mt-0.5" />
          ) : pendingTranscript ? (
            <Sparkles size={16} className="text-orange-400 mt-0.5" />
          ) : feedback?.kind === "err" ? (
            <MicOff size={16} className="text-red-400 mt-0.5" />
          ) : (
            <Sparkles size={16} className={`mt-0.5 ${feedback?.kind === "warn" ? "text-yellow-400" : "text-green-400"}`} />
          )}
          <div className="flex-1 text-xs min-w-0">
            {listening && (
              <>
                <div className="font-mono text-red-300">Listening…</div>
                {livePartial && <div className="text-slate-300 mt-0.5 italic truncate">"{livePartial}"</div>}
              </>
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
                    else if (e.key === "Escape") handleCancel();
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
                    onClick={handleCancel}
                    className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
                  >
                    <X size={11} /> Cancel
                  </button>
                  <button
                    data-testid="voice-confirm-retry"
                    onClick={() => { handleCancel(); setTimeout(start, 60); }}
                    className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
                    title="Discard and re-record"
                  >
                    <Mic size={11} /> Retry
                  </button>
                </div>
              </div>
            )}
            {!listening && !pendingTranscript && feedback && (
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

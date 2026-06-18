import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2, Sparkles, X, Send, ChevronDown, Zap, Pause, Keyboard } from "lucide-react";
import { parseTranscript, executeCommand } from "../lib/voiceCommands";
import { startRealtimeVoice, checkRealtimeAvailable } from "../lib/realtimeVoice";
import { isWhisperSupported, startRecorder, transcribeBlob, classifyConfirmation } from "../lib/whisperStt";

// Two voice flows — picked from the small chevron menu beside the button:
//
// ── "Single" (default) — one command at a time, with read-back ──
//   1. Click Voice once.
//   2. Speak. Recording auto-stops after ~5 s of silence (iter-100.10:
//      raised from 0.9 s so compound utterances aren't cut mid-clause).
//   3. Whisper transcribes (~1 s).
//   4. Brief 0.6 s pause so you can glance at the transcript.
//   5. A "Say RUN to execute" mic re-opens for ≤4 s.
//      • "run / go / yes / execute" → the command fires.
//      • "cancel / no / stop"       → it's dropped.
//      • Silence / ambiguous        → manual Run / Cancel buttons.
//
// ── "Go" (continuous, hands-free) — chained commands, no confirmation ──
//   1. Click Voice once (in Go mode).
//   2. Speak — command fires as soon as Whisper + GPT return (~3 s).
//   3. Mic auto-reopens; speak the next command. Repeat.
//   4. Exit by saying "stop" / "done" / "exit", clicking Voice, or
//      staying silent for ~20 s.
//
// Manual controls (Stop / Cancel / Edit transcript / Run) remain available
// at every stage as escape hatches in single mode.
//
// Latency target post-fix (single-mode, mic → result): ~10-12 s typical
// (rises slightly with the 5 s silence tail, deliberately).
// Latency target (go-mode, mic → result): ~7 s typical.

const SILENCE_TAIL_MS = 5000;       // primary recording auto-stop trigger
                                    // iter-100.10 — bumped 900 → 5000 ms.
                                    // Users were getting cut off mid-clause
                                    // on compound utterances ("add a 6 mm
                                    // clearance hole 5 mm from each corner
                                    // of the selected item"). 5 s lets a
                                    // user pause to think mid-sentence
                                    // without losing the recording.
const COMMAND_MAX_MS  = 30000;      // hard cap. Lifted in lock-step with
                                    // the silence-tail bump — at 5 s
                                    // silence, a 30 s command floor
                                    // accommodates ~25 s of speech with a
                                    // final 5 s think-pause before the
                                    // VAD takes over.
const CONFIRM_GRACE_MS = 600;       // brief pause so user can read transcript
const CONFIRM_WINDOW_MS = 4000;     // max length of the confirmation listen
const CONFIRM_SILENCE_MS = 700;     // confirmation "yes/no" — kept short on
                                    // purpose; the confirm utterance is
                                    // typically one word.
// Go-mode: how long to show the success feedback before re-recording.
// Short enough to feel continuous, long enough to read "Added cube".
const GO_FEEDBACK_GAP_MS = 700;
// Go-mode: if the user stays silent for this long across consecutive
// no-speech-detected rounds, exit Go mode automatically so the mic
// indicator doesn't pulse forever.
const GO_IDLE_EXIT_MS = 20000;

// iter-103.3 refactor — phrase classifiers, timing knobs, and the
// localStorage mode-pref helpers used to live inline here (~80 lines
// of regex + helpers). They moved to lib/voiceModePhrases.js so the
// main component reads as orchestration logic rather than as
// "regex appendix + orchestration".
import {
  GO_PAUSE_WINDOW_MS,
  GO_PAUSE_SILENCE_MS,
  GO_PAUSE_MAX_MS,
  isGoExitPhrase,
  isGoPausePhrase,
  isResumePhrase,
  readMode,
  writeMode,
} from "../lib/voiceModePhrases";

export default function VoiceButton() {
  const supported = isWhisperSupported();
  // State machine — extended with go-mode counterparts:
  //   idle → recording → transcribing
  //     ↓ (mode==="single") grace → confirming → confirm-transcribing
  //                                            → parsing → idle
  //     ↓ (mode==="go")     parsing → idle (and auto-loops while in go)
  const [stage, setStage] = useState("idle");
  const [pendingTranscript, setPendingTranscript] = useState("");
  // Realtime API state. `realtimeAvail` is null until the mount-time
  // probe finishes; once set, we either route Voice through Realtime
  // (live transcription) or fall back to the legacy MediaRecorder →
  // Whisper flow. `partialTranscript` shows the streaming text in the
  // feedback banner so the user gets sub-second visual confirmation.
  const [realtimeAvail, setRealtimeAvail] = useState(null);
  const [partialTranscript, setPartialTranscript] = useState("");
  const realtimeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    checkRealtimeAvailable().then((res) => {
      if (!cancelled) setRealtimeAvail(res?.available === true);
    });
    return () => { cancelled = true; };
  }, []);
  const [feedback, setFeedback] = useState(null); // { kind, text, heard }
  const [confirmHeard, setConfirmHeard] = useState("");
  // Mode picker. Persisted so the user's choice survives a refresh.
  const [mode, setMode] = useState(readMode);
  const [menuOpen, setMenuOpen] = useState(false);
  // Typed-command popup state — accessibility fallback for noisy
  // rooms or muted mics. Submits through the same runCommand() pipe
  // as Voice, so the PlanPreviewDialog handles multi-step output the
  // same way.
  const [typeOpen, setTypeOpen] = useState(false);
  const [typedText, setTypedText] = useState("");
  const typedInputRef = useRef(null);
  // When the user is actively in Go mode AND the mic loop is running. We
  // use this as a separate flag from `mode` so flipping the dropdown to
  // "single" while a Go session is mid-cycle doesn't tear it down — the
  // current cycle finishes naturally.
  const goRunningRef = useRef(false);
  // Wall-clock anchor for the Go-mode idle-exit timeout — reset on each
  // useful utterance, checked when an empty transcript comes back.
  const goLastUsefulAt = useRef(0);
  // Wall-clock anchor for the Go-mode paused-state hard cap. Set when
  // we enter pause, checked at the start of each paused listen cycle.
  const goPausedSince = useRef(0);
  const recRef = useRef(null);
  const graceTimer = useRef(null);
  const goLoopTimer = useRef(null);
  const editInputRef = useRef(null);

  const setModeAndPersist = (m) => {
    setMode(m);
    writeMode(m);
    setMenuOpen(false);
  };

  useEffect(() => {
    return () => {
      if (graceTimer.current) clearTimeout(graceTimer.current);
      if (goLoopTimer.current) clearTimeout(goLoopTimer.current);
      if (recRef.current) { try { recRef.current.cancel(); } catch { /* ignore */ } }
    };
  }, []);

  useEffect(() => {
    // Click-outside closes the mode menu.
    if (!menuOpen) return;
    const onDown = (e) => {
      if (!e.target.closest?.("[data-testid='voice-mode-menu-wrap']")) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (stage === "manual" && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [stage]);

  // Auto-focus the typed-command textarea when the popup opens, and
  // wire global Escape to close it (so users don't have to mouse to
  // the X button mid-typing).
  useEffect(() => {
    if (!typeOpen) return;
    // Focus on next tick so the element is mounted.
    const t = setTimeout(() => typedInputRef.current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === "Escape") { setTypeOpen(false); setTypedText(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [typeOpen]);

  const submitTyped = () => {
    const text = typedText.trim();
    if (!text) return;
    setTypeOpen(false);
    setTypedText("");
    // Same pipeline as voice: parseTranscript → executeCommand →
    // PlanPreviewDialog for multi-step commands.
    setPendingTranscript(text);
    runCommand(text);
  };

  // ---------- Primary recording (user's command) ----------
  const beginCommandRecording = async () => {
    if (!supported || stage !== "idle") return;
    setFeedback(null);
    setPendingTranscript("");
    setConfirmHeard("");
    setPartialTranscript("");

    // ── Realtime path (preferred when OPENAI_API_KEY is configured) ──
    // Live partial transcripts stream into the feedback banner; when
    // OpenAI's VAD detects a pause, the final transcript is committed
    // and fed through the SAME parseTranscript pipeline as the legacy
    // Whisper path. The handoff is transparent to downstream code.
    if (realtimeAvail) {
      try {
        setStage("recording");
        let finalText = "";
        const session = await startRealtimeVoice({
          onPartial: (delta) => {
            setPartialTranscript((p) => p + delta);
          },
          onFinal: async (text) => {
            // Stop the session as soon as we have the committed text —
            // VAD has already detected the user paused, no need to keep
            // billing audio while we parse the command.
            finalText = (text || "").trim();
            try { session.stop(); } catch (_) { /* noop */ }
            realtimeRef.current = null;
            if (!finalText) {
              await handleEmptyOrShort("No speech detected. Check that your microphone is unmuted and try again.");
              return;
            }
            setPendingTranscript(finalText);
            setPartialTranscript("");
            // Same downstream as the Whisper path — single mode goes
            // through the confirm-listening flow, Go mode runs straight.
            if (mode === "go" && goRunningRef.current) {
              if (isGoExitPhrase(finalText)) { exitGoMode(finalText); return; }
              if (isGoPausePhrase(finalText)) { enterGoPause(finalText); return; }
              goLastUsefulAt.current = performance.now();
              await runCommand(finalText);
            } else {
              setStage("grace");
              graceTimer.current = setTimeout(() => {
                graceTimer.current = null;
                beginConfirmListening(finalText);
              }, CONFIRM_GRACE_MS);
            }
          },
          onError: (msg) => {
            setFeedback({ kind: "err", text: `Realtime voice failed: ${msg}` });
            setTimeout(() => setFeedback(null), 6000);
            realtimeRef.current = null;
            setStage("idle");
            setPartialTranscript("");
          },
          onStateChange: (_st) => { /* could surface in UI; banner already shows stage */ },
        });
        realtimeRef.current = session;
        // Safety cap — if Realtime never commits a final (e.g. user
        // keeps talking past the max command length), force-stop and
        // commit whatever partials we have.
        realtimeRef.current.__autoCap = setTimeout(() => {
          if (realtimeRef.current) {
            const partial = partialTranscript.trim();
            try { realtimeRef.current.stop(); } catch (_) { /* noop */ }
            realtimeRef.current = null;
            if (partial) {
              setPendingTranscript(partial);
              setStage("grace");
              graceTimer.current = setTimeout(() => {
                graceTimer.current = null;
                beginConfirmListening(partial);
              }, CONFIRM_GRACE_MS);
            } else {
              setStage("idle");
            }
          }
        }, COMMAND_MAX_MS);
        return;
      } catch (e) {
        // Realtime failed during setup — fall through to the legacy
        // MediaRecorder + Whisper path so the user isn't left without
        // any voice ability when their OpenAI quota / project tier hits
        // an issue mid-session.
        setFeedback({ kind: "warn", text: `Realtime voice unavailable — falling back to Whisper. (${e.message || e})` });
        setTimeout(() => setFeedback(null), 5000);
        setStage("idle");
      }
    }

    // ── Legacy MediaRecorder → Whisper path ──
    try {
      recRef.current = await startRecorder({
        silenceMs: SILENCE_TAIL_MS,
        onAutoStop: () => finishCommandRecording(),
      });
      recRef.current.__autoCap = setTimeout(() => {
        if (recRef.current) finishCommandRecording();
      }, COMMAND_MAX_MS);
      setStage("recording");
    } catch (e) {
      setFeedback({ kind: "err", text: e.message || String(e) });
      setTimeout(() => setFeedback(null), 6000);
      goRunningRef.current = false;
    }
  };

  const finishCommandRecording = async () => {
    if (!recRef.current) return;
    setStage("transcribing");
    try {
      const rec = recRef.current;
      recRef.current = null;
      if (rec.__autoCap) { clearTimeout(rec.__autoCap); rec.__autoCap = null; }
      const blob = await rec.stop();
      if (!blob || blob.size < 500) {
        await handleEmptyOrShort("Recording too short — try again and speak for at least half a second.");
        return;
      }
      const text = await transcribeBlob(blob);
      if (!text) {
        await handleEmptyOrShort("No speech detected. Check that your microphone is unmuted and try again.");
        return;
      }
      setPendingTranscript(text);

      // ── Branch on mode ──
      //   single: read-back grace pause → confirmation listening
      //   go:     skip confirmation, run immediately, then loop
      if (mode === "go" && goRunningRef.current) {
        if (isGoExitPhrase(text)) {
          exitGoMode(text);
          return;
        }
        if (isGoPausePhrase(text)) {
          enterGoPause(text);
          return;
        }
        goLastUsefulAt.current = performance.now();
        await runCommand(text);
        // runCommand will schedule the next cycle through scheduleGoLoop()
      } else {
        setStage("grace");
        graceTimer.current = setTimeout(() => {
          graceTimer.current = null;
          beginConfirmListening(text);
        }, CONFIRM_GRACE_MS);
      }
    } catch (e) {
      setStage("idle");
      const msg = e?.response?.data?.detail || e?.message || String(e);
      setFeedback({ kind: "err", text: `Transcription failed: ${msg}` });
      setTimeout(() => setFeedback(null), 8000);
      goRunningRef.current = false;
    }
  };

  // Shared "no speech / too short" handler — in single mode shows the
  // warning and returns to idle; in go mode also checks the idle-exit
  // timer and either loops or exits.
  const handleEmptyOrShort = async (msg) => {
    if (mode === "go" && goRunningRef.current) {
      // No useful audio this round — if we've been quiet for too long,
      // exit; otherwise re-start without a feedback toast.
      const idleFor = performance.now() - (goLastUsefulAt.current || 0);
      if (idleFor > GO_IDLE_EXIT_MS) {
        exitGoMode(null, "Go mode ended — no speech for 20 s.");
      } else {
        setStage("idle");
        scheduleGoLoop();
      }
      return;
    }
    setStage("idle");
    setFeedback({ kind: "warn", text: msg });
    setTimeout(() => setFeedback(null), 6000);
  };

  // ---------- Confirmation listening (single mode only: "run" / "cancel") ----------
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
      autoCap = setTimeout(() => finishConfirmListening(transcript), CONFIRM_WINDOW_MS);
      recRef.current.__autoCap = autoCap;
    } catch (e) {
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
      // Single mode: clear feedback after the usual delay.
      // Go mode: schedule the next recording cycle. The feedback toast
      // gets a shorter dismiss so it doesn't visually pile up across
      // multiple chained commands.
      if (mode === "go" && goRunningRef.current) {
        setTimeout(() => setFeedback(null), 2500);
        scheduleGoLoop();
      } else {
        setTimeout(() => setFeedback(null), 6000);
      }
    }
  };

  // ---------- Go-mode loop control ----------
  const scheduleGoLoop = () => {
    if (!goRunningRef.current) return;
    if (goLoopTimer.current) clearTimeout(goLoopTimer.current);
    goLoopTimer.current = setTimeout(() => {
      goLoopTimer.current = null;
      if (goRunningRef.current) beginCommandRecording();
    }, GO_FEEDBACK_GAP_MS);
  };

  const exitGoMode = (heardPhrase, customMsg) => {
    goRunningRef.current = false;
    goPausedSince.current = 0;
    if (goLoopTimer.current) { clearTimeout(goLoopTimer.current); goLoopTimer.current = null; }
    setStage("idle");
    setPendingTranscript("");
    setFeedback({
      kind: "ok",
      text: customMsg || "Go mode ended.",
      heard: heardPhrase || undefined,
    });
    setTimeout(() => setFeedback(null), 3500);
  };

  // ---------- Go-mode pause / resume ----------
  // Enter the paused state. Mic stays open in "listen for keyword
  // only" mode so the user can resume hands-free. There's a 2-minute
  // hard cap (`GO_PAUSE_MAX_MS`) so a forgotten paused session can't
  // record ambient audio forever — after that we auto-exit Go mode.
  const enterGoPause = (heardPhrase) => {
    goPausedSince.current = performance.now();
    setPendingTranscript(heardPhrase || "");
    beginGoPauseListen();
  };

  const beginGoPauseListen = async () => {
    if (!goRunningRef.current) return;
    // Hard cap: too long paused → exit completely.
    if (performance.now() - goPausedSince.current > GO_PAUSE_MAX_MS) {
      exitGoMode(null, "Go mode ended — paused too long.");
      return;
    }
    setStage("go-paused");
    try {
      recRef.current = await startRecorder({
        silenceMs: GO_PAUSE_SILENCE_MS,
        onAutoStop: () => finishGoPauseListen(),
      });
      recRef.current.__autoCap = setTimeout(() => {
        if (recRef.current) finishGoPauseListen();
      }, GO_PAUSE_WINDOW_MS);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Go-pause listen failed:", e);
      exitGoMode(null, "Go mode ended — microphone unavailable.");
    }
  };

  const finishGoPauseListen = async () => {
    if (!recRef.current) return;
    const rec = recRef.current;
    recRef.current = null;
    if (rec.__autoCap) { clearTimeout(rec.__autoCap); rec.__autoCap = null; }
    setStage("go-pause-transcribing");
    try {
      const blob = await rec.stop();
      let heard = "";
      // Skip the Whisper round-trip if nothing was captured — saves the
      // API cost on every silent sub-second of the user's offline task.
      if (blob && blob.size >= 500) {
        try { heard = await transcribeBlob(blob); }
        catch (err) {
          // eslint-disable-next-line no-console
          console.warn("Go-pause transcribe failed:", err);
        }
      }
      if (isResumePhrase(heard)) {
        resumeGoMode(heard);
        return;
      }
      if (isGoExitPhrase(heard)) {
        exitGoMode(heard);
        return;
      }
      // Unrelated speech / silence — keep listening for the keyword.
      beginGoPauseListen();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Go-pause stop failed:", e);
      beginGoPauseListen();
    }
  };

  const resumeGoMode = (heardPhrase) => {
    goPausedSince.current = 0;
    goLastUsefulAt.current = performance.now();
    setPendingTranscript("");
    setFeedback({ kind: "ok", text: "Resumed.", heard: heardPhrase || undefined });
    setTimeout(() => setFeedback(null), 1500);
    // Skip the gap timer — the user has been waiting; go straight to
    // the next recording.
    if (goLoopTimer.current) { clearTimeout(goLoopTimer.current); goLoopTimer.current = null; }
    setStage("idle");
    beginCommandRecording();
  };

  // ---------- Manual escape hatches ----------
  const cancelEverything = () => {
    goRunningRef.current = false;
    if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
    if (goLoopTimer.current) { clearTimeout(goLoopTimer.current); goLoopTimer.current = null; }
    if (recRef.current) {
      try { recRef.current.cancel(); } catch { /* already stopped */ }
      recRef.current = null;
    }
    if (realtimeRef.current) {
      if (realtimeRef.current.__autoCap) {
        clearTimeout(realtimeRef.current.__autoCap);
      }
      try { realtimeRef.current.stop(); } catch { /* already stopped */ }
      realtimeRef.current = null;
    }
    setStage("idle");
    setPendingTranscript("");
    setConfirmHeard("");
    setPartialTranscript("");
  };

  // ---------- Render ----------
  if (!supported) {
    return (
      <button
        data-testid="voice-btn"
        title="Voice commands require microphone access (MediaRecorder API)."
        disabled
        aria-label="Voice command (unsupported)"
        aria-pressed={false}
        className="h-8 px-2.5 rounded text-[11px] font-semibold uppercase tracking-wider border bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed flex items-center gap-1.5"
      >
        <MicOff size={12} /> Voice
      </button>
    );
  }

  const onMainClick = () => {
    if (stage === "idle") {
      if (mode === "go") {
        // Toggle behaviour for Go: first click starts the loop, second
        // click ends it.
        if (goRunningRef.current) {
          exitGoMode(null, "Go mode ended.");
          return;
        }
        goRunningRef.current = true;
        goLastUsefulAt.current = performance.now();
      }
      beginCommandRecording();
    }
    else if (stage === "recording") {
      // Realtime path: stop the session manually — onFinal handler will
      // pick up whatever was committed. Legacy path: finishCommandRecording.
      if (realtimeRef.current) {
        try { realtimeRef.current.stop(); } catch (_) { /* ignore */ }
      } else {
        finishCommandRecording();
      }
    }
    else if (stage === "go-paused") {
      // While paused, clicking the Voice button is a manual resume —
      // gives users an escape hatch when the room is too noisy for the
      // voice-resume to work.
      // Cancel the listen recorder cleanly before resuming.
      if (recRef.current) {
        try { recRef.current.cancel(); } catch { /* ignore */ }
        recRef.current = null;
      }
      resumeGoMode(null);
    }
    else cancelEverything();
  };

  const busyStages = ["transcribing", "confirm-transcribing", "parsing", "go-pause-transcribing"];
  const busy = busyStages.includes(stage);
  const showBanner = stage !== "idle" || feedback;

  const goActive = mode === "go" && (goRunningRef.current || stage !== "idle");
  const isPaused = stage === "go-paused" || stage === "go-pause-transcribing";
  const buttonLabel =
    stage === "transcribing" ? "Transcribing…" :
    stage === "confirm-transcribing" ? "Confirming…" :
    stage === "parsing" ? "Thinking…" :
    stage === "go-pause-transcribing" ? "Checking…" :
    stage === "go-paused" ? "Resume" :
    stage === "recording" ? "Stop" :
    stage === "grace" ? "Cancel" :
    stage === "confirming" ? "Cancel" :
    stage === "manual" ? "Cancel" :
    goActive ? "Voice · Go" :
    mode === "go" ? "Voice" :
    "Voice";

  // Show a faint "Go" pill on the Voice button when Go mode is selected
  // but no cycle is running yet — discoverability without the busy state.
  const showGoBadge = mode === "go" && !goActive && stage === "idle";

  return (
    <div className="relative inline-flex items-center" data-testid="voice-mode-menu-wrap">
      {/* Toolbar Voice button removed — voice recording is now triggered
          from inside the Commands popup. The popup's footer hosts both
          the Voice trigger AND the mode picker, so the toolbar stays
          compact and the user has a single discoverable entry point. */}

      {/* Commands popup trigger — the ONLY voice/command entry in the
          toolbar now. Clicking opens a centered modal with a textarea,
          a VOICE trigger button, and the voice-mode picker. */}
      <button
        data-testid="voice-type-btn"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setTypeOpen((v) => !v); }}
        disabled={busy || stage === "recording" || stage === "confirming"}
        aria-label="Open commands (type, voice, or pick voice mode)"
        aria-haspopup="dialog"
        aria-expanded={typeOpen}
        title="Open Commands — type or use voice"
        className={`h-8 px-2.5 rounded border text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-colors bg-slate-900 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 ${
          typeOpen ? "ring-1 ring-orange-400/60 text-orange-300" : ""
        } ${(busy || stage === "recording" || stage === "confirming") ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <Keyboard size={14} />
        <span>Commands</span>
      </button>

      {/* Toolbar-anchored mode menu DELETED — moved inside the Commands
          popup footer so the popup is the single hub for command-issuing
          decisions. See the popup section below for the new menu. */}

      {typeOpen && (
        <div
          data-testid="voice-type-popup"
          role="dialog"
          aria-label="Type a command"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[210] w-[min(560px,92vw)] bg-slate-950/95 backdrop-blur-sm border border-orange-500/50 rounded-md shadow-2xl p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <Keyboard size={14} className="text-orange-400" />
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">
              Type a command
            </div>
            <button
              data-testid="voice-type-close"
              onClick={() => { setTypeOpen(false); setTypedText(""); }}
              className="ml-auto h-6 w-6 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
              aria-label="Close"
              title="Close (Esc)"
            >
              <X size={13} />
            </button>
          </div>
          <textarea
            ref={typedInputRef}
            data-testid="voice-type-input"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            onKeyDown={(e) => {
              // Enter submits; Shift+Enter inserts a newline so users
              // can paste multi-line plans without firing prematurely.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitTyped();
              }
            }}
            placeholder="e.g. create a faceplate for raspberry pi 4"
            rows={3}
            className="w-full bg-slate-900 border border-slate-700 rounded text-sm text-white px-3 py-2 font-mono focus:outline-none focus:border-orange-400 resize-y"
          />
          <div className="flex items-center justify-between mt-2 gap-2">
            <div className="text-[10px] text-slate-500">
              <span className="text-slate-400">Enter</span> to send · <span className="text-slate-400">Shift+Enter</span> for newline · <span className="text-slate-400">Esc</span> to close
            </div>
            <div className="flex items-center gap-2">
              {/* Voice trigger — actually starts/stops recording. Mirrors
                  the old toolbar Voice button behaviour (Realtime path
                  when available, MediaRecorder+Whisper fallback). Closes
                  the popup on click so the user can watch the listening
                  banner without the popup obscuring the viewport. */}
              <button
                data-testid="voice-btn"
                onClick={() => {
                  setTypeOpen(false);
                  setMenuOpen(false);
                  // Defer one tick so the popup unmount doesn't race the
                  // recorder setup (mic permission prompt etc.).
                  setTimeout(() => onMainClick(), 30);
                }}
                disabled={busy}
                aria-label={mode === "go" ? "Voice command (Go mode)" : "Voice command"}
                aria-pressed={stage === "recording" || stage === "confirming" || goRunningRef.current}
                title={
                  stage === "recording" ? "Listening… stops automatically when you pause." :
                  mode === "go"
                    ? "Go mode — speak commands continuously. Say 'stop' or click to end."
                    : "Click and speak. Recording stops when you pause; say 'Run' to execute."
                }
                className={`h-7 px-2.5 rounded text-[10px] font-semibold uppercase tracking-wider border flex items-center gap-1.5 transition-colors ${
                  stage === "recording" || stage === "confirming"
                    ? "bg-red-500/20 border-red-500/70 text-red-300 animate-pulse"
                    : goActive
                      ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
                      : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {busy ? <Loader2 size={11} className="animate-spin" />
                 : stage === "recording" || stage === "confirming" ? <Mic size={11} />
                 : goActive ? <Zap size={11} className="text-orange-300" />
                 : <Mic size={11} className="text-orange-400" />}
                Voice
              </button>

              {/* Mode chip — opens the Single/Go dropdown. Separate from
                  the Voice trigger so clicking the mic doesn't toggle a
                  menu the user didn't ask for. */}
              <div className="relative" data-testid="voice-mode-menu-wrap-popup">
                <button
                  data-testid="voice-mode-menu-btn"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                  title="Pick voice mode (single command or continuous Go mode)"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className={`h-7 px-1.5 rounded border text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1 transition-colors ${
                    mode === "go"
                      ? "bg-orange-500/15 border-orange-500/50 text-orange-300"
                      : "bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {mode === "go" ? "Go" : "One"}
                  <ChevronDown size={10} />
                </button>
                {menuOpen && (
                  <div
                    data-testid="voice-mode-menu"
                    role="menu"
                    className="absolute bottom-full mb-1 right-0 z-[260] w-64 bg-slate-900 border border-slate-700 rounded shadow-xl overflow-hidden"
                  >
                    <button
                      data-testid="voice-mode-single"
                      role="menuitem"
                      onClick={() => setModeAndPersist("single")}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors ${mode === "single" ? "bg-slate-800/60" : ""}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Sparkles size={12} className={mode === "single" ? "text-orange-300" : "text-slate-500"} />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">Single command</span>
                        {mode === "single" && <span className="ml-auto text-[9px] text-orange-300">●</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                        Speak → confirm with &ldquo;Run&rdquo; → executes. Confirmation step protects against misheard commands.
                      </div>
                    </button>
                    <div className="border-t border-slate-800" />
                    <button
                      data-testid="voice-mode-go"
                      role="menuitem"
                      onClick={() => setModeAndPersist("go")}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors ${mode === "go" ? "bg-slate-800/60" : ""}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Zap size={12} className={mode === "go" ? "text-orange-300" : "text-slate-500"} />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">Go mode (continuous)</span>
                        {mode === "go" && <span className="ml-auto text-[9px] text-orange-300">●</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                        Speak commands back-to-back, no confirmation. Say <span className="text-orange-300">&ldquo;stop&rdquo;</span>, <span className="text-orange-300">&ldquo;done&rdquo;</span>, or click Voice to end.
                      </div>
                    </button>
                  </div>
                )}
              </div>
              <button
                data-testid="voice-type-submit"
                onClick={submitTyped}
                disabled={!typedText.trim()}
                className="h-7 px-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-[11px] font-semibold rounded flex items-center gap-1.5 uppercase tracking-wider"
              >
                <Send size={11} /> Run
              </button>
            </div>
          </div>
        </div>
      )}

      {showBanner && (
        <div
          data-testid="voice-feedback"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] min-w-[360px] max-w-[680px] px-4 py-3 rounded-md shadow-xl border bg-slate-950/95 backdrop-blur-sm flex items-start gap-3"
          style={{
            borderColor:
              feedback?.kind === "err" ? "#dc2626" :
              feedback?.kind === "warn" ? "#d97706" :
              stage === "recording" || stage === "confirming" ? "#dc2626" :
              stage === "go-paused" || stage === "go-pause-transcribing" ? "#eab308" :
              busy ? "#f97316" :
              stage === "grace" || stage === "manual" ? "#f97316" :
              "#16a34a",
          }}
        >
          {stage === "recording" || stage === "confirming" ? (
            <Mic size={16} className="text-red-400 animate-pulse mt-0.5" />
          ) : stage === "go-paused" ? (
            <Pause size={16} className="text-yellow-400 mt-0.5" />
          ) : stage === "go-pause-transcribing" ? (
            <Loader2 size={16} className="text-yellow-400 animate-spin mt-0.5" />
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
            {stage === "recording" && (
              <>
                <div className="font-mono text-red-300">
                  {goActive ? "Listening (Go mode)… speak a command." : "Listening… speak now. (Pauses when you stop.)"}
                </div>
                {/* Live streaming partial — appears character-by-character
                    via the Realtime API. Replaces the old wait-then-poof
                    delay with sub-second visual feedback. */}
                {partialTranscript && (
                  <div
                    data-testid="voice-partial-transcript"
                    className="mt-1 px-2 py-1 bg-slate-950/70 border border-red-500/30 rounded text-[12px] text-slate-100 font-mono"
                  >
                    <span className="text-red-300 mr-1">▌</span>{partialTranscript}
                  </div>
                )}
                {goActive && (
                  <div className="text-[10px] text-slate-400 mt-1">
                    Say <span className="text-orange-300">&ldquo;stop&rdquo;</span> or click Voice to end Go mode.
                  </div>
                )}
              </>
            )}
            {stage === "transcribing" && (
              <div className="text-orange-300">Transcribing with Whisper…</div>
            )}
            {stage === "go-paused" && (
              <>
                <div className="text-yellow-300 font-semibold flex items-center gap-1.5">
                  <Pause size={12} /> Go mode paused.
                </div>
                <div className="text-slate-300 mt-1">
                  Say <span className="text-yellow-200">&ldquo;resume&rdquo;</span>
                  {" / "}<span className="text-yellow-200">&ldquo;continue&rdquo;</span>
                  {" / "}<span className="text-yellow-200">&ldquo;ready&rdquo;</span>
                  {" "}to pick up, or <span className="text-yellow-200">&ldquo;stop&rdquo;</span> to end.
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Or click the Voice button to resume manually. Auto-exits after 2 min.
                </div>
              </>
            )}
            {stage === "go-pause-transcribing" && (
              <div className="text-yellow-300">Listening for &ldquo;resume&rdquo; / &ldquo;stop&rdquo;…</div>
            )}
            {stage === "grace" && pendingTranscript && (
              <>
                <div className="text-slate-300">Heard:</div>
                <div className="text-white font-mono text-sm mt-0.5 mb-2 italic">"{pendingTranscript}"</div>
                <div className="text-orange-300 font-semibold">Get ready to say <span className="text-orange-100">Run</span> or <span className="text-orange-100">Cancel</span>…</div>
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
                    ? <>Didn&apos;t catch a confirmation (heard <span className="italic text-white">&quot;{confirmHeard}&quot;</span>). Click or edit:</>
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
                    Heard: <span className="text-white italic">&quot;{feedback.heard}&quot;</span>
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
    </div>
  );
}

// Voice mode phrase helpers — iter-103.3.
//
// Extracted from VoiceButton.jsx during the iter-103 refactor pass.
// These five helpers + their timing constants are completely pure (no
// React, no store, no DOM). Keeping them here makes VoiceButton.jsx
// readable AND lets future tests exercise the phrase regex matrix
// without booting the full voice pipeline.
//
// What's in here
//   • Constants                — go-mode window/silence/auto-exit timings
//   • isGoExitPhrase(text)     — "stop", "done", "exit voice" → leave go-mode
//   • isGoPausePhrase(text)    — "wait", "pause", "hold on" → pause go-mode
//   • isResumePhrase(text)     — "resume", "continue", "ready" → unpause
//   • readMode() / writeMode() — localStorage persistence for the mode chip
//
// Conservative regexes throughout — we DON'T want "cancel my last
// operation" or "stop the slicer" to be interpreted as an exit. Match
// only when the phrase is the WHOLE utterance (plus optional trailing
// punctuation / "voice" / "listening" suffix).

// ── Timing knobs ────────────────────────────────────────────────────
// Go-mode pause: each listen-for-keyword cycle's max length and tail
// silence. Longer silence than active recording so brief ambient
// sounds (paper rustle, sniff) don't constantly retrigger transcription.
export const GO_PAUSE_WINDOW_MS = 4500;
export const GO_PAUSE_SILENCE_MS = 1500;

// Go-mode pause: hard cap on time in the paused state. After this we
// auto-exit Go mode entirely so a user who walked away with the tab
// open isn't recording ambient audio forever. Two minutes covers
// "let me grab a measurement" without running for a full meeting.
export const GO_PAUSE_MAX_MS = 120000;

// ── Phrase classification ───────────────────────────────────────────
//
// Whisper-related leniency
// ------------------------
// Real-world Whisper transcripts of "stop"-style utterances often arrive
// with hallucinated filler prefixes ("okay", "uh", "just", "please") or
// suffixes ("thank you", "you", "now") — especially on the short, low-
// energy clips that exit phrases produce. The strict ^stop$ regex used
// to require the cleaned utterance to be exactly the exit verb, which
// meant "Okay stop." or "Just stop now." silently passed through to
// `runCommand()` instead of leaving go-mode. iter-108.x widens this in
// two steps: (1) strip the common filler prefix/suffix before matching,
// (2) accept a small set of natural variants ("stop now", "stop please",
// "stop it"). Still conservative — we don't fire on long utterances
// like "stop the slicer" or "cancel my last operation".
function _normalizeForExit(text) {
    let norm = String(text || "").trim().toLowerCase();
    norm = norm.replace(/[.!?,]+/g, " ").replace(/\s+/g, " ").trim();
    // Strip common Whisper hallucinated/filler PREFIX words. Loop in case
    // the model stacked two (e.g. "okay just stop").
    let prev;
    do {
        prev = norm;
        norm = norm.replace(/^(?:okay|ok|alright|right|so|hey|just|um|uh|please|now|well)\s+/, "");
    } while (norm !== prev);
    // Strip Whisper's favorite hallucinated SUFFIX phrases. It loves
    // appending "thank you" or "you" to short/silent audio.
    norm = norm.replace(/\s+(?:thank\s+you|thanks|you)$/, "").trim();
    return norm;
}

export function isGoExitPhrase(text) {
    if (!text) return false;
    const norm = _normalizeForExit(text);
    if (!norm) return false;
    // Safety: don't fire on long utterances — could be a real command
    // that happens to mention "stop" / "cancel".
    if (norm.split(" ").length > 4) return false;
    return /^(stop(?:\s+(?:voice|listening|go(?:\s+mode)?|now|please|it|that|already|here))?|exit(?:\s+(?:voice|go(?:\s+mode)?|now|please))?|done|i'?m\s+done|we'?re\s+done|all\s+done|cancel(?:\s+(?:voice|listening|now|please))?|quit(?:\s+(?:voice|listening))?|end(?:\s+(?:voice|listening|go(?:\s+mode)?))?)$/i.test(norm);
}

export function isGoPausePhrase(text) {
    if (!text) return false;
    const norm = _normalizeForExit(text);
    if (!norm) return false;
    if (norm.split(" ").length > 5) return false;
    return /^(wait(?:\s+(?:a\s+)?(?:sec|second|moment|minute|bit))?|pause(?:\s+voice)?|hold\s+on|one\s+(?:moment|sec|second|minute)|give\s+me\s+(?:a\s+)?(?:sec|second|moment|minute)|hang\s+on)$/i
        .test(norm);
}

export function isResumePhrase(text) {
    if (!text) return false;
    const norm = _normalizeForExit(text);
    if (!norm) return false;
    if (norm.split(" ").length > 5) return false;
    return /^(resume|continue|ready|i'?m\s+back|go\s+again|let'?s\s+(?:continue|go)|okay\s+(?:continue|go)|go\s+ahead|start\s+(?:again|over))$/i
        .test(norm);
}

// ── Mode persistence (localStorage) ────────────────────────────────
export const GO_MODE_KEY = "forgeslicer.voice.mode";

export function readMode() {
  try {
    const v = window.localStorage.getItem(GO_MODE_KEY);
    return v === "go" ? "go" : "single";
  } catch {
    return "single";
  }
}

export function writeMode(v) {
  try {
    window.localStorage.setItem(GO_MODE_KEY, v);
  } catch {
    /* noop — private-mode browsers etc. */
  }
}

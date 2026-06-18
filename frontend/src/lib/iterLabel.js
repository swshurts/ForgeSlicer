// ── ForgeSlicer build / iteration label ──
//
// Single source of truth for the tiny "iter-XXX.Y" tag rendered next to
// the wordmark on the Landing page (and anywhere else we want to surface
// the current development checkpoint).
//
// HOW TO BUMP:
//   When you add a new iteration entry to /app/memory/PRD.md, edit the
//   constant below to match the latest `iter-X.Y` you just appended.
//   Bumping PRD.md WITHOUT bumping this string is the recurring "the
//   iter number is stale" bug — the user has flagged it before. Keep
//   the two in lockstep.
//
// Why a constant and not a build-time parse of PRD.md? PRD.md lives in
// /app/memory (outside /app/frontend/public), so the frontend can't
// fetch it at runtime, and adding a build script to extract it adds
// CRA-eject-level complexity for one line of text. A constant is the
// pragmatic answer.
export const ITER_LABEL = "iter-103.3";

// Iter-103 — last few iterations summarised for the in-app "What's
// new" popover anchored to the iter label on Landing. Keep entries
// short (1-2 sentences, no bullet lists) — the popover stays small
// so it doesn't drown the hero. Order: NEWEST FIRST.
//
// Bump when you bump ITER_LABEL — same edit, two adjacent lines.
export const RECENT_ITERATIONS = [
  {
    id: "iter-103.3",
    date: "2026-02-19",
    title: "Centre-on-bed · 3 new voice templates · refactor",
    summary: "Centre-on-bed button in the Size popover re-anchors merged CSG objects to the origin. Three new voice templates: vise jaws, project enclosure, hose adapter. RightPanel.jsx + VoiceButton.jsx split into focused subfiles.",
  },
  {
    id: "iter-103.2",
    date: "2026-02-19",
    title: "Voice-template merged objects show real dimensions",
    summary: "The Inspector's Size popover used to show 1×1×1 mm for any object that came out of a voice-plan boolean (faceplate, bracket, drawer pull, …). The merged geometry's bbox is now captured into originalBbox so the popover reads real dimensions. Same fix applied to the manual Combine toolbar.",
  },
  {
    id: "iter-103.1",
    date: "2026-02-19",
    title: "Voice 'faceplate' now builds a vertical wall",
    summary: "'Create a faceplate for a RPI4' generates a proper standing front panel with connector-shaped holes — not the flat tray with edge notches the template used to emit. The legacy flat behaviour is still reachable via orientation: 'tray'.",
  },
];


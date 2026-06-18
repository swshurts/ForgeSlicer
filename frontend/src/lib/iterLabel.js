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
export const ITER_LABEL = "iter-102.8";

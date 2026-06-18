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
export const ITER_LABEL = "iter-103";

// Iter-103 — last few iterations summarised for the in-app "What's
// new" popover anchored to the iter label on Landing. Keep entries
// short (1-2 sentences, no bullet lists) — the popover stays small
// so it doesn't drown the hero. Order: NEWEST FIRST.
//
// Bump when you bump ITER_LABEL — same edit, two adjacent lines.
export const RECENT_ITERATIONS = [
  {
    id: "iter-103",
    date: "2026-02-19",
    title: "Snap step controls · Faux design plate",
    summary: "Configurable snap step values (move / rotate / scale) in a new toolbar Settings popover, plus a user-defined oversized 'design plate' (up to ~2 m³) that draws under the printer plate so you can model assemblies bigger than any single bed.",
  },
  {
    id: "iter-102.8",
    date: "2026-02-18",
    title: "STL export keeps chamfered edges",
    summary: "Exported STL / 3MF now include per-edge cube chamfers and fillets instead of falling back to a sharp box. Bug was in the manifold pipeline, not the viewport.",
  },
  {
    id: "iter-102.7",
    date: "2026-02-18",
    title: "Per-edge chamfer fixed on 6 of 12 cube edges",
    summary: "Chamfering the front-right, back-left, and four diagonal-sign edges no longer destroys the cube. Manifold's CrossSection wanted CCW polygons; the prism triangle was wound the wrong way for half the edges.",
  },
];


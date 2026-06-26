// ── ForgeSlicer build / iteration label ──
//
// Single source of truth for the tiny "iter-XXX.Y" tag rendered next to
// the wordmark on the Landing page.
//
// AS OF ITER-105.25 — this constant is the FALLBACK only. The live
// label is fetched at runtime from `GET /api/release/current`, which
// parses `/app/memory/CHANGELOG.md` for the newest `## Iteration X.Y`
// heading. That endpoint is the canonical source — bump the changelog
// and the displayed label updates on the next page load with NO code
// change required. The constant below is only used when the backend
// is unreachable (cold dev startup, offline preview, etc.).
//
// If you find yourself editing the constant in this file because the
// displayed iter is stale, STOP and check whether `/api/release/current`
// is responding — that's the real failure mode now.
export const ITER_LABEL = "iter-105.25";

// Iter-103 — last few iterations summarised for the in-app "What's
// new" popover anchored to the iter label on Landing. Keep entries
// short (1-2 sentences, no bullet lists) — the popover stays small
// so it doesn't drown the hero. Order: NEWEST FIRST.
//
// Bump when you bump ITER_LABEL — same edit, two adjacent lines.
export const RECENT_ITERATIONS = [
  {
    id: "iter-105.14",
    date: "2026-03-12",
    title: "Multi-Image AI → STL · 3 photos to mesh",
    summary: "New third tab in the AI Generate dialog (alongside From Text / From Image). Upload 2–4 orthographic photos (Front / Side / Top / Extra) and Meshy AI fuses them into a single 3D mesh. Quota refunds on upstream failure so you don't lose a credit to a degenerate kick-off.",
  },
  {
    id: "iter-105.13",
    date: "2026-03-05",
    title: "Per-face image picker · LithoForge inbox",
    summary: "Texture Library gets a Per-face wrap mode for cubes — independent texture per face via a cube-net layout. Lithophanes finished on LithoForge.net now land in a ForgeSlicer inbox toast with a one-click Open onto the build plate. Sonner toasts repositioned to the top centre.",
  },
  {
    id: "iter-105.10",
    date: "2026-03-01",
    title: "Single-face wrap · Mesh-detail · Lithophane preset",
    summary: "Apply-to-face selector lets you pick just one cube face for relief (5 sides stay flat → tiny STLs). Mesh-detail Draft / Standard / High row trades STL size for surface fidelity. ✨ Lithophane preset button in the Texture dialog one-clicks the optimal back-lit setup.",
  },
  {
    id: "iter-105.5",
    date: "2026-02-28",
    title: "Texture system v3 — custom image uploads",
    summary: "Drag-and-drop any PNG / JPG / WebP into the new \"My Textures\" tab — it becomes a printable height-relief texture wrappable onto sphere / cube / cylinder / cone. Built-in patterns now share the same heightmap pipeline so coverage and fidelity match. Cube edge gaps fixed.",
  },
];

// Tip-of-the-day library + persistence helpers.
//
// Used by Workspace.jsx to surface short, dismissible tips that
// announce features the user might not have discovered yet. Each tip:
//   • `id`          — stable string used as the persistence key
//   • `title`       — bold first line of the toast
//   • `description` — softer second line; can be plain text or JSX
//   • `cta` (opt.)  — { label, run({ openSettings, openHelp }) } a single
//                     primary action button. Receives helpers from the
//                     caller (Workspace.jsx) so tips can deep-link into
//                     dialogs without importing component state directly.
//
// We persist a SET of seen tip ids (not a counter) so adding new tips
// later doesn't accidentally mark them as already-shown. Migration from
// the iter-67 single-key flag `forge.tip.savePref.dismissed` happens
// transparently in `loadSeen()`.
const LS_SEEN = "forge.tips.seen";          // JSON array of ids
const LS_LEGACY_SAVEPREF = "forge.tip.savePref.dismissed"; // iter-67 flag

// Order matters — `pickNextUnseen` walks this in declaration order, so
// the first tip a fresh user sees is the FIRST entry. Tips that target
// signed-in-only features (e.g. cloud save) should specify
// `requiresAuth: true` so anonymous users skip them.
export const TIPS = [
  {
    id: "save-pref",
    title: "Tip: Ctrl+S saves locally by default",
    description:
      "You can change the keyboard shortcut to save to your cloud project instead — or both — under Settings → Saving.",
    requiresAuth: true,
    cta: {
      label: "Open settings",
      run: ({ openSettings }) => openSettings("saving"),
    },
  },
  {
    id: "save-mine-default",
    title: "Save your printer as the default",
    description:
      "In the Print tab on the right, click ★ Set default next to your printer dropdown so it auto-loads every time. Hit Save Mine to also publish it for other makers.",
  },
  {
    id: "hierarchical-projects",
    title: "Organize designs as Rocket → Engine → Fuel Pump",
    description:
      "Open the Projects icon in the toolbar to build a hierarchical tree of related parts. Each node holds its own scene; drag rows to re-parent.",
    requiresAuth: true,
  },
  {
    id: "breadcrumb-jump",
    title: "Click breadcrumb ancestors to swap scenes",
    description:
      "Once you've opened a nested project, the topbar shows the full ancestry — click any parent to instantly load that project's scene.",
    requiresAuth: true,
  },
  {
    id: "engine-compare",
    title: "Compare engines side-by-side",
    description:
      "In the Slicer popover, hit Compare engines (Built-in vs Orca) to slice with both and see the per-metric trade-offs. Bonus: a Toolpaths tab overlays both engines' layers with diff highlighting.",
  },
  {
    id: "ruler-pin",
    title: "Pin ruler measurements to your design",
    description:
      "After dropping the Anchored Ruler, click Save measurement to pin the dimension permanently — it persists into your .forge.json so other people see it too.",
  },
  {
    id: "voice-commands",
    title: "Voice commands work hands-free",
    description:
      "Hit the VOICE button in the topbar and try \"add a cube\", \"subtract a sphere from the cube\", or \"save as component\".",
  },
  {
    id: "send-to-orca",
    title: "Hand off to a desktop slicer in one click",
    description:
      "The Send to OrcaSlicer button (and its dropdown for Bambu Studio / PrusaSlicer / Cura) bundles your scene as a 3mf and opens it directly in the desktop app.",
  },
  {
    id: "sketch-sweep",
    title: "2D sketches can sweep into 3D",
    description:
      "Hop into Sketch mode, draw a profile, then Sweep along a Spline path to make pipes, vases, threaded shapes — anything the primitives can't.",
  },
  {
    id: "help-shortcut",
    title: "Press ? anytime for the full manual",
    description:
      "The Help dialog has PDF tutorials, a voice command lexicon, and keyboard-shortcut cheatsheet.",
  },
];

// Read the persisted set of seen tip ids. Returns a Set<string>.
// Handles legacy migration: if the iter-67 savePref dismissal flag is
// set, we pre-seed the seen list so existing users don't get bothered
// by the same tip a second time.
export function loadSeen() {
  if (typeof window === "undefined" || !window.localStorage) return new Set();
  let seen = [];
  try {
    const raw = window.localStorage.getItem(LS_SEEN);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) seen = arr.filter((s) => typeof s === "string");
    }
  } catch { /* corrupt — start fresh */ }
  // Iter-67 migration.
  try {
    if (window.localStorage.getItem(LS_LEGACY_SAVEPREF) === "true") {
      if (!seen.includes("save-pref")) seen.push("save-pref");
    }
  } catch { /* noop */ }
  return new Set(seen);
}

export function markSeen(id) {
  if (typeof window === "undefined" || !window.localStorage) return;
  const seen = loadSeen();
  seen.add(id);
  try {
    window.localStorage.setItem(LS_SEEN, JSON.stringify(Array.from(seen)));
  } catch { /* quota or blocked — silent */ }
}

// Reset the seen set entirely (used by the "Show all tips again" hook
// behind the Help dialog if we ever add one). Currently unused but kept
// as the documented escape hatch.
export function resetSeen() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(LS_SEEN);
    window.localStorage.removeItem(LS_LEGACY_SAVEPREF);
  } catch { /* noop */ }
}

// Pick the first tip the user hasn't seen yet that's eligible for
// their auth state. Returns null when nothing's left to show.
export function pickNextUnseen({ isSignedIn } = {}) {
  const seen = loadSeen();
  for (const t of TIPS) {
    if (seen.has(t.id)) continue;
    if (t.requiresAuth && !isSignedIn) continue;
    return t;
  }
  return null;
}

// Convenience: total / remaining counts for a small "Tip 3 of 9"
// footer that the toast renders.
export function tipProgress({ isSignedIn } = {}) {
  const seen = loadSeen();
  const visible = TIPS.filter((t) => !t.requiresAuth || isSignedIn);
  const seenCount = visible.filter((t) => seen.has(t.id)).length;
  return { seen: seenCount, total: visible.length };
}

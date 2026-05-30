// Map a scene-object's primitive type to the most relevant tutorial PDF.
//
// Used by the right-click context menu to surface a one-click
// "Open relevant tutorial" item. Returns null when no tutorial obviously
// applies (e.g. a generic imported STL with no special primitive lineage)
// so the menu item can be hidden rather than show a generic fallback.
//
// Keep this mapping deliberately narrow — we want the suggestion to FEEL
// targeted ("you clicked a sweep, here's the sweep tutorial"). Adding a
// catch-all "Getting Started" suggestion to every object would dilute the
// signal and train users to ignore the item.
//
// Tutorial filenames must match the static PDFs at
// `/app/frontend/public/docs/`. Keep this list in sync with
// `frontend/src/components/toolbar/HelpMegaMenu.jsx` (TUTORIALS export).
export const TUTORIAL_BY_TYPE = {
  // Sweep-family objects → Sweep + Sketch tutorial
  sweep:        { file: "ForgeSlicer-Sweep-Tutorial.pdf",   title: "Sweep + Sketch" },
  sketch:       { file: "ForgeSlicer-Sweep-Tutorial.pdf",   title: "Sweep + Sketch" },
  // Fastener composite (Slot/FastenerPair/Hex pocket etc.) → Hardware tutorial
  fastener:     { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  fastenerPair: { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  countersink:  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  hexPocket:    { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  slot:         { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  gusset:       { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  // Anything with a texture flag carries a textured surface → Texture tutorial
  // (detected by caller via obj.texture, not type)
};

/**
 * Resolve the best tutorial suggestion for a single scene object. Returns
 *   { file, title }
 * or null if no suggestion. We prefer texture > primitive type so a
 * textured cube routes to the Texture tutorial rather than the (non-existent)
 * cube tutorial.
 */
export function suggestTutorialFor(obj) {
  if (!obj) return null;
  if (obj.texture && obj.texture.pattern) {
    return { file: "ForgeSlicer-Texture-Tutorial.pdf", title: "Texture Library" };
  }
  const t = obj.type;
  if (t && TUTORIAL_BY_TYPE[t]) return TUTORIAL_BY_TYPE[t];
  return null;
}

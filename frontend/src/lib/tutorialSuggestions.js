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
  // Hardware: primitive types emitted by buildFastenerPair (bolt + nut),
  // PLUS the composite-name fallbacks used by groupId/groupName matching
  // below. We list both so a stand-alone bolt (added via add-bolt-positive-btn)
  // also surfaces the Hardware tutorial.
  bolt:         { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  nut:          { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  fastener:     { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  fastenerPair: { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  countersink:  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  hexPocket:    { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  slot:         { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  gusset:       { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  // Anything with a texture flag carries a textured surface → Texture tutorial
  // (detected by caller via obj.texture, not type)
};

// Group-id / group-name prefixes that map a composite child back to its
// "logical" tutorial. composites.js uses short groupId prefixes (`slot-`,
// `fastener-`, `cs-`, `hexp-`, `gus-`) and human-readable groupNames
// ("Slot 20×20×20", "Fastener Pair", "Countersink", "Hex Pocket", "Gusset").
// We match against EITHER so a future rename of the groupId stays robust.
const HARDWARE_TUT = { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" };
const GROUP_PREFIX_TUTORIALS = [
  // Fastener pair — groupId `fastener-…`, groupName "Fastener Pair"
  { idRe: /^fastener-/i, nameRe: /^fastener/i, tutorial: HARDWARE_TUT },
  // Slot — groupId `slot-…`, groupName "Slot …"
  { idRe: /^slot-/i,     nameRe: /^slot/i,     tutorial: HARDWARE_TUT },
  // Countersink — groupId `cs-…`, groupName "Countersink"
  { idRe: /^cs-/i,       nameRe: /^countersink/i, tutorial: HARDWARE_TUT },
  // Hex pocket — groupId `hexp-…`, groupName "Hex Pocket"
  { idRe: /^hexp-/i,     nameRe: /^hex[\s-]?pocket/i, tutorial: HARDWARE_TUT },
  // Gusset — groupId `gus-…`, groupName "Gusset"
  { idRe: /^gus-/i,      nameRe: /^gusset/i,   tutorial: HARDWARE_TUT },
];

/**
 * Resolve the best tutorial suggestion for a single scene object. Priority:
 *   1. Texture flag → Texture tutorial
 *   2. Primitive type direct hit (sweep, sketch, bolt, nut, …)
 *   3. Composite-group membership (groupId or groupName prefix match)
 * Returns { file, title } or null when nothing applies.
 */
export function suggestTutorialFor(obj) {
  if (!obj) return null;
  if (obj.texture && obj.texture.pattern) {
    return { file: "ForgeSlicer-Texture-Tutorial.pdf", title: "Texture Library" };
  }
  const t = obj.type;
  if (t && TUTORIAL_BY_TYPE[t]) return TUTORIAL_BY_TYPE[t];
  // Composite-group fallback — buildFastenerPair / buildSlot etc. set a
  // groupId like "fastener-<ts>" or "slot-<ts>" and a groupName like
  // "Slot 20×20×20". Walk the rules and return on first match.
  const gid = obj.groupId || "";
  const gname = obj.groupName || "";
  for (const rule of GROUP_PREFIX_TUTORIALS) {
    if (rule.idRe.test(gid) || rule.nameRe.test(gname)) {
      return rule.tutorial;
    }
  }
  return null;
}

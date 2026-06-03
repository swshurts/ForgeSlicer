// Iter-87 — Composite-primitive action slice.
//
// Extracted from `lib/store.js` (was ~50 lines of repeated `pushHistory
// + buildX + set` boilerplate inlined into the main store factory).
// Each composite drop = one undo step containing the entire assembly,
// matching the user's mental model of "one click, one click to undo".
//
// All five composites follow the same template:
//   1. Push history (so undo restores the pre-composite scene).
//   2. Call the matching pure builder in `lib/composites.js`.
//   3. Append the returned parts to `objects`, select them all.
//   4. Return the assembly's `groupId` so callers can target it
//      (rename, reposition, ungroup later).
//
// Wire-up: `lib/store.js` imports `createCompositeActions` and spreads
// the returned object into the Zustand store, exactly mirroring how
// `createRulerActions` is wired (iter-74 precedent).

export function createCompositeActions({ get, set, deps }) {
  const {
    buildFastenerPair, buildCountersink, buildHexPocket,
    buildGusset, buildSlot, buildPrimitive, newId,
  } = deps;

  // Shared `set()` body used by all five actions — keeps the assembly
  // in selectedIds + makes the first part the primary selection.
  const appendAndSelect = (parts, primaryId) => (s) => ({
    objects: [...s.objects, ...parts],
    selectedId: primaryId,
    selectedIds: parts.map((p) => p.id),
  });

  // Build → push history → set → return groupId. One helper, five
  // composites — eliminates the ~50 lines of repeat boilerplate the
  // pre-extraction store carried.
  const compose = (builder) => (opts = {}) => {
    get().pushHistory();
    const { parts, groupId, primaryId } = builder(opts, { buildPrimitive, newId });
    set(appendAndSelect(parts, primaryId));
    return groupId;
  };

  return {
    // Bolt + Nut + 2 negative bore cylinders pre-grouped. M10-ish defaults.
    addFastenerPair: compose(buildFastenerPair),
    // Countersink (positive cone + negative cylinder) for flush-mount screws.
    addCountersink: compose(buildCountersink),
    // Hex pocket — negative hexagonal prism for captive nuts.
    addHexPocket: compose(buildHexPocket),
    // Right-triangle gusset for reinforcing 90° corner joints.
    addGusset: compose(buildGusset),
    // Slot / racetrack hole (positive or negative). `modifier` is folded
    // into the opts so the builder picks the right colorIndex.
    addSlot: (modifier = "negative", overrides = {}) => {
      get().pushHistory();
      const { parts, groupId, primaryId } = buildSlot(
        { modifier, ...overrides },
        { buildPrimitive, newId },
      );
      set(appendAndSelect(parts, primaryId));
      return groupId;
    },
  };
}

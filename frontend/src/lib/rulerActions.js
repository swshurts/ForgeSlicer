// Anchored-ruler action slice — extracted from store.js for clarity.
// Uses Zustand's standard "slice" composition pattern: this module
// exports a factory `createRulerActions(set, get)` that returns the
// action object spread into the main `useScene` store.
//
// Why split this out:
//   • The ruler/anchor system has its own state (anchor, target,
//     axes mode, snap kinds, pinned dims) and ~10 actions — that's a
//     coherent subsystem.
//   • Composite-primitive and CSG actions stay in `store.js` because
//     they need access to a wider slice of state. The ruler is
//     self-contained.
//   • `rulerRefStillValid` (the post-removal validation) also lives
//     here so the bbox-only / object-only callers can import it
//     without dragging in the rest of the store.

/**
 * Decide whether a ruler-anchor / ruler-target record still points at a
 * resolvable object after a batch of removals. A record's `objId` may
 * be EITHER a real `obj.id` OR a `groupId` (when the anchor was placed
 * on an assembly child). The record stays valid iff there is still an
 * object with that id, OR at least one object whose `groupId` matches.
 * We treat the removeSet as already-applied (callers pass the set BEFORE
 * filtering `s.objects`, but we accept either — we just check the
 * post-remove set).
 *
 * Exported because callers in `store.js` invoke it on every object
 * removal to decide whether to clear the active ruler / dimension.
 */
export function rulerRefStillValid(rec, allObjects, removeSet) {
  if (!rec) return true; // nothing to invalidate
  const remaining = allObjects.filter((o) => !removeSet.has(o.id));
  const id = rec.objId;
  if (remaining.some((o) => o.id === id)) return true;
  if (remaining.some((o) => o.groupId === id)) return true;
  return false;
}

/**
 * Factory: returns the ruler-action methods to spread into the main
 * `useScene` store. Pattern mirrors Zustand's "slice composition"
 * recipe — we hand the slice the same `(set, get)` the parent store
 * has, so the actions can read / write any shared state when needed.
 */
export function createRulerActions(set, get) {
  return {
    setRulerMode: (on) => set({ rulerMode: !!on, rulerHoverSnap: null }),
    // Iter-126 — single hover-preview snap. Set via SceneObject's
    // onPointerMove; cleared on pointer-out and mode-change so we never
    // leak a stale ring after the user disables the tool.
    setRulerHoverSnap: (snap) => set({ rulerHoverSnap: snap || null }),
    clearRulerHoverSnap: () => set({ rulerHoverSnap: null }),
    // Anchor snap-point — caller computes via nearestSnapPoint() and
    // hands us the full record. Resets the target on every new anchor
    // so the user starts the second-click flow fresh.
    setRulerAnchor: (anchor) => set({ rulerAnchor: anchor || null, rulerTarget: null }),
    clearRulerAnchor: () => set({ rulerAnchor: null, rulerTarget: null }),
    // Target snap-point — the second click. Most-recent click wins.
    setRulerTarget: (target) => set({ rulerTarget: target || null }),
    clearRulerTarget: () => set({ rulerTarget: null }),
    // Cycle the visible axes: xyz → x → y → z → xyz. Matches the
    // hamburger-icon toggle on the TinkerCAD ruler HUD.
    cycleRulerAxes: () => {
      const order = ["xyz", "x", "y", "z"];
      const cur = get().rulerAxesMode || "xyz";
      const next = order[(order.indexOf(cur) + 1) % order.length];
      set({ rulerAxesMode: next });
    },
    // Toggle one snap-kind on/off. Refuses to disable the last enabled
    // kind (we'd have nothing to snap to). 'corner' / 'edge' / 'face' / 'center'.
    toggleRulerSnapKind: (kind) => {
      const cur = get().rulerSnapKinds || [];
      if (cur.includes(kind)) {
        if (cur.length <= 1) return; // keep at least one
        set({ rulerSnapKinds: cur.filter((k) => k !== kind) });
      } else {
        set({ rulerSnapKinds: [...cur, kind] });
      }
    },
    // Save the current anchor + target as a persistent pinned measurement.
    // Clears ONLY the target (anchor stays) so the user can chain several
    // measurements from the same starting point — e.g. read distances
    // from the front-left corner of a plate to each of its mounting holes.
    pinRulerMeasurement: () => {
      const s = get();
      if (!s.rulerAnchor || !s.rulerTarget) return null;
      const id = `pin-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      set({
        pinnedRulerDims: [...(s.pinnedRulerDims || []), {
          id,
          anchor: s.rulerAnchor,
          target: s.rulerTarget,
        }],
        rulerTarget: null,
      });
      return id;
    },
    removePinnedRulerDim: (id) => set((s) => ({
      pinnedRulerDims: (s.pinnedRulerDims || []).filter((d) => d.id !== id),
    })),
    clearPinnedRulerDims: () => set({ pinnedRulerDims: [] }),
  };
}

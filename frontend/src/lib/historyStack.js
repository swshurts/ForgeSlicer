// Pure undo/redo helpers — extracted from `store.js`.
//
// The Zustand store keeps two arrays: `history` (past snapshots) and
// `redoStack` (snapshots that have been undone). Every mutating
// action pushes a fresh clone onto `history` first; `undo` pops the
// top of `history` into `redoStack`; `redo` does the reverse.
//
// `cloneObjects` is the canonical "deep copy a scene snapshot" — it
// preserves typed-array references for imported geometry (those are
// effectively immutable inside the store) while deep-cloning the
// per-object transform fields so mutations to one timeline don't
// bleed into others.

export const HISTORY_LIMIT = 60;

/**
 * Deep-clone an `objects` array for history storage.
 *
 * Per-object position / rotation / scale / dims are deep-copied so
 * future in-place mutations (none today, but defensive) won't reach
 * the snapshot. `geometry.vertices` / `geometry.indices` are typed
 * arrays from imports — those are treated as immutable and shared
 * by reference, which saves a lot of memory on large STL imports.
 */
export function cloneObjects(objects) {
  return objects.map((o) => ({
    ...o,
    position: [...o.position],
    rotation: [...o.rotation],
    scale: [...o.scale],
    // For sweep objects, the nested `profile` / `path` descriptors
    // also need deep-cloning so undo/redo doesn't share references
    // with the live store. All other primitive types have flat
    // `dims` and a shallow copy is sufficient.
    dims: o.type === "sweep"
      ? {
          ...o.dims,
          profile: o.dims.profile ? { ...o.dims.profile } : undefined,
          path: o.dims.path ? { ...o.dims.path } : undefined,
        }
      : { ...o.dims },
    originalBbox: o.originalBbox ? { ...o.originalBbox } : undefined,
    geometry: o.geometry
      ? {
          vertices: o.geometry.vertices,
          indices: o.geometry.indices,
        }
      : undefined,
  }));
}

/**
 * Compute the next history-stack state when a mutation is about to
 * happen. Caller is expected to pass the current state slice; we
 * return `{ history, redoStack }` to merge back.
 *
 * Trims the history to `HISTORY_LIMIT` snapshots (oldest dropped)
 * to keep memory bounded on long editing sessions.
 *
 * Always clears the redo stack — the moment the user performs a NEW
 * action after an undo, the "future" branch is discarded.
 */
export function pushHistoryState(history, objects) {
  const snap = cloneObjects(objects);
  const next = [...history, snap];
  if (next.length > HISTORY_LIMIT) next.shift();
  return { history: next, redoStack: [] };
}

/**
 * Compute the next state when the user hits Undo.
 * Returns `null` if there's nothing to undo (history empty).
 */
export function undoState(history, redoStack, objects) {
  if (history.length === 0) return null;
  const last = history[history.length - 1];
  const cur = cloneObjects(objects);
  return {
    objects: last,
    history: history.slice(0, -1),
    redoStack: [...redoStack, cur],
  };
}

/**
 * Compute the next state when the user hits Redo.
 * Returns `null` if there's nothing to redo.
 */
export function redoState(history, redoStack, objects) {
  if (redoStack.length === 0) return null;
  const next = redoStack[redoStack.length - 1];
  const cur = cloneObjects(objects);
  return {
    objects: next,
    redoStack: redoStack.slice(0, -1),
    history: [...history, cur],
  };
}

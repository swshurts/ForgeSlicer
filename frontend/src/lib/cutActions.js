// Cut-plane action — extracted from `store.js`.
//
// Builds the new "imported mesh" pieces produced by slicing each
// selected object with the current cut plane. Returns:
//   { newObjects, errors, removedIds }
//
// The store action is the thin wrapper that pushHistory's and
// commits the delta (so the whole multi-piece cut lands as a single
// undo step).
//
// Prefers the manifold-3d worker pipeline (`cutObjectByPlaneAsync`)
// for guaranteed-watertight output, with a synchronous BVH fallback
// (`cutObjectByPlane`) for the rare case the worker rejects (corrupted
// imports etc.). Failures per-object are collected in `errors` so the
// caller can surface them in a toast without losing the successes.

import { cutObjectByPlane } from "./csg";
import { cutObjectByPlaneAsync } from "./workerClient";

/**
 * @param state — current `useScene` state snapshot
 * @param keep  — "both" | "upper" | "lower"
 * @param newId — id-minter from the store
 * @returns { newObjects: [], errors: [], removedIds: [] } | null when nothing selected
 */
export async function buildCutDelta(state, keep = "both", newId) {
  // Explicit selection wins. If nothing's selected, fall back to ALL
  // visible non-negative objects — when the user enters cut mode and
  // hits Apply with no selection, the natural intent is "slice
  // everything visible on the bed". Without this fallback the apply
  // buttons stayed disabled and the user just saw a dead HUD.
  let ids = state.selectedIds.length
    ? state.selectedIds
    : (state.selectedId ? [state.selectedId] : []);
  if (ids.length === 0) {
    ids = state.objects
      .filter((o) => o.visible !== false && o.modifier !== "negative")
      .map((o) => o.id);
  }
  if (ids.length === 0) return null;
  const plane = state.cutPlane;
  const newObjects = [];
  const errors = [];

  for (const id of ids) {
    const src = state.objects.find((o) => o.id === id);
    if (!src) continue;
    try {
      let result;
      try {
        result = await cutObjectByPlaneAsync(src, plane, {
          upper: keep === "both" || keep === "upper",
          lower: keep === "both" || keep === "lower",
        });
      } catch (manifoldErr) {
        // Manifold rejected (NotManifold on a corrupted import etc.) —
        // fall back to BVH so the user still gets a result.
        // eslint-disable-next-line no-console
        console.warn("[applyCut] manifold cut failed, falling back to BVH:", manifoldErr.message);
        result = cutObjectByPlane(src, plane, {
          upper: keep === "both" || keep === "upper",
          lower: keep === "both" || keep === "lower",
        });
      }
      const pieces = [];
      if (result.upper) pieces.push({ part: result.upper, suffix: keep === "both" ? "upper" : "" });
      if (result.lower) pieces.push({ part: result.lower, suffix: keep === "both" ? "lower" : "" });
      if (pieces.length === 0) {
        errors.push(`${src.name}: cut produced empty geometry`);
        continue;
      }
      for (const { part, suffix } of pieces) {
        newObjects.push({
          id: newId("cut"),
          name: suffix ? `${src.name} (${suffix})` : `${src.name} (cut)`,
          type: "imported",
          modifier: src.modifier || "positive",
          visible: true,
          position: [0, 0, 0],   // pieces stay in world space — geom is baked
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          dims: {},
          color: src.color,
          geometry: { vertices: part.vertices, indices: part.indices },
          originalBbox: src.originalBbox,
        });
      }
    } catch (e) {
      errors.push(`${src.name}: ${e.message || e}`);
    }
  }
  return { newObjects, errors, removedIds: ids };
}

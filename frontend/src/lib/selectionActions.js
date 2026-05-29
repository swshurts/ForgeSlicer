// Selection-mutation actions extracted from `store.js`.
//
// Both helpers are PURE — they take the current state + options and
// return `{ objects, selectedId, selectedIds }` (a state delta). The
// store action wraps the call with `pushHistory()` + `set()` so undo
// captures the change atomically.
//
// Why extract?
//   `duplicateSelected` was 80 lines of nested branches living inside
//   the Zustand factory. Moving it out:
//     • shrinks store.js (lets the file approach the <800-line target)
//     • makes the math unit-testable in node without spinning up React
//     • surfaces the precise inputs/outputs as named parameters
//   `mirrorSelectedInPlace` is much smaller but shares the "iterate
//   selection, return state delta" pattern, so it goes in the same
//   module for symmetry.

import { computeRotatedBBox } from "./geometry";

/**
 * Duplicate the currently-selected objects (optionally mirroring each
 * copy across one world axis). Returns a state delta:
 *   { objects, selectedId, selectedIds }
 *
 * @param state — current `useScene` state snapshot
 * @param opts.mirrorAxis  — null | "x" | "y" | "z"
 * @param opts.offset      — gap between original and copy, mm (default 5)
 * @param opts.newId(type) — id minter (so the store keeps its counter
 *                            inside the closure)
 */
export function duplicateSelectedDelta(state, { mirrorAxis = null, offset = 5, newId } = {}) {
  const ids = state.selectedIds.length
    ? state.selectedIds
    : (state.selectedId ? [state.selectedId] : []);
  if (ids.length === 0) return null;

  const axisIdx = { x: 0, y: 1, z: 2 }[mirrorAxis] ?? -1;

  // If ANY source object is grouped, the whole batch gets a FRESH
  // shared groupId so the copies form their own assembly rather than
  // merging into the source assembly on every duplicate.
  const sourceObjs = ids.map((id) => state.objects.find((o) => o.id === id)).filter(Boolean);
  const anyGrouped = sourceObjs.some((o) => o.groupId);
  const newGroupId = anyGrouped ? newId("group") : null;
  const seedGroupName = sourceObjs.find((o) => o.groupName)?.groupName;
  const newGroupName = anyGrouped
    ? `${seedGroupName || "Assembly"} ${mirrorAxis ? `(mirror ${mirrorAxis.toUpperCase()})` : "copy"}`
    : undefined;

  const copies = [];
  for (const id of ids) {
    const src = state.objects.find((o) => o.id === id);
    if (!src) continue;
    const copy = {
      ...src,
      id: newId(src.type),
      name: src.name + (mirrorAxis ? ` (mirror ${mirrorAxis.toUpperCase()})` : " copy"),
      position: [...src.position],
      rotation: [...src.rotation],
      scale: [...src.scale],
      dims: { ...src.dims },
      originalBbox: src.originalBbox ? { ...src.originalBbox } : undefined,
      geometry: src.geometry ? {
        vertices: src.geometry.vertices,
        indices: src.geometry.indices,
      } : undefined,
      groupId: newGroupId || undefined,
      groupName: newGroupName,
    };
    if (axisIdx >= 0) {
      // Mirror — place the copy ADJACENT to the source along the
      // chosen axis. Naïve `-position` collapses to zero when the
      // source sits at the origin; using the rotated-bbox extent +
      // a gap guarantees a visible non-overlapping copy in every case.
      const axisKey = ["x", "y", "z"][axisIdx];
      let extent = 0;
      try {
        const bb = computeRotatedBBox(src);
        extent = Math.abs((bb.max?.[axisKey] ?? 0) - (bb.min?.[axisKey] ?? 0));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("mirror bbox fallback:", err);
      }
      copy.scale[axisIdx] = -copy.scale[axisIdx];
      copy.position[axisIdx] = src.position[axisIdx] + extent + offset;
      if (mirrorAxis === "y") copy.position[1] = Math.max(0, copy.position[1]);
    } else {
      // Plain duplicate — small XZ offset so the copy is visible.
      copy.position[0] += offset;
      copy.position[2] += offset;
    }
    copies.push(copy);
  }
  if (copies.length === 0) return null;
  const newIds = copies.map((c) => c.id);
  return {
    objects: [...state.objects, ...copies],
    selectedIds: newIds,
    selectedId: newIds[newIds.length - 1] || state.selectedId,
  };
}

/**
 * In-place axis mirror — flip the selected objects on the given axis
 * by negating their scale on that axis. NO duplicate is created.
 *
 * Returns `{ objects }` delta, or null if nothing's selected / axis bad.
 */
export function mirrorSelectedInPlaceDelta(state, axis) {
  const axisIdx = { x: 0, y: 1, z: 2 }[axis];
  if (axisIdx === undefined) return null;
  const ids = state.selectedIds.length
    ? state.selectedIds
    : (state.selectedId ? [state.selectedId] : []);
  if (ids.length === 0) return null;
  const updated = state.objects.map((o) => {
    if (!ids.includes(o.id)) return o;
    const next = {
      ...o,
      scale: [...o.scale],
      position: [...o.position],
      rotation: [...o.rotation],
    };
    next.scale[axisIdx] = -next.scale[axisIdx];
    return next;
  });
  return { objects: updated };
}

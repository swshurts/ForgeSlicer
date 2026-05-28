// Pure transform helpers — extracted from `store.js` to keep that
// file focused on Zustand wiring + UX state. Every function here is
// PURE: it takes a snapshot of the relevant scene fields plus a delta
// and returns the next list of objects. No `set`/`get`. No history.
// No side-effects. The store actions are thin adapters that call
// `pushHistory()` and then `applyXxx(...)` to compute the next state.
//
// Why split this out?
//   1. Easier unit-testing — the rotation/scale/translate math can be
//      exercised without a React/Zustand harness.
//   2. The quaternion-based rigid-body rotation logic (iter 44 P0
//      fix) is delicate enough that having it in a small dedicated
//      module makes future audits faster.
//   3. `store.js` had grown past 1265 lines mixing primitive defaults,
//      profile management, sketch state, transforms, history, and
//      group ops in one giant Zustand slice.

import * as THREE from "three";

/**
 * Translate every selected object by `delta = [dx, dy, dz]`.
 * Unchanged objects are returned by-reference so React.memo /
 * referential-equality checks elsewhere don't fire spuriously.
 */
export function applyTranslate(objects, selectedIds, delta) {
  if (!objects || objects.length === 0) return objects;
  return objects.map((o) =>
    selectedIds.includes(o.id)
      ? {
          ...o,
          position: [
            o.position[0] + delta[0],
            o.position[1] + delta[1],
            o.position[2] + delta[2],
          ],
        }
      : o
  );
}

/**
 * Multiplicative group scale around the PRIMARY object's position.
 * Children's positions stretch with the same factor so the assembly
 * scales rigidly. Primary scales in place (its offset from itself is
 * zero, so the orbit collapses to a no-op).
 */
export function applyScaleMul(objects, selectedIds, primaryId, factor) {
  if (!objects || objects.length === 0) return objects;
  const primary = objects.find((o) => o.id === primaryId)
    || objects.find((o) => selectedIds.includes(o.id));
  if (!primary) return objects;
  const pivot = primary.position;
  return objects.map((o) => {
    if (!selectedIds.includes(o.id)) return o;
    const nextScale = [
      o.scale[0] * factor[0],
      o.scale[1] * factor[1],
      o.scale[2] * factor[2],
    ];
    if (o.id === primary.id) {
      return { ...o, scale: nextScale };
    }
    return {
      ...o,
      scale: nextScale,
      position: [
        pivot[0] + (o.position[0] - pivot[0]) * factor[0],
        pivot[1] + (o.position[1] - pivot[1]) * factor[1],
        pivot[2] + (o.position[2] - pivot[2]) * factor[2],
      ],
    };
  });
}

/**
 * Rigid-body rotation of the selection around the primary's position.
 *
 * The math is QUATERNION-COMPOSED (iter 44 P0 fix): naive Euler
 * addition `rotation += delta` is NOT associative for non-axis-aligned
 * starting rotations and scattered assemblies after the 2nd-3rd
 * consecutive rotation. Composing world-delta quaternions then
 * decomposing back to Euler XYZ for storage produces the correct
 * world-space rotation regardless of starting orientation.
 *
 * `delta` is the delta-Euler in degrees [dx, dy, dz]. Returns a new
 * `objects` list with positions + rotations updated; unchanged
 * objects keep their identity.
 */
export function applyRigidRotate(objects, selectedIds, primaryId, delta) {
  if (!objects || objects.length === 0) return objects;
  const targets = objects.filter((o) => selectedIds.includes(o.id));
  if (targets.length === 0) return objects;
  const primary = objects.find((o) => o.id === primaryId) || targets[0];
  const pivot = primary.position;
  const dEuler = new THREE.Euler(
    (delta[0] * Math.PI) / 180,
    (delta[1] * Math.PI) / 180,
    (delta[2] * Math.PI) / 180,
    "XYZ",
  );
  const dQ = new THREE.Quaternion().setFromEuler(dEuler);
  return objects.map((o) => {
    if (!selectedIds.includes(o.id)) return o;
    // Compose the child's current quaternion with the world delta.
    const childQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (o.rotation[0] * Math.PI) / 180,
      (o.rotation[1] * Math.PI) / 180,
      (o.rotation[2] * Math.PI) / 180,
      "XYZ",
    ));
    const newChildQ = dQ.clone().multiply(childQ);
    const newChildEuler = new THREE.Euler().setFromQuaternion(newChildQ, "XYZ");
    // 4-decimal rounding prevents Euler representation drift from
    // accumulating across many user-driven rotation edits. The
    // quaternion math itself is exact; this is just a serialisation
    // courtesy so the Inspector doesn't display "44.99999".
    const nextRotation = [
      Math.round((newChildEuler.x * 180 / Math.PI) * 1e4) / 1e4,
      Math.round((newChildEuler.y * 180 / Math.PI) * 1e4) / 1e4,
      Math.round((newChildEuler.z * 180 / Math.PI) * 1e4) / 1e4,
    ];
    if (o.id === primary.id) {
      return { ...o, rotation: nextRotation };
    }
    // Non-primary members orbit the pivot by the world-delta dQ.
    const offset = new THREE.Vector3(
      o.position[0] - pivot[0],
      o.position[1] - pivot[1],
      o.position[2] - pivot[2],
    ).applyQuaternion(dQ);
    return {
      ...o,
      rotation: nextRotation,
      position: [
        pivot[0] + offset.x,
        pivot[1] + offset.y,
        pivot[2] + offset.z,
      ],
    };
  });
}

/**
 * Tiny helper — returns `true` when a delta vector is effectively
 * zero (all components within 1e-6 of zero). Used by the store
 * actions to early-out without pushing a history entry for a no-op.
 */
export function isZeroDelta(delta) {
  return !delta || delta.every((v) => Math.abs(v) < 1e-6);
}

/**
 * Tiny helper — returns `true` when a scale factor is effectively
 * the identity (all components within 1e-9 of 1.0). Same purpose as
 * `isZeroDelta` but for multiplicative ops.
 */
export function isIdentityFactor(factor) {
  return !factor || factor.every((v) => Math.abs(v - 1) < 1e-9);
}

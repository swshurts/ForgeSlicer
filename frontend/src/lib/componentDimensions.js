// Component-pair dimension math.
//
// A "component dimension" is a Blender-style annotation that shows the
// signed axis-aligned offsets AND the centre-to-centre distance between
// two scene objects, with a live leader line drawn in the viewport. Unlike
// the existing two-point ruler (`measurements`), the endpoints are NOT
// fixed in world space — they follow the objects as the user drags them
// around, which is the whole point of the feature (place part B at
// "10 mm to the right of part A", see the ΔX chip stay locked to 10.00).
//
// The math here is intentionally pure: it takes two scene objects, hands
// back a record with the world-space centres and the per-axis deltas.
// Callers (Viewport overlay, future tests, voice readouts) all converge
// on this single source of truth.
import { computeRotatedBBox } from "./geometry";

/**
 * Resolve the rotated bounding box of a scene object and return:
 *   { centerWorld: [x,y,z], min: [x,y,z], max: [x,y,z], extent: [x,y,z] }
 * All values in WORLD space (object.position is added). Returns null if
 * the object has no computable bbox (e.g. a sketch with <3 points).
 */
export function worldBboxOf(obj) {
  if (!obj) return null;
  let bb;
  try { bb = computeRotatedBBox(obj); } catch (_) { return null; }
  if (!bb || !isFinite(bb.min.x) || !isFinite(bb.max.x)) return null;
  const p = obj.position || [0, 0, 0];
  const min = [bb.min.x + p[0], bb.min.y + p[1], bb.min.z + p[2]];
  const max = [bb.max.x + p[0], bb.max.y + p[1], bb.max.z + p[2]];
  return {
    centerWorld: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    min,
    max,
    extent: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

/**
 * Compute the dimension record between two objects. Returns null if either
 * object is missing or has no bbox (we silently degrade rather than crash —
 * the caller will simply skip rendering that pair).
 *
 *   delta[i]  — centre-to-centre signed offset on axis i (B − A)
 *   gap[i]    — bbox-to-bbox gap on axis i: positive when there's air
 *               between the parts, NEGATIVE when they overlap on that axis
 *               (overlap is useful — it tells the user how deep a negative
 *               carves into a positive, for instance)
 *   distance  — Euclidean centre-to-centre magnitude
 */
export function computeComponentDimension(objA, objB) {
  const A = worldBboxOf(objA);
  const B = worldBboxOf(objB);
  if (!A || !B) return null;
  const delta = [
    B.centerWorld[0] - A.centerWorld[0],
    B.centerWorld[1] - A.centerWorld[1],
    B.centerWorld[2] - A.centerWorld[2],
  ];
  // Per-axis gap. Positive = separation, negative = overlap (penetration depth).
  // gap_i = |delta_i| − (extentA_i + extentB_i)/2, with sign carried by delta.
  const gap = [0, 1, 2].map((i) => {
    const halfSum = (A.extent[i] + B.extent[i]) / 2;
    const absD = Math.abs(delta[i]);
    const mag = absD - halfSum;
    return Math.sign(delta[i] || 1) * mag;
  });
  const distance = Math.hypot(delta[0], delta[1], delta[2]);
  return {
    centerA: A.centerWorld,
    centerB: B.centerWorld,
    delta,
    gap,
    distance,
  };
}

/**
 * Format a number as a signed mm string, e.g.  +12.34 mm  /  −0.50 mm.
 * Used by the overlay chip. Uses real Unicode minus (−) so values align
 * vertically in monospaced fonts (the ASCII hyphen is narrower).
 */
export function fmtSignedMm(n) {
  if (!isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "\u2212";
  return `${sign}${Math.abs(n).toFixed(2)} mm`;
}

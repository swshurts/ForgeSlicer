// Anchored ruler helpers — pure functions for computing:
//   1. the 8 world-space corners of a rotated bounding box
//   2. the nearest corner to a 3D click point
//   3. the signed offset from an anchor to another object's nearest corner
//
// The ruler tool drops a "0.00" origin at the corner of one object and
// then shows signed ΔX/ΔY/ΔZ to every other visible object's matching
// corner. It complements the existing centre-to-centre dimension tool;
// where that tool tells you "how far apart are these two parts," the
// anchored ruler answers "how does part B sit relative to part A's
// bottom-front-left corner."
//
// The corner-pick math: we deliberately use the unrotated bbox + object
// position rather than the true rotated AABB, because the user's mental
// model in a CAD app is "left/right/front/back/top/bottom of the part,"
// which is most naturally the object-local axis-aligned box. For rotated
// parts we still return WORLD-space coordinates so the overlay can render
// without further transformation.
import { worldBboxOf } from "./componentDimensions";

/**
 * Return all 8 corners of the object's world-space (rotated) AABB as
 * [{key, x, y, z}], where `key` is a stable identifier like 'min-min-min'
 * or 'max-min-max' for debugging / serialisation later.
 */
export function bboxCorners(obj) {
  const bb = worldBboxOf(obj);
  if (!bb) return [];
  const xs = [bb.min[0], bb.max[0]];
  const ys = [bb.min[1], bb.max[1]];
  const zs = [bb.min[2], bb.max[2]];
  const out = [];
  for (let xi = 0; xi < 2; xi += 1) {
    for (let yi = 0; yi < 2; yi += 1) {
      for (let zi = 0; zi < 2; zi += 1) {
        out.push({
          key: `${xi ? "max" : "min"}-${yi ? "max" : "min"}-${zi ? "max" : "min"}`,
          x: xs[xi], y: ys[yi], z: zs[zi],
        });
      }
    }
  }
  return out;
}

/**
 * Find the corner of `obj`'s world bbox closest to a 3D `clickPoint`
 * (a {x,y,z} or [x,y,z]). Returns null when bbox is undefined.
 *
 * Used when the user toggles ruler-mode on and clicks anywhere on a
 * part: we want the anchor to snap to the visually-nearest corner.
 */
export function nearestCorner(obj, clickPoint) {
  const corners = bboxCorners(obj);
  if (corners.length === 0) return null;
  const cx = Array.isArray(clickPoint) ? clickPoint[0] : clickPoint.x;
  const cy = Array.isArray(clickPoint) ? clickPoint[1] : clickPoint.y;
  const cz = Array.isArray(clickPoint) ? clickPoint[2] : clickPoint.z;
  let best = corners[0];
  let bestD = Infinity;
  for (const c of corners) {
    const d = (c.x - cx) ** 2 + (c.y - cy) ** 2 + (c.z - cz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Given an anchor world-point [x,y,z] and an object, compute:
 *   { nearCorner: {x,y,z,key},    — the corner of obj closest to the anchor
 *     delta: [Δx, Δy, Δz] }       — signed offsets (nearCorner − anchor)
 * Returns null if obj has no bbox.
 *
 * "Nearest corner" matches the TinkerCAD ruler UX — the user reads
 * "this part is 4 mm to the right of the anchor" and that's the offset
 * to the part's left-back-bottom corner, not its centre.
 */
export function offsetToObject(anchorPt, obj) {
  const near = nearestCorner(obj, anchorPt);
  if (!near) return null;
  return {
    nearCorner: near,
    delta: [near.x - anchorPt[0], near.y - anchorPt[1], near.z - anchorPt[2]],
  };
}

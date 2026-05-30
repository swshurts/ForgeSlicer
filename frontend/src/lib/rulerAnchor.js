// Anchored ruler helpers — snap-point geometry for the TinkerCAD-style
// ruler. Each object exposes 27 candidate snap points:
//   • 8 bbox corners
//   • 12 edge midpoints
//   • 6 face centres
//   • 1 object centre
// The user clicks the part; we enumerate the candidates, pick the one
// closest to the click world-point, and use it as either the anchor (1st
// click) or the target (2nd click).
//
// The math is intentionally pure: takes scene objects, returns plain
// data. Three.js / R3F are not imported here so the helpers are unit-
// testable in Node.
import { worldBboxOf } from "./componentDimensions";

/**
 * Return all 8 corners of the object's world-space (rotated) AABB as
 * [{key, kind:'corner', x, y, z}].
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
          key: `corner-${xi ? "max" : "min"}-${yi ? "max" : "min"}-${zi ? "max" : "min"}`,
          kind: "corner",
          x: xs[xi], y: ys[yi], z: zs[zi],
        });
      }
    }
  }
  return out;
}

/**
 * Return the 12 edge midpoints of the object's world bbox.
 * Each entry has kind:'edge' and a key that encodes which edge it
 * sits on (e.g. 'edge-x-min-min' = the edge that runs along the X
 * direction at minY/minZ).
 */
export function bboxEdgeMidpoints(obj) {
  const bb = worldBboxOf(obj);
  if (!bb) return [];
  const out = [];
  const midX = (bb.min[0] + bb.max[0]) / 2;
  const midY = (bb.min[1] + bb.max[1]) / 2;
  const midZ = (bb.min[2] + bb.max[2]) / 2;
  // 4 edges running along X (varying Y and Z extremes)
  for (const yi of [0, 1]) {
    for (const zi of [0, 1]) {
      out.push({
        key: `edge-x-${yi ? "max" : "min"}-${zi ? "max" : "min"}`,
        kind: "edge",
        x: midX, y: yi ? bb.max[1] : bb.min[1], z: zi ? bb.max[2] : bb.min[2],
      });
    }
  }
  // 4 edges running along Y (varying X and Z extremes)
  for (const xi of [0, 1]) {
    for (const zi of [0, 1]) {
      out.push({
        key: `edge-y-${xi ? "max" : "min"}-${zi ? "max" : "min"}`,
        kind: "edge",
        x: xi ? bb.max[0] : bb.min[0], y: midY, z: zi ? bb.max[2] : bb.min[2],
      });
    }
  }
  // 4 edges running along Z (varying X and Y extremes)
  for (const xi of [0, 1]) {
    for (const yi of [0, 1]) {
      out.push({
        key: `edge-z-${xi ? "max" : "min"}-${yi ? "max" : "min"}`,
        kind: "edge",
        x: xi ? bb.max[0] : bb.min[0], y: yi ? bb.max[1] : bb.min[1], z: midZ,
      });
    }
  }
  return out;
}

/** Return the 6 bbox-face centres. */
export function bboxFaceCenters(obj) {
  const bb = worldBboxOf(obj);
  if (!bb) return [];
  const midX = (bb.min[0] + bb.max[0]) / 2;
  const midY = (bb.min[1] + bb.max[1]) / 2;
  const midZ = (bb.min[2] + bb.max[2]) / 2;
  return [
    { key: "face-min-x", kind: "face", x: bb.min[0], y: midY, z: midZ },
    { key: "face-max-x", kind: "face", x: bb.max[0], y: midY, z: midZ },
    { key: "face-min-y", kind: "face", x: midX, y: bb.min[1], z: midZ },
    { key: "face-max-y", kind: "face", x: midX, y: bb.max[1], z: midZ },
    { key: "face-min-z", kind: "face", x: midX, y: midY, z: bb.min[2] },
    { key: "face-max-z", kind: "face", x: midX, y: midY, z: bb.max[2] },
  ];
}

/** Return the 1 bbox centre as a snap point. */
export function bboxCenterPoint(obj) {
  const bb = worldBboxOf(obj);
  if (!bb) return null;
  return {
    key: "center",
    kind: "center",
    x: (bb.min[0] + bb.max[0]) / 2,
    y: (bb.min[1] + bb.max[1]) / 2,
    z: (bb.min[2] + bb.max[2]) / 2,
  };
}

/**
 * All 27 candidate snap points for an object: 8 corners + 12 edge
 * midpoints + 6 face centres + 1 object centre. Filtered by `kinds`
 * (e.g. `['corner','edge']` to restrict; default is all four).
 */
export function allSnapPoints(obj, kinds = ["corner", "edge", "face", "center"]) {
  const out = [];
  if (kinds.includes("corner")) out.push(...bboxCorners(obj));
  if (kinds.includes("edge"))   out.push(...bboxEdgeMidpoints(obj));
  if (kinds.includes("face"))   out.push(...bboxFaceCenters(obj));
  if (kinds.includes("center")) {
    const c = bboxCenterPoint(obj);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Find the snap point on `obj` closest to a 3D `clickPoint`
 * (a {x,y,z} or [x,y,z]). `kinds` filters which snap families
 * are considered; defaults to all 27 candidates. Returns null
 * when the object has no bbox.
 */
export function nearestSnapPoint(obj, clickPoint, kinds) {
  const points = allSnapPoints(obj, kinds);
  if (points.length === 0) return null;
  const cx = Array.isArray(clickPoint) ? clickPoint[0] : clickPoint.x;
  const cy = Array.isArray(clickPoint) ? clickPoint[1] : clickPoint.y;
  const cz = Array.isArray(clickPoint) ? clickPoint[2] : clickPoint.z;
  let best = points[0];
  let bestD = Infinity;
  for (const p of points) {
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// Back-compat alias — older call sites only needed corners.
export const nearestCorner = (obj, clickPoint) => nearestSnapPoint(obj, clickPoint, ["corner"]);

/**
 * Given an anchor world-point [x,y,z] and an object, compute the snap
 * point on `obj` closest to the anchor PLUS the signed deltas to it.
 * Used when the chip needs a "target" reference without explicit user
 * selection (legacy path).
 */
export function offsetToObject(anchorPt, obj, kinds) {
  const near = nearestSnapPoint(obj, anchorPt, kinds);
  if (!near) return null;
  return {
    nearCorner: near,
    delta: [near.x - anchorPt[0], near.y - anchorPt[1], near.z - anchorPt[2]],
  };
}


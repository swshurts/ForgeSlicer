// Iter-113 — Snap-to-face placement helper.
//
// Given a target object and a world-space hit (point + face normal),
// compute a {position, rotation} patch that lands the object so its
// "bottom" face sits flat on the hit surface:
//
//   1. Rotate the object so its LOCAL +Z axis aligns with the world
//      face normal. (TinkerCAD convention: the object's "up" follows
//      the face normal; its bottom rests on the face.)
//   2. Translate so the centre of the bottom-most cross-section
//      (along the new world-up direction) coincides with the click
//      point — gives a clean "drop in place" feel.
//
// Returns null when computeRotatedBBox can't produce a valid bbox
// for the input (degenerate geometry / partially-loaded sweep).
import * as THREE from "three";
import { computeRotatedBBox } from "./geometry";

/**
 * Compute placement transform.
 *
 * @param {Object} obj           Scene-graph object to place
 * @param {{x,y,z}} hitPoint     World-space click point
 * @param {{x,y,z}} worldNormal  Face normal in WORLD space
 * @returns {{position: [number,number,number], rotation: [number,number,number]} | null}
 */
export function computePlaceOnFace(obj, hitPoint, worldNormal) {
  if (!obj || !hitPoint || !worldNormal) return null;
  const N = new THREE.Vector3(
    worldNormal.x ?? worldNormal[0],
    worldNormal.y ?? worldNormal[1],
    worldNormal.z ?? worldNormal[2],
  );
  if (!Number.isFinite(N.x) || N.lengthSq() < 1e-9) return null;
  N.normalize();
  const hit = {
    x: hitPoint.x ?? hitPoint[0],
    y: hitPoint.y ?? hitPoint[1],
    z: hitPoint.z ?? hitPoint[2],
  };

  // Quaternion that rotates local +Z onto N.
  // Corner case: when N is (nearly) -Z, setFromUnitVectors picks an
  // arbitrary perpendicular axis to spin around — that yields an
  // unpredictable Euler decomposition. Snap onto a known [180°,0,0]
  // orientation so flips onto underside faces stay deterministic
  // (testing agent T8 polish, iter-113).
  let q;
  if (N.z < -0.9999) {
    q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else {
    q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      N,
    );
  }
  // Convert to Euler degrees for the store's rotation field.
  const eul = new THREE.Euler().setFromQuaternion(q, "XYZ");
  const newRotDeg = [
    Math.round(THREE.MathUtils.radToDeg(eul.x) * 1e4) / 1e4,
    Math.round(THREE.MathUtils.radToDeg(eul.y) * 1e4) / 1e4,
    Math.round(THREE.MathUtils.radToDeg(eul.z) * 1e4) / 1e4,
  ];

  // World bbox with the NEW rotation applied (position ignored — bbox
  // is around the local origin). We use this to find the rotated
  // object's bottom face along the new world-up direction (N).
  let bb;
  try {
    bb = computeRotatedBBox({
      ...obj,
      rotation: newRotDeg,
      position: [0, 0, 0],
    });
  } catch {
    return null;
  }
  if (!bb || !Number.isFinite(bb.min.x)) return null;

  // Find the bbox-corner projections onto N so we know the rotated
  // object's lowest extent along the face-normal direction.
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const x of [bb.min.x, bb.max.x]) {
    for (const y of [bb.min.y, bb.max.y]) {
      for (const z of [bb.min.z, bb.max.z]) {
        const p = x * N.x + y * N.y + z * N.z;
        if (p < minProj) minProj = p;
        if (p > maxProj) maxProj = p;
      }
    }
  }
  const halfAlongN = (maxProj - minProj) / 2;
  // Centre of the rotated bbox in local space.
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  // The bottom-face centre of the rotated bbox (in local coords).
  const blx = cx - N.x * halfAlongN;
  const bly = cy - N.y * halfAlongN;
  const blz = cz - N.z * halfAlongN;
  // World position: shift so the local bottom-centre coincides with
  // the world hit point.
  const px = hit.x - blx;
  const py = hit.y - bly;
  const pz = hit.z - blz;

  return {
    position: [px, py, pz],
    rotation: newRotDeg,
  };
}

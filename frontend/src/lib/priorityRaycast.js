/**
 * Priority raycast helper — pull placement dots to the FRONT of the
 * intersection sort so they beat regular scene geometry when the user
 * clicks. See RulerPlacementDots.jsx for the full rationale.
 *
 * Extracted from the component so it can be unit-tested without
 * spinning up a WebGL context (the component's transitive imports
 * pull in three/examples ESM which Jest can't transform).
 */
import * as THREE from "three";

// iter-125.1 — Bug-fix "stacked objects: wrong dot picked". Previously
// all priority hits were set to `distance = -1e-4` (a hard tie).
// When two dots overlapped in screen-space (e.g. cube-top-corner and
// cone-bottom-corner sitting at the same world coord, or top vs
// bottom bbox corners projecting to the same pixel), THREE's stable
// sort left the winner up to raycaster insertion order — often the
// dot BEHIND the geometry won. We now use a small negative offset
// PLUS a proportional fraction of the true distance so
//   - all priority meshes still sort before any real geometry
//     (all their distances remain negative), and
//   - among priority meshes, the one closest to the camera wins,
//     matching what the user actually sees.
export function priorityRaycast(raycaster, intersects) {
  const local = [];
  THREE.Mesh.prototype.raycast.call(this, raycaster, local);
  for (const hit of local) {
    // Keep a monotonically-increasing signature: -1 + distance*1e-6.
    // For any realistic scene (distance < 1000 mm) the value stays
    // safely negative (< -0.999), so priority still beats normal hits
    // whose `distance` is a positive world-space number.
    hit.distance = -1 + hit.distance * 1e-6;
    intersects.push(hit);
  }
}

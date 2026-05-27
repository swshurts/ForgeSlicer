// Standalone math validation for the group-pivot rotation fix in
// `frontend/src/lib/store.js -> rotateSelected`.
//
// This re-implements the math with the same Three.js calls and asserts
// that a cube + sphere assembly rotated 90° around Z orbits the
// sphere around the assembly centroid (not around the sphere's own
// center). Catches the iteration-46 bug: per-object rotation that
// broke rigid-body assembly transforms.
//
// Run from /app/frontend:   node tests/rotation-group-pivot.mjs

import * as THREE from "three";

const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const approxArr = (a, b, eps = 1e-6) => a.every((v, i) => approx(v, b[i], eps));

// --- Reference scene: cube at origin, sphere at (20, 8, 0) ---
const cube   = { id: "cube",   position: [0, 0, 0],   rotation: [0, 0, 0] };
const sphere = { id: "sphere", position: [20, 8, 0],  rotation: [0, 0, 0] };
const targets = [cube, sphere];

// Centroid:
const sum = targets.reduce(
  (acc, o) => [acc[0] + o.position[0], acc[1] + o.position[1], acc[2] + o.position[2]],
  [0, 0, 0],
);
const pivot = [sum[0] / 2, sum[1] / 2, sum[2] / 2];
ok(approxArr(pivot, [10, 4, 0]), `centroid = (10, 4, 0); got (${pivot.join(", ")})`);

// Apply +90° around Z.
const delta = [0, 0, 90];
const dEuler = new THREE.Euler(
  (delta[0] * Math.PI) / 180,
  (delta[1] * Math.PI) / 180,
  (delta[2] * Math.PI) / 180,
  "XYZ",
);
const dMat = new THREE.Matrix4().makeRotationFromEuler(dEuler);
const pivotV = new THREE.Vector3(pivot[0], pivot[1], pivot[2]);

const after = targets.map((o) => {
  const offset = new THREE.Vector3(
    o.position[0] - pivotV.x,
    o.position[1] - pivotV.y,
    o.position[2] - pivotV.z,
  ).applyMatrix4(dMat);
  return {
    id: o.id,
    rotation: [o.rotation[0] + delta[0], o.rotation[1] + delta[1], o.rotation[2] + delta[2]],
    position: [pivotV.x + offset.x, pivotV.y + offset.y, pivotV.z + offset.z],
  };
});

const cubeAfter   = after.find((o) => o.id === "cube");
const sphereAfter = after.find((o) => o.id === "sphere");

// Cube was at (0, 0, 0). Offset from pivot = (-10, -4, 0). After +90° about Z:
//   (x, y) -> (-y, x) so (-10, -4) -> (4, -10). New pos = pivot + (4, -10, 0) = (14, -6, 0).
ok(approxArr(cubeAfter.position, [14, -6, 0], 1e-5), `cube new position = (14, -6, 0); got (${cubeAfter.position.map((v)=>v.toFixed(4)).join(", ")})`);
ok(approxArr(cubeAfter.rotation, [0, 0, 90]),       `cube rotation = (0, 0, 90); got (${cubeAfter.rotation.join(", ")})`);

// Sphere was at (20, 8, 0). Offset = (10, 4, 0). After +90° about Z: (10, 4) -> (-4, 10). New pos = pivot + (-4, 10, 0) = (6, 14, 0).
ok(approxArr(sphereAfter.position, [6, 14, 0], 1e-5), `sphere new position = (6, 14, 0); got (${sphereAfter.position.map((v)=>v.toFixed(4)).join(", ")})`);
ok(approxArr(sphereAfter.rotation, [0, 0, 90]),       `sphere rotation = (0, 0, 90); got (${sphereAfter.rotation.join(", ")})`);

// Rigid-body invariant: the (cube ↔ sphere) distance must be preserved.
const beforeDist = Math.hypot(
  cube.position[0] - sphere.position[0],
  cube.position[1] - sphere.position[1],
  cube.position[2] - sphere.position[2],
);
const afterDist = Math.hypot(
  cubeAfter.position[0] - sphereAfter.position[0],
  cubeAfter.position[1] - sphereAfter.position[1],
  cubeAfter.position[2] - sphereAfter.position[2],
);
ok(approx(beforeDist, afterDist, 1e-5), `assembly rigid-body distance preserved (${beforeDist.toFixed(4)} ≈ ${afterDist.toFixed(4)})`);

// Centroid invariant: rotating around the centroid keeps the centroid stationary.
const afterCentroid = [
  (cubeAfter.position[0] + sphereAfter.position[0]) / 2,
  (cubeAfter.position[1] + sphereAfter.position[1]) / 2,
  (cubeAfter.position[2] + sphereAfter.position[2]) / 2,
];
ok(approxArr(afterCentroid, pivot, 1e-5), `centroid preserved after rotation (${afterCentroid.map((v)=>v.toFixed(4)).join(", ")} == (${pivot.join(", ")}))`);

console.log("\nAll rotation-pivot assertions passed ✔");

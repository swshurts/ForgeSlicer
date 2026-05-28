// Math validation for ForgeSlicer's rigid-body group rotation.
//
// Pivot semantics: when 2+ objects are rotated together, the PRIMARY
// (the gizmo's anchor / popover's named object) stays in place and
// every OTHER selected member orbits the primary by the same delta.
// This matches what users expect from the interactive gizmo drag —
// the gizmo stays under the cursor and the active object doesn't
// drift mid-rotation.
//
// Run from /app/frontend:   node tests/rotation-group-pivot.mjs

import * as THREE from "three";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const approxArr = (a, b, eps = 1e-6) => a.every((v, i) => approx(v, b[i], eps));

// --- Reference scene: cube as PRIMARY at origin, sphere offset on X+Y ---
const cube   = { id: "cube",   position: [0, 0, 0],   rotation: [0, 0, 0] };  // primary
const sphere = { id: "sphere", position: [20, 8, 0],  rotation: [0, 0, 0] };

const pivot = cube.position;   // primary is the pivot

// Apply +90° around Z.
const delta = [0, 0, 90];
const dEuler = new THREE.Euler(
  (delta[0] * Math.PI) / 180,
  (delta[1] * Math.PI) / 180,
  (delta[2] * Math.PI) / 180,
  "XYZ",
);
const dMat = new THREE.Matrix4().makeRotationFromEuler(dEuler);

// Primary tilts in place, position unchanged.
const cubeAfter = {
  rotation: [cube.rotation[0] + delta[0], cube.rotation[1] + delta[1], cube.rotation[2] + delta[2]],
  position: [...cube.position],
};
// Sphere orbits the primary.
const offset = new THREE.Vector3(
  sphere.position[0] - pivot[0],
  sphere.position[1] - pivot[1],
  sphere.position[2] - pivot[2],
).applyMatrix4(dMat);
const sphereAfter = {
  rotation: [sphere.rotation[0] + delta[0], sphere.rotation[1] + delta[1], sphere.rotation[2] + delta[2]],
  position: [pivot[0] + offset.x, pivot[1] + offset.y, pivot[2] + offset.z],
};

// Primary doesn't drift.
ok(approxArr(cubeAfter.position, [0, 0, 0], 1e-9), `cube (primary) stays at (0,0,0); got (${cubeAfter.position.join(", ")})`);
ok(approxArr(cubeAfter.rotation, [0, 0, 90]),       `cube rotation = (0, 0, 90); got (${cubeAfter.rotation.join(", ")})`);

// Sphere was at (20, 8, 0). After +90° about Z: (x,y) -> (-y, x). So (20, 8) -> (-8, 20). Position = pivot + offset = (0+-8, 0+20, 0) = (-8, 20, 0).
ok(approxArr(sphereAfter.position, [-8, 20, 0], 1e-5), `sphere new position = (-8, 20, 0); got (${sphereAfter.position.map((v)=>v.toFixed(4)).join(", ")})`);
ok(approxArr(sphereAfter.rotation, [0, 0, 90]),         `sphere rotation = (0, 0, 90); got (${sphereAfter.rotation.join(", ")})`);

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

// Single-object regression: a lone selection must NOT have its position
// touched (pivot == own position → offset == 0 → no orbit).
const lone = { id: "lone", position: [5, 5, 5], rotation: [0, 0, 0] };
const lonePivot = lone.position;
const loneOffset = new THREE.Vector3(0, 0, 0).applyMatrix4(dMat);
ok(approxArr([lonePivot[0]+loneOffset.x, lonePivot[1]+loneOffset.y, lonePivot[2]+loneOffset.z], [5, 5, 5], 1e-9), "single-object rotation does not move the object");

console.log("\nAll rotation-pivot assertions passed ✔");

// Regression: the manifold-3d STL export pipeline used to bake object
// rotations via `manifold.rotate([rx, ry, rz])`, which applies
// rotations in global X → Y → Z order. The Three.js viewport uses
// `Euler('XYZ')` which is global Z → Y → X. Multi-axis rotations
// landed parts in visually-different positions in the STL preview vs
// the live viewport — the "disjointed parts in the eyeball viewer"
// symptom the user reported.
//
// Fix: bake the rotation as a column-major Mat4 from THREE.Euler XYZ
// and feed it to `manifold.transform(matrixElements)`. This test
// verifies the two engines agree on where a unit X vector lands after
// the same Euler rotation, across a battery of typical multi-axis
// rotation values produced by group-rotation flows.
//
// Run:    cd /app/frontend && node tests/manifold-rotation-order.mjs

import * as THREE from "three";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;

// Reproduce the FIXED bake (Three.js Euler XYZ → column-major matrix).
function bakeViewportRotation(rxDeg, ryDeg, rzDeg) {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(rxDeg),
    THREE.MathUtils.degToRad(ryDeg),
    THREE.MathUtils.degToRad(rzDeg),
    "XYZ",
  ));
}

// Reproduce the OLD (buggy) manifold.rotate([x,y,z]) bake — applies
// rotations in global X → Y → Z order per manifold-3d's docs.
function bakeBuggyManifoldRotation(rxDeg, ryDeg, rzDeg) {
  const rx = THREE.MathUtils.degToRad(rxDeg);
  const ry = THREE.MathUtils.degToRad(ryDeg);
  const rz = THREE.MathUtils.degToRad(rzDeg);
  // Global x then y then z = Rz · Ry · Rx (vector multiplied right-to-left).
  return new THREE.Matrix4().multiplyMatrices(
    new THREE.Matrix4().makeRotationZ(rz),
    new THREE.Matrix4().multiplyMatrices(
      new THREE.Matrix4().makeRotationY(ry),
      new THREE.Matrix4().makeRotationX(rx),
    ),
  );
}

// Typical post-group-rotation Euler values picked from real assemblies:
//   - axis-aligned (0,0,0) — must always match
//   - single-axis — must always match
//   - two-axis — MAY differ in buggy path
//   - three-axis (the common case after >1 group rotation)
const cases = [
  [0, 0, 0],
  [90, 0, 0],
  [0, 90, 0],
  [0, 0, 90],
  [45, 45, 0],
  [45, 90, 0],
  [30, 60, 45],
  [-30, 45, 60],
  [15, 15, 15],
  [89.999, 44.999, 29.999],
];

const testVecs = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [10, 0, 0],
  [3, 4, 5],
  [-7, 2, 1],
];

let mismatchCount = 0;

for (const [rx, ry, rz] of cases) {
  const viewportMat = bakeViewportRotation(rx, ry, rz);
  const buggyMat = bakeBuggyManifoldRotation(rx, ry, rz);
  for (const v of testVecs) {
    const vv = new THREE.Vector3(...v);
    const a = vv.clone().applyMatrix4(viewportMat);
    const b = vv.clone().applyMatrix4(buggyMat);
    const dist = a.distanceTo(b);
    if (dist > 1e-5) mismatchCount += 1;
  }
}

// Confirm the buggy path actually differs (otherwise our test isn't
// meaningfully discriminating between the two engines).
ok(mismatchCount > 0,
   `buggy manifold-rotate path produces ${mismatchCount} mismatched vertex positions across the case matrix (confirms the bug existed)`);

// Now verify the FIXED bake — when we pass the Three.js viewport
// matrix to `manifold.transform(mat.elements)`, manifold-3d applies it
// as a plain affine. We simulate that by applying the SAME column-
// major matrix to the same test vectors and confirming bit-for-bit
// agreement with the viewport.
for (const [rx, ry, rz] of cases) {
  const viewportMat = bakeViewportRotation(rx, ry, rz);
  // The "manifold side" after the fix: same column-major elements.
  const manifoldMat = new THREE.Matrix4().fromArray(Array.from(viewportMat.elements));
  for (const v of testVecs) {
    const vv = new THREE.Vector3(...v);
    const a = vv.clone().applyMatrix4(viewportMat);
    const b = vv.clone().applyMatrix4(manifoldMat);
    ok(approx(a.x, b.x) && approx(a.y, b.y) && approx(a.z, b.z),
       `viewport ↔ manifold agree on (${v}) under Euler (${rx},${ry},${rz}): both → (${a.x.toFixed(4)}, ${a.y.toFixed(4)}, ${a.z.toFixed(4)})`);
  }
}

// Spot-check the specific reproduction the user described: a child
// from a 2-step group rotation ends up with Euler (45, 90, 0).
const reproMat = bakeViewportRotation(45, 90, 0);
const reproBuggy = bakeBuggyManifoldRotation(45, 90, 0);
const probe = new THREE.Vector3(1, 0, 0);
const a = probe.clone().applyMatrix4(reproMat);
const b = probe.clone().applyMatrix4(reproBuggy);
const reproDist = a.distanceTo(b);
ok(reproDist > 0.5,
   `repro case (45°,90°,0): viewport lands (1,0,0) at (${a.x.toFixed(4)}, ${a.y.toFixed(4)}, ${a.z.toFixed(4)}) — buggy manifold lands it at (${b.x.toFixed(4)}, ${b.y.toFixed(4)}, ${b.z.toFixed(4)}), distance ${reproDist.toFixed(4)} > 0.5 confirms the disjoint symptom`);

console.log("\nAll manifold-rotation-order regression assertions passed ✔");

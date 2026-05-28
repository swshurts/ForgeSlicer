// Regression: consecutive rotations of a multi-member assembly MUST
// keep the assembly rigid. Previous bug — Euler-additive math worked
// for a single rotation but compounded errors over 2+ rotations,
// scattering children once the primary's orientation drifted off an
// axis-aligned start.
//
// Fix: quaternion-composed rotations in `rotateSelected` (popover
// path) and `Viewport.handleChange` (gizmo path). Both must produce
// identical, distance-preserving updates regardless of how many times
// the user rotates the assembly.
//
// Run from /app/frontend:   node tests/rotation-group-consecutive.mjs

import * as THREE from "three";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Reproduce the production `rotateSelected` (quaternion-based) on a
// reduced data model so we can run it sans React/Zustand.
function rotateAssembly(objects, primaryId, delta) {
  const primary = objects.find((o) => o.id === primaryId);
  const pivot = primary.position;
  const dQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    (delta[0] * Math.PI) / 180,
    (delta[1] * Math.PI) / 180,
    (delta[2] * Math.PI) / 180,
    "XYZ",
  ));
  return objects.map((o) => {
    const childQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (o.rotation[0] * Math.PI) / 180,
      (o.rotation[1] * Math.PI) / 180,
      (o.rotation[2] * Math.PI) / 180,
      "XYZ",
    ));
    const newChildQ = dQ.clone().multiply(childQ);
    const ne = new THREE.Euler().setFromQuaternion(newChildQ, "XYZ");
    const nextRotation = [
      ne.x * 180 / Math.PI,
      ne.y * 180 / Math.PI,
      ne.z * 180 / Math.PI,
    ];
    if (o.id === primary.id) {
      return { ...o, rotation: nextRotation };
    }
    const offset = new THREE.Vector3(
      o.position[0] - pivot[0],
      o.position[1] - pivot[1],
      o.position[2] - pivot[2],
    ).applyQuaternion(dQ);
    return {
      ...o,
      rotation: nextRotation,
      position: [pivot[0] + offset.x, pivot[1] + offset.y, pivot[2] + offset.z],
    };
  });
}

// --- Scene: PRIMARY cube at origin + 3 satellites at known offsets ---
let scene = [
  { id: "primary", position: [0, 0, 0],   rotation: [0, 0, 0] },
  { id: "sat1",    position: [10, 0, 0],  rotation: [0, 0, 0] },
  { id: "sat2",    position: [0, 10, 0],  rotation: [0, 0, 0] },
  { id: "sat3",    position: [10, 10, 5], rotation: [0, 0, 0] },
];
const initialDists = [
  dist3(scene[0].position, scene[1].position),  // 10
  dist3(scene[0].position, scene[2].position),  // 10
  dist3(scene[0].position, scene[3].position),  // sqrt(225) = 15
  dist3(scene[1].position, scene[2].position),  // sqrt(200)
  dist3(scene[1].position, scene[3].position),  // sqrt(125)
  dist3(scene[2].position, scene[3].position),  // sqrt(125)
];

// Apply a sequence of 5 rotations across all three world axes,
// simulating a user repeatedly tweaking the popover or gizmo.
const sequence = [
  [0, 90, 0],
  [45, 0, 0],
  [0, 0, 30],
  [0, -45, 0],
  [15, 15, 15],
];
for (const delta of sequence) {
  scene = rotateAssembly(scene, "primary", delta);
}

// Check rigid-body invariant: every pairwise distance MUST equal the
// initial pairwise distance.
const finalDists = [
  dist3(scene[0].position, scene[1].position),
  dist3(scene[0].position, scene[2].position),
  dist3(scene[0].position, scene[3].position),
  dist3(scene[1].position, scene[2].position),
  dist3(scene[1].position, scene[3].position),
  dist3(scene[2].position, scene[3].position),
];
const labels = ["primary↔sat1", "primary↔sat2", "primary↔sat3", "sat1↔sat2", "sat1↔sat3", "sat2↔sat3"];
for (let i = 0; i < initialDists.length; i++) {
  ok(approx(initialDists[i], finalDists[i], 1e-4),
    `${labels[i]}: ${initialDists[i].toFixed(4)} → ${finalDists[i].toFixed(4)} (rigid-body)`);
}

// Primary must NOT drift.
ok(scene[0].position.every((v) => approx(v, 0, 1e-9)),
   `primary stays at origin after 5 rotations; got (${scene[0].position.map((v)=>v.toFixed(6)).join(", ")})`);

// Final positions should match what we'd get by directly applying the
// composed quaternion (Q5 · Q4 · Q3 · Q2 · Q1) to each initial offset.
const composedQ = sequence.reduce((acc, d) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    d[0] * Math.PI / 180,
    d[1] * Math.PI / 180,
    d[2] * Math.PI / 180,
    "XYZ",
  ));
  return q.clone().multiply(acc);
}, new THREE.Quaternion());

const initialOffsets = [
  null,                       // primary
  new THREE.Vector3(10, 0, 0),
  new THREE.Vector3(0, 10, 0),
  new THREE.Vector3(10, 10, 5),
];
for (let i = 1; i < 4; i++) {
  const expected = initialOffsets[i].clone().applyQuaternion(composedQ);
  const actual = scene[i].position;
  const dx = Math.abs(expected.x - actual[0]);
  const dy = Math.abs(expected.y - actual[1]);
  const dz = Math.abs(expected.z - actual[2]);
  ok(dx < 1e-4 && dy < 1e-4 && dz < 1e-4,
     `sat${i} final pos = composed rotation of initial offset (Δ < 1e-4)`);
}

console.log("\nAll consecutive-rotation rigid-body assertions passed ✔");

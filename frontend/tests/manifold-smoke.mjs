// Tiny Node-side smoke test for the manifold-3d engine.
// Verifies WASM initialisation, primitive construction, boolean ops,
// and Mesh ↔ Manifold conversion shape against known-good triangle
// counts so a regression in manifold-3d's npm release surfaces here
// before it lands in the worker.
//
// Run via: cd /app/frontend && node tests/manifold-smoke.mjs

import Module from "manifold-3d";
import fs from "node:fs";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const results = [];
function check(label, cond, extra = "") {
  results.push({ label, cond });
  console.log(`${cond ? PASS : FAIL} — ${label}${extra ? ` — ${extra}` : ""}`);
}

const wasm = await Module();
wasm.setup();
const { Manifold } = wasm;
check("wasm.setup() returned Manifold class", typeof Manifold === "function");

// --- Cube ---
const cube = Manifold.cube([20, 20, 20], true);
const cubeMesh = cube.getMesh();
check(
  "cube produces 12 triangles",
  cubeMesh.triVerts.length / 3 === 12,
  `tris=${cubeMesh.triVerts.length / 3}`
);

// --- Sphere ---
const sphere = Manifold.sphere(15, 64);
const sphereMesh = sphere.getMesh();
check(
  "sphere(15, 64) produces > 0 triangles",
  sphereMesh.triVerts.length / 3 > 100
);

// --- Boolean subtract: cube minus sphere ---
const carved = cube.subtract(sphere);
const carvedMesh = carved.getMesh();
const carvedTris = carvedMesh.triVerts.length / 3;
check(
  "cube.subtract(sphere) yields triangles > cube alone",
  carvedTris > 12,
  `tris=${carvedTris}`
);
check(
  "carved manifold status is NoError",
  carved.status() === "NoError",
  `status=${carved.status()}`
);

// --- Boolean union ---
const off = Manifold.cube([20, 20, 20], true).translate([15, 0, 0]);
const fused = cube.add(off);
const fusedMesh = fused.getMesh();
check(
  "cube.add(translatedCube) yields > 12 triangles (overlap merged)",
  fusedMesh.triVerts.length / 3 > 12
);

// --- Boolean intersect ---
const isect = cube.intersect(off);
check(
  "cube.intersect(translatedCube) is non-empty",
  isect.getMesh().triVerts.length / 3 >= 8 && isect.getMesh().triVerts.length / 3 <= 24,
  `tris=${isect.getMesh().triVerts.length / 3}`
);

// --- Batched union ---
const unionMany = Manifold.union([cube, sphere, off]);
check(
  "Manifold.union([3 manifolds]) is watertight",
  unionMany.status() === "NoError"
);

// --- Plane split ---
const halves = cube.splitByPlane([0, 1, 0], 0);
check(
  "splitByPlane returns 2 halves",
  Array.isArray(halves) && halves.length === 2
);

// Cleanup (manifold-3d requires explicit .delete())
[cube, sphere, carved, off, fused, isect, unionMany, ...halves].forEach((m) => {
  try { m.delete(); } catch (_) {}
});

const failed = results.filter((r) => !r.cond);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`
);
process.exit(failed.length === 0 ? 0 : 1);

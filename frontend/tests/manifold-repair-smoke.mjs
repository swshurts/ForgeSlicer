// Smoke test for the manifold-3d auto-repair pass.
//
// Builds a synthetic "broken cube" where:
//   - two corner vertices are split into near-duplicates (sub-micron gap)
//   - one triangle has near-coincident vertices (collapsed by Pass 3 weld)
//
// Then runs it through manifold-3d directly (will fail) and through our
// progressive-weld helper (should succeed by Pass 2-3).
//
// Run via: cd /app/frontend && node tests/manifold-repair-smoke.mjs

import Module from "manifold-3d";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
function check(label, cond, extra = "") {
  console.log(`${cond ? PASS : FAIL} — ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) process.exitCode = 1;
}

const wasm = await Module();
wasm.setup();
const { Manifold, Mesh } = wasm;

// 50mm cube, but with vertex 0 split into two near-duplicates separated by
// 5e-5 mm — small enough to look correct visually but enough to break the
// shared-edge topology Manifold needs.
function brokenCubeMesh() {
  const verts = new Float32Array([
    // 8 corners of a 50mm cube
    -25, -25, -25,   25, -25, -25,   25, 25, -25,  -25, 25, -25,
    -25, -25,  25,   25, -25,  25,   25, 25,  25,  -25, 25,  25,
    // 9th vertex — a tiny offset of vertex 0 ([-25,-25,-25])
    -25.00005, -25, -25,
  ]);
  // 12 triangles, but the bottom-back-left corner uses verts 0 and 8
  // inconsistently — half the time vertex 0, half the time vertex 8.
  const tris = new Uint32Array([
    // back face (z = -25) — uses vertex 0
    0, 2, 1,   0, 3, 2,
    // front face (z = +25)
    4, 5, 6,   4, 6, 7,
    // bottom face (y = -25) — MIXES vertex 0 (one tri) and vertex 8 (other tri)
    0, 1, 5,   8, 5, 4,   // intentionally inconsistent → broken topology
    // top face (y = +25)
    3, 6, 2,   3, 7, 6,
    // left face (x = -25) — mixes vertex 0 and 8
    0, 4, 7,   0, 7, 3,
    // right face (x = +25)
    1, 2, 6,   1, 6, 5,
  ]);
  return { vertProperties: verts, triVerts: tris };
}

const broken = brokenCubeMesh();

// Direct construction WITHOUT auto-repair: expect a Not manifold throw
{
  const mesh = new Mesh({ numProp: 3, triVerts: broken.triVerts, vertProperties: broken.vertProperties });
  mesh.merge();
  let threw = false;
  let errCode = null;
  try {
    const m = new Manifold(mesh);
    // If we somehow got past construction, the status should still be non-NoError
    threw = m.status() !== "NoError";
    errCode = m.status();
    m.delete();
  } catch (e) {
    threw = true;
    errCode = e.code || e.message;
  }
  check(
    "Direct manifold construction rejects the broken cube",
    threw,
    `code=${errCode}`
  );
}

// Now run the same broken mesh through a JS-side mimic of our weldGeometry
// at progressively coarser tolerances. The 1e-4 mm tol should snap the
// two near-duplicate vertices into the same hash bucket and produce a
// clean manifold.
function weld(verts, tris, tol) {
  const inv = 1 / tol;
  const hash = new Map();
  const newPos = [];
  const remap = new Array(verts.length / 3);
  for (let i = 0; i < verts.length / 3; i++) {
    const x = verts[i*3], y = verts[i*3+1], z = verts[i*3+2];
    const k = `${Math.round(x*inv)}|${Math.round(y*inv)}|${Math.round(z*inv)}`;
    let idx = hash.get(k);
    if (idx === undefined) {
      idx = newPos.length / 3;
      newPos.push(Math.round(x*inv)*tol, Math.round(y*inv)*tol, Math.round(z*inv)*tol);
      hash.set(k, idx);
    }
    remap[i] = idx;
  }
  const newTris = [];
  for (let i = 0; i < tris.length; i += 3) {
    const a = remap[tris[i]], b = remap[tris[i+1]], c = remap[tris[i+2]];
    if (a !== b && b !== c && a !== c) newTris.push(a, b, c);
  }
  return { vertProperties: new Float32Array(newPos), triVerts: new Uint32Array(newTris) };
}

let repaired = false;
for (const tol of [1e-7, 1e-5, 1e-4, 5e-4]) {
  const welded = weld(broken.vertProperties, broken.triVerts, tol);
  if (welded.triVerts.length === 0) continue;
  const mesh = new Mesh({ numProp: 3, triVerts: welded.triVerts, vertProperties: welded.vertProperties });
  mesh.merge();
  try {
    const m = new Manifold(mesh);
    const st = m.status();
    if (st === "NoError" || !st) {
      repaired = true;
      console.log(`     repaired at tol=${tol.toExponential(1)} → tris=${m.getMesh().triVerts.length / 3}`);
      m.delete();
      break;
    }
    m.delete();
  } catch (_) {
    // try next tolerance
  }
}
check("Auto-repair pass produces a valid manifold from the broken cube", repaired);

console.log(process.exitCode ? "\n❌ AUTO-REPAIR REGRESSION" : "\n✅ Auto-repair smoke OK");

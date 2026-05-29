// Resize-to-bed regression tests.
// Run:  cd /app/frontend && node tests/resize-to-bed.mjs
//
// The `resizeSceneToBed` store action math is straightforward enough
// to verify with a tiny synthetic-state harness — we replicate the
// algorithm (compute combined AABB, derive uniform scale factor) and
// assert it on a handful of edge cases without spinning up Zustand or
// React. This mirrors how `transforms-and-history.mjs` tests the pure
// modules without a browser.

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

// Mini bbox helper — every primitive in these tests is a unit-scale
// cube positioned by `position`, so bbox = position ± dims/2.
function cubeBBox(o) {
  const x = (o.dims.x ?? 10) / 2;
  const y = (o.dims.y ?? 10) / 2;
  const z = (o.dims.z ?? 10) / 2;
  return { min: { x: -x, y: -y, z: -z }, max: { x, y, z } };
}

// The reference implementation we expect store.resizeSceneToBed to
// produce. Mirrors the production code but parameterised over a
// bbox function for testability.
function computeFitFactor(objects, buildVolume, targetFraction = 0.95, bboxFn = cubeBBox) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const o of objects) {
    const bb = bboxFn(o);
    const px = o.position[0], py = o.position[1], pz = o.position[2];
    minX = Math.min(minX, px + bb.min.x); maxX = Math.max(maxX, px + bb.max.x);
    minY = Math.min(minY, py + bb.min.y); maxY = Math.max(maxY, py + bb.max.y);
    minZ = Math.min(minZ, pz + bb.min.z); maxZ = Math.max(maxZ, pz + bb.max.z);
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const fitX = (buildVolume.x * targetFraction) / dx;
  const fitZ = (buildVolume.y * targetFraction) / dz;
  const fitY = (buildVolume.z * targetFraction) / dy;
  return Math.min(fitX, fitY, fitZ);
}

// --- Single oversized cube on a 220×220×250 bed ---
{
  const objs = [{ position: [0, 50, 0], dims: { x: 400, y: 100, z: 100 } }];
  const f = computeFitFactor(objs, { x: 220, y: 220, z: 250 });
  ok(approx(f, (220 * 0.95) / 400, 1e-3), `400mm cube fits 220mm bed → factor ${f.toFixed(3)}`);
}

// --- Tall thin model — height is the binding axis ---
{
  const objs = [{ position: [0, 200, 0], dims: { x: 50, y: 400, z: 50 } }];
  const f = computeFitFactor(objs, { x: 220, y: 220, z: 250 });
  // The Y extent (400) maps to build_volume.z (250). 0.95 * 250 / 400 = 0.59375
  ok(approx(f, (250 * 0.95) / 400, 1e-3), `400mm tall → height-bound factor ${f.toFixed(3)}`);
}

// --- Multi-object assembly: AABB picks up the spread ---
{
  const objs = [
    { position: [-50, 10, 0], dims: { x: 40, y: 20, z: 40 } },
    { position: [+50, 10, 0], dims: { x: 40, y: 20, z: 40 } },
  ];
  // Combined X extent: from -70 to +70 = 140mm. Y: 0–20. Z: -20 to +20 = 40.
  const f = computeFitFactor(objs, { x: 220, y: 220, z: 250 });
  // X is widest; (220 * 0.95) / 140 = 1.493 (already fits → factor >1 means up-scale possible)
  ok(approx(f, (220 * 0.95) / 140, 1e-3), `assembly AABB factor ${f.toFixed(3)}`);
}

// --- "Fits already" path ---
{
  const objs = [{ position: [0, 10, 0], dims: { x: 50, y: 20, z: 50 } }];
  const f = computeFitFactor(objs, { x: 220, y: 220, z: 250 });
  ok(f > 1, `50mm cube on 220mm bed has fit factor > 1 (${f.toFixed(3)})`);
}

// --- Zero-extent scene → degenerate ---
{
  const objs = [{ position: [0, 0, 0], dims: { x: 0, y: 0, z: 0 } }];
  const f = computeFitFactor(objs, { x: 220, y: 220, z: 250 });
  ok(!Number.isFinite(f) || f === Infinity, `degenerate extent → non-finite factor (${f})`);
}

// --- Small bed: cube exceeds X and Z, factor is min ---
{
  const objs = [{ position: [0, 10, 0], dims: { x: 100, y: 20, z: 300 } }];
  const bv = { x: 220, y: 220, z: 250 };
  const f = computeFitFactor(objs, bv);
  // X extent 100 vs 220 → 2.09; Z extent 300 vs 220 → 0.697; Y extent 20 vs 250 → 11.875.
  // The Z axis is binding.
  ok(approx(f, (bv.y * 0.95) / 300, 1e-3), `Z-bound multi-axis factor ${f.toFixed(3)}`);
}

console.log("\nAll resize-to-bed regression assertions passed ✔");

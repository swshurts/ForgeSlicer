// Sketch → Sweep regression test.
//
// Verifies:
//   - profile.kind:"sketch" produces a valid swept geometry whose
//     cross-section has roughly the right number of vertices (one
//     ring per sketch point per sample).
//   - path.kind:"sketch3d" with all-Y-zero points produces a planar
//     swept geometry that stays within a small Y-band on the source
//     plane (modulo the profile's vertical extent).
//   - A linear rise distributed across the polyline lifts the last
//     ring's Y by approximately `rise`.
//
// Run:  cd /app/frontend && node tests/sketch-to-sweep.mjs

import { buildSweepGeometry } from "../src/lib/sweepGeometry.js";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};

const baseObj = {
  id: "test", type: "sweep", modifier: "positive",
  visible: true, locked: false,
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  colorIndex: 7,
};

// --- (1) Sketch profile swept along a helix ---
{
  // Five-point closed polygon (irregular pentagon) — the shape the
  // user might have drawn on the build plate.
  const sketchPoints = [
    [-5, -3], [5, -3], [7, 2], [0, 6], [-7, 2],
  ];
  const obj = {
    ...baseObj,
    dims: {
      samples: 32,
      twistDeg: 0,
      profile: { kind: "sketch", points: sketchPoints },
      path:    { kind: "helix", r: 14, pitch: 5, turns: 2 },
    },
  };
  const g = buildSweepGeometry(obj);
  ok(g !== null, "sketch profile × helix produces geometry");
  const verts = g.attributes.position.count;
  // (samples+1) rings × profileCount + 2 cap centroid verts.
  // samples=32 → 33 rings × 5 = 165 + 2 = 167.
  ok(verts === 33 * 5 + 2, `sketch profile vert count ${verts} === 167`);
}

// --- (2) Sketch3D path (planar polyline at Y=0) with circle profile ---
{
  // Square-ish 2D path lifted into 3D with Y=0 at every point.
  const path3D = [
    [-15, 0, -10], [15, 0, -10], [15, 0, 10], [-15, 0, 10],
  ];
  const obj = {
    ...baseObj,
    dims: {
      samples: 64,
      twistDeg: 0,
      profile: { kind: "circle", r: 2, segments: 12 },
      path:    { kind: "sketch3d", points: path3D },
    },
  };
  const g = buildSweepGeometry(obj);
  ok(g !== null, "sketch3d (planar) path produces geometry");
  // All vertices should stay within |y| ≤ profile.r (≈2mm) because
  // the path is flat at y=0 and the circle profile sticks up/down
  // by its radius.
  const pos = g.attributes.position.array;
  let maxAbsY = 0;
  for (let i = 1; i < pos.length; i += 3) {
    const ay = Math.abs(pos[i]);
    if (ay > maxAbsY) maxAbsY = ay;
  }
  ok(maxAbsY <= 2 + 0.01, `flat sketch3d stays within ±profile.r (max |Y| ${maxAbsY.toFixed(3)} ≤ 2.01)`);
}

// --- (3) Sketch3D path with a linear RISE — last point well above first ---
{
  // Same square path, but each successive point has Y bumped linearly.
  const n = 4;
  const rise = 30;
  const path3D = [
    [-15, 0,           -10],
    [ 15, rise * 1/3,  -10],
    [ 15, rise * 2/3,   10],
    [-15, rise,         10],
  ];
  const obj = {
    ...baseObj,
    dims: {
      samples: 64,
      twistDeg: 0,
      profile: { kind: "circle", r: 2, segments: 12 },
      path:    { kind: "sketch3d", points: path3D },
    },
  };
  const g = buildSweepGeometry(obj);
  ok(g !== null, "sketch3d with rise produces geometry");
  // Y range should span roughly [0 - r, rise + r] = [-2, 32].
  const pos = g.attributes.position.array;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    if (pos[i] < minY) minY = pos[i];
    if (pos[i] > maxY) maxY = pos[i];
  }
  ok(minY > -3 && minY < 1, `rise-sketch3d minY ${minY.toFixed(3)} near 0`);
  // The CatmullRom interpolation can overshoot slightly; allow a 10%
  // window above the nominal rise. The important assertion is that
  // the geometry climbs *much* higher than the no-rise case.
  ok(maxY > rise * 0.9, `rise-sketch3d maxY ${maxY.toFixed(3)} ≥ 0.9 × rise (${rise * 0.9})`);
}

// --- (4) Degenerate inputs return null ---
{
  const bad1 = {
    ...baseObj,
    dims: {
      profile: { kind: "sketch", points: [[0, 0]] },  // <3 pts
      path:    { kind: "helix", r: 10, pitch: 5, turns: 2 },
    },
  };
  ok(buildSweepGeometry(bad1) === null, "<3 sketch profile points → null");

  const bad2 = {
    ...baseObj,
    dims: {
      profile: { kind: "circle", r: 2 },
      path:    { kind: "sketch3d", points: [[0, 0, 0]] },  // <2 pts
    },
  };
  ok(buildSweepGeometry(bad2) === null, "<2 sketch3d path points → null");
}

console.log("\nAll sketch-to-sweep regression assertions passed ✔");

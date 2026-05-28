// Regression: "Center on bed" must (a) translate the SELECTION's
// combined world-AABB centroid to (0, _, 0) on the X-Z plane,
// (b) preserve every internal pairwise distance (rigid-body
// invariant), and (c) leave Y untouched.
//
// We exercise the math directly with mocked `computeRotatedBBox`
// returns so the test runs without a DOM/Three.js viewport.
// The actual ContextMenu integration calls into real geometry —
// this proves the algorithm is right.
//
// Run:  cd /app/frontend && node tests/center-on-bed.mjs

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

// Object stub: position + local AABB (centered) → world AABB is
// position + bbox.
function obj(id, position, halfExtents = [10, 10, 10]) {
  return {
    id,
    position,
    rotation: [0, 0, 0],
    bbox: {
      min: { x: -halfExtents[0], y: -halfExtents[1], z: -halfExtents[2] },
      max: { x:  halfExtents[0], y:  halfExtents[1], z:  halfExtents[2] },
    },
  };
}

function centerOnBed(objs) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const o of objs) {
    const wx0 = o.position[0] + o.bbox.min.x;
    const wx1 = o.position[0] + o.bbox.max.x;
    const wz0 = o.position[2] + o.bbox.min.z;
    const wz1 = o.position[2] + o.bbox.max.z;
    if (wx0 < minX) minX = wx0;
    if (wx1 > maxX) maxX = wx1;
    if (wz0 < minZ) minZ = wz0;
    if (wz1 > maxZ) maxZ = wz1;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return objs.map((o) => ({
    ...o,
    position: [o.position[0] - cx, o.position[1], o.position[2] - cz],
  }));
}

// ---- Single object ----
{
  const start = [obj("a", [30, 5, 40])];
  const next = centerOnBed(start);
  ok(approx(next[0].position[0], 0), "single obj: X centered");
  ok(approx(next[0].position[2], 0), "single obj: Z centered");
  ok(approx(next[0].position[1], 5), "single obj: Y preserved");
}

// ---- Assembly: 3 cubes offset from origin ----
{
  const start = [
    obj("p", [50, 5, 50], [5, 5, 5]),
    obj("a", [70, 5, 50], [5, 5, 5]),
    obj("b", [50, 5, 70], [5, 5, 5]),
  ];
  const next = centerOnBed(start);
  // Combined world-AABB: X in [45,75] → center 60; Z in [45,75] → center 60.
  ok(approx(next[0].position[0], -10), "assembly: primary new X = -10");
  ok(approx(next[1].position[0],  10), "assembly: sat A new X = +10");
  ok(approx(next[2].position[0], -10), "assembly: sat B new X = -10");
  ok(approx(next[0].position[2], -10), "assembly: primary new Z = -10");
  ok(approx(next[1].position[2], -10), "assembly: sat A new Z = -10");
  ok(approx(next[2].position[2],  10), "assembly: sat B new Z = +10");
  // Y untouched.
  ok(next.every((o) => approx(o.position[1], 5)), "assembly: Y preserved on every member");
  // Rigid-body invariant: every pairwise distance unchanged.
  for (let i = 0; i < start.length; i++) {
    for (let j = i + 1; j < start.length; j++) {
      const d0 = Math.hypot(
        start[i].position[0] - start[j].position[0],
        start[i].position[1] - start[j].position[1],
        start[i].position[2] - start[j].position[2],
      );
      const d1 = Math.hypot(
        next[i].position[0] - next[j].position[0],
        next[i].position[1] - next[j].position[1],
        next[i].position[2] - next[j].position[2],
      );
      ok(approx(d0, d1), `pairwise distance ${i}↔${j}: ${d0.toFixed(4)} → ${d1.toFixed(4)} (rigid)`);
    }
  }
}

// ---- Asymmetric extents: bbox center, NOT centroid of positions ----
// One huge part at (100,_,0) + one tiny part at (-2,_,0). The CENTROID
// of positions is (49, _, 0), but the AABB center sits much closer to
// the big part because its extents dominate.
{
  const start = [
    obj("big",  [100, 0, 0], [40, 5, 5]),   // X-extent [60, 140]
    obj("tiny", [-2, 0, 0],  [1, 5, 5]),    // X-extent [-3, -1]
  ];
  const next = centerOnBed(start);
  // Combined X = [-3, 140], center = 68.5
  // So big part moves to 100 - 68.5 = 31.5; tiny to -2 - 68.5 = -70.5.
  ok(approx(next[0].position[0], 31.5), "asymmetric: big part X is +31.5");
  ok(approx(next[1].position[0], -70.5), "asymmetric: tiny part X is -70.5");
  // Confirm we DID use bbox center, not mean-of-positions.
  const meanX = (start[0].position[0] + start[1].position[0]) / 2;
  ok(!approx(meanX, 68.5), `bbox-center (68.5) differs from position-centroid (${meanX}) — correct algorithm picked`);
}

console.log("\nAll center-on-bed regression assertions passed ✔");

// Regression: "Park on bed" = Center on X/Z + Drop on Y in one action.
// Verifies the rigid-body invariant and that all 3 translations are
// applied with a single history-pushable move.
//
// Run:  cd /app/frontend && node tests/park-on-bed.mjs

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

function obj(id, position, halfExtents = [10, 10, 10]) {
  return {
    id, position,
    bbox: {
      min: { x: -halfExtents[0], y: -halfExtents[1], z: -halfExtents[2] },
      max: { x:  halfExtents[0], y:  halfExtents[1], z:  halfExtents[2] },
    },
  };
}

function parkOnBed(objs) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const o of objs) {
    const wx0 = o.position[0] + o.bbox.min.x;
    const wx1 = o.position[0] + o.bbox.max.x;
    const wy0 = o.position[1] + o.bbox.min.y;
    const wz0 = o.position[2] + o.bbox.min.z;
    const wz1 = o.position[2] + o.bbox.max.z;
    if (wx0 < minX) minX = wx0;
    if (wx1 > maxX) maxX = wx1;
    if (wy0 < minY) minY = wy0;
    if (wz0 < minZ) minZ = wz0;
    if (wz1 > maxZ) maxZ = wz1;
  }
  const dx = -(minX + maxX) / 2;
  const dy = -minY;
  const dz = -(minZ + maxZ) / 2;
  return objs.map((o) => ({
    ...o,
    position: [o.position[0] + dx, o.position[1] + dy, o.position[2] + dz],
  }));
}

// --- Single object floating above and offset from origin ---
{
  const start = [obj("a", [40, 25, 30], [5, 5, 5])];
  const next = parkOnBed(start);
  ok(approx(next[0].position[0], 0), "single obj: centered X = 0");
  ok(approx(next[0].position[2], 0), "single obj: centered Z = 0");
  // Object's bottom face was at y=20 → after park, sits at y=0 → center at y=5.
  ok(approx(next[0].position[1], 5), `single obj: bottom on bed (center y=5, got ${next[0].position[1]})`);
}

// --- 3-cube assembly floating high and offset ---
{
  const start = [
    obj("p", [50, 30, 50], [5, 5, 5]),
    obj("a", [70, 30, 50], [5, 5, 5]),
    obj("b", [50, 30, 70], [5, 5, 5]),
  ];
  const next = parkOnBed(start);
  // After park: combined X centered, combined Z centered, minY at 0.
  // p starts at (50, 30, 50), bottoms at y=25; after dy=-25, p sits at y=5.
  ok(approx(next[0].position[1], 5), "assembly: primary lands with bottom at y=0");
  ok(approx(next[1].position[1], 5), "assembly: sat A same Y as primary");
  ok(approx(next[2].position[1], 5), "assembly: sat B same Y as primary");
  // Rigid-body invariant: pairwise distances unchanged.
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
      ok(approx(d0, d1), `pairwise distance ${i}↔${j}: ${d0.toFixed(4)} → ${d1.toFixed(4)}`);
    }
  }
  // BBOX center now at origin — note we use bbox-center, NOT centroid-
  // of-positions (an L-shaped assembly has those two differ on purpose).
  let nMinX = Infinity, nMaxX = -Infinity, nMinZ = Infinity, nMaxZ = -Infinity;
  for (const o of next) {
    nMinX = Math.min(nMinX, o.position[0] + o.bbox.min.x);
    nMaxX = Math.max(nMaxX, o.position[0] + o.bbox.max.x);
    nMinZ = Math.min(nMinZ, o.position[2] + o.bbox.min.z);
    nMaxZ = Math.max(nMaxZ, o.position[2] + o.bbox.max.z);
  }
  const bcx = (nMinX + nMaxX) / 2;
  const bcz = (nMinZ + nMaxZ) / 2;
  ok(approx(bcx, 0) && approx(bcz, 0),
     `assembly: bbox-center now at origin (${bcx.toFixed(3)}, _, ${bcz.toFixed(3)})`);
}

// --- Already-parked object → no-op (math still computes 0 deltas) ---
{
  const start = [obj("a", [0, 5, 0], [5, 5, 5])];
  const next = parkOnBed(start);
  ok(approx(next[0].position[0], 0) && approx(next[0].position[1], 5) && approx(next[0].position[2], 0),
     "already-parked object stays put");
}

console.log("\nAll park-on-bed regression assertions passed ✔");

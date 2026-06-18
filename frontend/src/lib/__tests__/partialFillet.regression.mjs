// Regression test for partialFillet.js cube chamfer/fillet.
//
// Originally a chamfer applied to any cube edge whose two perpendicular
// "min"/"max" picks had OPPOSITE signs (e.g. front-right vertical edge:
// xPos=max, zPos=min) produced a CW polygon, which Manifold treats as a
// HOLE — extrude returned empty → carved.add(emptyPrism) → INVALID
// manifold → cube vanished on the second chamfer the user applied.
// Six of the twelve cube edges were affected. See the user bug report
// dated 2026-02 for screenshots.
//
// Run with:  node /app/frontend/src/lib/__tests__/partialFillet.regression.mjs
//
// This is a standalone node test (CRA doesn't have Jest configured here).
// It boots manifold-3d directly and reproduces the cube-chamfer pipeline
// inlined from partialFillet.js — no React / Three.js needed.

import Module from "manifold-3d";

const wasm = await Module();
wasm.setup();

const CUBE_EDGES = [
  { id: "e_X_minY_minZ", axis: "X", yPos: "min", zPos: "min" },
  { id: "e_X_minY_maxZ", axis: "X", yPos: "min", zPos: "max" },
  { id: "e_X_maxY_minZ", axis: "X", yPos: "max", zPos: "min" },
  { id: "e_X_maxY_maxZ", axis: "X", yPos: "max", zPos: "max" },
  { id: "e_Y_minX_minZ", axis: "Y", xPos: "min", zPos: "min" },
  { id: "e_Y_minX_maxZ", axis: "Y", xPos: "min", zPos: "max" },
  { id: "e_Y_maxX_minZ", axis: "Y", xPos: "max", zPos: "min" },
  { id: "e_Y_maxX_maxZ", axis: "Y", xPos: "max", zPos: "max" },
  { id: "e_Z_minX_minY", axis: "Z", xPos: "min", yPos: "min" },
  { id: "e_Z_minX_maxY", axis: "Z", xPos: "min", yPos: "max" },
  { id: "e_Z_maxX_minY", axis: "Z", xPos: "max", yPos: "min" },
  { id: "e_Z_maxX_maxY", axis: "Z", xPos: "max", yPos: "max" },
];
const SLACK = 0.5;

function buildChamferPieces(edge, dimsLocal, r) {
  const hx = dimsLocal.x / 2, hy = dimsLocal.y / 2, hz = dimsLocal.z / 2;
  const signFor = (a) => {
    if (a === "X" && edge.xPos) return edge.xPos === "max" ? 1 : -1;
    if (a === "Y" && edge.yPos) return edge.yPos === "max" ? 1 : -1;
    if (a === "Z" && edge.zPos) return edge.zPos === "max" ? 1 : -1;
    return 0;
  };
  const perp = ["X", "Y", "Z"].filter((a) => a !== edge.axis);
  const [pA, pB] = perp;
  const halfA = pA === "X" ? hx : pA === "Y" ? hy : hz;
  const halfB = pB === "X" ? hx : pB === "Y" ? hy : hz;
  const signA = signFor(pA), signB = signFor(pB);
  const lenAxis = edge.axis === "X" ? dimsLocal.x : edge.axis === "Y" ? dimsLocal.y : dimsLocal.z;
  const blockDims = { x: r, y: r, z: r };
  blockDims[edge.axis.toLowerCase()] = lenAxis + SLACK;
  const blockCenter = [0, 0, 0];
  if (pA === "X") blockCenter[0] = signA * (halfA - r/2);
  else if (pA === "Y") blockCenter[1] = signA * (halfA - r/2);
  else blockCenter[2] = signA * (halfA - r/2);
  if (pB === "X") blockCenter[0] = signB * (halfB - r/2);
  else if (pB === "Y") blockCenter[1] = signB * (halfB - r/2);
  else blockCenter[2] = signB * (halfB - r/2);

  const block = wasm.Manifold.cube([blockDims.x, blockDims.y, blockDims.z], true).translate(blockCenter);

  const half = r / 2;
  const innerA = -half * signA, innerB = -half * signB;
  const towardA = +half * signA, towardB = +half * signB;
  const tri = [[innerA, innerB], [towardA, innerB], [innerA, towardB]];
  if (signA * signB < 0) {
    const t = tri[1]; tri[1] = tri[2]; tri[2] = t;
  }
  const cs = new wasm.CrossSection([tri]);
  let prism = cs.extrude(lenAxis, 0, 0, [1, 1], true);
  cs.delete();
  if (edge.axis === "X") prism = prism.rotate([0, 90, 0]);
  else if (edge.axis === "Y") prism = prism.rotate([90, 0, 0]);
  prism = prism.translate(blockCenter);
  return { block, prism };
}

function runCase(label, dims, edgeIds, r) {
  const dimsLocal = { x: dims.x, y: dims.z, z: dims.y };
  let cube = wasm.Manifold.cube([dimsLocal.x, dimsLocal.y, dimsLocal.z], true);
  const expectedBBox = {
    minX: -dimsLocal.x/2, maxX: dimsLocal.x/2,
    minY: -dimsLocal.y/2, maxY: dimsLocal.y/2,
    minZ: -dimsLocal.z/2, maxZ: dimsLocal.z/2,
  };
  for (const id of edgeIds) {
    const edge = CUBE_EDGES.find((e) => e.id === id);
    if (!edge) throw new Error(`Unknown edge ${id}`);
    const { block, prism } = buildChamferPieces(edge, dimsLocal, r);
    const carved = cube.subtract(block);
    cube = carved.add(prism);
    const bb = cube.boundingBox();
    if (!isFinite(bb.min[0]) || !isFinite(bb.max[0])) {
      throw new Error(`${label}: cube became invalid after chamfering ${id}`);
    }
    // Bbox should match the original cube's bbox (chamfers don't add material).
    const TOL = 1e-4;
    for (const k of ["minX","maxX","minY","maxY","minZ","maxZ"]) {
      const i = k.endsWith("X") ? 0 : k.endsWith("Y") ? 1 : 2;
      const side = k.startsWith("min") ? "min" : "max";
      const v = bb[side][i];
      const want = expectedBBox[k];
      if (Math.abs(v - want) > TOL) {
        throw new Error(`${label}: bbox.${k}=${v} expected ${want} after ${id}`);
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log(`PASS  ${label}  (chamfered ${edgeIds.length} edges)`);
}

// ── Case 1: tall thin column 8x20x118, two right-side vertical edges ──
// This reproduces the user-reported regression exactly.
runCase("8x20x118 column, both right verticals", { x: 8, y: 20, z: 118 },
  ["e_Y_maxX_maxZ", "e_Y_maxX_minZ"], 2);

// ── Case 2: all 12 edges on a 20³ cube ──
runCase("20³ cube, all 12 edges", { x: 20, y: 20, z: 20 },
  CUBE_EDGES.map((e) => e.id), 2);

// ── Case 3: the four previously-broken X-axis edges ──
runCase("X-axis edges with mixed signs", { x: 30, y: 30, z: 30 },
  ["e_X_minY_maxZ", "e_X_maxY_minZ"], 3);

// ── Case 4: the four previously-broken Z-axis edges ──
runCase("Z-axis edges with mixed signs", { x: 30, y: 30, z: 30 },
  ["e_Z_minX_maxY", "e_Z_maxX_minY"], 3);

// ── Case 5: Item-mode chamfer simulated via uniform path (no edgeFillets entries).
//    Mimics the user's scenario where `dims.edgeRadius=2` is the only signal;
//    the partial-fillet engine must materialise all 12 edges via the uniform
//    fallback. This is the path the STL-export pipeline goes through when
//    edgeFillets has entries (since the synchronous buildGeometry returns a
//    SHARP placeholder for those cubes — see manifoldEngine.buildObjectManifold
//    fast-path).
function runUniformCase(label, dims, r) {
  const dimsLocal = { x: dims.x, y: dims.z, z: dims.y };
  let cube = wasm.Manifold.cube([dimsLocal.x, dimsLocal.y, dimsLocal.z], true);
  for (const edge of CUBE_EDGES) {
    const { block, prism } = buildChamferPieces(edge, dimsLocal, r);
    const carved = cube.subtract(block);
    cube = carved.add(prism);
    const bb = cube.boundingBox();
    if (!isFinite(bb.min[0])) throw new Error(`${label}: invalid manifold after ${edge.id}`);
  }
  // eslint-disable-next-line no-console
  console.log(`PASS  ${label}  (all 12 edges via uniform path)`);
}
runUniformCase("Item-mode uniform 2mm chamfer on 8x20x118 column", { x: 8, y: 20, z: 118 }, 2);

// eslint-disable-next-line no-console
console.log("\nAll partialFillet regressions PASS.");

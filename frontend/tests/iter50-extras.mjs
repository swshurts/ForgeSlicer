// Regression tests for iter 50:
//   - Wrap to surface (cylinder) on all 9 patterns
//   - 5 new V2 patterns produce valid geometry
//   - Imperial hardware table completeness + correct unit conversion
//   - hardwareToFastenerOpts works with imperial spec
//
// Run:  cd /app/frontend && node tests/iter50-extras.mjs

import {
  buildTextureGeometry,
  TEXTURE_PATTERNS,
  TEXTURE_DEFAULTS,
} from "../src/lib/textureGeometry.js";
import {
  HARDWARE_TABLE_IMPERIAL,
  HARDWARE_LENGTHS_BY_GRADE_IMPERIAL,
  hardwareToFastenerOpts,
} from "../src/lib/hardwareLibrary.js";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

// ---- All 9 patterns build valid geometry ----
ok(TEXTURE_PATTERNS.length === 9, `9 patterns in v1+v2 (got ${TEXTURE_PATTERNS.length})`);
const v2Ids = ["diamond_plate", "brick", "fabric", "hex_camo", "voronoi"];
const presentIds = TEXTURE_PATTERNS.map((p) => p.id);
for (const id of v2Ids) {
  ok(presentIds.includes(id), `v2 pattern "${id}" registered`);
}

for (const p of TEXTURE_PATTERNS) {
  const obj = {
    id: "t", type: "texture", modifier: "positive",
    visible: true, locked: false, position: [0, 0, 0],
    rotation: [0, 0, 0], scale: [1, 1, 1], colorIndex: 5,
    dims: { ...TEXTURE_DEFAULTS, pattern: p.id, ...p.defaults },
  };
  const g = buildTextureGeometry(obj);
  ok(g && g.attributes.position.count > 0, `pattern ${p.id} produces valid geometry`);
  const tris = g.index ? g.index.count / 3 : 0;
  ok(tris > 10 && tris < 200000, `pattern ${p.id} tri count reasonable (${tris})`);
}

// ---- Wrap to cylinder ----
// Build a bumps texture w=62.8 (=2*pi*10 → wrapRadius autocalc≈10),
// wrap onto a cylinder of radius 10. After wrap, all surface vertices
// should sit at radius ~10 from the axis (plus the relief height).
{
  const flatObj = {
    type: "texture", position: [0,0,0], rotation: [0,0,0], scale: [1,1,1],
    dims: { ...TEXTURE_DEFAULTS, pattern: "bumps", w: 62.8, d: 20, tileSize: 3, height: 1, depth: 0.8, wrap: "flat" },
  };
  const wrappedObj = {
    ...flatObj,
    dims: { ...flatObj.dims, wrap: "cylinder", wrapRadius: 10 },
  };
  const gF = buildTextureGeometry(flatObj);
  const gW = buildTextureGeometry(wrappedObj);

  // Flat: max(|x|) ≈ w/2 = 31.4
  let flatMaxX = 0;
  const pF = gF.attributes.position.array;
  for (let i = 0; i < pF.length; i += 3) flatMaxX = Math.max(flatMaxX, Math.abs(pF[i]));
  ok(approx(flatMaxX, 31.4, 0.5), `flat: max |X| ≈ w/2 (${flatMaxX.toFixed(2)})`);

  // Wrapped: vertices live on or near a cylinder of radius 10 (plus
  // relief which extends to radius 11). Check that ALL vertices have
  // sqrt(x² + z²) ∈ [9, 12] (base plate inner face at r=10-0.8=9.2;
  // bump tips at r=10+1=11).
  const pW = gW.attributes.position.array;
  let minR = Infinity, maxR = 0;
  for (let i = 0; i < pW.length; i += 3) {
    const r = Math.hypot(pW[i], pW[i + 2]);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  ok(minR >= 8.5 && maxR <= 12.5,
     `wrapped: all verts in ring (r ∈ [${minR.toFixed(2)}, ${maxR.toFixed(2)}], expected ~[9.2, 11])`);

  // The wrapped tri count should match the flat count (just transformed,
  // no verts added/removed).
  ok((gF.index ? gF.index.count : 0) === (gW.index ? gW.index.count : 0),
     "wrap doesn't change triangle count (verts just repositioned)");
}

// ---- Imperial hardware table ----
ok(HARDWARE_TABLE_IMPERIAL.length === 8,
   `8 imperial grades (got ${HARDWARE_TABLE_IMPERIAL.length})`);

// 1/4-20 = 0.250" diameter, 20 TPI
{
  const q = HARDWARE_TABLE_IMPERIAL.find((s) => s.id === "1/4-20");
  ok(q !== undefined, "1/4-20 grade exists");
  // 0.250" * 25.4 / 2 = 3.175mm major radius
  ok(approx(q.majorR, 3.175, 0.01), `1/4-20 majorR ≈ 3.175mm (got ${q.majorR.toFixed(4)})`);
  // 25.4mm / 20 TPI = 1.27mm pitch
  ok(approx(q.pitch, 1.27, 0.005), `1/4-20 pitch ≈ 1.27mm (got ${q.pitch.toFixed(4)})`);
}

// Every imperial grade has at least 1 length.
for (const spec of HARDWARE_TABLE_IMPERIAL) {
  const lens = HARDWARE_LENGTHS_BY_GRADE_IMPERIAL[spec.id];
  ok(Array.isArray(lens) && lens.length > 0,
     `${spec.id}: imperial length list non-empty (${lens?.length})`);
}

// hardwareToFastenerOpts works with imperial.
{
  const spec = HARDWARE_TABLE_IMPERIAL.find((s) => s.id === "1/4-20");
  const opts = hardwareToFastenerOpts(spec, 25.4);  // 1" bolt
  ok(approx(opts.boltR, 3.175), "1/4-20 × 1\" → boltR 3.175mm");
  ok(approx(opts.pitch, 1.27), "1/4-20 × 1\" → pitch 1.27mm");
  ok(opts.shaftH === 25.4, "shaftH = chosen length (25.4mm)");
  ok(approx(opts.workThickness, 20.4), "default workThickness = length - 5");
  ok(opts.groupName === "Fastener 1/4-20×25.4", `groupName = "Fastener 1/4-20×25.4" (got "${opts.groupName}")`);
}

console.log("\nAll iter50-extras regression assertions passed ✔");

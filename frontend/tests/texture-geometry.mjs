// Texture geometry regression tests.
//
// Verifies all 4 patterns produce valid, non-empty merged geometry
// with reasonable triangle counts and the expected vertical extent
// (base plate at y∈[-depth, 0], relief at y∈[0, height]).
//
// Run:  cd /app/frontend && node tests/texture-geometry.mjs

import {
  buildTextureGeometry,
  TEXTURE_PATTERNS,
  TEXTURE_DEFAULTS,
} from "../src/lib/textureGeometry.js";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

// Catalogue completeness
ok(TEXTURE_PATTERNS.length === 4,
   `4 patterns in v1 (knurl, hex, bumps, ridges), got ${TEXTURE_PATTERNS.length}`);
const ids = TEXTURE_PATTERNS.map((p) => p.id);
ok(ids.includes("knurl_diamond"), "knurl_diamond present");
ok(ids.includes("hex"), "hex present");
ok(ids.includes("bumps"), "bumps present");
ok(ids.includes("ridges_linear"), "ridges_linear present");

// Each pattern produces valid geometry with all expected attributes.
for (const p of TEXTURE_PATTERNS) {
  const obj = {
    id: "t", type: "texture", modifier: "positive",
    visible: true, locked: false, position: [0, 0, 0],
    rotation: [0, 0, 0], scale: [1, 1, 1], colorIndex: 5,
    dims: { ...TEXTURE_DEFAULTS, pattern: p.id, ...p.defaults },
  };
  const g = buildTextureGeometry(obj);
  ok(g, `pattern ${p.id} returns geometry`);
  ok(g.attributes.position && g.attributes.position.count > 0,
     `pattern ${p.id} has vertices (${g.attributes.position.count})`);
  ok(g.attributes.normal && g.attributes.normal.count === g.attributes.position.count,
     `pattern ${p.id} has matching normals`);
  const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  ok(tris >= 12, `pattern ${p.id} has at least 12 triangles (got ${tris})`);
  ok(tris < 100000, `pattern ${p.id} stays under 100k triangles at default dims (got ${tris})`);

  // Verify vertical extent: base plate at y=[-depth, 0], relief
  // optionally rising to y=height.
  const pos = g.attributes.position.array;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    if (pos[i] < minY) minY = pos[i];
    if (pos[i] > maxY) maxY = pos[i];
  }
  ok(approx(minY, -obj.dims.depth, 0.1),
     `pattern ${p.id} base plate bottom at y=-depth (got ${minY.toFixed(3)})`);
  ok(maxY >= obj.dims.height * 0.5 - 0.05,
     `pattern ${p.id} relief reaches at least half of height (max y ${maxY.toFixed(3)} ≥ ${(obj.dims.height * 0.5).toFixed(2)})`);
}

// Degenerate inputs: missing dims falls back gracefully.
{
  const g = buildTextureGeometry({ dims: {} });
  ok(g && g.attributes.position.count > 0, "missing-dims defaults still produce geometry");
}

// Footprint scaling: doubling w should roughly double the number of
// pattern tiles. Use bumps (regular grid, easy to count).
{
  const small = buildTextureGeometry({ dims: { ...TEXTURE_DEFAULTS, pattern: "bumps", w: 15, d: 15 } });
  const big   = buildTextureGeometry({ dims: { ...TEXTURE_DEFAULTS, pattern: "bumps", w: 30, d: 30 } });
  const smallTris = small.index ? small.index.count / 3 : small.attributes.position.count / 3;
  const bigTris = big.index ? big.index.count / 3 : big.attributes.position.count / 3;
  ok(bigTris > smallTris * 1.5,
     `bumps footprint 4x area → tri count grows roughly ~4x (small ${smallTris}, big ${bigTris})`);
}

// Tile size: smaller tiles → more tiles → more triangles.
{
  const coarse = buildTextureGeometry({ dims: { ...TEXTURE_DEFAULTS, pattern: "hex", w: 30, d: 30, tileSize: 6 } });
  const fine   = buildTextureGeometry({ dims: { ...TEXTURE_DEFAULTS, pattern: "hex", w: 30, d: 30, tileSize: 2 } });
  const coarseT = coarse.index ? coarse.index.count / 3 : coarse.attributes.position.count / 3;
  const fineT = fine.index ? fine.index.count / 3 : fine.attributes.position.count / 3;
  ok(fineT > coarseT * 2, `hex finer tiles produce significantly more tris (coarse ${coarseT}, fine ${fineT})`);
}

console.log("\nAll texture-geometry regression assertions passed ✔");

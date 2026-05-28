// Texture geometry — generates printable, geometric textures as
// real BufferGeometry instances. Each pattern is built by tiling
// small primitives across a rectangular base, then merging into one
// mesh so the scene only carries a single object per texture (not
// hundreds of bump children).
//
// Why geometric textures (vs. visual-only image maps)?
//   The whole point of this app is producing printable models. A
//   texture that exists only in the renderer doesn't make it to the
//   slicer. So every pattern here produces actual displaced surface
//   geometry that survives STL export, CSG union/subtract, and
//   slicing into G-code.
//
// Apply modes:
//   - "positive" → the texture is a raised relief that gets union'd
//                  onto a target via CSG (knobby grip, treaded sole).
//   - "negative" → the texture is engraved into the target (engraved
//                  serial number, decorative groove pattern).
//   The texture object itself is just a regular positive/negative
//   primitive; the CSG eval pipeline handles the rest.
//
// `dims` for a texture object:
//   {
//     pattern,    // "knurl_diamond" | "hex" | "bumps" | "ridges_linear"
//     w, d,       // base footprint in world mm (W along X, D along Z)
//     tileSize,   // periodicity of one tile (mm). Smaller = denser.
//     height,     // depth of the relief in mm. Positive = raised
//                 // when modifier=positive; carved when modifier=negative.
//     depth,      // base-plate thickness (mm). Texture sits ON TOP of a
//                 // base, so unioning onto a host won't leave gaps and
//                 // subtracting cuts BELOW the host's surface.
//   }
//
// Triangle count scales with tile density. For dense patterns
// (knurl, hex) we cap segments per tile to keep merged-mesh size
// manageable; the test file confirms typical patterns stay well
// under 50k triangles at the default tileSize.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const PATTERN_KINDS = {
  knurl_diamond:  buildKnurlDiamond,
  hex:            buildHexGrid,
  bumps:          buildBumps,
  ridges_linear:  buildRidgesLinear,
  // V2 patterns (iter 50):
  diamond_plate:  buildDiamondPlate,
  brick:          buildBrick,
  fabric:         buildFabric,
  hex_camo:       buildHexCamo,
  voronoi:        buildVoronoi,
};

// --------- Diamond knurl (handles, grips) ------------------------------
// Each tile is a square pyramid with its tip pointing up. The grid is
// rotated 45° in world space so consecutive pyramids form a diamond
// (criss-cross) pattern when viewed from above — the classic knurl
// you see on tool handles. Pyramid bases overlap slightly so adjacent
// tiles don't leave manifold-breaking gaps after merge.
function buildKnurlDiamond({ w, d, tileSize, height }) {
  const overlap = 1.02;
  const baseSize = tileSize * overlap;
  // Diagonal step (rotated 45° pattern): each row is offset by half a
  // tile, doubling the perceived density without doubling tile count.
  const stepX = tileSize;
  const stepZ = tileSize;
  const nx = Math.max(1, Math.ceil(w / stepX));
  const nz = Math.max(1, Math.ceil(d / stepZ));
  const geoms = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      // Two interleaved pyramids per (i,j): one centered, one offset
      // by half a tile — produces the diamond cross-hatch.
      const cx0 = (i + 0.5) * stepX - w / 2;
      const cz0 = (j + 0.5) * stepZ - d / 2;
      const cx1 = (i + 1.0) * stepX - w / 2;
      const cz1 = (j + 1.0) * stepZ - d / 2;
      for (const [cx, cz] of [[cx0, cz0], [cx1, cz1]]) {
        if (Math.abs(cx) > w / 2 + baseSize / 2) continue;
        if (Math.abs(cz) > d / 2 + baseSize / 2) continue;
        const pyramid = new THREE.ConeGeometry(baseSize / 2, height, 4, 1);
        // ConeGeometry's apex is +Y; we want pyramids rising along +Y
        // FROM y=0, so translate apex to y=height and base to y=0.
        pyramid.translate(0, height / 2, 0);
        // Rotate 45° around Y so each tile's square base aligns with
        // the diagonal — that's what gives the diamond pattern its
        // characteristic criss-cross look at the merged level.
        pyramid.rotateY(Math.PI / 4);
        pyramid.translate(cx, 0, cz);
        geoms.push(pyramid);
      }
    }
  }
  return geoms;
}

// --------- Hex grid (honeycomb, vents) ---------------------------------
// Raised hex prisms tiled with the standard offset row pattern. Each
// prism has 6 sides and a flat top — perfect for vent grilles, hex
// pockets, or decorative honeycomb panels.
function buildHexGrid({ w, d, tileSize, height }) {
  const r = tileSize / 2;           // hex circumradius
  const hexW = r * Math.sqrt(3);    // hex flat-to-flat width
  const hexH = r * 1.5;             // row pitch (3/2 * r for offset rows)
  const nx = Math.max(1, Math.ceil(w / hexW) + 1);
  const nz = Math.max(1, Math.ceil(d / hexH) + 1);
  const geoms = [];
  for (let row = 0; row < nz; row++) {
    for (let col = 0; col < nx; col++) {
      const cx = col * hexW + (row % 2 ? hexW / 2 : 0) - w / 2;
      const cz = row * hexH - d / 2;
      if (Math.abs(cx) > w / 2 + r) continue;
      if (Math.abs(cz) > d / 2 + r) continue;
      const hex = new THREE.CylinderGeometry(r * 0.92, r * 0.92, height, 6, 1);
      hex.translate(0, height / 2, 0);
      // Three.js cylinder is flat-faced when segments=6, so the hex
      // ends up oriented with vertices pointing up/down. Rotate 30°
      // around Y to make the flats point along X (the usual hex grid
      // orientation — flats on top/bottom of each tile).
      hex.rotateY(Math.PI / 6);
      hex.translate(cx, 0, cz);
      geoms.push(hex);
    }
  }
  return geoms;
}

// --------- Bumps (anti-slip, tactile) ----------------------------------
// Grid of hemispheres. Common on stair-treads and tactile paving.
function buildBumps({ w, d, tileSize, height }) {
  const r = Math.min(tileSize * 0.4, height * 1.2);
  const nx = Math.max(1, Math.ceil(w / tileSize));
  const nz = Math.max(1, Math.ceil(d / tileSize));
  const geoms = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = (i + 0.5) * tileSize - w / 2;
      const cz = (j + 0.5) * tileSize - d / 2;
      if (Math.abs(cx) > w / 2) continue;
      if (Math.abs(cz) > d / 2) continue;
      // SphereGeometry produces a full sphere; we want only the upper
      // hemisphere. Pass thetaStart=0, thetaLength=PI/2 to cut at the
      // equator. Then translate the cut plane to y=0 so the dome rises
      // from the base plate.
      const dome = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.translate(cx, 0, cz);
      geoms.push(dome);
    }
  }
  return geoms;
}

// --------- Linear ridges (fluted columns, anti-slip ramps) -------------
// Parallel strips of half-cylinders running along the Z axis. Each
// ridge is a full cylinder whose radius is `height/2` and whose
// center sits at y=height/2, so geometrically the cylinder occupies
// y ∈ [0, height] — perfectly stacked on top of the base plate with
// no overhang. The `tileSize` parameter sets the horizontal spacing
// between adjacent ridges (centers); wider tile → fewer ridges.
function buildRidgesLinear({ w, d, tileSize, height }) {
  const r = height / 2;
  const nx = Math.max(1, Math.ceil(w / tileSize));
  const geoms = [];
  for (let i = 0; i < nx; i++) {
    const cx = (i + 0.5) * tileSize - w / 2;
    if (Math.abs(cx) > w / 2 + r) continue;
    // Cylinder along Z axis, length=d. radialSegments=16 is the sweet
    // spot for visual smoothness vs triangle count. openEnded=false
    // so the cylinder caps butt cleanly against the base plate edges.
    const ridge = new THREE.CylinderGeometry(r, r, d, 16, 1, false);
    // Three.js cylinder runs along +Y by default; rotate so its axis
    // points along Z.
    ridge.rotateX(Math.PI / 2);
    // Lift so the cylinder sits ON TOP of the base plate (center at
    // y=r, occupying y ∈ [0, 2r] = [0, height]).
    ridge.translate(cx, r, 0);
    geoms.push(ridge);
  }
  return geoms;
}

// --------- Diamond plate (industrial floor / running boards) -----------
// Like knurl, but each tile has FOUR small extruded diamond bars in a
// pinwheel pattern instead of a single pyramid. Visually heavier; the
// "diamond plate" you see on truck running boards and stair treads.
// Implementation: each tile gets a 2×2 grid of tiny prism diamonds
// rotated 45°, with deep gaps between for visual contrast.
function buildDiamondPlate({ w, d, tileSize, height }) {
  const nx = Math.max(1, Math.ceil(w / tileSize));
  const nz = Math.max(1, Math.ceil(d / tileSize));
  const geoms = [];
  const barLen = tileSize * 0.55;
  const barWid = tileSize * 0.18;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = (i + 0.5) * tileSize - w / 2;
      const cz = (j + 0.5) * tileSize - d / 2;
      // Two perpendicular bars per tile, rotated 45° together so the
      // overall tile reads as an X / diamond shape on top.
      for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.BoxGeometry(barLen, height, barWid);
        bar.translate(0, height / 2, 0);
        bar.rotateY(angle);
        bar.translate(cx, 0, cz);
        geoms.push(bar);
      }
    }
  }
  return geoms;
}

// --------- Brick wall ---------------------------------------------------
// Rectangular bricks (2:1 aspect ratio) tiled in the classic running
// bond — every other row offset by half a brick. Each brick is a small
// raised box; the gaps between bricks are the mortar lines.
function buildBrick({ w, d, tileSize, height }) {
  const brickW = tileSize * 2;
  const brickD = tileSize;
  const mortar = tileSize * 0.12;
  const stepX = brickW + mortar;
  const stepZ = brickD + mortar;
  const nx = Math.ceil(w / stepX) + 1;
  const nz = Math.ceil(d / stepZ) + 1;
  const geoms = [];
  for (let row = 0; row < nz; row++) {
    for (let col = 0; col < nx; col++) {
      const offsetX = (row % 2 ? stepX / 2 : 0);
      const cx = col * stepX + offsetX - w / 2;
      const cz = row * stepZ - d / 2;
      if (Math.abs(cx) > w / 2 + brickW / 2) continue;
      if (Math.abs(cz) > d / 2 + brickD / 2) continue;
      const brick = new THREE.BoxGeometry(brickW, height, brickD);
      brick.translate(cx, height / 2, cz);
      geoms.push(brick);
    }
  }
  return geoms;
}

// --------- Fabric weave -------------------------------------------------
// Interlaced perpendicular cylinders simulating a basket weave. Warp
// runs along Z, weft runs along X; each thread is a low-amplitude
// sine-wave height so they "weave" over and under each other. Looks
// like burlap / basket / canvas at the right tileSize.
function buildFabric({ w, d, tileSize, height }) {
  const r = height * 0.45;
  const nx = Math.max(1, Math.ceil(w / tileSize) + 1);
  const nz = Math.max(1, Math.ceil(d / tileSize) + 1);
  const geoms = [];
  // Warp threads (run along Z).
  for (let i = 0; i < nx; i++) {
    const cx = i * tileSize - w / 2;
    if (Math.abs(cx) > w / 2 + r) continue;
    // Use a slim long cylinder; each thread sits at y = height/2 so
    // both sets weave through the same plane. The visual "over/under"
    // comes from the radial tile-spacing being smaller than the
    // thread diameter so the perpendicular threads physically
    // intersect the warp at every junction.
    const thread = new THREE.CylinderGeometry(r, r, d, 12, 1, false);
    thread.rotateX(Math.PI / 2);
    thread.translate(cx, height / 2, 0);
    geoms.push(thread);
  }
  // Weft threads (run along X), slightly higher so they "go over" the
  // warp visually at the intersection points.
  for (let j = 0; j < nz; j++) {
    const cz = j * tileSize - d / 2;
    if (Math.abs(cz) > d / 2 + r) continue;
    const thread = new THREE.CylinderGeometry(r * 0.92, r * 0.92, w, 12, 1, false);
    thread.rotateZ(Math.PI / 2);
    thread.translate(0, height / 2 + r * 0.3, cz);
    geoms.push(thread);
  }
  return geoms;
}

// --------- Hex camo (mil-spec random-height hex grid) ------------------
// Hex grid like the regular `hex` pattern, but each cell's height
// varies between 60% and 100% of the requested height — gives the
// camo / "battle armor" look without needing a real noise function.
// Pseudo-random via a deterministic hash on (col, row) so the same
// dims always produce the same pattern (important for STL diffing).
function buildHexCamo({ w, d, tileSize, height }) {
  const r = tileSize / 2;
  const hexW = r * Math.sqrt(3);
  const hexH = r * 1.5;
  const nx = Math.max(1, Math.ceil(w / hexW) + 1);
  const nz = Math.max(1, Math.ceil(d / hexH) + 1);
  const geoms = [];
  // Deterministic pseudo-random: same seed (col, row) always returns
  // the same value. Mulberry32-style mix is plenty here.
  const rng = (col, row) => {
    let h = (col * 374761393 + row * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  for (let row = 0; row < nz; row++) {
    for (let col = 0; col < nx; col++) {
      const cx = col * hexW + (row % 2 ? hexW / 2 : 0) - w / 2;
      const cz = row * hexH - d / 2;
      if (Math.abs(cx) > w / 2 + r) continue;
      if (Math.abs(cz) > d / 2 + r) continue;
      const localH = height * (0.6 + 0.4 * rng(col, row));
      const hex = new THREE.CylinderGeometry(r * 0.94, r * 0.94, localH, 6, 1);
      hex.translate(0, localH / 2, 0);
      hex.rotateY(Math.PI / 6);
      hex.translate(cx, 0, cz);
      geoms.push(hex);
    }
  }
  return geoms;
}

// --------- Voronoi (organic / shattered cells) ------------------------
// Approximated as a noisy hex grid where each cell's center is
// jittered randomly within its tile, producing irregular polygonal
// regions that read as cracked-glass / parametric cells. Far cheaper
// than a true voronoi triangulation while looking similar enough at
// the print-relief scale.
function buildVoronoi({ w, d, tileSize, height }) {
  const r = tileSize * 0.42;
  const nx = Math.max(1, Math.ceil(w / tileSize));
  const nz = Math.max(1, Math.ceil(d / tileSize));
  const geoms = [];
  const rng = (col, row) => {
    let h = (col * 374761393 + row * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      // Jitter the cell center within its tile so the resulting layout
      // looks irregular instead of regularly gridded.
      const jx = (rng(i, j) - 0.5) * tileSize * 0.6;
      const jz = (rng(j, i) - 0.5) * tileSize * 0.6;
      const cx = (i + 0.5) * tileSize - w / 2 + jx;
      const cz = (j + 0.5) * tileSize - d / 2 + jz;
      // Each cell is an irregular polygon — approximate with a
      // pentagon (5 sides) for that organic cracked-glass feel.
      const sides = 5 + Math.floor(rng(i + 1, j + 1) * 3); // 5, 6, or 7
      const localH = height * (0.7 + 0.3 * rng(i, j + 1));
      const cell = new THREE.CylinderGeometry(r, r, localH, sides, 1);
      cell.translate(0, localH / 2, 0);
      cell.rotateY(rng(i, j) * Math.PI * 2);
      cell.translate(cx, 0, cz);
      geoms.push(cell);
    }
  }
  return geoms;
}

/**
 * Build the texture's complete BufferGeometry: a thin base plate + the
 * tiled pattern relief on top. Returns a single merged BufferGeometry
 * with computed normals, centered at object origin so transforms apply
 * intuitively.
 *
 * Wrap modes (`dims.wrap`):
 *   "flat"     — default; the texture sits as a flat tile on the build plate.
 *   "cylinder" — the X axis maps to a cylindrical sweep around the Y axis.
 *                Each vertex's X coordinate becomes the angle θ = x / r
 *                (radians), and (x, z) is reprojected to
 *                (r * sin θ, z_radial * cos θ) where z_radial = r + z
 *                (so the base plate's outer face becomes the cylinder
 *                surface; the relief rises radially outward). Perfect
 *                for knurled grips on flashlight bodies, hex-paneled
 *                spheres (when paired with low height), or fluted
 *                column wraps.
 *   "sphere"   — V2 backlog (spherical wrap, ~2 weeks of fiddly math).
 *
 * `dims.wrapRadius` (mm) controls the radius the texture wraps onto.
 * If unset, defaults to `w / (2π)` so the texture tiles seamlessly
 * around the cylinder exactly once.
 */
export function buildTextureGeometry(obj) {
  const d = obj.dims || {};
  const pattern = d.pattern || "bumps";
  const w = Math.max(1, d.w ?? 30);
  const depth = Math.max(0.4, d.depth ?? 1);   // base plate thickness
  const dd = Math.max(1, d.d ?? 30);
  const tileSize = Math.max(0.5, d.tileSize ?? 3);
  const height = Math.max(0.2, d.height ?? 1.5);
  const wrap = d.wrap || "flat";
  const wrapRadius = d.wrapRadius || w / (2 * Math.PI);

  const builder = PATTERN_KINDS[pattern] || PATTERN_KINDS.bumps;
  const tilePieces = builder({ w, d: dd, tileSize, height });

  const plate = new THREE.BoxGeometry(w, depth, dd);
  plate.translate(0, -depth / 2, 0);

  const all = [plate, ...tilePieces];
  const merged = mergeGeometries(all, false);
  if (!merged) {
    plate.computeVertexNormals();
    return plate;
  }

  // Apply the wrap transformation post-merge so every pattern's tile
  // geometry — regardless of how it was originally constructed — gets
  // bent onto the target surface uniformly.
  if (wrap === "cylinder" && wrapRadius > 0) {
    const pos = merged.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i];
      const y = arr[i + 1];
      const z = arr[i + 2];
      // y on the flat texture becomes a RADIAL offset from the
      // cylinder surface (so relief rises radially outward). z stays
      // as the cylinder's axial coordinate. x maps to the angle.
      const theta = x / wrapRadius;
      const radial = wrapRadius + y;
      arr[i] = radial * Math.sin(theta);
      arr[i + 1] = z;                // bumps along the cylinder's axis
      arr[i + 2] = radial * Math.cos(theta);
    }
    pos.needsUpdate = true;
    // Rebuild normals — the original flat normals are wrong after the
    // bend. computeVertexNormals is O(verts) which is fine even at 50k.
    merged.computeVertexNormals();
    // Recompute bounding box / sphere too, since downstream BVH code
    // reads them for raycast acceleration.
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  merged.computeVertexNormals();
  return merged;
}

// Pattern catalogue for the dialog. Each entry includes a one-line
// description + the parameter defaults — keeps the UI thin (the
// dialog just renders `TEXTURE_PATTERNS` and pulls defaults from here
// when the user picks a kind).
export const TEXTURE_PATTERNS = [
  {
    id: "knurl_diamond", label: "Knurl (Diamond)",
    hint: "Diagonal cross-hatch — classic tool-handle grip",
    defaults: { tileSize: 2.0, height: 0.8 },
  },
  {
    id: "hex", label: "Hex grid",
    hint: "Tiled hexagonal cells — vents, honeycomb panels, decorative",
    defaults: { tileSize: 4.0, height: 1.0 },
  },
  {
    id: "bumps", label: "Bumps",
    hint: "Hemispherical bumps — anti-slip, tactile, dots",
    defaults: { tileSize: 3.0, height: 1.0 },
  },
  {
    id: "ridges_linear", label: "Ridges (linear)",
    hint: "Parallel half-cylinder grooves — flashlight grip, column fluting",
    defaults: { tileSize: 3.0, height: 1.2 },
  },
  // ---- V2 patterns (iter 50) ----
  {
    id: "diamond_plate", label: "Diamond plate",
    hint: "Industrial floor tread — pinwheel diamond bars per tile",
    defaults: { tileSize: 5.0, height: 1.5 },
  },
  {
    id: "brick", label: "Brick wall",
    hint: "Running-bond brick with mortar gaps — decorative panels",
    defaults: { tileSize: 4.0, height: 1.0 },
  },
  {
    id: "fabric", label: "Fabric weave",
    hint: "Basket-weave warp & weft cylinders — burlap / canvas",
    defaults: { tileSize: 3.0, height: 1.0 },
  },
  {
    id: "hex_camo", label: "Hex camo",
    hint: "Hex grid with randomised heights — military / battle armor",
    defaults: { tileSize: 5.0, height: 1.5 },
  },
  {
    id: "voronoi", label: "Voronoi",
    hint: "Irregular polygonal cells — cracked glass / organic stipple",
    defaults: { tileSize: 4.0, height: 1.2 },
  },
];

export const TEXTURE_DEFAULTS = {
  pattern: "bumps",
  w: 30,
  d: 30,
  tileSize: 3.0,
  height: 1.0,
  depth: 0.8,
  wrap: "flat",        // "flat" | "cylinder"
  wrapRadius: 0,       // 0 → auto (= w / (2π))
};

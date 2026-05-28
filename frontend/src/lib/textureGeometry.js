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

/**
 * Build the texture's complete BufferGeometry: a thin base plate + the
 * tiled pattern relief on top. Returns a single merged BufferGeometry
 * with computed normals, centered at object origin so transforms apply
 * intuitively.
 */
export function buildTextureGeometry(obj) {
  const d = obj.dims || {};
  const pattern = d.pattern || "bumps";
  const w = Math.max(1, d.w ?? 30);
  const depth = Math.max(0.4, d.depth ?? 1);   // base plate thickness
  const dd = Math.max(1, d.d ?? 30);
  const tileSize = Math.max(0.5, d.tileSize ?? 3);
  const height = Math.max(0.2, d.height ?? 1.5);

  const builder = PATTERN_KINDS[pattern] || PATTERN_KINDS.bumps;
  const tilePieces = builder({ w, d: dd, tileSize, height });

  // Base plate — sits BELOW y=0 so it's a "skirt" the relief rises
  // from. Without the plate, unioning the texture onto a host surface
  // would have to perfectly meet the surface to avoid manifold gaps;
  // with the plate, even a slight overlap (the user just sinks the
  // texture a few mm into the host) guarantees a clean weld.
  const plate = new THREE.BoxGeometry(w, depth, dd);
  plate.translate(0, -depth / 2, 0);

  const all = [plate, ...tilePieces];
  const merged = mergeGeometries(all, false);
  if (merged) {
    merged.computeVertexNormals();
    return merged;
  }
  // Fallback: just the plate (degenerate texture).
  plate.computeVertexNormals();
  return plate;
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
];

export const TEXTURE_DEFAULTS = {
  pattern: "bumps",
  w: 30,
  d: 30,
  tileSize: 3.0,
  height: 1.0,
  depth: 0.8,
};

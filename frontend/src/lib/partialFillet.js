// partialFillet.js — Manifold-3D powered partial fillet/chamfer.
//
// Builds a THREE.BufferGeometry for a cube, cylinder, or cone whose
// individual edges carry their own fillet/chamfer style and radius.
// The whole-item path (uniform RoundedBoxGeometry / uniform lathe) is
// still used when `obj.edgeFillets` is empty — this engine only kicks
// in for partial / mixed cases.
//
// Strategy for cubes (the hard case):
//   1. Build a sharp cube as a Manifold.
//   2. For each filleted edge:
//      a. Carve out a r×r×L "corner block" on the inside of the edge.
//      b. For a fillet, union back the (cylinder ∩ block) — the quarter
//         cylinder filling the carved void.
//      c. For a chamfer, union back the (chamfer-prism ∩ block) — the
//         inner-triangular prism that leaves a 45° bevel on the corner.
//   3. Convert the resulting manifold to a THREE.BufferGeometry.
//
// Cylinders and cones get a custom lathe profile in geometry.js — they
// don't need CSG because their edges are well-described by 2D profiles.
// This file handles cubes only; cylinder/cone partials are inlined.

import * as THREE from "three";
import { getManifold } from "./manifoldEngine";
import { CUBE_EDGES } from "./edgeFaceMeta";

// Convert a Manifold back to THREE.BufferGeometry. Mirrors the helper
// in manifoldEngine.js but inline here so we don't bloat the public
// engine surface.
function manifoldToGeometry(m) {
  const mesh = m.getMesh();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  g.computeVertexNormals();
  return g;
}

// Clamp the per-edge radius so it can't exceed half the shortest
// perpendicular dimension. Without this, a 12mm fillet on a 20mm cube
// would punch through the opposite face and explode the boolean.
function clampEdgeRadius(edge, dimsLocal, r) {
  // dimsLocal: { x, y, z } — three's local frame extents
  // For an edge along axis A, the radius can't exceed
  // halfDim(perp1) - epsilon nor halfDim(perp2) - epsilon.
  const localAxis = edge.axis === "X" ? "x" : edge.axis === "Y" ? "y" : "z";
  const perpAxes = ["x", "y", "z"].filter((k) => k !== localAxis);
  const halfA = dimsLocal[perpAxes[0]] / 2;
  const halfB = dimsLocal[perpAxes[1]] / 2;
  return Math.max(0, Math.min(r, halfA - 0.05, halfB - 0.05));
}

// Build a single edge's corner block + replacement piece, return the
// pair as { block, replacement } manifolds. Caller is responsible for
// deleting both.
function buildEdgePieces(wasm, edge, dimsLocal, r, style, segments) {
  // dimsLocal: { x, y, z } extents of the cube in three's local frame.
  const localAxis = edge.axis;  // "X" | "Y" | "Z" (world == local for cube)
  // Half-extents in local frame
  const hx = dimsLocal.x / 2;
  const hy = dimsLocal.y / 2;
  const hz = dimsLocal.z / 2;
  // Edge length along its axis (full dim, plus a small slack on each
  // end so the CSG boolean sees clean intersections — no coplanar
  // ambiguity at the edge endpoints).
  const SLACK = 0.5;
  // Determine the (sign) of each perpendicular axis at the edge.
  // The edge entry stores `xPos / yPos / zPos` ("min" | "max") for
  // the two perpendicular axes that aren't the edge's running axis.
  const signFor = (axisLetter) => {
    if (axisLetter === "X" && edge.xPos) return edge.xPos === "max" ? 1 : -1;
    if (axisLetter === "Y" && edge.yPos) return edge.yPos === "max" ? 1 : -1;
    if (axisLetter === "Z" && edge.zPos) return edge.zPos === "max" ? 1 : -1;
    return 0;
  };
  // The two perpendicular axes (not the edge axis).
  const perp = ["X", "Y", "Z"].filter((a) => a !== localAxis);
  const [pA, pB] = perp;
  const halfA = pA === "X" ? hx : pA === "Y" ? hy : hz;
  const halfB = pB === "X" ? hx : pB === "Y" ? hy : hz;
  const signA = signFor(pA);
  const signB = signFor(pB);
  // Edge length along its axis = full local dim along that axis.
  const lenAxis = localAxis === "X" ? dimsLocal.x
                  : localAxis === "Y" ? dimsLocal.y
                  : dimsLocal.z;
  // Block dimensions: r along the two perp axes, L+slack along edge axis.
  const blockDims = { x: r, y: r, z: r };
  blockDims[localAxis.toLowerCase()] = lenAxis + SLACK;
  // Block centre on perpendicular axes: positioned so the OUTER corner
  // of the block sits exactly on the cube's outer edge, i.e. centre =
  // sign * (halfDim - r/2). On the edge axis, centred at 0.
  const blockCenter = [0, 0, 0];
  if (pA === "X") blockCenter[0] = signA * (halfA - r / 2);
  else if (pA === "Y") blockCenter[1] = signA * (halfA - r / 2);
  else blockCenter[2] = signA * (halfA - r / 2);
  if (pB === "X") blockCenter[0] = signB * (halfB - r / 2);
  else if (pB === "Y") blockCenter[1] = signB * (halfB - r / 2);
  else blockCenter[2] = signB * (halfB - r / 2);

  const block = wasm.Manifold.cube(
    [blockDims.x, blockDims.y, blockDims.z],
    true,   // center on origin
  ).translate(blockCenter);

  let replacement = null;
  if (style === "fillet") {
    // Cylinder of radius r, length L+slack, axis = edge axis.
    // Centerline on perpendicular axes: positioned r INWARD from each
    // cube outer face, so the cylindrical surface is tangent to both
    // adjacent cube faces. centre = sign * (halfDim - r).
    const cylCenter = [0, 0, 0];
    if (pA === "X") cylCenter[0] = signA * (halfA - r);
    else if (pA === "Y") cylCenter[1] = signA * (halfA - r);
    else cylCenter[2] = signA * (halfA - r);
    if (pB === "X") cylCenter[0] = signB * (halfB - r);
    else if (pB === "Y") cylCenter[1] = signB * (halfB - r);
    else cylCenter[2] = signB * (halfB - r);
    // Default cylinder axis in Manifold = +Z. Rotate to align with our
    // edge axis. Use degrees.
    let cyl = wasm.Manifold.cylinder(
      lenAxis + SLACK,
      r,
      r,
      segments,
      true, // center along height
    );
    if (localAxis === "X") cyl = cyl.rotate([0, 90, 0]);
    else if (localAxis === "Y") cyl = cyl.rotate([90, 0, 0]);
    // Z: no rotation
    cyl = cyl.translate(cylCenter);
    // The quarter cylinder we want is the part inside the block.
    replacement = cyl.intersect(block);
    cyl.delete();
  } else {
    // Chamfer: triangular prism inside the block whose hypotenuse is
    // the new chamfered face. The triangle in the (perp1, perp2) plane
    // has vertices:
    //   v0 = INNER corner of block (the corner that's opposite the cube edge)
    //   v1 = corner adjacent to v0 along perpA (toward the cube edge along A)
    //   v2 = corner adjacent to v0 along perpB (toward the cube edge along B)
    // Extruded along the edge axis by exactly L (no slack — the prism
    // must stay flush with the cube's end faces, otherwise the union
    // produces small protrusions just past the cube boundary).
    //
    // We build the triangle in local 2D coords centred at the block's
    // centre, then translate the extruded prism to the block centre.
    const half = r / 2;
    // Direction toward the cube edge in (perpA, perpB) local block space.
    // INNER corner is at (-half*signA, -half*signB) — the corner FURTHEST
    // from the cube edge — because the block extends from the cube edge
    // inward, so the "near to edge" face is at +half*sign.
    const innerA = -half * signA;
    const innerB = -half * signB;
    const towardEdgeA = +half * signA;
    const towardEdgeB = +half * signB;
    const triangle2D = [
      [innerA,        innerB],
      [towardEdgeA,   innerB],
      [innerA,        towardEdgeB],
    ];
    // Manifold's CrossSection treats CW polygons as holes — so we MUST
    // hand it a CCW-wound triangle, otherwise the extrude returns an
    // empty solid and the subsequent `carved.add(prism)` produces an
    // invalid manifold that collapses the entire cube to nothing.
    // The triangle above is CCW iff signA * signB > 0; when the two
    // perpendicular axes pick opposite "min"/"max" sides (e.g. front-
    // right vertical edge with xPos=max, zPos=min), the area flips
    // sign. Swap v1 and v2 to restore CCW order in that case.
    if (signA * signB < 0) {
      const tmp = triangle2D[1];
      triangle2D[1] = triangle2D[2];
      triangle2D[2] = tmp;
    }
    // Manifold extrude expects an array of polygons (each polygon =
    // array of [x, y] points). Single triangle here.
    let prism;
    try {
      // CrossSection API: `new CrossSection(polygons)` then `.extrude(height,
      // nDivisions, twistDegrees, scaleTop, center)`. The bundled
      // manifold-3d build (per its .d.ts) exposes CrossSection as a class
      // — older builds with a static `ofPolygons` factory are a fallback.
      let cs;
      if (typeof wasm.CrossSection === "function") {
        cs = new wasm.CrossSection([triangle2D]);
      } else if (wasm.CrossSection && wasm.CrossSection.ofPolygons) {
        cs = wasm.CrossSection.ofPolygons([triangle2D]);
      } else {
        throw new Error("manifold-3d build does not expose CrossSection");
      }
      // The block uses `lenAxis + SLACK` so the CSG carve sees clean
      // intersections at the cube's ends. The PRISM, on the other hand,
      // is unioned back into the cube — if it overshoots `lenAxis` it
      // adds tiny protrusions just above the cube's top/bottom faces.
      // Use exactly `lenAxis` here so the prism's ends are flush with
      // the cube faces.
      prism = cs.extrude(lenAxis, 0, 0, [1, 1], true);
      cs.delete();
    } catch (err) {
      // Surface the failure rather than silently producing a sharp cube.
      // eslint-disable-next-line no-console
      console.error("Chamfer prism build failed:", err);
      throw err;
    }
    // The prism's natural axis is +Z (extrude direction). Rotate so its
    // long axis matches the edge axis. The 2D plane of the triangle
    // was (perpA, perpB) — both perpendicular to the edge axis — so
    // after extrusion along its own +Z, we need to align that +Z with
    // (perpA × perpB) = ±edgeAxis. Rotations match the cylinder case.
    if (localAxis === "X") prism = prism.rotate([0, 90, 0]);
    else if (localAxis === "Y") prism = prism.rotate([90, 0, 0]);
    // The 2D triangle was authored centred on the block centre, so
    // after the rotation we still need to translate by the block's
    // perpendicular-axis centre.
    prism = prism.translate(blockCenter);
    replacement = prism;
  }

  return { block, replacement };
}

/**
 * Build a Manifold for a cube with per-edge fillets / chamfers.
 *
 * Per-edge map (`obj.edgeFillets`) ALWAYS wins for the edges it lists. For
 * any edge NOT explicitly in the map, this honours the legacy "Item mode"
 * uniform radius (`obj.dims.edgeRadius` + `obj.dims.edgeStyle`) as the
 * default — so a cube with a prior uniform 2 mm chamfer + a single 5 mm
 * fillet on the bottom-right edge keeps the 2 mm on the other 11 edges.
 *
 * Returns null when no edge ends up active. The caller OWNS the returned
 * Manifold and must `.delete()` it once finished. All intermediate
 * Manifolds are disposed by this function. `wasm` must already be the
 * initialised manifold-3d module (caller is responsible for `getManifold()`).
 */
export function buildCubeManifoldWithFilletsSync(wasm, obj) {
  const dims = obj.dims || {};
  const w = dims.x || 20;
  const dep = dims.y || 20;
  const h = dims.z || 20;
  const dimsLocal = { x: w, y: h, z: dep };

  const fillets = obj.edgeFillets || {};
  const uniformR = Math.max(0, dims.edgeRadius || 0);
  const uniformStyle = dims.edgeStyle === "chamfer" ? "chamfer" : "fillet";

  const planned = CUBE_EDGES
    .map((e) => {
      const cfg = fillets[e.id];
      if (cfg && cfg.radius > 0.05) {
        return { edge: e, r: cfg.radius, style: cfg.style === "chamfer" ? "chamfer" : "fillet" };
      }
      if (cfg && cfg.radius != null && cfg.radius <= 0.05) return null;
      if (uniformR > 0.05) {
        return { edge: e, r: uniformR, style: uniformStyle };
      }
      return null;
    })
    .filter(Boolean);
  if (planned.length === 0) return null;

  let cube = wasm.Manifold.cube([w, h, dep], true);
  const segs = 24;
  const owned = [];
  try {
    for (const p of planned) {
      const r = clampEdgeRadius(p.edge, dimsLocal, p.r);
      if (r <= 0.05) continue;
      const { block, replacement } = buildEdgePieces(
        wasm, p.edge, dimsLocal, r, p.style, segs,
      );
      owned.push(block, replacement);
      const carved = cube.subtract(block);
      owned.push(cube); // previous cube can be released now that carved owns the topology
      const rebuilt = carved.add(replacement);
      owned.push(carved);
      cube = rebuilt;
    }
    return cube;
  } catch (err) {
    // On any failure, dispose the in-progress cube too and propagate null.
    try { if (cube && !cube.isDeleted?.()) cube.delete(); } catch (_) { /* noop */ }
    // eslint-disable-next-line no-console
    console.warn("buildCubeManifoldWithFilletsSync failed:", err);
    return null;
  } finally {
    for (const m of owned) {
      try { if (m && !m.isDeleted?.()) m.delete(); } catch (_) { /* noop */ }
    }
  }
}

/**
 * Build a THREE.BufferGeometry for a cube with per-edge fillets / chamfers.
 * Async wrapper around `buildCubeManifoldWithFilletsSync` that initialises
 * manifold-3d and converts the result to a BufferGeometry. Returns null on
 * any failure or when no edge ends up active — caller falls back to the
 * sharp cube / RoundedBoxGeometry fast path.
 */
export async function buildCubeGeometryWithFillets(obj) {
  const wasm = await getManifold();
  const cube = buildCubeManifoldWithFilletsSync(wasm, obj);
  if (!cube) return null;
  try {
    return manifoldToGeometry(cube);
  } finally {
    try { if (!cube.isDeleted?.()) cube.delete(); } catch (_) { /* noop */ }
  }
}

/**
 * Cylinder partial fillet — supports independent top / bottom edge
 * style + radius via the existing lathe pipeline. We don't go through
 * Manifold here; instead we build a custom lathe profile that bevels
 * each end independently. Returns null if no per-edge fillets are set.
 */
export function buildCylinderGeometryWithFillets(obj) {
  const dims = obj.dims || {};
  const r = dims.r || 10;
  const h = dims.h || 20;
  const segs = dims.segments || 64;
  const fillets = obj.edgeFillets || {};
  const top = fillets.e_top;
  const bot = fillets.e_bottom;
  if (!top && !bot) return null;

  const half = h / 2;
  const topStyle = top?.style === "chamfer" ? "chamfer" : "fillet";
  const botStyle = bot?.style === "chamfer" ? "chamfer" : "fillet";
  const topR = Math.max(0, Math.min(top?.radius || 0, r - 0.05, half - 0.05));
  const botR = Math.max(0, Math.min(bot?.radius || 0, r - 0.05, half - 0.05));

  const points = [];
  // Start on the axis at the bottom (closes the bottom cap).
  points.push(new THREE.Vector2(0, -half));

  // ── Bottom edge ──
  if (botR > 0.05) {
    points.push(new THREE.Vector2(r - botR, -half));
    if (botStyle === "chamfer") {
      points.push(new THREE.Vector2(r, -half + botR));
    } else {
      const arcSegs = Math.max(2, Math.min(16, Math.round(segs / 8)));
      const cx = r - botR, cy = -half + botR;
      for (let i = 1; i <= arcSegs; i++) {
        const t = i / arcSegs;
        const a = -Math.PI / 2 + t * (Math.PI / 2);
        points.push(new THREE.Vector2(cx + Math.cos(a) * botR, cy + Math.sin(a) * botR));
      }
    }
  } else {
    points.push(new THREE.Vector2(r, -half));
  }

  // ── Side wall up to top ──
  if (topR > 0.05) {
    points.push(new THREE.Vector2(r, half - topR));
    if (topStyle === "chamfer") {
      points.push(new THREE.Vector2(r - topR, half));
    } else {
      const arcSegs = Math.max(2, Math.min(16, Math.round(segs / 8)));
      const cx = r - topR, cy = half - topR;
      for (let i = 1; i <= arcSegs; i++) {
        const t = i / arcSegs;
        const a = t * (Math.PI / 2);
        points.push(new THREE.Vector2(cx + Math.cos(a) * topR, cy + Math.sin(a) * topR));
      }
    }
  } else {
    points.push(new THREE.Vector2(r, half));
  }

  // Close the top cap.
  points.push(new THREE.Vector2(0, half));

  const g = new THREE.LatheGeometry(points, segs);
  g.computeVertexNormals();
  return g;
}

/**
 * Cone partial fillet — cones have only one base edge so this is mostly
 * a thin wrapper for symmetry with cube/cylinder. Returns null if no
 * `e_base` entry is set.
 */
export function buildConeGeometryWithFillets(obj) {
  const dims = obj.dims || {};
  const r = dims.r || 10;
  const h = dims.h || 20;
  const segs = dims.segments || 64;
  const base = (obj.edgeFillets || {}).e_base;
  if (!base || !base.radius) return null;

  const er = Math.max(0, Math.min(base.radius, r - 0.05, h - 0.05));
  if (er <= 0.05) return null;
  const style = base.style === "chamfer" ? "chamfer" : "fillet";
  const half = h / 2;
  const points = [];
  points.push(new THREE.Vector2(0, -half));
  points.push(new THREE.Vector2(r - er, -half));
  if (style === "chamfer") {
    points.push(new THREE.Vector2(r, -half + er));
  } else {
    const arcSegs = Math.max(2, Math.min(16, Math.round(segs / 8)));
    const cx = r - er, cy = -half + er;
    for (let i = 1; i <= arcSegs; i++) {
      const t = i / arcSegs;
      const a = -Math.PI / 2 + t * (Math.PI / 2);
      points.push(new THREE.Vector2(cx + Math.cos(a) * er, cy + Math.sin(a) * er));
    }
  }
  points.push(new THREE.Vector2(0, half));
  const g = new THREE.LatheGeometry(points, segs);
  g.computeVertexNormals();
  return g;
}

/**
 * Returns true when the object has any per-edge fillet entries that
 * actually change the geometry (radius > epsilon).
 */
export function hasActiveEdgeFillets(obj) {
  if (!obj || !obj.edgeFillets) return false;
  return Object.values(obj.edgeFillets).some((cfg) => cfg && cfg.radius > 0.05);
}

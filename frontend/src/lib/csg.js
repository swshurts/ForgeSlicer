import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildGeometry, applyTransform } from "./geometry";

const OP_MAP = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };

// Bake any negative scale components into the geometry (flip vertex
// positions on the affected axes AND flip triangle winding order so face
// normals stay outward). three-bvh-csg's Evaluator computes a BVH on
// the local geometry and applies the brush's world matrix on top; if the
// matrix has a negative determinant (any odd count of negative scales)
// the BVH's inside/outside tests fail and the resulting geometry has
// no position attribute, which crashes downstream STL/3MF exporters.
function bakeNegativeScale(geom, obj) {
  const sx = obj.scale[0], sy = obj.scale[1], sz = obj.scale[2];
  if (sx >= 0 && sy >= 0 && sz >= 0) return { geom, positiveScale: obj.scale };
  const baked = geom.clone();
  const pos = baked.attributes.position;
  const arr = pos.array;
  // Mutate positions on negative axes.
  for (let i = 0; i < arr.length; i += 3) {
    if (sx < 0) arr[i]     *= -1;
    if (sy < 0) arr[i + 1] *= -1;
    if (sz < 0) arr[i + 2] *= -1;
  }
  pos.needsUpdate = true;
  // Flip winding if odd number of negations (determinant flipped).
  const flipCount = (sx < 0 ? 1 : 0) + (sy < 0 ? 1 : 0) + (sz < 0 ? 1 : 0);
  if (flipCount % 2 === 1) {
    if (baked.index) {
      const idx = baked.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp;
      }
      baked.index.needsUpdate = true;
    } else {
      // Non-indexed: swap vertex 1 and 2 in every triangle.
      for (let i = 0; i < arr.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const a = i + 3 + k, b = i + 6 + k;
          const tmp = arr[a]; arr[a] = arr[b]; arr[b] = tmp;
        }
      }
      pos.needsUpdate = true;
    }
  }
  baked.computeVertexNormals();
  return { geom: baked, positiveScale: [Math.abs(sx), Math.abs(sy), Math.abs(sz)] };
}

function makeBrush(obj) {
  let geom = buildGeometry(obj);
  const { geom: prepped, positiveScale } = bakeNegativeScale(geom, obj);
  const mat = new THREE.MeshStandardMaterial();
  const b = new Brush(prepped, mat);
  // Apply transform with the all-positive scale (mirroring is now baked
  // into the vertex data, so the matrix is a regular rigid transform).
  applyTransform(b, { ...obj, scale: positiveScale });
  return b;
}

// Robust manual vertex welder. Builds an indexed mesh by hashing vertex
// positions quantized to `tol` precision. This is more reliable than
// BufferGeometryUtils.mergeVertices for CSG output because it works on both
// indexed and non-indexed inputs and is independent of the input attribute
// schema.
function weldVertices(geom, tol = 5e-3) {
  let posArr = geom.attributes.position.array;
  let indexArr = geom.index ? Array.from(geom.index.array) : null;

  // If not indexed, build trivial indices.
  if (!indexArr) {
    const triCount = posArr.length / 3;
    indexArr = new Array(triCount);
    for (let i = 0; i < triCount; i++) indexArr[i] = i;
  }

  const inv = 1 / tol;
  const hash = new Map();
  const newPositions = [];
  const remap = new Array(posArr.length / 3);

  for (let i = 0; i < posArr.length / 3; i++) {
    const x = posArr[i * 3], y = posArr[i * 3 + 1], z = posArr[i * 3 + 2];
    const kx = Math.round(x * inv);
    const ky = Math.round(y * inv);
    const kz = Math.round(z * inv);
    const key = `${kx},${ky},${kz}`;
    let idx = hash.get(key);
    if (idx === undefined) {
      idx = newPositions.length / 3;
      // Snap to the quantized value to ensure all merged vertices share
      // EXACT bytes when written to STL/3MF.
      newPositions.push(kx * tol, ky * tol, kz * tol);
      hash.set(key, idx);
    }
    remap[i] = idx;
  }

  const newIndex = indexArr.map((i) => remap[i]);
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
  out.setIndex(newIndex);
  return out;
}

// Post-CSG cleanup: weld duplicate vertices, drop zero-area triangles,
// recompute normals. This is what fixes "empty layer" warnings in third-
// party slicers (FlashPrint, OrcaSlicer) caused by the boolean operation
// leaving microscopic seams along the cut boundary.
function cleanGeometry(geom) {
  let g = geom;
  // 5-micron weld tolerance — tight enough to preserve real geometric features
  // (smallest visible 3D-print detail is ~100µm) but coarse enough to bridge
  // floating-point seams left along CSG cut boundaries.
  g = weldVertices(g, 5e-3);
  g = removeDegenerateTriangles(g);
  g.computeVertexNormals();
  return g;
}

/**
 * Count "open" edges (boundary edges that appear in exactly one triangle).
 * A watertight mesh has 0 open edges. The returned value is a manifold
 * health metric: 0 = perfect, >0 = how many edges the slicer will need to
 * auto-repair on import.
 */
export function countBoundaryEdges(geom) {
  if (!geom.index || geom.attributes.position.count === 0) return 0;
  const idx = geom.index.array;
  const counts = new Map();
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  let open = 0;
  for (const v of counts.values()) if (v !== 2) open++;
  return open;
}

function removeDegenerateTriangles(g) {
  if (!g.index) return g;
  const idx = g.index.array;
  const pos = g.attributes.position.array;
  const kept = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (idx[i] === idx[i + 1] || idx[i + 1] === idx[i + 2] || idx[i] === idx[i + 2]) continue;
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if ((nx * nx + ny * ny + nz * nz) > 1e-10) {
      kept.push(idx[i], idx[i + 1], idx[i + 2]);
    }
  }
  if (kept.length !== idx.length) {
    g.setIndex(kept);
  }
  return g;
}

// Bake the brush's world transform into its geometry — produces a plain
// BufferGeometry in world space. Used as the safe-concatenation path when
// CSG Union isn't necessary (no negatives) or would fail on non-manifold
// inputs.
function bakeBrushToWorld(brush) {
  const g = brush.geometry.clone();
  g.applyMatrix4(brush.matrixWorld);
  g.clearGroups();
  return g;
}

// Returns true if a geometry is "usable" (has at least one triangle).
// three-bvh-csg can occasionally produce a result where attributes.position
// is undefined when both inputs are non-manifold; that's our crash trigger.
function isValidGeometry(g) {
  return (
    g && g.attributes && g.attributes.position &&
    g.attributes.position.count > 0
  );
}

/**
 * Apply scene modifiers to produce a single merged BufferGeometry.
 *
 * Strategy:
 *  - If there are no negative components, **concatenate** the positives.
 *    A pure Union of separate shells (which is what evaluateScene used to
 *    do here) requires every input to be manifold; combining two
 *    Boolean-derived shells routinely fails because three-bvh-csg
 *    produces a tiny number of open edges along cut boundaries. Slicers
 *    handle multi-shell STL/3MF natively, so concatenation is the right
 *    behavior here.
 *  - If negatives exist, do Subtract them from the concatenated positives.
 *    Subtract is more tolerant than Union for non-manifold inputs and is
 *    what users actually expect (carve negatives out of the build).
 *  - Each Boolean step is guarded so a single failing operation falls back
 *    to the previous result instead of nuking the entire export.
 *
 * Returns: { geometry: BufferGeometry, triangleCount, empty:boolean, ... }
 */
export function evaluateScene(objects) {
  const visibles = objects.filter((o) => o.visible !== false);
  const positives = visibles.filter((o) => o.modifier !== "negative");
  const negatives = visibles.filter((o) => o.modifier === "negative");

  if (positives.length === 0) {
    return { geometry: new THREE.BufferGeometry(), triangleCount: 0, empty: true };
  }

  // Bake each positive's transform into a world-space BufferGeometry.
  const positiveWorldGeoms = positives.map((p) => bakeBrushToWorld(makeBrush(p)));

  let merged;
  if (positiveWorldGeoms.length === 1) {
    merged = positiveWorldGeoms[0];
  } else {
    // Strip non-position attributes so mergeGeometries doesn't complain
    // about mismatched attribute sets across primitives.
    const stripped = positiveWorldGeoms.map(stripToPositionIndex);
    merged = mergeGeometries(stripped, false) || positiveWorldGeoms[0];
  }

  // Apply negatives via Subtract. We turn the merged positives back into a
  // Brush (with identity transform — the geometry is already in world space)
  // and chain Subtract for each negative.
  if (negatives.length > 0) {
    const evaluator = new Evaluator();
    const mat = new THREE.MeshStandardMaterial();
    let acc = new Brush(merged, mat);
    acc.updateMatrixWorld(true);
    for (const n of negatives) {
      const nb = makeBrush(n);
      try {
        const res = evaluator.evaluate(acc, nb, SUBTRACTION);
        const baked = res.geometry.clone();
        baked.applyMatrix4(res.matrixWorld);
        baked.clearGroups();
        if (isValidGeometry(baked)) {
          acc = new Brush(baked, mat);
          acc.updateMatrixWorld(true);
        }
        // If invalid, just skip this negative — keep the previous accumulator.
      } catch (_) { /* swallow and keep accumulator */ }
    }
    merged = bakeBrushToWorld(acc);
  }

  merged = cleanGeometry(merged);

  const triCount = merged.index
    ? merged.index.count / 3
    : merged.attributes.position.count / 3;
  const boundaryEdges = countBoundaryEdges(merged);

  return {
    geometry: merged,
    triangleCount: Math.floor(triCount),
    empty: triCount === 0,
    boundaryEdges,
    manifold: boundaryEdges === 0,
  };
}

// Keep only position + index attributes — mergeGeometries requires all
// input geometries to expose the same attribute set, and our primitives
// vary (some have UVs, some don't).
function stripToPositionIndex(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", g.attributes.position.clone());
  if (g.index) out.setIndex(g.index.clone());
  return out;
}

/**
 * Like evaluateScene but produces a separate merged geometry per color index.
 * Negatives are applied to ALL color groups so a single subtractive hole
 * carves through every material. Returns:
 *   { groups: [{ colorIndex, geometry, triangleCount }], totalTriangles }
 * Groups are returned only for colorIndex values that have at least one
 * visible positive object.
 */
export function evaluateSceneByColor(objects) {
  const visibles = objects.filter((o) => o.visible !== false);
  const positives = visibles.filter((o) => o.modifier !== "negative");
  const negatives = visibles.filter((o) => o.modifier === "negative");
  if (positives.length === 0) return { groups: [], totalTriangles: 0 };

  // Group positives by colorIndex (default 0).
  const byColor = new Map();
  for (const p of positives) {
    const k = (p.colorIndex | 0) || 0;
    if (!byColor.has(k)) byColor.set(k, []);
    byColor.get(k).push(p);
  }

  const groups = [];
  let total = 0;
  // Iterate colors in numeric order so 3MF object ids are stable across exports.
  const colorKeys = Array.from(byColor.keys()).sort((a, b) => a - b);
  for (const colorIndex of colorKeys) {
    const colorPositives = byColor.get(colorIndex);
    // Concatenate this color's positives (no Union — see evaluateScene
    // for the rationale).
    const worldGeoms = colorPositives.map((p) => bakeBrushToWorld(makeBrush(p)));
    let merged;
    if (worldGeoms.length === 1) {
      merged = worldGeoms[0];
    } else {
      const stripped = worldGeoms.map(stripToPositionIndex);
      merged = mergeGeometries(stripped, false) || worldGeoms[0];
    }
    if (negatives.length > 0) {
      const evaluator = new Evaluator();
      const mat = new THREE.MeshStandardMaterial();
      let acc = new Brush(merged, mat);
      acc.updateMatrixWorld(true);
      for (const n of negatives) {
        const nb = makeBrush(n);
        try {
          const res = evaluator.evaluate(acc, nb, SUBTRACTION);
          const baked = res.geometry.clone();
          baked.applyMatrix4(res.matrixWorld);
          baked.clearGroups();
          if (isValidGeometry(baked)) {
            acc = new Brush(baked, mat);
            acc.updateMatrixWorld(true);
          }
        } catch (_) { /* skip this negative */ }
      }
      merged = bakeBrushToWorld(acc);
    }
    merged = cleanGeometry(merged);
    const tri = merged.index
      ? merged.index.count / 3
      : merged.attributes.position.count / 3;
    if (tri > 0) {
      groups.push({ colorIndex, geometry: merged, triangleCount: Math.floor(tri) });
      total += tri;
    }
  }
  return { groups, totalTriangles: Math.floor(total) };
}

/**
 * Apply boolean op on two specific objects (selected pair). Returns merged
 * geometry as an "imported" object replacement.
 */
export function combineTwo(a, b, op) {
  const evaluator = new Evaluator();
  const ba = makeBrush(a);
  const bb = makeBrush(b);
  const operation = OP_MAP[op] || ADDITION;
  const r = evaluator.evaluate(ba, bb, operation);
  let baked = r.geometry.clone();
  baked.applyMatrix4(r.matrixWorld);
  baked.clearGroups();
  baked = cleanGeometry(baked);
  const pos = baked.attributes.position.array;
  const indices = baked.index ? baked.index.array : null;
  return {
    vertices: new Float32Array(pos),
    indices: indices ? new Uint32Array(indices) : null,
  };
}

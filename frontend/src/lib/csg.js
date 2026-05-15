import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildGeometry, applyTransform } from "./geometry";

const OP_MAP = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };

function makeBrush(obj) {
  const geom = buildGeometry(obj);
  const mat = new THREE.MeshStandardMaterial();
  const b = new Brush(geom, mat);
  applyTransform(b, obj);
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

/**
 * Apply scene modifiers to produce a single merged BufferGeometry.
 * Positives are unioned, negatives subtracted in order.
 * Returns: { geometry: BufferGeometry, triangleCount, empty:boolean }
 */
export function evaluateScene(objects) {
  const visibles = objects.filter((o) => o.visible !== false);
  const positives = visibles.filter((o) => o.modifier !== "negative");
  const negatives = visibles.filter((o) => o.modifier === "negative");

  if (positives.length === 0) {
    return { geometry: new THREE.BufferGeometry(), triangleCount: 0, empty: true };
  }

  const evaluator = new Evaluator();
  // Leave useGroups at its default (true) so three-bvh-csg's internal
  // boundary handling stays intact; we'll merge groups ourselves.

  let result = makeBrush(positives[0]);

  for (let i = 1; i < positives.length; i++) {
    const b = makeBrush(positives[i]);
    result = evaluator.evaluate(result, b, ADDITION);
  }

  for (const n of negatives) {
    const b = makeBrush(n);
    result = evaluator.evaluate(result, b, SUBTRACTION);
  }

  // Bake world matrix into geometry
  let baked = result.geometry.clone();
  baked.applyMatrix4(result.matrixWorld);
  // Drop multi-material groups so STL export merges everything into one shell.
  baked.clearGroups();
  baked = cleanGeometry(baked);

  const triCount = baked.index
    ? baked.index.count / 3
    : baked.attributes.position.count / 3;
  const boundaryEdges = countBoundaryEdges(baked);

  return {
    geometry: baked,
    triangleCount: Math.floor(triCount),
    empty: false,
    boundaryEdges,
    manifold: boundaryEdges === 0,
  };
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

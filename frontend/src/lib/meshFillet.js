// Iter-114 — Mesh Fillet / Chamfer for imported geometries.
//
// Uses Manifold-3D's `minkowskiSum` / `minkowskiDifference` to apply
// a true rolling-ball fillet (or chamfer via a polyhedral kernel) to
// any solid mesh that the user imported (STL, OBJ, 3MF, etc.).
//
// Algorithm (the well-known morphological "open/close" pair):
//   • Outer fillet (rounds CONVEX edges):
//       M_out = M ⊕ B_r ⊖ B_r           (dilate → erode)
//   • Inner fillet (rounds CONCAVE edges):
//       M_in  = M ⊖ B_r ⊕ B_r           (erode → dilate)
//   • Full fillet (both):  outer(inner(M)).
//
// Chamfer mode uses an icosahedron-derived sphere with 12 vertices
// (so the rolling kernel is faceted, producing flat micro-bevels
// instead of round arcs). Round mode uses a higher-segment sphere.
//
// THIS IS COMPUTATIONALLY EXPENSIVE. Minkowski operations with non-
// convex meshes can take 10–60 seconds on a multi-thousand-tri model
// at radius >1mm. Callers should:
//   • run inside the existing CSG worker if possible (manifoldEngine
//     re-exports `getManifold()` so we get the same WASM singleton),
//   • surface a determinate-or-spinner UI during the wait,
//   • allow the user to cancel via AbortSignal — checked between the
//     coarse steps below.
import * as THREE from "three";
import { getManifold } from "./manifoldEngine";

// Lifted private helpers from manifoldEngine — we just need light
// versions for one-off mesh ↔ manifold round-trips.
function weldGeom(geom, tol = 1e-4) {
  const posAttr = geom.attributes.position;
  const positions = posAttr.array;
  const hasIndex = !!geom.index;
  const triCount = hasIndex ? geom.index.count / 3 : posAttr.count / 3;
  const inv = 1 / tol;
  const hash = new Map();
  const newPositions = [];
  const remap = new Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const kx = Math.round(x * inv);
    const ky = Math.round(y * inv);
    const kz = Math.round(z * inv);
    const key = `${kx}|${ky}|${kz}`;
    let idx = hash.get(key);
    if (idx === undefined) {
      idx = newPositions.length / 3;
      newPositions.push(kx * tol, ky * tol, kz * tol);
      hash.set(key, idx);
    }
    remap[i] = idx;
  }
  const triVerts = new Uint32Array(triCount * 3);
  if (hasIndex) {
    const src = geom.index.array;
    for (let t = 0; t < triCount * 3; t++) triVerts[t] = remap[src[t]];
  } else {
    for (let t = 0; t < triCount * 3; t++) triVerts[t] = remap[t];
  }
  return { vertProperties: new Float32Array(newPositions), triVerts };
}

function geomToManifold(wasm, geom) {
  const { vertProperties, triVerts } = weldGeom(geom);
  const mesh = new wasm.Mesh({ numProp: 3, triVerts, vertProperties });
  mesh.merge();
  const m = new wasm.Manifold(mesh);
  const status = m.status?.();
  if (status && status !== "NoError") {
    try { m.delete(); } catch { /* noop */ }
    throw new Error(`Manifold rejected mesh (status=${status}). Try repairing the mesh first.`);
  }
  return m;
}

function manifoldToVertsIndices(m) {
  const mesh = m.getMesh();
  return {
    vertices: Array.from(mesh.vertProperties),
    indices: Array.from(mesh.triVerts),
  };
}

/**
 * Apply a fillet (round) or chamfer (faceted) to every edge of an
 * imported mesh.
 *
 * @param {Object}   obj                       Scene object — must be type === "imported" with `obj.geometry`.
 * @param {Object}   opts
 * @param {number}   opts.radius               Roll-ball radius in mm (0.1–10 typical).
 * @param {string}   [opts.mode="round"]       "round" | "chamfer".
 * @param {string}   [opts.scope="outer"]      "outer" (convex), "inner" (concave), or "full" (both — slow).
 * @param {number}   [opts.segments]           Sphere segments (round: 16, chamfer: 4).
 * @param {AbortSignal} [opts.signal]          Optional cancel signal — checked between Minkowski ops.
 * @returns {Promise<{vertices: number[], indices: number[]}>}
 */
export async function applyMeshFillet(obj, opts = {}) {
  if (obj?.type !== "imported" || !obj.geometry) {
    throw new Error("applyMeshFillet expects an imported mesh with geometry.");
  }
  const radius = Math.max(0.05, Math.min(50, Number(opts.radius) || 0.5));
  const mode = opts.mode === "chamfer" ? "chamfer" : "round";
  const scope = ["outer", "inner", "full"].includes(opts.scope) ? opts.scope : "outer";
  const segments = Number.isFinite(opts.segments) ? opts.segments
    : mode === "chamfer" ? 4 : 16;
  const signal = opts.signal;

  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  const wasm = await getManifold();
  checkAbort();

  // Build the source manifold from the imported geometry.
  const verts = new Float32Array(obj.geometry.vertices);
  const idx = new Uint32Array(obj.geometry.indices);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));

  let source = geomToManifold(wasm, g);
  checkAbort();

  // Build the kernel (a sphere — round for fillet, low-poly for chamfer).
  const kernel = wasm.Manifold.sphere(radius, segments);

  const runOpenClose = (m, op1, op2) => {
    // op1 first, then op2 — e.g. ('Sum','Difference') = open == outer fillet.
    const a = op1 === "Sum" ? m.minkowskiSum(kernel) : m.minkowskiDifference(kernel);
    checkAbort();
    const b = op2 === "Sum" ? a.minkowskiSum(kernel) : a.minkowskiDifference(kernel);
    try { a.delete(); } catch { /* noop */ }
    return b;
  };

  let result;
  try {
    if (scope === "outer") {
      // M ⊕ B ⊖ B
      result = runOpenClose(source, "Sum", "Difference");
    } else if (scope === "inner") {
      // M ⊖ B ⊕ B
      result = runOpenClose(source, "Difference", "Sum");
    } else {
      // full: inner first, then outer over the result.
      const inner = runOpenClose(source, "Difference", "Sum");
      checkAbort();
      result = runOpenClose(inner, "Sum", "Difference");
      try { inner.delete(); } catch { /* noop */ }
    }
    checkAbort();
    const { vertices, indices } = manifoldToVertsIndices(result);
    return { vertices, indices };
  } finally {
    try { kernel.delete(); } catch { /* noop */ }
    try { source.delete(); } catch { /* noop */ }
    try { result?.delete(); } catch { /* noop */ }
  }
}

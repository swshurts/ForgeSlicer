// manifold-3d powered CSG engine for ForgeSlicer.
//
// Drop-in replacement for the boolean/cut surface area provided by
// `csg.js` (three-bvh-csg), with three key reliability wins:
//   1. **Guaranteed manifold output** — manifold-3d's invariants mean we
//      never produce open edges along boolean boundaries, so downstream
//      slicers and STL/3MF exports always receive watertight meshes.
//   2. **Robust handling of coplanar / near-tangent faces** — the cases
//      that routinely yield degenerate geometry under three-bvh-csg.
//   3. **Deterministic across browsers** — pure WASM with no BVH heuristics.
//
// Public API mirrors the async surface in `workerClient.js`:
//   - evaluateSceneAsync(objects)
//   - evaluateSceneByColorAsync(objects)
//   - combineTwoAsync(a, b, op)
//   - cutObjectByPlaneAsync(obj, plane, options)
//
// All entries lazy-init the WASM module once per process (main thread OR
// worker) and reuse the singleton across calls. Manifold instances must
// be `.delete()`'d explicitly (WASM has no GC); every helper here owns
// its intermediate manifolds and disposes them before returning.

import * as THREE from "three";
import { buildGeometry } from "./geometry";
import { buildCubeManifoldWithFilletsSync, hasActiveEdgeFillets } from "./partialFillet";

let _modulePromise = null;
let _moduleCache = null;

/**
 * Lazy WASM module init. Resolves to the Manifold module with all
 * static helpers and prototype methods registered. Safe to call from
 * either main thread or a Web Worker — the inner code path detects the
 * environment and locates `manifold.wasm` accordingly.
 */
export function getManifold() {
  if (_modulePromise) return _modulePromise;
  _modulePromise = (async () => {
    const Module = (await import("manifold-3d")).default;
    // In both main thread and worker, manifold.wasm is served from the
    // app origin root (we copy it to /public/manifold.wasm). Using a
    // root-relative absolute URL keeps both environments happy.
    const baseOrigin =
      typeof self !== "undefined" && self.location
        ? self.location.origin
        : "";
    const wasm = await Module({
      locateFile: (path) =>
        path.endsWith(".wasm") ? `${baseOrigin}/${path}` : path,
    });
    wasm.setup();
    _moduleCache = wasm;
    return wasm;
  })();
  return _modulePromise;
}

/**
 * Sync accessor for the already-loaded Manifold module. Returns `null` if
 * `getManifold()` has never resolved yet. Used by the BVH (three-bvh-csg)
 * fallback path in `csg.js` to build filleted-cube geometry synchronously
 * — the cache is reliably warm by the time the fallback runs because the
 * primary manifold-3d path always attempts the WASM-backed solve first.
 */
export function getManifoldSync() {
  return _moduleCache;
}

// ---------- THREE <-> Manifold conversion ----------

/**
 * Weld duplicate vertices via a spatial hash. Three.js's primitive
 * geometries (BoxGeometry, SphereGeometry, ...) have duplicate vertices
 * along UV seams, which would cause manifold-3d to throw "NotManifold"
 * on import. We snap-to-grid at `tol` mm and remap triangles to the
 * canonical vertex index.
 */
function weldGeometry(geom, tol = 1e-4) {
  const posAttr = geom.attributes.position;
  if (!posAttr || posAttr.count === 0) return geom;
  const positions = posAttr.array;
  const hasIndex = !!geom.index;
  const triCount = hasIndex
    ? geom.index.count / 3
    : posAttr.count / 3;

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
      // Snap-to-grid value keeps merged verts byte-identical.
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

  // Drop degenerate triangles (two or three identical vertex indices)
  // — manifold-3d rejects them as invalid.
  let outCount = 0;
  const filtered = new Uint32Array(triVerts.length);
  for (let i = 0; i < triVerts.length; i += 3) {
    const a = triVerts[i], b = triVerts[i + 1], c = triVerts[i + 2];
    if (a === b || b === c || a === c) continue;
    filtered[outCount++] = a;
    filtered[outCount++] = b;
    filtered[outCount++] = c;
  }
  const finalTriVerts = outCount === filtered.length
    ? filtered
    : filtered.slice(0, outCount);

  return {
    vertProperties: new Float32Array(newPositions),
    triVerts: finalTriVerts,
  };
}

/**
 * Build a Manifold from a THREE.BufferGeometry. Throws if the resulting
 * mesh is empty or fails Manifold's internal validation (NotManifold,
 * NonFiniteVertex, etc.). Callers are expected to handle these as
 * non-fatal so a single bad input doesn't tank the whole boolean chain.
 */
/**
 * Compute the model's typical edge length so we can pick repair
 * tolerances that scale with the input. A 1mm gap is catastrophic on
 * a 5mm earring but a rounding error on a 200mm Gridfinity base — fixed
 * absolute tolerances would either miss small gaps or over-collapse
 * tiny features. We sample the diagonal of the bbox and scale from there.
 */
function modelScale(geom) {
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (!bb) return 1;
  const dx = bb.max.x - bb.min.x;
  const dy = bb.max.y - bb.min.y;
  const dz = bb.max.z - bb.min.z;
  const diag = Math.hypot(dx, dy, dz);
  return diag > 0 ? diag : 1;
}

/**
 * Build a Manifold from a THREE.BufferGeometry with progressive
 * auto-repair. Most third-party STLs (Thingiverse, Printables, MakerWorld)
 * arrive with tiny topology defects:
 *   - duplicate vertices along seams that mergeVertices missed
 *   - sub-micron gaps between adjacent triangles
 *   - degenerate / zero-area tris from CAD export rounding
 *   - hairline cracks along loft / sweep boundaries
 *
 * Each pass tightens-then-loosens the weld tolerance to close those
 * gaps without collapsing the model:
 *
 *   Pass 1: tol = scale * 1e-7  → effectively no weld, fastest path for
 *           already-clean meshes (Three.js primitives, exports from us).
 *   Pass 2: tol = scale * 1e-5  → catches float-precision duplicates.
 *   Pass 3: tol = scale * 1e-4  → bridges hairline cracks (~0.02mm on a
 *           200mm part). This is what OrcaSlicer / FlashForge "Repair"
 *           usually accomplishes.
 *   Pass 4: tol = scale * 5e-4  → last-resort weld for chunky third-party
 *           imports with visible seams.
 *
 * If all 4 passes still produce a `NotManifold` status, throw — the
 * caller (evaluateSceneAsync) then aborts so the worker can fall back
 * to BVH-CSG, which doesn't require manifold input.
 */
function geometryToManifold(wasm, geom) {
  const s = modelScale(geom);
  const tolerances = [s * 1e-7, s * 1e-5, s * 1e-4, s * 5e-4];
  let lastError = null;
  for (let pass = 0; pass < tolerances.length; pass++) {
    const tol = tolerances[pass];
    const { vertProperties, triVerts } = weldGeometry(geom, tol);
    if (triVerts.length === 0 || vertProperties.length === 0) {
      lastError = new Error("Empty geometry");
      continue;
    }
    let mesh = null;
    let m = null;
    try {
      mesh = new wasm.Mesh({ numProp: 3, triVerts, vertProperties });
      // `merge()` rebuilds shared-vertex topology — critical after a weld
      // that collapsed duplicate verts into the same index.
      mesh.merge();
      m = new wasm.Manifold(mesh);
      // manifold-3d exposes a status enum: "NoError" means the input is
      // a valid 2-manifold solid. Anything else means we need a coarser
      // weld pass. We don't trust the constructor to throw — some bad
      // inputs construct successfully but with status != NoError.
      const status = m.status();
      if (status === "NoError" || !status) {
        return m;
      }
      lastError = new Error(`Manifold status=${status} at tol=${tol.toExponential(2)}`);
      m.delete();
      m = null;
    } catch (err) {
      lastError = err;
      if (m && !m.isDeleted?.()) {
        try { m.delete(); } catch (_) { /* already gone */ }
      }
    }
  }
  // All passes failed — re-throw the last error so the worker can fall
  // back to the BVH path, which handles non-manifold meshes natively.
  throw lastError || new Error("Auto-repair exhausted all weld tolerances");
}

/**
 * Convert a Manifold back into a THREE.BufferGeometry suitable for
 * STL/3MF export and rendering.
 */
function manifoldToGeometry(manifold) {
  const m = manifold.getMesh();
  const g = new THREE.BufferGeometry();
  // `vertProperties` for numProp=3 is exactly [x,y,z,x,y,z,...]. Clone
  // the typed array — the underlying buffer is owned by the manifold
  // mesh and would be released on .delete().
  const positions = new Float32Array(m.vertProperties);
  const indices = new Uint32Array(m.triVerts);
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/**
 * Build a transformed Manifold for a single scene object. We bake
 * negative-scale flips into the local geometry (mirror + winding swap)
 * BEFORE creating the Manifold, since `.scale()` with a negative
 * component is technically supported but goes through extra topology
 * work — pre-baking is faster and more numerically stable.
 */
function buildObjectManifold(wasm, obj, scene = null) {
  // FAST PATH: cube with per-edge fillets / chamfers (or Item-mode fillets
  // applied through the edgeFillets pipeline). The synchronous
  // `buildGeometry` returns a SHARP `BoxGeometry` placeholder for these
  // cubes — the viewport later swaps in the real chamfered mesh via the
  // async `buildCubeGeometryWithFillets` path. Without this branch, every
  // STL / 3MF / Manifold-based export silently dropped the chamfer.
  //
  // We build the manifold directly via the partial-fillet engine, then
  // apply the object's transform (scale/rotation/translation) on top.
  if (obj.type === "cube" && hasActiveEdgeFillets(obj)) {
    const filleted = buildCubeManifoldWithFilletsSync(wasm, obj);
    if (filleted) {
      return _applyObjTransformToManifold(wasm, filleted, obj);
    }
    // Falls through to the geometry path if the partial-fillet build
    // returned null (e.g. all radii ended up too small after clamping).
  }

  let geom = buildGeometry(obj, scene);
  const sx = obj.scale[0], sy = obj.scale[1], sz = obj.scale[2];
  const negCount = (sx < 0 ? 1 : 0) + (sy < 0 ? 1 : 0) + (sz < 0 ? 1 : 0);
  const posScale = [Math.abs(sx), Math.abs(sy), Math.abs(sz)];

  if (negCount > 0) {
    geom = geom.clone();
    const arr = geom.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      if (sx < 0) arr[i]     *= -1;
      if (sy < 0) arr[i + 1] *= -1;
      if (sz < 0) arr[i + 2] *= -1;
    }
    // Odd negation count flips orientation; restore by swapping indices 1,2.
    if (negCount % 2 === 1) {
      if (geom.index) {
        const idx = geom.index.array;
        for (let i = 0; i < idx.length; i += 3) {
          const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp;
        }
      } else {
        for (let i = 0; i < arr.length; i += 9) {
          for (let k = 0; k < 3; k++) {
            const a = i + 3 + k, b = i + 6 + k;
            const tmp = arr[a]; arr[a] = arr[b]; arr[b] = tmp;
          }
        }
      }
    }
  }

  let m = geometryToManifold(wasm, geom);
  // Apply scale → rotate → translate via the shared helper.
  return _applyTransformAfterGeom(wasm, m, obj, posScale);
}

/**
 * Apply the object's scale → rotate → translate transform to a freshly
 * built manifold. Negative scale flips are NOT pre-baked (Manifold's own
 * .scale() handles them, just less efficiently); callers that already
 * pre-bake negatives (the BufferGeometry path) should pass the pre-baked
 * `posScale` so we don't double-apply.
 */
function _applyTransformAfterGeom(wasm, m, obj, posScale) {
  if (posScale[0] !== 1 || posScale[1] !== 1 || posScale[2] !== 1) {
    const next = m.scale(posScale);
    m.delete();
    m = next;
  }
  const rx = obj.rotation[0] || 0;
  const ry = obj.rotation[1] || 0;
  const rz = obj.rotation[2] || 0;
  if (rx !== 0 || ry !== 0 || rz !== 0) {
    const rotEuler = new THREE.Euler(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      "XYZ",
    );
    const rotMat = new THREE.Matrix4().makeRotationFromEuler(rotEuler);
    const next = m.transform(Array.from(rotMat.elements));
    m.delete();
    m = next;
  }
  const [px, py, pz] = obj.position;
  if (px !== 0 || py !== 0 || pz !== 0) {
    const next = m.translate([px, py, pz]);
    m.delete();
    m = next;
  }
  return m;
}

/**
 * Wrapper for the cube/edge-fillet fast path. The partial-fillet pipeline
 * builds the manifold with positive dimensions and no pre-baked scale
 * flips; here we apply the object's full scale (including any negative
 * components) through Manifold's native .scale().
 */
function _applyObjTransformToManifold(wasm, m, obj) {
  const sx = obj.scale[0], sy = obj.scale[1], sz = obj.scale[2];
  return _applyTransformAfterGeom(wasm, m, obj, [sx, sy, sz]);
}

// Safe disposal helper — `.delete()` throws if called twice.
function disposeAll(...manifolds) {
  for (const m of manifolds) {
    if (m && !m.isDeleted?.()) {
      try { m.delete(); } catch (_) { /* already gone */ }
    }
  }
}

/**
 * Combine all visible positives via batched union, then subtract all
 * negatives via batched difference. Returns the merged geometry with
 * triangle count + manifold health metrics. The batched ops minimise
 * intermediate manifold allocations relative to a sequential .add chain.
 */
export async function evaluateSceneAsync(objects) {
  const wasm = await getManifold();
  const visibles = (objects || []).filter((o) => o.visible !== false);
  const positives = visibles.filter((o) => o.modifier !== "negative");
  const negatives = visibles.filter((o) => o.modifier === "negative");
  // Scene context for ref-resolving primitives (Sweep path.kind:"ref").
  // The full `objects` list is the canonical scene at evaluation time.
  const scene = { objects };

  if (positives.length === 0) {
    return {
      geometry: new THREE.BufferGeometry(),
      triangleCount: 0,
      empty: true,
      boundaryEdges: 0,
      manifold: true,
    };
  }

  const posManifolds = [];
  const skipped = [];
  for (const p of positives) {
    try {
      posManifolds.push(buildObjectManifold(wasm, p, scene));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[manifoldEngine] failed positive "${p.name}":`, err.message);
      skipped.push(p.name);
    }
  }
  // If ANY positive failed to convert, abort. The worker's evaluateSmart
  // catches this and falls back to three-bvh-csg, which is more forgiving
  // with imperfect imported STLs (open edges, near-coincident verts, etc.).
  // We dispose anything we already built so memory doesn't leak.
  if (skipped.length > 0) {
    disposeAll(...posManifolds);
    const err = new Error(`Manifold rejected ${skipped.length} object(s): ${skipped.join(", ")}`);
    err.code = "MANIFOLD_REJECTED";
    err.skipped = skipped;
    throw err;
  }
  if (posManifolds.length === 0) {
    return {
      geometry: new THREE.BufferGeometry(),
      triangleCount: 0,
      empty: true,
      boundaryEdges: 0,
      manifold: true,
    };
  }

  let union;
  if (posManifolds.length === 1) {
    union = posManifolds[0];
  } else {
    union = wasm.Manifold.union(posManifolds);
    disposeAll(...posManifolds);
  }

  let result = union;
  if (negatives.length > 0) {
    const negManifolds = [];
    const negSkipped = [];
    for (const n of negatives) {
      try {
        negManifolds.push(buildObjectManifold(wasm, n, scene));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[manifoldEngine] failed negative "${n.name}":`, err.message);
        negSkipped.push(n.name);
      }
    }
    if (negSkipped.length > 0) {
      // Abort & let BVH handle it — same reasoning as positives.
      disposeAll(result, ...negManifolds);
      const err = new Error(`Manifold rejected negative ${negSkipped.length} object(s): ${negSkipped.join(", ")}`);
      err.code = "MANIFOLD_REJECTED";
      err.skipped = negSkipped;
      throw err;
    }
    if (negManifolds.length > 0) {
      const carved = wasm.Manifold.difference([result, ...negManifolds]);
      disposeAll(result, ...negManifolds);
      result = carved;
    }
  }

  const geometry = manifoldToGeometry(result);
  const triangleCount = geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor((geometry.attributes.position?.count || 0) / 3);
  disposeAll(result);

  return {
    geometry,
    triangleCount,
    empty: triangleCount === 0,
    // Manifold-3d guarantees watertight output; boundaryEdges is always 0.
    boundaryEdges: 0,
    manifold: true,
  };
}

/**
 * Like evaluateSceneAsync but groups positives by `colorIndex` and
 * returns a separate watertight geometry per group. All negatives are
 * subtracted from every group so a single carve cuts cleanly through
 * every material.
 */
export async function evaluateSceneByColorAsync(objects) {
  const wasm = await getManifold();
  const visibles = (objects || []).filter((o) => o.visible !== false);
  const positives = visibles.filter((o) => o.modifier !== "negative");
  const negatives = visibles.filter((o) => o.modifier === "negative");
  if (positives.length === 0) return { groups: [], totalTriangles: 0 };
  const scene = { objects };

  const byColor = new Map();
  for (const p of positives) {
    const k = (p.colorIndex | 0) || 0;
    if (!byColor.has(k)) byColor.set(k, []);
    byColor.get(k).push(p);
  }

  // Build the shared "all negatives unioned" manifold once so we can reuse
  // it per color without rebuilding.
  let negUnion = null;
  if (negatives.length > 0) {
    const negManifolds = [];
    const negSkipped = [];
    for (const n of negatives) {
      try { negManifolds.push(buildObjectManifold(wasm, n, scene)); }
      catch (err) { negSkipped.push(n.name); }
    }
    if (negSkipped.length > 0) {
      disposeAll(...negManifolds);
      const err = new Error(`Manifold rejected negative ${negSkipped.length} object(s): ${negSkipped.join(", ")}`);
      err.code = "MANIFOLD_REJECTED";
      err.skipped = negSkipped;
      throw err;
    }
    if (negManifolds.length === 1) {
      negUnion = negManifolds[0];
    } else if (negManifolds.length > 1) {
      negUnion = wasm.Manifold.union(negManifolds);
      disposeAll(...negManifolds);
    }
  }

  const groups = [];
  let total = 0;
  const colorKeys = Array.from(byColor.keys()).sort((a, b) => a - b);
  for (const colorIndex of colorKeys) {
    const ps = byColor.get(colorIndex);
    const posManifolds = [];
    const posSkipped = [];
    for (const p of ps) {
      try { posManifolds.push(buildObjectManifold(wasm, p, scene)); }
      catch (err) { posSkipped.push(p.name); }
    }
    if (posSkipped.length > 0) {
      disposeAll(...posManifolds, negUnion);
      const err = new Error(`Manifold rejected ${posSkipped.length} object(s): ${posSkipped.join(", ")}`);
      err.code = "MANIFOLD_REJECTED";
      err.skipped = posSkipped;
      throw err;
    }
    if (posManifolds.length === 0) continue;
    let groupM;
    if (posManifolds.length === 1) groupM = posManifolds[0];
    else {
      groupM = wasm.Manifold.union(posManifolds);
      disposeAll(...posManifolds);
    }
    if (negUnion) {
      const carved = wasm.Manifold.difference([groupM, negUnion]);
      disposeAll(groupM);
      groupM = carved;
    }
    const geometry = manifoldToGeometry(groupM);
    const tri = geometry.index
      ? Math.floor(geometry.index.count / 3)
      : Math.floor((geometry.attributes.position?.count || 0) / 3);
    disposeAll(groupM);
    if (tri > 0) {
      groups.push({ colorIndex, geometry, triangleCount: tri });
      total += tri;
    }
  }
  disposeAll(negUnion);
  return { groups, totalTriangles: total };
}

const OP_MAP = {
  union: "add",
  subtract: "subtract",
  intersect: "intersect",
};

/**
 * Boolean two specific objects (selected pair). Returns plain-array
 * vertex/index buffers, matching the shape `combineTwo` in csg.js
 * returns so callers in workerClient / TopToolbar stay unchanged.
 */
export async function combineTwoAsync(a, b, op) {
  const wasm = await getManifold();
  const opName = OP_MAP[op] || "add";
  let mA = null, mB = null, mR = null;
  try {
    mA = buildObjectManifold(wasm, a);
    mB = buildObjectManifold(wasm, b);
    mR = mA[opName](mB);
    const geometry = manifoldToGeometry(mR);
    const positions = geometry.attributes.position.array;
    const indices = geometry.index ? geometry.index.array : null;
    return {
      vertices: new Float32Array(positions),
      indices: indices ? new Uint32Array(indices) : null,
    };
  } finally {
    disposeAll(mA, mB, mR);
  }
}

/**
 * Slice an object by an infinite plane and return up to two halves.
 * `plane` is { position: [x,y,z], rotation: [rx,ry,rz] } where rotation
 * is in DEGREES. The plane's local +Y axis defines the "upper" half
 * direction — same convention as `cutObjectByPlane` in csg.js.
 *
 * Manifold's `splitByPlane(normal, offset)` returns two manifolds:
 *   [0] = side the normal points toward (we map to "upper")
 *   [1] = the other side (= "lower")
 */
export async function cutObjectByPlaneAsync(obj, plane, options = {}) {
  const wasm = await getManifold();
  const wantUpper = options.upper !== false;
  const wantLower = options.lower !== false;
  let src = null;
  let upper = null, lower = null;
  try {
    src = buildObjectManifold(wasm, obj);
    // Plane normal: rotate +Z by the plane's rotation Euler. The default
    // cut plane is the horizontal XY plane (normal = +Z) — this matches
    // the gizmo's PlaneGeometry default (which renders facing +Z) and the
    // BVH-path convention in csg.js. Z-up coordinate system throughout.
    const rxRad = THREE.MathUtils.degToRad(plane.rotation[0] || 0);
    const ryRad = THREE.MathUtils.degToRad(plane.rotation[1] || 0);
    const rzRad = THREE.MathUtils.degToRad(plane.rotation[2] || 0);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rxRad, ryRad, rzRad)
    );
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    // Manifold splits at: normal · v = offset. The plane passes through
    // plane.position with normal `normal`, so offset = normal · position.
    const [px, py, pz] = plane.position;
    const offset = normal.x * px + normal.y * py + normal.z * pz;

    const halves = src.splitByPlane([normal.x, normal.y, normal.z], offset);
    [upper, lower] = halves;

    const toBuffers = (m) => {
      if (!m) return null;
      const g = manifoldToGeometry(m);
      if (!g.attributes.position || g.attributes.position.count === 0) return null;
      return {
        vertices: new Float32Array(g.attributes.position.array),
        indices: g.index ? new Uint32Array(g.index.array) : null,
      };
    };

    return {
      upper: wantUpper ? toBuffers(upper) : null,
      lower: wantLower ? toBuffers(lower) : null,
    };
  } finally {
    disposeAll(src, upper, lower);
  }
}

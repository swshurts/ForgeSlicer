import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildGeometry, applyTransform } from "./geometry";
import { buildCubeManifoldWithFilletsSync, hasActiveEdgeFillets } from "./partialFillet";
import { getManifoldSync } from "./manifoldEngine";

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

// Module-level scene context for ref-resolving primitives (specifically
// the Sweep primitive's `path.kind: "ref"` which looks up another
// object's centerline at geometry-build time). Set by the public entry
// points (`evaluateScene`, `evaluateSceneByColor`, `combineTwo`,
// `cutObjectByPlane`) before they kick off any `makeBrush` calls; read
// inside `makeBrush` via `buildGeometry(obj, _sceneContext)`. We use a
// module-scoped variable rather than threading `scene` through ~10
// call sites because (a) CSG is single-threaded per call anyway, so
// there's no reentrancy hazard, and (b) it keeps the function
// signatures unchanged — pure refactor, no signature churn.
let _sceneContext = null;

function makeBrush(obj, opts = {}, scene = null) {
  let geom = null;
  // Cubes with per-edge fillets/chamfers need a Manifold-built mesh —
  // buildGeometry() returns a SHARP BoxGeometry placeholder for them
  // because the partial-fillet pipeline only kicks in on the manifold-3d
  // engine path. When we land here (the three-bvh-csg fallback, taken
  // when an imported STL is non-manifold), we must materialise the real
  // filleted geometry ourselves or the carve produces a sharp hole.
  if (obj.type === "cube" && hasActiveEdgeFillets(obj)) {
    const wasm = getManifoldSync();
    if (wasm) {
      try {
        const m = buildCubeManifoldWithFilletsSync(wasm, obj);
        if (m) {
          const mesh = m.getMesh();
          geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3));
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
          geom.computeVertexNormals();
          m.delete();
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[csg] filleted-cube manifold build failed, falling back to sharp:", err?.message || err);
        geom = null;
      }
    }
  }
  if (!geom) geom = buildGeometry(obj, scene || _sceneContext);
  const { geom: prepped, positiveScale } = bakeNegativeScale(geom, obj);
  const mat = new THREE.MeshStandardMaterial();
  const b = new Brush(prepped, mat);
  // Optional epsilon inflate for negatives, used by subtract callers to
  // avoid coplanar artifacts. Kept at 1.0 unless explicitly requested so it
  // doesn't change export geometry for non-subtract codepaths.
  const inflate = opts.inflate || 1;
  const adjScale = inflate === 1 ? positiveScale : [
    positiveScale[0] * inflate,
    positiveScale[1] * inflate,
    positiveScale[2] * inflate,
  ];
  applyTransform(b, { ...obj, scale: adjScale });
  return b;
}

const NEG_INFLATE = 1.0;

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
  _sceneContext = { objects };
  _droppedNegatives.length = 0;
  try {
    const result = _evaluateSceneImpl(objects);
    if (_droppedNegatives.length > 0) {
      result.droppedNegatives = [..._droppedNegatives];
    }
    return result;
  } finally {
    _sceneContext = null;
  }
}

function _evaluateSceneImpl(objects) {
  const visibles = objects.filter((o) => o.visible !== false);
  const positives = visibles.filter((o) => o.modifier !== "negative");
  const negatives = visibles.filter((o) => o.modifier === "negative");

  if (positives.length === 0) {
    return { geometry: new THREE.BufferGeometry(), triangleCount: 0, empty: true };
  }

  const evaluator = new Evaluator();
  const mat = new THREE.MeshStandardMaterial();

  // Step 1: build a single Brush that represents all positives.
  // - For 1 positive: just makeBrush(positive).
  // - For 2+ positives + 0 negatives: concatenate baked world geometries
  //   (slicers handle multi-shell input natively; CSG Union of non-manifold
  //   shells routinely produces a degenerate result whose attributes.position
  //   is undefined and crashes downstream exporters).
  // - For 2+ positives + negatives: try real Union so negatives can carve
  //   across the joined volume; if Union returns an invalid geometry, fall
  //   back to applying the negatives to each positive independently and
  //   concatenating those.
  let acc;
  let positivesWereUnioned = true;
  if (positives.length === 1) {
    acc = makeBrush(positives[0]);
  } else if (negatives.length === 0) {
    acc = buildConcatBrush(positives, mat);
    positivesWereUnioned = false;
  } else {
    // Multi-positive + negatives. Attempt Union, fall back to per-positive.
    let unionWorks = true;
    let tryAcc = makeBrush(positives[0]);
    for (let i = 1; i < positives.length; i++) {
      try {
        const res = evaluator.evaluate(tryAcc, makeBrush(positives[i]), ADDITION);
        if (!res || !res.geometry || !isValidGeometry(res.geometry)) {
          unionWorks = false; break;
        }
        tryAcc = res;
      } catch (_) {
        unionWorks = false; break;
      }
    }
    if (unionWorks) {
      acc = tryAcc;
    } else {
      // Per-positive: subtract negatives from each positive, then concatenate.
      const carved = positives.map((p) => subtractNegatives(makeBrush(p), negatives, evaluator, mat));
      acc = buildConcatBrushFromBrushes(carved, mat);
      positivesWereUnioned = false;
      // Don't run the outer negative chain again.
      negatives.length = 0;
    }
  }

  // Step 2: apply negatives (only when we have a unified Brush — for the
  // concat-only branches above the negatives were either absent or already
  // applied per-positive).
  if (positivesWereUnioned && negatives.length > 0) {
    acc = subtractNegatives(acc, negatives, evaluator, mat);
  }

  // Bake world matrix into final geometry.
  let baked = acc.geometry.clone();
  baked.applyMatrix4(acc.matrixWorld);
  baked.clearGroups();
  baked = cleanGeometry(baked);

  const triCount = baked.index
    ? baked.index.count / 3
    : baked.attributes.position.count / 3;
  const boundaryEdges = countBoundaryEdges(baked);

  return {
    geometry: baked,
    triangleCount: Math.floor(triCount),
    empty: triCount === 0,
    boundaryEdges,
    manifold: boundaryEdges === 0,
  };
}

// Subtract every negative from `acc`. Each subtract is guarded so a single
// failure doesn't nuke the rest of the chain.
//
// Non-manifold hosts (e.g. AI-generated STLs) routinely cause three-bvh-csg
// to emit an empty/invalid geometry. We don't silently drop those — we:
//   1. Try once with the host as-is.
//   2. If invalid, re-weld the host accumulator at a tighter tolerance and
//      try again. AI mesh seams collapse and the BVH inside/outside tests
//      become consistent.
//   3. If STILL invalid, push the negative's name onto `_droppedNegatives`
//      (read by evaluateScene to surface a user-visible warning) and keep
//      the previous accumulator. We also log a console error so it's
//      visible in devtools (not just `console.warn`).
const _droppedNegatives = [];
function subtractNegatives(acc, negatives, evaluator, mat) {
  let current = acc;
  for (const n of negatives) {
    const nb = makeBrush(n, { inflate: NEG_INFLATE });
    let res = null;
    try {
      res = evaluator.evaluate(current, nb, SUBTRACTION);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[csg] subtract threw on "${n.name}":`, e);
    }
    if (res && res.geometry && isValidGeometry(res.geometry)) {
      current = res;
      continue;
    }
    // Repair-and-retry: re-weld the host accumulator at a tight tolerance.
    try {
      const repaired = repairBrush(current, mat);
      const res2 = evaluator.evaluate(repaired, nb, SUBTRACTION);
      if (res2 && res2.geometry && isValidGeometry(res2.geometry)) {
        current = res2;
        continue;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[csg] repair+retry subtract threw on "${n.name}":`, e);
    }
    // Both attempts failed — record the drop and keep the previous result.
    _droppedNegatives.push(n.name || n.id || "(unnamed)");
    // eslint-disable-next-line no-console
    console.error(
      `[csg] Boolean subtract DROPPED for negative "${n.name || n.id}" — ` +
      `host mesh is likely non-manifold (open edges / self-intersections). ` +
      `The export will NOT include this cut.`
    );
  }
  return current;
}

// Re-weld + clean a Brush's geometry into a new Brush. Used as a last-ditch
// repair before retrying a failed BVH boolean.
function repairBrush(brush, mat) {
  const baked = bakeBrushToWorld(brush);
  // 1e-3 mm (1 micron) — aggressive enough to bridge sub-printable seams in
  // AI-generated meshes while preserving every feature a 3D printer can
  // actually resolve.
  let cleaned = weldVertices(baked, 1e-3);
  cleaned = removeDegenerateTriangles(cleaned);
  cleaned.computeVertexNormals();
  const b = new Brush(cleaned, mat);
  // Identity world matrix — geometry already baked into world space above.
  b.position.set(0, 0, 0);
  b.rotation.set(0, 0, 0);
  b.scale.set(1, 1, 1);
  b.updateMatrixWorld(true);
  return b;
}

// Concatenate multiple positives' world-baked geometries into a single
// Brush so the rest of evaluateScene can keep treating it as one accumulator.
function buildConcatBrush(positives, mat) {
  const worldGeoms = positives.map((p) => bakeBrushToWorld(makeBrush(p)));
  return brushFromWorldGeoms(worldGeoms, mat);
}

function buildConcatBrushFromBrushes(brushes, mat) {
  const worldGeoms = brushes.map(bakeBrushToWorld);
  return brushFromWorldGeoms(worldGeoms, mat);
}

function brushFromWorldGeoms(worldGeoms, mat) {
  let geom;
  if (worldGeoms.length === 1) {
    geom = worldGeoms[0];
  } else {
    const stripped = worldGeoms.map(stripToPositionIndex);
    geom = mergeGeometries(stripped, false) || worldGeoms[0];
  }
  const b = new Brush(geom, mat);
  b.updateMatrixWorld(true);
  return b;
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
  _sceneContext = { objects };
  _droppedNegatives.length = 0;
  try {
    const result = _evaluateSceneByColorImpl(objects);
    if (_droppedNegatives.length > 0) {
      result.droppedNegatives = [..._droppedNegatives];
    }
    return result;
  } finally {
    _sceneContext = null;
  }
}

function _evaluateSceneByColorImpl(objects) {
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
  const evaluator = new Evaluator();
  const mat = new THREE.MeshStandardMaterial();
  for (const colorIndex of colorKeys) {
    const colorPositives = byColor.get(colorIndex);
    let acc;
    let negsAlreadyCarved = false;
    if (colorPositives.length === 1) {
      acc = makeBrush(colorPositives[0]);
    } else if (negatives.length === 0) {
      acc = buildConcatBrush(colorPositives, mat);
    } else {
      // Union+fallback as in evaluateScene.
      let unionWorks = true;
      let tryAcc = makeBrush(colorPositives[0]);
      for (let i = 1; i < colorPositives.length; i++) {
        try {
          const res = evaluator.evaluate(tryAcc, makeBrush(colorPositives[i]), ADDITION);
          if (!res || !res.geometry || !isValidGeometry(res.geometry)) {
            unionWorks = false; break;
          }
          tryAcc = res;
        } catch (_) { unionWorks = false; break; }
      }
      if (unionWorks) {
        acc = tryAcc;
      } else {
        const carved = colorPositives.map((p) => subtractNegatives(makeBrush(p), negatives, evaluator, mat));
        acc = buildConcatBrushFromBrushes(carved, mat);
        negsAlreadyCarved = true;
      }
    }
    if (!negsAlreadyCarved && negatives.length > 0) {
      acc = subtractNegatives(acc, negatives, evaluator, mat);
    }
    let baked = acc.geometry.clone();
    baked.applyMatrix4(acc.matrixWorld);
    baked.clearGroups();
    baked = cleanGeometry(baked);
    const tri = baked.index
      ? baked.index.count / 3
      : baked.attributes.position.count / 3;
    if (tri > 0) {
      groups.push({ colorIndex, geometry: baked, triangleCount: Math.floor(tri) });
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
  // When the user explicitly subtracts B from A via the toolbar, inflate B
  // slightly to avoid coplanar artifacts (same trick we use for scene-level
  // negatives in evaluateScene).
  const bb = makeBrush(b, op === "subtract" ? { inflate: NEG_INFLATE } : {});
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

// ---------- Plane cut ----------
// Slice an object by an infinite plane. Returns up to two pieces ({upper, lower})
// representing the geometry on each side of the cut plane. Either side can be
// null if the user chose "keep only one half" — caller decides which to keep.
//
// Implementation: we build a HUGE half-space box positioned so one face sits
// exactly on the cutting plane, then INTERSECT the source with each box. The
// box is rotated to match the plane's normal so the cut works for any
// orientation. Using a box rather than a plane is necessary because three-bvh-csg
// requires closed manifolds for both operands.
//
// `plane` is { position: [x,y,z], rotation: [rx,ry,rz] } in world space.
// The "upper" half is the side the plane's local +Z axis points toward
// (Z-up CAD convention — cuts default to horizontal slicing).
export function cutObjectByPlane(obj, plane, options = {}) {
  const wantUpper = options.upper !== false;
  const wantLower = options.lower !== false;
  // Half-space box: 1000mm cube (large enough to engulf any printable object).
  // We position its CENTER 500mm along the chosen side so its near face sits
  // exactly on the cutting plane. Then we apply the plane's world rotation.
  const BOX = 1000;
  const evaluator = new Evaluator();
  const srcBrush = makeBrush(obj);

  const makeHalfSpace = (signZ) => {
    const g = new THREE.BoxGeometry(BOX, BOX, BOX);
    const mat = new THREE.MeshStandardMaterial();
    const b = new Brush(g, mat);
    // In the plane's LOCAL frame the cut is the XY plane at z=0. To make a
    // half-space box, push its center to (0, 0, ±BOX/2) so its near face
    // sits on z=0. Then rotate+translate by the plane's world transform.
    const planeMat = new THREE.Matrix4();
    const planeEuler = new THREE.Euler(plane.rotation[0], plane.rotation[1], plane.rotation[2]);
    const planeQuat = new THREE.Quaternion().setFromEuler(planeEuler);
    const offsetLocal = new THREE.Vector3(0, 0, signZ * BOX / 2);
    const offsetWorld = offsetLocal.clone().applyQuaternion(planeQuat);
    planeMat.compose(
      new THREE.Vector3(
        plane.position[0] + offsetWorld.x,
        plane.position[1] + offsetWorld.y,
        plane.position[2] + offsetWorld.z,
      ),
      planeQuat,
      new THREE.Vector3(1, 1, 1),
    );
    b.matrix.copy(planeMat);
    b.matrix.decompose(b.position, b.quaternion, b.scale);
    b.updateMatrixWorld(true);
    return b;
  };

  const result = { upper: null, lower: null };
  const bake = (r) => {
    let geom = r.geometry.clone();
    geom.applyMatrix4(r.matrixWorld);
    geom.clearGroups();
    geom = cleanGeometry(geom);
    if (!geom.attributes.position || geom.attributes.position.count === 0) return null;
    const pos = geom.attributes.position.array;
    const indices = geom.index ? geom.index.array : null;
    return {
      vertices: new Float32Array(pos),
      indices: indices ? new Uint32Array(indices) : null,
    };
  };

  if (wantUpper) {
    const upperBox = makeHalfSpace(+1);
    const r = evaluator.evaluate(srcBrush, upperBox, INTERSECTION);
    result.upper = bake(r);
  }
  if (wantLower) {
    // Need a fresh source brush — bvh-csg mutates internal state during evaluate.
    const srcBrush2 = makeBrush(obj);
    const lowerBox = makeHalfSpace(-1);
    const r = evaluator.evaluate(srcBrush2, lowerBox, INTERSECTION);
    result.lower = bake(r);
  }
  return result;
}

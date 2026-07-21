// Job-based client for the heavy-compute Web Worker. Provides promise-based
// wrappers around all CSG/slice/export operations and a synchronous main-thread
// fallback for environments where Worker construction fails (test runners,
// extremely old browsers, sandbox limits).
import { evaluateScene, combineTwo, cutObjectByPlane } from "./csg";
import { sliceToGCODE } from "./slicer";
import {
  exportSceneToSTLBytes as mainExportSTLBytes,
  geometryToSTLBinary,
} from "./exporters";

let _worker = null;
let _workerBroken = false;
let _seq = 0;
const _pending = new Map();
const _progress = new Map();

function getWorker() {
  if (_worker || _workerBroken) return _worker;
  try {
    // CRA 5 / webpack 5 bundles a separate worker chunk from this URL.
    _worker = new Worker(new URL("./workers/csg.worker.js", import.meta.url));
    _worker.addEventListener("message", (e) => {
      const { jobId, ok, result, error, progress } = e.data || {};
      if (progress !== undefined) {
        const cb = _progress.get(jobId);
        if (cb) cb(progress);
        return;
      }
      const handle = _pending.get(jobId);
      if (!handle) return;
      _pending.delete(jobId);
      _progress.delete(jobId);
      if (ok) handle.resolve(result);
      else handle.reject(new Error(error || "Worker job failed"));
    });
    _worker.addEventListener("error", (e) => {
      // Reject all in-flight jobs and disable further worker use.
      _workerBroken = true;
      for (const [, h] of _pending) h.reject(new Error(e.message || "Worker crashed"));
      _pending.clear();
      _progress.clear();
      try { _worker.terminate(); }
      catch (terr) {
        // eslint-disable-next-line no-console
        console.warn("[ForgeSlicer] worker.terminate() failed:", terr);
      }
      _worker = null;
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ForgeSlicer] Web Worker unavailable, falling back to main thread:", err);
    _workerBroken = true;
    _worker = null;
  }
  return _worker;
}

function runOnWorker(type, payload, options = {}) {
  const w = getWorker();
  if (!w) return null; // signal fallback
  const jobId = `j${++_seq}`;
  return new Promise((resolve, reject) => {
    _pending.set(jobId, { resolve, reject });
    if (options.onProgress) _progress.set(jobId, options.onProgress);
    try {
      w.postMessage({ jobId, type, payload });
    } catch (err) {
      _pending.delete(jobId);
      _progress.delete(jobId);
      reject(err);
    }
  });
}

// ---------- Public async API ----------

export async function evaluateSceneStatsAsync(objects) {
  const p = runOnWorker("evaluate-stats", { objects });
  if (p) return p;
  const r = evaluateScene(objects);
  return {
    triangleCount: r.triangleCount,
    boundaryEdges: r.boundaryEdges,
    manifold: r.manifold,
    empty: r.empty,
  };
}

export async function combineTwoAsync(a, b, op) {
  const p = runOnWorker("combine", { a, b, op });
  if (p) return p;
  return combineTwo(a, b, op);
}

// Cut an object by an infinite plane via the manifold-3d worker (with
// main-thread BVH fallback). Plane object: `{ position: [x,y,z],
// rotation: [degX,degY,degZ] }`. `options.upper` / `options.lower`
// default to true; set false to skip emitting that half.
export async function cutObjectByPlaneAsync(obj, plane, options = {}) {
  const p = runOnWorker("cut-plane", { obj, plane, options });
  if (p) return p;
  return cutObjectByPlane(obj, plane, options);
}

// Bake a subset of scene objects into a single new imported mesh via
// the manifold-3d engine — used by the Flatten context-menu action. The
// caller wraps the returned vertices/indices/bbox into a scene object.
export async function flattenObjectsAsync(objects) {
  const p = runOnWorker("flatten", { objects });
  if (p) return p;
  // Main-thread fallback uses BVH-CSG. We still return the same shape so
  // ContextMenu's handler doesn't need to branch on engine.
  const r = evaluateScene(objects);
  if (r.empty || !r.geometry.attributes?.position) {
    throw new Error("Empty merged geometry");
  }
  const pos = r.geometry.attributes.position.array;
  const verts = pos instanceof Float32Array ? new Float32Array(pos) : Float32Array.from(pos);
  const idx = r.geometry.index ? new Uint32Array(r.geometry.index.array) : null;
  r.geometry.computeBoundingBox?.();
  const bb = r.geometry.boundingBox;
  return {
    vertices: verts,
    indices: idx,
    bbox: bb ? { min: { x: bb.min.x, y: bb.min.y, z: bb.min.z }, max: { x: bb.max.x, y: bb.max.y, z: bb.max.z } } : null,
    manifoldVerified: false,
  };
}


export async function sliceToGCODEAsync(objects, settings, onProgress) {
  // Strip non-clonable fields (e.g. Zustand's `set` action) before
  // crossing the Worker boundary. structuredClone (used by postMessage)
  // rejects function values, which would surface as a confusing "could
  // not be cloned" error to the user.
  const safeSettings = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (typeof v !== "function") safeSettings[k] = v;
  }
  const p = runOnWorker("slice", { objects, settings: safeSettings }, { onProgress });
  if (p) return p;
  return sliceToGCODE(objects, safeSettings, onProgress);
}

export async function exportSTLBytesAsync(objects) {
  const p = runOnWorker("stl-bytes", { objects });
  if (p) return p;
  // Main-thread fallback uses three-bvh-csg, so no manifold guarantee.
  const r = await mainExportSTLBytes(objects);
  return { ...r, manifoldVerified: false };
}

export async function export3MFBytesAsync(objects) {
  // Iter-105.17 — auto-route to modifier-mesh export when the CSG
  // engine would silently drop negatives because an imported (AI /
  // photogrammetry) host is non-manifold. The modifier-mesh path
  // emits host + negatives as separate volumes inside a Slic3r-style
  // 3MF; the downstream slicer (PrusaSlicer / OrcaSlicer / Bambu
  // Studio) does the carve at slice time using its own (much more
  // robust) CSG. This is the official 3MF/Prusa recommendation for
  // hobbyist STL input.
  //
  // Heuristic: if the scene contains BOTH (a) a visible imported
  // positive AND (b) a visible negative, use modifier-mesh export.
  // Native primitives (cube, sphere, cylinder, etc.) plus our own
  // SVG / sweep / pipe meshes are always manifold, so the regular
  // CSG path is safe — we don't penalise those projects by losing
  // the merged single-mesh output the slicer prefers.
  const visible = (objects || []).filter((o) => o.visible !== false);
  const hasImportedPositive = visible.some(
    (o) => o.type === "imported" && o.modifier !== "negative",
  );
  const hasNegative = visible.some((o) => o.modifier === "negative");
  if (hasImportedPositive && hasNegative) {
    const { exportSceneToModifier3MFBytes } = await import("./exporters");
    const r = await exportSceneToModifier3MFBytes(objects);
    return {
      bytes: r.bytes,
      parts: r.parts,
      multicolor: false,
      modifierMesh: true,
      positiveCount: r.positiveCount,
      negativeCount: r.negativeCount,
    };
  }

  const p = runOnWorker("threemf-bytes", { objects });
  if (p) return p;
  // Main-thread fallback: mirror the worker's multi-color detection.
  const visibles = visible.filter((o) => o.modifier !== "negative");
  const colorSet = new Set(visibles.map((o) => (o.colorIndex | 0) || 0));
  const { build3MFBytes, build3MFBytesMulti } = await import("./threemf");
  const { evaluateSceneByColor } = await import("./csg");
  if (colorSet.size >= 2) {
    const { groups } = evaluateSceneByColor(objects);
    if (groups.length === 0) throw new Error("Scene is empty. Add at least one positive component.");
    return { bytes: await build3MFBytesMulti(groups), parts: groups.length, multicolor: true };
  }
  const r = evaluateScene(objects);
  if (r.empty) throw new Error("Scene is empty. Add at least one positive component.");
  return { bytes: await build3MFBytes(r.geometry), parts: 1, multicolor: false };
}

// Iter-151.18 — Proper Bambu/OrcaSlicer multi-plate 3MF export.
// Called from `multiPlateExport.js` when a project spans >1 plate.
// Each plate becomes one merged CSG geometry; all plates are packed
// into a single 3MF with plate-assignment metadata.
export async function export3MFMultiPlateBytesAsync(plateGroups) {
  // plateGroups: [{ plateId, plateName, objects: [ThreeObject] }]
  const p = runOnWorker("threemf-multiplate-bytes", { plateGroups });
  if (p) return p;
  // Main-thread fallback for workerless environments.
  const { build3MFBytesBambuMultiPlate } = await import("./threemf");
  const { evaluateScene } = await import("./csg");
  const evaluated = [];
  for (const g of plateGroups || []) {
    if (!g.objects || g.objects.length === 0) continue;
    const r = evaluateScene(g.objects);
    if (r.empty) continue;
    evaluated.push({ plateId: g.plateId, plateName: g.plateName || g.plateId, geometry: r.geometry });
  }
  if (evaluated.length === 0) throw new Error("No non-empty plates to export.");
  return { bytes: await build3MFBytesBambuMultiPlate(evaluated), plates: evaluated.length };
}

// Modifier-mesh 3MF export — bypasses CSG entirely; emits host +
// negatives as separate volumes inside a Slic3r-style 3MF so the
// slicer does the carve at slice time. Runs synchronously on the main
// thread because (a) the work is just geometry baking + XML
// serialisation (no expensive CSG passes), and (b) the existing
// `csg.worker.js` doesn't have a handler for this path and adding one
// would 2x the surface area for marginal benefit.
export async function export3MFModifierBytesAsync(objects, projectName) {
  const { exportSceneToModifier3MFBytes } = await import("./exporters");
  return exportSceneToModifier3MFBytes(objects, projectName);
}

// Utility for callers that still need a THREE.BufferGeometry on the main thread
// (e.g. the viewport gizmos). Kept here so heavy callers can request it without
// re-importing the synchronous module.
export { geometryToSTLBinary };

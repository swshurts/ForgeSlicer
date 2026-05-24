// Job-based client for the heavy-compute Web Worker. Provides promise-based
// wrappers around all CSG/slice/export operations and a synchronous main-thread
// fallback for environments where Worker construction fails (test runners,
// extremely old browsers, sandbox limits).
import { evaluateScene, combineTwo } from "./csg";
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
  const p = runOnWorker("threemf-bytes", { objects });
  if (p) return p;
  // Main-thread fallback: mirror the worker's multi-color detection.
  const visibles = (objects || []).filter((o) => o.visible !== false && o.modifier !== "negative");
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

// Utility for callers that still need a THREE.BufferGeometry on the main thread
// (e.g. the viewport gizmos). Kept here so heavy callers can request it without
// re-importing the synchronous module.
export { geometryToSTLBinary };

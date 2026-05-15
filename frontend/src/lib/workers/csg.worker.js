/* eslint-disable no-restricted-globals */
// Heavy-compute worker for ForgeSlicer.
//
// Offloads CSG evaluation, manifold-edge stats, boolean ops, slicing, and
// STL/3MF byte generation from the main thread so the UI never freezes on
// complex models. Falls back to main-thread compute (via workerClient.js)
// if Worker construction fails.
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

import { evaluateScene, combineTwo, evaluateSceneByColor } from "../csg";
import { sliceToGCODE } from "../slicer";
import { build3MFBytes, build3MFBytesMulti } from "../threemf";

function geometryToSTLBytes(geometry) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const exporter = new STLExporter();
  const dv = exporter.parse(mesh, { binary: true });
  // STLExporter returns a DataView; copy bytes so the underlying buffer is
  // transferable and detached from THREE internals.
  return new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
}

async function geometryTo3MFBytes(geometry) {
  return build3MFBytes(geometry);
}
// (Kept for direct internal use; the worker entry now routes to build3MFBytesMulti when applicable.)

self.addEventListener("message", async (e) => {
  const { jobId, type, payload } = e.data || {};
  try {
    let result;
    let transfers = [];
    switch (type) {
      case "evaluate-stats": {
        const r = evaluateScene(payload.objects);
        result = {
          triangleCount: r.triangleCount,
          boundaryEdges: r.boundaryEdges,
          manifold: r.manifold,
          empty: r.empty,
        };
        break;
      }
      case "combine": {
        const merged = combineTwo(payload.a, payload.b, payload.op);
        result = merged;
        if (merged.vertices?.buffer) transfers.push(merged.vertices.buffer);
        if (merged.indices?.buffer) transfers.push(merged.indices.buffer);
        break;
      }
      case "slice": {
        const r = sliceToGCODE(payload.objects, payload.settings, (p) => {
          self.postMessage({ jobId, progress: p });
        });
        result = r;
        break;
      }
      case "stl-bytes": {
        const r = evaluateScene(payload.objects);
        if (r.empty) throw new Error("Scene is empty. Add at least one positive component.");
        const bytes = geometryToSTLBytes(r.geometry);
        result = { bytes, triangleCount: r.triangleCount };
        transfers.push(bytes.buffer);
        break;
      }
      case "threemf-bytes": {
        // Auto-detect multi-color: if there are 2+ distinct colorIndex values
        // among visible positives, emit a multi-part 3MF; else single-part.
        const visibles = (payload.objects || []).filter((o) => o.visible !== false && o.modifier !== "negative");
        const colorSet = new Set(visibles.map((o) => (o.colorIndex | 0) || 0));
        if (colorSet.size >= 2) {
          const { groups } = evaluateSceneByColor(payload.objects);
          if (groups.length === 0) throw new Error("Scene is empty. Add at least one positive component.");
          const bytes = await build3MFBytesMulti(groups);
          result = { bytes, parts: groups.length, multicolor: true };
          transfers.push(bytes.buffer);
        } else {
          const r = evaluateScene(payload.objects);
          if (r.empty) throw new Error("Scene is empty. Add at least one positive component.");
          const bytes = await build3MFBytes(r.geometry);
          result = { bytes, parts: 1, multicolor: false };
          transfers.push(bytes.buffer);
        }
        break;
      }
      default:
        throw new Error(`Unknown job type: ${type}`);
    }
    self.postMessage({ jobId, ok: true, result }, transfers);
  } catch (err) {
    self.postMessage({ jobId, ok: false, error: err && err.message ? err.message : String(err) });
  }
});

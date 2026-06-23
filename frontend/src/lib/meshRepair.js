// Thin main-thread client for the dedicated repair worker. We bounce
// the heavy voxel-remesh work off the main thread so the page stays
// responsive while `Manifold.levelSet` resolves the SDF grid.
//
// The repair worker is created lazily on the first call and kept around
// for subsequent invocations — instantiating it carries the cost of
// loading manifold-3d's WASM (~250 ms) and we'd rather pay that once.

import * as THREE from "three";

let _worker = null;
let _nextId = 1;

function getWorker() {
  if (_worker) return _worker;
  // Vite/CRA-style worker constructor. Resolves the module URL at build
  // time and ships the worker as a separate bundle.
  _worker = new Worker(
    new URL("./workers/repair.worker.js", import.meta.url)
  );
  return _worker;
}

/**
 * Repair a BufferGeometry by voxel-remeshing it via closest-point
 * signed distance + manifold-3d's level-set. Runs entirely in a Web
 * Worker so the UI stays responsive.
 *
 * Returns a new BufferGeometry + stats.
 */
export async function repairMeshGeometry(geometry, opts = {}) {
  const { onProgress, voxelSize } = opts;

  // Pull out the typed arrays we need to ship to the worker. We have to
  // clone them with `slice()` because we'll be transferring the buffers
  // and we don't want to leave the original BufferGeometry orphaned.
  const posAttr = geometry.attributes.position;
  if (!posAttr) throw new Error("Geometry has no position attribute.");
  const vertices = new Float32Array(posAttr.array.length);
  vertices.set(posAttr.array);
  let indices = null;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array.length);
    indices.set(geometry.index.array);
  }

  const worker = getWorker();
  const id = _nextId++;

  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const msg = e.data || {};
      if (msg.id !== id) return;
      if (msg.type === "progress") {
        if (onProgress) onProgress(msg.value);
        return;
      }
      worker.removeEventListener("message", onMessage);
      if (msg.type === "error") {
        reject(new Error(msg.message || "Repair worker failed."));
        return;
      }
      if (msg.type === "success") {
        const out = new THREE.BufferGeometry();
        out.setAttribute(
          "position",
          new THREE.BufferAttribute(msg.vertices, 3)
        );
        out.setIndex(new THREE.BufferAttribute(msg.indices, 1));
        out.computeVertexNormals();
        out.computeBoundingBox();
        resolve({ geometry: out, stats: msg.stats });
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage(
      { type: "repair", id, vertices, indices, voxelSize },
      // Transfer the buffers — much cheaper than structured-clone for
      // big geometries.
      indices ? [vertices.buffer, indices.buffer] : [vertices.buffer]
    );
  });
}

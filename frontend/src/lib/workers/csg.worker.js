/* eslint-disable no-restricted-globals */
// Heavy-compute worker for ForgeSlicer.
//
// Offloads CSG evaluation, manifold-edge stats, boolean ops, slicing, and
// STL/3MF byte generation from the main thread so the UI never freezes on
// complex models. Falls back to main-thread compute (via workerClient.js)
// if Worker construction fails.
//
// CSG ENGINE: manifold-3d (WASM) by default — guaranteed manifold output.
// Falls back to three-bvh-csg if manifold-3d throws (e.g., NotManifold
// on a corrupted import). The fallback keeps the user's design
// recoverable without forcing a refresh.
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

import {
  evaluateScene as evaluateSceneBVH,
  combineTwo as combineTwoBVH,
  evaluateSceneByColor as evaluateSceneByColorBVH,
} from "../csg";
import {
  evaluateSceneAsync,
  evaluateSceneByColorAsync,
  combineTwoAsync,
  cutObjectByPlaneAsync,
} from "../manifoldEngine";
import { sliceToGCODE } from "../slicer";
import { build3MFBytes, build3MFBytesMulti, build3MFBytesBambuMultiPlate } from "../threemf";

function geometryToSTLBytes(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    throw new Error(
      "Could not produce STL: the merged scene has no triangles. " +
      "Check the Manifold warning and try non-overlapping booleans."
    );
  }
  if (geometry.attributes.position.count === 0) {
    throw new Error("Could not produce STL: merged scene is empty. Add a positive component.");
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const exporter = new STLExporter();
  const dv = exporter.parse(mesh, { binary: true });
  return new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
}

// Engine selector — manifold-3d is the default, but a saved client-side
// preference can pin behaviour to BVH for users who hit a regression and
// need a fast escape hatch (toggled via /admin or window.__forgeCsgEngine).
let _enginePref = "manifold";
function preferredEngine() { return _enginePref; }

async function evaluateSmart(objects) {
  if (preferredEngine() === "bvh") {
    const r = evaluateSceneBVH(objects);
    return { ...r, manifoldVerified: false };
  }
  try {
    const r = await evaluateSceneAsync(objects);
    return { ...r, manifoldVerified: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[csg.worker] manifold evaluateScene failed, falling back to BVH:", err.message);
    const r = evaluateSceneBVH(objects);
    return { ...r, manifoldVerified: false };
  }
}

async function combineSmart(a, b, op) {
  if (preferredEngine() === "bvh") return combineTwoBVH(a, b, op);
  try {
    return await combineTwoAsync(a, b, op);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[csg.worker] manifold combineTwo failed, falling back to BVH:", err.message);
    return combineTwoBVH(a, b, op);
  }
}

async function evaluateByColorSmart(objects) {
  if (preferredEngine() === "bvh") return evaluateSceneByColorBVH(objects);
  try {
    return await evaluateSceneByColorAsync(objects);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[csg.worker] manifold evaluateSceneByColor failed, falling back to BVH:", err.message);
    return evaluateSceneByColorBVH(objects);
  }
}

self.addEventListener("message", async (e) => {
  const { jobId, type, payload } = e.data || {};
  try {
    let result;
    let transfers = [];
    switch (type) {
      case "set-engine": {
        // Allow the main thread to flip the preferred engine at runtime
        // without rebuilding the worker. Useful for A/B regression checks.
        if (payload?.engine === "bvh" || payload?.engine === "manifold") {
          _enginePref = payload.engine;
        }
        result = { engine: _enginePref };
        break;
      }
      case "evaluate-stats": {
        const r = await evaluateSmart(payload.objects);
        result = {
          triangleCount: r.triangleCount,
          boundaryEdges: r.boundaryEdges,
          manifold: r.manifold,
          empty: r.empty,
        };
        break;
      }
      case "combine": {
        const merged = await combineSmart(payload.a, payload.b, payload.op);
        result = merged;
        if (merged.vertices?.buffer) transfers.push(merged.vertices.buffer);
        if (merged.indices?.buffer) transfers.push(merged.indices.buffer);
        break;
      }
      case "cut-plane": {
        // Slice a single object by an infinite plane. Manifold-only —
        // the legacy main-thread `cutObjectByPlane` already exists for
        // worker-unavailable fallback paths.
        const r = await cutObjectByPlaneAsync(payload.obj, payload.plane, payload.options || {});
        result = r;
        if (r.upper?.vertices?.buffer) transfers.push(r.upper.vertices.buffer);
        if (r.upper?.indices?.buffer) transfers.push(r.upper.indices.buffer);
        if (r.lower?.vertices?.buffer) transfers.push(r.lower.vertices.buffer);
        if (r.lower?.indices?.buffer) transfers.push(r.lower.indices.buffer);
        break;
      }
      case "flatten": {
        // Evaluate a subset of objects via manifold-3d and return baked
        // mesh vertices + indices. Wraps `stl-bytes` minus the STL
        // serialisation step — the caller wants raw geometry to merge
        // into a single new imported mesh.
        const r = await evaluateSmart(payload.objects);
        if (r.empty || !r.geometry.attributes?.position) {
          throw new Error("Empty merged geometry");
        }
        const pos = r.geometry.attributes.position.array;
        const verts = pos instanceof Float32Array ? new Float32Array(pos) : Float32Array.from(pos);
        const idx = r.geometry.index ? new Uint32Array(r.geometry.index.array) : null;
        r.geometry.computeBoundingBox?.();
        const bb = r.geometry.boundingBox;
        result = {
          vertices: verts,
          indices: idx,
          bbox: bb ? {
            min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
            max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
          } : null,
          manifoldVerified: !!r.manifoldVerified,
        };
        transfers.push(verts.buffer);
        if (idx) transfers.push(idx.buffer);
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
        const r = await evaluateSmart(payload.objects);
        if (r.empty) throw new Error("Scene is empty. Add at least one positive component.");
        const bytes = geometryToSTLBytes(r.geometry);
        // Compute bbox from the merged geometry — useful for the gallery card
        // and STL preview's bed-clearance chip. Done in the worker so the
        // main thread doesn't have to re-walk the vertex buffer.
        let bbox = null;
        try {
          const g = r.geometry;
          if (g) {
            g.computeBoundingBox && g.computeBoundingBox();
            const bb = g.boundingBox;
            if (bb) {
              bbox = {
                x: +(bb.max.x - bb.min.x).toFixed(2),
                y: +(bb.max.y - bb.min.y).toFixed(2),
                z: +(bb.max.z - bb.min.z).toFixed(2),
              };
            }
          }
        } catch (_) { /* non-fatal */ }
        result = { bytes, triangleCount: r.triangleCount, manifoldVerified: !!r.manifoldVerified, bbox, droppedNegatives: r.droppedNegatives || [] };
        transfers.push(bytes.buffer);
        break;
      }
      case "threemf-bytes": {
        const visibles = (payload.objects || []).filter((o) => o.visible !== false && o.modifier !== "negative");
        const colorSet = new Set(visibles.map((o) => (o.colorIndex | 0) || 0));
        if (colorSet.size >= 2) {
          const { groups, droppedNegatives } = await evaluateByColorSmart(payload.objects);
          if (groups.length === 0) throw new Error("Scene is empty. Add at least one positive component.");
          const bytes = await build3MFBytesMulti(groups);
          result = { bytes, parts: groups.length, multicolor: true, droppedNegatives: droppedNegatives || [] };
          transfers.push(bytes.buffer);
        } else {
          const r = await evaluateSmart(payload.objects);
          if (r.empty) throw new Error("Scene is empty. Add at least one positive component.");
          const bytes = await build3MFBytes(r.geometry);
          result = { bytes, parts: 1, multicolor: false, droppedNegatives: r.droppedNegatives || [] };
          transfers.push(bytes.buffer);
        }
        break;
      }
      // Iter-151.18 — Proper Bambu/OrcaSlicer multi-plate 3MF: evaluate
      // one merged geometry per plate group and pack them all into a
      // single 3MF that carries `Metadata/model_settings.config` +
      // `Metadata/slice_info.config` describing which object lives on
      // which plate. Import into OrcaSlicer natively splits into the
      // right number of plates, no manual arrange required.
      case "threemf-multiplate-bytes": {
        const groups = payload.plateGroups || [];
        const evaluated = [];
        for (const g of groups) {
          if (!g.objects || g.objects.length === 0) continue;
          const r = await evaluateSmart(g.objects);
          if (r.empty) continue;
          evaluated.push({
            plateId: g.plateId,
            plateName: g.plateName || g.plateId,
            geometry: r.geometry,
          });
        }
        if (evaluated.length === 0) {
          throw new Error("No non-empty plates to export.");
        }
        const bytes = await build3MFBytesBambuMultiPlate(evaluated);
        result = { bytes, plates: evaluated.length };
        transfers.push(bytes.buffer);
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

// Thin frontend client for the server-side mesh repair endpoint.
// Replaces the deleted in-browser voxel-remesh attempts — those couldn't
// handle thin-shell AI/photogrammetry meshes. The real fix runs
// PyMeshFix on the backend (Marco Attene's MeshFix algorithm — also
// used inside Slic3r / PrusaSlicer for STL auto-repair).

import * as THREE from "three";
import { API } from "./api";
import { geometryToSTLBinary } from "./exporters";

/**
 * POST the binary STL bytes of an imported mesh to /api/mesh/repair
 * and resolve with the repaired binary STL bytes + stats.
 *
 *   stlBytes   Uint8Array — binary STL representation of obj.geometry.
 *
 * Returns: { bytes: Uint8Array, inputBytes, outputBytes, elapsedSec,
 *            watertight, windingConsistent }
 *
 * Wire format: raw `application/octet-stream` body. We previously used
 * multipart/form-data here, but Cloudflare's managed-WAF in front of
 * the preview ingress 403'd binary-encoded STL form parts (the form
 * blob tripped a generic "malicious payload" heuristic). Raw octet-
 * stream sidesteps the multipart inspection path while keeping the
 * exact same backend behaviour.
 */
export async function repairMeshOnServer(stlBytes) {
  const res = await fetch(`${API}/mesh/repair`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    // `stlBytes` is a Uint8Array — fetch accepts the underlying buffer
    // directly with zero copy.
    body: stlBytes,
  });

  if (!res.ok) {
    let detail;
    try {
      const j = await res.json();
      detail = j.detail || res.statusText;
    } catch {
      detail = res.statusText;
    }
    throw new Error(`Repair failed (HTTP ${res.status}): ${detail}`);
  }

  const inputBytes = Number(res.headers.get("X-Repair-Input-Bytes")) || 0;
  const outputBytes = Number(res.headers.get("X-Repair-Output-Bytes")) || 0;
  const inputTris = Number(res.headers.get("X-Repair-Input-Tris")) || 0;
  const outputTris = Number(res.headers.get("X-Repair-Output-Tris")) || 0;
  const elapsedSec = Number(res.headers.get("X-Repair-Elapsed-Seconds")) || 0;
  // PyMeshFix promises 2-manifold output, but trimesh verifies that on
  // the backend and surfaces the answer here. If `watertight=false` the
  // repair didn't fully heal the mesh — caller should warn the user.
  const watertight = res.headers.get("X-Repair-Watertight") === "true";
  const windingConsistent = res.headers.get("X-Repair-Winding-Consistent") === "true";
  const ab = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(ab),
    inputBytes,
    outputBytes,
    inputTris,
    outputTris,
    elapsedSec,
    watertight,
    windingConsistent,
  };
}

/**
 * High-level helper: takes an imported scene object (the same shape
 * stored in Zustand under `objects[]`) and returns the structural
 * update payload to merge back in via `updateObject(obj.id, …)`.
 *
 * Used by:
 *   - RightPanel.jsx → the manual "Repair Mesh" button on the
 *     Imported Inspector.
 *   - STLPreviewDialog.jsx → the "Auto-Repair Hosts & Retry" button
 *     that appears inside the yellow "BOOLEAN CUT WAS DROPPED"
 *     warning when an export fails because the host is non-manifold.
 *
 * Throws on any failure (network, HTTP, parse). Caller is responsible
 * for surfacing toasts / spinners. We keep this layer free of UI
 * concerns so it stays trivially testable.
 *
 *   obj   Imported scene object (with .geometry.vertices / .indices).
 *
 * Returns:
 *   {
 *     update: { geometry: {vertices, indices}, originalBbox: {x,y,z} },
 *     stats:  { inputTris, outputTris, elapsedSec,
 *               watertight, windingConsistent },
 *   }
 */
export async function repairImportedObject(obj) {
  if (!obj || obj.type !== "imported" || !obj.geometry) {
    throw new Error("repairImportedObject: not an imported object");
  }
  // Reconstruct a BufferGeometry from the stored vertices/indices,
  // export to binary STL, ship to the backend.
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(obj.geometry.vertices), 3),
  );
  if (obj.geometry.indices) {
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(obj.geometry.indices), 1));
  }
  g.computeVertexNormals();
  const stlDV = geometryToSTLBinary(g);
  const stlBytes = new Uint8Array(stlDV.buffer, stlDV.byteOffset, stlDV.byteLength);

  const {
    bytes: repairedStl,
    elapsedSec,
    watertight,
    windingConsistent,
    inputTris,
    outputTris,
  } = await repairMeshOnServer(stlBytes);

  // Parse the repaired binary STL → BufferGeometry → typed arrays.
  const dv = new DataView(
    repairedStl.buffer, repairedStl.byteOffset, repairedStl.byteLength,
  );
  const triCount = dv.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  let off = 84;
  for (let i = 0; i < triCount; i++) {
    off += 12;  // skip normal
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = dv.getFloat32(off, true);
      off += 4;
    }
    off += 2;   // attribute byte count
  }
  const repaired = new THREE.BufferGeometry();
  repaired.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  // Merge duplicate verts so the geometry is indexed (smaller payload).
  const { mergeVertices } = await import(
    "three/examples/jsm/utils/BufferGeometryUtils.js"
  );
  const merged = mergeVertices(repaired, 1e-4);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  const bb = merged.boundingBox;
  const newBbox = {
    x: bb.max.x - bb.min.x,
    y: bb.max.y - bb.min.y,
    z: bb.max.z - bb.min.z,
  };
  const verts = merged.attributes.position.array;
  const idx = merged.index ? merged.index.array : null;

  return {
    update: {
      geometry: {
        vertices: Array.from(verts),
        indices: idx ? Array.from(idx) : null,
      },
      originalBbox: newBbox,
    },
    stats: {
      inputTris: inputTris || (obj.geometry.indices ? obj.geometry.indices.length / 3 : obj.geometry.vertices.length / 9),
      outputTris: outputTris || (idx ? idx.length / 3 : verts.length / 9),
      elapsedSec,
      watertight,
      windingConsistent,
    },
  };
}

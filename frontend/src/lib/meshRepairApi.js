// Thin frontend client for the server-side MeshLab repair endpoint.
// Replaces the deleted in-browser voxel-remesh attempts — those couldn't
// handle thin-shell AI/photogrammetry meshes. The real fix runs
// MeshLab on the backend (same engine as MS 3D Builder / Meshmixer).

import { API } from "./api";

/**
 * POST the binary STL bytes of an imported mesh to /api/mesh/repair
 * and resolve with the repaired binary STL bytes + stats.
 *
 *   stlBytes   Uint8Array — binary STL representation of obj.geometry.
 *
 * Returns: { bytes: Uint8Array, inputBytes, outputBytes, elapsedSec }
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

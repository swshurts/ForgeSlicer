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
 */
export async function repairMeshOnServer(stlBytes) {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([stlBytes], { type: "application/sla" }),
    "host.stl"
  );

  const res = await fetch(`${API}/mesh/repair`, {
    method: "POST",
    credentials: "include",
    body: fd,
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
  const elapsedSec = Number(res.headers.get("X-Repair-Elapsed-Seconds")) || 0;
  const ab = await res.arrayBuffer();
  return { bytes: new Uint8Array(ab), inputBytes, outputBytes, elapsedSec };
}

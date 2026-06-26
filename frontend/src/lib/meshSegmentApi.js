// Frontend client for the RANSAC primitive-segmentation endpoint.
// Mirror of `meshRepairApi.js`'s wire format — raw `application/octet-stream`
// POST of binary STL bytes (Cloudflare's WAF 403s multipart binary, same
// bypass reasoning as the repair endpoint).
//
// The endpoint returns JSON describing every detected primitive
// (plane / sphere / cylinder) found via the Phase 2 detector:
//   - plane    → { normal: [x,y,z], d }
//   - sphere   → { center: [x,y,z], radius }
//   - cylinder → { center, axis, radius, height, arc_degrees }
//
// Every primitive also carries inlier_count, inlier_fraction, centroid,
// bbox. The top-level `stats.coverage` is the fraction of mesh-sample
// points that ended up in SOME primitive — < 30% is the "honest
// warning" signal that the mesh is organic / sculptural and reverse-
// engineering won't reconstruct it well.

import * as THREE from "three";
import { API } from "./api";
import { geometryToSTLBinary } from "./exporters";

/**
 * Hit /api/mesh/segment with a binary STL and return the parsed
 * JSON payload. Throws on any non-OK response so the caller can
 * surface a toast.
 *
 *   stlBytes  Uint8Array — binary STL representation.
 *   epsFrac   Optional override of the RANSAC epsilon as a fraction
 *             of the mesh bbox-diagonal (default 0.002 = 0.2%).
 *             Smaller = tighter fits, more primitives detected
 *             (also more phantom risk); larger = looser, fewer
 *             primitives. Clamped server-side to [0.0001, 0.05].
 */
export async function segmentMeshOnServer(stlBytes, { epsFrac = null } = {}) {
  const url = new URL(`${API}/mesh/segment`, window.location.origin);
  if (epsFrac != null && Number.isFinite(epsFrac)) {
    url.searchParams.set("eps_frac", String(epsFrac));
  }
  const res = await fetch(url.toString(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    body: stlBytes,
  });
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json()).detail || res.statusText;
    } catch {
      detail = res.statusText;
    }
    throw new Error(`Segmentation failed (HTTP ${res.status}): ${detail}`);
  }
  return res.json();
}

/**
 * High-level helper: pulls the binary STL out of an imported scene
 * object and hits the segmentation endpoint. Returns the same
 * response shape as `segmentMeshOnServer`, plus the input tri count
 * so the caller can show an "X% of Y triangles classified" summary.
 *
 *   obj   Imported scene object — must have .geometry.vertices and
 *         (optionally) .geometry.indices.
 */
export async function segmentImportedObject(obj, opts = {}) {
  if (!obj || obj.type !== "imported" || !obj.geometry) {
    throw new Error("segmentImportedObject: not an imported object");
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(obj.geometry.vertices), 3),
  );
  if (obj.geometry.indices) {
    g.setIndex(
      new THREE.BufferAttribute(new Uint32Array(obj.geometry.indices), 1),
    );
  }
  g.computeVertexNormals();
  const stlDV = geometryToSTLBinary(g);
  const stlBytes = new Uint8Array(stlDV.buffer, stlDV.byteOffset, stlDV.byteLength);
  const result = await segmentMeshOnServer(stlBytes, opts);
  return result;
}

/**
 * Heuristic classifier for the result's "is this a mechanical part
 * worth reverse-engineering?" question. Used by the Reverse-Engineer
 * dialog to flash an honest warning rather than silently producing
 * a useless primitive list on a sculpture.
 *
 *   coverage   Fraction of mesh sample points assigned to a primitive
 *              (0.0 - 1.0). Comes from `result.stats.coverage`.
 *
 * Returns one of: "mechanical" | "mixed" | "organic"
 *   - mechanical (≥ 80%): RANSAC found a primitive for nearly every
 *     point. The mesh almost certainly was built from primitives —
 *     ideal candidate for reverse-engineering.
 *   - mixed (30-80%): partial coverage — typical for parts with
 *     some organic / freeform regions (handles, ergonomic surfaces).
 *     User should review primitives carefully.
 *   - organic (< 30%): the mesh is overwhelmingly freeform. RANSAC
 *     cannot reconstruct it — show the honest warning.
 */
export function classifyMeshShape(coverage) {
  if (coverage >= 0.8) return "mechanical";
  if (coverage >= 0.3) return "mixed";
  return "organic";
}

// Iter-135 — Frontend client for the printability fix endpoints
// added in iter-134 (/api/printability/decimate + /add-base).
//
// Pattern mirrors meshRepairApi.js: export the imported object's
// geometry as binary STL, POST as multipart form-data, parse the
// returned STL back into a BufferGeometry, and return the update
// payload for `useScene.updateObject`.
//
// Both endpoints stream a binary STL response with X-Optimize-*
// metadata headers exposing before/after face counts and preset
// details. We surface those to the caller in `stats` so the report
// panel can render a satisfying "20 480 → 3 000 tris" toast.

import * as THREE from "three";
import { API } from "./api";
import { geometryToSTLBinary } from "./exporters";

function _objToStlBlob(obj) {
  if (!obj || !obj.geometry) throw new Error("optimize helper: object has no geometry");
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(obj.geometry.vertices), 3));
  if (obj.geometry.indices) {
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(obj.geometry.indices), 1));
  }
  g.computeVertexNormals();
  const dv = geometryToSTLBinary(g);
  return new Blob([new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)], { type: "model/stl" });
}

// Parse a binary STL byte array back into a merged, indexed THREE
// BufferGeometry. Kept local to this module because the exact
// pipeline (mergeVertices + computeVertexNormals + bbox) differs
// slightly from other STL parsers scattered in the codebase and
// we don't want mesh-optimize to accidentally inherit a subtle
// behavioural difference from a "utility" refactor.
async function _stlToGeometryUpdate(uint8) {
  const dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const triCount = dv.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  let off = 84;
  for (let i = 0; i < triCount; i++) {
    off += 12; // skip normal
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = dv.getFloat32(off, true);
      off += 4;
    }
    off += 2; // attribute byte count
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const { mergeVertices } = await import(
    "three/examples/jsm/utils/BufferGeometryUtils.js"
  );
  const merged = mergeVertices(geom, 1e-4);
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
    faces: idx ? idx.length / 3 : verts.length / 9,
  };
}

async function _postMultipart(url, formData) {
  const res = await fetch(url, { method: "POST", credentials: "include", body: formData });
  if (!res.ok) {
    let detail;
    try { detail = (await res.json()).detail || res.statusText; }
    catch { detail = res.statusText; }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  const ab = await res.arrayBuffer();
  return { bytes: new Uint8Array(ab), headers: res.headers };
}

/**
 * Run /api/printability/decimate on an imported object.
 *   obj     — the imported scene object (Zustand shape)
 *   preset  — "mini" | "functional" | "low_poly"
 *
 * Returns:
 *   { update, stats: { preset, presetLabel, facesBefore, facesAfter, reductionPct } }
 */
export async function decimateImportedObject(obj, preset = "functional") {
  const stl = _objToStlBlob(obj);
  const fd = new FormData();
  fd.append("file", stl, "input.stl");
  fd.append("preset", preset);
  fd.append("file_type", "stl");
  const { bytes, headers } = await _postMultipart(`${API}/printability/decimate`, fd);
  const parsed = await _stlToGeometryUpdate(bytes);
  return {
    update: parsed.update,
    stats: {
      preset: headers.get("X-Optimize-Preset") || preset,
      presetLabel: headers.get("X-Optimize-Preset-Label") || preset,
      facesBefore: Number(headers.get("X-Optimize-Faces-Before")) || 0,
      facesAfter: Number(headers.get("X-Optimize-Faces-After")) || parsed.faces,
      reductionPct: Number(headers.get("X-Optimize-Reduction-Pct")) || 0,
    },
  };
}

/**
 * Run /api/printability/add-base on an imported object.
 *   obj           — imported scene object
 *   shape         — "cylinder" | "rectangle" (default "cylinder")
 *   thicknessMm   — pad height in mm (default 3.0)
 *   marginMm      — outward pad around footprint (default 2.0)
 *
 * Returns:
 *   { update, stats: { shape, thicknessMm, marginMm, footprintMm2, facesBefore, facesAfter } }
 */
export async function addBaseToImportedObject(obj, { shape = "cylinder", thicknessMm = 3.0, marginMm = 2.0 } = {}) {
  const stl = _objToStlBlob(obj);
  const fd = new FormData();
  fd.append("file", stl, "input.stl");
  fd.append("shape", shape);
  fd.append("thickness_mm", String(thicknessMm));
  fd.append("margin_mm", String(marginMm));
  fd.append("file_type", "stl");
  const { bytes, headers } = await _postMultipart(`${API}/printability/add-base`, fd);
  const parsed = await _stlToGeometryUpdate(bytes);
  return {
    update: parsed.update,
    stats: {
      shape: headers.get("X-Optimize-Shape") || shape,
      thicknessMm: Number(headers.get("X-Optimize-Thickness-Mm")) || thicknessMm,
      marginMm: Number(headers.get("X-Optimize-Margin-Mm")) || marginMm,
      footprintMm2: Number(headers.get("X-Optimize-Base-Footprint-Mm2")) || 0,
      facesBefore: Number(headers.get("X-Optimize-Faces-Before")) || 0,
      facesAfter: Number(headers.get("X-Optimize-Faces-After")) || parsed.faces,
    },
  };
}

/**
 * Run /api/printability/thicken-walls on an imported object.
 *   obj                — imported scene object
 *   targetThicknessMm  — minimum wall thickness (mm) to drive thin regions up
 *                        to (default 1.2 — matches the analyzer's threshold).
 *
 * Only walls thinner than the target are displaced; the silhouette is
 * preserved. See mesh_optimize_service.thicken_walls for the algorithm.
 *
 * Returns:
 *   { update, stats: { targetThicknessMm, facesBefore, facesAfter, thinVertsFixed } }
 */
export async function thickenWallsImportedObject(obj, { targetThicknessMm = 1.2 } = {}) {
  const stl = _objToStlBlob(obj);
  const fd = new FormData();
  fd.append("file", stl, "input.stl");
  fd.append("target_thickness_mm", String(targetThicknessMm));
  fd.append("file_type", "stl");
  const { bytes, headers } = await _postMultipart(`${API}/printability/thicken-walls`, fd);
  const parsed = await _stlToGeometryUpdate(bytes);
  return {
    update: parsed.update,
    stats: {
      targetThicknessMm: Number(headers.get("X-Optimize-Target-Mm")) || targetThicknessMm,
      facesBefore: Number(headers.get("X-Optimize-Faces-Before")) || 0,
      facesAfter: Number(headers.get("X-Optimize-Faces-After")) || parsed.faces,
      thinVertsFixed: Number(headers.get("X-Optimize-Thin-Verts-Fixed")) || 0,
    },
  };
}

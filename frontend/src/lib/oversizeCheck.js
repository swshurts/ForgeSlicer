// Build-plate oversize detection.
//
// Computes the world-space bounding box of an object (rotation + scale
// applied) and compares it to the active printer's build volume on
// each axis. Returns either `null` (fits) or a structured report:
//   {
//     id, name,
//     size:  { x, y, z },                // mm in world space
//     fits:  { x: bool, y: bool, z: bool },
//     over:  { x, y, z },                // overshoot in mm (0 when fits)
//     ratios:{ x, y, z },                // size / build_axis (>=1 means too big)
//   }
//
// Only `imported` and primitive objects that have a renderable size
// are evaluated; helper guides / sketches / negatives-only items are
// excluded. Caller is responsible for filtering to the visible
// modifier=positive set when calling `reportSceneOversize`.
import { computeRotatedBBox } from "./geometry";

const EPS_MM = 0.05; // tolerate sub-tenth-mm float error before flagging

export function getObjectWorldSize(obj) {
  try {
    const bb = computeRotatedBBox(obj);
    return {
      x: bb.max.x - bb.min.x,
      y: bb.max.y - bb.min.y,
      z: bb.max.z - bb.min.z,
      min: bb.min,
      max: bb.max,
    };
  } catch {
    return null;
  }
}

export function checkOversize(obj, buildVolume) {
  if (!obj || !buildVolume) return null;
  // Skip anything that wouldn't produce a printable solid.
  if (obj.modifier === "negative") return null;
  if (obj.type === "sketch" || obj.type === "spline") return null;
  if (obj.visible === false) return null;
  const size = getObjectWorldSize(obj);
  if (!size) return null;
  // FilamentSlicer-axis mapping: X = bed.x, Z (depth) = bed.y, Y (height) = bed.z.
  // Our scene uses Y-up so the printer's "Z height" corresponds to world Y.
  const buildX = buildVolume.x || 1;
  const buildY = buildVolume.z || 1; // height
  const buildZ = buildVolume.y || 1; // depth
  const overX = Math.max(0, size.x - buildX);
  const overY = Math.max(0, size.y - buildY);
  const overZ = Math.max(0, size.z - buildZ);
  const fits =
    overX <= EPS_MM &&
    overY <= EPS_MM &&
    overZ <= EPS_MM;
  if (fits) return null;
  return {
    id: obj.id,
    name: obj.name || obj.type || "Object",
    size: { x: size.x, y: size.y, z: size.z },
    bbox: { min: size.min, max: size.max },
    build: { x: buildX, y: buildY, z: buildZ },
    fits: { x: overX <= EPS_MM, y: overY <= EPS_MM, z: overZ <= EPS_MM },
    over: { x: overX, y: overY, z: overZ },
    ratios: { x: size.x / buildX, y: size.y / buildY, z: size.z / buildZ },
  };
}

// Walk the scene's positive geometry and return every oversize report.
// Negatives/sketches are excluded — they're not what gets printed.
export function reportSceneOversize(objects, buildVolume) {
  const out = [];
  for (const o of objects || []) {
    const r = checkOversize(o, buildVolume);
    if (r) out.push(r);
  }
  return out;
}

// Convenience for the auto-subdivide algorithm: how many axis-aligned
// cuts on each axis are needed so every resulting block fits under the
// printer's bounds? Returns { x, y, z } where N cuts produce N+1 pieces.
// Always rounds up (a block 1.01× the bed gets one cut, not zero).
export function computeAutoCutGrid(report, marginMm = 0) {
  if (!report) return { x: 0, y: 0, z: 0 };
  const m = Math.max(0, marginMm);
  const need = (size, build) => {
    const usable = Math.max(1, build - m * 2);
    return Math.max(0, Math.ceil(size / usable) - 1);
  };
  return {
    x: need(report.size.x, report.build.x),
    y: need(report.size.y, report.build.y),
    z: need(report.size.z, report.build.z),
  };
}

// For a given cut count on each axis, compute the world-space planes
// (positions in mm) that divide the bbox into evenly-sized parts.
// Returns { x: [pos1, pos2, ...], y: [...], z: [...] } where each is the
// world-axis coordinate the cut plane passes through.
export function planesForGrid(report, cuts) {
  if (!report) return { x: [], y: [], z: [] };
  const axes = ["x", "y", "z"];
  const result = { x: [], y: [], z: [] };
  for (const a of axes) {
    const n = cuts[a] || 0;
    if (n <= 0) continue;
    const lo = report.bbox.min[a];
    const hi = report.bbox.max[a];
    const span = hi - lo;
    const step = span / (n + 1);
    for (let i = 1; i <= n; i++) result[a].push(lo + step * i);
  }
  return result;
}

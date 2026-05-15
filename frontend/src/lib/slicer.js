import * as THREE from "three";
import { evaluateScene } from "./csg";

/**
 * Simple FDM-style GCODE slicer.
 *
 * Coordinate mapping: three.js Y is "up" → GCODE Z. three.js (X,Z) → GCODE (X,Y).
 *
 * Strategy per layer:
 *   - intersect each triangle of the merged geometry with horizontal plane Y = z
 *   - collect resulting line segments
 *   - chain segments into closed loops (or open chains) by endpoint matching
 *   - emit G1 moves with calculated extrusion
 *
 * Output is valid Marlin-flavoured GCODE with perimeter contours only
 * (no real infill / no toolpath optimisation). It is labelled clearly in the
 * file header so the user knows this is preview-quality.
 */
export function sliceToGCODE(objects, settings, onProgress) {
  const { geometry, empty } = evaluateScene(objects);
  if (empty) throw new Error("Nothing to slice. Add at least one positive component.");

  // Pull triangles into a flat array of vec3 triplets (a,b,c)
  const tris = collectTriangles(geometry);
  if (tris.length === 0) throw new Error("Geometry has no triangles.");

  // Compute bbox in world space (geometry already baked)
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const minY = bb.min.y;
  const maxY = bb.max.y;
  if (maxY <= minY) throw new Error("Model has zero height.");

  const {
    layerHeight = 0.2,
    firstLayerHeight = 0.3,
    nozzleDiameter = 0.4,
    filamentDiameter = 1.75,
    printSpeed = 60,
    travelSpeed = 120,
    nozzleTemp = 210,
    bedTemp = 60,
  } = settings || {};

  const extrusionWidth = nozzleDiameter * 1.2;
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const ePerMM = (extrusionWidth * layerHeight) / filamentArea;
  const ePerMMFirst = (extrusionWidth * firstLayerHeight) / filamentArea;

  // Center XZ on printer bed center (assume 220x220 default if not given)
  const bedX = (settings && settings.bedX) || 220;
  const bedY = (settings && settings.bedY) || 220;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const offX = bedX / 2 - cx;
  const offY = bedY / 2 - cz;
  const groundOff = -minY; // raise so bottom sits on Z=0

  const out = [];
  const w = (s) => out.push(s);

  w(`; ForgeSlicer 1.0 - GCODE (preview quality, perimeter contours only)`);
  w(`; Generated: ${new Date().toISOString()}`);
  w(`; Layer height: ${layerHeight} mm | First layer: ${firstLayerHeight} mm`);
  w(`; Nozzle: ${nozzleDiameter} mm | Filament: ${filamentDiameter} mm`);
  w(`; Object bbox (mm): X ${(bb.max.x - bb.min.x).toFixed(2)} Y ${(bb.max.z - bb.min.z).toFixed(2)} Z ${(bb.max.y - bb.min.y).toFixed(2)}`);
  w(`M140 S${bedTemp} ; set bed temp`);
  w(`M104 S${nozzleTemp} ; set hotend temp`);
  w(`M190 S${bedTemp} ; wait bed`);
  w(`M109 S${nozzleTemp} ; wait hotend`);
  w(`G21 ; mm units`);
  w(`G90 ; absolute positioning`);
  w(`M82 ; absolute extrusion`);
  w(`G28 ; home all`);
  w(`G92 E0`);
  w(`G1 Z5 F600`);

  let currentE = 0;
  let layerIdx = 0;
  let totalSegments = 0;

  // First layer
  let y = minY + firstLayerHeight;
  const layerHeights = [firstLayerHeight];
  while (y + layerHeight <= maxY + 1e-6) {
    y += layerHeight;
    layerHeights.push(layerHeight);
  }
  const totalLayers = layerHeights.length;

  let yCursor = minY;
  for (let li = 0; li < totalLayers; li++) {
    const lh = layerHeights[li];
    yCursor += lh;
    const sliceY = yCursor - lh / 2; // slice at middle of layer
    const segs = sliceLayer(tris, sliceY);
    if (segs.length === 0) continue;
    const loops = chainSegments(segs);

    const printZ = (yCursor + groundOff).toFixed(3);
    w(`; LAYER:${li} z=${printZ}`);
    w(`G1 Z${printZ} F600`);
    w(`G1 F${(travelSpeed * 60).toFixed(0)}`);

    const ePerMMHere = li === 0 ? ePerMMFirst : ePerMM;

    for (const loop of loops) {
      if (loop.length < 2) continue;
      const p0 = loop[0];
      w(`G0 X${(p0.x + offX).toFixed(3)} Y${(p0.z + offY).toFixed(3)} F${(travelSpeed * 60).toFixed(0)}`);
      w(`G1 F${(printSpeed * 60).toFixed(0)}`);
      let prev = p0;
      for (let i = 1; i < loop.length; i++) {
        const p = loop[i];
        const dx = p.x - prev.x;
        const dz = p.z - prev.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-4) { prev = p; continue; }
        currentE += dist * ePerMMHere;
        w(`G1 X${(p.x + offX).toFixed(3)} Y${(p.z + offY).toFixed(3)} E${currentE.toFixed(5)}`);
        prev = p;
        totalSegments++;
      }
    }
    layerIdx++;
    if (onProgress && (layerIdx % 5 === 0)) onProgress(layerIdx / totalLayers);
  }

  w(`G1 Z${(yCursor + groundOff + 10).toFixed(3)} F600`);
  w(`M104 S0 ; cool hotend`);
  w(`M140 S0 ; cool bed`);
  w(`M84 ; disable motors`);
  w(`; END - layers=${layerIdx} segments=${totalSegments} filament=${currentE.toFixed(2)}mm`);

  return {
    gcode: out.join("\n"),
    stats: {
      layers: layerIdx,
      segments: totalSegments,
      filamentMM: currentE,
      bbox: { x: bb.max.x - bb.min.x, y: bb.max.z - bb.min.z, z: bb.max.y - bb.min.y },
    },
  };
}

// ---------- Triangle extraction ----------
function collectTriangles(geometry) {
  const out = [];
  const pos = geometry.attributes.position.array;
  if (geometry.index) {
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const i0 = idx[i] * 3, i1 = idx[i + 1] * 3, i2 = idx[i + 2] * 3;
      out.push([
        { x: pos[i0], y: pos[i0 + 1], z: pos[i0 + 2] },
        { x: pos[i1], y: pos[i1 + 1], z: pos[i1 + 2] },
        { x: pos[i2], y: pos[i2 + 1], z: pos[i2 + 2] },
      ]);
    }
  } else {
    for (let i = 0; i < pos.length; i += 9) {
      out.push([
        { x: pos[i], y: pos[i + 1], z: pos[i + 2] },
        { x: pos[i + 3], y: pos[i + 4], z: pos[i + 5] },
        { x: pos[i + 6], y: pos[i + 7], z: pos[i + 8] },
      ]);
    }
  }
  return out;
}

// Intersect a triangle with horizontal plane Y = sliceY → segment or null
function intersectTri(tri, sliceY) {
  const above = tri.map((v) => v.y > sliceY + 1e-7);
  const below = tri.map((v) => v.y < sliceY - 1e-7);
  if (above.every(Boolean) || below.every(Boolean)) return null;

  // Find the two edges crossing the plane
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    const sa = a.y - sliceY;
    const sb = b.y - sliceY;
    if ((sa <= 0 && sb >= 0) || (sa >= 0 && sb <= 0)) {
      if (Math.abs(sa - sb) < 1e-9) continue; // edge lies in plane
      const t = sa / (sa - sb);
      pts.push({
        x: a.x + t * (b.x - a.x),
        z: a.z + t * (b.z - a.z),
      });
      if (pts.length === 2) break;
    }
  }
  if (pts.length < 2) return null;
  if (Math.hypot(pts[0].x - pts[1].x, pts[0].z - pts[1].z) < 1e-5) return null;
  return [pts[0], pts[1]];
}

function sliceLayer(tris, sliceY) {
  const segs = [];
  for (const t of tris) {
    const seg = intersectTri(t, sliceY);
    if (seg) segs.push(seg);
  }
  return segs;
}

// Chain segments into loops by endpoint matching.
function chainSegments(segments) {
  const tol = 1e-3;
  const key = (p) => `${Math.round(p.x / tol)},${Math.round(p.z / tol)}`;
  // Build adjacency map: endpoint -> list of (segmentIdx, otherEnd)
  const adj = new Map();
  const used = new Array(segments.length).fill(false);
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const ka = key(a), kb = key(b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ i, otherKey: kb, pt: a, other: b });
    adj.get(kb).push({ i, otherKey: ka, pt: b, other: a });
  }

  const loops = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop = [segments[i][0], segments[i][1]];
    // Walk forward
    let curKey = key(segments[i][1]);
    while (true) {
      const cands = adj.get(curKey) || [];
      const next = cands.find((c) => !used[c.i]);
      if (!next) break;
      used[next.i] = true;
      // next.pt is the endpoint matching curKey, next.other is the new endpoint
      loop.push(next.other);
      curKey = next.otherKey;
      if (curKey === key(segments[i][0])) break; // closed
    }
    if (loop.length >= 2) loops.push(loop);
  }
  return loops;
}

import * as THREE from "three";
import { evaluateScene, evaluateSceneByColor } from "./csg";
import { MULTICOLOR_PALETTE } from "./presets";

/**
 * Simple FDM-style GCODE slicer.
 *
 * Coordinate mapping: three.js Y is "up" → GCODE Z. three.js (X,Z) → GCODE (X,Y).
 *
 * Per-layer strategy:
 *   - intersect each triangle of the merged geometry with the horizontal
 *     plane Y = z → collect line segments → chain into closed loops
 *   - emit perimeters by walking each loop
 *   - **solid layers** (top N + bottom N): rasterise the loops with
 *     ±45° alternating rectilinear infill (scan-line + even-odd rule)
 *     so the first/last layers of every print are fully solid and
 *     the part is actually printable
 *
 * Multi-material (AMS-aware) mode:
 *   When the scene contains 2+ distinct `colorIndex` groups, the slicer
 *   slices each color's geometry independently per layer and emits a
 *   `T<n>` tool-change + `; TOOL:n hex=#RRGGBB` marker before that
 *   group's moves. The GCODE preview dialog uses these markers to render
 *   per-extruder coloured toolpaths and a tool-change overlay.
 *
 * Output is valid Marlin-flavoured GCODE (single-tool prints) or
 * Marlin-flavoured GCODE with `T<n>` tool changes for multi-material.
 */
export function sliceToGCODE(objects, settings, onProgress) {
  // ---- Multi-material detection ----
  // If 2+ visible-positive objects span distinct colorIndex slots, we
  // hand off to the multi-material slicer which emits AMS-aware GCODE.
  const visibles = (objects || []).filter(
    (o) => o.visible !== false && o.modifier !== "negative"
  );
  const colorSet = new Set(visibles.map((o) => (o.colorIndex | 0) || 0));
  if (colorSet.size >= 2) {
    return sliceMultiMaterialToGCODE(objects, settings, onProgress);
  }

  const { geometry, empty } = evaluateScene(objects);
  if (empty) throw new Error("Nothing to slice. Add at least one positive component.");

  // iter-104.1 — Slicer math was written for a Y-up scene (it iterates
  // along world-Y as the build axis and writes GCODE Z as that Y).
  // ForgeSlicer is now Z-up internally; rotate the merged geometry
  // -90° around X so the slicer sees Y-up again (old_z → new_y).
  // The output GCODE is then in Z-up coords directly (no extra swap).
  {
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    geometry.applyMatrix4(m);
  }

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
    // Tier-(a) solid infill — # of fully-solid layers on the bottom and
    // top of the print.
    topLayers = 4,
    bottomLayers = 4,
    // Tier-(b) sparse infill — applies to MIDDLE layers (not the top or
    // bottom solid bands). 0% = perimeter-only (legacy), 100% = solid.
    // Patterns: "rectilinear" (alternating ±45° lines), "grid" (rectilinear
    // crossed twice per layer → square grid), "gyroid" (sinusoidal
    // gyroid sampled per-layer → strong & isotropic, looks like
    // OrcaSlicer/PrusaSlicer's gyroid).
    infillPercent = 15,
    infillPattern = "rectilinear",
    // Tier-(c) gradient/transition layers — N layers immediately above
    // the bottom solid band AND immediately below the top solid band
    // get a BOOSTED density to bridge sparse → solid smoothly. Without
    // this, sparse infill at low density (e.g. 10%) sags into the next
    // solid layer because there's not enough material to bridge across.
    // The boosted density is the midpoint between user-set sparse % and
    // 100% (e.g., 15% sparse → 57% transition). Set to 0 to disable.
    transitionLayers = 2,
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

  w(`; ForgeSlicer 1.0 - GCODE (perimeters + ${bottomLayers} bottom / ${topLayers} top solid layers + ${infillPercent}% ${infillPattern} sparse infill)`);
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

    // ---------- Solid infill on bottom / top layers ----------
    // The bottom N layers (li < bottomLayers) and the top N layers
    // (li >= totalLayers - topLayers) get rectilinear 100% solid infill
    // so the surface is closed instead of an empty perimeter cage.
    // Direction alternates ±45° per layer to bond cross-layer fibers.
    const isBottomSolid = li < bottomLayers;
    const isTopSolid = li >= totalLayers - topLayers;
    if (isBottomSolid || isTopSolid) {
      const angleDeg = li % 2 === 0 ? 45 : -45;
      // Step the scan lines one extrusion-width apart so neighbours just
      // touch (true 100% solid). Inset by half an extrusion-width to keep
      // infill bonded to but inside the perimeter wall.
      const fillSpacing = extrusionWidth;
      const insetAmount = extrusionWidth / 2;
      const fills = generateSolidFill(loops, sliceY, angleDeg, fillSpacing, insetAmount);
      if (fills.length > 0) {
        // Travel between fills happens implicitly via G0 — extrusion only
        // along the fill line itself.
        for (const seg of fills) {
          const a = seg[0], b = seg[1];
          w(`G0 X${(a.x + offX).toFixed(3)} Y${(a.z + offY).toFixed(3)} F${(travelSpeed * 60).toFixed(0)}`);
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1e-4) continue;
          currentE += dist * ePerMMHere;
          w(`G1 F${(printSpeed * 60).toFixed(0)} X${(b.x + offX).toFixed(3)} Y${(b.z + offY).toFixed(3)} E${currentE.toFixed(5)}`);
          totalSegments++;
        }
      }
    } else if (infillPercent > 0) {
      // ---------- Sparse infill (Tier b) on middle layers ----------
      // Sparse infill spacing relates inversely to density. At 100%
      // density the spacing equals the extrusion width (= solid). At 25%
      // density each line is 4× the extrusion width apart, etc. We clamp
      // density at [1, 100] before computing to avoid divide-by-zero and
      // absurdly wide spacing.
      //
      // Tier-(c) hybrid: layers right above the bottom solid band and
      // right below the top solid band get a BOOSTED density (midpoint
      // between user % and 100%) so the next solid layer has something
      // to bridge across instead of sagging. Without this, sparse infill
      // at <20% commonly leaves visible droops in the first solid layer.
      const inTransitionBottom = transitionLayers > 0 &&
        li >= bottomLayers && li < bottomLayers + transitionLayers;
      const inTransitionTop = transitionLayers > 0 &&
        li >= totalLayers - topLayers - transitionLayers && li < totalLayers - topLayers;
      const isTransition = inTransitionBottom || inTransitionTop;
      const rawPct = isTransition
        ? Math.min(100, infillPercent + (100 - infillPercent) / 2)
        : infillPercent;
      const pct = Math.min(100, Math.max(1, rawPct));
      const sparseSpacing = (extrusionWidth * 100) / pct;
      const insetAmount = extrusionWidth / 2;
      let sparse = [];
      if (infillPattern === "grid") {
        // Two perpendicular line sweeps per layer → square grid.
        const a1 = generateSolidFill(loops, sliceY, 45, sparseSpacing, insetAmount);
        const a2 = generateSolidFill(loops, sliceY, -45, sparseSpacing, insetAmount);
        sparse = a1.concat(a2);
      } else if (infillPattern === "gyroid") {
        // Per-layer 2D approximation of a 3D gyroid surface, sampled at
        // the current Z. Equation: sin(x)cos(y) + sin(y)cos(z) +
        // sin(z)cos(x) = 0. Walking each scan line we find sign changes
        // and emit segments inside the polygon.
        sparse = generateGyroidFill(loops, sliceY, sparseSpacing, insetAmount);
      } else {
        // Default rectilinear — alternate ±45° per layer for stiffness.
        const angleDeg = li % 2 === 0 ? 45 : -45;
        sparse = generateSolidFill(loops, sliceY, angleDeg, sparseSpacing, insetAmount);
      }
      for (const seg of sparse) {
        const a = seg[0], b = seg[1];
        w(`G0 X${(a.x + offX).toFixed(3)} Y${(a.z + offY).toFixed(3)} F${(travelSpeed * 60).toFixed(0)}`);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-4) continue;
        currentE += dist * ePerMMHere;
        w(`G1 F${(printSpeed * 60).toFixed(0)} X${(b.x + offX).toFixed(3)} Y${(b.z + offY).toFixed(3)} E${currentE.toFixed(5)}`);
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

// ---------- Solid infill ----------
//
// Generate rectilinear scan-line fills that cover the interior of all
// closed loops at this layer. Algorithm:
//   1. Rotate every loop point by `-angleDeg` so scan lines become
//      horizontal (parallel to X) in the rotated frame.
//   2. For each scan-line y = y0, y0+step, ..., compute the
//      intersections with every loop edge → x-values.
//   3. Sort x-values; alternate pairs (even-odd rule) are inside the
//      polygon → emit a segment between them.
//   4. Rotate the resulting segment endpoints back into world XZ.
//
// `inset` shrinks each scan-line segment by half an extrusion-width on
// each end so the fill line stays bonded to but inside the perimeter.
// Returns world-space segments as [[{x,z},{x,z}], ...].
function generateSolidFill(loops, sliceY, angleDeg, spacing, inset) {
  if (!loops || loops.length === 0 || spacing <= 0) return [];
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(-a), sin = Math.sin(-a);
  const ucos = Math.cos(a), usin = Math.sin(a);

  // Rotate to scan-aligned frame and gather edges.
  const edges = [];
  let yMin = Infinity, yMax = -Infinity;
  for (const loop of loops) {
    if (loop.length < 2) continue;
    const rot = loop.map((p) => ({
      x: p.x * cos - p.z * sin,
      y: p.x * sin + p.z * cos,
    }));
    // Force-close each loop so the polygon test sees a continuous edge
    // list. chainSegments may return an open polyline if the slice grazed
    // the silhouette — we close it so the inside test still works.
    if (
      Math.hypot(rot[0].x - rot[rot.length - 1].x, rot[0].y - rot[rot.length - 1].y)
      > 1e-4
    ) {
      rot.push(rot[0]);
    }
    for (let i = 0; i < rot.length - 1; i++) {
      const p1 = rot[i], p2 = rot[i + 1];
      const ey1 = Math.min(p1.y, p2.y);
      const ey2 = Math.max(p1.y, p2.y);
      if (Math.abs(p1.y - p2.y) < 1e-7) continue; // skip horizontal — never crossed by horizontal scan
      edges.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, ymin: ey1, ymax: ey2 });
      if (ey1 < yMin) yMin = ey1;
      if (ey2 > yMax) yMax = ey2;
    }
  }
  if (edges.length === 0 || !isFinite(yMin) || !isFinite(yMax)) return [];

  // Start half a spacing inside the bbox so we don't emit zero-length
  // grazing fills at the extreme edges.
  const start = yMin + spacing * 0.5;
  const fills = [];
  for (let y = start; y <= yMax - spacing * 0.5 + 1e-9; y += spacing) {
    const xs = [];
    for (const e of edges) {
      // Strict-on-one-end inequality so a scan line that exactly grazes
      // a shared vertex isn't counted twice.
      if ((e.y1 <= y && e.y2 > y) || (e.y2 <= y && e.y1 > y)) {
        const t = (y - e.y1) / (e.y2 - e.y1);
        xs.push(e.x1 + t * (e.x2 - e.x1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      let xa = xs[i], xb = xs[i + 1];
      if (xb - xa < 2 * inset + 1e-4) continue; // too thin to bother
      xa += inset;
      xb -= inset;
      // Rotate the two endpoints back into world XZ.
      const aWorld = { x: xa * ucos - y * usin, z: xa * usin + y * ucos };
      const bWorld = { x: xb * ucos - y * usin, z: xb * usin + y * ucos };
      fills.push([aWorld, bWorld]);
    }
  }
  // void-use sliceY here so future enhancements can use the layer Z for
  // anti-grazing tweaks without ESLint complaining now.
  void sliceY;
  return fills;
}


// ---------- Gyroid sparse infill ----------
//
// Approximates the 3D gyroid implicit surface
//   sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0
// at the current layer Z by walking dense horizontal scan lines and
// flipping on/off whenever the signed implicit value crosses zero.
// Result: alternating short segments per row that look like the wavy
// gyroid pattern when stacked across layers. Spacing controls density —
// larger spacing = sparser pattern.
//
// `loops` are world-space closed polygons (one per island at this layer).
// We use the SAME polygon-inside test as `generateSolidFill` so the
// gyroid never crosses the perimeter wall.
function generateGyroidFill(loops, sliceY, spacing, inset) {
  if (!loops || loops.length === 0 || spacing <= 0) return [];

  // Collect edges (axis-aligned scan along world X within polygon).
  const edges = [];
  let yMin = Infinity, yMax = -Infinity;
  for (const loop of loops) {
    if (loop.length < 2) continue;
    const pts = loop.map((p) => ({ x: p.x, y: p.z }));
    if (Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) > 1e-4) {
      pts.push(pts[0]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      if (Math.abs(p1.y - p2.y) < 1e-7) continue;
      edges.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      yMin = Math.min(yMin, p1.y, p2.y);
      yMax = Math.max(yMax, p1.y, p2.y);
    }
  }
  if (!isFinite(yMin)) return [];

  // Frequency: gyroids look natural at ~spacing-period. We pick `k` so
  // one full wavelength matches the sparse-line spacing — keeps density
  // visually consistent across % settings.
  const k = (2 * Math.PI) / (spacing * 2);
  const z = sliceY * k;
  const sinZ = Math.sin(z);
  const cosZ = Math.cos(z);
  // We sample along X at a fine resolution to find sign changes of the
  // gyroid implicit. Resolution = spacing/8 gives ~smooth output without
  // exploding segment count.
  const dx = Math.max(0.25, spacing / 8);

  const fills = [];
  // Walk scan lines spaced by half the line-spacing so the gyroid
  // pattern has the right density across both X and Y axes.
  const yStep = spacing * 0.5;
  for (let y = yMin + yStep * 0.5; y < yMax; y += yStep) {
    // Compute inside-polygon X intervals for this scan line via even-odd.
    const xCross = [];
    for (const e of edges) {
      if ((e.y1 <= y && e.y2 > y) || (e.y2 <= y && e.y1 > y)) {
        const t = (y - e.y1) / (e.y2 - e.y1);
        xCross.push(e.x1 + t * (e.x2 - e.x1));
      }
    }
    if (xCross.length < 2) continue;
    xCross.sort((u, v) => u - v);

    const sinY = Math.sin(y * k);
    const cosY = Math.cos(y * k);

    // Process polygon X-intervals one at a time.
    for (let i = 0; i + 1 < xCross.length; i += 2) {
      const xStart = xCross[i] + inset;
      const xEnd = xCross[i + 1] - inset;
      if (xEnd - xStart < dx) continue;
      // Walk x from xStart to xEnd, tracking sign of the gyroid implicit.
      // Emit segments where sign stays the same — these are the "ridges"
      // of the gyroid. Sample sparsely; alternate ridges per scan line.
      let prevSign = null;
      let segStart = null;
      let extruding = false;
      for (let xx = xStart; xx <= xEnd; xx += dx) {
        const v = Math.sin(xx * k) * cosY + sinY * cosZ + sinZ * Math.cos(xx * k);
        const sign = v > 0;
        if (prevSign === null) {
          prevSign = sign;
          // Start extruding on positive lobes only — gives an alternating
          // dotted pattern that prints reliably without overlap.
          if (sign) { segStart = xx; extruding = true; }
        } else if (sign !== prevSign) {
          if (extruding && segStart !== null) {
            fills.push([{ x: segStart, z: y }, { x: xx, z: y }]);
          }
          extruding = sign; // next ridge starts only on positive side
          segStart = sign ? xx : null;
          prevSign = sign;
        }
      }
      if (extruding && segStart !== null && (xEnd - segStart) > dx) {
        fills.push([{ x: segStart, z: y }, { x: xEnd, z: y }]);
      }
    }
  }
  return fills;
}



// ---------- Multi-material (AMS-aware) slicer ----------
//
// Slices each colorIndex group's merged geometry separately per layer
// and emits per-tool perimeter + infill blocks bracketed by `T<n>`
// tool-change commands and a `; TOOL:n hex=#RRGGBB name=<name>` marker
// so the GCODE preview can render per-extruder paint colours.
//
// Approach mirrors the single-material path — same scan-line infill,
// same solid/sparse/transition tier logic — but applied per-color
// instead of to the merged scene. Negatives are carved per-color via
// `evaluateSceneByColor` already, so each group's loops describe only
// the volume that should be deposited in that material.
//
// Header includes `; AMS_TABLE T0=#RRGGBB ...` so the preview can show
// the palette legend even if the user never opens a colored layer.
function sliceMultiMaterialToGCODE(objects, settings, onProgress) {
  const { groups } = evaluateSceneByColor(objects);
  if (!groups || groups.length === 0) {
    throw new Error("Nothing to slice. Add at least one positive component.");
  }

  // iter-104.1 — Slicer math was written for a Y-up scene. Rotate
  // each group's geometry -90° around X so the slicer sees Y-up
  // (old_z → new_y). See sliceToGCODE for the rationale.
  const _zToYRot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  for (const g of groups) {
    g.geometry.applyMatrix4(_zToYRot);
  }

  // Per-color triangle lists + a combined bbox so layer count is driven
  // by the tallest part across every tool.
  const perColor = [];
  const combinedBox = new THREE.Box3();
  combinedBox.makeEmpty();
  for (const g of groups) {
    const tris = collectTriangles(g.geometry);
    if (tris.length === 0) continue;
    g.geometry.computeBoundingBox();
    const bb = g.geometry.boundingBox;
    combinedBox.union(bb);
    perColor.push({ colorIndex: g.colorIndex, tris, bbox: bb });
  }
  if (perColor.length === 0) throw new Error("Geometry has no triangles.");
  const minY = combinedBox.min.y;
  const maxY = combinedBox.max.y;
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
    topLayers = 4,
    bottomLayers = 4,
    infillPercent = 15,
    infillPattern = "rectilinear",
    transitionLayers = 2,
  } = settings || {};

  const extrusionWidth = nozzleDiameter * 1.2;
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;
  const ePerMM = (extrusionWidth * layerHeight) / filamentArea;
  const ePerMMFirst = (extrusionWidth * firstLayerHeight) / filamentArea;

  const bedX = (settings && settings.bedX) || 220;
  const bedY = (settings && settings.bedY) || 220;
  const cx = (combinedBox.min.x + combinedBox.max.x) / 2;
  const cz = (combinedBox.min.z + combinedBox.max.z) / 2;
  const offX = bedX / 2 - cx;
  const offY = bedY / 2 - cz;
  const groundOff = -minY;

  const out = [];
  const w = (s) => out.push(s);

  // AMS color table — one tool index per color in the same order the
  // preview legend will display.
  const amsTable = perColor.map((p) => {
    const c = MULTICOLOR_PALETTE[p.colorIndex] || MULTICOLOR_PALETTE[0];
    return `T${p.colorIndex}=${c.hex}`;
  }).join(" ");

  w(`; ForgeSlicer 1.0 - GCODE (multi-material, ${perColor.length} extruders)`);
  w(`; AMS_TABLE ${amsTable}`);
  w(`; Generated: ${new Date().toISOString()}`);
  w(`; Layer height: ${layerHeight} mm | First layer: ${firstLayerHeight} mm`);
  w(`; Nozzle: ${nozzleDiameter} mm | Filament: ${filamentDiameter} mm`);
  w(`; Object bbox (mm): X ${(combinedBox.max.x - combinedBox.min.x).toFixed(2)} Y ${(combinedBox.max.z - combinedBox.min.z).toFixed(2)} Z ${(combinedBox.max.y - combinedBox.min.y).toFixed(2)}`);
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
  // Pre-select the first tool so previewers always know which extruder is active.
  w(`T${perColor[0].colorIndex} ; AMS slot ${perColor[0].colorIndex}`);

  let currentE = 0;
  let activeTool = perColor[0].colorIndex;
  let segmentsTotal = 0;
  let layerIdx = 0;

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
    const sliceY = yCursor - lh / 2;
    const printZ = (yCursor + groundOff).toFixed(3);
    const ePerMMHere = li === 0 ? ePerMMFirst : ePerMM;
    let layerHeaderEmitted = false;

    for (const colorGroup of perColor) {
      // Only emit a slice for color groups that span this Z.
      if (sliceY < colorGroup.bbox.min.y - 1e-6 || sliceY > colorGroup.bbox.max.y + 1e-6) {
        continue;
      }
      const segs = sliceLayer(colorGroup.tris, sliceY);
      if (segs.length === 0) continue;
      const loops = chainSegments(segs);
      if (loops.length === 0) continue;

      if (!layerHeaderEmitted) {
        w(`; LAYER:${li} z=${printZ}`);
        w(`G1 Z${printZ} F600`);
        layerHeaderEmitted = true;
      }

      // Tool change if this color is not currently active.
      if (colorGroup.colorIndex !== activeTool) {
        const c = MULTICOLOR_PALETTE[colorGroup.colorIndex] || MULTICOLOR_PALETTE[0];
        w(`; TOOL:${colorGroup.colorIndex} hex=${c.hex} name=${c.name}`);
        w(`T${colorGroup.colorIndex} ; tool change → ${c.name}`);
        activeTool = colorGroup.colorIndex;
      } else {
        // Still emit the comment so the preview can attribute moves
        // unambiguously (a layer may start with the existing tool but
        // still contains moves that belong to it).
        const c = MULTICOLOR_PALETTE[colorGroup.colorIndex] || MULTICOLOR_PALETTE[0];
        w(`; TOOL:${colorGroup.colorIndex} hex=${c.hex} name=${c.name}`);
      }
      w(`G1 F${(travelSpeed * 60).toFixed(0)}`);

      // Perimeters
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
          segmentsTotal++;
        }
      }

      // Infill (solid bands + sparse + transition), same rules as single-tool.
      const isBottomSolid = li < bottomLayers;
      const isTopSolid = li >= totalLayers - topLayers;
      if (isBottomSolid || isTopSolid) {
        const angleDeg = li % 2 === 0 ? 45 : -45;
        const fills = generateSolidFill(loops, sliceY, angleDeg, extrusionWidth, extrusionWidth / 2);
        currentE = emitFills(w, fills, offX, offY, currentE, ePerMMHere, printSpeed, travelSpeed);
        segmentsTotal += fills.length;
      } else if (infillPercent > 0) {
        const inTransitionBottom = transitionLayers > 0 &&
          li >= bottomLayers && li < bottomLayers + transitionLayers;
        const inTransitionTop = transitionLayers > 0 &&
          li >= totalLayers - topLayers - transitionLayers && li < totalLayers - topLayers;
        const isTransition = inTransitionBottom || inTransitionTop;
        const rawPct = isTransition
          ? Math.min(100, infillPercent + (100 - infillPercent) / 2)
          : infillPercent;
        const pct = Math.min(100, Math.max(1, rawPct));
        const sparseSpacing = (extrusionWidth * 100) / pct;
        const insetAmount = extrusionWidth / 2;
        let sparse = [];
        if (infillPattern === "grid") {
          const a1 = generateSolidFill(loops, sliceY, 45, sparseSpacing, insetAmount);
          const a2 = generateSolidFill(loops, sliceY, -45, sparseSpacing, insetAmount);
          sparse = a1.concat(a2);
        } else if (infillPattern === "gyroid") {
          sparse = generateGyroidFill(loops, sliceY, sparseSpacing, insetAmount);
        } else {
          const angleDeg = li % 2 === 0 ? 45 : -45;
          sparse = generateSolidFill(loops, sliceY, angleDeg, sparseSpacing, insetAmount);
        }
        currentE = emitFills(w, sparse, offX, offY, currentE, ePerMMHere, printSpeed, travelSpeed);
        segmentsTotal += sparse.length;
      }
    }
    layerIdx++;
    if (onProgress && (layerIdx % 5 === 0)) onProgress(layerIdx / totalLayers);
  }

  w(`G1 Z${(yCursor + groundOff + 10).toFixed(3)} F600`);
  w(`M104 S0 ; cool hotend`);
  w(`M140 S0 ; cool bed`);
  w(`M84 ; disable motors`);
  w(`; END - layers=${layerIdx} segments=${segmentsTotal} filament=${currentE.toFixed(2)}mm tools=${perColor.length}`);

  return {
    gcode: out.join("\n"),
    stats: {
      layers: layerIdx,
      segments: segmentsTotal,
      filamentMM: currentE,
      bbox: {
        x: combinedBox.max.x - combinedBox.min.x,
        y: combinedBox.max.z - combinedBox.min.z,
        z: combinedBox.max.y - combinedBox.min.y,
      },
      tools: perColor.map((p) => p.colorIndex),
    },
  };
}

// Emit a list of [{x,z},{x,z}] segments as G0-travel + G1-extrude pairs.
// Returns the new currentE so the caller can chain calls.
function emitFills(w, fills, offX, offY, currentE, ePerMMHere, printSpeed, travelSpeed) {
  for (const seg of fills) {
    const a = seg[0], b = seg[1];
    w(`G0 X${(a.x + offX).toFixed(3)} Y${(a.z + offY).toFixed(3)} F${(travelSpeed * 60).toFixed(0)}`);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) continue;
    currentE += dist * ePerMMHere;
    w(`G1 F${(printSpeed * 60).toFixed(0)} X${(b.x + offX).toFixed(3)} Y${(b.z + offY).toFixed(3)} E${currentE.toFixed(5)}`);
  }
  return currentE;
}

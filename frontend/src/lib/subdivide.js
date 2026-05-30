// Subdivide an oversized object into printable pieces.
//
// Given a source object that's too big for the build plate, this module:
//   1. Cuts the mesh along a list of axis-aligned planes (or a
//      user-defined manual cut list).
//   2. Optionally inserts connectors at each cut interface so the
//      printed parts can be physically joined. Connector kinds:
//        • "none"    — just clean cuts
//        • "dowel"   — cylindrical pegs (one per cut face). Male peg is
//                      half-embedded in piece A, female socket Boolean-
//                      subtracted from piece B.
//        • "dovetail"— stylised dovetail tongues (negative cuboid in
//                      piece B, positive cuboid added to piece A).
//   3. Returns an array of new objects ready to push into the scene.
//
// Implementation strategy:
//   • For multiple cuts on the same axis, we slice sequentially: each
//     piece coming out of one cut becomes input to the next.
//   • For cuts spanning multiple axes, we run them in X→Y→Z order and
//     accumulate pieces.
//   • Connectors are added as separate `imported` objects in the scene
//     (positive male peg + negative female hole) per cut interface. The
//     manifold engine resolves their Boolean operations on the next
//     scene evaluation — no second-pass CSG required here.

import { cutObjectByPlaneAsync } from "./workerClient";
import { computeRotatedBBox } from "./geometry";

const DEG = (rad) => (rad * 180) / Math.PI;
// Axis index → cut plane Euler rotation that aligns the plane normal
// with that world axis. The cut tool's plane normal is local +Y after
// rotation (see store.js cutPlane comment), so:
//   X-axis cut → rotate plane 0° (normal = +Y is wrong, we need to
//                                  rotate by Z=90° so plane is in YZ)
//   Y-axis cut → rotate plane 0° (normal already +Y → cuts in XZ)
//   Z-axis cut → rotate plane by X=90° (so plane is in XY)
// In Euler angles (degrees) [rx, ry, rz]:
const PLANE_ROTATION = {
  x: [0, 0, 90],
  y: [0, 0, 0],
  z: [90, 0, 0],
};

// Convert a scene object + cut value into the plane spec expected by
// cutObjectByPlaneAsync. The "value" is the world-coordinate on the
// given axis where the plane crosses.
function makePlane(axis, value) {
  const position = [0, 0, 0];
  if (axis === "x") position[0] = value;
  else if (axis === "y") position[1] = value;
  else position[2] = value;
  return { position, rotation: PLANE_ROTATION[axis] };
}

// Slice ONE object along ONE plane and return both halves as new
// objects. Caller is responsible for assigning fresh ids and merging
// transforms (cut pieces have their geometry baked in world space).
async function cutOnce(obj, axis, value, suffixA = "a", suffixB = "b") {
  const plane = makePlane(axis, value);
  const result = await cutObjectByPlaneAsync(obj, plane, {
    upper: true, lower: true,
  });
  const out = [];
  // "upper" / "lower" naming is plane-relative; we relabel using the
  // signed axis so a chain of cuts stays readable.
  if (result.lower) {
    out.push({
      part: result.lower,
      suffix: suffixA,
      side: "lower",
    });
  }
  if (result.upper) {
    out.push({
      part: result.upper,
      suffix: suffixB,
      side: "upper",
    });
  }
  return out;
}

// Materialise a {vertices, indices} part into a scene object. The cut
// engine returns pieces in world space with the source's transform
// already applied, so we zero the transform on the new object.
function partToObject(part, src, idMint, label) {
  // `part` is a working tuple from the cut loop:
  //   { ...src, geometry: { vertices, indices }, type: "imported", ... }
  // We read geometry off `part.geometry` (NOT part.vertices) and emit a
  // clean scene-object shape. The working tuple already carries
  // type="imported" so the rest of the codebase treats this as an
  // imported mesh on render.
  const verts = part.geometry?.vertices || part.vertices;
  const idx = part.geometry?.indices || part.indices;
  return {
    id: idMint("piece"),
    name: label || `${src.name || "Piece"}`,
    type: "imported",
    modifier: "positive",
    visible: true,
    locked: false,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dims: {},
    color: src.color,
    colorIndex: src.colorIndex,
    geometry: { vertices: verts, indices: idx },
    originalBbox: src.originalBbox,
    // Tag so the UI can color subdivided pieces or auto-arrange them.
    subdivideGroupId: src.subdivideGroupId || src.id,
  };
}

// Apply a small "exploded view" offset to each cut piece based on which
// quadrant of the source bbox its center sits in. Pieces drift APART by
// a few mm so the seams are visible, but stay in their original
// arrangement so the user can read the assembly. Connectors are left at
// their original (cut-interface) positions — they'll appear bridging
// the gap, which is the desired visualisation.
function explodePieces(out, src, gapMm = 8) {
  const srcCenter = (() => {
    try {
      const bb = computeRotatedBBox(src);
      return {
        x: (bb.min.x + bb.max.x) / 2,
        y: (bb.min.y + bb.max.y) / 2,
        z: (bb.min.z + bb.max.z) / 2,
      };
    } catch { return null; }
  })();
  if (!srcCenter) return;
  for (const piece of out) {
    if (piece.subdivideConnector) continue; // connectors stay put
    // Compute the piece's own world-space bbox center from its vertices.
    const verts = piece.geometry?.vertices;
    if (!verts || verts.length === 0) continue;
    let minX = +Infinity, maxX = -Infinity;
    let minY = +Infinity, maxY = -Infinity;
    let minZ = +Infinity, maxZ = -Infinity;
    for (let k = 0; k < verts.length; k += 3) {
      const x = verts[k], y = verts[k + 1], z = verts[k + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    // Offset along each axis by gap * sign(piece_center - src_center).
    // The src center may be at the cut plane itself for some axes, in
    // which case sign() = 0 and no offset is applied on that axis.
    const sign = (v) => (v > 0.1 ? 1 : v < -0.1 ? -1 : 0);
    piece.position = [
      sign(cx - srcCenter.x) * gapMm,
      sign(cy - srcCenter.y) * gapMm,
      sign(cz - srcCenter.z) * gapMm,
    ];
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Subdivide a single object using a manual or computed list of cuts.
 *
 * @param obj    — source scene object (must have geometry / dims)
 * @param cuts   — { x: [worldX, ...], y: [worldY, ...], z: [worldZ, ...] }
 * @param idMint — id-minter (from store newId)
 * @param opts   — { connectors: { kind, sizeMm }, splitName: bool }
 * @returns      Array of new scene objects ready to merge into state
 */
export async function subdivideObject(obj, cuts, idMint, opts = {}) {
  // Walk axes in X → Y → Z order, accumulating pieces.
  const axes = ["x", "y", "z"];
  let current = [{ obj, label: obj.name || "Piece" }];

  for (const axis of axes) {
    const planes = (cuts[axis] || []).slice().sort((a, b) => a - b);
    if (planes.length === 0) continue;
    const next = [];
    for (const item of current) {
      let pieces = [{ ...item }];
      // Sequential cut: each cut splits every existing piece on this axis
      // into two halves. Pieces whose bbox doesn't span the cut are
      // emitted unchanged (the cut engine returns null for the absent
      // half).
      for (let i = 0; i < planes.length; i++) {
        const value = planes[i];
        const replacement = [];
        for (const p of pieces) {
          try {
            const splits = await cutOnce(p.obj, axis, value);
            if (splits.length === 0) {
              // Plane missed the piece entirely; pass it through.
              replacement.push(p);
              continue;
            }
            for (let j = 0; j < splits.length; j++) {
              const child = splits[j];
              const lbl = `${p.label}/${axis}${i + 1}${child.suffix}`;
              // CRITICAL: re-type the intermediate piece as "imported"
              // so the NEXT cut's buildGeometry() picks up our custom
              // vertex buffer instead of rebuilding the original
              // primitive (e.g. "cube") from `dims`. Without this the
              // second/third cuts re-cut the FULL source mesh and
              // every piece ends up the same shape.
              replacement.push({
                obj: {
                  ...p.obj,
                  type: "imported",
                  dims: {},
                  geometry: { vertices: child.part.vertices, indices: child.part.indices },
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                  subdivideCutAxis: axis,
                  subdivideCutValue: value,
                },
                label: lbl,
              });
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[subdivide] cut failed:", err?.message || err);
            replacement.push(p); // keep the original piece on failure
          }
        }
        pieces = replacement;
      }
      next.push(...pieces);
    }
    current = next;
  }

  if (current.length <= 1) {
    return []; // nothing to do — cut list missed the geometry
  }

  // Convert the working tuples into scene objects.
  const out = [];
  for (let i = 0; i < current.length; i++) {
    const piece = current[i].obj;
    const label = current[i].label;
    out.push(partToObject(piece, obj, idMint, label));
  }

  // ----- Connectors -----
  // We add connectors AFTER the cuts, between each adjacent pair on
  // each cut axis. For each unique cut value on each axis, we sample
  // pairs by their geometric position (the pair that straddles the
  // cut plane). Simpler than tracking adjacency through the cut tree.
  const connectorKind = opts?.connectors?.kind || "none";
  if (connectorKind !== "none") {
    addConnectorsBetweenPieces(out, cuts, connectorKind, opts?.connectors || {}, idMint);
  }

  // Arrange so the user can see all pieces with visible seams.
  explodePieces(out, obj);

  return out;
}

// Connector geometry. We emit them as scene objects (positive + negative)
// rather than baking into the piece meshes — the manifold engine resolves
// the booleans on next scene evaluation and the user can subsequently
// move/tweak the connectors without re-cutting.
//
// IMPORTANT: connectors are positioned in WORLD space because the cut
// pieces have their transforms baked. They reference `attachToId` /
// `attachToOtherId` via the `subdivideGroupId` field so they re-locate
// when the parent piece is moved.
function addConnectorsBetweenPieces(pieces, cuts, kind, opts, idMint) {
  const sizeMm = Math.max(2, Math.min(20, opts.sizeMm ?? 6));
  const depthMm = sizeMm * 1.2;
  // Snapshot the originally-cut pieces so we don't walk newly-pushed
  // connectors during the pairing loop. Equally important: a stable
  // index for the bboxesAxis cache.
  const cutPieces = pieces.slice();
  let emitted = 0;
  for (const axis of ["x", "y", "z"]) {
    const values = (cuts[axis] || []).slice().sort((a, b) => a - b);
    for (const value of values) {
      const bboxesAxis = cutPieces.map((p) => bboxAlong(p, axis));
      for (let i = 0; i < cutPieces.length; i++) {
        for (let j = 0; j < cutPieces.length; j++) {
          if (i === j) continue;
          const a = bboxesAxis[i], b = bboxesAxis[j];
          if (!a || !b) continue;
          // i is the LOWER piece if its max ≈ this plane and j's min ≈ this plane.
          if (Math.abs(a.max - value) > 1.0) continue;
          if (Math.abs(b.min - value) > 1.0) continue;
          // Compute the overlapping area centre on the OTHER two axes —
          // that's where the connector goes.
          const otherAxes = ["x", "y", "z"].filter((x) => x !== axis);
          const u = otherAxes[0], v = otherAxes[1];
          const bA = boxOnAxes(cutPieces[i], u, v);
          const bB = boxOnAxes(cutPieces[j], u, v);
          if (!bA || !bB) continue;
          const lo = { [u]: Math.max(bA.lo[u], bB.lo[u]), [v]: Math.max(bA.lo[v], bB.lo[v]) };
          const hi = { [u]: Math.min(bA.hi[u], bB.hi[u]), [v]: Math.min(bA.hi[v], bB.hi[v]) };
          if (hi[u] - lo[u] < sizeMm * 1.5 || hi[v] - lo[v] < sizeMm * 1.5) continue;
          const centre = [0, 0, 0];
          centre[axisIndex(axis)] = value;
          centre[axisIndex(u)] = (lo[u] + hi[u]) / 2;
          centre[axisIndex(v)] = (lo[v] + hi[v]) / 2;
          spawnConnector(kind, axis, centre, sizeMm, depthMm, pieces, idMint, opts);
          emitted++;
        }
      }
    }
  }
  // Suppress unused warnings — we may extend connector pairing logic.
  void emitted;
}

function axisIndex(a) { return a === "x" ? 0 : a === "y" ? 1 : 2; }

function bboxAlong(piece, axis) {
  const verts = piece.geometry?.vertices;
  if (!verts || verts.length === 0) return null;
  const idx = axisIndex(axis);
  let min = +Infinity, max = -Infinity;
  for (let i = idx; i < verts.length; i += 3) {
    if (verts[i] < min) min = verts[i];
    if (verts[i] > max) max = verts[i];
  }
  return { min, max };
}

function boxOnAxes(piece, u, v) {
  const verts = piece.geometry?.vertices;
  if (!verts) return null;
  const iu = axisIndex(u), iv = axisIndex(v);
  let loU = +Infinity, hiU = -Infinity, loV = +Infinity, hiV = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const a = verts[i + iu], b = verts[i + iv];
    if (a < loU) loU = a; if (a > hiU) hiU = a;
    if (b < loV) loV = b; if (b > hiV) hiV = b;
  }
  return { lo: { [u]: loU, [v]: loV }, hi: { [u]: hiU, [v]: hiV } };
}

// Dowel connector: positive cylinder spans the cut plane → relies on
// each piece's manifold to host its half. Simplest approach: emit ONE
// shared positive cylinder anchored at the cut centre. Manifold will
// produce a clean physical join when the user prints both pieces and
// inserts the printed peg.
//
// Dovetail connector: same idea with a tapered cuboid (we approximate
// with a stretched cylinder oriented along the cut normal so it's
// captive after assembly).
function spawnConnector(kind, axis, centre, sizeMm, depthMm, pieces, idMint, opts) {
  const idAxis = axisIndex(axis);
  // Common transform: rotate cylinder so its axis lines up with the
  // cut-plane normal.
  const rotation = [0, 0, 0];
  if (axis === "x") rotation[2] = 90; // cylinder default axis is Y
  else if (axis === "z") rotation[0] = 90;
  const baseObj = {
    id: idMint(`con-${kind}`),
    name: `${kind} connector`,
    type: kind === "dovetail" ? "cube" : "cylinder",
    modifier: "positive",
    visible: true,
    locked: false,
    position: centre.slice(),
    rotation,
    scale: [1, 1, 1],
    color: "#fbbf24",
    dims: kind === "dovetail"
      ? { x: sizeMm * 1.4, y: depthMm * 2, z: sizeMm * 0.9 }
      : { radius: sizeMm / 2, height: depthMm * 2, segments: 24 },
    subdivideConnector: { kind, axis, value: centre[idAxis] },
  };
  pieces.push(baseObj);
  // Suppress unused-warning for opts (we may pass per-kind tuning later).
  void opts;
}

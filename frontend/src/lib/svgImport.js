// SVG → sketch-extrusion importer.
//
// Lets users drop in any flat SVG (logo, cookie-cutter outline, signage
// glyph) and drop it onto the build plate as one or more extruded
// scene objects. Uses three.js's SVGLoader to parse the SVG into
// THREE.Shape instances, then walks each shape's outline at a fixed
// resolution and hands the resulting polygon points to the existing
// `addSketch` store action. That means every SVG-imported object
// inherits the same editing/CSG/slicing/export pipeline as Sketch-mode
// drawings — no parallel codepath.
//
// Sizing strategy:
//   - Compute the overall bounding box of the SVG in its native units.
//   - Scale isotropically so the LONGEST edge equals `targetMaxMM`
//     (default 80mm). Users can re-scale per-object after import.
//   - Y is flipped because SVG's Y axis points down while our build plate
//     uses screen-up Y. Without this, every imported glyph would be
//     mirrored.
//   - Center the assembly around (0, 0) so the import lands at the bed
//     origin and the user can move it from there.
//
// Background-fill detection:
//   Many logo exporters (Inkscape "save as plain SVG", Figma, Illustrator
//   web-export) emit a giant rectangle that fills the canvas as path #1,
//   which would otherwise import as one flat slab covering the actual
//   artwork. We discard any path whose bbox covers >=95% of the SVG
//   viewBox area — those are virtually never something the user wants
//   extruded.
//
// Holes (letter interiors):
//   SVGLoader.createShapes returns THREE.Shape instances which expose
//   `.holes` (Path[]). The outer outline is the positive contour; each
//   hole is the negative carve-out. For a logo with letters like "O" or
//   "A", the hole points are the interior counter. We emit the hole as
//   its own sketch entry tagged `isHole: true` so the import dialog can
//   stamp it with the OPPOSITE modifier of the outer shape — making the
//   final extruded assembly a proper letter form instead of a solid
//   filled blob.

import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const DEFAULT_TARGET_MAX_MM = 80;
const POLYLINE_SAMPLES = 64; // per-curve sampling; enough for smooth fonts.
const BACKGROUND_AREA_FRACTION = 0.95;

/**
 * Parse an SVG file (passed in as text), produce one polygon per shape,
 * normalised to plate coordinates and a sensible default size.
 *
 * Returns `{ shapes, bbox, scaleFactor, droppedBackground }` where
 * `shapes` is
 *   [{ points: [[x, z], ...], isHole: bool }, ...]
 * suitable for handing directly to addSketch(). `isHole` flags interior
 * cutouts (letter counters etc.) — the importer dialog flips the
 * modifier for those so they carve the parent shape instead of being
 * laid on top.
 *
 * Throws if the SVG has no extractable geometry — that case is shown to
 * the user as a friendly "Couldn't find any closed shapes" message in
 * the import dialog, NOT a stack trace.
 */
export function parseSVGToShapes(svgText, options = {}) {
  const { targetMaxMM = DEFAULT_TARGET_MAX_MM } = options;
  const loader = new SVGLoader();
  const data = loader.parse(svgText);

  // First pass — compute the SVG viewBox area so we can identify and
  // skip background-fill rectangles. We re-walk paths after so the
  // bbox here is approximate (we'll redo it below over the surviving
  // shapes for the final scale).
  let rawMinX = Infinity, rawMaxX = -Infinity, rawMinY = Infinity, rawMaxY = -Infinity;
  for (const path of data.paths) {
    const pathShapes = SVGLoader.createShapes(path);
    for (const shape of pathShapes) {
      const pts = shape.getPoints(POLYLINE_SAMPLES);
      for (const p of pts) {
        if (p.x < rawMinX) rawMinX = p.x; if (p.x > rawMaxX) rawMaxX = p.x;
        if (p.y < rawMinY) rawMinY = p.y; if (p.y > rawMaxY) rawMaxY = p.y;
      }
    }
  }
  const totalArea = (rawMaxX - rawMinX) * (rawMaxY - rawMinY);

  // Helper — compute the axis-aligned bbox area of a polyline.
  const polyArea = (pts) => {
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    for (const p of pts) {
      if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x;
      if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y;
    }
    return (mxX - mnX) * (mxY - mnY);
  };

  // Second pass — collect surviving outline + hole polylines, drop
  // backgrounds. We tag each polyline with `isHole` so the importer
  // can flip the modifier for interior cutouts.
  const collected = [];
  let droppedBackground = 0;
  for (const path of data.paths) {
    const pathShapes = SVGLoader.createShapes(path);
    for (const shape of pathShapes) {
      const outerPts = shape.getPoints(POLYLINE_SAMPLES);
      if (outerPts.length < 3) continue;
      // Drop if this shape's bbox covers ≥95% of the SVG viewBox area —
      // it's almost certainly a background fill rectangle.
      if (totalArea > 0 && polyArea(outerPts) / totalArea >= BACKGROUND_AREA_FRACTION) {
        droppedBackground++;
        continue;
      }
      collected.push({ points: outerPts, isHole: false });
      // Holes — interior cutouts. SVGLoader.Path exposes the hole as a
      // sub-path of the outer shape. We sample its outline the same way
      // so the importer can stamp it as a negative sibling.
      const holes = shape.holes || [];
      for (const hole of holes) {
        const holePts = hole.getPoints(POLYLINE_SAMPLES);
        if (holePts.length >= 3) {
          collected.push({ points: holePts, isHole: true });
        }
      }
    }
  }
  if (collected.length === 0) {
    throw new Error("SVG has no usable closed paths — try saving with fills enabled.");
  }

  // Final bbox over surviving polylines so the isotropic scale matches
  // what the user will actually see on the plate.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const part of collected) {
    for (const p of part.points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  }
  const w = maxX - minX, h = maxY - minY;
  if (w <= 0 || h <= 0) throw new Error("SVG paths have zero area.");
  const scaleFactor = targetMaxMM / Math.max(w, h);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  // Transform each polyline to plate coords: center the assembly, flip Y,
  // scale to mm. Drop near-duplicate consecutive vertices the loader
  // sometimes emits on cubic-curve segments (otherwise the seam-weld in
  // manifold-3d can collapse the polygon into a degenerate triangle).
  const out = collected.map((part) => ({
    points: part.points
      .map((p) => [(p.x - cx) * scaleFactor, -(p.y - cy) * scaleFactor])
      .filter((pt, i, arr) => {
        if (i === 0) return true;
        const [px, py] = arr[i - 1];
        return Math.hypot(pt[0] - px, pt[1] - py) > 0.01;
      }),
    isHole: part.isHole,
  })).filter((p) => p.points.length >= 3);

  return {
    shapes: out,
    bbox: { width: w * scaleFactor, height: h * scaleFactor },
    scaleFactor,
    droppedBackground,
  };
}

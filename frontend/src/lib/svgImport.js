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

import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const DEFAULT_TARGET_MAX_MM = 80;
const POLYLINE_SAMPLES = 64; // per-curve sampling; enough for smooth fonts.

/**
 * Parse an SVG file (passed in as text), produce one polygon per shape,
 * normalised to plate coordinates and a sensible default size.
 *
 * Returns `{ shapes, bbox, scaleFactor }` where `shapes` is
 *   [{ points: [[x, z], ...] }, ...]
 * suitable for handing directly to addSketch().
 *
 * Throws if the SVG has no extractable geometry — that case is shown to
 * the user as a friendly "Couldn't find any closed shapes" message in
 * the import dialog, NOT a stack trace.
 */
export function parseSVGToShapes(svgText, options = {}) {
  const { targetMaxMM = DEFAULT_TARGET_MAX_MM } = options;
  const loader = new SVGLoader();
  const data = loader.parse(svgText);

  // Each "path" can carry multiple subpaths; SVGLoader.createShapes()
  // returns the appropriate THREE.Shape list per path. We aggregate
  // them all into a flat shape array.
  const shapes = [];
  for (const path of data.paths) {
    const pathShapes = SVGLoader.createShapes(path);
    for (const shape of pathShapes) shapes.push(shape);
  }
  if (shapes.length === 0) {
    throw new Error("SVG has no closed paths — try saving with fills enabled.");
  }

  // Sample each shape's outline to a polyline.
  const polylines = shapes.map((shape) => {
    const pts = shape.getPoints(POLYLINE_SAMPLES);
    // Force-close the loop if the last point doesn't match the first.
    if (pts.length > 2) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.001) pts.push(a.clone());
    }
    return pts;
  });

  // Compute bbox across ALL polylines so isotropic scale stays
  // consistent and shapes preserve relative size.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const line of polylines) {
    for (const p of line) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  }
  const w = maxX - minX, h = maxY - minY;
  if (w <= 0 || h <= 0) throw new Error("SVG paths have zero area.");
  // Scale so the longest dimension becomes targetMaxMM.
  const scaleFactor = targetMaxMM / Math.max(w, h);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  // Transform each polyline to plate coords: center the assembly, flip Y
  // (SVG Y points down → plate Y points "back"), scale to mm.
  const out = polylines.map((line) => ({
    points: line
      .map((p) => [(p.x - cx) * scaleFactor, -(p.y - cy) * scaleFactor])
      // Drop near-duplicate consecutive points the loader sometimes emits
      // on cubic-curve segments. Without this, manifold-3d's seam weld
      // can collapse the polygon into a degenerate triangle.
      .filter((pt, i, arr) => {
        if (i === 0) return true;
        const [px, py] = arr[i - 1];
        return Math.hypot(pt[0] - px, pt[1] - py) > 0.01;
      }),
  })).filter((p) => p.points.length >= 3);

  return {
    shapes: out,
    bbox: { width: w * scaleFactor, height: h * scaleFactor },
    scaleFactor,
  };
}

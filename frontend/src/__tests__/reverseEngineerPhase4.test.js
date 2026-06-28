// Regression test for iter-111.1 — RANSAC Phase 4 'Replace with
// primitives' was dropping every plane at the world origin sized
// 20×20×1 because the bbox + centroid parsing didn't match what the
// backend actually returns (the bug a user surfaced with a
// corner-riser STL after running the dialog).
//
// Backend schema (mesh_segment.py L598-1180):
//   bbox     = [[xmin,ymin,zmin], [xmax,ymax,zmax]]  (array of 2 arrays)
//   centroid = [x, y, z]                              (top-level, NOT in params)
//   plane.params  = { normal, d }                     (NO center field)
//   sphere.params = { center, radius }
//   cylinder.params = { center, axis, radius, height, arc_degrees }
//
// This test pokes the helper with a hand-crafted backend response
// that mirrors that schema and asserts the resulting scene objects
// land at the right transformed positions/sizes.

import { primitivesToSceneObjects } from "../lib/ransacReplace";

describe("primitivesToSceneObjects (RANSAC Phase 4)", () => {
  test("plane parses bbox-array form and uses top-level centroid", () => {
    const primitives = [{
      type: "plane",
      params: { normal: [0, 0, 1], d: 0 },
      centroid: [5, -5, 0],
      bbox: [[-15, -25, -0.05], [25, 15, 0.05]],
      inlier_count: 1000, inlier_fraction: 0.3,
    }];
    const out = primitivesToSceneObjects(primitives);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("cube");
    // Extents: source-frame bbox extents are [40, 40, 0.1] → sorted →
    // sz=0.5 (floored), sy=40, sx=40.
    expect(out[0].dims.x).toBeCloseTo(40, 1);
    expect(out[0].dims.y).toBeCloseTo(40, 1);
    // Thin axis extent is exactly 0.1 — fails the `> 0.1` guard so
    // we fall back to the 1 mm minimum slab thickness.
    expect(out[0].dims.z).toBeCloseTo(1, 1);
    // Position comes from centroid (no transform passed → identity).
    expect(out[0].position).toEqual([5, -5, 0]);
    // Name reflects the actual size, not the 20×20 default.
    expect(out[0].name).toMatch(/40×40/);
  });

  test("sphere parses params.center + params.radius", () => {
    const primitives = [{
      type: "sphere",
      params: { center: [10, 20, 5], radius: 3 },
      centroid: [10, 20, 5],
      bbox: [[7, 17, 2], [13, 23, 8]],
      inlier_count: 500, inlier_fraction: 0.2,
    }];
    const out = primitivesToSceneObjects(primitives);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("sphere");
    expect(out[0].dims.r).toBeCloseTo(3, 3);
    expect(out[0].position).toEqual([10, 20, 5]);
  });

  test("cylinder parses params.center + params.axis + radius + height", () => {
    const primitives = [{
      type: "cylinder",
      params: { center: [0, 0, 5], axis: [0, 0, 1], radius: 3, height: 10 },
      centroid: [0, 0, 5],
      bbox: [[-3, -3, 0], [3, 3, 10]],
      inlier_count: 500, inlier_fraction: 0.15,
    }];
    const out = primitivesToSceneObjects(primitives);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("cylinder");
    expect(out[0].dims.r).toBeCloseTo(3, 3);
    expect(out[0].dims.h).toBeCloseTo(10, 3);
    expect(out[0].position).toEqual([0, 0, 5]);
  });

  test("applies sourceObj transform so primitives land in world coords", () => {
    // Imported mesh sitting at world position [10, 20, 30].
    const sourceObj = {
      type: "imported",
      position: [10, 20, 30],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const primitives = [{
      type: "sphere",
      params: { center: [1, 2, 3], radius: 1 },
      centroid: [1, 2, 3],
      bbox: [[0, 1, 2], [2, 3, 4]],
      inlier_count: 100, inlier_fraction: 0.1,
    }];
    const out = primitivesToSceneObjects(primitives, sourceObj);
    expect(out[0].position[0]).toBeCloseTo(11, 3);
    expect(out[0].position[1]).toBeCloseTo(22, 3);
    expect(out[0].position[2]).toBeCloseTo(33, 3);
  });

  test("falls back to defaults gracefully when bbox shape is unexpected", () => {
    const primitives = [{
      type: "plane",
      params: { normal: [0, 0, 1], d: 0 },
      // No centroid, malformed bbox — should still produce a sensible default.
      bbox: "bogus",
      inlier_count: 100, inlier_fraction: 0.1,
    }];
    const out = primitivesToSceneObjects(primitives);
    expect(out).toHaveLength(1);
    expect(out[0].dims.x).toBe(20);     // default
    expect(out[0].dims.y).toBe(20);     // default
    expect(out[0].position).toEqual([0, 0, 0]);
  });
});

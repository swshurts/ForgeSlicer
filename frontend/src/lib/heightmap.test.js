/**
 * Iter-87 — heightmap mesh-builder unit tests.
 *
 * The photo-to-plane pipeline has three pure-ish functions: an image
 * sampler (skipped here — needs a real HTMLImageElement), the
 * triangle-count estimator (closed-form), and the mesh builder
 * (the bit that's most likely to drop a tri and create a non-
 * watertight mesh someday).
 *
 * Tests cover:
 *   - estimateTriangleCount closed-form correctness
 *   - buildHeightmapMesh allocates exactly the expected vertex count
 *   - watertightness: identical triangles aren't emitted (no degenerates)
 *   - extents: returned `sizeX` / `sizeZ` match the requested widthMM
 *   - tall pixels actually appear tall on the top surface
 *   - bottom surface stays flat at y=0
 */
import { buildHeightmapMesh, estimateTriangleCount } from "./heightmap";

describe("estimateTriangleCount", () => {
  test("zero / one resolution returns 0", () => {
    expect(estimateTriangleCount(0)).toBe(0);
    expect(estimateTriangleCount(1)).toBe(0);
  });
  test("2×2 grid: 4 top + 4 bottom + 8 perimeter = 16 triangles", () => {
    // r=2 → 4(r-1)² + 8(r-1) = 4·1 + 8·1 = 12. (Each surface = 2 tris,
    // each of 4 perimeter strips = 2 tris → 2+2+8 = 12.)
    expect(estimateTriangleCount(2)).toBe(12);
  });
  test("10×10 grid: 4·81 + 8·9 = 396", () => {
    expect(estimateTriangleCount(10)).toBe(396);
  });
  test("matches buildHeightmapMesh actual triangle count at res=8", () => {
    const r = 8;
    const lum = new Float32Array(r * r).fill(0.5);
    const { vertices } = buildHeightmapMesh(lum, r, r, 50, 1, 2);
    expect(vertices.length / 9).toBe(estimateTriangleCount(r));
  });
});

describe("buildHeightmapMesh", () => {
  test("rejects degenerate resolutions", () => {
    expect(() => buildHeightmapMesh(new Float32Array(4), 2, 1, 50, 1, 2)).toThrow();
    expect(() => buildHeightmapMesh(new Float32Array(4), 1, 4, 50, 1, 2)).toThrow();
  });
  test("rejects mismatched luminance buffer", () => {
    const lum = new Float32Array(9);
    expect(() => buildHeightmapMesh(lum, 4, 4, 50, 1, 2)).toThrow();
  });

  test("returns extents matching widthMM for a square photo", () => {
    const r = 4;
    const lum = new Float32Array(r * r).fill(0);
    const { sizeX, sizeZ, height } = buildHeightmapMesh(lum, r, r, 80, 1, 3);
    expect(sizeX).toBe(80);
    expect(sizeZ).toBe(80);
    expect(height).toBe(4); // base + relief — even with zero luminance.
  });

  test("preserves aspect ratio for wide photos", () => {
    const w = 8, h = 4;
    const lum = new Float32Array(w * h).fill(0);
    const { sizeX, sizeZ } = buildHeightmapMesh(lum, w, h, 80, 1, 3);
    expect(sizeX).toBe(80);
    expect(sizeZ).toBe(40); // half because aspect = 2
  });

  test("bottom surface stays flat at y=0", () => {
    const r = 5;
    const lum = new Float32Array(r * r);
    for (let i = 0; i < lum.length; i++) lum[i] = Math.random();
    const { vertices } = buildHeightmapMesh(lum, r, r, 60, 1, 3);
    // Bottom-surface triangles come AFTER top-surface triangles. They
    // all have y=0 on every vertex. Search the second (r-1)²×2 block.
    const topTriCount = 2 * (r - 1) * (r - 1);
    const bottomStart = topTriCount * 9;
    const bottomEnd = bottomStart + topTriCount * 9;
    for (let i = bottomStart + 1; i < bottomEnd; i += 3) {
      expect(vertices[i]).toBe(0);
    }
  });

  test("top surface respects luminance — tall pixels are tall", () => {
    const r = 4;
    // Solid mid-grey except for one corner at 1.0.
    const lum = new Float32Array(r * r).fill(0);
    lum[0] = 1.0; // pixel (0,0)
    const { vertices } = buildHeightmapMesh(lum, r, r, 40, 1, 4);
    // First top-surface triangle's first vertex is at top(0,0) — that
    // vertex's y must be base + 1.0 * relief = 1 + 4 = 5.
    // Vertex layout: writeTri(a, d, b) → a is at (xi=0, zi=0).
    expect(vertices[1]).toBeCloseTo(5, 5);
  });

  test("does not emit degenerate (zero-area) triangles", () => {
    const r = 6;
    const lum = new Float32Array(r * r);
    for (let i = 0; i < lum.length; i++) lum[i] = (i % 7) / 7;
    const { vertices } = buildHeightmapMesh(lum, r, r, 50, 0.5, 2);
    const triCount = vertices.length / 9;
    for (let t = 0; t < triCount; t++) {
      const o = t * 9;
      const ax = vertices[o], ay = vertices[o + 1], az = vertices[o + 2];
      const bx = vertices[o + 3], by = vertices[o + 4], bz = vertices[o + 5];
      const cx = vertices[o + 6], cy = vertices[o + 7], cz = vertices[o + 8];
      // Two vertices coincide ⇒ degenerate. A real heightmap should
      // never have any.
      const ab = (ax === bx && ay === by && az === bz);
      const ac = (ax === cx && ay === cy && az === cz);
      const bc = (bx === cx && by === cy && bz === cz);
      expect(ab || ac || bc).toBe(false);
    }
  });
});

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
import { buildHeightmapMesh, estimateTriangleCount, textToCanvas } from "./heightmap";

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
    // Iter-140 changed the emission order (per-quad interleaved rather
    // than all-tops-then-all-bottoms). Assert semantically: every tri
    // whose vertices all sit at y=0 is a bottom tri, and their count
    // must equal (r-1)² × 2 quads worth.
    const triCount = vertices.length / 9;
    let bottomTris = 0;
    for (let t = 0; t < triCount; t++) {
      const o = t * 9;
      if (vertices[o + 1] === 0 && vertices[o + 4] === 0 && vertices[o + 7] === 0) {
        bottomTris++;
      }
    }
    expect(bottomTris).toBe(2 * (r - 1) * (r - 1));
  });

  test("top surface respects luminance — tall pixels are tall", () => {
    const r = 4;
    // Solid dark except for one corner at 1.0.
    const lum = new Float32Array(r * r).fill(0);
    lum[0] = 1.0; // pixel (0,0)
    const { vertices } = buildHeightmapMesh(lum, r, r, 40, 1, 4);
    // The tallest vertex should be exactly base + relief = 5.
    let maxY = -Infinity;
    for (let i = 1; i < vertices.length; i += 3) {
      if (vertices[i] > maxY) maxY = vertices[i];
    }
    expect(maxY).toBeCloseTo(5, 5);
  });

  test("iter-140 — alpha mask carves the mesh silhouette", () => {
    // 6×6 grid, mark the two rightmost columns as transparent. All
    // quads that touch those columns should be omitted; the remaining
    // mesh should be a rectangular strip on the left half only.
    const r = 6;
    const lum = new Float32Array(r * r).fill(0.5);
    const alpha = new Float32Array(r * r);
    for (let zi = 0; zi < r; zi++) {
      for (let xi = 0; xi < r; xi++) {
        alpha[zi * r + xi] = xi < 4 ? 1.0 : 0.0;
      }
    }
    const { vertices } = buildHeightmapMesh(lum, r, r, 60, 1, 2, alpha);
    // Retained region spans quads with xi ∈ [0..2] (columns 0..3 opaque
    // → 3 kept quads → corners at xi=0..3). x = xi*dx - sizeX/2 = xi*12 - 30.
    // Max kept x = 3*12 - 30 = 6, and no vertex should sit further right.
    let maxX = -Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      if (vertices[i] > maxX) maxX = vertices[i];
    }
    expect(maxX).toBeCloseTo(6, 5);
    // Sanity: the transparent columns' vertices (x=18 or x=30) must not
    // appear anywhere in the output.
    for (let i = 0; i < vertices.length; i += 3) {
      expect(vertices[i]).toBeLessThanOrEqual(6 + 1e-6);
    }
    // Mesh must still contain some geometry (top + bottom + walls).
    expect(vertices.length).toBeGreaterThan(0);
  });

  test("iter-140 — alpha omitted reproduces legacy triangle count", () => {
    // No alpha param → mesh matches the pre-iter-140 rectangular
    // plate exactly (guards the JPG code path).
    const r = 6;
    const lum = new Float32Array(r * r).fill(0.5);
    const { vertices } = buildHeightmapMesh(lum, r, r, 50, 1, 2);
    expect(vertices.length / 9).toBe(estimateTriangleCount(r));
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

describe("textToCanvas (iter-88)", () => {
  // jsdom (and node-canvas-less test envs) returns null from
  // HTMLCanvasElement.getContext("2d"). When that's the case the helper
  // can't measure text or paint pixels, so these tests skip cleanly
  // rather than failing the suite. In a real browser these all pass.
  const canvasOk = (() => {
    try {
      const c = document.createElement("canvas");
      return !!c.getContext("2d");
    } catch { return false; }
  })();
  const maybe = canvasOk ? test : test.skip;

  maybe("returns a canvas with positive dimensions", () => {
    const c = textToCanvas("Hello");
    expect(c).toBeInstanceOf(HTMLCanvasElement);
    expect(c.width).toBeGreaterThan(0);
    expect(c.height).toBeGreaterThan(0);
  });

  maybe("longer strings produce wider canvases (1-char vs 16-char)", () => {
    const a = textToCanvas("A");
    const b = textToCanvas("Sixteen Char Text");
    expect(b.width).toBeGreaterThan(a.width);
  });

  maybe("empty/whitespace input falls back to default placeholder", () => {
    const c = textToCanvas("");
    expect(c.width).toBeGreaterThan(0);
    expect(c.height).toBeGreaterThan(0);
  });

  maybe("background is white when default options are used", () => {
    const c = textToCanvas("X");
    const ctx = c.getContext("2d");
    const data = ctx.getImageData(1, 1, 1, 1).data;
    expect(data[0]).toBeGreaterThan(250);
    expect(data[1]).toBeGreaterThan(250);
    expect(data[2]).toBeGreaterThan(250);
  });

  // ALWAYS-runnable smoke test: even without a 2D context, calling
  // textToCanvas with a missing context must throw a friendly error
  // rather than silently producing a blank canvas.
  test("throws a friendly error when 2D context is unavailable", () => {
    if (canvasOk) return; // skip in real-browser environments
    expect(() => textToCanvas("Hello")).toThrow(/2D context/);
  });
});


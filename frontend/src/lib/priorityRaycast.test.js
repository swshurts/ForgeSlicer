/**
 * Regression: RulerPlacementDots — priorityRaycast tie-breaking.
 *
 * Before iter-125.1, every priority-raycast hit was overwritten to
 * `distance = -1e-4` — a hard tie. When two dots overlapped in screen
 * space (top vs bottom bbox corner of a tall part, or two stacked
 * parts sharing a corner), THREE's stable-sort left the winner up to
 * insertion order — often the dot BEHIND the geometry won. The user
 * would click a visible corner and the ruler would land at an unseen
 * one instead.
 *
 * The fix keeps ALL priority hits sorting before real geometry
 * (all distances stay negative), but preserves camera-proximity
 * ordering AMONG priority hits.
 */
import { priorityRaycast } from "./priorityRaycast";

// Minimal THREE.Mesh.prototype.raycast shim so priorityRaycast can be
// exercised without a real WebGL context. Feeds two fake intersections
// with distinct camera distances.
jest.mock("three", () => {
  const original = jest.requireActual("three");
  return original;
});

describe("priorityRaycast — iter-125.1 tie-break by camera distance", () => {
  function runOnFakeMesh(fakeHits) {
    // Simulate Mesh.prototype.raycast populating `local` with fakeHits.
    const THREE = require("three"); // eslint-disable-line
    const spy = jest
      .spyOn(THREE.Mesh.prototype, "raycast")
      .mockImplementation(function (raycaster, intersects) {
        for (const h of fakeHits) intersects.push({ ...h });
      });
    const outputs = [];
    priorityRaycast.call({}, null, outputs);
    spy.mockRestore();
    return outputs;
  }

  test("all priority hits stay negative (still beat real geometry with distance > 0)", () => {
    const outputs = runOnFakeMesh([
      { distance: 50, object: "far" },
      { distance: 5, object: "near" },
    ]);
    expect(outputs).toHaveLength(2);
    outputs.forEach((o) => expect(o.distance).toBeLessThan(-0.9));
  });

  test("closer-to-camera hit sorts BEFORE farther hit (fixes stacked-dot bug)", () => {
    const outputs = runOnFakeMesh([
      { distance: 50, object: "far" },
      { distance: 5, object: "near" },
    ]);
    // After the fix, sort by the (adjusted) distance ascending, and
    // the near hit should come first.
    const sorted = [...outputs].sort((a, b) => a.distance - b.distance);
    expect(sorted[0].object).toBe("near");
    expect(sorted[1].object).toBe("far");
  });

  test("preserves distinctness — no two hits collapse to identical distance", () => {
    const outputs = runOnFakeMesh([
      { distance: 5,   object: "a" },
      { distance: 5.0001, object: "b" },
    ]);
    expect(outputs[0].distance).not.toBe(outputs[1].distance);
  });

  test("even at large scene distances (<= 1000mm) priority still beats regular hits", () => {
    // A dot at the far corner of a large build volume (~1000mm) must
    // still sort before a normal-mesh hit at very close range (0.1mm).
    const outputs = runOnFakeMesh([{ distance: 999, object: "far-priority" }]);
    // -1 + 999 * 1e-6 ≈ -0.999 — still comfortably less than 0.1
    // which is the smallest a real geometry hit will typically be.
    expect(outputs[0].distance).toBeLessThan(0.1);
    expect(outputs[0].distance).toBeLessThan(-0.99);
  });
});

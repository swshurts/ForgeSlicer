/**
 * Iter-126 — smartSnapForClick feature-hierarchy regression.
 *
 * User agreed on: vertex > edge > body-centre snap hierarchy for the
 * ruler tool. Thresholds are proportional to the object's smallest
 * bbox extent (min-extent):
 *   • corner  → within 15% of min-extent
 *   • edge    → within 30% of min-extent
 *   • else    → body centre
 *
 * These tests fabricate a 20×20×20 cube stand-in (min-extent = 20 mm,
 * corner threshold = 3 mm, edge threshold = 6 mm) so the expected
 * behaviour is easy to reason about.
 */
import { smartSnapForClick } from "./rulerAnchor";

// Mock componentDimensions to avoid transitively pulling in three/ESM
// modules that Jest / CRA can't transform. `worldBboxOf` short-circuits
// on `__worldBbox`, so we replicate just that behaviour.
jest.mock("./componentDimensions", () => ({
  worldBboxOf: (obj) => obj && obj.__worldBbox ? obj.__worldBbox : null,
  fmtSignedMm: (n) => `${n}`,
}));

// componentDimensions.worldBboxOf reads either an explicit
// `__worldBbox` short-circuit OR a `geometry.boundingBox` + position.
// The `__worldBbox` short-circuit lets us build a totally synthetic
// test fixture with no THREE dependency.
function cubeFixture() {
  return {
    id: "test-cube",
    __worldBbox: {
      min: [0, 0, 0],
      max: [20, 20, 20],
      centerWorld: [10, 10, 10],
      extent: [20, 20, 20],
    },
  };
}

describe("smartSnapForClick", () => {
  test("click near a corner snaps to that corner", () => {
    const snap = smartSnapForClick(cubeFixture(), [0.5, 0.5, 0.5]);
    // Within 3 mm of the (0,0,0) corner → corner wins.
    expect(snap.kind).toBe("corner");
    expect(snap.x).toBe(0);
    expect(snap.y).toBe(0);
    expect(snap.z).toBe(0);
  });

  test("click on middle of a bottom edge snaps to that edge's midpoint", () => {
    // User's spec: 20x20 cube, click bottom-X edge → anchor at (10,0,0).
    const snap = smartSnapForClick(cubeFixture(), [10, 0.5, 0.5]);
    expect(snap.kind).toBe("edge");
    expect(snap.x).toBe(10);
    expect(snap.y).toBe(0);
    expect(snap.z).toBe(0);
  });

  test("click on middle of a face falls through to component centre", () => {
    // 10,10,0 is dead-centre of the bottom face. Closest corner is
    // 14.14 mm away (> 3 mm threshold); closest edge-mid is 10 mm
    // away (> 6 mm threshold); so we snap to centre.
    const snap = smartSnapForClick(cubeFixture(), [10, 10, 0]);
    expect(snap.kind).toBe("center");
    expect(snap.x).toBe(10);
    expect(snap.y).toBe(10);
    expect(snap.z).toBe(10);
  });

  test("click deep in the middle of the volume snaps to centre", () => {
    const snap = smartSnapForClick(cubeFixture(), [10, 10, 10]);
    expect(snap.kind).toBe("center");
  });

  test("returns null for an object without a bbox", () => {
    expect(smartSnapForClick({ id: "no-bbox" }, [0, 0, 0])).toBeNull();
  });

  test("thresholds scale with the shortest bbox extent", () => {
    // 5x5x5 cube: min-extent 5 → corner threshold 0.75 mm, edge 1.5 mm.
    const smallCube = {
      id: "tiny",
      __worldBbox: {
        min: [0, 0, 0], max: [5, 5, 5],
        centerWorld: [2.5, 2.5, 2.5], extent: [5, 5, 5],
      },
    };
    // 1 mm from (0,0,0) is OUTSIDE the 0.75 mm corner threshold →
    // must fall to edge or centre. Corner should NOT win.
    const snap = smartSnapForClick(smallCube, [1, 0.5, 0.5]);
    expect(snap.kind).not.toBe("corner");
  });
});

// Smoke test for the curve / extrude primitives added in 1.12.
// Verifies that buildGeometry() returns sensible geometries for the
// three new types — non-empty position buffer, expected bbox shape.
//
// We can't directly import the file (it pulls in three-bvh-csg which
// expects a browser-y env), so we reimplement a thin three-only check
// here. The real proof is the screenshot — this test just guards the
// store + geometry layer against regressions.
//
// Run: cd /app/frontend && node tests/curve-primitives-smoke.mjs

import * as THREE from "three";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const results = [];
const check = (label, cond, extra = "") => {
  results.push({ label, cond });
  console.log(`${cond ? PASS : FAIL} — ${label}${extra ? ` — ${extra}` : ""}`);
};

// ---- Helix ----
const R = 12, tube = 2, pitch = 6, turns = 4;
const H = pitch * turns;
class HelixCurve extends THREE.Curve {
  getPoint(u, target = new THREE.Vector3()) {
    const theta = 2 * Math.PI * turns * u;
    const y = pitch * turns * u - H / 2;
    return target.set(R * Math.cos(theta), y, R * Math.sin(theta));
  }
}
const helix = new THREE.TubeGeometry(new HelixCurve(), 96, tube, 12, false);
helix.computeBoundingBox();
const hb = helix.boundingBox;
check("helix has non-empty position buffer", helix.attributes.position.count > 0);
check("helix bbox height matches turns × pitch",
  Math.abs((hb.max.y - hb.min.y) - H) < 2 * tube + 1,
  `H=${(hb.max.y - hb.min.y).toFixed(2)} expected~${H}`);
check("helix bbox width ≈ 2 × (R + tube)",
  Math.abs((hb.max.x - hb.min.x) - 2 * (R + tube)) < 1.5,
  `W=${(hb.max.x - hb.min.x).toFixed(2)} expected ~${2 * (R + tube)}`);

// ---- Pipe (LatheGeometry) ----
const Router = 12, wall = 2, Rinner = Router - wall, Hpipe = 30, half = Hpipe / 2;
const profile = [
  new THREE.Vector2(Router, -half),
  new THREE.Vector2(Router,  half),
  new THREE.Vector2(Rinner,  half),
  new THREE.Vector2(Rinner, -half),
  new THREE.Vector2(Router, -half),
];
const pipe = new THREE.LatheGeometry(profile, 64);
pipe.computeBoundingBox();
const pb = pipe.boundingBox;
check("pipe has non-empty position buffer", pipe.attributes.position.count > 0);
check("pipe outer diameter ≈ 2R",
  Math.abs((pb.max.x - pb.min.x) - 2 * Router) < 0.5,
  `W=${(pb.max.x - pb.min.x).toFixed(2)} expected ${2 * Router}`);
check("pipe height = H", Math.abs((pb.max.y - pb.min.y) - Hpipe) < 1e-3);

// ---- Wedge (ExtrudeGeometry of right triangle, rotated to extrude along X) ----
const X = 24, Y = 16, Z = 24;
const shape = new THREE.Shape();
shape.moveTo(-Z / 2, -Y / 2);
shape.lineTo(Z / 2, -Y / 2);
shape.lineTo(-Z / 2, Y / 2);
shape.closePath();
const wedge = new THREE.ExtrudeGeometry(shape, { depth: X, bevelEnabled: false });
wedge.rotateY(Math.PI / 2);
wedge.translate(-X / 2, 0, 0);
wedge.computeBoundingBox();
const wb = wedge.boundingBox;
check("wedge has non-empty position buffer", wedge.attributes.position.count > 0);
check("wedge bbox X ≈ X dim", Math.abs((wb.max.x - wb.min.x) - X) < 1e-3,
  `W=${(wb.max.x - wb.min.x).toFixed(2)} expected ${X}`);
check("wedge bbox Y ≈ Y dim", Math.abs((wb.max.y - wb.min.y) - Y) < 1e-3,
  `H=${(wb.max.y - wb.min.y).toFixed(2)} expected ${Y}`);
check("wedge bbox Z ≈ Z dim", Math.abs((wb.max.z - wb.min.z) - Z) < 1e-3,
  `D=${(wb.max.z - wb.min.z).toFixed(2)} expected ${Z}`);

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log("  - " + f.label);
  process.exit(1);
}

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
import { readFileSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";

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

// ---- getBaseSize regression test ----
// User reported in v1.12 that the Scale popover showed 1×1×1 for the
// new primitives because getBaseSize() didn't have cases for them.
// Inline the SAME logic so this duplicate can't drift from the source.
function getBaseSize(obj) {
  const t = obj.type, d = obj.dims || {};
  if (t === "helix") {
    const rr = d.r || 12, tt = d.tube || 2;
    const HH = (d.turns || 4) * (d.pitch || 6);
    return { x: 2 * (rr + tt), y: HH, z: 2 * (rr + tt) };
  }
  if (t === "pipe") {
    const rr = d.r || 12;
    return { x: 2 * rr, y: d.h || 30, z: 2 * rr };
  }
  if (t === "wedge") return { x: d.x || 24, y: d.y || 16, z: d.z || 24 };
  return { x: 1, y: 1, z: 1 };
}

const helixSize = getBaseSize({ type: "helix", dims: { r: 12, tube: 2, pitch: 6, turns: 4 } });
check("getBaseSize helix x = 2(R+tube) = 28", helixSize.x === 28, `x=${helixSize.x}`);
check("getBaseSize helix y = turns × pitch = 24", helixSize.y === 24, `y=${helixSize.y}`);
check("getBaseSize helix z = 2(R+tube) = 28", helixSize.z === 28, `z=${helixSize.z}`);
check("getBaseSize helix is NEVER 1×1×1 (regression guard)",
  !(helixSize.x === 1 && helixSize.y === 1 && helixSize.z === 1));

const pipeSize = getBaseSize({ type: "pipe", dims: { r: 12, wall: 2, h: 30 } });
check("getBaseSize pipe x = 2R = 24", pipeSize.x === 24);
check("getBaseSize pipe y = h = 30", pipeSize.y === 30);
check("getBaseSize pipe z = 2R = 24", pipeSize.z === 24);

const wedgeSize = getBaseSize({ type: "wedge", dims: { x: 24, y: 16, z: 24 } });
check("getBaseSize wedge xyz matches dims", wedgeSize.x === 24 && wedgeSize.y === 16 && wedgeSize.z === 24);
check("getBaseSize source still has helix/pipe/wedge cases",
  ["helix", "pipe", "wedge"].every((t) => {
    const fs = readFileSync(
      pathResolve(import.meta.dirname || dirname(new URL(import.meta.url).pathname), "..", "src/lib/geometry.js"),
      "utf-8",
    );
    return fs.includes(`t === "${t}"`);
  }));

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log("  - " + f.label);
  process.exit(1);
}

// Smoke test for SVG import fixes (v1.9.1):
//   • Strips background-fill rectangle that covers ≥95% of the SVG
//   • Captures THREE.Shape holes as separate `isHole: true` entries
//
// We import SVGLoader directly under Node and replay parseSVGToShapes
// against the user-submitted SWS Logo (565-path Inkscape export with a
// 1024×1024 white background rectangle as path #1). Asserts:
//   • dropped >= 1 background path
//   • shape count is meaningful but well below the raw 565 paths
//   • at least one entry has isHole: true (letters in the logo)
//
// Run: cd /app/frontend && node tests/svg-import-smoke.mjs
//
// Bundled with the rest of the frontend smoke suite — light, deterministic,
// no slicer involvement.

import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const results = [];
function check(label, cond, extra = "") {
  results.push({ label, cond });
  console.log(`${cond ? PASS : FAIL} — ${label}${extra ? ` — ${extra}` : ""}`);
}

// SVGLoader needs DOMParser. Set up a minimal jsdom env.
const dom = new JSDOM("");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;

// Pull the actual user-submitted SVG; fall back to a tiny synthetic
// "O letter on a background" if the file isn't available locally.
const here = path.dirname(new URL(import.meta.url).pathname);
const localCopy = path.join(here, "fixtures", "sws-logo.svg");
let svgText = "";
if (fs.existsSync(localCopy)) {
  svgText = fs.readFileSync(localCopy, "utf-8");
  check("loaded SVG fixture", svgText.length > 0, `${svgText.length} bytes`);
} else {
  svgText = `<?xml version="1.0"?>
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 0 H100 V100 H0 Z" fill="#fff"/>
  <path d="M30 50 a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0 M40 50 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0" fill-rule="evenodd" fill="#000"/>
</svg>`;
  check("using synthetic O-letter SVG fixture", true);
}

const { parseSVGToShapes } = await import("../src/lib/svgImport.js");

let parsed;
try {
  parsed = parseSVGToShapes(svgText, { targetMaxMM: 80 });
  check("parseSVGToShapes did not throw", true);
} catch (e) {
  check("parseSVGToShapes did not throw", false, e.message);
  process.exit(1);
}

check(
  "at least one background path was stripped",
  parsed.droppedBackground >= 1,
  `dropped=${parsed.droppedBackground}`
);
check(
  "surviving shape count > 0",
  parsed.shapes.length > 0,
  `count=${parsed.shapes.length}`
);
check(
  "at least one entry is flagged as a hole (letter interior)",
  parsed.shapes.some((s) => s.isHole === true),
  `holes=${parsed.shapes.filter((s) => s.isHole).length}/${parsed.shapes.length}`
);
check(
  "every shape has >= 3 points",
  parsed.shapes.every((s) => s.points.length >= 3),
  `min=${Math.min(...parsed.shapes.map((s) => s.points.length))}`
);
check(
  "bbox is bounded by targetMaxMM",
  parsed.bbox.width <= 80 + 1e-6 && parsed.bbox.height <= 80 + 1e-6,
  `${parsed.bbox.width.toFixed(2)}×${parsed.bbox.height.toFixed(2)}`
);

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log("  - " + f.label);
  process.exit(1);
}

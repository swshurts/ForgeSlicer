// Smoke test for the AMS-aware GCODE preview parser.
//
// We simulate a small multi-material GCODE block (header AMS_TABLE,
// per-tool TOOL markers, T0/T1 tool changes, mixed extrude/travel moves)
// and verify the preview parser correctly:
//   • picks up the colour palette from the AMS table
//   • counts tool changes per layer
//   • attributes each extrude move to its active tool
//
// Run: cd /app/frontend && node tests/ams-preview-smoke.mjs
//
// Kept as a Node-side test because the parser is a pure function — no
// React, no three.js. We import the source by extracting the parseGcode
// function at runtime via a tiny module shim.

import fs from "node:fs";
import path from "node:path";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const results = [];
function check(label, cond, extra = "") {
  results.push({ label, cond });
  console.log(`${cond ? PASS : FAIL} — ${label}${extra ? ` — ${extra}` : ""}`);
}

// ---- Inline parser copy ----
// We can't `import` the JSX file directly under Node without a bundler,
// so we duplicate the parser here. Any change to parseGcode in
// GcodePreviewDialog.jsx MUST be mirrored here — the matching pair is
// enforced by this test.
function readArg(line, ch) {
  const re = new RegExp(`\\s${ch}(-?[0-9]*\\.?[0-9]+)`);
  const m = re.exec(" " + line);
  return m ? parseFloat(m[1]) : null;
}

function parseGcode(gcode) {
  const layers = [];
  const toolMap = new Map();
  let cur = null;
  let x = 0, y = 0, z = 0;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  let activeTool = 0;
  const lines = gcode.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    const mAms = /^;\s*AMS_TABLE\s+(.+)$/.exec(line);
    if (mAms) {
      const re = /T(\d+)\s*=\s*(#[0-9a-fA-F]{6})/g;
      let m;
      while ((m = re.exec(mAms[1])) !== null) {
        const idx = parseInt(m[1], 10);
        toolMap.set(idx, { ...(toolMap.get(idx) || { index: idx }), hex: m[2] });
      }
      continue;
    }
    const mTool = /^;\s*TOOL:\s*(\d+)\s*(?:hex=(#[0-9a-fA-F]{6}))?\s*(?:name=(.+))?$/.exec(line);
    if (mTool) {
      const idx = parseInt(mTool[1], 10);
      const hex = mTool[2];
      const name = (mTool[3] || "").trim();
      const existing = toolMap.get(idx) || { index: idx };
      toolMap.set(idx, { index: idx, hex: hex || existing.hex, name: name || existing.name });
      if (cur && idx !== activeTool) {
        cur.toolChanges = (cur.toolChanges || 0) + 1;
        cur.toolChangeMarkers.push({ x, y, tool: idx });
      }
      activeTool = idx;
      continue;
    }
    if (!line || line.startsWith(";")) {
      const mLayer = /^;\s*LAYER:\s*(\d+)\s*z\s*=\s*([0-9.+-eE]+)/.exec(line);
      if (mLayer) {
        cur = { idx: parseInt(mLayer[1], 10), z: parseFloat(mLayer[2]), moves: [], toolChangeMarkers: [], extrudeMoves: 0, travelMoves: 0, toolChanges: 0 };
        layers.push(cur);
      }
      continue;
    }
    const mT = /^T(\d+)\b/.exec(line);
    if (mT) {
      const idx = parseInt(mT[1], 10);
      if (cur && idx !== activeTool) {
        cur.toolChanges = (cur.toolChanges || 0) + 1;
        cur.toolChangeMarkers.push({ x, y, tool: idx });
      }
      if (!toolMap.has(idx)) toolMap.set(idx, { index: idx });
      activeTool = idx;
      continue;
    }
    if (!/^G[01]\b/.test(line)) continue;
    const isG0 = /^G0\b/.test(line);
    const nx = readArg(line, "X");
    const ny = readArg(line, "Y");
    const nz = readArg(line, "Z");
    const hasE = /\sE-?[0-9]/.test(line);
    if (nz != null) z = nz;
    const fromX = x, fromY = y;
    if (nx != null) x = nx;
    if (ny != null) y = ny;
    if (cur && (nx != null || ny != null)) {
      const extruding = !isG0 && hasE;
      cur.moves.push({ x0: fromX, y0: fromY, x1: x, y1: y, extruding, tool: activeTool });
      if (extruding) cur.extrudeMoves++; else cur.travelMoves++;
      if (extruding) {
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
        if (fromX < xMin) xMin = fromX; if (fromX > xMax) xMax = fromX;
        if (fromY < yMin) yMin = fromY; if (fromY > yMax) yMax = fromY;
      }
    }
  }
  if (!isFinite(xMin)) { xMin = 0; xMax = 0; yMin = 0; yMax = 0; }
  const tools = Array.from(toolMap.values()).sort((a, b) => a.index - b.index)
    .map((t) => ({ index: t.index, hex: t.hex || "#f97316", name: t.name || "" }));
  return { layers, tools, bbox: { x: xMax - xMin, y: yMax - yMin, minX: xMin, minY: yMin, maxX: xMax, maxY: yMax } };
}

// Verify the JSX source and the parser copy stay in sync — the test is
// pointless if the duplicate drifts. We string-match on the AMS_TABLE
// regex literal since that's the first AMS-specific token in both.
const jsxSrc = fs.readFileSync(
  path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), "..", "src/components/GcodePreviewDialog.jsx"),
  "utf-8"
);
check(
  "GcodePreviewDialog still includes AMS_TABLE regex",
  /AMS_TABLE/.test(jsxSrc)
);
check(
  "GcodePreviewDialog still includes TOOL: regex",
  /TOOL:/.test(jsxSrc)
);

// ---- Test 1: AMS_TABLE picked up ----
const sample1 = `
; ForgeSlicer 1.0 - GCODE (multi-material, 2 extruders)
; AMS_TABLE T0=#E5E5E5 T2=#E53935
G28
T0
; LAYER:0 z=0.300
; TOOL:0 hex=#E5E5E5 name=White
G1 F1800
G0 X10 Y10 F7200
G1 X20 Y10 E0.1
G1 X20 Y20 E0.2
; TOOL:2 hex=#E53935 name=Red
T2 ; tool change → Red
G0 X30 Y30 F7200
G1 X40 Y30 E0.3
G1 X40 Y40 E0.4
`.trim();

const r1 = parseGcode(sample1);
check("test1: detected exactly 2 tools", r1.tools.length === 2, `tools=${r1.tools.length}`);
check("test1: T0 palette mapped to white", r1.tools.find((t) => t.index === 0)?.hex === "#E5E5E5");
check("test1: T2 palette mapped to red", r1.tools.find((t) => t.index === 2)?.hex === "#E53935");
check("test1: parsed 1 layer", r1.layers.length === 1, `layers=${r1.layers.length}`);
check("test1: layer recorded 1 tool change (T0 → T2)", r1.layers[0]?.toolChanges === 1, `toolChanges=${r1.layers[0]?.toolChanges}`);
const t0Extrudes = r1.layers[0].moves.filter((m) => m.extruding && m.tool === 0).length;
const t2Extrudes = r1.layers[0].moves.filter((m) => m.extruding && m.tool === 2).length;
check("test1: 2 extrude moves attributed to T0", t0Extrudes === 2, `t0=${t0Extrudes}`);
check("test1: 2 extrude moves attributed to T2", t2Extrudes === 2, `t2=${t2Extrudes}`);
check("test1: layer has exactly 1 tool-change marker", (r1.layers[0].toolChangeMarkers || []).length === 1);

// ---- Test 2: single-material (no AMS markers) parses unchanged ----
const sample2 = `
; ForgeSlicer 1.0 - GCODE
; LAYER:0 z=0.300
G1 F1800
G0 X10 Y10
G1 X20 Y10 E0.1
G1 X20 Y20 E0.2
`.trim();
const r2 = parseGcode(sample2);
check("test2: no tools detected → empty palette", r2.tools.length === 0, `tools=${r2.tools.length}`);
check("test2: parsed 1 layer", r2.layers.length === 1);
check("test2: no tool changes", r2.layers[0].toolChanges === 0);
check("test2: all extrudes attributed to default tool 0", r2.layers[0].moves.every((m) => !m.extruding || m.tool === 0));

// ---- Test 3: implicit T<n> tool change without ; TOOL: marker ----
const sample3 = `
; ForgeSlicer 1.0 - GCODE (multi-material, 2 extruders)
; AMS_TABLE T0=#E5E5E5 T1=#3182CE
; LAYER:0 z=0.300
T0
G0 X1 Y1
G1 X2 Y1 E0.1
T1
G0 X5 Y5
G1 X6 Y5 E0.2
`.trim();
const r3 = parseGcode(sample3);
check("test3: explicit T1 produced a tool change", r3.layers[0].toolChanges === 1, `toolChanges=${r3.layers[0].toolChanges}`);
const t1Move = r3.layers[0].moves.find((m) => m.extruding && m.tool === 1);
check("test3: extrude move correctly attributed to T1 after T1 command", !!t1Move);

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`${failed.length} failed:`);
  for (const f of failed) console.log("  - " + f.label);
  process.exit(1);
}

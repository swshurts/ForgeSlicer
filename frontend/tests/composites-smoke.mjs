// Composite-factory regression tests.
// Run:  cd /app/frontend && node tests/composites-smoke.mjs
//
// Locks in the shape + identity guarantees that the store actions rely on:
//   - parts is a non-empty array
//   - every part has a unique id within the batch
//   - every part shares the returned groupId
//   - primaryId is the id of one of the parts

import {
  buildSlot,
  buildFastenerPair,
  buildCountersink,
  buildHexPocket,
  buildGusset,
} from "../src/lib/composites.js";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};

// Minimal ctx — the store provides richer versions, but the builders only
// need `buildPrimitive` (returns a fresh primitive descriptor) and
// `newId` (mints a unique id).
let idCounter = 0;
const ctx = {
  buildPrimitive: (type, modifier = "positive") => ({
    type, modifier, visible: true, locked: false,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    dims: {}, colorIndex: 7,
  }),
  newId: (t) => `${t}-tst-${++idCounter}`,
};

function assertSharedShape(name, result) {
  ok(Array.isArray(result.parts) && result.parts.length >= 1, `${name}: parts is a non-empty array`);
  const ids = result.parts.map((p) => p.id);
  ok(new Set(ids).size === ids.length, `${name}: every part id is unique`);
  for (const p of result.parts) {
    ok(p.groupId === result.groupId, `${name}: ${p.name || p.id} carries the group id`);
  }
  ok(ids.includes(result.primaryId), `${name}: primaryId is one of the parts`);
  for (const p of result.parts) {
    ok(Array.isArray(p.position) && p.position.length === 3, `${name}: ${p.name || p.id} has [x,y,z] position`);
    ok(p.type, `${name}: ${p.name || p.id} has a type`);
  }
}

// --- Slot ---
{
  const r = buildSlot({ modifier: "negative", width: 6, length: 10, depth: 6.5 }, ctx);
  assertSharedShape("slot", r);
  ok(r.parts.length === 3, "slot: 3 parts (cube + 2 caps)");
  ok(r.parts[0].dims.x === 6 && r.parts[0].dims.z === 6.5, "slot: core dims match");
  ok(r.parts[1].dims.r === 3 && r.parts[2].dims.r === 3, "slot: cap radius = width/2");
}
{
  const r = buildSlot({ width: 6, length: 6, depth: 4 }, ctx);
  ok(r.parts[0].dims.y === 0, "slot: middle length collapses to 0 when w == l");
}

// --- Fastener pair ---
{
  const r = buildFastenerPair({ boltR: 5, workThickness: 12 }, ctx);
  assertSharedShape("fastener", r);
  ok(r.parts.length === 4, "fastener: 4 parts (bolt + bore + counterbore + nut)");
  const types = r.parts.map((p) => p.type);
  ok(types.includes("bolt") && types.includes("nut"), "fastener: includes bolt + nut");
  const negs = r.parts.filter((p) => p.modifier === "negative");
  ok(negs.length === 2, "fastener: bore + counterbore are negative");
}

// --- Countersink ---
{
  const r = buildCountersink({ boreR: 2.5, headR: 5, throughH: 12 }, ctx);
  assertSharedShape("countersink", r);
  ok(r.parts.length === 2, "countersink: bore + cup");
  ok(r.parts.every((p) => p.modifier === "negative"), "countersink: every part is negative");
}

// --- Hex pocket ---
{
  const r = buildHexPocket({ acrossFlatsR: 2.5, depth: 4 }, ctx);
  assertSharedShape("hex pocket", r);
  ok(r.parts.length === 1, "hex pocket: single part");
  ok(r.parts[0].dims.segments === 6, "hex pocket: 6-segment cylinder = hex prism");
  // Across-flats = r * cos(30°); circumradius = af / cos(30°)
  const expectR = 2.5 / Math.cos(Math.PI / 6);
  ok(Math.abs(r.parts[0].dims.r - expectR) < 1e-6, "hex pocket: circumradius = af / cos(30°)");
}

// --- Gusset ---
{
  const r = buildGusset({ w: 12, h: 12, thickness: 3 }, ctx);
  assertSharedShape("gusset", r);
  ok(r.parts.length === 1, "gusset: single positive part");
  ok(r.parts[0].modifier === "positive", "gusset: positive modifier");
  ok(r.parts[0].dims.h === 3, "gusset: thickness propagates to dims.h");
}

console.log("\nAll composites-smoke assertions passed ✔");

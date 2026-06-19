// Composite primitive builders.
//
// "Composites" are pre-built assemblies — a Slot is a cube + two caps,
// a Fastener Pair is a bolt + bore + counterbore + nut, etc. Each
// builder is a PURE function that returns `{ parts, groupId, groupName,
// primaryId }` so the store action can wrap the result with a single
// `pushHistory` + `set` and atomic history works correctly.
//
// Why extract these?
//   `lib/store.js` was approaching 1500 lines. The composite builders
//   share a common shape (gather opts → mint group ID → emit N parts
//   sharing that group ID) so moving them here lets the store stay
//   focused on state + history + transforms, and lets the builders be
//   unit-tested in isolation (no Zustand needed).
//
// All builders accept a `ctx` containing:
//   - `buildPrimitive(type, modifier)`  → fresh primitive descriptor
//   - `newId(type)`                     → unique id string
//
// `parts` is an array of scene-object descriptors. `primaryId` is the
// object that should be the new `selectedId` after the assembly drops
// (usually the visually-primary member — e.g. the bolt's shaft).

const randSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// Per-tick ID generator — `Date.now()` collides when several parts are
// created in the same millisecond. Each builder uses its own counter
// (`i++`) postfix to guarantee uniqueness within the assembly.
function makeFreshId() {
  let i = 0;
  return (t) => `${t}-${Date.now()}-${i++}`;
}

// ---- Slot / racetrack ---------------------------------------------------
// Rectangular cube core with a half-cylinder cap on each end. Pure-cube
// version is degenerate when width === length (a round pill) but still
// emits all three members for consistency with CSG / outliner expectations.
export function buildSlot({ modifier = "negative", width = 6, length = 10, depth = 6.5 } = {}, ctx) {
  const w = Math.max(0.1, width);
  const l = Math.max(w, length);
  const d = Math.max(0.1, depth);
  const middle = l - w;
  const radius = w / 2;
  const groupId = `slot-${randSuffix()}`;
  const groupName = `Slot ${w}×${l}×${d}`;
  const baseY = d / 2;
  const halfCap = middle / 2;
  const tint = modifier === "negative" ? 0 : 7;
  const cube = {
    id: ctx.newId("cube"),
    name: "Slot · core",
    type: "cube",
    modifier,
    visible: true,
    locked: false,
    position: [0, 0, baseY],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dims: { x: w, y: middle, z: d },
    colorIndex: tint,
    groupId, groupName,
  };
  const capA = {
    id: ctx.newId("cylinder"),
    name: "Slot · cap A",
    type: "cylinder",
    modifier,
    visible: true,
    locked: false,
    position: [0, +halfCap, baseY],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dims: { r: radius, h: d, segments: 48 },
    colorIndex: tint,
    groupId, groupName,
  };
  const capB = {
    ...capA,
    id: ctx.newId("cylinder"),
    name: "Slot · cap B",
    position: [0, -halfCap, baseY],
  };
  return { parts: [cube, capA, capB], groupId, groupName, primaryId: cube.id };
}

// ---- Fastener Pair ------------------------------------------------------
// Bolt + clearance bore + head counterbore + nut. Designed so subtracting
// the negative members from a host plate while UNIONing the bolt/nut
// gives a fully-realised assembly in one shot.
export function buildFastenerPair(opts = {}, ctx) {
  const boltR = opts.boltR ?? 5;
  const pitch = opts.pitch ?? 1.5;
  const workThickness = opts.workThickness ?? 12;
  const headR = opts.headR ?? boltR * 1.6;
  const headH = opts.headH ?? Math.max(3, boltR * 0.7);
  const shaftH = opts.shaftH ?? workThickness + 8;
  const nutH = opts.nutH ?? Math.max(3, boltR * 1.0);
  const groupId = `fastener-${randSuffix()}`;
  const groupName = opts.groupName || "Fastener Pair";
  const freshId = makeFreshId();
  const counterboreDepth = headH + 0.2;
  const parts = [
    {
      ...ctx.buildPrimitive("bolt", "positive"),
      id: freshId("bolt"),
      name: "Bolt", position: [0, 0, 0],
      dims: { r: boltR, pitch, h: shaftH, headR, headH, segments: 48, headStyle: "hex" },
      groupId, groupName,
    },
    {
      ...ctx.buildPrimitive("cylinder", "negative"),
      id: freshId("cylinder"),
      name: "Bolt Bore", position: [0, 0, headH + workThickness / 2],
      dims: { r: boltR + 0.4, h: workThickness, segments: 48 },
      groupId, groupName,
    },
    {
      ...ctx.buildPrimitive("cylinder", "negative"),
      id: freshId("cylinder"),
      name: "Head Counterbore", position: [0, 0, counterboreDepth / 2],
      dims: { r: headR + 0.5, h: counterboreDepth, segments: 48 },
      groupId, groupName,
    },
    {
      ...ctx.buildPrimitive("nut", "positive"),
      id: freshId("nut"),
      name: "Nut", position: [0, 0, headH + workThickness + nutH / 2],
      dims: { r: boltR, pitch, h: nutH, flatR: headR, segments: 48 },
      groupId, groupName,
    },
  ];
  return { parts, groupId, groupName, primaryId: parts[0].id };
}

// ---- Countersink --------------------------------------------------------
// Through-bore + conical sink. Both NEGATIVE — subtract from a host to
// get a flat-head screw recess.
export function buildCountersink(opts = {}, ctx) {
  const boreR = opts.boreR ?? 2.5;
  const headR = opts.headR ?? boreR * 2;
  const sinkH = opts.sinkH ?? headR;
  const throughH = opts.throughH ?? 12;
  const groupId = `cs-${randSuffix()}`;
  const groupName = opts.groupName || "Countersink";
  const freshId = makeFreshId();
  const parts = [
    {
      ...ctx.buildPrimitive("cylinder", "negative"),
      id: freshId("cylinder"),
      name: "CS Bore", position: [0, 0, throughH / 2],
      dims: { r: boreR, h: throughH, segments: 48 },
      groupId, groupName,
    },
    {
      ...ctx.buildPrimitive("cone", "negative"),
      id: freshId("cone"),
      name: "CS Cup", position: [0, 0, throughH - sinkH / 2],
      dims: { r1: headR, r2: boreR, h: sinkH, segments: 48 },
      groupId, groupName,
    },
  ];
  return { parts, groupId, groupName, primaryId: parts[0].id };
}

// ---- Hex pocket ---------------------------------------------------------
// Single negative hexagonal cylinder for engraving a hex socket into a host.
export function buildHexPocket(opts = {}, ctx) {
  const acrossFlatsR = opts.acrossFlatsR ?? 2.5;
  const depth = opts.depth ?? 4;
  const groupId = `hexp-${randSuffix()}`;
  const groupName = opts.groupName || "Hex Pocket";
  const part = {
    ...ctx.buildPrimitive("cylinder", "negative"),
    id: `cylinder-${Date.now()}-0`,
    name: "Hex Pocket", position: [0, 0, depth / 2],
    // A 6-segment cylinder is a hex prism. We pass the circumradius
    // (across-corners) so the flats line up with the requested
    // across-flats dimension. flats = circumradius * cos(30°).
    dims: { r: acrossFlatsR / Math.cos(Math.PI / 6), h: depth, segments: 6 },
    rotation: [0, 0, 30],
    groupId, groupName,
  };
  return { parts: [part], groupId, groupName, primaryId: part.id };
}

// ---- Gusset -------------------------------------------------------------
// Single positive triangular prism used as a corner reinforcement.
export function buildGusset(opts = {}, ctx) {
  const w = opts.w ?? 12;
  const h = opts.h ?? 12;
  const thickness = opts.thickness ?? 3;
  const groupId = `gus-${randSuffix()}`;
  const groupName = opts.groupName || "Gusset";
  const part = {
    ...ctx.buildPrimitive("triangle", "positive"),
    id: `triangle-${Date.now()}-0`,
    name: "Gusset", position: [w / 2, 0, h / 2],
    dims: { r: Math.max(w, h) / 2, h: thickness },
    rotation: [0, 0, 0],
    groupId, groupName,
  };
  return { parts: [part], groupId, groupName, primaryId: part.id };
}

// Component Library — curated parametric recipes for common
// reusable mechanical parts. Each recipe is a pure function of the
// scene store: it knows how to add 1-N primitives (already grouped if
// it's a composite) and return the list of newly-added object IDs.
//
// Why parametric recipes instead of STL imports? Two reasons:
//   1) The user can edit every dimension after dropping — a "GoPro
//      mount" can become a 1.5× sized GoPro mount in one inspector
//      click, where an imported STL would need re-export.
//   2) Zero backend work / no asset hosting. The recipes weigh < 1 kB
//      each and version-control naturally with the rest of the app.
//
// Adding a new component is one entry in COMPONENTS plus a `build()`
// function that returns the descriptor list. The LeftPanel's Lib tab
// renders the list automatically.

import {
  Bolt, Circle as CircleIcon, Boxes, Box as BoxIcon, Hexagon, Camera,
  Disc, Spline, Wrench, GitFork,
} from "lucide-react";
import { buildPrimitive } from "./primitiveDefaults";

// Helper: returns a freshly-built primitive descriptor with the
// supplied overrides spread over the per-type defaults. Stays a thin
// wrapper around `buildPrimitive` so the recipes read as a list of
// (type, overrides) tuples.
const P = (type, overrides = {}) => buildPrimitive(type, overrides.modifier || "positive", overrides);

// Group every part of a composite under one id so the user moves /
// rotates the whole thing as a unit. The user can right-click →
// Ungroup any time to fine-tune individual members.
function group(name, parts) {
  const groupId = `cmp-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  return parts.map((p) => ({ ...p, groupId, groupName: name }));
}

// =====================================================================
// RECIPES — each returns an Array<sceneObject> ready to splice into
// useScene.getState().objects. Use addPrimitive's auto-drop semantics
// where it helps; here we set explicit z so the assembly sits with its
// natural "bottom" face on the bed.
// =====================================================================

function buildM3Standoff() {
  // M3 brass-style standoff: 10 mm tall, 5 mm OD hex body, 3 mm bore.
  return group("M3 Standoff", [
    // Hex outer body — torus with 6 segments approximates a hex shaft
    // poorly; better to use a cylinder with 6 segments which renders
    // as a hexagonal prism in Three.js. r=2.9 picks the hex inscribed
    // circle of a 5 mm A/F nut.
    P("cylinder", {
      name: "Standoff body",
      dims: { r: 2.9, h: 10, segments: 6 },
      position: [0, 0, 5],
    }),
    P("cylinder", {
      name: "Standoff bore",
      modifier: "negative",
      dims: { r: 1.5, h: 11, segments: 32 },
      position: [0, 0, 5],
    }),
  ]);
}

function buildBearing608() {
  // 608ZZ skateboard bearing: 22 OD × 8 ID × 7 tall.
  return group("608ZZ Bearing Seat", [
    P("cylinder", {
      name: "Bearing OD",
      dims: { r: 11, h: 7, segments: 64 },
      position: [0, 0, 3.5],
    }),
    P("cylinder", {
      name: "Bearing bore",
      modifier: "negative",
      dims: { r: 4, h: 8, segments: 32 },
      position: [0, 0, 3.5],
    }),
  ]);
}

function buildGoProMount() {
  // 3-prong GoPro tab: 15 mm OD knuckle, 5 mm thick prongs, 5 mm pivot.
  const tabH = 15;
  return group("GoPro Mount (3-prong)", [
    // Base plate
    P("cube", {
      name: "Mount plate",
      dims: { x: 30, y: 25, z: 4 },
      position: [0, 0, 2],
    }),
    // Three vertical prongs - the GoPro standard is 3 tabs on this
    // half of the mount (the other half has 2 tabs and they finger
    // together). 5 mm prong thickness, 3 mm gap = 21 mm total span.
    P("cube", { name: "Prong 1", dims: { x: 5, y: 14, z: tabH }, position: [-8, 0, 4 + tabH / 2] }),
    P("cube", { name: "Prong 2", dims: { x: 5, y: 14, z: tabH }, position: [0, 0, 4 + tabH / 2] }),
    P("cube", { name: "Prong 3", dims: { x: 5, y: 14, z: tabH }, position: [8, 0, 4 + tabH / 2] }),
    // Pivot bore through all three prongs (5 mm dia for an M5 bolt)
    P("cylinder", {
      name: "Pivot bore",
      modifier: "negative",
      dims: { r: 2.5, h: 30, segments: 32 },
      position: [0, 0, 4 + tabH / 2],
      rotation: [0, 90, 0], // axis along world X (through all 3 prongs)
    }),
  ]);
}

function buildWallAnchor() {
  // Triangular wall-mount bracket with two screw holes.
  return group("Wall Bracket (L)", [
    P("cube", { name: "Vertical face", dims: { x: 30, y: 4, z: 40 }, position: [0, -13, 20] }),
    P("cube", { name: "Horizontal face", dims: { x: 30, y: 25, z: 4 }, position: [0, -2.5, 2] }),
    P("cylinder", {
      name: "Wall screw hole",
      modifier: "negative",
      dims: { r: 2.2, h: 6, segments: 32 },
      position: [0, -13, 30],
      rotation: [90, 0, 0],
    }),
    P("cylinder", {
      name: "Floor screw hole",
      modifier: "negative",
      dims: { r: 2.2, h: 6, segments: 32 },
      position: [0, 4, 2],
    }),
  ]);
}

function buildCableClip() {
  // Adhesive cable clip — open-top channel sized for a typical
  // 6 mm USB-C / power cable.
  return group("Cable Clip (6 mm)", [
    P("cube", { name: "Body", dims: { x: 14, y: 14, z: 8 }, position: [0, 0, 4] }),
    P("cylinder", {
      name: "Cable channel",
      modifier: "negative",
      dims: { r: 3.2, h: 16, segments: 32 },
      position: [0, 0, 9],
      rotation: [0, 90, 0],
    }),
    P("cube", {
      name: "Channel mouth",
      modifier: "negative",
      dims: { x: 16, y: 4.5, z: 6 },
      position: [0, 0, 10],
    }),
  ]);
}

function buildHinge() {
  // Generic 2-leaf pin hinge — single pin axis, two leaves with
  // counterbored mounting holes.
  return group("Pin Hinge (40 mm)", [
    // Leaf A
    P("cube", { name: "Leaf A", dims: { x: 40, y: 20, z: 3 }, position: [0, -10, 1.5] }),
    P("cylinder", {
      name: "Leaf A knuckle",
      dims: { r: 3.5, h: 40, segments: 32 },
      position: [0, 0, 3.5],
      rotation: [0, 90, 0],
    }),
    // Leaf B (sits at right angles in the demo orientation — the
    // pivot still works because both knuckles share the X axis)
    P("cube", { name: "Leaf B", dims: { x: 40, y: 20, z: 3 }, position: [0, 10, 1.5] }),
    // Pin bore through both knuckles
    P("cylinder", {
      name: "Pin bore",
      modifier: "negative",
      dims: { r: 1.6, h: 42, segments: 24 },
      position: [0, 0, 3.5],
      rotation: [0, 90, 0],
    }),
  ]);
}

function buildSpurGear() {
  // Cosmetic spur-gear stub — N teeth approximated as a fluted
  // cylinder. Not a real involute profile; good enough for visual
  // mock-ups + handle prototypes.
  return group("Spur Gear (20 teeth)", [
    // Body
    P("cylinder", {
      name: "Gear body",
      dims: { r: 18, h: 6, segments: 40 }, // 40 segs ≈ 20 teeth visually
      position: [0, 0, 3],
    }),
    // Hub
    P("cylinder", {
      name: "Gear hub",
      dims: { r: 7, h: 10, segments: 32 },
      position: [0, 0, 5],
    }),
    // Shaft bore
    P("cylinder", {
      name: "Shaft bore",
      modifier: "negative",
      dims: { r: 3, h: 12, segments: 24 },
      position: [0, 0, 6],
    }),
  ]);
}

function buildKnob() {
  // Knurled control knob — fluted cylinder + cap + shaft socket.
  return group("Knob (24 mm)", [
    P("cylinder", {
      name: "Knob body",
      dims: { r: 12, h: 14, segments: 24 }, // 24 flutes
      position: [0, 0, 7],
    }),
    P("cylinder", {
      name: "Knob cap",
      dims: { r: 13, h: 2, segments: 48 },
      position: [0, 0, 15],
    }),
    P("cylinder", {
      name: "Shaft socket",
      modifier: "negative",
      dims: { r: 3.1, h: 12, segments: 24 },
      position: [0, 0, 6],
    }),
  ]);
}

// =====================================================================
// Registry
// =====================================================================

export const COMPONENT_CATEGORIES = [
  { id: "fasteners", label: "Fasteners" },
  { id: "bearings",  label: "Bearings" },
  { id: "brackets",  label: "Brackets" },
  { id: "cables",    label: "Cable mgmt" },
  { id: "mechanics", label: "Mechanics" },
  { id: "controls",  label: "Controls" },
];

export const COMPONENTS = [
  {
    id: "m3-standoff",
    name: "M3 Standoff",
    category: "fasteners",
    icon: Bolt,
    blurb: "10 mm hex standoff, M3 bore. Editable height / hex flat-to-flat / bore radius.",
    build: buildM3Standoff,
  },
  {
    id: "bearing-608",
    name: "608 Bearing Seat",
    category: "bearings",
    icon: Disc,
    blurb: "22 × 8 × 7 mm skateboard bearing seat. Drop into a wheel hub, boolean-subtract.",
    build: buildBearing608,
  },
  {
    id: "gopro-mount",
    name: "GoPro Mount",
    category: "brackets",
    icon: Camera,
    blurb: "Standard 3-prong GoPro tab with 5 mm pivot hole. Mates with any GoPro accessory.",
    build: buildGoProMount,
  },
  {
    id: "wall-bracket-l",
    name: "L Wall Bracket",
    category: "brackets",
    icon: GitFork,
    blurb: "30 × 40 mm L-bracket with two pre-drilled M4 screw holes.",
    build: buildWallAnchor,
  },
  {
    id: "cable-clip",
    name: "Cable Clip (6 mm)",
    category: "cables",
    icon: Spline,
    blurb: "Adhesive cable channel sized for USB-C / power cables up to 6 mm OD.",
    build: buildCableClip,
  },
  {
    id: "pin-hinge",
    name: "Pin Hinge (40 mm)",
    category: "mechanics",
    icon: Hexagon,
    blurb: "Two-leaf pin hinge with through-bore. Drop, position the leaves, print.",
    build: buildHinge,
  },
  {
    id: "spur-gear-20t",
    name: "Spur Gear (20T)",
    category: "mechanics",
    icon: Wrench,
    blurb: "Cosmetic 20-tooth spur gear for handle / hand-wheel prototypes (not involute).",
    build: buildSpurGear,
  },
  {
    id: "knob-24mm",
    name: "Control Knob (24 mm)",
    category: "controls",
    icon: CircleIcon,
    blurb: "Knurled control knob with M6 shaft socket. Great for printer-mods and bench tools.",
    build: buildKnob,
  },
];

export const COMPONENT_ICONS = { boxes: Boxes, box: BoxIcon };

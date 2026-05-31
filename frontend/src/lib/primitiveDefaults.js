// Primitive defaults & factory — extracted from store.js for clarity
// and unit-test isolation. Pure functions / data, no Zustand state.
//
// `PRIMITIVE_DEFAULTS` is the source-of-truth dims for every primitive
// type the modeller knows about. `buildPrimitive(type, modifier?,
// overrides?)` returns a fully-formed object ready to spread into the
// scene's `objects` array — handles ID generation, auto-drop centroid
// math (so the new primitive sits with its base at Y=0 on the build
// plate), and the modifier/colour conventions ("negative" parts get
// the red colour-index slot; everything else gets the default).
//
// Why split this out:
//   • store.js was 1486 lines; this block is ~130 lines of pure
//     declarations and a deterministic factory — perfect candidate
//     for extraction.
//   • Now testable in isolation without spinning up Zustand state.
//   • Easier for new contributors to add a primitive type without
//     wading through the action methods.

import { SWEEP_DEFAULTS } from "./sweepGeometry";
import { TEXTURE_DEFAULTS } from "./textureGeometry";

export const PRIMITIVE_DEFAULTS = {
  cube:     { dims: { x: 20, y: 20, z: 20 } },
  sphere:   { dims: { r: 12, segments: 48 } },
  cylinder: { dims: { r: 10, h: 24, segments: 64 } },
  cone:     { dims: { r: 10, h: 24, segments: 64 } },
  torus:    { dims: { r: 14, tube: 4, segments: 48 } },
  // ---- Curve / extrude-style primitives (v1.12) ----
  // helix: a tube swept along a parametric helix. Useful for screw
  //        threads, springs, decorative coils, antennae mounts. `turns`
  //        is the number of complete revolutions; `pitch` is the
  //        per-turn rise so `H = turns * pitch`.
  helix:    { dims: { r: 12, tube: 2, pitch: 6, turns: 4, segments: 96 } },
  // pipe: hollow cylinder (outer R, wall thickness, height). Same idea
  //       as cylinder but builds the inside hole at primitive construction
  //       time so the user doesn't need a CSG subtract for the simplest
  //       case (pipes / tube fittings / standoffs).
  pipe:     { dims: { r: 12, wall: 2, h: 30, segments: 64 } },
  // wedge: TinkerCAD-style ramp. Right-triangle profile extruded along
  //        the X axis; ramps along +Z, height along +Y. Great for
  //        chamfered bases, draft angles, ergonomic grips.
  wedge:    { dims: { x: 24, y: 16, z: 24 } },
  // ---- Threaded fasteners (v1.15) ----
  // bolt:  cylinder body + triangular thread helix swept around it.
  //        Models ISO-metric profile so it screws into the matching
  //        `nut` primitive. `r` is the major (outside) thread radius,
  //        `pitch` is the per-turn rise (1.5mm for ~M10), `h` is the
  //        threaded length, `headR`/`headH` are the hex/cap head.
  bolt:     { dims: { r: 5, pitch: 1.5, h: 20, headR: 8, headH: 4, segments: 48, headStyle: "hex" } },
  // nut:   hex prism with an inner-thread helix swept inside. Major
  //        radius matches the bolt's; the inside threads cut into the
  //        prism so a bolt of matching pitch screws right in. `pitch`
  //        must match the mating bolt. `flatR` is the hex flat radius
  //        (across-flats / 2).
  nut:      { dims: { r: 5, pitch: 1.5, h: 5, flatR: 8, segments: 48 } },
  // spline (1.16): a splined SHAFT — N longitudinal ridges (teeth)
  //        running along a cylindrical core. Models the splined-shaft
  //        side of mechanical couplings (gears, drive hubs, etc.). The
  //        Inspector exposes both `width` (chord on outer surface, mm)
  //        and `angle` (per-tooth angular span, deg) — they're two
  //        views on the same constraint. `profile` picks the cross-
  //        section: rectangular (flat-top), triangular (involute/
  //        serration), or rounded (knurl-like). When the user toggles
  //        the object's modifier to "negative" the same geometry cuts
  //        matching grooves into another part (the bore side).
  spline:   { dims: { r: 6, h: 30, teeth: 8, toothHeight: 1.2, toothWidthDeg: 12, profile: "rectangular", segments: 32 } },
  // ---- 2D shapes ----
  // Stored as thin extrusions (h = 1 mm by default — a "2D wafer").
  // The Extrude action in the inspector promotes them to 3D parts by
  // bumping h to whatever depth the user wants.
  circle:   { dims: { r: 10, h: 1 } },
  square2d: { dims: { side: 20, h: 1 } },
  triangle: { dims: { r: 12, h: 1 } },
  polygon:  { dims: { r: 12, sides: 6, h: 1 } },
  // ---- Sweep (v1.18, iter 46) ----
  // sweep: extrudes a 2D profile along a 3D path so the profile stays
  //        perpendicular to the path tangent at every sample. Profile
  //        descriptors live in `dims.profile`; path descriptors in
  //        `dims.path`. The default preset is a helical spring — circular
  //        profile swept along a helix — so users see what Sweep actually
  //        does the moment they add it.
  sweep:    { dims: { ...SWEEP_DEFAULTS } },
  // ---- Texture (v1.20, iter 49) ----
  // texture: tiled geometric pattern (knurl / hex / bumps / ridges)
  //          baked as a single merged BufferGeometry on top of a thin
  //          base plate. Positive textures union onto a host surface;
  //          negatives engrave. The user picks the pattern + dims via
  //          the Texture Library dialog OR via the Inspector's
  //          TextureInspectorBlock once the object is selected.
  texture:  { dims: { ...TEXTURE_DEFAULTS } },
};

// Monotonic counter used by `newId` to disambiguate objects created in
// the same millisecond. Module-scoped so all callers share the same
// sequence. NOT exported — `buildPrimitive` is the only intended
// consumer (callers shouldn't be minting IDs by hand).
let _nextId = 1;
export const newId = (type) => `${type}-${Date.now()}-${_nextId++}`;

/**
 * Build a fresh primitive object ready to spread into the scene's
 * `objects` array. Computes the auto-drop centroid so the new
 * primitive lands with its base at Y=0 on the build plate, and picks
 * the colour-index slot based on `modifier` (negative parts use the
 * red slot 0; positive use slot 7).
 *
 * The `overrides` parameter lets callers override any auto-computed
 * field — particularly useful when reconstructing a primitive from a
 * persisted project (we want to keep the saved position, not re-drop
 * it).
 */
export const buildPrimitive = (type, modifier = "positive", overrides = {}) => {
  const def = PRIMITIVE_DEFAULTS[type] || PRIMITIVE_DEFAULTS.cube;
  // Compute the bbox-half-height so the new primitive lands centered
  // on the build plate with its base at Y=0. Helix uses turns*pitch
  // (the geometry's actual vertical extent), other curve primitives
  // fall through to their explicit `h` key. Final fallback is the
  // legacy z/h/r heuristic so untouched primitives behave as before.
  let halfH;
  if (type === "helix") halfH = (def.dims.turns * def.dims.pitch) / 2;
  else if (type === "sweep") {
    // Sweep's vertical extent depends on the path kind. For helix we
    // know it analytically; for everything else we punt to the auto-
    // drop pass downstream (computeRotatedBBox handles it).
    const p = def.dims.path || {};
    if (p.kind === "helix") halfH = (p.turns * p.pitch) / 2;
    else halfH = 10;
  }
  else if (type === "texture") {
    // Texture sits with its base plate at y=0 down to y=-depth, and
    // relief rising up to y=height. Halfway between those is what
    // we want as the centroid for the auto-drop pass.
    const depth = def.dims.depth ?? 0.8;
    const height = def.dims.height ?? 1.0;
    halfH = (depth + height) / 2;
  }
  else if (def.dims.h != null) halfH = def.dims.h / 2;
  else if (def.dims.z != null) halfH = def.dims.z / 2;
  else if (def.dims.r != null) halfH = def.dims.r;
  else halfH = 10;
  return {
    id: newId(type),
    name: `${type[0].toUpperCase() + type.slice(1)}`,
    type,
    modifier,
    visible: true,
    locked: false,
    position: [0, halfH, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    dims: type === "sweep"
      // Sweep dims contain nested `profile` and `path` descriptors —
      // a shallow `{ ...def.dims }` would make every new sweep share
      // the SAME object references for those nested dicts and an
      // edit on one would silently leak into another. Deep-copy them.
      ? {
          ...def.dims,
          profile: { ...def.dims.profile },
          path: { ...def.dims.path },
        }
      : { ...def.dims },
    colorIndex: modifier === "negative" ? 0 : 7,
    ...overrides,
  };
};

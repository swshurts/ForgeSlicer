// edgeFaceMeta.js — canonical edge / face / vertex inventory for the
// primitives that support sub-element fillet/chamfer (cube, cylinder,
// cone). Used by:
//   • Inspector picker UI to enumerate "Top face", "Front-top edge", etc.
//   • Viewport hit-zone overlay to know where to draw clickable strips.
//   • partialFillet.js to translate (edgeId, radius, style) into the
//     CSG ops that produce the rounded mesh.
//
// All identifiers are pure strings — they survive JSON serialisation
// into `obj.edgeFillets` without any extra encoding.
//
// Coordinate convention (matches the rest of ForgeSlicer):
//   • +X = right, +Y = UP (height), +Z = depth into the bed.
//   • Cube `dims.x` → world X span, `dims.y` → world Z span (DEPTH),
//     `dims.z` → world Y span (HEIGHT). This is the same convention
//     buildGeometry() uses today, so the IDs below are stable across
//     UI changes.

// ---------- Cube edges (12) ----------
// Each edge runs along one of the three world axes (X / Y / Z) at one
// of four corner positions in the other two axes. Naming pattern:
//   `e_<axis>_<sign1><axis1><sign2><axis2>` where (axis1, axis2) is the
// pair of perpendicular axes, in alphabetical order. Signs are 'min' /
// 'max'.  Example: `e_X_minY_minZ` is the edge parallel to X that sits
// at minimum Y and minimum Z — the "front-bottom" edge.
export const CUBE_EDGES = [
  // X-parallel edges (run along world X, vary in Y/Z)
  { id: "e_X_minY_minZ", axis: "X", label: "Front-bottom edge",  yPos: "min", zPos: "min" },
  { id: "e_X_minY_maxZ", axis: "X", label: "Back-bottom edge",   yPos: "min", zPos: "max" },
  { id: "e_X_maxY_minZ", axis: "X", label: "Front-top edge",     yPos: "max", zPos: "min" },
  { id: "e_X_maxY_maxZ", axis: "X", label: "Back-top edge",      yPos: "max", zPos: "max" },
  // Y-parallel edges (run along world Y / vertical, vary in X/Z)
  { id: "e_Y_minX_minZ", axis: "Y", label: "Front-left edge",    xPos: "min", zPos: "min" },
  { id: "e_Y_minX_maxZ", axis: "Y", label: "Back-left edge",     xPos: "min", zPos: "max" },
  { id: "e_Y_maxX_minZ", axis: "Y", label: "Front-right edge",   xPos: "max", zPos: "min" },
  { id: "e_Y_maxX_maxZ", axis: "Y", label: "Back-right edge",    xPos: "max", zPos: "max" },
  // Z-parallel edges (run along world Z / depth, vary in X/Y)
  { id: "e_Z_minX_minY", axis: "Z", label: "Bottom-left edge",   xPos: "min", yPos: "min" },
  { id: "e_Z_minX_maxY", axis: "Z", label: "Top-left edge",      xPos: "min", yPos: "max" },
  { id: "e_Z_maxX_minY", axis: "Z", label: "Bottom-right edge",  xPos: "max", yPos: "min" },
  { id: "e_Z_maxX_maxY", axis: "Z", label: "Top-right edge",     xPos: "max", yPos: "max" },
];

// ---------- Cube faces (6) ----------
// Each face has 4 abutting edges. When the user "selects a surface"
// the fillet/chamfer is applied to all 4 of those edges.
export const CUBE_FACES = [
  { id: "f_minX", label: "Left face",   normal: [-1, 0, 0], edges: ["e_Y_minX_minZ", "e_Y_minX_maxZ", "e_Z_minX_minY", "e_Z_minX_maxY"] },
  { id: "f_maxX", label: "Right face",  normal: [ 1, 0, 0], edges: ["e_Y_maxX_minZ", "e_Y_maxX_maxZ", "e_Z_maxX_minY", "e_Z_maxX_maxY"] },
  { id: "f_minY", label: "Bottom face", normal: [0, -1, 0], edges: ["e_X_minY_minZ", "e_X_minY_maxZ", "e_Z_minX_minY", "e_Z_maxX_minY"] },
  { id: "f_maxY", label: "Top face",    normal: [0,  1, 0], edges: ["e_X_maxY_minZ", "e_X_maxY_maxZ", "e_Z_minX_maxY", "e_Z_maxX_maxY"] },
  { id: "f_minZ", label: "Front face",  normal: [0, 0, -1], edges: ["e_X_minY_minZ", "e_X_maxY_minZ", "e_Y_minX_minZ", "e_Y_maxX_minZ"] },
  { id: "f_maxZ", label: "Back face",   normal: [0, 0,  1], edges: ["e_X_minY_maxZ", "e_X_maxY_maxZ", "e_Y_minX_maxZ", "e_Y_maxX_maxZ"] },
];

// ---------- Cube vertices (8) ----------
// Picking a vertex applies the fillet to the whole item — these IDs
// exist mainly for the viewport pick widget. They share radius/style
// with the rest of the cube's edges.
export const CUBE_VERTICES = [
  { id: "v_minX_minY_minZ", label: "Corner (-X, -Y, -Z)" },
  { id: "v_maxX_minY_minZ", label: "Corner (+X, -Y, -Z)" },
  { id: "v_minX_maxY_minZ", label: "Corner (-X, +Y, -Z)" },
  { id: "v_maxX_maxY_minZ", label: "Corner (+X, +Y, -Z)" },
  { id: "v_minX_minY_maxZ", label: "Corner (-X, -Y, +Z)" },
  { id: "v_maxX_minY_maxZ", label: "Corner (+X, -Y, +Z)" },
  { id: "v_minX_maxY_maxZ", label: "Corner (-X, +Y, +Z)" },
  { id: "v_maxX_maxY_maxZ", label: "Corner (+X, +Y, +Z)" },
];

// ---------- Cylinder ----------
// Only two edges (top circle, bottom circle) and three faces
// (top, bottom, curved side). Picking the side face applies to BOTH
// edges (it abuts both).
export const CYLINDER_EDGES = [
  { id: "e_top",    label: "Top edge" },
  { id: "e_bottom", label: "Bottom edge" },
];
export const CYLINDER_FACES = [
  { id: "f_top",    label: "Top face",    edges: ["e_top"] },
  { id: "f_bottom", label: "Bottom face", edges: ["e_bottom"] },
  { id: "f_side",   label: "Curved side", edges: ["e_top", "e_bottom"] },
];
// Cylinders have no real vertices — picking the centre = whole item.
export const CYLINDER_VERTICES = [{ id: "v_center", label: "Whole cylinder" }];

// ---------- Cone ----------
// One edge (base circle) and two faces (base, curved side). Apex is a
// point, not a vertex you'd want to fillet — exposed as "whole item".
export const CONE_EDGES = [{ id: "e_base", label: "Base edge" }];
export const CONE_FACES = [
  { id: "f_base", label: "Base face",    edges: ["e_base"] },
  { id: "f_side", label: "Curved side",  edges: ["e_base"] },
];
export const CONE_VERTICES = [{ id: "v_apex", label: "Whole cone" }];

// ---------- Helpers ----------
export function getEdgesForType(type) {
  if (type === "cube") return CUBE_EDGES;
  if (type === "cylinder") return CYLINDER_EDGES;
  if (type === "cone") return CONE_EDGES;
  return [];
}
export function getFacesForType(type) {
  if (type === "cube") return CUBE_FACES;
  if (type === "cylinder") return CYLINDER_FACES;
  if (type === "cone") return CONE_FACES;
  return [];
}
export function getVerticesForType(type) {
  if (type === "cube") return CUBE_VERTICES;
  if (type === "cylinder") return CYLINDER_VERTICES;
  if (type === "cone") return CONE_VERTICES;
  return [];
}

// Resolve a sub-selection (face / vertex) to the set of edge IDs it
// affects. Edges resolve to themselves; faces resolve to their 4
// abutting edges; vertices resolve to ALL edges of the primitive.
export function resolveSelectionToEdgeIds(obj, sub) {
  if (!sub || !obj) return [];
  if (sub.kind === "edge") return [sub.id];
  if (sub.kind === "face") {
    const f = getFacesForType(obj.type).find((x) => x.id === sub.id);
    return f ? [...f.edges] : [];
  }
  if (sub.kind === "vertex") {
    return getEdgesForType(obj.type).map((e) => e.id);
  }
  return [];
}

// Returns true when the given primitive supports per-edge fillets.
// Mirrors the supports-edgeStyle list in RightPanel today.
export function supportsEdgeFillets(type) {
  return type === "cube" || type === "cylinder" || type === "cone";
}

// Endpoint coords (in object-local space) for a cube edge — used by
// the viewport hit-zone overlay AND by partialFillet.js to know where
// the edge sits relative to the cube origin.
//
// Cube local frame: object dims.x → world X span, dims.y → world Z
// (DEPTH), dims.z → world Y (HEIGHT). buildGeometry uses
// `BoxGeometry(w=dims.x, h=dims.z, dep=dims.y)` — so in three's local
// frame the cube is centred at (0,0,0) with extents:
//   ±dims.x/2 along X
//   ±dims.z/2 along Y  (HEIGHT, which is world UP)
//   ±dims.y/2 along Z  (DEPTH)
// Confusingly, the EDGE-ID's `axis` letter refers to WORLD axes, so
// `axis:"Y"` means "runs vertically through the cube" = three's local
// Y, which corresponds to the user-facing `dims.z` height value.
export function cubeEdgeEndpoints(dims) {
  const hx = (dims.x || 20) / 2;
  const hyHeight = (dims.z || 20) / 2;   // world-up extent (local Y)
  const hzDepth = (dims.y || 20) / 2;    // depth extent (local Z)
  // For a given edge, build [a, b] in three's local frame.
  const f = (sign) => (sign === "max" ? 1 : -1);
  return CUBE_EDGES.map((e) => {
    let a, b;
    if (e.axis === "X") {
      const y = f(e.yPos) * hyHeight;
      const z = f(e.zPos) * hzDepth;
      a = [-hx, y, z]; b = [ hx, y, z];
    } else if (e.axis === "Y") {
      const x = f(e.xPos) * hx;
      const z = f(e.zPos) * hzDepth;
      a = [x, -hyHeight, z]; b = [x, hyHeight, z];
    } else { // Z
      const x = f(e.xPos) * hx;
      const y = f(e.yPos) * hyHeight;
      a = [x, y, -hzDepth]; b = [x, y, hzDepth];
    }
    return { id: e.id, label: e.label, axis: e.axis, a, b };
  });
}

// Face centre point + half-extents in three local frame (for the face
// hit-zone overlay). Returns { id, label, center, half: [hx, hy], normal }
// where (hx, hy) is the 2D extent of the face (the face quad).
export function cubeFaceQuads(dims) {
  const hx = (dims.x || 20) / 2;
  const hyHeight = (dims.z || 20) / 2;
  const hzDepth = (dims.y || 20) / 2;
  return CUBE_FACES.map((f) => {
    let center, half, axis;
    if (f.id === "f_minX") { center = [-hx, 0, 0]; half = [hzDepth, hyHeight]; axis = "X"; }
    else if (f.id === "f_maxX") { center = [ hx, 0, 0]; half = [hzDepth, hyHeight]; axis = "X"; }
    else if (f.id === "f_minY") { center = [0, -hyHeight, 0]; half = [hx, hzDepth]; axis = "Y"; }
    else if (f.id === "f_maxY") { center = [0,  hyHeight, 0]; half = [hx, hzDepth]; axis = "Y"; }
    else if (f.id === "f_minZ") { center = [0, 0, -hzDepth]; half = [hx, hyHeight]; axis = "Z"; }
    else                         { center = [0, 0,  hzDepth]; half = [hx, hyHeight]; axis = "Z"; }
    return { id: f.id, label: f.label, center, half, axis, normal: f.normal };
  });
}

export function cubeVertexPositions(dims) {
  const hx = (dims.x || 20) / 2;
  const hyHeight = (dims.z || 20) / 2;
  const hzDepth = (dims.y || 20) / 2;
  const f = (sign) => (sign === "max" ? 1 : -1);
  return CUBE_VERTICES.map((v) => {
    // Parse "v_<sign>X_<sign>Y_<sign>Z" — signs are "min" / "max".
    const m = v.id.match(/^v_(min|max)X_(min|max)Y_(min|max)Z$/);
    const sx = f(m[1]), sy = f(m[2]), sz = f(m[3]);
    return { id: v.id, label: v.label, p: [sx * hx, sy * hyHeight, sz * hzDepth] };
  });
}

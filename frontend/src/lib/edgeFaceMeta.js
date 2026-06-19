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
// iter-104.1 — Z-up CAD convention:
//   • +X = right, +Y = forward (depth from viewer), +Z = UP (height).
//   • Cube `dims.x` → world X, `dims.y` → world Y, `dims.z` → world Z.
//   • Local frame is 1:1 with dims (no axis swap relative to dims).
//   • Position labels:
//       xPos: min = "Left",   max = "Right"
//       yPos: min = "Front",  max = "Back"   (low Y = closer to viewer)
//       zPos: min = "Bottom", max = "Top"    (low Z = down)

// ---------- Cube edges (12) ----------
// Naming pattern: `e_<axis>_<sign1><axis1><sign2><axis2>` where
// (axis1, axis2) is the pair of perpendicular axes, alphabetical order.
// `axis` is the world axis the edge runs along.
export const CUBE_EDGES = [
  // X-parallel edges (in YZ plane)
  { id: "e_X_minY_minZ", axis: "X", label: "Front-bottom edge", yPos: "min", zPos: "min" },
  { id: "e_X_minY_maxZ", axis: "X", label: "Front-top edge",    yPos: "min", zPos: "max" },
  { id: "e_X_maxY_minZ", axis: "X", label: "Back-bottom edge",  yPos: "max", zPos: "min" },
  { id: "e_X_maxY_maxZ", axis: "X", label: "Back-top edge",     yPos: "max", zPos: "max" },
  // Y-parallel edges (in XZ plane) — horizontal forward-running edges
  { id: "e_Y_minX_minZ", axis: "Y", label: "Left-bottom edge",  xPos: "min", zPos: "min" },
  { id: "e_Y_minX_maxZ", axis: "Y", label: "Left-top edge",     xPos: "min", zPos: "max" },
  { id: "e_Y_maxX_minZ", axis: "Y", label: "Right-bottom edge", xPos: "max", zPos: "min" },
  { id: "e_Y_maxX_maxZ", axis: "Y", label: "Right-top edge",    xPos: "max", zPos: "max" },
  // Z-parallel edges (in XY plane) — vertical edges
  { id: "e_Z_minX_minY", axis: "Z", label: "Front-left vertical edge",  xPos: "min", yPos: "min" },
  { id: "e_Z_minX_maxY", axis: "Z", label: "Back-left vertical edge",   xPos: "min", yPos: "max" },
  { id: "e_Z_maxX_minY", axis: "Z", label: "Front-right vertical edge", xPos: "max", yPos: "min" },
  { id: "e_Z_maxX_maxY", axis: "Z", label: "Back-right vertical edge",  xPos: "max", yPos: "max" },
];

// ---------- Cube faces (6) ----------
export const CUBE_FACES = [
  { id: "f_minX", label: "Left face",   normal: [-1, 0, 0], edges: ["e_Y_minX_minZ", "e_Y_minX_maxZ", "e_Z_minX_minY", "e_Z_minX_maxY"] },
  { id: "f_maxX", label: "Right face",  normal: [ 1, 0, 0], edges: ["e_Y_maxX_minZ", "e_Y_maxX_maxZ", "e_Z_maxX_minY", "e_Z_maxX_maxY"] },
  { id: "f_minY", label: "Front face",  normal: [0, -1, 0], edges: ["e_X_minY_minZ", "e_X_minY_maxZ", "e_Z_minX_minY", "e_Z_maxX_minY"] },
  { id: "f_maxY", label: "Back face",   normal: [0,  1, 0], edges: ["e_X_maxY_minZ", "e_X_maxY_maxZ", "e_Z_minX_maxY", "e_Z_maxX_maxY"] },
  { id: "f_minZ", label: "Bottom face", normal: [0, 0, -1], edges: ["e_X_minY_minZ", "e_X_maxY_minZ", "e_Y_minX_minZ", "e_Y_maxX_minZ"] },
  { id: "f_maxZ", label: "Top face",    normal: [0, 0,  1], edges: ["e_X_minY_maxZ", "e_X_maxY_maxZ", "e_Y_minX_maxZ", "e_Y_maxX_maxZ"] },
];

// ---------- Cube vertices (8) ----------
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
// Cylinder axis is +Z (CAD up); top edge at +Z/2, bottom at -Z/2.
export const CYLINDER_EDGES = [
  { id: "e_top",    label: "Top edge" },
  { id: "e_bottom", label: "Bottom edge" },
];
export const CYLINDER_FACES = [
  { id: "f_top",    label: "Top face",    edges: ["e_top"] },
  { id: "f_bottom", label: "Bottom face", edges: ["e_bottom"] },
  { id: "f_side",   label: "Curved side", edges: ["e_top", "e_bottom"] },
];
export const CYLINDER_VERTICES = [{ id: "v_center", label: "Whole cylinder" }];

// ---------- Cone ----------
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

export function supportsEdgeFillets(type) {
  return type === "cube" || type === "cylinder" || type === "cone";
}

// Endpoint coords (object-local frame) for cube edges. With Z-up,
// the cube's local frame is 1:1 with dims:
//   dims.x → local X, dims.y → local Y, dims.z → local Z.
export function cubeEdgeEndpoints(dims) {
  const hx = (dims.x || 20) / 2;
  const hy = (dims.y || 20) / 2;
  const hz = (dims.z || 20) / 2;
  const f = (sign) => (sign === "max" ? 1 : -1);
  return CUBE_EDGES.map((e) => {
    let a, b;
    if (e.axis === "X") {
      const y = f(e.yPos) * hy;
      const z = f(e.zPos) * hz;
      a = [-hx, y, z]; b = [hx, y, z];
    } else if (e.axis === "Y") {
      const x = f(e.xPos) * hx;
      const z = f(e.zPos) * hz;
      a = [x, -hy, z]; b = [x, hy, z];
    } else { // Z
      const x = f(e.xPos) * hx;
      const y = f(e.yPos) * hy;
      a = [x, y, -hz]; b = [x, y, hz];
    }
    return { id: e.id, label: e.label, axis: e.axis, a, b };
  });
}

// Face centre + half-extents in object-local frame. The picker overlay
// rotates a PlaneGeometry from its default +Z normal onto each face's
// normal; `half[0]` is the plane's local-X half-extent (post-rotation
// it lies along the first in-face axis), `half[1]` is local-Y.
export function cubeFaceQuads(dims) {
  const hx = (dims.x || 20) / 2;
  const hy = (dims.y || 20) / 2;
  const hz = (dims.z || 20) / 2;
  return CUBE_FACES.map((f) => {
    let center, half, axis;
    if (f.id === "f_minX")      { center = [-hx, 0, 0];  half = [hz, hy]; axis = "X"; }
    else if (f.id === "f_maxX") { center = [ hx, 0, 0];  half = [hz, hy]; axis = "X"; }
    else if (f.id === "f_minY") { center = [0, -hy, 0];  half = [hx, hz]; axis = "Y"; }
    else if (f.id === "f_maxY") { center = [0,  hy, 0];  half = [hx, hz]; axis = "Y"; }
    else if (f.id === "f_minZ") { center = [0, 0, -hz];  half = [hx, hy]; axis = "Z"; }
    else                         { center = [0, 0,  hz];  half = [hx, hy]; axis = "Z"; }
    return { id: f.id, label: f.label, center, half, axis, normal: f.normal };
  });
}

export function cubeVertexPositions(dims) {
  const hx = (dims.x || 20) / 2;
  const hy = (dims.y || 20) / 2;
  const hz = (dims.z || 20) / 2;
  const f = (sign) => (sign === "max" ? 1 : -1);
  return CUBE_VERTICES.map((v) => {
    const m = v.id.match(/^v_(min|max)X_(min|max)Y_(min|max)Z$/);
    const sx = f(m[1]), sy = f(m[2]), sz = f(m[3]);
    return { id: v.id, label: v.label, p: [sx * hx, sy * hy, sz * hz] };
  });
}

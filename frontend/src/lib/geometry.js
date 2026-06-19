import * as THREE from "three";
import { mergeVertices, mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { buildSweepGeometry } from "./sweepGeometry";
import { buildTextureGeometry } from "./textureGeometry";
import {
  buildCylinderGeometryWithFillets,
  buildConeGeometryWithFillets,
  hasActiveEdgeFillets,
} from "./partialFillet";

// iter-104.1 — Z-up CAD convention.
//
//   • dims.x → world X (right)
//   • dims.y → world Y (forward, away from viewer)
//   • dims.z → world Z (up, height)
//   • position[0/1/2] = world X/Y/Z directly.
//
// Three.js primitives natively orient along Y (cylinder/cone axis,
// extrude direction). We rotate them at construction so their default
// axis is +Z. The user's dim labels then map 1:1 to world axes.

function _mergeGeometries(geoms) {
  const cleaned = geoms.map((g) => {
    const c = new THREE.BufferGeometry();
    if (!g.index) g.computeVertexNormals();
    const pos = g.attributes.position;
    c.setAttribute("position", pos.clone());
    if (g.attributes.normal) c.setAttribute("normal", g.attributes.normal.clone());
    if (g.index) c.setIndex(g.index.clone());
    return c;
  });
  const merged = mergeGeometries(cleaned, false);
  if (!merged) {
    // eslint-disable-next-line no-console
    console.warn("_mergeGeometries: fallback to first input (attribute mismatch)");
    return geoms[0];
  }
  merged.computeVertexNormals();
  return merged;
}

/**
 * Build a cylinder with chamfered or filleted top/bottom edges by lathing
 * a side-profile around the Y axis, then rotating the result so the
 * cylinder's main axis aligns with +Z (CAD Z-up convention).
 */
function buildLatheCylinder(r, h, edgeRadius, segments, edgeStyle) {
  const er = Math.min(edgeRadius, r - 0.001, h / 2 - 0.001);
  const half = h / 2;
  const points = [];
  points.push(new THREE.Vector2(0, -half));
  points.push(new THREE.Vector2(r - er, -half));
  if (edgeStyle === "chamfer") {
    points.push(new THREE.Vector2(r, -half + er));
  } else {
    const arcSegs = Math.max(2, Math.min(16, Math.round(segments / 8)));
    const cx = r - er, cy = -half + er;
    for (let i = 1; i <= arcSegs; i++) {
      const t = i / arcSegs;
      const a = -Math.PI / 2 + t * (Math.PI / 2);
      points.push(new THREE.Vector2(cx + Math.cos(a) * er, cy + Math.sin(a) * er));
    }
  }
  if (edgeStyle === "chamfer") {
    points.push(new THREE.Vector2(r, half - er));
  } else {
    points.push(new THREE.Vector2(r, half - er));
  }
  if (edgeStyle === "chamfer") {
    points.push(new THREE.Vector2(r - er, half));
  } else {
    const arcSegs = Math.max(2, Math.min(16, Math.round(segments / 8)));
    const cx = r - er, cy = half - er;
    for (let i = 1; i <= arcSegs; i++) {
      const t = i / arcSegs;
      const a = t * (Math.PI / 2);
      points.push(new THREE.Vector2(cx + Math.cos(a) * er, cy + Math.sin(a) * er));
    }
  }
  points.push(new THREE.Vector2(0, half));
  const g = new THREE.LatheGeometry(points, segments);
  // Lathe revolves around the Y axis; rotate so the axis aligns with +Z.
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * Build a cone with a filleted or chamfered base edge by lathing a side
 * profile around Y, then rotating so the cone's axis is +Z.
 */
function buildLatheCone(r, h, edgeRadius, segments, edgeStyle) {
  const er = Math.min(edgeRadius, r - 0.001, h - 0.001);
  const half = h / 2;
  const points = [];
  points.push(new THREE.Vector2(0, -half));
  points.push(new THREE.Vector2(r - er, -half));
  if (edgeStyle === "chamfer") {
    points.push(new THREE.Vector2(r, -half + er));
  } else {
    const arcSegs = Math.max(2, Math.min(16, Math.round(segments / 8)));
    const cx = r - er, cy = -half + er;
    for (let i = 1; i <= arcSegs; i++) {
      const t = i / arcSegs;
      const a = -Math.PI / 2 + t * (Math.PI / 2);
      points.push(new THREE.Vector2(cx + Math.cos(a) * er, cy + Math.sin(a) * er));
    }
  }
  points.push(new THREE.Vector2(0, half));
  const g = new THREE.LatheGeometry(points, segments);
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

// 2D shapes for ExtrudeGeometry. Returned in the XY plane, centred on
// origin. ExtrudeGeometry then extrudes along +Z — which IS the up axis
// in our Z-up convention, so 2D primitives stack along world Z naturally.
function buildShape2D(type, d) {
  const shape = new THREE.Shape();
  if (type === "triangle") {
    const r = d.r || 12;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
  } else if (type === "polygon") {
    const r = d.r || 12;
    const sides = Math.max(3, Math.min(24, d.sides | 0 || 6));
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
  } else if (type === "sketch") {
    const pts = Array.isArray(d.points) ? d.points : [];
    if (pts.length >= 3) {
      let cx = 0, cy = 0;
      for (const [x, y] of pts) { cx += x; cy += y; }
      cx /= pts.length; cy /= pts.length;
      shape.moveTo(pts[0][0] - cx, pts[0][1] - cy);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0] - cx, pts[i][1] - cy);
      shape.closePath();
    }
  }
  return shape;
}

/**
 * Build a Three.js BufferGeometry for a primitive description.
 * Returned geometry is centred on origin in the Z-up CAD frame:
 * dims.x → world X, dims.y → world Y, dims.z → world Z (up).
 */
export function buildGeometry(obj, scene = null) {
  const t = obj.type;
  const d = obj.dims || {};

  if (t === "cube") {
    const w = d.x || 20, depY = d.y || 20, h = d.z || 20;
    // BoxGeometry args are (width=X, height=Y, depth=Z) in three's
    // local frame. With DEFAULT_UP=+Z, "height" in three's API is the
    // forward axis (Y) and "depth" is the up axis (Z). Pass dims 1:1.
    if (hasActiveEdgeFillets(obj)) {
      return new THREE.BoxGeometry(w, depY, h);
    }
    const er = Math.max(0, d.edgeRadius || 0);
    if (er > 0.001) {
      const seg = (d.edgeStyle === "chamfer") ? 1 : 4;
      const clamped = Math.min(er, w / 2 - 0.001, depY / 2 - 0.001, h / 2 - 0.001);
      return new RoundedBoxGeometry(w, depY, h, seg, clamped);
    }
    return new THREE.BoxGeometry(w, depY, h);
  }
  if (t === "sphere") {
    return new THREE.SphereGeometry(d.r || 10, d.segments || 48, Math.max(16, (d.segments || 48) / 2));
  }
  if (t === "cylinder") {
    const r = d.r || 10, h = d.h || 20, segs = d.segments || 64;
    if (hasActiveEdgeFillets(obj)) {
      const g = buildCylinderGeometryWithFillets(obj);
      if (g) return g;
    }
    const er = Math.max(0, d.edgeRadius || 0);
    if (er > 0.001) {
      return buildLatheCylinder(r, h, er, segs, d.edgeStyle === "chamfer" ? "chamfer" : "fillet");
    }
    const g = new THREE.CylinderGeometry(r, r, h, segs);
    // CylinderGeometry's main axis is Y; rotate so axis is +Z.
    g.rotateX(Math.PI / 2);
    return g;
  }
  if (t === "cone") {
    const r = d.r || 10, h = d.h || 20, segs = d.segments || 64;
    if (hasActiveEdgeFillets(obj)) {
      const g = buildConeGeometryWithFillets(obj);
      if (g) return g;
    }
    const er = Math.max(0, d.edgeRadius || 0);
    if (er > 0.001) {
      return buildLatheCone(r, h, er, segs, d.edgeStyle === "chamfer" ? "chamfer" : "fillet");
    }
    if (d.r1 != null && d.r2 != null) {
      const g = new THREE.CylinderGeometry(d.r1, d.r2, h, segs);
      g.rotateX(Math.PI / 2);
      return g;
    }
    const g = new THREE.ConeGeometry(r, h, segs);
    g.rotateX(Math.PI / 2);
    return g;
  }
  if (t === "torus") {
    // TorusGeometry lies in XY plane (hole axis = +Z) — already Z-up.
    return new THREE.TorusGeometry(d.r || 12, d.tube || 4, 24, d.segments || 48);
  }
  if (t === "helix") {
    // Tube swept along a parametric helix.
    // helix(t) = ( R·cos(theta), R·sin(theta), pitch·turns·t − H/2 )
    // where theta = 2π·turns·t and t ∈ [0, 1]. The helix axis is +Z.
    const R = d.r || 12;
    const tube = d.tube || 2;
    const pitch = d.pitch || 6;
    const turns = Math.max(0.25, d.turns || 4);
    const tubularSegs = Math.max(32, d.segments || 96);
    const radialSegs = 12;
    const H = pitch * turns;
    class HelixCurve extends THREE.Curve {
      getPoint(u, target = new THREE.Vector3()) {
        const theta = 2 * Math.PI * turns * u;
        const z = pitch * turns * u - H / 2;
        return target.set(R * Math.cos(theta), R * Math.sin(theta), z);
      }
    }
    return new THREE.TubeGeometry(new HelixCurve(), tubularSegs, tube, radialSegs, false);
  }
  if (t === "bolt") {
    // Bolt with hex/button head + cylindrical shaft + helical thread.
    // All sub-pieces are built along their NATIVE +Y axis (cylinder
    // default) then merged. The whole merged geometry is rotated
    // X by 90° at the end so the bolt's long axis is +Z.
    const R = d.r || 5;
    const pitch = Math.max(0.25, d.pitch || 1.5);
    const Hshaft = Math.max(1, d.h || 20);
    const headR = d.headR || 8;
    const headH = Math.max(0.5, d.headH || 4);
    const segs = Math.max(24, d.segments || 48);
    const turns = Hshaft / pitch;
    const tubeR = Math.max(0.15, pitch * 0.25);
    const coreR = R - tubeR * 0.7;
    const shaft = new THREE.CylinderGeometry(coreR, coreR, Hshaft, segs);
    shaft.translate(0, headH + Hshaft / 2, 0);
    class _ThreadCurve extends THREE.Curve {
      getPoint(u, target = new THREE.Vector3()) {
        const theta = 2 * Math.PI * turns * u;
        const y = u * Hshaft;
        return target.set(R * Math.cos(theta), y, R * Math.sin(theta));
      }
    }
    const thread = new THREE.TubeGeometry(new _ThreadCurve(), Math.max(64, Math.ceil(turns * 12)), tubeR, 6, false);
    thread.translate(0, headH, 0);
    const headSides = d.headStyle === "button" ? Math.max(24, segs) : 6;
    const head = new THREE.CylinderGeometry(headR, headR, headH, headSides);
    head.translate(0, headH / 2, 0);
    const merged = _mergeGeometries([shaft, thread, head]);
    const totalH = headH + Hshaft;
    merged.translate(0, -totalH / 2, 0);
    // Re-orient so bolt's long axis is +Z.
    merged.rotateX(Math.PI / 2);
    return merged;
  }
  if (t === "nut") {
    const R = d.r || 5;
    const pitch = Math.max(0.25, d.pitch || 1.5);
    const Hnut = Math.max(1, d.h || 5);
    const flatR = d.flatR || 8;
    const segs = Math.max(24, d.segments || 48);
    const turns = Hnut / pitch;
    const tubeR = Math.max(0.15, pitch * 0.25);
    const prism = new THREE.CylinderGeometry(flatR, flatR, Hnut, 6);
    prism.translate(0, Hnut / 2, 0);
    const innerR = R - tubeR * 0.7;
    class _InnerThread extends THREE.Curve {
      getPoint(u, target = new THREE.Vector3()) {
        const theta = 2 * Math.PI * turns * u;
        const y = u * Hnut;
        return target.set(innerR * Math.cos(theta), y, innerR * Math.sin(theta));
      }
    }
    const thread = new THREE.TubeGeometry(new _InnerThread(), Math.max(48, Math.ceil(turns * 12)), tubeR, 6, false);
    const merged = _mergeGeometries([prism, thread]);
    merged.translate(0, -Hnut / 2, 0);
    merged.rotateX(Math.PI / 2);
    return merged;
  }
  if (t === "spline") {
    // Splined shaft — core cylinder + N angular teeth. Native +Y axis,
    // then rotated to +Z at the end.
    const Rcore = Math.max(0.5, d.r || 6);
    const H = Math.max(1, d.h || 30);
    const N = Math.max(2, Math.min(64, Math.round(d.teeth || 8)));
    const toothH = Math.max(0.1, d.toothHeight || 1.2);
    const toothDeg = Math.max(1, Math.min(360 / N - 0.5, d.toothWidthDeg || 12));
    const profile = d.profile || "rectangular";
    const segs = Math.max(24, d.segments || 32);
    const core = new THREE.CylinderGeometry(Rcore, Rcore, H, segs);
    core.translate(0, H / 2, 0);
    const chord = 2 * Rcore * Math.sin((toothDeg * Math.PI) / 360);
    const teeth = [];
    for (let i = 0; i < N; i++) {
      const theta = (i * 2 * Math.PI) / N;
      let g;
      if (profile === "rounded") {
        g = new THREE.CylinderGeometry(chord / 2, chord / 2, H, 16, 1);
        g.translate(0, H / 2, 0);
        g.translate(Rcore + chord / 2 - chord / 6, 0, 0);
      } else if (profile === "triangular") {
        g = new THREE.CylinderGeometry(0.001, chord / 2, H, 3, 1);
        g.translate(0, H / 2, 0);
        g.rotateZ(-Math.PI / 2);
        g.translate(Rcore + toothH / 2, 0, 0);
        g.scale(toothH / H, 1, 1);
      } else {
        g = new THREE.BoxGeometry(toothH, H, chord);
        g.translate(Rcore + toothH / 2, H / 2, 0);
      }
      g.rotateY(theta);
      teeth.push(g);
    }
    const merged = _mergeGeometries([core, ...teeth]);
    merged.translate(0, -H / 2, 0);
    merged.rotateX(Math.PI / 2);
    return merged;
  }
  if (t === "pipe") {
    // Hollow cylinder via LatheGeometry (revolves around Y), rotated
    // so the pipe's axis is +Z.
    const Router = d.r || 12;
    const wall = Math.max(0.2, d.wall || 2);
    const Rinner = Math.max(0.1, Router - wall);
    const H = d.h || 30;
    const segs = Math.max(16, d.segments || 64);
    const half = H / 2;
    const profile = [
      new THREE.Vector2(Router, -half),
      new THREE.Vector2(Router,  half),
      new THREE.Vector2(Rinner,  half),
      new THREE.Vector2(Rinner, -half),
      new THREE.Vector2(Router, -half),
    ];
    const g = new THREE.LatheGeometry(profile, segs);
    g.rotateX(Math.PI / 2);
    return g;
  }
  if (t === "wedge") {
    // Right-triangle profile in the YZ plane, extruded along X.
    // Ramp: Z=0 at +Y (front, full width) to Z=H at -Y (back).
    // dims.x = along-X length, dims.y = front-to-back depth, dims.z = height.
    const X = d.x || 24, Y = d.y || 16, Z = d.z || 24;
    const shape = new THREE.Shape();
    // Triangle in XY plane (will be extruded along Z natively, then re-oriented).
    shape.moveTo(-Y / 2, 0);
    shape.lineTo( Y / 2, 0);
    shape.lineTo(-Y / 2, Z);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: X, bevelEnabled: false });
    // Extrude is along +Z (shape XY → extruded into Z). Re-orient so:
    //   shape X (front-to-back) → world Y
    //   shape Y (height)        → world Z
    //   extrusion Z (length)    → world X
    g.rotateY(Math.PI / 2);    // swap shape Z (extrusion) ↔ world X
    g.translate(-X / 2, 0, 0); // centre along X
    g.translate(0, 0, -Z / 2); // centre vertically along Z so bbox sits on origin
    g.computeVertexNormals();
    return g;
  }

  // ---- 2D shapes (thin wafer / slabs stacked along Z) ----
  if (t === "circle") {
    // Thin cylinder with axis +Z.
    const g = new THREE.CylinderGeometry(d.r || 10, d.r || 10, d.h || 1, 48);
    g.rotateX(Math.PI / 2);
    return g;
  }
  if (t === "square2d") {
    const s = d.side || 20;
    // BoxGeometry(width=X, height=Y, depth=Z); we want X = Y = s with thin Z.
    return new THREE.BoxGeometry(s, s, d.h || 1);
  }
  if (t === "triangle" || t === "polygon" || t === "sketch") {
    const shape = buildShape2D(t, d);
    const g = new THREE.ExtrudeGeometry(shape, { depth: d.h || 1, bevelEnabled: false });
    // ExtrudeGeometry: shape in XY plane, extruded along +Z (which IS the
    // up axis in Z-up). Centre the extrusion so the bottom sits at Z=0
    // in object space and the centroid is at z = h/2.
    g.translate(0, 0, -(d.h || 1) / 2);
    g.computeVertexNormals();
    return g;
  }

  if (t === "sweep") {
    const swept = buildSweepGeometry(obj, scene);
    if (swept) return swept;
    return new THREE.BoxGeometry(2, 2, 2);
  }

  if (t === "texture") {
    return buildTextureGeometry(obj);
  }

  if (t === "imported" && obj.geometry) {
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array(obj.geometry.vertices);
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    if (obj.geometry.indices) {
      const idx = new Uint32Array(obj.geometry.indices);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.computeVertexNormals();
    const ensureUV = (geom) => {
      const posCount = geom.attributes.position?.count || 0;
      if (!geom.attributes.uv && posCount > 0) {
        geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(posCount * 2), 2));
      }
      return geom;
    };
    try {
      const merged = mergeVertices(g, 1e-4);
      merged.computeVertexNormals();
      return ensureUV(merged);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("mergeVertices failed for imported mesh, CSG may misbehave:", err);
      return ensureUV(g);
    }
  }
  return new THREE.BoxGeometry(10, 10, 10);
}

/**
 * Compute the base (scale = 1) size of an object along each world axis
 * in mm. With Z-up convention, dim.x/y/z map 1:1 to world X/Y/Z.
 */
export function getBaseSize(obj) {
  const t = obj.type, d = obj.dims || {};
  if (t === "cube") return { x: d.x || 20, y: d.y || 20, z: d.z || 20 };
  if (t === "sphere") {
    const r = d.r || 10;
    return { x: 2 * r, y: 2 * r, z: 2 * r };
  }
  if (t === "cylinder" || t === "cone") {
    const r = d.r || 10;
    // Cylinder axis is +Z (height), radial extent on X/Y.
    return { x: 2 * r, y: 2 * r, z: d.h || 20 };
  }
  if (t === "torus") {
    const r = d.r || 12, tube = d.tube || 4;
    // Torus in XY plane (hole axis = +Z); ring spreads on X/Y, thickness on Z.
    return { x: 2 * (r + tube), y: 2 * (r + tube), z: 2 * tube };
  }
  if (t === "helix") {
    const r = d.r || 12, tube = d.tube || 2;
    const H = (d.turns || 4) * (d.pitch || 6);
    return { x: 2 * (r + tube), y: 2 * (r + tube), z: H };
  }
  if (t === "pipe") {
    const r = d.r || 12;
    return { x: 2 * r, y: 2 * r, z: d.h || 30 };
  }
  if (t === "wedge") {
    return { x: d.x || 24, y: d.y || 16, z: d.z || 24 };
  }
  if (t === "bolt") {
    const R = d.r || 5, headR = d.headR || 8;
    const Z = (d.headH || 4) + (d.h || 20);
    const outerR = Math.max(R, headR);
    return { x: 2 * outerR, y: 2 * outerR, z: Z };
  }
  if (t === "nut") {
    const flatR = d.flatR || 8;
    return { x: 2 * flatR, y: 2 * flatR, z: d.h || 5 };
  }
  if (t === "spline") {
    const Rcore = d.r || 6;
    const tH = d.toothHeight || 1.2;
    const outerR = Rcore + tH;
    return { x: 2 * outerR, y: 2 * outerR, z: d.h || 30 };
  }
  if (t === "circle") {
    const r = d.r || 10;
    return { x: 2 * r, y: 2 * r, z: d.h || 1 };
  }
  if (t === "square2d") {
    const s = d.side || 20;
    return { x: s, y: s, z: d.h || 1 };
  }
  if (t === "triangle") {
    const r = d.r || 12;
    return { x: r * Math.sqrt(3), y: r * 1.5, z: d.h || 1 };
  }
  if (t === "polygon") {
    const r = d.r || 12;
    return { x: 2 * r, y: 2 * r, z: d.h || 1 };
  }
  if (t === "sketch") {
    const pts = Array.isArray(d.points) ? d.points : [];
    if (pts.length >= 3) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of pts) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return { x: maxX - minX, y: maxY - minY, z: d.h || 5 };
    }
    return { x: 10, y: 10, z: d.h || 5 };
  }
  if (t === "imported" && obj.originalBbox) {
    return { x: obj.originalBbox.x, y: obj.originalBbox.y, z: obj.originalBbox.z };
  }
  return { x: 1, y: 1, z: 1 };
}

/**
 * Apply position/rotation/scale to a Mesh. Rotation is in degrees.
 */
export function applyTransform(mesh, obj) {
  mesh.position.set(obj.position[0], obj.position[1], obj.position[2]);
  mesh.rotation.set(
    THREE.MathUtils.degToRad(obj.rotation[0]),
    THREE.MathUtils.degToRad(obj.rotation[1]),
    THREE.MathUtils.degToRad(obj.rotation[2])
  );
  mesh.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
}

/**
 * Compute the bounding box of an object's geometry AFTER applying its
 * rotation and scale (but NOT translation). Returns { min:{x,y,z}, max:{x,y,z} }
 * in world axes. Used by dropToBed (compares bb.min.z to compute Z offset).
 */
export function computeRotatedBBox(obj) {
  const g = buildGeometry(obj);
  const mat = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(obj.rotation[0]),
      THREE.MathUtils.degToRad(obj.rotation[1]),
      THREE.MathUtils.degToRad(obj.rotation[2])
    )
  );
  mat.compose(
    new THREE.Vector3(0, 0, 0),
    q,
    new THREE.Vector3(obj.scale[0], obj.scale[1], obj.scale[2])
  );
  g.applyMatrix4(mat);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.dispose();
  return {
    min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
    max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
  };
}

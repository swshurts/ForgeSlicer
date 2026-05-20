import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Build a cylinder with chamfered or filleted top/bottom edges by lathing
 * a side-profile around the Y axis. When edgeRadius <= 0 we fall through to
 * the regular CylinderGeometry caller.
 *
 *   edgeStyle: "fillet"  → quarter-arc (rounded)
 *   edgeStyle: "chamfer" → single 45° bevel
 */
function buildLatheCylinder(r, h, edgeRadius, segments, edgeStyle) {
  const er = Math.min(edgeRadius, r - 0.001, h / 2 - 0.001);
  const half = h / 2;
  const points = [];
  // Start on the axis at the bottom so the bottom cap is closed.
  points.push(new THREE.Vector2(0, -half));
  points.push(new THREE.Vector2(r - er, -half));
  if (edgeStyle === "chamfer") {
    points.push(new THREE.Vector2(r, -half + er));
  } else {
    // Quarter-arc: from (r - er, -half) sweeping to (r, -half + er).
    const arcSegs = Math.max(2, Math.min(16, Math.round(segments / 8)));
    const cx = r - er, cy = -half + er;
    for (let i = 1; i <= arcSegs; i++) {
      const t = i / arcSegs;
      const a = -Math.PI / 2 + t * (Math.PI / 2);
      points.push(new THREE.Vector2(cx + Math.cos(a) * er, cy + Math.sin(a) * er));
    }
  }
  // Straight side wall.
  if (edgeStyle === "chamfer") {
    points.push(new THREE.Vector2(r, half - er));
  } else {
    // (r, -half + er) already in the array — keep walking up the wall.
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
  // Close the top cap by walking back to the axis.
  points.push(new THREE.Vector2(0, half));
  const g = new THREE.LatheGeometry(points, segments);
  g.computeVertexNormals();
  return g;
}

// Build a flat Shape for the 2D primitives (used by ExtrudeGeometry).
// All shapes are returned centered on (0, 0) in the X–Y plane; THREE's
// ExtrudeGeometry then extrudes them along +Z, so we rotate the result
// onto its side later so the wafer/extrusion lies flat on the build
// plate (the user "stacks" along world Y).
function buildShape2D(type, d) {
  const shape = new THREE.Shape();
  if (type === "triangle") {
    const r = d.r || 12;
    // Equilateral triangle inscribed in a circle of radius r,
    // apex pointing along +Y so it reads naturally as a triangle.
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
  }
  return shape;
}

/**
 * Build a three.js BufferGeometry for a primitive description.
 * Returns geometry centered at object origin so transforms apply correctly.
 */
export function buildGeometry(obj) {
  const t = obj.type;
  const d = obj.dims || {};

  if (t === "cube") {
    const w = d.x || 20, h = d.z || 20, dep = d.y || 20;
    const er = Math.max(0, d.edgeRadius || 0);
    if (er > 0.001) {
      // segments=1 → chamfered (single bevel); 4 → fillet (smooth round).
      const seg = (d.edgeStyle === "chamfer") ? 1 : 4;
      const clamped = Math.min(er, w / 2 - 0.001, h / 2 - 0.001, dep / 2 - 0.001);
      return new RoundedBoxGeometry(w, h, dep, seg, clamped);
    }
    return new THREE.BoxGeometry(w, h, dep);
    // Note: three.js Y is up; we map our z->Y (height) so that "z" dim feels like up
  }
  if (t === "sphere") {
    return new THREE.SphereGeometry(d.r || 10, d.segments || 48, Math.max(16, (d.segments || 48) / 2));
  }
  if (t === "cylinder") {
    const r = d.r || 10, h = d.h || 20, segs = d.segments || 64;
    const er = Math.max(0, d.edgeRadius || 0);
    if (er > 0.001) {
      return buildLatheCylinder(r, h, er, segs, d.edgeStyle === "chamfer" ? "chamfer" : "fillet");
    }
    return new THREE.CylinderGeometry(r, r, h, segs);
  }
  if (t === "cone") {
    return new THREE.ConeGeometry(d.r || 10, d.h || 20, d.segments || 64);
  }
  if (t === "torus") {
    return new THREE.TorusGeometry(d.r || 12, d.tube || 4, 24, d.segments || 48);
  }

  // ---- 2D shapes (extruded thin slabs that orient flat on the bed) ----
  if (t === "circle") {
    // A circle extruded along world-Y is just a thin cylinder.
    return new THREE.CylinderGeometry(d.r || 10, d.r || 10, d.h || 1, 48);
  }
  if (t === "square2d") {
    const s = d.side || 20;
    return new THREE.BoxGeometry(s, d.h || 1, s);
  }
  if (t === "triangle" || t === "polygon") {
    const shape = buildShape2D(t, d);
    const g = new THREE.ExtrudeGeometry(shape, { depth: d.h || 1, bevelEnabled: false });
    // ExtrudeGeometry extrudes along +Z; rotate so depth aligns with world Y
    // and the shape's outline lies on the X–Z build plate.
    g.rotateX(-Math.PI / 2);
    // After the rotateX the extrusion runs along -Y; shift up so the
    // base of the extrusion sits at Y = 0 in object space.
    g.translate(0, d.h || 1, 0);
    // Recenter Y so the centroid is at y = h/2 (matches how cylinder/box
    // geometries are constructed) — this keeps Drop-to-Bed math consistent.
    g.translate(0, -(d.h || 1) / 2, 0);
    g.computeVertexNormals();
    return g;
  }

  if (t === "imported" && obj.geometry) {
    const g = new THREE.BufferGeometry();
    // Clone the vertex array so consumers like dropToBed and CSG (which
    // call `applyMatrix4` to bake transforms) don't mutate the canonical
    // copy stored in our Zustand state.
    const verts = new Float32Array(obj.geometry.vertices);
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    if (obj.geometry.indices) {
      const idx = new Uint32Array(obj.geometry.indices);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.computeVertexNormals();
    // three-bvh-csg's Brush expects position + normal + uv attributes
    // (`GeometryBuilder.initFromGeometry` blindly reads `uv.array` and
    // throws TypeError if absent). STL imports never carry UVs, so we
    // synthesize a zero-filled uv buffer matching the vertex count. After
    // merging, recompute everything so it matches the merged vertex count.
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
 * Compute the base (scale = 1) size of an object along each axis in mm.
 * Used by the Scale popup to translate between scale factor and real size.
 */
export function getBaseSize(obj) {
  const t = obj.type, d = obj.dims || {};
  if (t === "cube") return { x: d.x || 20, y: d.z || 20, z: d.y || 20 };
  if (t === "sphere") {
    const r = d.r || 10;
    return { x: 2 * r, y: 2 * r, z: 2 * r };
  }
  if (t === "cylinder" || t === "cone") {
    const r = d.r || 10;
    return { x: 2 * r, y: d.h || 20, z: 2 * r };
  }
  if (t === "torus") {
    const r = d.r || 12, tube = d.tube || 4;
    return { x: 2 * (r + tube), y: 2 * tube, z: 2 * (r + tube) };
  }
  if (t === "circle") {
    const r = d.r || 10;
    return { x: 2 * r, y: d.h || 1, z: 2 * r };
  }
  if (t === "square2d") {
    const s = d.side || 20;
    return { x: s, y: d.h || 1, z: s };
  }
  if (t === "triangle") {
    const r = d.r || 12;
    return { x: r * Math.sqrt(3), y: d.h || 1, z: r * 1.5 };
  }
  if (t === "polygon") {
    const r = d.r || 12;
    return { x: 2 * r, y: d.h || 1, z: 2 * r };
  }
  if (t === "imported" && obj.originalBbox) {
    return { x: obj.originalBbox.x, y: obj.originalBbox.y, z: obj.originalBbox.z };
  }
  return { x: 1, y: 1, z: 1 };
}

/**
 * Apply position/rotation/scale to a Mesh. Rotation is in degrees in our store.
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
 * rotation and scale (but NOT translation). Returns { min:{x,y,z}, max:{x,y,z} }.
 * Used by dropToBed to compute the new Y offset.
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

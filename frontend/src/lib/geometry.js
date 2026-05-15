import * as THREE from "three";

/**
 * Build a three.js BufferGeometry for a primitive description.
 * Returns geometry centered at object origin so transforms apply correctly.
 */
export function buildGeometry(obj) {
  const t = obj.type;
  const d = obj.dims || {};

  if (t === "cube") {
    return new THREE.BoxGeometry(d.x || 20, d.z || 20, d.y || 20);
    // Note: three.js Y is up; we map our z->Y (height) so that "z" dim feels like up
  }
  if (t === "sphere") {
    return new THREE.SphereGeometry(d.r || 10, d.segments || 48, Math.max(16, (d.segments || 48) / 2));
  }
  if (t === "cylinder") {
    return new THREE.CylinderGeometry(d.r || 10, d.r || 10, d.h || 20, d.segments || 64);
  }
  if (t === "cone") {
    return new THREE.ConeGeometry(d.r || 10, d.h || 20, d.segments || 64);
  }
  if (t === "torus") {
    return new THREE.TorusGeometry(d.r || 12, d.tube || 4, 24, d.segments || 48);
  }
  if (t === "imported" && obj.geometry) {
    const g = new THREE.BufferGeometry();
    const verts = obj.geometry.vertices instanceof Float32Array
      ? obj.geometry.vertices
      : new Float32Array(obj.geometry.vertices);
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    if (obj.geometry.indices) {
      const idx = obj.geometry.indices instanceof Uint32Array
        ? obj.geometry.indices
        : new Uint32Array(obj.geometry.indices);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.computeVertexNormals();
    return g;
  }
  return new THREE.BoxGeometry(10, 10, 10);
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

// Mesh repair for non-manifold imported STLs (AI-generated, photogrammetry,
// thin-shell scans). The previous parity-based inside/outside test was
// unreliable on thin-shell meshes — internal triangles fooled the ray
// crossings and the marching-cubes output collapsed to the bounding box.
//
// This rewrite uses **closest-point signed distance**: for every voxel
// sample we ask MeshBVH for the nearest point on the mesh, then look at
// the dot product of (query - closestPoint) with the face normal of the
// hit triangle. Positive → outside, negative → inside. The magnitude is
// the true Euclidean distance.
//
// This is the same approach Meshmixer's "Make Solid" preview, libigl's
// signed_distance, and Three.js' three-mesh-bvh "BVH Signed Distance"
// example use. It's robust on non-manifold inputs because we don't depend
// on ray-crossing parity — we only need a triangle's normal to be a
// reasonable approximation of the surface orientation. AI meshes from
// Meshy/Tripo/etc. ship with consistent face winding from training, so
// face normals are reliable even when topology is broken.

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { getManifold } from "./manifoldEngine";

const _qp = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * Voxel-remesh an imported BufferGeometry into a guaranteed-watertight
 * solid via closest-point signed distance + manifold-3d's level-set.
 *
 *   geometry — input BufferGeometry in *local* space (no transforms baked in).
 *   opts:
 *     voxelSize  — edge length of each voxel in local units (mm). Defaults
 *                  to ~0.7% of bbox diagonal, clamped to [0.5, 1.5] mm.
 *                  Smaller = sharper features, slower, more memory.
 *     onProgress — optional (0..1) callback for the UI's progress bar.
 *
 * Returns { geometry, stats } where stats includes voxelSize and tri counts.
 */
export async function repairMeshGeometry(geometry, opts = {}) {
  const { onProgress } = opts;

  // Make sure we have non-indexed → indexed; closestPointToPoint returns
  // a faceIndex either way but face-normal lookup is cleaner with indices.
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) throw new Error("Geometry has no bounding box.");

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const diag = size.length();
  if (!isFinite(diag) || diag <= 0) throw new Error("Geometry is empty.");

  // Auto voxel size: ~0.7% of diagonal, clamped. On a 175 mm hydrant that's
  // ~1.2 mm — fine enough to resolve 2 mm flange ridges and 10 mm spouts.
  const auto = Math.max(0.5, Math.min(1.5, diag * 0.007));
  const voxel = Math.max(0.1, Number(opts.voxelSize) || auto);

  // Pad bbox by 3 voxels so marching cubes has room to close the surface
  // around outermost features.
  const pad = voxel * 3;
  const minVec = bbox.min.clone().subScalar(pad);
  const maxVec = bbox.max.clone().addScalar(pad);

  // Pre-compute per-triangle face normals (we'll look these up in the SDF
  // hot loop — 100s of thousands of calls — so caching matters).
  const pos = geometry.attributes.position.array;
  const idx = geometry.index ? geometry.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const faceNormals = new Float32Array(triCount * 3);
  const ax = new THREE.Vector3();
  const bx = new THREE.Vector3();
  const cx = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx[t * 3] * 3 : t * 9;
    const ib = idx ? idx[t * 3 + 1] * 3 : t * 9 + 3;
    const ic = idx ? idx[t * 3 + 2] * 3 : t * 9 + 6;
    ax.set(pos[ia], pos[ia + 1], pos[ia + 2]);
    bx.set(pos[ib], pos[ib + 1], pos[ib + 2]);
    cx.set(pos[ic], pos[ic + 1], pos[ic + 2]);
    e1.subVectors(bx, ax);
    e2.subVectors(cx, ax);
    n.crossVectors(e1, e2);
    const len = n.length();
    if (len > 1e-20) n.divideScalar(len);
    else n.set(0, 0, 1); // degenerate triangle fallback
    faceNormals[t * 3] = n.x;
    faceNormals[t * 3 + 1] = n.y;
    faceNormals[t * 3 + 2] = n.z;
  }

  const bvh = new MeshBVH(geometry);
  if (onProgress) onProgress(0.1);

  const closest = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

  let sampleCount = 0;
  const totalEst = Math.max(
    1,
    Math.ceil((maxVec.x - minVec.x) / voxel) *
      Math.ceil((maxVec.y - minVec.y) / voxel) *
      Math.ceil((maxVec.z - minVec.z) / voxel)
  );

  // SDF callback. manifold-3d invokes this for every sample on its
  // marching-cubes grid; it expects a real-valued signed distance with
  // negative = inside, positive = outside.
  const sdf = (p) => {
    sampleCount++;
    if ((sampleCount & 0x3fff) === 0 && onProgress) {
      onProgress(0.1 + 0.8 * Math.min(1, sampleCount / totalEst));
    }
    _qp.set(p[0], p[1], p[2]);
    bvh.closestPointToPoint(_qp, closest);
    const fi = closest.faceIndex * 3;
    _v.set(
      _qp.x - closest.point.x,
      _qp.y - closest.point.y,
      _qp.z - closest.point.z
    );
    const dot =
      _v.x * faceNormals[fi] +
      _v.y * faceNormals[fi + 1] +
      _v.z * faceNormals[fi + 2];
    // dot < 0 → query is on the "back side" of the closest triangle's
    // normal → inside. The SDF magnitude is the true Euclidean distance.
    return dot < 0 ? -closest.distance : closest.distance;
  };

  const wasm = await getManifold();
  const bounds = {
    min: [minVec.x, minVec.y, minVec.z],
    max: [maxVec.x, maxVec.y, maxVec.z],
  };

  const m = wasm.Manifold.levelSet(sdf, bounds, voxel, 0);
  if (onProgress) onProgress(0.95);
  const mesh = m.getMesh();

  if (!mesh.vertProperties.length || !mesh.triVerts.length) {
    m.delete();
    throw new Error("Repair produced an empty mesh — try a smaller voxel size.");
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3)
  );
  out.setIndex(
    new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1)
  );
  out.computeVertexNormals();
  out.computeBoundingBox();

  const stats = {
    voxelSize: voxel,
    inputTris: triCount,
    outputTris: mesh.triVerts.length / 3,
  };

  m.delete();
  if (onProgress) onProgress(1);
  return { geometry: out, stats };
}

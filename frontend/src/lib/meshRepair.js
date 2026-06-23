// Aggressive mesh repair for non-manifold imported STLs (AI-generated,
// photogrammetry, malformed CAD exports). The auto-repair pipeline in
// `manifoldEngine.js` handles micro-seams via progressive vertex welding,
// but it gives up when the input has real topology defects: open edges,
// flipped normals, self-intersections, or thin-shell scans without a
// closed interior.
//
// This module rebuilds such a mesh from scratch using a sign-only signed
// distance field + manifold-3d's `levelSet` (marching cubes). The result
// is GUARANTEED watertight & manifold — at the cost of some fine detail
// proportional to the voxel size the user picks.

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { getManifold } from "./manifoldEngine";

const _ray = new THREE.Ray();
const _xDir = new THREE.Vector3(1, 0, 0);

/**
 * Repair a BufferGeometry by voxel-remeshing it.
 *
 *   geometry  - input THREE.BufferGeometry in *local* space (no transforms baked in)
 *   opts:
 *     voxelSize - edge length of each voxel in local units (mm). Defaults to
 *                 ~1% of the model's bbox diagonal, clamped to [0.5, 2.0] mm.
 *                 Smaller = more detail, slower, more memory.
 *     onProgress - optional (0..1) progress callback for the UI.
 *
 * Returns a new BufferGeometry. The caller is responsible for swapping it
 * into the scene object (and clearing the old geometry).
 */
export async function repairMeshGeometry(geometry, opts = {}) {
  const { onProgress } = opts;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) throw new Error("Geometry has no bounding box.");

  const size = new THREE.Vector3();
  bbox.getSize(size);
  const diag = size.length();
  if (!isFinite(diag) || diag <= 0) throw new Error("Geometry is empty.");

  // Pick a voxel size proportional to the model. A 100 mm hydrant gets
  // ~1 mm voxels (~50³ grid); a 10 mm trinket gets the floor (0.5 mm,
  // 20³ grid); a 500 mm cosplay piece caps at 2 mm to keep memory sane.
  // Power user can override via opts.voxelSize.
  const auto = Math.max(0.5, Math.min(2.0, diag * 0.01));
  const voxel = Math.max(0.1, Number(opts.voxelSize) || auto);

  // Pad bbox by 3 voxels so the level-set has room to close the surface
  // around the model's outermost features.
  const pad = voxel * 3;
  const minVec = bbox.min.clone().subScalar(pad);
  const maxVec = bbox.max.clone().addScalar(pad);

  // Build a BVH for fast inside/outside ray queries. Triangle-soup input
  // (non-indexed) is fine — MeshBVH handles both.
  const bvh = new MeshBVH(geometry);
  if (onProgress) onProgress(0.15);

  // For a clean concave model, parity counting along ±X is reliable. For
  // shells with self-intersections we vote across 3 axis-aligned rays to
  // suppress single-direction false positives. The hit-count parity gives
  // us inside/outside; the SDF value is just ±1 (manifold-3d's level-set
  // only needs sign for the iso-surface).
  let sampleCount = 0;
  const sampleSdf = (p) => {
    sampleCount++;
    if (sampleCount % 20000 === 0 && onProgress) {
      // Progress is approximate — manifold-3d will call us roughly
      // (gridX * gridY * gridZ) times depending on its internal pruning.
      onProgress(Math.min(0.85, 0.15 + sampleCount / 250000));
    }
    let inside = 0;
    // +X ray
    _ray.origin.set(p[0], p[1], p[2]);
    _ray.direction.copy(_xDir);
    if (bvh.raycast(_ray, THREE.DoubleSide).length % 2 === 1) inside++;
    // +Y ray
    _ray.direction.set(0, 1, 0);
    if (bvh.raycast(_ray, THREE.DoubleSide).length % 2 === 1) inside++;
    // +Z ray
    _ray.direction.set(0, 0, 1);
    if (bvh.raycast(_ray, THREE.DoubleSide).length % 2 === 1) inside++;
    // Majority vote: inside if ≥2 of 3 rays say so.
    return inside >= 2 ? -1 : 1;
  };

  const wasm = await getManifold();
  const bounds = {
    min: [minVec.x, minVec.y, minVec.z],
    max: [maxVec.x, maxVec.y, maxVec.z],
  };

  const m = wasm.Manifold.levelSet(sampleSdf, bounds, voxel, 0);
  if (onProgress) onProgress(0.95);
  const mesh = m.getMesh();

  if (!mesh.vertProperties.length || !mesh.triVerts.length) {
    m.delete();
    throw new Error("Repair produced an empty mesh — try a smaller voxel size.");
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3));
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  out.computeVertexNormals();
  out.computeBoundingBox();

  const stats = {
    voxelSize: voxel,
    inputTris: (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3,
    outputTris: mesh.triVerts.length / 3,
  };

  m.delete();
  if (onProgress) onProgress(1);
  return { geometry: out, stats };
}

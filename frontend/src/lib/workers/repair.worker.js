// Dedicated worker for voxel-remesh repair of non-manifold imported
// geometry. Runs entirely off the main thread so the page stays
// responsive while the long synchronous `Manifold.levelSet` call grinds
// through hundreds of thousands of samples.
//
// Protocol:
//   IN:  { id, vertices: Float32Array, indices: Uint32Array | null, voxelSize?: number }
//   OUT: progress  { type: "progress", id, value }           (0..1, optional)
//   OUT: success   { type: "success",  id, vertices, indices, stats }
//   OUT: error     { type: "error",    id, message }

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { getManifold } from "../manifoldEngine";

const _qp = new THREE.Vector3();
const _v = new THREE.Vector3();

async function repair({ id, vertices, indices, voxelSize }) {
  // Reconstruct a BufferGeometry from the transferred typed arrays.
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  if (indices) geom.setIndex(new THREE.BufferAttribute(indices, 1));

  geom.computeBoundingBox();
  const bbox = geom.boundingBox;
  if (!bbox) throw new Error("Geometry has no bounding box.");

  const sizeV = new THREE.Vector3();
  bbox.getSize(sizeV);
  const diag = sizeV.length();
  if (!isFinite(diag) || diag <= 0) throw new Error("Geometry is empty.");

  // ~1.2% of diagonal, clamped to a safe range. On a 175 mm hydrant that
  // yields ~2 mm voxels — coarse enough to keep manifold-3d's level-set
  // grinding under a few seconds but fine enough that spouts, flange, and
  // dome all survive recognisably.
  const auto = Math.max(1.2, Math.min(2.5, diag * 0.012));
  const voxel = Math.max(0.5, Number(voxelSize) || auto);

  const pad = voxel * 3;
  const minVec = bbox.min.clone().subScalar(pad);
  const maxVec = bbox.max.clone().addScalar(pad);

  // Pre-compute per-triangle face normals.
  const pos = geom.attributes.position.array;
  const idx = geom.index ? geom.index.array : null;
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
    else n.set(0, 0, 1);
    faceNormals[t * 3] = n.x;
    faceNormals[t * 3 + 1] = n.y;
    faceNormals[t * 3 + 2] = n.z;
  }

  const bvh = new MeshBVH(geom);
  self.postMessage({ type: "progress", id, value: 0.1 });

  const wasm = await getManifold();

  // SDF callback — uses the closest-point + face-normal method. Robust on
  // thin-shell inputs because it doesn't rely on ray-crossing parity.
  const closest = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  let calls = 0;
  // Coarse progress estimate based on grid volume. We can't get a real
  // count from manifold-3d so we approximate.
  const gridX = Math.ceil((maxVec.x - minVec.x) / voxel);
  const gridY = Math.ceil((maxVec.y - minVec.y) / voxel);
  const gridZ = Math.ceil((maxVec.z - minVec.z) / voxel);
  const totalEst = Math.max(1, gridX * gridY * gridZ);
  let lastProgressPost = 0;

  const sdf = (p) => {
    calls++;
    if ((calls & 0x1fff) === 0) {
      const now = Date.now();
      if (now - lastProgressPost > 100) {
        lastProgressPost = now;
        self.postMessage({
          type: "progress",
          id,
          value: 0.1 + 0.8 * Math.min(1, calls / totalEst),
        });
      }
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
    return dot < 0 ? -closest.distance : closest.distance;
  };

  const bounds = {
    min: [minVec.x, minVec.y, minVec.z],
    max: [maxVec.x, maxVec.y, maxVec.z],
  };
  const m = wasm.Manifold.levelSet(sdf, bounds, voxel, 0);
  self.postMessage({ type: "progress", id, value: 0.95 });
  const mesh = m.getMesh();

  if (!mesh.vertProperties.length || !mesh.triVerts.length) {
    m.delete();
    throw new Error("Repair produced an empty mesh — try a smaller voxel size.");
  }

  const outVerts = new Float32Array(mesh.vertProperties);
  const outIdx = new Uint32Array(mesh.triVerts);
  m.delete();

  return {
    vertices: outVerts,
    indices: outIdx,
    stats: {
      voxelSize: voxel,
      inputTris: triCount,
      outputTris: outIdx.length / 3,
    },
  };
}

self.addEventListener("message", async (e) => {
  const msg = e.data || {};
  if (msg.type !== "repair") return;
  const { id } = msg;
  try {
    const out = await repair(msg);
    self.postMessage(
      { type: "success", id, vertices: out.vertices, indices: out.indices, stats: out.stats },
      [out.vertices.buffer, out.indices.buffer]
    );
  } catch (err) {
    self.postMessage({ type: "error", id, message: err?.message || String(err) });
  }
});

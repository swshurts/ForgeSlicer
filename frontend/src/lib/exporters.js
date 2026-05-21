import * as THREE from "three";
import JSZip from "jszip";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { evaluateScene } from "./csg";
import { build3MFBytes } from "./threemf";

// ---------- Downloads ----------
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, mime = "text/plain") {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

// ---------- STL Export ----------
export function geometryToSTLBinary(geometry) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const exporter = new STLExporter();
  return exporter.parse(mesh, { binary: true });  // returns DataView
}

export function geometryToSTLASCII(geometry) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const exporter = new STLExporter();
  return exporter.parse(mesh, { binary: false }); // string
}

export function exportSceneToSTL(objects, filename = "model.stl") {
  const { geometry, empty } = evaluateScene(objects);
  if (empty) throw new Error("Scene is empty. Add at least one positive component.");
  const dv = geometryToSTLBinary(geometry);
  const blob = new Blob([dv], { type: "model/stl" });
  downloadBlob(blob, filename);
  return { triangleCount: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3 };
}

export async function exportSceneToSTLBytes(objects) {
  const { geometry, triangleCount, empty } = evaluateScene(objects);
  if (empty) throw new Error("Scene is empty. Add at least one positive component.");
  const dv = geometryToSTLBinary(geometry);
  return { bytes: new Uint8Array(dv.buffer), triangleCount };
}

// ---------- 3MF Export (minimal valid 3MF) ----------
export async function exportSceneTo3MF(objects, filename = "model.3mf") {
  const { geometry, empty } = evaluateScene(objects);
  if (empty) throw new Error("Scene is empty. Add at least one positive component.");
  const bytes = await build3MFBytes(geometry);
  downloadBlob(new Blob([bytes], { type: "model/3mf" }), filename);
}

// ---------- Project Save/Load ----------
export function saveProjectJSON(projectState, filename = "project.forge.json") {
  const data = JSON.stringify(projectState, null, 2);
  downloadText(data, filename, "application/json");
}

export function openFileDialog(accept = ".forge.json,.json,.stl,.obj") {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = (e) => {
      const f = e.target.files?.[0];
      if (!f) return reject(new Error("No file selected"));
      resolve(f);
    };
    input.click();
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

// ---------- STL/OBJ/3MF Import ----------
function _parseModelXml(xml, positions, indices, baseOffsetRef) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error("3MF XML parse error: " + parserError.textContent);
  }
  const NS_WILDCARD = "*";
  const objectNodes = doc.getElementsByTagNameNS(NS_WILDCARD, "object");
  for (let oi = 0; oi < objectNodes.length; oi++) {
    const mesh = objectNodes[oi].getElementsByTagNameNS(NS_WILDCARD, "mesh")[0];
    if (!mesh) continue;
    const verts = mesh.getElementsByTagNameNS(NS_WILDCARD, "vertex");
    const startOffset = baseOffsetRef.value;
    for (let i = 0; i < verts.length; i++) {
      positions.push(
        parseFloat(verts[i].getAttribute("x")) || 0,
        parseFloat(verts[i].getAttribute("y")) || 0,
        parseFloat(verts[i].getAttribute("z")) || 0,
      );
    }
    const tris = mesh.getElementsByTagNameNS(NS_WILDCARD, "triangle");
    for (let i = 0; i < tris.length; i++) {
      indices.push(
        (parseInt(tris[i].getAttribute("v1"), 10) || 0) + startOffset,
        (parseInt(tris[i].getAttribute("v2"), 10) || 0) + startOffset,
        (parseInt(tris[i].getAttribute("v3"), 10) || 0) + startOffset,
      );
    }
    baseOffsetRef.value += verts.length;
  }
}

export async function import3MFFile(file) {
  const buf = await readFileAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(buf);
  // 3MF spec: 3D/3dmodel.model is the primary part. Some producers (Bambu
  // Studio, OrcaSlicer) split mesh data across Metadata/model_*.model
  // files referenced via <components>, so we walk ALL *.model entries when
  // the primary alone yields no vertices.
  let modelFile = zip.file("3D/3dmodel.model");
  if (!modelFile) {
    const candidates = zip.file(/3dmodel\.model$/i);
    modelFile = candidates && candidates[0];
  }
  if (!modelFile) throw new Error("Invalid 3MF: missing 3D/3dmodel.model");

  const positions = [];
  const indices = [];
  const baseOffset = { value: 0 };

  const primaryXml = await modelFile.async("text");
  _parseModelXml(primaryXml, positions, indices, baseOffset);

  if (positions.length === 0) {
    // Fall back to scanning every *.model in the archive.
    const allModelFiles = zip.file(/\.model$/i) || [];
    for (const f of allModelFiles) {
      if (f === modelFile) continue;
      const txt = await f.async("text");
      _parseModelXml(txt, positions, indices, baseOffset);
      if (positions.length > 0) break;
    }
  }

  if (positions.length === 0) {
    throw new Error(
      "3MF contains no vertex data — the file may use the beam-lattice " +
      "or component-reference extension which ForgeSlicer doesn't import yet."
    );
  }

  const verts = new Float32Array(positions);
  // bbox + recenter so XZ center is at origin and bottom sits on Y=0
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  for (let i = 0; i < verts.length; i += 3) {
    verts[i] -= cx;
    verts[i + 1] -= minY;
    verts[i + 2] -= cz;
  }
  return {
    name: file.name.replace(/\.[^.]+$/, ""),
    vertices: verts,
    indices: indices.length ? new Uint32Array(indices) : null,
    originalBbox: {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ,
    },
  };
}

// Dispatch to the right importer based on file extension.
export async function importAnyMeshFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "stl") return importSTLFile(file);
  if (ext === "obj") return importOBJFile(file);
  if (ext === "3mf") return import3MFFile(file);
  if (ext === "glb" || ext === "gltf") return importGLBFile(file);
  throw new Error(`Unsupported file type: .${ext} (use .stl, .obj, .3mf, or .glb)`);
}

// GLB / GLTF import — primarily used by AI mesh generation (Meshy returns
// GLB). We merge every mesh in the scene into a single geometry so it slots
// into the same "imported mesh" pipeline as STL/OBJ.
export async function importGLBFile(file) {
  const buf = await readFileAsArrayBuffer(file);
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(buf, "", resolve, reject);
  });
  const positions = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrixWorld);
      const p = g.attributes.position.array;
      if (g.index) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i++) {
          positions.push(p[idx[i] * 3], p[idx[i] * 3 + 1], p[idx[i] * 3 + 2]);
        }
      } else {
        for (let i = 0; i < p.length; i++) positions.push(p[i]);
      }
    }
  });
  if (positions.length === 0) throw new Error("GLB contained no mesh geometry");
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  geom.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geom.computeBoundingBox();
  const bb2 = geom.boundingBox;
  return {
    name: file.name.replace(/\.[^.]+$/, ""),
    vertices: new Float32Array(geom.attributes.position.array),
    indices: null,
    originalBbox: {
      x: bb2.max.x - bb2.min.x,
      y: bb2.max.y - bb2.min.y,
      z: bb2.max.z - bb2.min.z,
    },
  };
}

export async function importSTLFile(file) {
  const buf = await readFileAsArrayBuffer(file);
  const loader = new STLLoader();
  const geom = loader.parse(buf);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  geom.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geom.computeBoundingBox();
  const bb2 = geom.boundingBox;
  const pos = geom.attributes.position.array;
  const indices = geom.index ? geom.index.array : null;
  return {
    name: file.name.replace(/\.[^.]+$/, ""),
    vertices: new Float32Array(pos),
    indices: indices ? new Uint32Array(indices) : null,
    originalBbox: {
      x: bb2.max.x - bb2.min.x,
      y: bb2.max.y - bb2.min.y,
      z: bb2.max.z - bb2.min.z,
    },
  };
}

export async function importOBJFile(file) {
  const text = await readFileAsText(file);
  const loader = new OBJLoader();
  const group = loader.parse(text);
  // Merge all meshes
  const positions = [];
  group.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrixWorld);
      const p = g.attributes.position.array;
      if (g.index) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i++) {
          const k = idx[i] * 3;
          positions.push(p[k], p[k + 1], p[k + 2]);
        }
      } else {
        for (let i = 0; i < p.length; i++) positions.push(p[i]);
      }
    }
  });
  const verts = new Float32Array(positions);
  // re-center
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  tmp.computeBoundingBox();
  const bb = tmp.boundingBox;
  for (let i = 0; i < verts.length; i += 3) {
    verts[i] -= (bb.min.x + bb.max.x) / 2;
    verts[i + 1] -= bb.min.y;
    verts[i + 2] -= (bb.min.z + bb.max.z) / 2;
  }
  return {
    name: file.name.replace(/\.[^.]+$/, ""),
    vertices: verts,
    indices: null,
    originalBbox: {
      x: bb.max.x - bb.min.x,
      y: bb.max.y - bb.min.y,
      z: bb.max.z - bb.min.z,
    },
  };
}

// ---------- Bytes -> base64 (for upload to gallery) ----------
export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

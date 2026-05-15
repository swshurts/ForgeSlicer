import * as THREE from "three";
import JSZip from "jszip";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { evaluateScene } from "./csg";

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

  const pos = geometry.attributes.position.array;
  let verts = "";
  const vertCount = pos.length / 3;
  for (let i = 0; i < vertCount; i++) {
    verts += `        <vertex x="${pos[i * 3].toFixed(4)}" y="${pos[i * 3 + 1].toFixed(4)}" z="${pos[i * 3 + 2].toFixed(4)}"/>\n`;
  }

  let tris = "";
  if (geometry.index) {
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      tris += `        <triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>\n`;
    }
  } else {
    for (let i = 0; i < vertCount; i += 3) {
      tris += `        <triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>\n`;
    }
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">ForgeSlicer</metadata>
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${verts}        </vertices>
        <triangles>
${tris}        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`;

  const ct = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", ct);
  zip.folder("_rels").file(".rels", rels);
  zip.folder("3D").file("3dmodel.model", modelXml);
  const blob = await zip.generateAsync({ type: "blob", mimeType: "model/3mf" });
  downloadBlob(blob, filename);
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

// ---------- STL/OBJ Import ----------
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

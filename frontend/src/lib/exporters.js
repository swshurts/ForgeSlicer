import * as THREE from "three";
import JSZip from "jszip";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { evaluateScene } from "./csg";
import { buildGeometry } from "./geometry";
import { build3MFBytes, build3MFBytesWithModifiers } from "./threemf";

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

// Internal: normalise a scene-evaluated Three.js geometry into the
// coordinate frame every FDM slicer expects.
//
// iter-104.1 — ForgeSlicer is now Z-up internally (matching CAD
// convention). Slicers (OrcaSlicer, Cura, PrusaSlicer, etc.) are
// also Z-up. No rotation is required. We still drop the bbox to
// the build plate (bb.min.z = 0) so the slicer sees the model
// resting on Z=0.
function _normaliseForSlicer(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (bb && (Math.abs(bb.min.z) > 1e-4)) {
    const drop = new THREE.Matrix4().makeTranslation(0, 0, -bb.min.z);
    geometry.applyMatrix4(drop);
  }
  return geometry;
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
  _normaliseForSlicer(geometry);
  const dv = geometryToSTLBinary(geometry);
  const blob = new Blob([dv], { type: "model/stl" });
  downloadBlob(blob, filename);
  return { triangleCount: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3 };
}

export async function exportSceneToSTLBytes(objects) {
  const { geometry, triangleCount, empty } = evaluateScene(objects);
  if (empty) throw new Error("Scene is empty. Add at least one positive component.");
  _normaliseForSlicer(geometry);
  const dv = geometryToSTLBinary(geometry);
  // Bbox is read by Gallery + STL Preview to render an "extent" chip.
  // Computed in the FINAL slicer frame (post-rotation, post-drop) so
  // the displayed dimensions match what the slicer sees.
  let bbox = null;
  try {
    if (geometry) {
      geometry.computeBoundingBox && geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      if (bb) {
        bbox = {
          x: +(bb.max.x - bb.min.x).toFixed(2),
          y: +(bb.max.y - bb.min.y).toFixed(2),
          z: +(bb.max.z - bb.min.z).toFixed(2),
        };
      }
    }
  } catch (_) { /* non-fatal */ }
  return { bytes: new Uint8Array(dv.buffer), triangleCount, bbox };
}

// ---------- 3MF Export (minimal valid 3MF) ----------
export async function exportSceneTo3MF(objects, filename = "model.3mf") {
  const { geometry, empty } = evaluateScene(objects);
  if (empty) throw new Error("Scene is empty. Add at least one positive component.");
  _normaliseForSlicer(geometry);
  const bytes = await build3MFBytes(geometry);
  downloadBlob(new Blob([bytes], { type: "model/3mf" }), filename);
}

// ---------- Modifier-mesh 3MF (Slic3r/PrusaSlicer/Orca/Bambu) ----------
//
// Bypass the local CSG entirely. Bake each scene object to world-space
// geometry and emit a 3MF that names each one as either a ModelPart
// (positives) or ModelNegativeVolume (negatives). Modern slicers
// (PrusaSlicer ≥2.4, OrcaSlicer, Bambu Studio, SuperSlicer) do the
// boolean themselves at slice time using their robust internal CSG —
// which is way more tolerant of non-manifold AI / photogrammetry input
// than three-bvh-csg or manifold-3d.
//
// Used by the export flow as the automatic fallback when three-bvh-csg
// would drop one or more negatives, and by the STL Preview's
// "Export as 3MF with Modifiers" suggestion when an imported mesh has
// negatives attached.

// Bake an object's local geometry into a world-space BufferGeometry by
// running it through the same buildGeometry pipeline used by CSG, then
// applying the object's matrixWorld. We deliberately do NOT use Three's
// `Mesh.updateMatrixWorld` here because we want zero side-effects on
// the active viewport's scene graph — pure value-in, value-out.
function bakeObjectToWorldGeometry(obj, sceneObjects) {
  const local = buildGeometry(obj, { objects: sceneObjects });
  if (!local || !local.attributes?.position) return null;
  const baked = local.clone();
  // Compose transform: translation × rotation (XYZ Euler in degrees) × scale.
  const pos = new THREE.Vector3(obj.position[0], obj.position[1], obj.position[2]);
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(obj.rotation[0]),
      THREE.MathUtils.degToRad(obj.rotation[1]),
      THREE.MathUtils.degToRad(obj.rotation[2]),
      "XYZ",
    ),
  );
  const scl = new THREE.Vector3(obj.scale[0], obj.scale[1], obj.scale[2]);
  const mat = new THREE.Matrix4().compose(pos, q, scl);
  baked.applyMatrix4(mat);
  // Flip winding when the determinant is negative — otherwise the
  // baked mesh has inside-out triangles after a mirror-style scale.
  if (mat.determinant() < 0 && baked.index) {
    const idx = baked.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp;
    }
    baked.index.needsUpdate = true;
  }
  return baked;
}

export async function exportSceneToModifier3MFBytes(objects, projectName) {
  const visible = (objects || []).filter((o) => o.visible !== false);
  if (visible.length === 0) {
    throw new Error("Scene is empty. Add at least one positive component.");
  }
  const positiveVolumes = [];
  const negativeVolumes = [];
  for (const obj of visible) {
    const geom = bakeObjectToWorldGeometry(obj, objects);
    if (!geom) continue;
    const target = obj.modifier === "negative" ? negativeVolumes : positiveVolumes;
    target.push({ geometry: geom, name: obj.name || obj.type || "Volume" });
  }
  if (positiveVolumes.length === 0) {
    throw new Error(
      "Modifier-mesh 3MF needs at least one positive (build) object. Add a non-negative component first.",
    );
  }

  // Drop the union of all positives to z=0 so the slicer sees the
  // assembly resting on the build plate. Apply the SAME translation to
  // every negative so the carve still lands in the right spot.
  let minZ = Infinity;
  for (const v of positiveVolumes) {
    v.geometry.computeBoundingBox();
    if (v.geometry.boundingBox.min.z < minZ) minZ = v.geometry.boundingBox.min.z;
  }
  if (isFinite(minZ) && Math.abs(minZ) > 1e-4) {
    const drop = new THREE.Matrix4().makeTranslation(0, 0, -minZ);
    for (const v of positiveVolumes) v.geometry.applyMatrix4(drop);
    for (const v of negativeVolumes) v.geometry.applyMatrix4(drop);
  }

  const bytes = await build3MFBytesWithModifiers({
    positiveVolumes,
    negativeVolumes,
    projectName: projectName || "ForgeSlicer Export",
  });
  // Tri count for the toast / Gallery chip — sum across all volumes
  // (positives + negatives, since they're all triangles in the file).
  const triangleCount = [...positiveVolumes, ...negativeVolumes].reduce(
    (acc, v) => acc + (v.geometry.index ? v.geometry.index.count / 3 : v.geometry.attributes.position.count / 3),
    0,
  );
  return {
    bytes,
    triangleCount,
    parts: positiveVolumes.length + negativeVolumes.length,
    positiveCount: positiveVolumes.length,
    negativeCount: negativeVolumes.length,
  };
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

// Iter-96 — Heavy-mesh threshold. Above this count, ForgeSlicer's
// boolean ops, slicer prep, and the OrcaSlicer hand-off all start to
// stall on commodity hardware. We surface a soft warning chip when an
// import crosses the line; users with beefier machines can dismiss it
// and proceed. 500K is the empirical knee-of-the-curve for our worker
// pipeline; numbers above ~2M routinely make the browser unresponsive
// during slicing and ~4M (the LithoForge bug we saw) tips into the
// "wait 30+ s per action" range.
export const HEAVY_MESH_TRIANGLE_THRESHOLD = 150_000;
// Iter-144 — above this, warn with more urgency and recommend
// decimation as the first step (the user is likely to hit noticeable
// UI stutter and >5s boolean latency at this size on a typical laptop).
export const VERY_HEAVY_MESH_TRIANGLE_THRESHOLD = 500_000;

// Counts triangles for either an indexed mesh (preferred — `indices`
// is a Uint32Array of length 3*tri-count) or a non-indexed mesh where
// every group of 9 floats in `vertices` is one triangle. Returns 0
// for empty / malformed input so callers don't have to null-check.
export function countMeshTriangles(vertices, indices) {
  if (indices && indices.length) return Math.floor(indices.length / 3);
  if (vertices && vertices.length) return Math.floor(vertices.length / 9);
  return 0;
}

// Iter-94 Phase 2 — Per-object 3MF parser.
//
// The legacy `_parseModelXml` collapsed every `<object>` into a single
// merged triangle soup, dropping color / material / per-object identity.
// This new parser keeps each object distinct AND extracts the
// `<basematerials>` displaycolor → per-object color mapping that
// LithoForge (and any other multi-material exporter) writes.
//
// Returns an array of objects in the form:
//   [{ name, vertices: Float32Array, indices: Uint32Array | null,
//      displaycolor: "#rrggbb" | null, materialName: string | null }]
// where the vertex array is in 3MF-native Z-up coordinates (we do the
// Y-up conversion ONCE on each object after parsing, just like the
// old legacy path).
//
// Handles three shapes of 3MF object encoding seen in the wild:
//   1) Plain mesh + pid/pindex on the object       (LithoForge default)
//   2) Plain mesh + per-triangle p1/p2/p3 colors   (lithophane tone maps)
//   3) <components> referencing sub-objects        (Bambu/Orca splits)
// For (2) we use the FIRST triangle's color as the object's overall
// color (good enough for lithophanes, where a single object = a single
// filament slot). True per-triangle vertex colors would need to flow
// into a Float32Array vertex-color attribute — possible but not
// shipped here.
function _parseBaseMaterials(doc, NS) {
  const out = {}; // { groupId: [{ name, displaycolor }] }
  const groups = doc.getElementsByTagNameNS(NS, "basematerials");
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const gid = group.getAttribute("id");
    if (!gid) continue;
    const entries = [];
    const bases = group.getElementsByTagNameNS(NS, "base");
    for (let i = 0; i < bases.length; i++) {
      const name = bases[i].getAttribute("name") || `material_${i}`;
      // displaycolor is "#RRGGBB" or "#RRGGBBAA" in 3MF. We trim to RGB.
      const raw = bases[i].getAttribute("displaycolor") || "";
      const m = /^#([0-9a-f]{6})/i.exec(raw);
      const displaycolor = m ? `#${m[1].toLowerCase()}` : null;
      entries.push({ name, displaycolor });
    }
    out[gid] = entries;
  }
  return out;
}

function _parseObjectsRich(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error("3MF XML parse error: " + parserError.textContent);
  }
  const NS = "*";
  const materialsByGroup = _parseBaseMaterials(doc, NS);
  // First pass — collect every <object> by id so <components> can
  // resolve sibling references in the second pass.
  const objectNodes = doc.getElementsByTagNameNS(NS, "object");
  const byId = {};
  for (let oi = 0; oi < objectNodes.length; oi++) {
    const obj = objectNodes[oi];
    const id = obj.getAttribute("id");
    if (!id) continue;
    byId[id] = obj;
  }

  // Resolves an <object>'s displaycolor based on its pid (group) and
  // pindex (default base material). Returns null when either is
  // missing or the material has no displaycolor.
  const objectDisplayColor = (obj) => {
    const pid = obj.getAttribute("pid");
    if (!pid) return { hex: null, name: null };
    const group = materialsByGroup[pid];
    if (!group) return { hex: null, name: null };
    const pindex = parseInt(obj.getAttribute("pindex") || "0", 10) || 0;
    const mat = group[pindex] || group[0];
    return mat ? { hex: mat.displaycolor, name: mat.name } : { hex: null, name: null };
  };

  const parseMesh = (obj) => {
    const mesh = obj.getElementsByTagNameNS(NS, "mesh")[0];
    if (!mesh) return null;
    const verts = mesh.getElementsByTagNameNS(NS, "vertex");
    const tris = mesh.getElementsByTagNameNS(NS, "triangle");
    if (verts.length === 0 || tris.length === 0) return null;
    const positions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
      positions[i * 3]     = parseFloat(verts[i].getAttribute("x")) || 0;
      positions[i * 3 + 1] = parseFloat(verts[i].getAttribute("y")) || 0;
      positions[i * 3 + 2] = parseFloat(verts[i].getAttribute("z")) || 0;
    }
    const indices = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      indices[i * 3]     = parseInt(tris[i].getAttribute("v1"), 10) || 0;
      indices[i * 3 + 1] = parseInt(tris[i].getAttribute("v2"), 10) || 0;
      indices[i * 3 + 2] = parseInt(tris[i].getAttribute("v3"), 10) || 0;
    }
    // Fallback per-triangle color when the object itself has no pid:
    // grab the first triangle's pid/p1 lookup. Common in lithophane
    // tone-mapped exports where every triangle of one shade shares a
    // material. Treats the object as monochrome (close enough for
    // lithophanes; true per-triangle vertex colors would need a
    // BufferAttribute, which Three.js renders but ForgeSlicer's
    // store/exporter pipeline doesn't yet thread through).
    let triLevelColor = null;
    if (tris.length > 0) {
      const firstTri = tris[0];
      const pid = obj.getAttribute("pid") || firstTri.getAttribute("pid");
      const p1 = firstTri.getAttribute("p1");
      if (pid && p1 != null) {
        const group = materialsByGroup[pid];
        if (group) {
          const mat = group[parseInt(p1, 10) || 0] || group[0];
          if (mat?.displaycolor) {
            triLevelColor = { hex: mat.displaycolor, name: mat.name };
          }
        }
      }
    }
    return { positions, indices, triLevelColor };
  };

  // Pass 2 — recursively flatten composite objects (<components>)
  // into individual meshes. We tag each output with the source
  // object's id+name so the workspace's Outliner shows distinct rows.
  const out = []; // [{ name, positions, indices, hex, materialName }]
  const visited = new Set();
  const walk = (obj, inheritedColor) => {
    const id = obj.getAttribute("id") || "";
    if (visited.has(id)) return; // guard against malicious cycles
    visited.add(id);
    const own = objectDisplayColor(obj);
    const meshData = parseMesh(obj);
    if (meshData) {
      const baseName = obj.getAttribute("name") || `object_${id}`;
      // Resolve color: explicit object color > per-triangle color
      // > inherited from parent component.
      const colorSource = own.hex
        ? own
        : (meshData.triLevelColor || inheritedColor || { hex: null, name: null });
      out.push({
        name: baseName,
        positions: meshData.positions,
        indices: meshData.indices,
        hex: colorSource.hex,
        materialName: colorSource.name,
      });
    }
    // Resolve children.
    const components = obj.getElementsByTagNameNS(NS, "component");
    for (let i = 0; i < components.length; i++) {
      const refId = components[i].getAttribute("objectid");
      if (!refId) continue;
      const ref = byId[refId];
      if (ref) walk(ref, own.hex ? own : inheritedColor);
    }
  };

  // Walk only top-level <build><item objectid=…>> roots when present,
  // so <components> children aren't double-emitted. Falls back to
  // walking every object if no <build> section exists.
  const items = doc.getElementsByTagNameNS(NS, "item");
  if (items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const refId = items[i].getAttribute("objectid");
      if (!refId) continue;
      const ref = byId[refId];
      if (ref) walk(ref, null);
    }
  } else {
    for (const obj of Object.values(byId)) walk(obj, null);
  }
  return out;
}

// Legacy single-flat-mesh path — kept for back-compat with callers
// (toolbar Import button, ZIP-bundle helper) that haven't migrated to
// the multi-object envelope yet. New code should prefer
// `import3MFFileMulti`.
function _parseModelXml(xml, positions, indices, baseOffsetRef) {
  const objs = _parseObjectsRich(xml);
  for (const o of objs) {
    const startOffset = baseOffsetRef.value;
    for (let i = 0; i < o.positions.length; i++) positions.push(o.positions[i]);
    for (let i = 0; i < o.indices.length; i++) indices.push(o.indices[i] + startOffset);
    baseOffsetRef.value += o.positions.length / 3;
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
  // 3MF files are Z-up natively — same as our internal frame. No
  // rotation needed; just centre on X/Y and drop bottom to Z=0.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let i = 0; i < verts.length; i += 3) {
    verts[i]     -= cx;
    verts[i + 1] -= cy;
    verts[i + 2] -= minZ;
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

// Iter-94 Phase 2 — multi-object 3MF importer.
//
// Returns ALL objects in the file as separate meshes, each carrying
// the displaycolor from its 3MF `<basematerials>` reference. Use this
// (instead of `import3MFFile`) anywhere the caller wants per-object
// coloring in the workspace — typically the handoff/drop-zone import
// path for LithoForge files.
//
// Return shape:
//   {
//     objects: [{ name, vertices, indices, originalBbox,
//                 displaycolor: "#rrggbb" | null,
//                 materialName: string | null }],
//     fileName: string,                  // base of the source filename
//     mergedOriginalBbox: { x,y,z },     // bbox of all objects combined,
//                                        // for the legacy single-mesh stat path
//   }
//
// Coordinate convention: each object's vertices are in Y-up Three.js
// space, with the COMBINED-scene origin centred on XZ and the entire
// import sitting on Y=0. Per-object relative positions are preserved
// so a multi-tone lithophane stays aligned tone-to-tone.
export async function import3MFFileMulti(file) {
  const buf = await readFileAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(buf);
  let modelFile = zip.file("3D/3dmodel.model");
  if (!modelFile) {
    const candidates = zip.file(/3dmodel\.model$/i);
    modelFile = candidates && candidates[0];
  }
  if (!modelFile) throw new Error("Invalid 3MF: missing 3D/3dmodel.model");

  // Collect objects from the primary model file first; if it yields
  // none, fall back to scanning every `*.model` in the archive (Bambu /
  // Orca split workloads).
  const primaryXml = await modelFile.async("text");
  let rich = _parseObjectsRich(primaryXml);
  if (rich.length === 0) {
    const allModelFiles = zip.file(/\.model$/i) || [];
    for (const f of allModelFiles) {
      if (f === modelFile) continue;
      const txt = await f.async("text");
      const fromFile = _parseObjectsRich(txt);
      if (fromFile.length > 0) {
        rich = fromFile;
        break;
      }
    }
  }
  if (rich.length === 0) {
    throw new Error(
      "3MF contains no vertex data — the file may use the beam-lattice " +
      "or component-reference extension which ForgeSlicer doesn't import yet."
    );
  }

  // Pass 1 — compute combined bbox in native Z-up coords so we can
  // centre/drop the whole import as a single unit (preserving inter-
  // object offsets). No rotation: 3MF and ForgeSlicer are both Z-up.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const o of rich) {
    const v = o.positions;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i], y = v[i + 1], z = v[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Pass 2 — recentre & drop. Also compute each object's individual
  // bbox AFTER the global recentre so the Inspector "dims" panel
  // shows real per-object dimensions.
  const fileBase = file.name.replace(/\.[^.]+$/, "");
  const out = rich.map((o, idx) => {
    const v = o.positions;
    let omnX = Infinity, omnY = Infinity, omnZ = Infinity;
    let omxX = -Infinity, omxY = -Infinity, omxZ = -Infinity;
    for (let i = 0; i < v.length; i += 3) {
      v[i]     -= cx;
      v[i + 1] -= cy;
      v[i + 2] -= minZ;
      const x = v[i], y = v[i + 1], z = v[i + 2];
      if (x < omnX) omnX = x; if (x > omxX) omxX = x;
      if (y < omnY) omnY = y; if (y > omxY) omxY = y;
      if (z < omnZ) omnZ = z; if (z > omxZ) omxZ = z;
    }
    return {
      // Prefer the object's own name; fall back to `<file>-tone<n>`
      // so the Outliner has a meaningful row per tone.
      name: o.name || `${fileBase}-part-${idx + 1}`,
      vertices: v,
      indices: o.indices,
      displaycolor: o.hex || null,
      materialName: o.materialName || null,
      originalBbox: {
        x: omxX - omnX,
        y: omxY - omnY,
        z: omxZ - omnZ,
      },
    };
  });

  return {
    objects: out,
    fileName: fileBase,
    mergedOriginalBbox: {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ,
    },
  };
}

// Dispatch to the right importer based on file extension.
//
// Iter-84 additions:
//   • .svg → routed via the dedicated `SVGImportDialog` (see
//     `components/SVGImportDialog.jsx` + `lib/svgImport.js`), which
//     handles extrude height, multi-shape grouping, hole detection
//     and positive/negative-modifier picking. We don't call it from
//     here because it needs UI; the dispatch happens in
//     `toolbar/projectActions.js handleImport`.
//   • .zip → router: if the archive contains mesh files (STL/OBJ/3MF)
//     we delegate to `importZipBundleFile`, which presents a per-file
//     selection UI. If it contains OrcaSlicer config JSONs
//     (printer.json / process.json / filament.json) the bundle is
//     imported as a printer profile.
export async function importAnyMeshFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "stl") return importSTLFile(file);
  if (ext === "obj") return importOBJFile(file);
  if (ext === "3mf") return import3MFFile(file);
  if (ext === "glb" || ext === "gltf") return importGLBFile(file);
  throw new Error(`Unsupported file type: .${ext} (use .stl, .obj, .3mf, .glb, .svg, or .zip)`);
}

// ZIP-bundle inspection. Returns a manifest of the archive's
// contents grouped by category so the caller can decide how to
// proceed: per-file import for mesh bundles, profile-import for
// OrcaSlicer config dumps, or refuse for unsupported archives.
//
// Returns:
//   {
//     meshFiles:    [{ name, ext, size, blob }],  // STL/OBJ/3MF/GLB/SVG
//     orcaConfigs:  [{ name, role, blob }],       // role ∈ {printer, process, filament}
//     other:        [{ name, size }],             // ignored but reported
//     totalEntries: number,
//   }
export async function inspectZipFile(file) {
  const buf = await readFileAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(buf);
  const meshFiles = [];
  const orcaConfigs = [];
  const other = [];
  let totalEntries = 0;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    totalEntries++;
    const lower = path.toLowerCase();
    const base = path.split("/").pop() || path;
    const ext = (base.split(".").pop() || "").toLowerCase();
    if (["stl", "obj", "3mf", "glb", "gltf", "svg"].includes(ext)) {
      const blob = await entry.async("blob");
      meshFiles.push({ name: base, path, ext, size: blob.size, blob });
    } else if (ext === "json") {
      // Heuristic Orca-config detection: look at the filename + first
      // few keys of the JSON. We're conservative — only obvious Orca
      // shapes count, ambiguous JSON gets parked in `other`.
      let role = null;
      if (/printer/i.test(base)) role = "printer";
      else if (/process/i.test(base)) role = "process";
      else if (/filament/i.test(base)) role = "filament";
      if (role) {
        const blob = await entry.async("blob");
        orcaConfigs.push({ name: base, role, blob });
      } else {
        other.push({ name: base, size: entry._data?.uncompressedSize || 0 });
      }
    } else {
      other.push({ name: base, size: entry._data?.uncompressedSize || 0 });
      void lower;  // currently unused, future use for case-insensitive matching
    }
  }
  return { meshFiles, orcaConfigs, other, totalEntries };
}

// Helper for the ZIP-mesh-import UI: given a single entry from
// `inspectZipFile`'s `meshFiles` array, materialise it as a File
// (so the existing `importAnyMeshFile` dispatch works unchanged).
export function meshEntryToFile(entry) {
  return new File([entry.blob], entry.name, { type: entry.blob.type || "application/octet-stream" });
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

// Convention conversion for imported meshes.
//
// Three.js scenes use **Y-up** (height = +Y). The 3D-printing world's
// file formats — STL, 3MF, most OBJ files — use **Z-up** (height = +Z).
// Without conversion, an imported Z-up STL ends up *lying on its side*
// in our Three.js scene, and is then re-exported with the same wrong
// frame, producing the "floating model + phantom supports" failure
// mode that surfaced in iter-76 (user's MiniRack tray print failing,
// because the cutout side ended up underneath the model in the slicer).
//
// Fix: apply +90° around X on import (so old Z becomes new Y, old Y
// becomes new -Z). The export side's `_normaliseForSlicer` applies
// the inverse rotation, so STL→ForgeSlicer→STL round-trips preserve
// orientation. Mutates `geometry` in place AND returns it.
//
// Trade-off / known limitation:
// Pre-iter-76 projects whose STL imports were stored in the "lying
// sideways" frame will appear rotated 90° after this fix. Users have
// to re-import those files. We accept that — the alternative (leaving
// the bug in place) makes the slice flow produce wrong G-code.
// iter-104.1 — ForgeSlicer is now Z-up internally (matching STL/3MF/OBJ).
// No coordinate conversion is needed on import; preserve the file's
// original orientation. We still centre on X/Y and drop to Z=0 so the
// model rests on the build plate.
function _zUpToYUp(geometry) {
  return geometry;
}

export async function importSTLFile(file) {
  const buf = await readFileAsArrayBuffer(file);
  const loader = new STLLoader();
  const geom = loader.parse(buf);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  // Centre on X/Y (footprint) and drop the lowest point to Z=0 so
  // the model rests on the build-plate grid (Z-up CAD convention).
  geom.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
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
  // OBJ files in 3D-printing contexts are Z-up — same as our internal
  // frame. No rotation; just centre on X/Y and drop to Z=0.
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  const rotated = tmp.attributes.position.array;
  tmp.computeBoundingBox();
  const bb = tmp.boundingBox;
  for (let i = 0; i < rotated.length; i += 3) {
    rotated[i]     -= (bb.min.x + bb.max.x) / 2;
    rotated[i + 1] -= (bb.min.y + bb.max.y) / 2;
    rotated[i + 2] -= bb.min.z;
  }
  return {
    name: file.name.replace(/\.[^.]+$/, ""),
    vertices: rotated instanceof Float32Array ? rotated : new Float32Array(rotated),
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

import JSZip from "jszip";

import { MULTICOLOR_PALETTE } from "./presets";

/**
 * Build a single-object 3MF zip from a THREE.BufferGeometry. Used by both
 * the heavy-compute worker and the main-thread fallback. Caller is
 * responsible for handing the geometry off (it is read but not modified).
 */
export async function build3MFBytes(geometry) {
  const objectXml = buildObjectXml(geometry, 1);
  const modelXml = wrapModel([objectXml], [{ id: 1 }]);
  return packageZip(modelXml);
}

/**
 * Build a multi-object 3MF zip where each group is rendered as a separate
 * `<object>` carrying its filament/extruder color in metadata. Downstream
 * slicers (Bambu Studio, OrcaSlicer) map this to AMS slot N. The colors are
 * also written into the `<basematerials>` block so that 3MF viewers (and
 * slicers without a Bambu/Orca extension parser) at least preview the
 * intended color per part.
 *
 * groups: [{ colorIndex: 0..7, geometry: THREE.BufferGeometry }]
 */
export async function build3MFBytesMulti(groups) {
  if (!groups || groups.length === 0) {
    throw new Error("Nothing to export. Add at least one positive component.");
  }
  // Build a basematerials group sharing one id (resource id 100).
  const baseMatId = 100;
  const matLines = groups.map((g, i) => {
    const color = MULTICOLOR_PALETTE[g.colorIndex] || MULTICOLOR_PALETTE[0];
    const name = `T${g.colorIndex} ${color.name}`;
    return `      <base name="${name}" displaycolor="${color.hex}FF"/>`;
  });
  const baseMaterials = `    <basematerials id="${baseMatId}">
${matLines.join("\n")}
    </basematerials>`;

  // Each object gets a sequential id starting at 1. pid+pindex reference
  // the basematerials element + the per-base index.
  const objectBlocks = groups.map((g, i) =>
    buildObjectXml(g.geometry, i + 1, { pid: baseMatId, pindex: i, colorIndex: g.colorIndex })
  );
  const buildItems = groups.map((_, i) => ({ id: i + 1 }));
  const modelXml = wrapModel(objectBlocks, buildItems, baseMaterials);
  return packageZip(modelXml);
}

// ---------- Modifier-mesh 3MF (PrusaSlicer / OrcaSlicer / Bambu Studio) ----------
//
// When the host mesh is non-manifold and our CSG engine refuses to carve
// negatives through it, we have a much better option than failing: emit
// a 3MF that contains the host AND each negative as separate VOLUMES
// inside a single object, then let the slicer do the boolean at slice
// time. Modern slicers (PrusaSlicer ≥2.4, OrcaSlicer, Bambu Studio,
// SuperSlicer) have battle-tested CSG that handles hobbyist STL input
// way better than three-bvh-csg / manifold-3d ever will.
//
// Wire format follows the de-facto PrusaSlicer extension that
// OrcaSlicer + Bambu Studio also parse:
//   1. `3D/3dmodel.model` contains a single `<object>` whose `<mesh>`
//      concatenates every volume's triangles. Vertex indices for each
//      volume are remapped to start from 0.
//   2. `Metadata/Slic3r_PE_model.config` is a sidecar XML that
//      partitions the triangles into named volumes and tags each with
//      `volume_type` ∈ { ModelPart, ModelNegativeVolume,
//      ParameterModifier, SupportEnforcer, SupportBlocker }.
//
// The slicer reconstructs the volume topology by mapping the
// `firstid..lastid` triangle range back into its per-volume object.
//
// Reference: PrusaSlicer src/libslic3r/Format/3mf.cpp.
//
// `positiveVolumes` / `negativeVolumes` are arrays of:
//   { geometry: THREE.BufferGeometry,  // ALREADY in world space
//     name:     string,                // shown in the slicer outliner
//   }
export async function build3MFBytesWithModifiers({
  positiveVolumes,
  negativeVolumes,
  projectName = "ForgeSlicer Export",
}) {
  if (!positiveVolumes || positiveVolumes.length === 0) {
    throw new Error(
      "Modifier-mesh 3MF needs at least one positive volume. Add a printable object first.",
    );
  }

  // Concatenate all volumes' vertices/triangles into one big mesh and
  // track per-volume triangle ranges so the sidecar can reference them.
  const allVerts = [];        // flat array of {x,y,z}
  const allTris = [];         // flat array of {v1,v2,v3}
  const volumes = [];         // metadata: { name, type, firstTri, lastTri }

  const collectVolume = (vol, volumeType) => {
    const g = vol.geometry;
    const posAttr = g.attributes.position;
    const pos = posAttr.array;
    const vertOffset = allVerts.length;
    // Append vertices.
    for (let i = 0; i < pos.length; i += 3) {
      allVerts.push({ x: pos[i], y: pos[i + 1], z: pos[i + 2] });
    }
    // Append triangles (remapped to global vertex indices).
    const triFirst = allTris.length;
    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        allTris.push({
          v1: idx[i]     + vertOffset,
          v2: idx[i + 1] + vertOffset,
          v3: idx[i + 2] + vertOffset,
        });
      }
    } else {
      // Non-indexed: every 3 vertices forms a triangle.
      const triCount = (pos.length / 3) / 3;
      for (let i = 0; i < triCount; i++) {
        allTris.push({
          v1: i * 3     + vertOffset,
          v2: i * 3 + 1 + vertOffset,
          v3: i * 3 + 2 + vertOffset,
        });
      }
    }
    const triLast = allTris.length - 1;
    volumes.push({
      name: vol.name || "Volume",
      type: volumeType,
      firstTri: triFirst,
      lastTri: triLast,
    });
  };

  for (const v of positiveVolumes) collectVolume(v, "ModelPart");
  for (const v of (negativeVolumes || [])) collectVolume(v, "ModelNegativeVolume");

  // 1) 3D/3dmodel.model — one object containing the combined mesh.
  const vertLines = new Array(allVerts.length);
  for (let i = 0; i < allVerts.length; i++) {
    const v = allVerts[i];
    vertLines[i] = `        <vertex x="${v.x.toFixed(4)}" y="${v.y.toFixed(4)}" z="${v.z.toFixed(4)}"/>`;
  }
  const triLines = new Array(allTris.length);
  for (let i = 0; i < allTris.length; i++) {
    const t = allTris[i];
    triLines[i] = `        <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}"/>`;
  }
  const objectBlock = `    <object id="1" type="model">
      <mesh>
        <vertices>
${vertLines.join("\n")}
        </vertices>
        <triangles>
${triLines.join("\n")}
        </triangles>
      </mesh>
    </object>`;
  const modelXml = wrapModel([objectBlock], [{ id: 1 }]);

  // 2) Metadata/Slic3r_PE_model.config — sidecar partitioning the
  //    triangles into named volumes. Identity matrices because the
  //    geometries we received are already baked to world coords.
  const volumeBlocks = volumes.map((v) => `  <volume firstid="${v.firstTri}" lastid="${v.lastTri}">
   <metadata type="volume" key="name" value="${escapeXml(v.name)}"/>
   <metadata type="volume" key="volume_type" value="${v.type}"/>
   <metadata type="volume" key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
  </volume>`);
  const configXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="1" instances_count="1">
  <metadata type="object" key="name" value="${escapeXml(projectName)}"/>
${volumeBlocks.join("\n")}
 </object>
</config>`;

  // 3) Package the zip — same content-type + relationships as a plain
  //    3MF, with the extra Slic3r_PE_model.config file alongside.
  return packageModifierZip(modelXml, configXml);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function packageModifierZip(modelXml, configXml) {
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
  zip.folder("Metadata").file("Slic3r_PE_model.config", configXml);
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  return new Uint8Array(ab);
}

// ---------- internal helpers ----------
function buildObjectXml(geometry, objectId, opts = {}) {
  const pos = geometry.attributes.position.array;
  const vertCount = pos.length / 3;
  const vertLines = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    vertLines[i] = `        <vertex x="${pos[i * 3].toFixed(4)}" y="${pos[i * 3 + 1].toFixed(4)}" z="${pos[i * 3 + 2].toFixed(4)}"/>`;
  }
  let triLines;
  const triPid = opts.pid != null && opts.pindex != null
    ? ` pid="${opts.pid}" p1="${opts.pindex}"`
    : "";
  if (geometry.index) {
    const idx = geometry.index.array;
    const triCount = idx.length / 3;
    triLines = new Array(triCount);
    for (let i = 0; i < triCount; i++) {
      triLines[i] = `        <triangle v1="${idx[i * 3]}" v2="${idx[i * 3 + 1]}" v3="${idx[i * 3 + 2]}"${triPid}/>`;
    }
  } else {
    const triCount = vertCount / 3;
    triLines = new Array(triCount);
    for (let i = 0; i < triCount; i++) {
      triLines[i] = `        <triangle v1="${i * 3}" v2="${i * 3 + 1}" v3="${i * 3 + 2}"${triPid}/>`;
    }
  }
  const objectAttrs = opts.pid != null
    ? ` pid="${opts.pid}" pindex="${opts.pindex}"`
    : "";
  const metaName = opts.colorIndex != null
    ? `\n      <metadata name="forgeslicer:colorIndex">${opts.colorIndex}</metadata>`
    : "";
  return `    <object id="${objectId}" type="model"${objectAttrs}>${metaName}
      <mesh>
        <vertices>
${vertLines.join("\n")}
        </vertices>
        <triangles>
${triLines.join("\n")}
        </triangles>
      </mesh>
    </object>`;
}

function wrapModel(objectBlocks, buildItems, baseMaterialsXml = "") {
  const buildLines = buildItems
    .map((b) => `    <item objectid="${b.id}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">ForgeSlicer</metadata>
  <resources>
${baseMaterialsXml ? baseMaterialsXml + "\n" : ""}${objectBlocks.join("\n")}
  </resources>
  <build>
${buildLines}
  </build>
</model>`;
}

async function packageZip(modelXml) {
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
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  return new Uint8Array(ab);
}


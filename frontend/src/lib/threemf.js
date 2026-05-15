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


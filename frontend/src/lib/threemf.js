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
// a 3MF that contains the host AND each negative as separate VOLUMES,
// then let the slicer do the boolean at slice time. Modern slicers
// (OrcaSlicer, Bambu Studio, PrusaSlicer ≥ 2.4, SuperSlicer) have
// battle-tested CSG that handles hobbyist STL input way better than
// three-bvh-csg / manifold-3d ever will.
//
// Wire format follows the BBS / OrcaSlicer NATIVE multi-object schema
// (verified against the upstream `src/libslic3r/Format/bbs_3mf.cpp`
// writer). Each volume is its OWN `<object>` with its OWN `<mesh>` —
// the parent assembly `<object>` references them via `<components>`.
// The slicer reconstructs the assembly hierarchy and applies the
// per-component role from `Metadata/model_settings.config`.
//
// Schema:
//   3D/3dmodel.model
//     <resources>
//       <object id=2 type="model"><mesh>… positive verts/tris …</mesh></object>
//       <object id=3 type="model"><mesh>… negative verts/tris …</mesh></object>
//       <object id=1 type="model">         <!-- assembly -->
//         <components>
//           <component objectid=2/>
//           <component objectid=3/>
//         </components>
//       </object>
//     </resources>
//     <build><item objectid=1/></build>
//
//   Metadata/model_settings.config
//     <config>
//       <object id=1 instances_count=1>
//         <metadata type=object key=name value=ProjectName/>
//         <part id=2 subtype=normal_part>     <!-- host -->
//           <metadata type=part key=name value=Hydrant/>
//           <metadata type=part key=matrix value=…identity…/>
//         </part>
//         <part id=3 subtype=negative_part>   <!-- carved -->
//           <metadata type=part key=name value=Cube/>
//           <metadata type=part key=matrix value=…identity…/>
//         </part>
//       </object>
//     </config>
//
// Even if a particular slicer build fails to parse `model_settings.config`
// (and ignores the `subtype="negative_part"` declaration) the user STILL
// sees two separate objects in the slicer outliner and can right-click
// → "Change type → Negative volume" to flip the cube manually. That's
// the safety net the earlier single-mesh + triangle-range format
// didn't have.
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

  // Build the per-volume `<object>` blocks first. Each volume gets its
  // own sequential id starting at 2 (id=1 is reserved for the assembly).
  const allVolumes = [
    ...positiveVolumes.map((v) => ({ ...v, subtype: "normal_part" })),
    ...(negativeVolumes || []).map((v) => ({ ...v, subtype: "negative_part" })),
  ];
  const ASSEMBLY_ID = 1;
  const parts = allVolumes.map((v, i) => ({
    objectId: i + 2,                 // 2, 3, 4, …
    name: v.name || "Volume",
    subtype: v.subtype,
    geometry: v.geometry,
  }));

  const objectBlocks = parts.map((p) => _buildVolumeObjectXml(p.objectId, p.geometry));

  // The assembly object — has no mesh, only components.
  const componentLines = parts
    .map((p) => `      <component objectid="${p.objectId}" p:UUID="${_uuidFor(p.objectId)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`)
    .join("\n");
  const assemblyBlock = `    <object id="${ASSEMBLY_ID}" p:UUID="${_uuidFor(ASSEMBLY_ID)}" type="model">
      <components>
${componentLines}
      </components>
    </object>`;

  // 3D/3dmodel.model — full XML with Slic3r-PE namespace and
  // production-extension namespace so the slicer recognises this as a
  // project file. We DELIBERATELY OMIT the Bambu Lab namespace +
  // version metadata — they signal "this is a Bambu Lab native file"
  // and trigger OrcaSlicer's "missing Bambu library" warning on
  // non-Bambu printer setups (FlashForge / Prusa / Creality / Voron /
  // etc.). OrcaSlicer's parser still reads our
  // `<part subtype="negative_part">` metadata in
  // `Metadata/model_settings.config` without the Bambu marker; it
  // just doesn't try to resolve Bambu-specific profile presets.
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Application">ForgeSlicer</metadata>
  <metadata name="slic3rpe:Version3mf">1</metadata>
  <metadata name="Title">${escapeXml(projectName)}</metadata>
  <resources>
${objectBlocks.join("\n")}
${assemblyBlock}
  </resources>
  <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">
    <item objectid="${ASSEMBLY_ID}" p:UUID="00000099-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
  </build>
</model>`;

  // Metadata/model_settings.config — declares each <part> sub-object's
  // role. `subtype="negative_part"` is the BBS-schema modifier flag.
  const partBlocks = parts.map((p) => `  <part id="${p.objectId}" subtype="${p.subtype}">
   <metadata type="part" key="name" value="${escapeXml(p.name)}"/>
   <metadata type="part" key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
   <metadata type="part" key="source_file" value=""/>
   <metadata type="part" key="source_object_id" value="0"/>
   <metadata type="part" key="source_volume_id" value="${p.objectId - 2}"/>
   <metadata type="part" key="source_offset_x" value="0"/>
   <metadata type="part" key="source_offset_y" value="0"/>
   <metadata type="part" key="source_offset_z" value="0"/>
  </part>`);
  const configXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="${ASSEMBLY_ID}" instances_count="1">
  <metadata type="object" key="name" value="${escapeXml(projectName)}"/>
  <metadata type="object" key="extruder" value="1"/>
${partBlocks.join("\n")}
 </object>
</config>`;

  return packageModifierZip(modelXml, configXml);
}

// Build the per-volume `<object>` XML — the mesh that belongs to ONE
// volume. Used as a building block by build3MFBytesWithModifiers.
function _buildVolumeObjectXml(objectId, geometry) {
  const pos = geometry.attributes.position.array;
  const vertCount = pos.length / 3;
  const vertLines = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    vertLines[i] = `        <vertex x="${pos[i * 3].toFixed(4)}" y="${pos[i * 3 + 1].toFixed(4)}" z="${pos[i * 3 + 2].toFixed(4)}"/>`;
  }
  let triLines;
  if (geometry.index) {
    const idx = geometry.index.array;
    const triCount = idx.length / 3;
    triLines = new Array(triCount);
    for (let i = 0; i < triCount; i++) {
      triLines[i] = `        <triangle v1="${idx[i * 3]}" v2="${idx[i * 3 + 1]}" v3="${idx[i * 3 + 2]}"/>`;
    }
  } else {
    const triCount = vertCount / 3;
    triLines = new Array(triCount);
    for (let i = 0; i < triCount; i++) {
      triLines[i] = `        <triangle v1="${i * 3}" v2="${i * 3 + 1}" v3="${i * 3 + 2}"/>`;
    }
  }
  return `    <object id="${objectId}" p:UUID="${_uuidFor(objectId)}" type="model">
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

// Stable, deterministic UUIDs derived from the object id. The BBS spec
// uses real GUIDs but any 8-4-4-4-12 hex string is accepted by the
// slicer — it's just a per-object stable identifier. We use the BBS
// suffix conventions so the file matches a hand-saved OrcaSlicer 3MF
// at a glance.
function _uuidFor(objectId) {
  const idHex = objectId.toString(16).padStart(8, "0");
  return `${idHex}-61cb-4c03-9d28-80fed5dfa1dc`;
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
  // OrcaSlicer / BambuStudio look for `Metadata/model_settings.config`;
  // PrusaSlicer / SuperSlicer look for `Metadata/Slic3r_PE_model.config`.
  // The XML schema is IDENTICAL between the two, so we just write the
  // same payload under both filenames — guarantees the modifier
  // metadata is picked up regardless of which slicer the user opens
  // the file in.
  //
  // We also declare a `.config` ContentType so the slicer doesn't drop
  // the sidecar as "unknown payload" during package validation, and
  // emit `3D/_rels/3dmodel.model.rels` (empty Relationships) so the
  // 3MF package validator doesn't reject the file for a missing
  // per-model rels stub.
  const ct = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/vnd.bambulab-3dmanufacturing-config+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", ct);
  zip.folder("_rels").file(".rels", rels);
  const folder3d = zip.folder("3D");
  folder3d.file("3dmodel.model", modelXml);
  folder3d.folder("_rels").file("3dmodel.model.rels", modelRels);
  const meta = zip.folder("Metadata");
  // BambuStudio / OrcaSlicer / Bambu Handy
  meta.file("model_settings.config", configXml);
  // PrusaSlicer / SuperSlicer back-compat
  meta.file("Slic3r_PE_model.config", configXml);
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  return new Uint8Array(ab);
}

// Iter-151.18 — Proper Bambu / OrcaSlicer multi-plate 3MF.
//
// Produces a single 3MF that OrcaSlicer imports as N separate plates,
// so a Drawer Chest split into "Frame / Drawer 1..5 / Lid" opens
// natively with each part on its own build plate — no manual arrange
// step required by the user.
//
// Structure (matches BambuStudio's saved project format):
//
//   [Content_Types].xml           declares .rels / .model / .config
//   _rels/.rels                   points at 3D/3dmodel.model
//   3D/3dmodel.model              one <object> per plate + build items
//   3D/_rels/3dmodel.model.rels   empty stub (validator quirk)
//   Metadata/model_settings.config
//                                 per-object metadata + <plate> blocks
//                                 mapping objects to plater_id
//   Metadata/slice_info.config    plate index + object identify_ids
//
// The transform on each build item is the identity — every plate's
// geometry has already been centred at plate origin by the caller
// (`multiPlateExport`). OrcaSlicer will visually place each object on
// its own plate based on the metadata mapping.
export async function build3MFBytesBambuMultiPlate(plateGroups) {
  if (!plateGroups || plateGroups.length === 0) {
    throw new Error("build3MFBytesBambuMultiPlate: at least one plate required");
  }

  // One object per plate. IDs start at 1; identify_ids at 100 so they
  // read cleanly and don't collide with the object id numbering.
  const objectXmlBlocks = [];
  const buildItems = [];
  const modelSettingObjects = [];
  const modelSettingPlates = [];
  const sliceInfoPlates = [];
  // Iter-151.19 — collect PNG thumbnails to inject into the ZIP.
  const platePngs = [];

  // Iter-151.19 — first pass builds the XML + collects thumbnail
  // rendering promises (OffscreenCanvas is async). We resolve them
  // BEFORE zipping so the packaging phase stays synchronous-looking.
  for (let idx = 0; idx < plateGroups.length; idx++) {
    const plate = plateGroups[idx];
    const objectId = idx + 1;
    const platerId = idx + 1;
    const identifyId = 100 + idx;
    const plateName = plate.plateName || `Plate ${platerId}`;
    let thumbFile = "";
    if (plate.geometry) {
      try {
        const result = _renderPlateThumbnailPng(plate.geometry, 512, 512);
        const bytes = result && typeof result.then === "function" ? await result : result;
        if (bytes) {
          thumbFile = `Metadata/plate_${platerId}.png`;
          platePngs.push({ path: thumbFile, bytes });
        }
      } catch { /* silent — thumbnail is a nice-to-have */ }
    }
    objectXmlBlocks.push(_buildBambuObjectXml(objectId, plate.geometry));
    buildItems.push({ objectId });
    modelSettingObjects.push({ id: objectId, name: plateName });
    modelSettingPlates.push({
      platerId, plateName,
      modelInstances: [{ objectId, identifyId }],
      thumbnailFile: thumbFile,
    });
    sliceInfoPlates.push({
      index: platerId,
      objects: [{ identifyId, name: plateName }],
    });
  }

  // 3dmodel.model
  const buildLines = buildItems.map(
    (b) => `    <item objectid="${b.objectId}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`,
  ).join("\n");
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">ForgeSlicer</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <resources>
${objectXmlBlocks.join("\n")}
  </resources>
  <build>
${buildLines}
  </build>
</model>`;

  // model_settings.config
  const objectConfigBlocks = modelSettingObjects.map(
    (o) => `  <object id="${o.id}">
    <metadata key="name" value="${escapeXml(o.name)}"/>
    <metadata key="extruder" value="1"/>
    <part id="${o.id}" subtype="normal_part">
      <metadata key="name" value="${escapeXml(o.name)}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="source_file" value=""/>
      <metadata key="source_object_id" value="0"/>
      <metadata key="source_volume_id" value="0"/>
      <metadata key="source_offset_x" value="0"/>
      <metadata key="source_offset_y" value="0"/>
      <metadata key="source_offset_z" value="0"/>
    </part>
  </object>`,
  );
  const plateConfigBlocks = modelSettingPlates.map((p) => {
    const inst = p.modelInstances.map(
      (m) => `    <model_instance>
      <metadata key="object_id" value="${m.objectId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${m.identifyId}"/>
    </model_instance>`,
    ).join("\n");
    return `  <plate>
    <metadata key="plater_id" value="${p.platerId}"/>
    <metadata key="plater_name" value="${escapeXml(p.plateName)}"/>
    <metadata key="locked" value="false"/>
    <metadata key="thumbnail_file" value="${escapeXml(p.thumbnailFile || "")}"/>
    <metadata key="top_file" value="${escapeXml(p.thumbnailFile || "")}"/>
    <metadata key="pick_file" value=""/>
${inst}
  </plate>`;
  });
  const modelSettingsXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objectConfigBlocks.join("\n")}
${plateConfigBlocks.join("\n")}
</config>`;

  // slice_info.config
  const sliceInfoPlateBlocks = sliceInfoPlates.map((p) => {
    const objs = p.objects.map(
      (o) => `    <object identify_id="${o.identifyId}" name="${escapeXml(o.name)}" skipped="false"/>`,
    ).join("\n");
    return `  <plate>
    <metadata key="index" value="${p.index}"/>
${objs}
  </plate>`;
  });
  const sliceInfoXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="01.09.00.00"/>
  </header>
${sliceInfoPlateBlocks.join("\n")}
</config>`;

  const ct = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/vnd.bambulab-3dmanufacturing-config+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", ct);
  zip.folder("_rels").file(".rels", rels);
  const folder3d = zip.folder("3D");
  folder3d.file("3dmodel.model", modelXml);
  folder3d.folder("_rels").file("3dmodel.model.rels", modelRels);
  const meta = zip.folder("Metadata");
  meta.file("model_settings.config", modelSettingsXml);
  meta.file("slice_info.config", sliceInfoXml);
  // Iter-151.19 — per-plate PNGs into Metadata/.
  for (const p of platePngs) {
    zip.file(p.path, p.bytes);
  }

  const ab = await zip.generateAsync({ type: "arraybuffer" });
  return new Uint8Array(ab);
}

// Iter-151.19 — Top-down 2D thumbnail of a plate's merged geometry.
// Runs in both main-thread and worker contexts — falls back to
// OffscreenCanvas in the worker where `document` doesn't exist.
function _renderPlateThumbnailPng(geometry, w = 512, h = 512) {
  let canvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(w, h);
  } else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
  } else {
    return null;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, w, h);

  const pos = geometry.attributes.position.array;
  const idx = geometry.index ? geometry.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  if (triCount === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const margin = 20;
  const scale = Math.min((w - margin * 2) / spanX, (h - margin * 2) / spanY);
  const offX = (w - spanX * scale) / 2 - minX * scale;
  const offY = (h - spanY * scale) / 2 + maxY * scale;

  ctx.fillStyle = "#f97316";
  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2;
    if (idx) { i0 = idx[t * 3]; i1 = idx[t * 3 + 1]; i2 = idx[t * 3 + 2]; }
    else { i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2; }
    const x0 = offX + pos[i0 * 3] * scale;
    const y0 = offY - pos[i0 * 3 + 1] * scale;
    const x1 = offX + pos[i1 * 3] * scale;
    const y1 = offY - pos[i1 * 3 + 1] * scale;
    const x2 = offX + pos[i2 * 3] * scale;
    const y2 = offY - pos[i2 * 3 + 1] * scale;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fill();
  }
  // toDataURL is the sync export; DOM canvases and OffscreenCanvas
  // both support it (OffscreenCanvas via `convertToBlob` async or a
  // synchronous transferToImageBitmap → still async). Since
  // `toDataURL` is not on OffscreenCanvas, we use `convertToBlob` —
  // but that's async. So we return a Promise-like handler instead.
  //
  // Simplification: on OffscreenCanvas, use convertToBlob → arrayBuffer;
  // otherwise use toDataURL. Callers `await` the return.
  if (typeof canvas.toDataURL === "function") {
    const dataUrl = canvas.toDataURL("image/png");
    const b64 = dataUrl.split(",", 2)[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  // OffscreenCanvas path — return a Promise<Uint8Array>.
  return canvas.convertToBlob({ type: "image/png" }).then(async (blob) => {
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  });
}

// Per-plate mesh block for the multi-plate 3MF. Same structure as
// `_buildVolumeObjectXml` but doesn't emit a `p:UUID` (the base 3MF
// spec doesn't require it, and OrcaSlicer parses fine without one for
// multi-plate imports).
function _buildBambuObjectXml(objectId, geometry) {
  const pos = geometry.attributes.position.array;
  const vertCount = pos.length / 3;
  const vertLines = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    vertLines[i] = `        <vertex x="${pos[i * 3].toFixed(4)}" y="${pos[i * 3 + 1].toFixed(4)}" z="${pos[i * 3 + 2].toFixed(4)}"/>`;
  }
  let triLines;
  if (geometry.index) {
    const idx = geometry.index.array;
    const triCount = idx.length / 3;
    triLines = new Array(triCount);
    for (let i = 0; i < triCount; i++) {
      triLines[i] = `        <triangle v1="${idx[i * 3]}" v2="${idx[i * 3 + 1]}" v3="${idx[i * 3 + 2]}"/>`;
    }
  } else {
    const triCount = vertCount / 3;
    triLines = new Array(triCount);
    for (let i = 0; i < triCount; i++) {
      triLines[i] = `        <triangle v1="${i * 3}" v2="${i * 3 + 1}" v3="${i * 3 + 2}"/>`;
    }
  }
  return `    <object id="${objectId}" type="model">
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


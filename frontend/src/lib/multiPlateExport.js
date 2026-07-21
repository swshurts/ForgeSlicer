/**
 * multiPlateExport — build a ZIP of per-plate STL/3MF files when the
 * project spans multiple plates (iter-151.16).
 *
 * The old flow ran the entire object list through the exporter, which
 * dumped every plate's objects at their world positions into ONE file.
 * OrcaSlicer / Bambu Studio then piled all seven parts of a Drawer
 * Chest onto plate 1 — the exact bug the user reported.
 *
 * This helper splits `objects` by their `plateId`, re-centres each
 * plate group so its bbox centre sits at world (0, 0, min_z_on_bed),
 * runs the group through the standard STL/3MF exporter, and packs
 * every result into a single ZIP the user downloads instead. Each
 * plate becomes an obvious file:  `plate-01-Frame.stl` etc.
 */
import JSZip from "jszip";
import { downloadBlob } from "./exporters";
import { exportSTLBytesAsync, export3MFBytesAsync } from "./workerClient";

/** Group by plateId, defaulting to "plate-1" for legacy / untagged objs. */
function groupByPlate(objects, plates) {
  const buckets = new Map();
  for (const p of plates) buckets.set(p.id, { plate: p, objects: [] });
  for (const o of objects) {
    const pid = o.plateId || "plate-1";
    if (!buckets.has(pid)) {
      // Orphaned plate reference — surface as its own bucket rather
      // than silently dropping.
      buckets.set(pid, { plate: { id: pid, name: pid }, objects: [] });
    }
    buckets.get(pid).objects.push(o);
  }
  return [...buckets.values()].filter((b) => b.objects.length > 0);
}

/** Re-centre a plate group so it lands at the plate's origin.
 *
 *  For each object we compute a delta = -bbox_center_XY of the union,
 *  then apply that delta to every object's position. Z is preserved so
 *  auto-drop-to-bed decisions (feet, lay-flat) don't get undone. */
function recentrePlateObjects(bucket) {
  const objs = bucket.objects;
  if (objs.length === 0) return objs;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const o of objs) {
    const px = o.position?.[0] ?? 0;
    const py = o.position?.[1] ?? 0;
    // Approximate bbox from dims (matches Viewport's projection). We
    // don't need per-triangle precision here — plate-centring only
    // has to be visually correct.
    const halfX = (o.dims?.x ?? 20) * 0.5;
    const halfY = (o.dims?.y ?? 20) * 0.5;
    if (px - halfX < minX) minX = px - halfX;
    if (px + halfX > maxX) maxX = px + halfX;
    if (py - halfY < minY) minY = py - halfY;
    if (py + halfY > maxY) maxY = py + halfY;
  }
  const dx = -(minX + maxX) / 2;
  const dy = -(minY + maxY) / 2;
  return objs.map((o) => ({
    ...o,
    position: [
      (o.position?.[0] ?? 0) + dx,
      (o.position?.[1] ?? 0) + dy,
      (o.position?.[2] ?? 0),
    ],
  }));
}

/** Produce a plain-text README explaining which plate holds what,
 *  so the user opens the zip and immediately knows the assignments. */
function buildReadme(projectName, plateBuckets, format) {
  const lines = [
    `# ${projectName || "ForgeSlicer Project"}`,
    `# Multi-plate ${format.toUpperCase()} export`,
    "",
    `Exported ${new Date().toLocaleString()}`,
    "",
    `This ZIP contains ${plateBuckets.length} plate${plateBuckets.length === 1 ? "" : "s"}, one ${format.toUpperCase()} file per plate.`,
    `Open each file in OrcaSlicer / Bambu Studio / PrusaSlicer separately and each plate lands as a clean, single-plate print.`,
    "",
    "Plate contents:",
    "",
    ...plateBuckets.map((b, i) => {
      const num = String(i + 1).padStart(2, "0");
      const names = b.objects
        .map((o) => o.name || o.id)
        .join(", ");
      return `  ${num}. ${b.plate.name} — ${b.objects.length} part(s): ${names}`;
    }),
    "",
    "Each file was centred on its own plate origin so it lands neatly on the slicer bed.",
    "",
    "— ForgeSlicer",
    "",
  ];
  return lines.join("\n");
}

/** Slugify a plate name for use in filenames. */
function slug(s) {
  return String(s || "plate").replace(/[^a-z0-9-_]/gi, "_").slice(0, 40);
}

export async function exportMultiPlateBundle({
  projectName,
  objects,
  plates,
  format,       // "stl" | "3mf"
  onProgress,   // (done, total) => void
}) {
  const buckets = groupByPlate(objects, plates);
  if (buckets.length <= 1) {
    // Fall through to single-file export. Caller handles this branch.
    return { multi: false };
  }

  const zip = new JSZip();
  const total = buckets.length;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    onProgress?.(i, total);
    const recentred = recentrePlateObjects(b);
    const num = String(i + 1).padStart(2, "0");
    const filename = `plate-${num}-${slug(b.plate.name)}.${format}`;
    let bytes;
    if (format === "stl") {
      const r = await exportSTLBytesAsync(recentred);
      bytes = r.bytes;
    } else {
      const r = await export3MFBytesAsync(recentred);
      bytes = r.bytes;
    }
    zip.file(filename, bytes);
  }
  zip.file("README.txt", buildReadme(projectName, buckets, format));
  onProgress?.(total, total);
  const ab = await zip.generateAsync({ type: "arraybuffer" });
  const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
  downloadBlob(
    new Blob([ab], { type: "application/zip" }),
    `${safe}-plates.${format}.zip`,
  );
  return { multi: true, plateCount: buckets.length };
}

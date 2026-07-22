/**
 * chestInstructions — build a one-page printable assembly guide for a
 * parametric Drawer Chest export (iter-151.23).
 *
 * Given the current chest params + the built parts list, produce:
 *   - Markdown text (for INSTRUCTIONS.md in the ZIP bundle)
 *   - Full HTML page (for INSTRUCTIONS.html — pretty, printable via
 *     Cmd/Ctrl+P on any browser)
 *
 * No external dependencies — pure string composition. Everything the
 * helper needs is already on the parts/params objects.
 */

function fmtMm(v) {
  if (typeof v !== "number") return "—";
  return `${Math.round(v * 10) / 10} mm`;
}

function orientationFor(partId) {
  // Recommended slicer bed orientation, per generator geometry.
  //
  // Frame: prints as-designed (feet flat on the bed). The drawer
  // cavities open forward (toward the operator), so their INTERIOR
  // roof spans the full slot width — this is bridged in-place by
  // most slicers with 3+ perimeters and 20 %+ infill, no supports
  // needed. If bridging looks rough on your printer, enable a very
  // light support-blocker under just the cavity roofs (not the whole
  // frame). Do NOT tip the frame onto its back — the feet will over-
  // hang and the drawer faces will need heavy supports.
  if (partId === "frame") return "Feet flat on the bed (as designed). Drawer-cavity roofs are short bridges — 3+ perimeters + 20% infill handle them without supports on most printers.";
  if (partId === "cap") return "Any face down — flat top / bottom recommended.";
  // Hinged lid: knuckles overhang the back edge but the axle bore is
  // horizontal, so the lid slab prints flat with its underside down.
  // Supports are only needed under the knuckle overhangs.
  if (partId === "hinged-lid") return "Underside DOWN on the bed. Enable supports under the hinge knuckles only (the axle bore stays clean; slab prints solidly on its wide face).";
  // Drawers: FLOOR down (bottom face on the bed) — walls upright,
  // front face pointing horizontally with the handle overhanging.
  // The handle is a small overhang (arched pull / square knob) that
  // needs light supports; a support-blocker inside the drawer keeps
  // the interior clean.
  if (partId?.startsWith?.("drawer")) return "Bottom (floor) DOWN on the bed, walls upright. Enable supports on the FRONT FACE ONLY to catch the handle overhang — block supports inside the drawer volume so the interior stays clean.";
  return "Any orientation — pick the flattest face for best adhesion.";
}

function buildHardwareList(params) {
  const rows = [];
  if (params.topHingedBox) {
    const pinLen = Math.max(20, Math.round((+params.width || 80) - 4));
    rows.push({
      item: "Hinge axle pin",
      qty: 1,
      spec: `Ø2 mm × ${pinLen} mm (steel rod, brass rod, or a paper clip works)`,
    });
    if (params.lidDetent) {
      rows.push({
        item: "— note",
        qty: "",
        spec: "The lid's pin hole is intentionally 0.10 mm tighter (friction-fit detent). Press the pin in from one end; the lid will hold any open angle by friction.",
      });
    }
    if (params.lidKickstand) {
      const stopDeg = Math.min(140, Math.max(85, +params.lidKickstandAngle || 100));
      rows.push({
        item: "— note",
        qty: "",
        spec: `Kickstand is integrated into the hinge geometry — a stop bar on the frame + tabs on the lid collide at ~${stopDeg}°. No extra hardware needed.`,
      });
    }
  }
  return rows;
}

function buildAssemblySteps(params, parts) {
  const steps = [];
  const drawerCount = parts.filter((p) => p.id?.startsWith?.("drawer")).length;

  steps.push("Print every part in the recommended orientation (see the Parts table). Use PLA or PETG at 0.2 mm layers, 3+ walls, 15-25% infill. Supports needed only on the drawer front (handle overhang) and the hinge knuckles on the lid; frame and cap print unsupported.");

  if (params.biscuitJoints) {
    steps.push("Optional: glue thin plywood biscuits into the pocket slots on the front stiles for a decorative wood-joinery accent (purely aesthetic — the frame is already fully solid).");
  }

  steps.push(`Test-fit each of the ${drawerCount} drawer${drawerCount === 1 ? "" : "s"} in its slot. Sliding should be smooth but not sloppy. If any drawer binds, lightly sand its sides (or bump the "Clearance" parameter in the designer +0.1 mm and reprint).`);

  if (params.topHingedBox) {
    steps.push("Interlock the lid's hinge knuckles with the frame's (they alternate — even indices are on the frame, odd are on the lid). Slide the 2 mm axle pin through the aligned bore. If it's too loose, use a slightly larger pin; if too tight, ream the frame-side holes gently with the same-size drill bit — do NOT ream the lid holes (they hold the detent friction).");
  }

  if (params.topHingedBox && params.lidKickstand) {
    const stopDeg = Math.min(140, Math.max(85, +params.lidKickstandAngle || 100));
    steps.push(`Confirm the lid stops cleanly at ~${stopDeg}° when opened — the hinge stop bar catches the lid tabs. If the stop feels weak, verify no layer separation on the frame stop bar's underside.`);
  }

  if (parts.some((p) => p.id === "cap")) {
    steps.push("Set the top cap on the frame — it self-locates by its overhang and needs no glue. Optional: a dab of hot glue or CA on two rear corners locks it permanently.");
  }

  steps.push("If you added Gridfinity locators/baseplates to the drawers, drop your Gridfinity bins in — they'll register to the 42 mm grid crosses on each drawer floor.");

  return steps;
}

/**
 * Build the assembly guide payload.
 * @param {object} params        The chest generator params.
 * @param {Array}  parts         The `parts` array from generateDrawerChest.
 * @param {string} name          Human-friendly chest name (safe filename).
 * @returns {{ markdown: string, html: string }}
 */
export function buildChestAssemblyGuide(params, parts, name) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const overallW = params.width;
  const overallD = params.depth;
  const overallH = params.height;

  // ─── Parts table
  const partRows = parts.map((p) => ({
    file: `${name}_${p.id}.stl`,
    label: p.label,
    dims: p.bbox ? `${fmtMm(p.bbox.x)} × ${fmtMm(p.bbox.y)} × ${fmtMm(p.bbox.z)}` : "—",
    volumeCc: typeof p.volumeMm3 === "number" ? (p.volumeMm3 / 1000).toFixed(1) : "—",
    orient: orientationFor(p.id),
  }));

  const hardware = buildHardwareList(params);
  const steps = buildAssemblySteps(params, parts);

  // ─── Markdown
  const md = [
    `# ForgeSlicer — Drawer Chest Assembly Guide`,
    ``,
    `**Design:** ${name}`,
    `**Overall size:** ${overallW} × ${overallD} × ${overallH} mm`,
    `**Rows:** ${params.rows}${params.topHingedBox ? " (top is a hinged-lid compartment)" : ""}`,
    `**Generated:** ${dateStr}`,
    ``,
    `## Parts`,
    ``,
    `| File | Part | Dimensions (mm) | Volume (cc) | Print orientation |`,
    `|------|------|-----------------|-------------|-------------------|`,
    ...partRows.map((r) => `| \`${r.file}\` | ${r.label} | ${r.dims} | ${r.volumeCc} | ${r.orient} |`),
    ``,
    ...(hardware.length > 0 ? [
      `## Hardware`,
      ``,
      `| Item | Qty | Spec |`,
      `|------|-----|------|`,
      ...hardware.map((h) => `| ${h.item} | ${h.qty} | ${h.spec} |`),
      ``,
    ] : []),
    `## Assembly`,
    ``,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `## Recommended print settings`,
    ``,
    `- Material: PLA or PETG`,
    `- Layer height: 0.2 mm`,
    `- Walls / perimeters: 3+`,
    `- Infill: 15-25% gyroid or grid`,
    `- Supports: **off** for the frame and cap; **on** for drawers (front face only, to catch the handle overhang) and the hinge knuckles on the lid`,
    `- Bed adhesion: skirt or brim; brim on the frame if you have first-layer trouble`,
    ``,
    `## Regenerate`,
    ``,
    `To reprint or tweak this design, re-open the Drawer Chest designer in ForgeSlicer with the parameter values below:`,
    ``,
    "```",
    ...Object.entries(params).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
    "```",
    ``,
  ].join("\n");

  // ─── HTML (printable via Ctrl/Cmd+P)
  const partsHtml = partRows.map((r) => `
      <tr>
        <td><code>${r.file}</code></td>
        <td>${r.label}</td>
        <td>${r.dims}</td>
        <td>${r.volumeCc}</td>
        <td>${r.orient}</td>
      </tr>`).join("");

  const hardwareHtml = hardware.length
    ? `<h2>Hardware</h2>
       <table><thead><tr><th>Item</th><th>Qty</th><th>Spec</th></tr></thead>
       <tbody>${hardware.map((h) => `<tr><td>${h.item}</td><td>${h.qty}</td><td>${h.spec}</td></tr>`).join("")}</tbody></table>`
    : "";

  const stepsHtml = steps.map((s, i) => `<li>${s}</li>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${name} — Drawer Chest Assembly Guide</title>
<style>
  * { box-sizing: border-box; }
  body { font: 12pt/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1e293b; margin: 0; padding: 24px 32px; max-width: 900px; }
  h1 { font-size: 22pt; margin: 0 0 4px; color: #0f172a; }
  h2 { font-size: 14pt; margin: 20px 0 8px; color: #0f172a; border-bottom: 2px solid #f97316; padding-bottom: 4px; }
  h3 { font-size: 12pt; margin: 12px 0 4px; }
  .meta { color: #475569; font-size: 10pt; margin-bottom: 16px; }
  .meta b { color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 10pt; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 9.5pt; }
  ol { padding-left: 20px; }
  li { margin: 6px 0; }
  pre { background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 6px; font-size: 9pt; overflow-x: auto; }
  .footer { color: #94a3b8; font-size: 9pt; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  @media print {
    body { padding: 12mm; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
    li { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${name} — Drawer Chest Assembly Guide</h1>
  <div class="meta">
    <b>Overall size:</b> ${overallW} × ${overallD} × ${overallH} mm &nbsp;·&nbsp;
    <b>Rows:</b> ${params.rows}${params.topHingedBox ? " (top = hinged lid)" : ""} &nbsp;·&nbsp;
    <b>Generated:</b> ${dateStr} &nbsp;·&nbsp;
    <b>ForgeSlicer</b>
  </div>

  <h2>Parts</h2>
  <table>
    <thead><tr><th>File</th><th>Part</th><th>Dimensions</th><th>Volume (cc)</th><th>Print orientation</th></tr></thead>
    <tbody>${partsHtml}</tbody>
  </table>

  ${hardwareHtml}

  <h2>Assembly steps</h2>
  <ol>${stepsHtml}</ol>

  <h2>Recommended print settings</h2>
  <ul>
    <li>Material: PLA or PETG</li>
    <li>Layer height: 0.2 mm</li>
    <li>Walls / perimeters: 3+</li>
    <li>Infill: 15-25% gyroid or grid</li>
    <li>Supports: <b>off</b> for the frame and cap; <b>on</b> for drawers (front face only, to catch the handle overhang) and for the hinge knuckles on the lid</li>
    <li>Bed adhesion: skirt or brim</li>
  </ul>

  <h2>Regenerate this design</h2>
  <p>Open the Drawer Chest designer in ForgeSlicer and paste these parameters into any matching field:</p>
  <pre>${Object.entries(params).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}</pre>

  <div class="footer">Generated by ForgeSlicer · Print this page (Ctrl/Cmd + P) for a shop-ready copy.</div>
</body>
</html>`;

  return { markdown: md, html };
}

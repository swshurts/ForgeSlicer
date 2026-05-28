// ForgeSlicer release notes — newest at the TOP of the array.
//
// Each entry:
//   - `version`: semver string used as the localStorage "seen" key.
//      Bump whenever you want returning users to be auto-shown the dialog.
//   - `date`: ISO yyyy-mm-dd. Rendered as a readable date in the dialog.
//   - `title`: short headline shown next to the date.
//   - `changes`: ordered list of bullets. Each bullet has a `type`
//      ("feature" | "improvement" | "fix") that drives the colored chip.
//
// Keep entries concise — the dialog is scannable, not a press release.
// Treat this file as a public-facing artifact and write for end-users
// (no implementation jargon).

export const RELEASE_NOTES = [
  {
    version: "1.19.0",
    date: "2026-02-28",
    title: "Sweep preset library · Fastener Pair macro · ref-export fix",
    changes: [
      { type: "feature", text: "Sweep preset library — pick from 8 hand-tuned cards in the Sweep Inspector (Helical spring, Watch spring, Twisted cable, Corkscrew, Rope, Hex bar arc, Spiral railing, Tornado funnel). One click rewrites the full Sweep dims; you can tweak every field afterward without resetting." },
      { type: "feature", text: "Fastener Pair macro — single \"Fastener Pair\" button under Composites drops a Bolt + Nut + bore cylinder + head counterbore, all pre-grouped so they move as one fastener (and ungroup-able for fine-tuning). The 4 parts share matching pitch/major-radius so the threads visually mate, and the layout is built so dropping it onto a 12mm-thick host gives you a flush-headed, fully-threaded fastener with one click." },
      { type: "fix", text: "Sweep objects with path-source \"From Object\" (ref-sweeps) now export correctly to STL — the engine resolves the reference at export time via a module-level scene context, so a sweep that rides another helix is part of the final mesh just as it appears in the viewport." },
    ],
  },

  {
    version: "1.18.1",
    date: "2026-02-28",
    title: "Center on bed — right-click menu",
    changes: [
      { type: "feature", text: "Right-click → \"Center on bed\" — translates the selected item or assembly so its combined X/Z bounding-box center sits at the build-plate origin. Y is preserved (use Drop-to-bed for the vertical case). For multi-part selections it centers the whole group as a RIGID UNIT — internal distances are kept exactly so a Pitman Arm stays a Pitman Arm. Sits right under Drop-to-bed in the context menu." },
    ],
  },

  {
    version: "1.18.0",
    date: "2026-02-28",
    title: "Sweep primitive · Live profile-along-path extrusion",
    changes: [
      { type: "feature", text: "New SWEEP primitive — extrude a 2D profile along a 3D path. The profile stays perpendicular to the path tangent at every sample (true sweep, like Fusion / SolidWorks). Profile kinds: Circle, Rectangle, Polygon (Sketch coming next iteration). Path kinds: Helix (radius / pitch / turns), Arc (radius / sweep angle), Bezier (4 control points), Sketch-3D polyline, OR you can ride an existing Helix's centerline via \"From Object\" — handy for drawing a square-section spring around a known helix axis. Twist any sweep around the path tangent for spiral cable wraps / corkscrews. Every field re-bakes the geometry live in the Inspector." },
      { type: "improvement", text: "Refactor — heavy quaternion math and history machinery extracted from store.js into dedicated lib/transforms.js + lib/historyStack.js modules. No behavior change; the rigid-body group rotation fix from v1.17 is now unit-testable in isolation. /app/memory/PRD.md split into PRD.md (static spec), CHANGELOG.md (append-only history), ROADMAP.md (prioritised backlog) — easier to keep current as the app grows." },
    ],
  },

  {
    version: "1.17.1",
    date: "2026-02-28",
    title: "STL preview matches viewport — rotation-order fix",
    changes: [
      { type: "fix", text: "The eyeball STL Preview no longer shows assembly parts in different positions than the live viewport. Under the hood the manifold-3d engine was rotating objects in global X→Y→Z order while THREE.Euler('XYZ') uses global Z→Y→X — the two are opposite, so any part with non-trivial multi-axis rotations (e.g. every child after a group rotation) ended up displaced in the export. Now the engine bakes rotations via the same column-major matrix the viewport uses, so the preview is bit-for-bit faithful to what you'll get in the slicer and the saved gallery thumbnail." },
    ],
  },

  {
    version: "1.17.0",
    date: "2026-02-28",
    title: "Rigid-body rotations stay rigid · OrcaSlicer profile fix",
    changes: [
      { type: "fix", text: "Multi-rotation assembly drift — rotating a grouped assembly two or three times in a row no longer scatters its members. Underneath, the rotation math now composes via quaternions rather than per-axis Euler subtraction, so the children stay locked to the primary regardless of how many world-axis tweaks you apply or what starting orientation each piece has. Both the popover and the gizmo paths fixed in lockstep." },
      { type: "fix", text: "OrcaSlicer \"unknown config type\" error — slicing via the OrcaSlicer engine no longer 251-errors on non-Bambu printers (Sovol, Voron, Prusa, Creality, Custom). The generated profile JSONs now ride a bundled OrcaSlicer system preset (`MyKlipper 0.4 nozzle` for the universal fallback), and every config value is stringified to match Orca's strict on-disk format. The built-in JS slicer was never affected — this only impacted the opt-in production-quality engine." },
    ],
  },

  {
    version: "1.16.0",
    date: "2026-02-27",
    title: "Splined Shaft primitive + Slice progress + draft indicator",
    changes: [
      { type: "feature", text: "New Spline primitive — a splined SHAFT with N longitudinal teeth running along its Y axis. Editable: core diameter, length, teeth count, tooth depth, tooth angle (deg) AND tooth width (mm) — the Inspector keeps both in sync via width = 2·R·sin(deg/2). When you ask for a width that won't fit at the current tooth count, a small nearest-fit dialog offers 2-3 alternative (count, width) pairs so you pick — never silently snapped. Tooth profile selectable: Rectangular (ISO splines), Triangular (involute/serration), or Rounded (knurled grip). Toggle the object to Negative and you get a splined-bore cutter for the matching shaft." },
      { type: "feature", text: "Slice progress bar — when slicing via OrcaSlicer, the popover now shows a live % / stage progress bar instead of just \"Slicing…\". Driven by a Server-Sent Events stream parsed from OrcaSlicer's stdout. No more wondering if a long slice is stuck." },
      { type: "improvement", text: "Tiny amber dot + amber input border appears in every numeric field (Position / Rotation / Size / dimensions) when you've typed a value but haven't committed yet. Hover for a tooltip: \"Unsaved edit — press Enter to commit\". Avoids the classic \"I typed 45 then clicked Rotate again and lost my value\" frustration." },
    ],
  },

  {
    version: "1.15.1",
    date: "2026-02-27",
    title: "Rotation double-fire fix",
    changes: [
      { type: "fix", text: "Typing a value in the Rotation / Position / Size popover and pressing Enter no longer applies the value twice. Previously Enter ran the commit immediately AND fired a blur whose handler also re-ran commit with a stale value — for absolute fields (Position, Size) the second pass was harmless, but for multi-select Rotation (which applies a delta) it doubled the rotation: typing 45° rotated by 90°, and the second pass also re-ran the rigid-body orbit math, which disassembled the group. Fixed with a single-flight ref guard." },
    ],
  },

  {
    version: "1.15.0",
    date: "2026-02-27",
    title: "Bolts + Nuts, Settings panel, Save Assembly, Export STL fix",
    changes: [
      { type: "fix", text: "Critical fix — Export STL and Save-to-Share crashed with \"Minified React error #321\" on production. Root cause: `useScene` (Zustand hook) was being called as a regular function from inside event handlers, which React 19 production builds reject as an invalid hook call. Action handlers now go through `.getState()` so the hook machinery never fires from a click. Same fix unblocks every other project action (New / Open / Save / Boolean / Import / Export 3MF)." },
      { type: "feature", text: "New Bolt + Nut primitives — parametric ISO-metric inspired. Bolt = hex (or button) head + threaded shaft sweeping a helix tube. Nut = hex prism with an inner thread helix. Editable: thread diameter, pitch, length, head/flat dimensions. Pitch-match a bolt to a nut for screw compatibility." },
      { type: "feature", text: "Settings dialog (cog icon in the toolbar). Two tabs: Appearance (theme + per-page pinning) and Engine (OrcaSlicer status + Reinstall button + force-redownload toggle). Reinstall runs in the background and the status pill polls automatically." },
      { type: "feature", text: "Save Assembly to Components — every Outliner group header now has a small Save icon next to the chevron. Click it to push the named assembly (e.g. \"Pitman Arm\") into the component library; the Save dialog opens pre-filled with the group's name + your selected members." },
      { type: "improvement", text: "Export STL errors now log a full stack to the browser console (not just the alert text) so future bugs of this kind take seconds to diagnose instead of hours." },
    ],
  },

  {
    version: "1.14.3",
    date: "2026-02-27",
    title: "Assembly rotation as a unit + rename groups",
    changes: [
      { type: "fix", text: "Assembly rotation: rotating a grouped assembly via the Rotation popover now keeps members as a rigid unit. Previously the auto-Drop-to-Bed was snapping each member to Y=0 independently right after the rotation, which broke the vertical alignment of any assembly. The drop is now a single group-level translation that lands the lowest world-Y point on the bed without disturbing relative offsets." },
      { type: "fix", text: "Fixed a runtime error (THREE.Euler is not a constructor) that could cause the rotation orbit math to silently no-op in some builds — three.js is now imported directly at the top of the store module." },
      { type: "feature", text: "Rename assemblies inline: double-click the assembly name in the Outliner (e.g. \"Group\" → \"Pitman Arm\"), type the new name, press Enter. Esc cancels. The name is stamped onto every member so it stays consistent if you re-export or re-import the group." },
    ],
  },

  {
    version: "1.14.2",
    date: "2026-02-27",
    title: "Assembly tools — bed gizmo sync + group resize fix",
    changes: [
      { type: "fix", text: "Clicking Position / Rotation / Size in the toolbar now also switches the on-bed gizmo to match (translate arrows / rotation rings / scale handles). Before, you could be editing rotation values while the gizmo still showed translate arrows." },
      { type: "fix", text: "Resizing a grouped Assembly used to scale only the primary member while the others stayed at their original size — making the primary balloon out and visually 'consume' its siblings. Now the whole assembly scales as one rigid unit: every member scales by the same factor AND spreads outward from the primary, so the proportions stay coherent (matches TinkerCad's group-resize semantics)." },
    ],
  },

  {
    version: "1.14.1",
    date: "2026-02-27",
    title: "Assembly rotation — rigid-body fix",
    changes: [
      { type: "fix", text: "Rotating a multi-part Assembly (group) now rotates the whole assembly as one rigid unit, orbiting every member around the assembly's combined centroid — just like in TinkerCad / Fusion. Previously each member rotated around its own center, breaking the relative geometry of any offset assembly." },
    ],
  },

  {
    version: "1.14.0",
    date: "2026-02-27",
    title: "Sketch curves + OrcaSlicer bug fix",
    changes: [
      { type: "feature", text: "New Sketch Curve tool — draw a polyline with the Pencil tool, then switch to Curve and drag the cyan handle on any edge to bend it into a smooth arc. Double-click a curved handle to straighten the edge again. Curves are sampled into 16 short segments on commit so the extrude stays clean." },
      { type: "feature", text: "OrcaSlicer profile editor: clickable preset hints — when you pick a Bambu printer, the resolved bundled JSON name shows up under each dropdown. Click it to open a read-only viewer of the actual flattened preset OrcaSlicer will load. Useful for debugging and for power users who want to verify the slicer config." },
      { type: "fix", text: "Fixed OrcaSlicer rejecting our generated profile JSONs with \"unknown config type\" — the staging pipeline now always stamps the required type/name/from/instantiation metadata, even when system-preset resolution falls through. Slicing should work end-to-end on Bambu printers now." },
      { type: "improvement", text: "OrcaSlicer process labels now match the slicer's own bundled-preset names exactly (0.20mm Standard, 0.12mm Fine, 0.28mm Extra Draft) so what you see here is what loads inside OrcaSlicer." },
    ],
  },

  {
    version: "1.13.0",
    date: "2026-05-26",
    title: "Toolbar refactor (housekeeping)",
    changes: [
      { type: "improvement", text: "Top toolbar rewritten: the 684-line monolith is now a 112-line shell that composes seven small focused modules (system row, edit row, project actions, keyboard shortcuts, shared UI primitives, sketch button, add-primitive dropdown). No user-visible change, but new features will land faster from here." },
    ],
  },
  {
    version: "1.12.1",
    date: "2026-05-26",
    title: "Curve primitives — correct measurements",
    changes: [
      { type: "fix", text: "The Size popover and percent-scale controls were showing 1 × 1 × 1 for Helix, Pipe, and Wedge because the size resolver hadn't been taught about the new primitive types. Now reports the correct mm dimensions and base size for every shape." },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-05-26",
    title: "Curve primitives — Helix, Pipe, Wedge",
    changes: [
      { type: "feature", text: "Three new shapes in the 3D palette. Helix: parametric coil/spring/thread with editable radius, tube ⌀, pitch and turns. Pipe: hollow cylinder with editable outer ⌀, wall thickness, and height (inner ⌀ shown live). Wedge: TinkerCAD-style ramp." },
      { type: "feature", text: "All three primitives play nicely with every existing tool: drop-to-bed, transforms, boolean union/subtract, slicing, STL/3MF export, and they can be set as Negative cutouts." },
      { type: "improvement", text: "Inspector dimension forms specific to each new shape — Helix shows live computed Height (= turns × pitch); Pipe shows live computed Inner ⌀; Wedge shows ramp orientation hint." },
    ],
  },
  {
    version: "1.11.1",
    date: "2026-05-26",
    title: "Print history & one-click reprint",
    changes: [
      { type: "feature", text: "New Recent Uploads section in the Send-to-Printer dialog logs every successful upload (filename · printer · size · relative time · started/queued badge). Last 50 entries persisted locally." },
      { type: "feature", text: "Per-row Send + Print buttons re-upload from history with a single click — no need to re-slice if the same project is still open. Older entries become re-uploadable as soon as you re-slice the matching project." },
      { type: "feature", text: "Sovol SV06 Plus Ace added to the OrcaSlicer printer catalogue (the 2025 Klipper refresh — direct drive, 500 mm/s, 300×300×340 build)." },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-05-26",
    title: "Send GCODE directly to your printer",
    changes: [
      { type: "feature", text: "New \"Send to my printer\" button appears next to Download GCODE after every successful slice. Upload to any Moonraker-based printer (Sovol SV07/SV08, Voron, BTT, all DIY Klipper builds) over your LAN — no SD card shuffling required." },
      { type: "feature", text: "Per-user printer profiles persist locally — add your printer's network address once and reuse it across every project. Includes a \"Test connection\" button so you can verify before saving, plus a one-click copy-paste config snippet to enable uploads from forgeslicer.com in your moonraker.conf." },
      { type: "feature", text: "Upload alone, or Upload & Start Print — the latter immediately queues the file to print on the connected machine." },
      { type: "improvement", text: "Roadmap entries shown in the protocol picker for PrusaLink, OctoPrint, and Bambu Lab (limitations explained — each requires a CORS or MQTT relay we'll add in follow-up releases)." },
    ],
  },
  {
    version: "1.10.1",
    date: "2026-05-26",
    title: "OrcaSlicer profile editor (Phase 1.5)",
    changes: [
      { type: "feature", text: "Profile editor appears in the Slicer popover whenever the OrcaSlicer engine is selected — printer dropdown (12 models across Bambu Lab, Prusa, Voron, Sovol, Creality, plus Custom), Print Profile (Standard / Fine / Draft / Strong), Filament (PLA / PETG / ABS / TPU / ASA), and inline tunables for perimeter count, infill density, infill pattern, tree supports, and ironing." },
      { type: "feature", text: "Sovol SV06, SV06 Plus, SV07, and SV08 included in the printer catalogue, with correct gcode flavor (Marlin for SV06/SV06+, Klipper for SV07/SV08) and accurate build volumes." },
      { type: "improvement", text: "All profile selections + tunables persist to localStorage so a returning user lands back on their last setup." },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-05-26",
    title: "OrcaSlicer engine integration (Phase 1)",
    changes: [
      { type: "feature", text: "New Slicer Engine picker at the top of the Slicer Settings popover: choose Built-in (in-browser, fast, single-perimeter) or OrcaSlicer (server-side, production quality — multi-perimeter walls, full infill pattern catalogue, real supports, AMS, ironing)." },
      { type: "improvement", text: "Right panel converted to a tabbed layout — Inspect / Print / Health — matching the left panel pattern. Reduces visual density and your last-used tab persists across sessions." },
      { type: "fix", text: "Voice control no longer hangs at \"Listening…\" — ambient-noise calibration auto-tunes the speech threshold to your environment, a 12-second hard cap guarantees the recorder always wraps up, and Whisper's known silence hallucinations (\"you\", \"thanks for watching\", etc.) now collapse to a friendly \"no speech detected\" message instead of executing as commands." },
      { type: "fix", text: "Share to Gallery + Save Component dialogs no longer remember the previous Description, Author, or Tags between opens — every save starts on a clean form." },
    ],
  },
  {
    version: "1.9.1",
    date: "2026-05-26",
    title: "SVG fidelity + Share dialog stickiness fix",
    changes: [
      { type: "fix", text: "SVG import now strips the giant background rectangle that many logo exporters emit by default. Logos no longer land as a flat orange slab — you see the actual artwork." },
      { type: "fix", text: "Letter interiors are carved correctly — closed shapes with holes (O, A, B, P, D, R, e, o, etc.) import the outer contour as positive and each interior as a negative sibling sharing the same group, so the letter forms read properly." },
      { type: "fix", text: "Share to Gallery and Save Component dialogs no longer remember the previous Description / Tags / Author text — every open starts clean." },
      { type: "fix", text: "Calendar dates corrected — earlier releases this week were stamped February by mistake. They were authored in May." },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-05-25",
    title: "AMS-aware GCODE preview + SVG logos as one assembly",
    changes: [
      { type: "feature", text: "GCODE preview now visualizes multi-material prints in full colour — each AMS slot's toolpaths paint in their filament hex, tool-change positions get a small ring marker, and a legend lets you hide individual extruders to inspect one colour at a time." },
      { type: "feature", text: "Slicer auto-detects scenes with 2+ colour slots and emits proper T<n> tool-change commands plus an AMS_TABLE header so downstream firmware (and our own preview) reads the palette out-of-the-box." },
      { type: "improvement", text: "SVG import groups multi-path artwork (logos, multi-glyph icons) into a single moveable assembly by default — clicking any glyph selects the whole logo. Toggle off to keep paths independent." },
      { type: "fix", text: "Release-notes dates were rolling back a day in US timezones (midnight UTC → previous local day). Pinned to midday UTC so the displayed date matches everywhere." },
    ],
  },
  {
    version: "1.8.2",
    date: "2026-05-24",
    title: "Auto-repair imported STLs",
    changes: [
      { type: "feature", text: "Imported STLs are now auto-repaired on the fly — tiny topology defects (hairline cracks, duplicate vertices, sub-micron gaps) common in third-party files get welded silently before slicing. Saves a manual \"Repair\" step in OrcaSlicer or FlashForge Studio." },
      { type: "improvement", text: "Repair runs at four progressive tolerance levels scaled to the model size, so small parts don't get over-collapsed and large parts still close." },
    ],
  },
  {
    version: "1.8.1",
    date: "2026-05-24",
    title: "Imported STLs reappear",
    changes: [
      { type: "fix", text: "Imported STLs with tiny topology defects (open edges, near-coincident verts — common in third-party files) no longer silently vanish from STL/3MF export or the eye preview. They now route through the forgiving BVH boolean path automatically." },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-05-23",
    title: "Sketch Mode",
    changes: [
      { type: "feature", text: "New Sketch mode — draw a 2D shape directly on the build plate (Pencil for free-form polygons, Rect for rectangles, Circle for discs) and it instantly becomes an editable 3D extrusion." },
      { type: "feature", text: "Sketches respect every existing tool: drop-to-bed, transforms, boolean union/subtract, slicing, STL/3MF export, and they can be set as Negative cutouts." },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-02-25",
    title: "Plans &amp; Pricing",
    changes: [
      { type: "feature", text: "New Maker ($50/yr) and Pro ($190/yr) tiers unlock more AI generations, unlimited private designs, commercial-use license badges, and priority slicing. Manage everything from the new Plans & Pricing page in the user menu." },
      { type: "improvement", text: "Stripe-powered checkout handles every payment — your card details never touch our servers." },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-02-24",
    title: "Watertight Cut + Activity Feed",
    changes: [
      { type: "improvement", text: "Cut tool + Flatten now both use the manifold-3d engine — every piece they produce is guaranteed watertight (no slivers, no open edges)." },
      { type: "feature", text: "Profile pages have a new Activity tab — see who remixed your designs, when, and what they made. Newest first." },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-02-24",
    title: "Better Slicing + Toolpath Preview",
    changes: [
      { type: "feature", text: "GCODE Preview — after slicing, click \"Preview toolpaths layer-by-layer\" to scrub through every layer in a 2D top-down viewer. Orange = print, grey = travel." },
      { type: "feature", text: "Hybrid infill — sparse layers right next to the top & bottom solid bands now use a denser pattern to bridge cleanly into the solid (configurable Transition layers count, default 2)." },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-02-24",
    title: "Real Slicing",
    changes: [
      { type: "feature", text: "Real solid infill — top & bottom layers now print fully closed (configurable Bottom Solid / Top Solid count)." },
      { type: "feature", text: "Real sparse infill — choose Rectilinear, Grid, or Gyroid pattern at 0–100% density for the middle layers." },
      { type: "feature", text: "Gallery cards show a green Manifold ✓ badge when a design was exported via the new watertight pipeline." },
      { type: "improvement", text: "Slicer popover now shows a clear \"Saved as <file>.gcode\" confirmation plus a \"Download again\" button in case your browser silently dropped the file." },
      { type: "improvement", text: "Slicer settings auto-scroll when the window is short — the Slice button is always reachable." },
    ],
  },
  {
    version: "1.3.1",
    date: "2026-02-24",
    title: "Toolbar polish",
    changes: [
      { type: "fix", text: "Top toolbar now wraps onto extra rows when the window isn't fullscreen — every button stays reachable." },
      { type: "improvement", text: "Project-name input shrinks gracefully on narrow windows instead of hogging the row." },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-02-24",
    title: "Sign-in fixes",
    changes: [
      { type: "fix", text: "Google sign-in no longer throws a runtime error overlay that blocked the form." },
      { type: "fix", text: "Your sign-in now persists across browser sessions for 7 days (CORS cookie handling fixed)." },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-02-23",
    title: "Watertight booleans + new shortcuts",
    changes: [
      { type: "feature", text: "Boolean operations now use Google's manifold-3d engine — guaranteed watertight output, no slivers or open edges." },
      { type: "feature", text: "Add Primitive dropdown in the toolbar — drop a cube/sphere/cylinder/cone/torus or 2D shape without leaving the canvas." },
      { type: "feature", text: "Every Gallery card has a \"Copy share link\" button. Shared links use the web+forgeslicer:// protocol so they remix cleanly." },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-02-23",
    title: "Admin Panel + voice AI",
    changes: [
      { type: "feature", text: "Admin Panel (/admin) — analytics, user management, AI quota overrides, audit log, CSV export." },
      { type: "feature", text: "Voice commands can now trigger the AI Generation dialog. Say things like \"generate a low-poly fox\" and we'll start the job." },
      { type: "improvement", text: "Top toolbar split into two rows so Help, What's New, and the user menu always render." },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-02-22",
    title: "Public launch",
    changes: [
      { type: "feature", text: "Email + password sign-in, magic link sign-in, and Google sign-in — pick whichever you prefer." },
      { type: "feature", text: "Public author profiles at /u/<userId> with optional avatar, social links, and location toggles." },
      { type: "feature", text: "Public + Private gallery filter — share designs publicly or keep them just for you." },
      { type: "feature", text: "AI 3D generation via Meshy — text- or image-to-mesh, importable straight onto the build plate." },
    ],
  },
];

// Convenience helper — returns the version string of the newest entry, or
// "" if the changelog is empty. Used by ReleaseNotesDialog to decide
// whether to auto-open the dialog on a returning user's first load.
export function latestReleaseVersion() {
  return RELEASE_NOTES[0] ? RELEASE_NOTES[0].version : "";
}

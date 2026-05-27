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

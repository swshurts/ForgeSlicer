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

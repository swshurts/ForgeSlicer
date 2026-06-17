// Voice command lexicon — the searchable phrase catalogue rendered inside
// the Help dialog's Voice Commands section. Extracted from HelpDialog.jsx
// so the data and the UI live in separate files (data churn doesn't force
// a JSX re-read).
//
// Every entry MUST have:
//   - phrase: the spoken form the user will say verbatim
//   - action: short slug (matches the parser's intent name)
//   - desc:   a 1-line plain-English explanation
//
// Keep entries SHORT. The PDF tutorial is for long-form prose; this is
// the in-app quick reference.
export const VOICE_LEXICON = [
  {
    category: "Add objects",
    items: [
      { phrase: "Add a cube",                                   action: "add",       desc: "Adds a default positive cube to the scene." },
      { phrase: "Add a negative cylinder 5 millimeters wide",   action: "add",       desc: "Adds a negative cylinder with diameter ≈ 5 mm." },
      { phrase: "Add a sphere with radius 8",                   action: "add",       desc: "Adds a sphere with explicit radius." },
      { phrase: "Add a 10 by 20 by 5 cube",                     action: "add",       desc: "Adds a cube with explicit X/Y/Z dimensions." },
      { phrase: "Drop a hex prism",                             action: "add",       desc: "Adds a cylinder with 6 sides (a hexagonal prism)." },
    ],
  },
  {
    category: "Move / Rotate / Scale",
    items: [
      { phrase: "Move it up 10",                                action: "translate", desc: "Translates the selection +10 mm on Y." },
      { phrase: "Move 5 millimeters to the right",              action: "translate", desc: "+5 mm on X." },
      { phrase: "Slide forward 3",                              action: "translate", desc: "+3 mm on Z (toward the camera)." },
      { phrase: "Rotate 90 degrees on Z",                       action: "rotate",    desc: "Rotates the selection 90° about the Z axis." },
      { phrase: "Tilt 15 degrees on X",                         action: "rotate",    desc: "Rotates 15° about the X axis." },
      { phrase: "Scale by 2",                                   action: "scale",     desc: "Uniformly scales the selection ×2." },
      { phrase: "Make it twice as tall",                        action: "scale",     desc: "Scales Y by 2." },
      { phrase: "Resize to 30 by 30 by 5",                      action: "resize",    desc: "Sets exact dimensions instead of a factor." },
      { phrase: "Position at 0 10 0",                           action: "position",  desc: "Moves the part to absolute coordinates." },
    ],
  },
  {
    category: "Scene management",
    items: [
      { phrase: "Drop to bed",                                  action: "drop",      desc: "Snaps the bottom of the selection to Y=0." },
      { phrase: "Delete it",                                    action: "delete",    desc: "Removes the current selection." },
      { phrase: "Duplicate this",                               action: "duplicate", desc: "Copies the selection in place." },
      { phrase: "Duplicate and mirror on X",                    action: "duplicate", desc: "Copies + mirrors so the new part sits flush." },
      { phrase: "Group these",                                  action: "group",     desc: "Wraps the multi-selection in an Assembly group." },
      { phrase: "Ungroup",                                      action: "ungroup",   desc: "Breaks the selection out of its group." },
      { phrase: "Select all",                                   action: "select_all", desc: "Selects every object." },
      { phrase: "Clear selection",                              action: "clear_selection", desc: "Deselects everything." },
      { phrase: "Undo",                                         action: "undo",      desc: "Steps backward one atomic action." },
      { phrase: "Redo",                                         action: "redo",      desc: "Steps forward." },
    ],
  },
  {
    category: "Booleans & modifiers",
    items: [
      { phrase: "Subtract these two",                           action: "boolean",   desc: "Runs a CSG subtract on the two most recent / selected parts." },
      { phrase: "Union them",                                   action: "boolean",   desc: "CSG union." },
      { phrase: "Intersect",                                    action: "boolean",   desc: "CSG intersect." },
      { phrase: "Make this negative",                           action: "modifier",  desc: "Flips the selection's modifier tag." },
    ],
  },
  // ─────────────────────────────────────────────────────────────────────
  // Parametric templates — the newer "say-it-and-get-the-finished-part"
  // commands. Each one routes the transcript to a backend builder in
  // /app/backend/voice_templates/, which emits a deterministic plan
  // shown in the Plan Preview dialog before anything lands on the bed.
  //
  // Phrasing rules that improve hit-rate (NOT exhaustive — the LLM is
  // tolerant of variants, but if a phrase keeps failing, copy one of
  // these verbatim):
  //   • Lead with the action verb: "Make a…", "Create a…", "Build me a…"
  //   • Name the template up front: "faceplate", "bracket", "drawer pull",
  //     "tool holder". Don't bury it past several adjectives — the parser
  //     reads top-down and tags the first template-ish noun it finds.
  //   • Pass dimensions as units, not raw numbers: "6 inch deep" rather
  //     than "6 deep". Mix imperial and metric freely.
  //   • For the faceplate: which CONNECTORS you want is "+y" = the long
  //     side with USB/Ethernet, "-x" = the short side with HDMI/USB-C.
  //     Default is +y only — a minimal front panel, not a full tray.
  // ─────────────────────────────────────────────────────────────────────
  {
    category: "Parametric templates (newer — Plan Preview opens)",
    items: [
      // ── Board faceplates ──
      { phrase: "Make a faceplate for a Raspberry Pi 4",                   action: "template", desc: "Pi 4 — defaults to a flat 95×66×3 mm plate with USB/USB/GbE cutouts on the long edge (+y). NO mount holes, NO short-edge connectors." },
      { phrase: "Make a Pi 4 mounting tray with the mount holes",          action: "template", desc: "Adds the four M2.5 mount-pillar holes AND the short-edge HDMI/USB-C cutouts. Full tray." },
      { phrase: "Make a Pi 4 faceplate with the HDMI cutout",              action: "template", desc: "Flat plate with the short-edge HDMI/USB-C/audio cutouts only." },
      { phrase: "Make a Pi 5 front panel with all connectors",             action: "template", desc: "Pi 5; pass `faces:['+y','-x']` so both edges are cut." },
      { phrase: "Create an Arduino Mega faceplate",                        action: "template", desc: "Same template, swap board=`arduino_mega_2560`." },
      // ── Right-angle bracket ──
      { phrase: "Make a 90 degree bracket for a 6 inch deep shelf that's 1 inch thick supporting 30 pounds", action: "template", desc: "Auto-sizes the gusset and base flange. Pass thickness + load in pounds." },
      { phrase: "Build me a corner bracket 80 mm by 80 mm, 5 mm thick",    action: "template", desc: "Metric bracket — pass arm length in mm." },
      // ── Drawer pull ──
      { phrase: "Create a drawer pull 120 millimeters wide",               action: "template", desc: "Standard centered handle with two M4 screw holes 96 mm apart (industry default)." },
      { phrase: "Make a drawer pull with 64 mm hole spacing",              action: "template", desc: "Override the hole-spacing parameter (Euro 64 / US 96 / heavy 128)." },
      // ── Tool holder ──
      { phrase: "Make a tool holder for 6 screwdrivers, 12 mm wide each",  action: "template", desc: "Wall-mountable strip with `count` slots of `slot_diameter`." },
      { phrase: "Create a wrench rack with 8 slots tapering 8 to 20 mm",   action: "template", desc: "Slot list can taper — say the smallest and largest size." },
    ],
  },
  {
    category: "AI generation",
    items: [
      { phrase: "Open the AI generator",                        action: "open",        desc: "Opens the AI Generate dialog (no prompt)." },
      { phrase: "Generate a small dragon for FDM printing",     action: "ai_generate", desc: "Pre-fills the AI generator with the noun phrase AND auto-submits — uses a credit." },
      { phrase: "Make me a coffee mug with AI",                 action: "ai_generate", desc: "Pre-fills + auto-submits." },
      { phrase: "AI a low-poly fox",                            action: "ai_generate", desc: "Pre-fills + auto-submits." },
      { phrase: "I want to make a chess piece with AI",         action: "ai_generate", desc: "Pre-fills the prompt but waits for you to click Generate — no credit until you do." },
    ],
  },
  {
    category: "Modes & I/O",
    items: [
      { phrase: "Switch to rotate mode",                        action: "mode",      desc: "Sets the gizmo to rotation." },
      { phrase: "Translate mode",                               action: "mode",      desc: "Sets the gizmo to translate." },
      { phrase: "Export as STL",                                action: "export",    desc: "Downloads the scene as a binary STL." },
      { phrase: "Export 3MF",                                   action: "export",    desc: "Downloads as 3MF (preserves modifiers + colors)." },
      { phrase: "Save the project",                             action: "export",    desc: "Writes the editable .forge.json file." },
      { phrase: "Open share dialog",                            action: "open",      desc: "Opens the Share-to-Gallery dialog." },
      { phrase: "Save as component",                            action: "open",      desc: "Opens the Component Library save dialog." },
      { phrase: "Open slicer",                                  action: "open",      desc: "Opens the Send-to-Slicer dialog." },
    ],
  },
];

// Pre-flight tips block — surfaced above the lexicon table when the user
// opens the Voice Commands section. Each line is a short heuristic that
// dramatically improves command success rate; pulled from the actual LLM
// prompt and from common parser pitfalls we've debugged.
export const VOICE_TIPS = [
  {
    icon: "anchor",
    title: "Lead with the verb",
    body: "\"Make a bracket…\" works better than \"I need a bracket that…\". The parser reads top-down; the first action verb it finds anchors the intent.",
  },
  {
    icon: "ruler",
    title: "Units beat raw numbers",
    body: "\"6 inch deep\" routes more reliably than \"6 deep\". Mix imperial and metric freely — \"4 mm thick, 3 inch wide\" is fine.",
  },
  {
    icon: "shapes",
    title: "Name the template noun explicitly",
    body: "Templates (faceplate, bracket, drawer pull, tool holder) only trigger when their name appears in the request. Saying \"make a Pi 4 thing\" falls back to a generic plan — say \"Pi 4 faceplate\" or \"Pi 4 mounting tray\" instead.",
  },
  {
    icon: "selection",
    title: "Selection matters",
    body: "\"Move it up 10\" needs something selected. If nothing's selected the parser returns \"unknown\" rather than guessing. Pre-select with a click or say \"select all\" first.",
  },
  {
    icon: "preview",
    title: "Multi-step commands open Plan Preview",
    body: "Anything with two-or-more atomic actions (e.g. templates, or \"add 4 holes at the corners\") shows you the proposed steps before running. Click Run to commit, Cancel to back out.",
  },
  {
    icon: "mouse",
    title: "Per-edge fillet / chamfer is mouse-only (for now)",
    body: "Voice can apply a UNIFORM fillet to the whole item (\"round all edges 3 mm\"), but the Edge / Face / Vertex picker is in the Inspector panel — voice doesn't yet know about the bottom-right vs front-top edge IDs.",
  },
];

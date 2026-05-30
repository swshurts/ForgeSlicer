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

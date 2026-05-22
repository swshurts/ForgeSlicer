import React, { useState, useEffect, useMemo } from "react";
import {
  X, BookOpen, Rocket, Box, Plus, Move3D, Magnet, Combine, Mic, Globe,
  FileDown, Keyboard, Search, Library, Sliders, CircleHelp, Wrench, Sparkles, Scissors,
  UserCircle,
} from "lucide-react";

// ---------- Section content ----------
// Each section is a function returning JSX so we can keep the file readable
// and lazy-render only what's currently visible.

function Index({ onJump }) {
  const cards = [
    { id: "quickstart",   icon: Rocket,    title: "Quick Start",       desc: "3-step tour: add a primitive, carve a hole, export." },
    { id: "primitives",   icon: Box,       title: "Primitives",        desc: "Cube, sphere, cylinder, cone, torus, 2D shapes, composites." },
    { id: "modifiers",    icon: Plus,      title: "Positive & Negative", desc: "How parts add material vs. carve material out." },
    { id: "transforms",   icon: Move3D,    title: "Transforms",        desc: "Move, rotate, scale, drop-to-bed, mirror." },
    { id: "snapping",     icon: Magnet,    title: "Snapping & Grid",   desc: "Make parts click into place precisely." },
    { id: "edges",        icon: Wrench,    title: "Fillet & Chamfer",  desc: "Round or bevel the edges of cubes, cylinders, cones." },
    { id: "cut",          icon: Scissors,  title: "Cut & Split",       desc: "Slice a model with an adjustable plane (OrcaSlicer-style)." },
    { id: "booleans",     icon: Combine,   title: "Boolean Operations", desc: "Union, subtract, intersect to combine geometry." },
    { id: "io",           icon: FileDown,  title: "Import & Export",   desc: "STL / OBJ / 3MF / GCODE / .forge.json." },
    { id: "gallery",      icon: Globe,     title: "Gallery & Sharing", desc: "Publish to the public library, remix others' work." },
    { id: "components",   icon: Library,   title: "Component Library", desc: "Save reusable parts; recall with one click." },
    { id: "voice",        icon: Mic,       title: "Voice Commands",    desc: "Hands-free CAD. Lexicon + examples." },
    { id: "ai",           icon: Sparkles,  title: "AI Generate",       desc: "Text-to-3D or image-to-3D via Meshy. 13 free gens/month." },
    { id: "account",      icon: UserCircle,title: "Account & Sign-in", desc: "Three sign-in options, profile editor, per-field privacy." },
    { id: "shortcuts",    icon: Keyboard,  title: "Keyboard Shortcuts", desc: "Speed up the workflow." },
  ];
  return (
    <div data-testid="help-index">
      <h2 className="text-2xl font-bold text-white mb-2">ForgeSlicer User Manual</h2>
      <p className="text-slate-400 text-sm mb-6 leading-relaxed">
        Pick a topic below, or use the search bar on the left. Most workflows can be done by
        voice — see <button onClick={() => onJump("voice")} className="text-orange-400 hover:underline">Voice Commands</button> for the full lexicon.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {cards.map(({ id, icon: Icon, title, desc }) => (
          <button
            key={id}
            data-testid={`help-card-${id}`}
            onClick={() => onJump(id)}
            className="text-left p-3 rounded border border-slate-700 bg-slate-900/40 hover:border-orange-500/60 hover:bg-orange-500/5 transition-colors flex gap-3"
          >
            <Icon size={20} className="text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-white">{title}</div>
              <div className="text-[11px] text-slate-400 leading-snug mt-0.5">{desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function H({ children }) { return <h3 className="text-lg font-bold text-white mt-5 mb-2">{children}</h3>; }
function P({ children }) { return <p className="text-sm text-slate-300 leading-relaxed mb-3">{children}</p>; }
function Code({ children }) { return <code className="px-1.5 py-0.5 rounded bg-slate-800 text-orange-300 font-mono text-[12px]">{children}</code>; }
function Kbd({ children }) { return <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[11px]">{children}</kbd>; }
function Step({ n, children }) {
  return (
    <li className="flex gap-3 mb-2">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/20 border border-orange-500/60 text-orange-300 text-xs font-bold flex items-center justify-center">{n}</span>
      <div className="text-sm text-slate-300 leading-relaxed pt-0.5">{children}</div>
    </li>
  );
}

function QuickStart() {
  return (
    <div data-testid="help-section-quickstart">
      <H>Quick Start</H>
      <P>Build your first part in 60 seconds.</P>
      <ol className="mb-4">
        <Step n="1">In the left panel, click <Code>CUBE</Code> under <strong>Add Positive</strong>. A 20×20×20 mm cube appears on the build plate.</Step>
        <Step n="2">Click <Code>CYLINDER</Code> under <strong>Add Negative</strong>. Position it through the cube to carve a hole.</Step>
        <Step n="3">In the top toolbar, click <Code>Send to OrcaSlicer</Code> (or whatever desktop slicer you use) to download a 3MF, or use <Code>Export → STL</Code> for raw geometry.</Step>
      </ol>
      <P>That's the whole flow: <strong>add positive parts → subtract negative parts → export.</strong> Everything else (booleans, voice, fillet, gallery) is a power-up.</P>
      <H>The Workspace at a Glance</H>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>Left panel</strong> — primitive palettes (positive / negative / 2D / composite) and the outliner tree.</li>
        <li><strong>Center viewport</strong> — 3D scene with the build plate, grid, axes, and gizmo.</li>
        <li><strong>Right panel</strong> — Inspector (selected object), printer/filament profile, scene stats.</li>
        <li><strong>Top toolbar</strong> — file ops, transforms, booleans, snap, voice, share, send-to-slicer.</li>
      </ul>
    </div>
  );
}

function Primitives() {
  return (
    <div data-testid="help-section-primitives">
      <H>Primitives</H>
      <P>ForgeSlicer ships with the following parametric primitives. Each lives in the left palette — click once to add to the scene.</P>
      <table className="w-full text-sm mb-4">
        <thead className="text-left text-[11px] text-slate-400 uppercase tracking-wider border-b border-slate-700">
          <tr><th className="py-2">Primitive</th><th>Defaults</th><th>Notes</th></tr>
        </thead>
        <tbody className="text-slate-300">
          <tr className="border-b border-slate-800"><td className="py-2 font-mono">Cube</td><td>20×20×20 mm</td><td>Adjustable per-axis. Supports fillet/chamfer.</td></tr>
          <tr className="border-b border-slate-800"><td className="py-2 font-mono">Sphere</td><td>r=12 mm, 48 seg</td><td>Lower segments → faceted icoshpere look.</td></tr>
          <tr className="border-b border-slate-800"><td className="py-2 font-mono">Cylinder</td><td>r=10, h=24, 64 seg</td><td>Drop segments to 6 = hex, 4 = square. Edge fillet/chamfer.</td></tr>
          <tr className="border-b border-slate-800"><td className="py-2 font-mono">Cone</td><td>r=10, h=24</td><td>Base edge supports fillet/chamfer.</td></tr>
          <tr className="border-b border-slate-800"><td className="py-2 font-mono">Torus</td><td>r=14, tube=4</td><td>Donut shape; tube radius controls thickness.</td></tr>
          <tr className="border-b border-slate-800"><td className="py-2 font-mono">2D Shapes</td><td>1 mm wafer</td><td>Circle / Square / Triangle / N-sided polygon. Extrude in inspector.</td></tr>
          <tr><td className="py-2 font-mono">Slot</td><td>composite</td><td>Pre-grouped cube + 2 caps — great for racetrack screw holes.</td></tr>
        </tbody>
      </table>
      <P>Tip: every primitive's dimensions are live-editable from the right-hand Inspector. Type a new number and press Enter.</P>
    </div>
  );
}

function Modifiers() {
  return (
    <div data-testid="help-section-modifiers">
      <H>Positive vs. Negative</H>
      <P>Every object carries a <Code>modifier</Code> tag — <strong className="text-orange-300">positive</strong> (orange) parts ADD material; <strong className="text-cyan-300">negative</strong> (cyan outline) parts SUBTRACT material when the scene is sliced or exported.</P>
      <P>You don't have to manually run a boolean — at export/slice time ForgeSlicer evaluates the scene as: <Code>(union of all positives) − (union of all negatives)</Code>.</P>
      <H>Flipping a Part</H>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li>In the Outliner tree, the colored chip on each row toggles between positive and negative.</li>
        <li>In the Inspector, use the big <Code>POSITIVE / NEGATIVE</Code> toggle at the top.</li>
        <li>By voice: <em>"make this negative"</em> or <em>"flip modifier."</em></li>
      </ul>
    </div>
  );
}

function Transforms() {
  return (
    <div data-testid="help-section-transforms">
      <H>Transform Modes</H>
      <P>Three modes — Translate, Rotate, Scale — are selectable from the top toolbar (or by voice). Each one swaps the in-viewport gizmo.</P>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>Position popover</strong> — type exact mm values for X/Y/Z, or hit <Code>Center on bed</Code>.</li>
        <li><strong>Rotation popover</strong> — exact degrees per axis, plus quick 90° rotations.</li>
        <li><strong>Scale popover</strong> — by factor OR by target size in mm.</li>
        <li><strong>Drop to Bed</strong> — recomputes the rotated bbox and snaps the bottom to Y=0 (the build plate).</li>
        <li><strong>Duplicate</strong> — copies the selection; the popover also offers Mirror on X/Y/Z (uses bbox adjacencies so mirrored parts land flush, not overlapping).</li>
      </ul>
      <H>Bottom-Y readout</H>
      <P>The Inspector shows the world-space bottom of your part. Green ✓ means it's resting on the bed; orange means it's floating or below.</P>
    </div>
  );
}

function Snapping() {
  return (
    <div data-testid="help-section-snapping">
      <H>Snapping & Grid</H>
      <P>The top toolbar has a Magnet icon to toggle snap on/off, and a Grid icon to show/hide the build-plate grid.</P>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>Translate snap</strong> — defaults to 1 mm. Gizmo drags clip to whole millimeters.</li>
        <li><strong>Rotate snap</strong> — defaults to 15°. Hold the gizmo to step through 15° increments.</li>
        <li><strong>Scale snap</strong> — defaults to 0.1× factor.</li>
        <li>Set snap values in the Slicer/Settings popover.</li>
      </ul>
      <H>Measurement Tool</H>
      <P>Click the ruler in the toolbar, then click two points in the scene. ForgeSlicer draws a dimensioned line you can clear from the right panel's Scene section.</P>
    </div>
  );
}

function Edges() {
  return (
    <div data-testid="help-section-edges">
      <H>Edge Fillet &amp; Chamfer</H>
      <P>Cube, Cylinder and Cone primitives can have their edges rounded (fillet) or beveled (chamfer). Find the <Code>EDGE</Code> panel inside the Inspector when you select one.</P>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>Fillet ◜</strong> — smoothly rounded edges. Great for ergonomic enclosures, finger-friendly handles.</li>
        <li><strong>Chamfer ◢</strong> — single 45° bevel. Great for lead-in geometry on press-fits and printable countersinks.</li>
        <li><strong>Radius slider</strong> — auto-clamped to the primitive's shortest half-extent so you can't blow it up.</li>
        <li><strong>Quick presets</strong> — Off / 1 mm / 2 mm / 5 mm.</li>
      </ul>
      <H>Counter-bores in one step</H>
      <P>The EDGE panel also appears on <strong className="text-cyan-300">negative</strong> primitives. Subtracting a filleted negative cylinder produces a counter-bored hole; subtracting a chamfered one prints a recess perfectly sized for screw cup-points or heat-set inserts — no extra geometry needed.</P>
    </div>
  );
}

function CutTool() {
  return (
    <div data-testid="help-section-cut">
      <H>Cut &amp; Split</H>
      <P>The Cut tool slices a model with an adjustable plane — the same workflow as OrcaSlicer's Cut function. Use it to divide a tall model so each half fits separately on the build plate, or to remove an unwanted portion.</P>
      <H>Workflow</H>
      <ol className="mb-4">
        <Step n="1">Select the object you want to cut.</Step>
        <Step n="2">Click <Code>CUT</Code> in the top toolbar (next to Mirror). A yellow plane appears in the viewport with a gizmo, and the Cut HUD appears at the top of the workspace.</Step>
        <Step n="3">Switch the gizmo between <strong>Move</strong> and <strong>Rotate</strong> in the HUD to position the plane exactly. Drag the gizmo handles — translate snaps to 0.5 mm; rotate snaps to 5°.</Step>
        <Step n="4">Pick the result you want:
          <ul className="list-disc list-inside ml-4 mt-1 text-[12px] space-y-0.5">
            <li><strong>Keep Upper</strong> — discard everything below the plane.</li>
            <li><strong>Split (both)</strong> — produce TWO new objects, one for each side.</li>
            <li><strong>Keep Lower</strong> — discard everything above the plane.</li>
          </ul>
        </Step>
        <Step n="5">The cut piece(s) replace the original. They're regular imported meshes — carve, scale, slice, and export them as normal.</Step>
      </ol>
      <H>Tips</H>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li>"Upper" = the side the plane's local +Y axis points toward. With a horizontal plane, that's literally up; once you rotate the plane, "upper" follows the rotation.</li>
        <li>The cut is <strong>atomic in undo history</strong> — one <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> restores the original.</li>
        <li>For tall AI-generated meshes that won't fit your printer, drop the plane at your printer's Z-max and split — print each half, glue together.</li>
      </ul>
      <P className="text-amber-200 text-xs italic">If a cut produces empty geometry (the plane is entirely outside the model), the empty side is silently skipped and you'll just get the non-empty half.</P>
    </div>
  );
}


function Booleans() {
  return (
    <div data-testid="help-section-booleans">
      <H>Boolean Operations</H>
      <P>If you need explicit boolean output (e.g. to export the merged mesh), select two objects in the Outliner and click one of the toolbar boolean buttons:</P>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>Union (A ∪ B)</strong> — fuse both into one solid.</li>
        <li><strong>Subtract (A ∖ B)</strong> — carve B out of A.</li>
        <li><strong>Intersect (A ∩ B)</strong> — keep only the overlap.</li>
      </ul>
      <P>Booleans are atomic in undo history — one <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> rolls back the whole operation, not the intermediate steps.</P>
      <P className="text-amber-200 text-xs italic">Heads-up: if your inputs share a near-tangent face, the result may have a few "open edges" — every modern slicer auto-repairs on import, but slightly overlap or fully separate the parts for perfect manifold output.</P>
    </div>
  );
}

function ImportExport() {
  return (
    <div data-testid="help-section-io">
      <H>Import</H>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><Code>.stl</Code> — single mesh, auto-centered on the build plate.</li>
        <li><Code>.obj</Code> — same.</li>
        <li><Code>.3mf</Code> — multi-part import.</li>
        <li><Code>.forge.json</Code> — full editable project (restores every original primitive, modifier, group).</li>
      </ul>
      <H>Export</H>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><Code>.stl</Code> binary — the most universal format. Booleans are evaluated; modifiers baked.</li>
        <li><Code>.3mf</Code> — preserves multi-part assembly with color slots, ready for OrcaSlicer / Bambu Studio.</li>
        <li><Code>.gcode</Code> — preview-quality outer-shell slice (NOT production-ready; for fast review only).</li>
        <li><Code>.forge.json</Code> — editable project file; share it to let collaborators tweak the original geometry.</li>
      </ul>
      <H>Auto-save</H>
      <P>In Chromium browsers you can pick a local <Code>.forge.json</Code> file (Right panel → Auto-Save Project) and every edit will be written silently in place.</P>
    </div>
  );
}

function Gallery() {
  return (
    <div data-testid="help-section-gallery">
      <H>Public Gallery</H>
      <P>The Gallery is a community library of designs and reusable components. Anyone can browse without an account; sign in to publish.</P>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>Share Design</strong> in the toolbar publishes the current project with thumbnail, STL, editable project JSON, license, and material.</li>
        <li><strong>Remix</strong> on any gallery card loads the original editable project — every primitive, every negative, every group preserved.</li>
        <li><strong>Filter</strong> by category, material, license, or text search.</li>
        <li><strong>Private toggle</strong> in the Share dialog keeps a design visible only to you.</li>
      </ul>
      <H>Finding your private items — the "Mine" filter</H>
      <P>When you publish something with the Private toggle on, it's hidden from the public gallery (by design). To find it again, sign in and use the <Code>Public / Mine</Code> segmented control at the top of the Designs and Components tabs. Switching to <strong>Mine</strong> shows everything you've saved — public and private together. Private cards display a small lock badge so you can tell them apart at a glance.</P>
      <H>Licensing</H>
      <P>Pick a license when you publish: CC-BY (default), CC0, MIT, Apache 2.0, GPL/LGPL/AGPL, CC-BY-SA/NC/ND, or ForgeSlicer Standard Digital. Each gallery card shows a chip you can click to read the full text.</P>
    </div>
  );
}

function Components() {
  return (
    <div data-testid="help-section-components">
      <H>Component Library</H>
      <P>Components are reusable parts — screws, hinges, brackets, fasteners — that you save once and drop into any project.</P>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>Save</strong> — toolbar → <Code>Component</Code> button captures the current scene (or selection) with a name, category, tags, and license.</li>
        <li><strong>Browse</strong> — Gallery → Components tab. Verified ✓ badges mark community-vetted parts; clickable tag pills make searching fast.</li>
        <li><strong>Add to project</strong> — opens it back in your workspace as either a positive or negative assembly, dropped flush to the bed.</li>
        <li><strong>Public / Mine</strong> filter (signed-in only) — flip to <strong>Mine</strong> to see your saved components, including private ones. A small lock badge appears on private cards.</li>
      </ul>
      <H>Slot / Racetrack composite</H>
      <P>Click the Slot button under <strong>Composites</strong> in the left panel. You get a pre-grouped pill shape (cube + 2 caps) — perfect for rack-screw clearance slots.</P>
    </div>
  );
}

// ---------- Account & Sign-in (new in v1.1) ----------
function Account() {
  return (
    <div data-testid="help-section-account">
      <H>Three ways to sign in</H>
      <P>Browsing the gallery is anonymous. Designing in the workspace and saving items to your library both require a free account. From the <Code>/signin</Code> page you can pick any of three methods — they all create the same account, so you can mix and match across devices:</P>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-4">
        <li><strong>Email + password</strong> — fastest if you don't like third-party providers. Password must be at least 8 characters with at least one letter and one number.</li>
        <li><strong>Magic link</strong> — passwordless. We email a one-time sign-in link that's valid for 15 minutes and only usable once.</li>
        <li><strong>Continue with Google</strong> — uses Emergent-managed Google OAuth; we only see your name, email, and profile picture.</li>
      </ul>
      <P><strong>Tip:</strong> if you started with Google and later want a password (for offline access or family members on the same device), just hit <em>Create an account</em> on the sign-in page with the same email — the password attaches to your existing account.</P>

      <H>Forgot your password?</H>
      <P>Click <em>Forgot password?</em> on the sign-in page. We email a reset link valid for 60 minutes. Using a reset link signs out every other session for safety.</P>

      <H>Profile editor (optional fields)</H>
      <P>Open <Code>/profile</Code> and click <strong>Profile details → Edit</strong>. Each optional field has its own <span className="text-emerald-400 font-semibold">Public</span> / <span className="text-slate-300 font-semibold">Private</span> checkbox — you decide one-by-one what (if anything) gets shown to other users:</P>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>Avatar URL</strong> — link to a profile picture.</li>
        <li><strong>Preferred contact link</strong> — Mastodon, X, GitHub, personal site, Discord — whatever you prefer.</li>
        <li><strong>Location</strong> — City / State / Country, shown as one group with one share toggle.</li>
      </ul>
      <P>Display name is always shown publicly (it credits your designs). Email is never shown publicly. Everything else defaults to private — you have to explicitly tick a box to share it.</P>

      <H>Public author profile pages</H>
      <P>Click any author name <em>"by …"</em> on a gallery card to visit their public profile page at <Code>/u/&lt;userId&gt;</Code>. You'll see everything they've chosen to share (avatar, location, contact link), plus their full grid of public designs and components.</P>

      <H>Email delivery</H>
      <P>If you request a magic link or password reset and don't see the email, check your spam folder first. We use Resend for transactional email — if delivery is degraded (e.g. our key is being rotated), an amber banner will appear on the magic-link tab telling you to use Google or email + password instead.</P>
    </div>
  );
}

// ---------- Voice command lexicon ----------
const VOICE_LEXICON = [
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

function VoiceCommands({ onTry }) {
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(null);
  const handleTry = async (phrase) => {
    if (!onTry) return;
    setBusy(phrase);
    try { await onTry(phrase); } finally { setBusy(null); }
  };
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return VOICE_LEXICON;
    return VOICE_LEXICON
      .map((g) => ({ ...g, items: g.items.filter((i) => i.phrase.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q) || i.action.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [filter]);
  return (
    <div data-testid="help-section-voice">
      <H>Voice Commands — How it works</H>
      <P>Click the <Code>Voice</Code> button in the top toolbar (or press <Kbd>V</Kbd>). ForgeSlicer captures audio with your browser microphone, transcribes it through OpenAI Whisper, then parses your intent with GPT — so you can phrase commands naturally instead of memorizing rigid syntax.</P>
      <H>Hands-free flow</H>
      <ol className="mb-4">
        <Step n="1">Tap Voice once to start listening. Speak your command.</Step>
        <Step n="2">Pause for ~2 seconds. Your transcript appears on screen.</Step>
        <Step n="3">Say <strong className="text-orange-300">"Run"</strong> to execute, or just speak again to replace the transcript.</Step>
      </ol>
      <H>Lexicon</H>
      <P>Every example below is a real command that will execute — the LLM understands synonyms and natural phrasing, so feel free to deviate from these exact words.</P>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          data-testid="voice-lexicon-search"
          type="text"
          placeholder="Filter commands…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white pl-8 pr-3 focus:border-orange-500 outline-none"
        />
      </div>
      {filtered.map((group) => (
        <div key={group.category} className="mb-4" data-testid={`voice-group-${group.category.replace(/\W+/g, "-").toLowerCase()}`}>
          <div className="text-[11px] uppercase tracking-wider text-orange-300 font-semibold mb-1.5">{group.category}</div>
          <table className="w-full text-sm border border-slate-800 rounded overflow-hidden">
            <thead className="text-left text-[10px] text-slate-500 uppercase tracking-wider bg-slate-900/60">
              <tr><th className="px-2 py-1.5 w-1/3">Say…</th><th className="px-2 py-1.5">What happens</th>{onTry && <th className="px-2 py-1.5 w-16 text-right">Try</th>}</tr>
            </thead>
            <tbody>
              {group.items.map((it) => (
                <tr key={it.phrase} className="border-t border-slate-800">
                  <td className="px-2 py-1.5 font-mono text-orange-300 italic">"{it.phrase}"</td>
                  <td className="px-2 py-1.5 text-slate-300">{it.desc}</td>
                  {onTry && (
                    <td className="px-2 py-1.5 text-right">
                      <button
                        data-testid={`voice-try-${it.phrase.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                        onClick={() => handleTry(it.phrase)}
                        disabled={busy === it.phrase}
                        className="px-2 h-6 text-[10px] rounded border border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 disabled:opacity-50"
                        title={`Run "${it.phrase}" on your scene`}
                      >
                        {busy === it.phrase ? "…" : "Try ▶"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {filtered.length === 0 && (
        <div className="text-sm text-slate-500 italic">No commands match "{filter}".</div>
      )}
    </div>
  );
}

function AIGenerate() {
  return (
    <div data-testid="help-section-ai">
      <H>AI Generate (Beta)</H>
      <P>ForgeSlicer can turn text descriptions or reference images into 3D meshes using <strong>Meshy AI</strong>. The result lands on the build plate as a regular imported mesh — boolean carving, fillet, scale, slice, and export all work normally on top of it.</P>
      <H>Where to find it</H>
      <P>Left panel → bottom section labeled <Code>AI Generate</Code> → click <strong>"Generate from Text · Image"</strong>.</P>
      <H>Two flows</H>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li><strong>From Text</strong> — type a description (e.g. <em>"a small articulated dragon for FDM printing"</em>) and pick a style: <strong>realistic</strong> or <strong>sculpture</strong>. Need low-poly geometry? Most slicers can decimate on import — just bring the realistic mesh in and reduce face count there.</li>
        <li><strong>From Image</strong> — upload a JPG/PNG/WebP (up to 8 MB). Works best with a single subject on a plain background. Great for translating your own artwork or photography into a printable form.</li>
      </ul>
      <H>Monthly cap</H>
      <P>Free accounts get <strong>13 generations per calendar month</strong>; Contributor Lifetime users get double. The remaining count is shown in the dialog header. The cap resets on the 1st of each month.</P>
      <H>Tips for better results</H>
      <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside mb-3">
        <li>Mention scale and use-case (e.g. <em>"FDM printable"</em>, <em>"miniature for tabletop gaming"</em>).</li>
        <li>For image-to-3D, use a high-contrast photo with the subject filling most of the frame.</li>
        <li>Generation takes 30–90 seconds — the dialog stays open so you can keep modeling while you wait. A transient hiccup from Meshy won't lose your job; we automatically retry up to the 5-minute deadline.</li>
        <li>Once the mesh arrives, click <Code>Add to scene →</Code> to drop it; click <Code>Try another</Code> to regenerate without using a new credit if you're unhappy with the geometry.</li>
      </ul>
      <P className="text-amber-200 text-xs italic">Heads-up: AI meshes often have thin walls or non-manifold edges. After import, use the dimension inspector to scale up to printable size and consider a "make manifold" pass in your slicer.</P>
    </div>
  );
}

function Shortcuts() {
  const rows = [
    ["Ctrl+Z / Cmd+Z",    "Undo"],
    ["Ctrl+Shift+Z",      "Redo"],
    ["Ctrl+D",            "Duplicate selection"],
    ["Delete / Backspace", "Delete selection"],
    ["Esc",               "Clear selection / close popovers"],
    ["G",                 "Translate mode"],
    ["R",                 "Rotate mode"],
    ["S",                 "Scale mode"],
    ["V",                 "Voice command"],
    ["?",                 "Open this help manual"],
    ["F",                 "Frame selection (center camera)"],
    ["Right-click",       "Context menu (per object or empty space)"],
    ["Double-click",      "Rename in outliner"],
  ];
  return (
    <div data-testid="help-section-shortcuts">
      <H>Keyboard Shortcuts</H>
      <P>Almost every toolbar action has a hotkey. The most useful ones:</P>
      <table className="w-full text-sm border border-slate-800 rounded">
        <thead className="text-left text-[10px] text-slate-500 uppercase tracking-wider bg-slate-900/60">
          <tr><th className="px-3 py-1.5 w-1/3">Keys</th><th className="px-3 py-1.5">Action</th></tr>
        </thead>
        <tbody>
          {rows.map(([keys, action]) => (
            <tr key={keys} className="border-t border-slate-800">
              <td className="px-3 py-1.5 font-mono text-orange-300">{keys}</td>
              <td className="px-3 py-1.5 text-slate-300">{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SECTIONS = [
  { id: "index",      label: "Index",              icon: BookOpen,  Component: null },
  { id: "quickstart", label: "Quick Start",        icon: Rocket,    Component: QuickStart },
  { id: "primitives", label: "Primitives",         icon: Box,       Component: Primitives },
  { id: "modifiers",  label: "Positive & Negative", icon: Plus,     Component: Modifiers },
  { id: "transforms", label: "Transforms",         icon: Move3D,    Component: Transforms },
  { id: "snapping",   label: "Snapping & Grid",    icon: Magnet,    Component: Snapping },
  { id: "edges",      label: "Fillet & Chamfer",   icon: Wrench,    Component: Edges },
  { id: "cut",        label: "Cut & Split",        icon: Scissors,  Component: CutTool },
  { id: "booleans",   label: "Boolean Operations", icon: Combine,   Component: Booleans },
  { id: "io",         label: "Import & Export",    icon: FileDown,  Component: ImportExport },
  { id: "gallery",    label: "Gallery & Sharing",  icon: Globe,     Component: Gallery },
  { id: "components", label: "Component Library",  icon: Library,   Component: Components },
  { id: "voice",      label: "Voice Commands",     icon: Mic,       Component: VoiceCommands },
  { id: "ai",         label: "AI Generate",        icon: Sparkles,  Component: AIGenerate },
  { id: "account",    label: "Account & Sign-in",  icon: UserCircle, Component: Account },
  { id: "shortcuts",  label: "Keyboard Shortcuts", icon: Keyboard,  Component: Shortcuts },
];

export default function HelpDialog({ open, onClose, onTryVoice }) {
  const [active, setActive] = useState("index");
  const [search, setSearch] = useState("");

  // Reset to the index page each time the dialog reopens so users always
  // land at the top-level table of contents (less disorienting than
  // remembering the last sub-page across sessions).
  useEffect(() => { if (open) setActive("index"); }, [open]);

  // Allow Esc to close.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.id.includes(q));
  }, [search]);

  if (!open) return null;

  const ActiveComponent = SECTIONS.find((s) => s.id === active)?.Component;

  return (
    <div
      data-testid="help-dialog"
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[85vh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-12 border-b border-slate-800 flex items-center px-4 gap-3 bg-slate-950/50">
          <CircleHelp size={18} className="text-orange-400" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-white">ForgeSlicer Help &amp; User Manual</div>
            <div className="text-[10px] text-slate-500">Press <Kbd>Esc</Kbd> to close · <Kbd>?</Kbd> to reopen anywhere in the workspace</div>
          </div>
          <button
            data-testid="help-close-btn"
            onClick={onClose}
            className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <aside className="w-60 border-r border-slate-800 flex flex-col overflow-hidden bg-slate-950/30">
            <div className="p-2 border-b border-slate-800 relative">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                data-testid="help-nav-search"
                type="text"
                placeholder="Search topics…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white pl-7 pr-2 focus:border-orange-500 outline-none"
              />
            </div>
            <nav className="flex-1 overflow-y-auto p-1.5">
              {filteredSections.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  data-testid={`help-nav-${id}`}
                  onClick={() => setActive(id)}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-[12px] flex items-center gap-2 mb-0.5 transition-colors ${
                    active === id
                      ? "bg-orange-500/15 text-orange-300 border border-orange-500/50"
                      : "text-slate-300 hover:bg-slate-800 border border-transparent"
                  }`}
                >
                  <Icon size={13} className="flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
              {filteredSections.length === 0 && (
                <div className="text-[11px] text-slate-500 italic px-2 py-2">No topics match.</div>
              )}
            </nav>
            <div className="p-2 border-t border-slate-800 text-[10px] text-slate-500 leading-snug">
              ForgeSlicer is community-built — contributions to the manual welcome on the public gallery.
            </div>
          </aside>

          {/* Content */}
          <section className="flex-1 overflow-y-auto p-6" data-testid="help-content">
            {active === "index" ? (
              <Index onJump={setActive} />
            ) : active === "voice" ? (
              <VoiceCommands onTry={onTryVoice} />
            ) : ActiveComponent ? (
              <ActiveComponent />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

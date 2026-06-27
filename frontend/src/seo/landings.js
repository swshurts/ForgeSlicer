// seo/landings.js — content + metadata for the dedicated SEO routes.
//
// Each entry drives one route at /{slug}. The SEOLanding component
// renders them all from the same shape, so a new SEO surface lands
// by adding one entry here — no new component file, no router edit.
//
// Authorship rules (kept consistent across all eight pages):
//   - The headline restates the visitor's search intent in their
//     words, then immediately states ForgeSlicer's answer. Keeps the
//     dwell time high because the page above-the-fold confirms the
//     visitor is in the right place.
//   - Every page has a 4-card "what you actually get" block — short,
//     concrete bullets, no marketing fluff. The pattern teaches
//     visitors what makes ForgeSlicer distinct from the search term
//     they typed.
//   - Every page has a "How it works in 3 steps" ribbon so the
//     visitor immediately understands the workflow.
//   - Two CTAs at the bottom: one strong action ("Launch the
//     workspace"), one softer ("See community designs" / "Read
//     beginner lessons"). Avoids the dead-end of a single-CTA page.
//   - Title + description hit ~ 55-160 chars to stay inside Google's
//     snippet limits.

export const SEO_LANDINGS = {
    "tinkercad-alternative": {
        slug: "tinkercad-alternative",
        // ─── Above-the-fold ───────────────────────────────────────
        eyebrow: "TinkerCAD Alternative",
        eyebrowAccent: "text-cyan-300",
        eyebrowBg: "bg-cyan-500/10 border-cyan-500/30",
        headline: "Outgrew TinkerCAD?",
        headlineAccent: "Real CAD, still in your browser.",
        intro: "ForgeSlicer is the natural next step from TinkerCAD — same in-browser, no-install workflow, but with proper Booleans, voice-controlled editing, AI mesh generation, and one-click hand-off to OrcaSlicer, Bambu Studio or PrusaSlicer.",
        // ─── Distinct-feature cards ────────────────────────────────
        features: [
            {
                title: "Same friction-free start",
                desc: "Browser-based, no install, free for the core toolkit — TinkerCAD users feel at home from the first click.",
            },
            {
                title: "Proper Boolean operations",
                desc: "Union, subtract, intersect with parametric positives + negatives. Edit dimensions after the boolean is done; the part rebuilds automatically.",
            },
            {
                title: "Voice-controlled CAD",
                desc: "Say \u201Cadd a 5\u202Fmm keyring hole\u201D or \u201Cmake this box hollow with 2\u202Fmm walls\u201D \u2014 the geometry updates in seconds.",
            },
            {
                title: "AI mesh generation built in",
                desc: "Generate starter models from a plain-language prompt via Meshy.ai (third-party AI design tool integrated into the ForgeSlicer workflow). Refine the result with normal CAD tools.",
            },
        ],
        howSteps: [
            { title: "Open the workspace", desc: "Click Launch \u2014 no install, no sign-up required for the core tools." },
            { title: "Build with primitives + Booleans", desc: "Cubes, cylinders, spheres, text \u2014 union, subtract, intersect. Just like TinkerCAD, plus parametric editing." },
            { title: "Print", desc: "Slice in browser, on our OrcaSlicer engine, or export STL/3MF to your desktop slicer." },
        ],
        comparisonRows: [
            { feature: "Browser-based, no install", a: true, b: true },
            { feature: "Boolean operations", a: true, b: true },
            { feature: "Parametric edit-after-boolean", a: false, b: true },
            { feature: "Voice-controlled editing", a: false, b: true },
            { feature: "AI mesh generation (Meshy.ai)", a: false, b: true },
            { feature: "Built-in slicer + OrcaSlicer hand-off", a: false, b: true },
            { feature: "Free public community gallery", a: true, b: true },
        ],
        // ─── SEO meta ──────────────────────────────────────────────
        title: "TinkerCAD Alternative — Browser CAD for 3D Printing | ForgeSlicer",
        description: "Looking for a TinkerCAD alternative for 3D printing? ForgeSlicer runs in your browser with real Boolean operations, voice-controlled CAD, AI mesh generation, and one-click hand-off to OrcaSlicer, Bambu Studio and PrusaSlicer.",
        keywords: "TinkerCAD alternative, online CAD for 3D printing, browser CAD for 3D printing, beginner CAD for 3D printing, free TinkerCAD replacement, browser-based CAD",
    },

    "edit-stl-online": {
        slug: "edit-stl-online",
        eyebrow: "Edit STL Online",
        eyebrowAccent: "text-orange-300",
        eyebrowBg: "bg-orange-500/10 border-orange-500/30",
        headline: "Edit STL files online",
        headlineAccent: "in your browser, no install.",
        intro: "ForgeSlicer is a browser-based STL editor. Drop in any .stl, .obj or .3mf file, resize, cut holes, add text, fix orientation, and export back to STL or 3MF in seconds \u2014 no Blender, no Fusion 360 download.",
        features: [
            {
                title: "Drag, drop, edit",
                desc: "STL, OBJ and 3MF files land on the build plate ready to manipulate \u2014 nothing uploads to a server unless you choose to share it.",
            },
            {
                title: "Cut holes, add text, resize",
                desc: "Add primitives (cubes, cylinders, spheres, text) as Negatives and subtract \u2014 the standard way to drill, slot, or engrave any imported STL.",
            },
            {
                title: "Voice-driven STL edits",
                desc: "Hit the mic, say \u201Cadd a 5\u202Fmm hole through the middle\u201D, and watch ForgeSlicer modify the imported mesh in real time.",
            },
            {
                title: "Export clean STL or 3MF",
                desc: "Watertight mesh repair runs on export (pymeshfix). Multi-part 3MF preserves your positives, negatives and group hierarchy for the next slicer.",
            },
        ],
        howSteps: [
            { title: "Drag your STL in", desc: "Drop the file on the workspace; ForgeSlicer parses it locally in your tab." },
            { title: "Edit", desc: "Resize, rotate, add or subtract primitives, change orientation, add embossed text." },
            { title: "Export", desc: "Save STL for archival or 3MF for OrcaSlicer / Bambu Studio / PrusaSlicer." },
        ],
        title: "Edit STL Online — Free Browser STL Editor | ForgeSlicer",
        description: "Edit STL files online with ForgeSlicer's free browser STL editor. Drag in any STL, OBJ or 3MF, cut holes, add embossed text, resize, then export clean STL or 3MF for OrcaSlicer, Bambu Studio or PrusaSlicer.",
        keywords: "edit STL online, STL editor online, online STL editor, modify STL in browser, create STL files online, free STL editor, browser STL editor",
    },

    "ai-3d-design": {
        slug: "ai-3d-design",
        eyebrow: "AI 3D Design",
        eyebrowAccent: "text-fuchsia-300",
        eyebrowBg: "bg-fuchsia-500/10 border-fuchsia-500/30",
        headline: "AI 3D design generator",
        headlineAccent: "in a CAD tool that can actually print it.",
        intro: "Most AI 3D generators give you a mesh you can't really use. ForgeSlicer bundles Meshy.ai \u2014 an independent third-party AI design tool \u2014 with a real CAD workspace so the generated model lands on a build plate, ready to refine with primitives, Booleans, voice edits, and slicing.",
        features: [
            {
                title: "Prompt \u2192 printable mesh",
                desc: "Type \u201Ca simple phone stand\u201D or \u201Ca low-poly fox keychain\u201D and Meshy.ai returns a starter model in 30\u201390 seconds.",
            },
            {
                title: "Refine in CAD",
                desc: "Once the AI mesh lands on the plate, ForgeSlicer's own tools (primitives, Booleans, voice commands) take it the rest of the way \u2014 no leaving the tab.",
            },
            {
                title: "Voice-controlled CAD edits",
                desc: "\u201CAdd a 5\u202Fmm keyring hole.\u201D \u201CMake this hollow with 2\u202Fmm walls.\u201D \u201CScale to 80\u202Fmm tall.\u201D The non-AI edits all run on ForgeSlicer's engine \u2014 nothing leaves your tab for those.",
            },
            {
                title: "Slice and print",
                desc: "Built-in JS slicer, server-side OrcaSlicer engine, or one-click hand-off to OrcaSlicer / Bambu Studio / PrusaSlicer.",
            },
        ],
        howSteps: [
            { title: "Type a prompt", desc: "\u201CA simple phone stand\u201D \u2014 Meshy.ai (third-party AI integrated into ForgeSlicer) returns a printable starter mesh." },
            { title: "Refine in CAD", desc: "Resize, add holes, emboss text, set wall thickness with ForgeSlicer's own tools." },
            { title: "Slice and print", desc: "In browser, on our OrcaSlicer server, or exported to your desktop slicer." },
        ],
        title: "AI 3D Design Generator + CAD Workspace | ForgeSlicer",
        description: "ForgeSlicer pairs an AI 3D design generator (Meshy.ai \u2014 third-party AI integrated into the workflow) with real browser CAD: prompt your starter mesh, refine with Booleans and voice edits, then slice and print.",
        keywords: "AI 3D design generator, AI 3D model generator, text to 3D, image to 3D, Meshy.ai, prompt to STL, AI CAD for 3D printing",
    },

    "browser-cad": {
        slug: "browser-cad",
        eyebrow: "Browser CAD",
        eyebrowAccent: "text-emerald-300",
        eyebrowBg: "bg-emerald-500/10 border-emerald-500/30",
        headline: "Browser CAD for 3D printing",
        headlineAccent: "\u2014 install nothing, ship something.",
        intro: "ForgeSlicer is a free, full-featured CAD tool that runs entirely in your browser. Primitives, Booleans, parametric editing, AI mesh generation, voice commands and slicing \u2014 no download, no Fusion 360 license, no waiting for an installer.",
        features: [
            {
                title: "Zero install",
                desc: "Open the URL, start designing. Works on Mac, Windows, Linux, Chromebook. Your designs save locally; you can sign in to publish them.",
            },
            {
                title: "Full CAD toolkit",
                desc: "Primitives, parametric Booleans, edge fillets, 2D sketches, sweep extrusion, texture / glyph primitives, mesh import (STL/OBJ/3MF), Reverse-Engineer (RANSAC primitive fitting on imported scans).",
            },
            {
                title: "Voice-controlled",
                desc: "Speak edits as if you were briefing a colleague. \u201CAdd a 5\u202Fmm keyring hole.\u201D \u201CMake this hollow with 2\u202Fmm walls.\u201D Faster than menu hunting.",
            },
            {
                title: "Slice in browser too",
                desc: "Built-in JS slicer, server-side OrcaSlicer engine, or export to your desktop slicer. The entire design \u2192 G-code pipeline lives in your tab.",
            },
        ],
        howSteps: [
            { title: "Open the workspace", desc: "Click Launch. No download, no sign-up required for the core CAD tools." },
            { title: "Build", desc: "Drop primitives, draw 2D sketches, combine with Booleans, drag gizmos to position." },
            { title: "Print", desc: "Slice in-browser, on our OrcaSlicer engine, or hand off to your desktop slicer." },
        ],
        title: "Browser CAD for 3D Printing \u2014 No Install | ForgeSlicer",
        description: "Browser CAD for 3D printing \u2014 free, no install. ForgeSlicer runs entirely in your tab with primitives, Booleans, voice control, AI mesh generation and built-in slicing.",
        keywords: "browser CAD for 3D printing, online CAD for 3D printing, free browser CAD, no install CAD, web CAD, in-browser CAD",
    },

    "3d-printing-cad": {
        slug: "3d-printing-cad",
        eyebrow: "3D Printing CAD",
        eyebrowAccent: "text-amber-300",
        eyebrowBg: "bg-amber-500/10 border-amber-500/30",
        headline: "Beginner-friendly CAD",
        headlineAccent: "built specifically for 3D printing.",
        intro: "Most CAD tools were built for engineers designing cars. ForgeSlicer was built for makers designing the next thing they want to 3D-print. Primitives + Booleans + voice control + an 8-lesson learning path that gets first-timers from zero to first successful print.",
        features: [
            {
                title: "Built for FDM realities",
                desc: "Build-plate bounds, wall-thickness checks, manifold-mesh export. The workspace warns you about ≥45° overhangs and sub-1.6\u202Fmm walls before you slice.",
            },
            {
                title: "Beginner CAD for 3D printing",
                desc: "A Learn section with eight practical lessons (CAD basics, file types, wall thickness, tolerances, common mistakes) plus 12 beginner starter templates one click from a finished part.",
            },
            {
                title: "Voice + AI for non-CAD-natives",
                desc: "Type or speak what you want. AI generates starter meshes (Meshy.ai \u2014 third-party AI integrated into the workflow); voice handles edits.",
            },
            {
                title: "Slice, hand off, or both",
                desc: "Built-in JS slicer (instant preview), server-side OrcaSlicer engine, or export STL/3MF to your desktop slicer of choice.",
            },
        ],
        howSteps: [
            { title: "Pick a starter or build from scratch", desc: "12 ready-to-customise Beginner Starters (Keychain, Phone Stand, Cable Clip, Plant Marker, more)." },
            { title: "Refine", desc: "Resize, add holes, change text \u2014 either with gizmos, the numeric inputs, or voice." },
            { title: "Print", desc: "Slice in browser, on server, or export to OrcaSlicer / Bambu Studio / PrusaSlicer." },
        ],
        title: "3D Printing CAD for Beginners \u2014 Browser-Based | ForgeSlicer",
        description: "ForgeSlicer is beginner CAD for 3D printing \u2014 browser-based, no install, with primitives, Booleans, voice control, AI mesh generation, an 8-lesson learn section and 12 starter templates that get you to your first successful print.",
        keywords: "beginner CAD for 3D printing, 3D printing CAD, easy CAD for 3D printing, simple CAD for 3D printing, CAD for makers, beginner-friendly 3D modeling",
    },

    "orcaslicer-workflow": {
        slug: "orcaslicer-workflow",
        eyebrow: "OrcaSlicer Workflow",
        eyebrowAccent: "text-orange-300",
        eyebrowBg: "bg-orange-500/10 border-orange-500/30",
        headline: "Design once, slice with OrcaSlicer.",
        headlineAccent: "Or skip the export entirely.",
        intro: "ForgeSlicer pairs perfectly with OrcaSlicer. Build your part with primitives, Booleans and voice, then either export 3MF for OrcaSlicer (your positives and negatives carry through as separate parts) \u2014 or use ForgeSlicer's built-in server-side OrcaSlicer engine without ever leaving the tab.",
        features: [
            {
                title: "Server-side OrcaSlicer engine",
                desc: "ForgeSlicer ships a real OrcaSlicer CLI on the backend. Pick \u201CServer-side\u201D in the Engine selector and produce production-grade G-code with tree supports, AMS, ironing, calibrated retraction \u2014 no desktop install needed.",
            },
            {
                title: "Clean 3MF export",
                desc: "Hand off to desktop OrcaSlicer instead? The 3MF exporter preserves positives, negatives, group hierarchy, and orientation so OrcaSlicer composes the part correctly the moment you drag it onto the plate.",
            },
            {
                title: "One-click deep-link",
                desc: "ForgeSlicer supports `orcaslicer://` deep-links \u2014 the \u201COpen in OrcaSlicer\u201D button hands the file straight to your desktop install with no save-then-drag-and-drop dance.",
            },
            {
                title: "Voice CAD + OrcaSlicer presets",
                desc: "Build a part with voice commands (\u201Cadd a 5\u202Fmm keyring hole\u201D), then slice with OrcaSlicer's full feature set \u2014 your slicer profile, your printer, your filament.",
            },
        ],
        howSteps: [
            { title: "Build with ForgeSlicer", desc: "Primitives + Booleans + voice. Or drop an existing STL and edit." },
            { title: "Slice", desc: "Either: (a) pick \u201CServer-side OrcaSlicer\u201D in the Engine selector and slice without leaving the tab, or (b) export 3MF and open in desktop OrcaSlicer." },
            { title: "Print", desc: "Send G-code to your printer via SD, USB, or OrcaSlicer's network handoff." },
        ],
        title: "OrcaSlicer Workflow \u2014 Browser CAD + OrcaSlicer | ForgeSlicer",
        description: "Design parts in the browser with ForgeSlicer and slice with OrcaSlicer \u2014 either via 3MF hand-off (with positives and negatives preserved) or directly with ForgeSlicer's built-in server-side OrcaSlicer engine.",
        keywords: "OrcaSlicer workflow, browser CAD for OrcaSlicer, ForgeSlicer OrcaSlicer integration, OrcaSlicer 3MF, design then slice OrcaSlicer",
    },

    "bambu-studio-workflow": {
        slug: "bambu-studio-workflow",
        eyebrow: "Bambu Studio Workflow",
        eyebrowAccent: "text-green-300",
        eyebrowBg: "bg-green-500/10 border-green-500/30",
        headline: "Design for Bambu printers,",
        headlineAccent: "in the browser.",
        intro: "If you own a Bambu Lab printer, ForgeSlicer is the missing browser-CAD half of your workflow. Build with primitives + Booleans, then export 3MF for Bambu Studio \u2014 the AMS-friendly format that preserves multi-part hierarchy for Bambu's auto-arrange and per-part settings.",
        features: [
            {
                title: "3MF that Bambu Studio loves",
                desc: "ForgeSlicer's 3MF export preserves positives, negatives, group hierarchy and orientation \u2014 Bambu Studio's drag-and-drop import recognises everything immediately.",
            },
            {
                title: "Per-part colour-ready",
                desc: "Use ForgeSlicer's group hierarchy to organise multi-colour designs. In Bambu Studio, assign AMS slots per part \u2014 no need to split meshes manually.",
            },
            {
                title: "Built for Bambu bed sizes",
                desc: "Pre-loaded printer profiles for the A1 (180\u202F\u00D7\u202F180), A1 Mini, P1S, X1 Carbon. The bed-fit checker tells you immediately whether the part survives.",
            },
            {
                title: "Free CAD, no Bambu account needed",
                desc: "ForgeSlicer is a separate, independent tool. Use it for free; you don't need a Bambu account or to share data with Bambu to design parts.",
            },
        ],
        howSteps: [
            { title: "Pick your Bambu printer", desc: "Workspace \u2192 Printer profile \u2192 A1 / A1 Mini / P1S / X1 Carbon. Bed-fit auto-checked." },
            { title: "Build", desc: "Primitives + Booleans + voice. Group parts for AMS colour assignment later." },
            { title: "Hand off", desc: "Export 3MF, drag onto Bambu Studio's plate, set AMS slots, slice and print." },
        ],
        title: "Bambu Studio Workflow \u2014 Browser CAD for Bambu Lab | ForgeSlicer",
        description: "ForgeSlicer is the missing browser-CAD half of your Bambu Lab workflow. Design with primitives + Booleans + voice, then export AMS-ready 3MF for Bambu Studio \u2014 A1, A1 Mini, P1S, X1 Carbon profiles included.",
        keywords: "Bambu Studio workflow, browser CAD for Bambu Lab, Bambu Studio 3MF, ForgeSlicer Bambu integration, Bambu A1 CAD, design for Bambu printers",
    },

    "prusaslicer-workflow": {
        slug: "prusaslicer-workflow",
        eyebrow: "PrusaSlicer Workflow",
        eyebrowAccent: "text-amber-300",
        eyebrowBg: "bg-amber-500/10 border-amber-500/30",
        headline: "Browser CAD,",
        headlineAccent: "then PrusaSlicer.",
        intro: "PrusaSlicer treats imported 3MF parts as first-class \u201Cmodifier\u201D meshes \u2014 ForgeSlicer's exporter targets exactly that format. Build with primitives + Booleans, export 3MF, and PrusaSlicer's per-part settings dialog already understands your positives and negatives.",
        features: [
            {
                title: "Negatives become modifier-cuts",
                desc: "ForgeSlicer's 3MF export tags each Negative as a Cut modifier. PrusaSlicer's import already knows what to do \u2014 no manual mesh-by-mesh classification.",
            },
            {
                title: "Per-part settings preserved",
                desc: "Group structure carries across, so PrusaSlicer's per-object settings dialog lets you tune supports, infill, or layer height per part without re-grouping.",
            },
            {
                title: "Voice + AI for the CAD half",
                desc: "ForgeSlicer's voice editing + AI mesh generation (via Meshy.ai \u2014 third-party AI integrated into the workflow) gives PrusaSlicer users a modern modelling layer to feed their slicer.",
            },
            {
                title: "Original Prusa printer profiles",
                desc: "Pre-loaded profiles for the MK4S, MINI+, XL, CORE One \u2014 the bed-fit checker matches PrusaSlicer's plate dimensions so what fits in CAD fits in slicing.",
            },
        ],
        howSteps: [
            { title: "Pick your Prusa", desc: "Workspace \u2192 Printer profile \u2192 MK4S / MINI+ / XL / CORE One." },
            { title: "Build", desc: "Primitives + Booleans + voice. Negatives become PrusaSlicer modifier-cuts on export." },
            { title: "Hand off", desc: "Export 3MF, drag onto PrusaSlicer, fine-tune per-part settings, slice and print." },
        ],
        title: "PrusaSlicer Workflow \u2014 Browser CAD for Original Prusa | ForgeSlicer",
        description: "ForgeSlicer's 3MF export hands off cleanly to PrusaSlicer \u2014 Negatives become modifier-cuts, group hierarchy preserved. Browser CAD with voice editing + AI for Original Prusa MK4S, MINI+, XL and CORE One.",
        keywords: "PrusaSlicer workflow, browser CAD for PrusaSlicer, ForgeSlicer PrusaSlicer integration, PrusaSlicer 3MF, Original Prusa CAD, design for Prusa MK4S",
    },
};

export const SEO_LANDING_SLUGS = Object.keys(SEO_LANDINGS);

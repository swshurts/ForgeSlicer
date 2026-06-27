// lib/trustContent.js — single source of truth for the Trust hub
// + dedicated /privacy, /changelog, /roadmap, /browser-support pages.
//
// Why one data file:
//   The Trust pages share data: e.g. the hub's "Browser support"
//   teaser renders a 3-row summary of the same matrix that
//   /browser-support shows in full. Driving them off one constant
//   means a fact (Chrome version, file limit) changes in one place.
//
// Tone:
//   Plain English, concrete numbers, no legalese. The privacy section
//   in particular is written so a maker — not a lawyer — can read it
//   in 90 seconds and feel they understood it correctly.

// ─── Roadmap (P0/P1/P2 — public-facing subset of memory/ROADMAP.md) ─
export const ROADMAP_ITEMS = [
    {
        priority: "P0",
        title: "RANSAC Replace-with-Primitives",
        status: "In progress",
        body: "Reverse-engineering imported scans turns detected planes/cylinders/spheres into editable parametric Three.js primitives. Sensitivity slider + Replace button in the Inspector. Backend (Phases 1–3) shipped; frontend wiring follows.",
    },
    {
        priority: "P1",
        title: "Flexible triangle primitive",
        status: "Planned",
        body: "Triangle primitive currently only emits equilateral triangles. Adding base/height/angle inputs and a right-triangle preset.",
    },
    {
        priority: "P2",
        title: "Curved-surface text projection",
        status: "Planned",
        body: "Flat-face text shipped in iter-105.33. Curved projection (text wrapping onto cylinders, spheres, wedges) is the planned follow-up — face picking + per-glyph raycast.",
    },
    {
        priority: "P2",
        title: "Yjs CRDT live collaboration",
        status: "Backlog",
        body: "Multiple makers editing the same scene in real time — Yjs is the foundation, the workspace store needs to be CRDT-compatible.",
    },
    {
        priority: "P2",
        title: "Trending this week (Gallery)",
        status: "Backlog",
        body: "Top public designs from the last 7 days as a horizontal strip on the Gallery page, complementing Featured Creators.",
    },
    {
        priority: "P2",
        title: "Admin UI for featured creators",
        status: "Backlog",
        body: "Today, marking a creator's flagship design as featured is API-only. Build the admin dashboard control.",
    },
];

// ─── Changelog (chronological, top-down — newest first) ────────────
// Each entry stays under ~ 100 words so the page scans fast. Pull
// from CHANGELOG.md as new releases ship.
export const CHANGELOG_ENTRIES = [
    {
        date: "2026-06-27",
        version: "1.22 · Learn + SEO + Trust",
        highlights: [
            "Eight-lesson Learn section (CAD basics → exporting to slicers).",
            "Eight dedicated SEO landing pages (/tinkercad-alternative, /edit-stl-online, /ai-3d-design, /browser-cad, /3d-printing-cad, /orcaslicer-workflow, /bambu-studio-workflow, /prusaslicer-workflow).",
            "Trust hub + Privacy / Changelog / Roadmap / Browser-support routes.",
        ],
    },
    {
        date: "2026-06-27",
        version: "1.21 · Meshy.ai attribution",
        highlights: [
            "Five surfaces now clearly attribute Meshy.ai as an independent third-party AI design tool integrated into the ForgeSlicer workflow.",
            "Example prompts inline on the homepage: 'create a simple phone stand', 'add a 5 mm keyring hole', 'make this box hollow with 2 mm walls'.",
        ],
    },
    {
        date: "2026-06-27",
        version: "1.20 · Gallery community upgrade",
        highlights: [
            "Shared taxonomy with 10 categories (Household, Tools, Organizers, Replacement Parts, Toys, Education, Cosplay, Mechanical, Decorative, Misc).",
            "Featured Creators strip (hybrid editorial + algorithmic ranking by remix count).",
            "Gallery cards display category + tag chips; backfill heuristic auto-tags legacy items.",
            "Rename Remix → Customize in ForgeSlicer everywhere.",
            "Landing community strip + 4-verb explainer (Browse · Customize · Publish · Keep private).",
        ],
    },
    {
        date: "2026-06-27",
        version: "1.19 · Text-on-surface primitive",
        highlights: [
            "Extruded `text` primitive added — positive embosses, negative engraves (via standard CSG subtract).",
            "Inspector controls: string, font (3 bundled typefaces), size, depth, alignment, bevel toggle.",
            "Keychain / Name Tag / Plant Marker starters now emit real text steps.",
        ],
    },
    {
        date: "2026-06-27",
        version: "1.18 · Beginner Starters + From Design to Print",
        highlights: [
            "12 beginner-friendly starter templates on the homepage (Keychain, Phone Stand, Cable Clip, etc.) — one click drops a customisable real design into the workspace.",
            "Honest 'From design to print' section clarifying the three slicing paths (in-browser / server-side OrcaSlicer / desktop export).",
        ],
    },
];

// ─── Browser support matrix ────────────────────────────────────────
export const BROWSER_SUPPORT = [
    { name: "Google Chrome",   minVersion: "110+", status: "fully-supported", note: "Recommended. Best WebGL 2 performance, voice + AI dialogs verified." },
    { name: "Microsoft Edge",  minVersion: "110+", status: "fully-supported", note: "Same engine as Chrome — identical experience." },
    { name: "Firefox",         minVersion: "115+", status: "fully-supported", note: "WebGL 2 + WebAssembly + Web Speech API all present. Voice commands work." },
    { name: "Safari (macOS)",  minVersion: "16+",  status: "fully-supported", note: "Voice commands require macOS 13+; Safari 17 recommended." },
    { name: "Safari (iOS)",    minVersion: "16+",  status: "view-only",       note: "Read & rotate a model; complex editing requires desktop." },
    { name: "Mobile Chrome",   minVersion: "110+", status: "view-only",       note: "Limited canvas — best for browsing the Gallery, not creating." },
    { name: "Internet Explorer", minVersion: "—",  status: "not-supported",   note: "End-of-life. Use Edge instead." },
];

export const BROWSER_REQUIREMENTS = [
    { label: "WebGL 2", req: "Required — 3D viewport." },
    { label: "WebAssembly", req: "Required — Manifold CSG engine + STL parsing." },
    { label: "Web Speech API", req: "Optional — voice commands degrade gracefully." },
    { label: "WebRTC", req: "Optional — used by the OpenAI Realtime voice mode." },
    { label: "IndexedDB / localStorage", req: "Required — saves project + preferences in your browser." },
];

// ─── File size / import limits ─────────────────────────────────────
export const FILE_LIMITS = [
    { kind: "STL import", limit: "100 MB", note: "≈ 2 million triangles. Larger files take longer to parse but still work." },
    { kind: "OBJ import",  limit: "50 MB",  note: "Vertex colours and UV coords are ignored on import; geometry only." },
    { kind: "3MF import",  limit: "80 MB",  note: "Multi-part hierarchy + per-part settings carry across." },
    { kind: "SVG import",  limit: "2 MB",   note: "Extruded into a polygon primitive." },
    { kind: "Image (image-to-3D)", limit: "8 MB", note: "JPG / PNG / WebP. Used by Meshy.ai (third-party AI integrated into the workflow)." },
    { kind: "Voice clip (Whisper)", limit: "30 seconds", note: "Longer clips are truncated. Most voice edits fit in 2–5 seconds." },
    { kind: "Texture / lithophane image", limit: "16 MB", note: "Resized to 2048 px on the longest edge before sampling." },
    { kind: "Gallery thumbnail upload", limit: "1 MB", note: "Auto-generated from the workspace if you don't upload one." },
];

// ─── Known limitations (honest, not marketing) ─────────────────────
export const KNOWN_LIMITATIONS = [
    {
        title: "Curved-surface text projection",
        body: "Text glyphs sit on a flat plane today — wrapping a label onto a cylinder rim or sphere needs face-picking + per-glyph raycast. Planned, not shipped.",
    },
    {
        title: "Maximum 200 primitives per scene",
        body: "Above ~200 positives + negatives the CSG engine starts to slow. Group complex sub-assemblies into a single grouped primitive to stay under the cap.",
    },
    {
        title: "Mobile editing",
        body: "Phones + tablets can VIEW any design, but creating one needs a desktop browser. Touch-first gizmos are on the roadmap.",
    },
    {
        title: "Meshy.ai monthly cap",
        body: "AI generation is gated to 13 free generations per calendar month (double for Contributor Lifetime). Meshy.ai is a third-party service — its uptime sits outside our control; we retry transient errors for up to 5 minutes.",
    },
    {
        title: "Multi-user real-time collaboration",
        body: "Designs are single-user today. Yjs-based CRDT collaboration is on the P2 backlog.",
    },
    {
        title: "Server-side OrcaSlicer queue",
        body: "Heavy server-side slices share an OrcaSlicer worker pool. During peak hours you may wait 5–30 seconds in queue. Local-browser slicing is always immediate.",
    },
];

// ─── Privacy — short, honest, plain English ────────────────────────
export const PRIVACY_FACTS = [
    {
        title: "Private by default",
        body: "Every design starts private. Your work is saved locally in your browser (IndexedDB / localStorage). When you sign in, your projects sync to your account but remain private to you unless you explicitly publish them.",
    },
    {
        title: "Publishing is an explicit click",
        body: "A design becomes public only when you tick the 'Publish' option in the Share dialog and submit. There is no auto-publish, no background sharing, and no opt-out switch — the default is and always will be private.",
    },
    {
        title: "You own your exports",
        body: "Anything you export — STL, 3MF, OBJ, PNG, G-code — is yours. You hold the copyright. ForgeSlicer doesn't claim any rights to your exports, and we don't add invisible identifiers or watermarks.",
    },
    {
        title: "Uploaded files are not made public",
        body: "Files you drag into the workspace (STL, OBJ, 3MF, SVG, images) are processed locally in your browser tab when possible. When server-side work is unavoidable (AI generation via Meshy.ai, server-side slicing), the file travels privately to that service for the operation only — never to the public Gallery.",
    },
    {
        title: "Voice + AI: third-party processing",
        body: "Voice transcription (OpenAI Whisper) and AI mesh generation (Meshy.ai) involve sending your audio/prompt to those providers. We never make their inputs or outputs public on your behalf.",
    },
    {
        title: "Account data",
        body: "If you sign in (Google Sign-In via Emergent-managed auth), we store your name + email + Google subject id. We use them to attribute your published designs and to email you about your account — nothing more. No marketing emails without opt-in.",
    },
    {
        title: "Analytics",
        body: "PostHog session replay records your interactions for product analytics. Cross-origin iframes (the workspace canvas) are recorded for replay quality. You can opt out by sending a 'do not track' header or by emailing us.",
    },
    {
        title: "Data deletion",
        body: "Email support@forgeslicer.com with the email you signed up with. We delete your account, your private designs, and your published designs within 30 days.",
    },
];

// ─── Design ownership (separated from privacy for clarity) ─────────
export const DESIGN_OWNERSHIP = [
    {
        title: "You own what you export",
        body: "STL, 3MF, OBJ, PNG, G-code from the Export dialog are yours. ForgeSlicer makes no claim on them.",
    },
    {
        title: "Published gallery designs use a license you choose",
        body: "When you publish to the public Gallery, you pick the license that applies to the published version (CC-BY-4.0 default; CC0, GPL, all-rights-reserved also available). The license governs how OTHER users may remix or redistribute the published version. Your private original is unaffected.",
    },
    {
        title: "Remixes carry attribution",
        body: "When someone clicks 'Customize in ForgeSlicer' on a public design, the resulting remix records its parent — the original author stays credited. You can disable remixing on your published designs in the Share dialog.",
    },
    {
        title: "Pre-existing IP",
        body: "ForgeSlicer is a tool; what you design with it is your responsibility. Don't publish designs that infringe someone else's copyright, trademark, or patents.",
    },
];

// ─── Support / contact ─────────────────────────────────────────────
export const SUPPORT_CONTACT = {
    primaryEmail: "support@forgeslicer.com",
    responseTimeSla: "We aim to reply to support email within 2 working days.",
};

// learn/lessons.js — beginner-friendly Learn section content.
//
// Why a single data file vs. one JSX file per lesson:
//   - Lessons are short (≈ 300-500 words each) — splitting each into
//     its own component is mostly boilerplate.
//   - Lessons share the same render shape: title, 3-4 numbered
//     sections, an "if you remember nothing else" recap, and a small
//     CTA strip. A data-driven render means a writer can ship a new
//     lesson by adding one entry — no JSX edits, no router changes.
//   - Each entry stores plain strings + arrays; the Learn component
//     turns them into headings + paragraphs + bullet lists. Markup
//     stays in one place so the styling is consistent across lessons.
//
// Tone guideline (every lesson):
//   - Speak to a first-time printer. Avoid "as you know" and any
//     phrasing that assumes CAD background.
//   - Use concrete numbers, not adjectives ("≥ 1.6 mm walls" beats
//     "thick enough walls").
//   - Every lesson ends with a one-line "Try it now" pointing into
//     the workspace, the gallery, or a beginner starter — so the
//     reader's next step is always an action.
//
// Ordering (LESSONS array): teach what's needed to ship a first
// print, in the order you actually need it. CAD basics first; then
// the file ecosystem; then geometry skills; then the printability
// constraints; then the slicer hand-off; common mistakes is the
// "before you click Save" check at the end.

export const LESSONS = [
    {
        slug: "cad-basics",
        title: "CAD basics in 4 minutes",
        summary:
            "What CAD really is, why ForgeSlicer is a gentle starting point, and the three things you'll do over and over.",
        icon: "Box",
        accent: "from-orange-500/25 to-amber-500/10",
        accentColor: "text-orange-300",
        minutes: 4,
        sections: [
            {
                heading: "What CAD actually is",
                body: [
                    "CAD stands for Computer-Aided Design. In plain English: software that lets you describe a physical object as a set of shapes the computer can measure, copy, and turn into a 3D model.",
                    "The 3D models you see on Thingiverse or Printables are CAD files — usually saved as STL. You don't need a degree in mechanical engineering to make one. You need three habits: build with simple shapes, position them in mm, and combine them with boolean operations.",
                ],
            },
            {
                heading: "The three habits",
                body: [
                    "**1. Build with simple shapes.** Almost every 3D-printed object starts as cubes, cylinders, and spheres. A phone stand is two boxes. A keychain is a disc with a hole. A cable clip is a block with a slot. ForgeSlicer's left panel has these primitives ready to drop in.",
                    "**2. Position in millimetres.** All sizes are mm. A phone is about 75 mm wide. A standard keyring is 5 mm thick. The build plate of a Bambu A1 mini is 180×180 mm. Get used to thinking in mm and your designs come out right-sized first try.",
                    "**3. Combine with booleans.** Union (combine two shapes into one), subtract (cut one shape out of another), and intersect (keep only the overlap). Three operations cover ≈ 90% of what you'll ever do.",
                ],
            },
            {
                heading: "Why ForgeSlicer specifically",
                body: [
                    "Big CAD tools (Fusion 360, SolidWorks) are designed for engineers building cars. They have hundreds of features you don't need on day one. ForgeSlicer keeps the core 5% — primitives, booleans, transforms, and slicer hand-off — and lets you talk to it (voice commands work for almost every operation).",
                ],
            },
        ],
        recap: "CAD = describe an object with simple shapes the computer can measure. Primitives + position + booleans = 90% of what you need.",
        cta: { label: "Open the workspace and drop a cube", href: "/workspace" },
    },

    {
        slug: "file-types",
        title: "STL, 3MF, OBJ, G-code — what each is for",
        summary:
            "Four file formats you'll see constantly. Here's exactly when to use which, no jargon.",
        icon: "FileText",
        accent: "from-cyan-500/25 to-blue-500/10",
        accentColor: "text-cyan-300",
        minutes: 5,
        sections: [
            {
                heading: "STL — the lingua franca",
                body: [
                    "**.stl** stores a mesh — a 3D shape made of triangles. No colours, no print settings, no part hierarchy. Just \"this is the surface of this object\".",
                    "Use STL when: downloading from Thingiverse, sharing with anyone who has a different slicer, or saving a design for archival. It's understood by every 3D-printing tool ever made.",
                    "Pitfall: large/curvy models become enormous STL files. A high-detail dragon can be 50 MB. ForgeSlicer's exporter triangulates curves smartly to keep file sizes sensible.",
                ],
            },
            {
                heading: "3MF — the modern upgrade",
                body: [
                    "**.3mf** is what STL should have been. Same triangle mesh inside, but also stores: separate parts (positives + negatives), colours / materials, print orientation, build-plate position, and units (always mm — no guessing).",
                    "Use 3MF when: handing off to OrcaSlicer / Bambu Studio / PrusaSlicer. Your part hierarchy survives so the slicer treats positives and negatives correctly. Multi-colour designs need 3MF.",
                ],
            },
            {
                heading: "OBJ — the import format",
                body: [
                    "**.obj** is similar to STL but with optional vertex colours and UV coordinates. It's common in 3D-art tools (Blender, ZBrush) but rare for 3D-printing-first workflows.",
                    "Use OBJ when: importing a model from Blender or a sculpting app. ForgeSlicer imports it the same as STL — just the geometry, ignoring textures.",
                ],
            },
            {
                heading: "G-code — instructions, not geometry",
                body: [
                    "**.gcode** is the output of a slicer. It's not a 3D model — it's a list of toolpath instructions for your printer (\"move to X120 Y80, extrude 0.4 mm of filament, ...\"). One G-code file = one specific printer, one specific filament, one specific orientation.",
                    "You never export G-code from CAD directly. The flow is always **CAD (STL/3MF) → slicer → G-code → printer**.",
                ],
            },
        ],
        recap: "Designing → save as STL or 3MF (prefer 3MF). Slicing → the slicer makes G-code. Don't share G-code with strangers — it only works for one printer.",
        cta: { label: "Read about exporting to your slicer", href: "/learn/exporting-to-slicers" },
    },

    {
        slug: "boolean-operations",
        title: "Boolean operations — cut, combine, keep",
        summary:
            "Union, subtract, intersect. The three commands that turn LEGO bricks into actual designs.",
        icon: "Combine",
        accent: "from-emerald-500/25 to-green-500/10",
        accentColor: "text-emerald-300",
        minutes: 4,
        sections: [
            {
                heading: "Union — combine two shapes",
                body: [
                    "Drop two cubes that overlap and hit Union. The result is a single shape with their footprint merged. Used for: building larger forms from primitives, fusing a handle onto a body, adding embossed text to a plate.",
                    "Tip — Union is the default behaviour in ForgeSlicer. Two positive shapes that touch are automatically unioned when you slice or export.",
                ],
            },
            {
                heading: "Subtract — cut a hole",
                body: [
                    "Place a cylinder inside a cube and mark the cylinder as **Negative**. When ForgeSlicer composes the scene, it subtracts the cylinder, leaving a hole through the cube.",
                    "This is the single most useful operation in printable-part design. Screw holes, ventilation slots, cable channels, engraved text — all subtracts. Every \"how do I make a hole\" tutorial ends here.",
                ],
            },
            {
                heading: "Intersect — keep only the overlap",
                body: [
                    "Less common but useful: keep only the region where two shapes overlap. Used for: clipping a tall object to a curved surface, isolating the \"diamond\" pattern between two crossed cylinders, building lens shapes.",
                ],
            },
            {
                heading: "Why positives + negatives instead of \"apply now\"",
                body: [
                    "Most CAD tools make you commit each boolean immediately. ForgeSlicer keeps the parts as positives and negatives in a scene tree so you can edit dimensions after the fact — make the cylinder hole 0.5 mm bigger and the whole part rebuilds. No undo gymnastics.",
                ],
            },
        ],
        recap: "Union = combine. Subtract = cut (mark as Negative). Intersect = keep overlap. Edit a positive or negative anytime; the result rebuilds automatically.",
        cta: { label: "Try the Cable Clip starter — it's a single subtract", href: "/" },
    },

    {
        slug: "designing-printable-parts",
        title: "Designing for FDM — orientation, overhangs, supports",
        summary:
            "The physics of FDM printing in 4 minutes. Knowing this lets you skip 80% of failed first prints.",
        icon: "Layers",
        accent: "from-amber-500/25 to-yellow-500/10",
        accentColor: "text-amber-300",
        minutes: 6,
        sections: [
            {
                heading: "How FDM actually works",
                body: [
                    "An FDM printer lays plastic in layers from the bottom up. Each layer is typically 0.2 mm tall — about the thickness of a sheet of paper. Every layer needs the previous layer to sit on, or it falls.",
                    "Your design choices ripple from this single constraint: orientation, overhangs, and supports are all answers to \"how do I make sure every layer has something to land on?\"",
                ],
            },
            {
                heading: "Orientation — print it flat side down",
                body: [
                    "Whatever face is touching the build plate prints perfectly flat. Use this. A phone stand prints with its base on the plate; a name tag prints lying down, not standing up. The biggest, flattest face goes on the plate.",
                    "Rule of thumb: rotate parts in the slicer (not in the CAD tool) — your CAD origin stays sensible and only the slice rotation changes.",
                ],
            },
            {
                heading: "Overhangs — under 45° is free",
                body: [
                    "An overhang is any face that points down at the build plate. Under about 45° from vertical, each layer's edge sticks out only ~ 0.15 mm beyond the layer below — well within filament's tendency to droop. Above 45° (closer to horizontal), the new layer has nothing to grip and falls.",
                    "Design fix: chamfer or fillet sharp downward-facing edges to ≥ 45° (a 1 mm chamfer on a 90° overhang turns it into 45°). Or accept supports.",
                ],
            },
            {
                heading: "Supports — let the slicer add them",
                body: [
                    "Bridges and tall overhangs need support material — temporary scaffolding the printer adds beneath them. You don't model supports in CAD; the slicer adds them automatically. OrcaSlicer's tree supports are very forgiving.",
                    "Design implication: if your part needs supports on a critical surface, plan to clean up that surface (a few seconds with a knife) or redesign so the supported area faces non-critical surfaces.",
                ],
            },
            {
                heading: "Holes — print on their sides",
                body: [
                    "A horizontal cylinder hole (axis parallel to the plate) prints perfectly. A vertical hole prints fine but the bottom of the hole has a small \"floor\" sag — design with this in mind or print the part on its side.",
                ],
            },
        ],
        recap: "Big flat face down. Overhangs ≤ 45° print free; over 45° need supports. Don't design supports — let the slicer add them.",
        cta: { label: "Try the Phone Stand starter — orientation lesson built-in", href: "/" },
    },

    {
        slug: "wall-thickness",
        title: "Wall thickness — what's actually printable",
        summary:
            "Concrete millimetre numbers for FDM. Save these and you'll never print a wall that snaps in half.",
        icon: "Ruler",
        accent: "from-rose-500/25 to-pink-500/10",
        accentColor: "text-rose-300",
        minutes: 3,
        sections: [
            {
                heading: "The single most important number",
                body: [
                    "**1.6 mm.** That's the minimum sane wall thickness for FDM. It's four times the typical 0.4 mm nozzle width — enough for the slicer to lay down 2 perimeters on each side with infill in between. Walls thinner than this either fail to print or snap when you look at them sideways.",
                    "Below 1.6 mm? Possible — but you're in expert territory (single-perimeter \"vase mode\" tricks, specific filament tuning). Skip it until your fifth print.",
                ],
            },
            {
                heading: "By feature type",
                body: [
                    "**Visible walls** (the shell of a box, the body of a phone stand): **1.6-2.4 mm**. Thicker for things that get handled.",
                    "**Standalone columns or fingers**: **2.4 mm minimum diameter**. A 1.6 mm finger snaps; a 3 mm finger is sturdy.",
                    "**Embossed letters on a face**: **0.6-1.2 mm raised**. Higher than 1.2 mm and the letters look gloopy; lower than 0.4 mm and they vanish.",
                    "**Engraved letters into a face**: **0.6-1 mm deep**. Deeper just wastes time.",
                    "**Snap-fit clips**: **1.2 mm at the thinnest flex point**. Goes thinner only if you're tuning a specific filament.",
                ],
            },
            {
                heading: "Test before you commit",
                body: [
                    "Every printer + filament combo has slightly different limits. Print a small \"thickness test\" — five walls of decreasing thickness (3, 2.4, 1.6, 1.2, 0.8 mm). Whichever ones survive being squeezed are your safe range. Costs 5 g of filament and answers the question forever.",
                ],
            },
        ],
        recap: "1.6 mm minimum for any wall you'll ever touch. 2.4 mm for anything that takes load. 1.2 mm for snap-clips. Test once, trust forever.",
        cta: { label: "Open the workspace and resize a primitive", href: "/workspace" },
    },

    {
        slug: "tolerances",
        title: "Tolerances and fit — actual slot-together numbers",
        summary:
            "Why your hole was too tight, and the millimetre clearances that just work.",
        icon: "Compass",
        accent: "from-violet-500/25 to-purple-500/10",
        accentColor: "text-violet-300",
        minutes: 4,
        sections: [
            {
                heading: "Why printed parts don't match the CAD model",
                body: [
                    "FDM filament is hot when extruded and shrinks slightly as it cools. Holes come out a touch smaller than the CAD model; outer dimensions come out a touch larger. The difference is usually 0.1-0.4 mm — small, but absolutely the reason a 6 mm hole won't fit a 6 mm peg.",
                    "Add clearance to your design. Don't try to print to exact dimensions — print to dimensions + clearance, and you'll get parts that actually fit.",
                ],
            },
            {
                heading: "The clearance cheat sheet",
                body: [
                    "**Push-fit (snug, no slop)**: hole = peg + **0.15 mm**. A 5 mm shaft slides into a 5.15 mm hole.",
                    "**Sliding fit (lid on a box, drawer)**: gap = **0.25 mm** per side, i.e. **0.5 mm** total. A 30 mm cap on a 30 mm box → make the cap inner = 30.5 mm.",
                    "**Loose / threaded screw** (M3 screw through a hole): hole = nominal screw + **0.4 mm**. M3 screw → 3.4 mm hole.",
                    "**Snap-fit with a click**: hole = peg + **0.3-0.5 mm** and add a 0.3 mm chamfer on the peg's leading edge.",
                ],
            },
            {
                heading: "When in doubt, print a test piece",
                body: [
                    "First time pairing two parts? Print just the joining area as a 10 mm test cube. Saves an hour-long print failing on the assembly step. Most slicers can render just a clipped Z range.",
                ],
            },
        ],
        recap: "Holes shrink. Add 0.15 mm for push fit, 0.25 mm per side for sliding, 0.4 mm for screw clearance. Print a test piece before the full part.",
        cta: { label: "Try the Toy Wheel starter — its axle bore uses these numbers", href: "/" },
    },

    {
        slug: "common-mistakes",
        title: "Top 10 beginner mistakes (and how to dodge them)",
        summary:
            "Every mistake on this list has cost makers a wasted print. Catch them in CAD instead.",
        icon: "AlertTriangle",
        accent: "from-red-500/25 to-rose-500/10",
        accentColor: "text-red-300",
        minutes: 5,
        sections: [
            {
                heading: "The top ten",
                body: [
                    "**1. Walls too thin.** Anything under 1.6 mm probably won't survive printing. See *Wall thickness*.",
                    "**2. Holes too tight.** Holes shrink. Always add **0.15-0.4 mm** clearance. See *Tolerances*.",
                    "**3. Designing supports.** The slicer adds them. You model the part you want; the slicer figures out scaffolding.",
                    "**4. Printing the part standing up.** Big flat face goes on the plate. Tall parts wobble, take longer, and fail more.",
                    "**5. Sharp overhangs.** A face that points more than 45° below horizontal needs supports OR a 45° chamfer in CAD. Add the chamfer.",
                    "**6. Not checking the dimensions.** A 1 cm phone stand is useless. ForgeSlicer's bottom-bar shows mm at all times — read it before saving.",
                    "**7. Forgetting to mark holes as Negative.** A positive cylinder makes a peg; a Negative cylinder makes a hole. ForgeSlicer's modifier toggle is one click on the primitive.",
                    "**8. Printing without a brim on small bases.** Slicer setting, not CAD — but worth knowing: anything with a footprint smaller than ≈ 20×20 mm gets a brim. It pops off after.",
                    "**9. Exporting STL when you needed 3MF.** STL loses your part hierarchy (positives + negatives collapse into one mesh). For OrcaSlicer / Bambu Studio / PrusaSlicer, prefer 3MF.",
                    "**10. Not test-printing a tiny version.** A 10-minute scaled-down print catches 90% of design issues. Cheaper than a 4-hour failed full print.",
                ],
            },
            {
                heading: "If you only remember three",
                body: [
                    "**Walls ≥ 1.6 mm.** **Holes need clearance.** **Big flat face on the plate.** Get those three right and you'll print successfully on your first try.",
                ],
            },
        ],
        recap: "Most failed first prints are one of ten predictable design choices — and ForgeSlicer flags eight of them in the workspace before you slice.",
        cta: { label: "Open the workspace and inspect a starter design", href: "/" },
    },

    {
        slug: "exporting-to-slicers",
        title: "Exporting to OrcaSlicer, Bambu Studio, or PrusaSlicer",
        summary:
            "The hand-off from ForgeSlicer to a desktop slicer. Step-by-step for each major slicer.",
        icon: "Download",
        accent: "from-teal-500/25 to-cyan-500/10",
        accentColor: "text-teal-300",
        minutes: 5,
        sections: [
            {
                heading: "First — pick STL or 3MF",
                body: [
                    "If your design uses positives only (no holes / no negatives) and you're handing it to a friend, **STL** is fine.",
                    "If you have any subtracts, embossed text, multi-colour parts, or want the slicer to recognise your individual primitives — **3MF**. ForgeSlicer's 3MF export keeps positives + negatives as separate parts so the slicer composes them correctly.",
                ],
            },
            {
                heading: "OrcaSlicer",
                body: [
                    "**1.** In ForgeSlicer, hit **File → Export → 3MF**. Save to your desktop.",
                    "**2.** Open OrcaSlicer. Drag the .3mf onto the build plate. It auto-fills the modifier roles (negative parts become subtract cuts).",
                    "**3.** Pick your printer profile, slice, send.",
                    "**Pro tip**: ForgeSlicer can also slice directly using a server-side OrcaSlicer engine — the workspace's **Engine selector** lets you switch between in-browser and server-side without re-exporting.",
                ],
            },
            {
                heading: "Bambu Studio",
                body: [
                    "**1.** Export **3MF** from ForgeSlicer.",
                    "**2.** Bambu Studio → drag onto the plate. The orientation and part hierarchy carry over.",
                    "**3.** Bambu auto-arranges multi-part designs on the plate. For colour-printed parts (AMS), you can colour-tag your primitives in Bambu Studio after import.",
                ],
            },
            {
                heading: "PrusaSlicer",
                body: [
                    "**1.** Export **3MF** (PrusaSlicer's 3MF reader is solid — STL also works).",
                    "**2.** PrusaSlicer → drag in. Negatives import as *Modifier* meshes set to *Cut* — already correct.",
                    "**3.** Slice. PrusaSlicer's per-object settings dialog lets you tune supports per part — useful for the rare cases where one negative needs a different treatment.",
                ],
            },
            {
                heading: "Custom slicer / desktop slicer not listed",
                body: [
                    "ForgeSlicer's **Open in slicer** button supports any slicer with a custom URL handler (e.g. `orcaslicer://`). The Help dialog → Slicer hand-off has the exact deep-link strings.",
                ],
            },
        ],
        recap: "Prefer 3MF. Negatives carry across as cuts. ForgeSlicer can also slice in-browser or on our server's OrcaSlicer engine if you don't want to leave the tab.",
        cta: { label: "Hand off a design from the workspace", href: "/workspace" },
    },
];

export const LESSONS_BY_SLUG = Object.fromEntries(LESSONS.map((l) => [l.slug, l]));

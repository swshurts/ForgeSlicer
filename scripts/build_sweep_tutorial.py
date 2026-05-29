"""Generate the ForgeSlicer Sweep / Sketch tutorial PDF.

Run:  python3 scripts/build_sweep_tutorial.py
"""
from reportlab.lib.units import inch
from reportlab.platypus import (
    Spacer, PageBreak, ListFlowable, ListItem, Paragraph,
)
from tutorial_lib import (
    make_doc, styles, make_chrome_fn, cover_block, closing_block,
    keyed_table, callout, PALETTE,
)


def build():
    doc = make_doc(
        "ForgeSlicer-Sweep-Tutorial.pdf",
        title="ForgeSlicer Sweep + Sketch Tutorial",
        subject="Building curved geometry by sweeping 2D profiles along 3D paths.",
    )
    flow = []
    add = flow.append

    # ===================== Cover ===================== #
    flow.extend(cover_block(
        "Sweep + Sketch Tutorial",
        "Building helical springs, arched handles, bezier curves, custom hooks — "
        "anything that's a 2D profile dragged along a 3D path.",
    ))
    add(callout(
        "Sweep is ForgeSlicer's most flexible primitive. Combined with 2D "
        "sketches, it lets you draw an arbitrary cross-section and then "
        "extrude it along any path — helix, arc, bezier, or your own "
        "hand-drawn polyline."))

    # ===================== Section 1 — Concept ===================== #
    add(PageBreak())
    add(Paragraph("1. What is a sweep?", styles["H2"]))
    add(Paragraph(
        "A <b>sweep</b> is a 2D shape (the <i>profile</i>) translated along a "
        "3D curve (the <i>path</i>). Imagine pulling a cookie cutter through "
        "the air: the cookie cutter is the profile, the trajectory of your "
        "hand is the path, and the resulting solid is the sweep.", styles["BODY"]))
    add(Paragraph(
        "ForgeSlicer's sweep primitive is built on this exact idea, with four "
        "extras: <b>twist</b> (the profile rotates as it travels), <b>samples</b> "
        "(how many cross-sections to build), and the ability to source either "
        "the profile or the path — or both — from a hand-drawn sketch.",
        styles["BODY"]))

    add(Paragraph("Two builders ship in the box", styles["H3"]))
    add(keyed_table([
        ["Field", "Options"],
        ["<b>profile.kind</b>",
         "<b>circle</b> &middot; <b>square</b> &middot; <b>rect</b> &middot; "
         "<b>star</b> &middot; <b>sketch</b> (your own 2D drawing)"],
        ["<b>path.kind</b>",
         "<b>helix</b> &middot; <b>arc</b> &middot; <b>bezier</b> &middot; "
         "<b>sketch3d</b> (your own 3D polyline) &middot; <b>ref</b> (an "
         "existing scene curve)"],
    ], col_widths=[1.4 * inch, 5.2 * inch]))

    # ===================== Section 2 — Anatomy of a sweep ===================== #
    add(Paragraph("2. Anatomy of a sweep object", styles["H2"]))
    add(keyed_table([
        ["Parameter", "Effect", "Default"],
        ["<b>samples</b>", "How many cross-sections along the path. Higher = "
         "smoother but more triangles.", "96"],
        ["<b>twistDeg</b>", "Total rotation of the profile across the entire "
         "path (degrees). 0 = no twist; 360 = one full revolution.", "0"],
        ["<b>profile.kind</b>", "Shape of the cross-section.", "circle"],
        ["<b>profile.r / .w / .h / .points</b>", "Profile dimensions, "
         "kind-dependent. Sketch profile carries a flat <i>points</i> array.",
         "&mdash;"],
        ["<b>path.kind</b>", "Trajectory shape.", "helix"],
        ["<b>path.r / .pitch / .turns / .points</b>", "Path geometry, "
         "kind-dependent. Sketch3D carries a 3D <i>points</i> array.",
         "&mdash;"],
    ], col_widths=[1.8 * inch, 3.6 * inch, 1.2 * inch]))
    add(callout(
        "<b>Triangle budget:</b> samples=96 produces about samples &times; "
        "profile-vertex-count triangles. A circle profile (r=2, "
        "segments=16) at samples=96 makes ~1.5&nbsp;k triangles. A star "
        "profile with 10 points easily doubles that. Drop samples to 48 "
        "before slicing if you don't see micro-detail in the result."))

    # ===================== Section 3 — Path kinds ===================== #
    add(PageBreak())
    add(Paragraph("3. Path kinds in depth", styles["H2"]))

    add(Paragraph("Helix", styles["H3"]))
    add(Paragraph(
        "A spring or screw thread. Parameters: <b>r</b> (helix radius), "
        "<b>pitch</b> (mm rise per turn), <b>turns</b> (number of complete "
        "rotations). Total height = pitch &times; turns. The path starts at "
        "(r, 0, 0) and spirals up the Y axis.",
        styles["BODY"]))
    add(Paragraph(
        "Common helix recipes:", styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>Coil spring</b> — circle profile r=1.5, helix r=10, "
            "pitch=4, turns=8. Result: a classic spring 32 mm tall.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Threaded bolt</b> — star profile (5 points, inner r=2, "
            "outer r=2.5), helix r=2.5, pitch=0.8, turns=37. Matches an "
            "M5 thread spec.", styles["BODY"])),
        ListItem(Paragraph(
            "<b>Vase rim</b> — rect profile 2&times;0.5, helix r=15, "
            "pitch=0.2 (very tight), turns=200. A barely-perceptible spiral "
            "lip around a cylinder.", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    add(Paragraph("Arc", styles["H3"]))
    add(Paragraph(
        "A circular arc in a single plane (XY by default). Parameters: <b>r</b> "
        "(arc radius), <b>startDeg / endDeg</b> (angle span in degrees). "
        "Use this for handles, hooks, brackets, anything bent at a "
        "consistent radius.", styles["BODY"]))

    add(Paragraph("Bezier", styles["H3"]))
    add(Paragraph(
        "A cubic bezier curve defined by four control points (<b>p0</b>, "
        "<b>p1</b>, <b>p2</b>, <b>p3</b>). The curve starts at p0, ends "
        "at p3, and the middle two points pull the curve in their direction "
        "without actually touching it. The Inspector exposes all four as "
        "XYZ vec3 inputs.", styles["BODY"]))
    add(callout(
        "<b>Bezier tip:</b> for a smooth handle, place p0 and p3 at the "
        "two endpoints, then drag p1 and p2 to set the curve's <i>tangent</i> "
        "direction at each end. The strength of the pull is roughly the "
        "distance from the endpoint to its companion control point."))

    add(Paragraph("Sketch3D — your own polyline", styles["H3"]))
    add(Paragraph(
        "An array of explicit (x, y, z) points connected by a smooth "
        "CatmullRom interpolation. Use the Sketch tool (Toolbar &rarr; "
        "Sketch &middot; Pencil) to draw the path in 2D, then promote it "
        "via right-click &rarr; <b>Use sketch as Sweep path (3D)</b>. The "
        "Inspector then exposes a <b>Rise (mm)</b> field that lifts the "
        "polyline linearly along Y — turn a flat doodle into a sloping ramp "
        "with one number.", styles["BODY"]))

    add(Paragraph("Ref — an existing scene curve", styles["H3"]))
    add(Paragraph(
        "Sometimes you want the sweep to follow the edge of another part. "
        "Set <i>path.kind</i> to <b>ref</b> and pick a target object — the "
        "sweep uses that object's first-component centerline as its path. "
        "Lets you build trim seals, gaskets, or wire-wraps that hug another "
        "part's geometry.", styles["BODY"]))

    # ===================== Section 4 — Profile kinds ===================== #
    add(PageBreak())
    add(Paragraph("4. Profile kinds", styles["H2"]))
    add(keyed_table([
        ["Kind", "Parameters", "Use case"],
        ["<b>circle</b>",
         "<b>r</b> (radius), <b>segments</b> (default 16)",
         "Wire, tubes, springs, generic rounded extrusions."],
        ["<b>square</b>",
         "<b>w</b> (side length)",
         "Rectangular trim, square handles."],
        ["<b>rect</b>",
         "<b>w</b> &times; <b>h</b>",
         "Flat ribbon, belt-like sweeps."],
        ["<b>star</b>",
         "<b>points</b> (count), <b>innerR</b>, <b>outerR</b>",
         "Threads, gear-tooth profiles, decorative star-extrusions."],
        ["<b>sketch</b>",
         "<b>points</b> — array of [x, y] pairs",
         "Truly custom — draw the profile in Sketch mode, right-click &rarr; "
         "<b>Use sketch as Sweep profile</b>, then tune in the Inspector."],
    ], col_widths=[1.0 * inch, 2.4 * inch, 3.2 * inch]))

    # ===================== Section 5 — Sketch workflow ===================== #
    add(Paragraph("5. Hand-drawn profiles & paths — the Sketch tool", styles["H2"]))
    add(Paragraph(
        "Ridges and stars are great, but real designs need shapes that don't "
        "fit any preset. The Sketch tool gives you a 2D drawing canvas that "
        "can become either a profile or a path:", styles["BODY"]))

    add(Paragraph("Drawing a sketch", styles["H3"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "Click the <b>Sketch</b> button in the top toolbar (or press "
            "<b>K</b>). The viewport switches to a 2D overlay with a grid.",
            styles["BODY"])),
        ListItem(Paragraph(
            "Choose a tool: <b>Pencil</b> for free-form polylines, "
            "<b>Line</b> for straight segments, <b>Rect</b> for closed "
            "rectangles, <b>Circle</b> for closed loops, or <b>Spline</b> "
            "for smooth curves between control points.", styles["BODY"])),
        ListItem(Paragraph(
            "Snap-to-grid is on by default (1&nbsp;mm). Hold Shift to disable "
            "while you drag.", styles["BODY"])),
        ListItem(Paragraph(
            "When you're happy, click <b>Commit</b>. The sketch becomes a "
            "scene object (visible in the outliner as <i>Sketch 1</i> etc.).",
            styles["BODY"])),
    ], bulletType="1", leftIndent=18))

    add(Paragraph("Promoting a sketch to a sweep", styles["H3"]))
    add(Paragraph(
        "Right-click your committed sketch in the viewport. Two new entries "
        "appear in the context menu:", styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>Use sketch as Sweep profile</b> — creates a new sweep object "
            "with <i>profile.kind</i> = <b>sketch</b>, defaulting to a helix "
            "path. Edit the path in the Inspector afterwards.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Use sketch as Sweep path (3D)</b> — creates a new sweep "
            "with <i>path.kind</i> = <b>sketch3d</b>, defaulting to a small "
            "circular profile. A new <b>Rise (mm)</b> field appears in the "
            "Inspector that lifts the polyline along Y.", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))
    add(callout(
        "<b>The sketch is preserved.</b> Promoting a sketch to a sweep "
        "duplicates its points into the new sweep object — the original "
        "sketch stays in the scene so you can keep iterating, then re-link "
        "the sweep to a new version via the Inspector's picker."))

    # ===================== Section 6 — Walkthrough ===================== #
    add(PageBreak())
    add(Paragraph("6. Walkthrough — a custom hook", styles["H2"]))
    add(Paragraph(
        "Goal: a hook with a flat tang, a curved shaft, and a tapered tip — "
        "the kind you'd 3D-print to hang a thing on a wall.", styles["BODY"]))
    steps = [
        "Click <b>Sketch</b> (or press <b>K</b>). Draw the hook profile in "
        "2D: a flat-bottomed shape ~6&nbsp;mm wide &times; 4&nbsp;mm tall, "
        "with a tapered tip on one side. Click <b>Commit</b>.",
        "Right-click the sketch &rarr; <b>Use sketch as Sweep profile</b>. A "
        "new sweep object appears with the profile set, defaulting to a helix "
        "path.",
        "In the Inspector, change <b>path.kind</b> from helix to <b>arc</b>. "
        "Set <b>r</b> = 25 mm, <b>startDeg</b> = 0, <b>endDeg</b> = 240. The "
        "sweep now follows a 240&deg; arc.",
        "Set <b>samples</b> to 128 for a smooth result. Tune <b>twistDeg</b> "
        "to 0 (the hook profile shouldn't twist along the arc).",
        "If the hook is the wrong way up, rotate the whole sweep object "
        "&minus;90&deg; on Z via the Inspector to stand it upright.",
        "Slice it. The G-code preview should show a smooth curved hook "
        "with your custom profile preserved end-to-end.",
    ]
    add(ListFlowable([ListItem(Paragraph(s, styles["BODY"])) for s in steps],
                     bulletType="1", leftIndent=18))

    # ===================== Section 7 — Twist & samples ===================== #
    add(Paragraph("7. Twist + samples — what they really do", styles["H2"]))
    add(Paragraph(
        "<b>twistDeg</b> is the <i>total</i> rotation applied to the profile "
        "across the ENTIRE path, regardless of length. A 360&deg; twist on a "
        "10&nbsp;mm path is one full revolution per 10&nbsp;mm; the same 360"
        "&deg; on a 1000&nbsp;mm path is one revolution per metre. Set "
        "twist <i>after</i> the path is dialled in.", styles["BODY"]))
    add(Paragraph(
        "<b>samples</b> is how many cross-sections to build. The renderer "
        "interpolates between them — too few and the sweep looks faceted; "
        "too many and the triangle count blows up. Rules of thumb:",
        styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>Short paths (&lt;30 mm), simple profile.</b> 48 samples plenty.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Medium paths (30&ndash;150 mm), or any twist.</b> 96&ndash;128 "
            "samples — the default 96 is correct.", styles["BODY"])),
        ListItem(Paragraph(
            "<b>Long paths (&gt;150 mm) or fine helix (turns &gt; 10).</b> "
            "192&ndash;256 samples to keep the spiral smooth.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>If frame rate dips while editing.</b> Drop samples temporarily; "
            "bump back up before slicing.", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    # ===================== Section 8 — Print tips ===================== #
    add(Paragraph("8. Print tips for swept geometry", styles["H2"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>Overhangs are inevitable on curved paths.</b> Anything past "
            "45&deg; from vertical needs supports. Use OrcaSlicer's "
            "tree-support mode for organic-shaped sweeps — way fewer "
            "support scars on a curved part than grid supports.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Helical springs print best lying down.</b> Standing them up "
            "is theoretically possible but the small thread cross-section "
            "fails at the layer-bonding interface. Lay flat, use one wall, "
            "100% infill on the swept profile only.", styles["BODY"])),
        ListItem(Paragraph(
            "<b>Long arcs need orientation thought.</b> A hook printed point-up "
            "needs supports under the tip. Same hook flat-on-bed prints in "
            "one shot with no supports.", styles["BODY"])),
        ListItem(Paragraph(
            "<b>Tiny twist + tiny samples = facets you can FEEL.</b> If you "
            "twist 360&deg; over 50 samples, every 7.2&deg; you get a "
            "visible flat. Bump samples or reduce twist.", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    # ===================== Section 9 — Troubleshooting ===================== #
    add(Paragraph("9. Troubleshooting", styles["H2"]))
    add(keyed_table([
        ["Symptom", "Likely cause", "Fix"],
        ["Sweep renders as a flat ring",
         "Path has only one point (e.g., a sketch that was never closed).",
         "Open the sketch picker in the Inspector and pick a valid 3+ point sketch."],
        ["Sweep has self-intersection / non-manifold STL",
         "Path turns more sharply than the profile's diameter.",
         "Either increase samples (smoother turn) or shrink the profile."],
        ["Twist looks wrong in one direction",
         "twistDeg can be negative — sign controls handedness.",
         "Set twistDeg to &minus;value for opposite handedness."],
        ["'Use sketch as Sweep profile' menu item missing",
         "Right-click target is not a single sketch object.",
         "Select exactly one sketch in the outliner first, then right-click."],
        ["Bezier curve goes the wrong way",
         "Control points 1 and 2 are swapped — the curve is mirrored.",
         "Edit the p1, p2 fields in the Inspector — bezier is order-sensitive."],
    ], col_widths=[2.0 * inch, 2.4 * inch, 2.3 * inch]))

    # ===================== Section 10 — Reference ===================== #
    add(Paragraph("10. Quick reference", styles["H2"]))
    add(Paragraph(
        "<b>Keyboard shortcuts:</b> K opens Sketch mode &middot; Esc cancels "
        "the current draw &middot; Enter commits a polyline.<br/>"
        "<b>Source:</b> sweep math lives in "
        "<font face='Courier'>frontend/src/lib/sweepGeometry.js</font> "
        "(buildSweepGeometry + SWEEP_DEFAULTS).<br/>"
        "<b>Inspector:</b> "
        "<font face='Courier'>frontend/src/components/SweepInspectorBlock.jsx</font> "
        "renders the per-kind controls.<br/>"
        "<b>Sketch overlay:</b> "
        "<font face='Courier'>frontend/src/components/SketchOverlay.jsx</font>.<br/>"
        "<b>Tests:</b> "
        "<font face='Courier'>frontend/tests/sweep-geometry.mjs</font>, "
        "<font face='Courier'>frontend/tests/sketch-to-sweep.mjs</font>.",
        styles["BODY"]))

    flow.extend(closing_block())
    chrome = make_chrome_fn(subtitle="Sweep + Sketch Tutorial")
    doc.build(flow, onFirstPage=chrome, onLaterPages=chrome)
    print(f"PDF written: {doc.filename}")


if __name__ == "__main__":
    build()

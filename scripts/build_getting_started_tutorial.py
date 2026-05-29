"""Generate the ForgeSlicer Getting Started tutorial PDF.

End-to-end overview — the first PDF a brand-new user should read. Covers
the entire workflow: account, workspace tour, primitives, CSG, save/share,
slicing & export. Cross-references the deeper tutorials.

Run:  python3 scripts/build_getting_started_tutorial.py
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
        "ForgeSlicer-Getting-Started.pdf",
        title="ForgeSlicer Getting Started",
        subject="Quick-start guide for new ForgeSlicer users.",
    )
    flow = []
    add = flow.append

    flow.extend(cover_block(
        "Getting Started",
        "From an empty workspace to a sliced, downloadable G-code in fifteen "
        "minutes. Then a map of where to go deeper on each subsystem.",
    ))
    add(callout(
        "ForgeSlicer is a <b>browser-based CAD + slicer combo</b>. You design "
        "with primitives + CSG, then slice with either the built-in JS engine "
        "or full server-side OrcaSlicer — no software install needed."))

    # ===================== Section 1 — Workspace tour ===================== #
    add(PageBreak())
    add(Paragraph("1. Workspace tour", styles["H2"]))
    add(keyed_table([
        ["Area", "What's there", "Shortcut"],
        ["<b>Left Panel</b>",
         "Primitives (Cube, Cylinder, Sphere, Bolt, Nut, Cone, Star, Sweep&hellip;), "
         "Combo (Slot, Fastener Pair, Countersink, Hex Pocket, Gusset), "
         "Library (Textures, Hardware, Components), Outliner.", "&mdash;"],
        ["<b>Top Toolbar</b>",
         "Project menu, Slicer popover, Transform popovers (Move/Rotate/Scale/Mirror), "
         "Sketch toggle, Voice button, Help, Theme switcher.", "&mdash;"],
        ["<b>3D Viewport</b>",
         "The build-plate scene. Orbit with right-mouse, pan with middle-mouse, "
         "zoom with wheel. Click any primitive to select.", "&mdash;"],
        ["<b>Right Panel (Inspector)</b>",
         "Per-object properties: position, rotation, scale, dims, modifier, color, "
         "kind-specific tweakable fields.", "&mdash;"],
    ], col_widths=[1.4 * inch, 4.4 * inch, 0.95 * inch]))

    # ===================== Section 2 — Your first part ===================== #
    add(Paragraph("2. Your first part — a name tag", styles["H2"]))
    add(Paragraph(
        "End-to-end recipe to build, save, and download a personalised "
        "name tag in five minutes.", styles["BODY"]))
    steps = [
        "Sign in (if not already). Click <b>Workspace</b>. Empty build-plate appears.",
        "From the <b>Primitives</b> tab, drop a <b>Cube</b>. In the Inspector "
        "set dims to <b>40 &times; 4 &times; 60 mm</b>. This is the tag body.",
        "Drop another Cube. Set dims to <b>2 &times; 8 &times; 50 mm</b>. "
        "Position it at the top edge to act as a lanyard slot.",
        "Set the second cube's <b>modifier</b> to <b>Negative</b> in the "
        "Inspector. The CSG engine carves it out of the first cube.",
        "Drop a <b>Text</b> primitive (Primitives &rarr; Text). Type your name. "
        "Set height = 1.5 mm, position it on top of the tag.",
        "Hit <b>Ctrl+S</b> to save the project. Name it &laquo;Name Tag&raquo;.",
        "Open the <b>Slicer</b> popover (Top Toolbar). Pick a printer "
        "(Custom &rarr; MyKlipper 0.4 nozzle is a fine default). Hit "
        "<b>Slice &amp; Export GCODE</b>. The G-code preview shows the sliced "
        "result; click <b>Download .gcode</b>.",
    ]
    add(ListFlowable([ListItem(Paragraph(s, styles["BODY"])) for s in steps],
                     bulletType="1", leftIndent=18))

    # ===================== Section 3 — CSG ===================== #
    add(Paragraph("3. CSG — the engine behind everything", styles["H2"]))
    add(Paragraph(
        "Every primitive in your scene carries a <b>modifier</b> flag: "
        "<b>positive</b> (added) or <b>negative</b> (subtracted). When the "
        "slicer runs:", styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "All positive primitives are <b>union'd</b> into one solid.",
            styles["BODY"])),
        ListItem(Paragraph(
            "All negative primitives are then <b>subtracted</b> from that "
            "solid.", styles["BODY"])),
        ListItem(Paragraph(
            "The result becomes your STL, your 3MF, your G-code.",
            styles["BODY"])),
    ], bulletType="1", leftIndent=18))
    add(callout(
        "<b>This is the single most important concept in ForgeSlicer.</b> "
        "Most beginners try to draw the &laquo;final shape&raquo;. Stop. Draw the "
        "<b>biggest shape</b> first, then carve away the bits you don't want "
        "with negative primitives. CSG = subtractive thinking."))

    # ===================== Section 4 — Where to go next ===================== #
    add(PageBreak())
    add(Paragraph("4. Where to go next", styles["H2"]))
    add(Paragraph(
        "Once you've made one part end-to-end, branch out into the deep-dive "
        "tutorials:", styles["BODY"]))
    add(keyed_table([
        ["When you want to...", "Read this", "Time"],
        ["Add gripable surfaces, knurls, hex grids, engraved logos",
         "<b>Texture Library Tutorial</b>", "20 min"],
        ["Drop real M3&ndash;M12 or 1/4-20 bolt+nut assemblies into the scene",
         "<b>Hardware Library Tutorial</b>", "15 min"],
        ["Build curved geometry — helical springs, arched handles, custom hooks",
         "<b>Sweep + Sketch Tutorial</b>", "25 min"],
        ["Compare your slicer against full OrcaSlicer",
         "Slicer popover &rarr; Compare engines (in-app)", "5 min"],
        ["Save and share your designs publicly",
         "Gallery &rarr; Share (in-app)", "&mdash;"],
        ["Voice-command everything",
         "Top Toolbar &rarr; Voice button (Shift+M)", "&mdash;"],
    ], col_widths=[3.0 * inch, 2.6 * inch, 0.9 * inch]))

    # ===================== Section 5 — Sharing ===================== #
    add(Paragraph("5. Saving, sharing, and remixing", styles["H2"]))
    add(Paragraph(
        "ForgeSlicer keeps your designs in three places:", styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>Local project file</b> — Ctrl+S saves a JSON-encoded "
            "project the browser remembers. Closes-and-reopens cleanly.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Personal components</b> — right-click any object &rarr; "
            "<b>Save to library</b>. Reusable across all your projects.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Public gallery</b> — File &rarr; Share. Your design goes "
            "to the community gallery with a thumbnail, dimensions, and a "
            "&laquo;Remix&raquo; button so others can build on it. Cards now "
            "show extents in mm and an amber <b>too big</b> warning if a "
            "design exceeds the viewer's printer bed.", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))
    add(callout(
        "<b>Remix is your friend.</b> Public designs offer a green "
        "<i>Remix</i> button (or an amber <i>Remix &middot; fit bed</i> "
        "when the model exceeds your printer). Hitting it opens the "
        "design in your workspace as the starting point for your "
        "iteration."))

    # ===================== Section 6 — Slicer choice ===================== #
    add(Paragraph("6. Built-in vs OrcaSlicer — which to pick?", styles["H2"]))
    add(keyed_table([
        ["Trait", "Built-in (JS)", "OrcaSlicer"],
        ["Where it runs", "In your browser", "On the ForgeSlicer server"],
        ["Speed", "&lt;1 s for typical scenes", "5&ndash;30 s typical"],
        ["Quality", "Single-perimeter, no supports",
         "Multi-perimeter, supports, ironing, calibration"],
        ["Materials", "Generic", "BBL / Custom / community presets"],
        ["Best for",
         "Quick iteration, design verification",
         "Final print-ready G-code"],
    ], col_widths=[1.2 * inch, 2.2 * inch, 3.2 * inch]))
    add(Paragraph(
        "You don't have to choose blindly. The Slicer popover has a "
        "<b>Compare engines</b> button that slices the same scene through "
        "both, then shows a side-by-side metrics table with trophy icons "
        "on the winning side per row.", styles["BODY"]))

    # ===================== Section 7 — Keyboard cheatsheet ===================== #
    add(Paragraph("7. Keyboard cheatsheet", styles["H2"]))
    add(keyed_table([
        ["Action", "Shortcut"],
        ["Save project", "Ctrl+S"],
        ["Undo / Redo", "Ctrl+Z / Ctrl+Y"],
        ["Duplicate selection", "Ctrl+D"],
        ["Delete selection", "Del / Backspace"],
        ["Open Texture Library", "Shift+T"],
        ["Open Hardware Library", "Shift+H"],
        ["Enter / leave Sketch mode", "K"],
        ["Toggle Voice mode", "Shift+M"],
        ["Frame / fit-to-view", "F"],
        ["Toggle build-plate grid", "G"],
    ], col_widths=[3.6 * inch, 2.4 * inch]))

    # ===================== Section 8 — FAQ ===================== #
    add(Paragraph("8. Quick FAQ", styles["H2"]))
    add(Paragraph(
        "<b>Q. Does ForgeSlicer work offline?</b><br/>"
        "A. The design tools and built-in slicer work offline once the page "
        "loads. OrcaSlicer slicing needs an internet connection (it runs "
        "server-side). Save-to-Gallery also needs network.", styles["BODY"]))
    add(Paragraph(
        "<b>Q. Can I import STL/OBJ/3MF?</b><br/>"
        "A. Yes — File &rarr; Import (or drag onto the viewport). The mesh "
        "becomes a regular scene object you can rotate, scale, and CSG-combine "
        "with primitives.", styles["BODY"]))
    add(Paragraph(
        "<b>Q. How do I send a sliced print directly to my printer?</b><br/>"
        "A. After slicing, the Slicer popover offers a <b>Send to printer</b> "
        "button. Currently supports Klipper / Moonraker on your LAN.",
        styles["BODY"]))
    add(Paragraph(
        "<b>Q. The viewport stutters when I add lots of textures.</b><br/>"
        "A. Texture objects are real geometry, not visual decals. Hit "
        "<b>tileSize &times; 2</b> in the Inspector — 4&times; fewer "
        "triangles for the same visual effect. The slicer still resolves "
        "the texture's relief height correctly.", styles["BODY"]))

    flow.extend(closing_block())
    chrome = make_chrome_fn(subtitle="Getting Started")
    doc.build(flow, onFirstPage=chrome, onLaterPages=chrome)
    print(f"PDF written: {doc.filename}")


if __name__ == "__main__":
    build()

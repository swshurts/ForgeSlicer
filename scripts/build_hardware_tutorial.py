"""Generate the ForgeSlicer Hardware Library tutorial PDF.

Run:  python3 scripts/build_hardware_tutorial.py
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
        "ForgeSlicer-Hardware-Tutorial.pdf",
        title="ForgeSlicer Hardware Library Tutorial",
        subject="Standard fasteners — ISO metric and UNC/UNF imperial.",
    )
    flow = []
    add = flow.append

    # ===================== Cover ===================== #
    flow.extend(cover_block(
        "Hardware Library Tutorial",
        "Dropping standard ISO metric (M3&ndash;M12) and UNC/UNF imperial "
        "(#4-40 to 1/2-13) fasteners into your model, with the right "
        "clearance bores and counterbores.",
    ))
    add(callout(
        "ForgeSlicer's Hardware Library ships <b>15 fastener grades</b> "
        "(7 metric + 8 imperial) covering everything from #4-40 chassis "
        "screws to 1/2-13 structural bolts. Each grade is a single click "
        "to drop a full bolt + clearance bore + counterbore + nut assembly."))

    # ===================== Section 1 — What ships ===================== #
    add(PageBreak())
    add(Paragraph("1. What's in the library?", styles["H2"]))
    add(Paragraph(
        "Every entry is a <b>real engineering spec</b> — the major thread "
        "radius, pitch, head height, and nut height come from ISO&nbsp;4014 "
        "(hex bolts) / ISO&nbsp;4762 (cap screws) for metric, and ANSI/ASME "
        "B18.6.3 for imperial. When you drop an M5×30, what shows up in "
        "the scene is geometry that matches the real part to a tenth of a "
        "millimeter.", styles["BODY"]))

    add(Paragraph("ISO metric grades", styles["H3"]))
    add(keyed_table([
        ["Grade", "Diameter", "Coarse pitch", "Head width<br/>(across flats)",
         "Head height", "Nut height"],
        ["M3",  "3.0 mm", "0.5 mm",  "5.5 mm", "2.0 mm", "2.4 mm"],
        ["M4",  "4.0 mm", "0.7 mm",  "7.0 mm", "2.8 mm", "3.2 mm"],
        ["M5",  "5.0 mm", "0.8 mm",  "8.0 mm", "3.5 mm", "4.0 mm"],
        ["M6",  "6.0 mm", "1.0 mm",  "10.0 mm","4.0 mm", "4.8 mm"],
        ["M8",  "8.0 mm", "1.25 mm", "13.0 mm","5.3 mm", "6.5 mm"],
        ["M10", "10.0 mm","1.5 mm",  "16.0 mm","6.4 mm", "8.0 mm"],
        ["M12", "12.0 mm","1.75 mm", "19.0 mm","7.5 mm", "10.0 mm"],
    ], col_widths=[0.65 * inch, 0.95 * inch, 0.95 * inch, 1.55 * inch,
                   1.15 * inch, 1.05 * inch]))
    add(Spacer(1, 6))
    add(Paragraph(
        "Available lengths per grade are filtered automatically — the "
        "picker won't let you build an M3×80 (silly) or an M12×6 (impossible "
        "to thread).",
        styles["BODY"]))

    add(Paragraph("UNC / UNF imperial grades", styles["H3"]))
    add(keyed_table([
        ["Grade", "Major dia.", "TPI", "Pitch (mm)", "Head width", "Nut height"],
        ["#4-40",   "0.112\"", "40", "0.635", "5.30 mm", "2.5 mm"],
        ["#6-32",   "0.138\"", "32", "0.794", "6.40 mm", "2.7 mm"],
        ["#8-32",   "0.164\"", "32", "0.794", "7.60 mm", "3.2 mm"],
        ["#10-24",  "0.190\"", "24", "1.058", "8.80 mm", "3.6 mm"],
        ["1/4-20",  "0.250\"", "20", "1.270", "11.10 mm","5.6 mm"],
        ["5/16-18", "0.3125\"","18", "1.411", "13.90 mm","6.5 mm"],
        ["3/8-16",  "0.375\"", "16", "1.588", "16.70 mm","7.5 mm"],
        ["1/2-13",  "0.500\"", "13", "1.954", "22.30 mm","10.0 mm"],
    ], col_widths=[0.85 * inch, 0.95 * inch, 0.55 * inch, 0.95 * inch,
                   1.15 * inch, 0.95 * inch]))
    add(callout(
        "All imperial dimensions are <b>stored in millimetres internally</b>. "
        "The picker labels them in inches for familiarity, but the geometry "
        "is the same metric engine as the M-series — you can mix metric and "
        "imperial fasteners in the same assembly without unit headaches."))

    # ===================== Section 2 — Drop a fastener ===================== #
    add(Paragraph("2. Dropping a fastener", styles["H2"]))
    add(Paragraph(
        "Open the workspace, click <b>Library &rarr; Hardware</b> in the left "
        "toolbar (or use <b>Shift+H</b>). The dialog shows two tabs — "
        "<b>Metric</b> and <b>Imperial</b>. Inside each tab:", styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>Grade</b> picker — pick M3, M5, 1/4-20, etc.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Length</b> picker — auto-filtered to commonly-available lengths "
            "for that grade.", styles["BODY"])),
        ListItem(Paragraph(
            "<b>Work thickness</b> (optional) — the host plate's thickness. "
            "Defaults to <i>length &minus; 5&nbsp;mm</i> so 5&nbsp;mm of "
            "shaft pokes past the nut for tightening.", styles["BODY"])),
        ListItem(Paragraph(
            "Hit <b>Add to scene</b>. Four objects appear, all grouped "
            "under a single assembly name (e.g. <i>Fastener M5×30</i>): "
            "the bolt, a clearance bore, a head counterbore, and a nut.",
            styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    # ===================== Section 3 — Anatomy ===================== #
    add(Paragraph("3. Anatomy of a Fastener Pair", styles["H2"]))
    add(Paragraph(
        "Each fastener assembly contains four members. Three are POSITIVE "
        "(geometry added to the scene) and one — wait, none are. Let me "
        "tell you what's actually going on:", styles["BODY"]))
    add(keyed_table([
        ["Member", "Modifier", "Why it's there"],
        ["<b>Bolt</b>", "Positive",
         "The visible bolt — a threaded shaft + hex head, generated from "
         "the grade's pitch and head dims. Goes through the assembly."],
        ["<b>Bolt bore</b>", "Negative",
         "A cylindrical hole 0.4&nbsp;mm larger than the bolt's outer "
         "radius. Subtracted from any host the assembly is placed against, "
         "so the bolt fits cleanly."],
        ["<b>Head counterbore</b>", "Negative",
         "A wider recess (headR + 0.5&nbsp;mm) carved at the top of the "
         "host. Lets the bolt head sit flush with the work surface, no "
         "protrusion."],
        ["<b>Nut</b>", "Positive",
         "A real hex nut at the bottom, sized to match the grade. Visual "
         "+ functional — if you're 3D printing the assembly itself, the "
         "nut prints as a separate part."],
    ], col_widths=[1.4 * inch, 0.85 * inch, 4.2 * inch]))
    add(callout(
        "The three negative members are <b>only</b> subtracted from "
        "primitives they overlap with. If you drop a fastener in empty "
        "space, you just see the bolt + nut. Move the assembly so the "
        "bolt-bore cylinder pierces your host plate, and the hole appears "
        "automatically — no manual cylinder placement."))

    # ===================== Section 4 — Walkthrough ===================== #
    add(PageBreak())
    add(Paragraph("4. Walkthrough — bolting two plates together", styles["H2"]))
    add(Paragraph(
        "End-to-end recipe. Goal: two 60&times;60&times;6&nbsp;mm aluminium-"
        "style plates joined by an M5&times;30 cap screw, drawn entirely in "
        "ForgeSlicer.", styles["BODY"]))
    steps = [
        "From the Primitives tab, drop a <b>Cube</b>. Set dims to "
        "60&times;6&times;60&nbsp;mm — this is plate A.",
        "Drop another Cube with the same dims. Move it 12&nbsp;mm up "
        "the Y axis (just above plate A) — this is plate B.",
        "Open <b>Library &rarr; Hardware</b> (Shift+H). Pick <b>Metric &rarr; "
        "M5</b>, length <b>30&nbsp;mm</b>, leave work-thickness on auto.",
        "Hit <b>Add to scene</b>. A four-member assembly drops at the "
        "world origin: bolt, bore, counterbore, nut.",
        "In the Inspector, set the assembly's position to <b>(30, 0, 30)</b> "
        "— the centre of plate A's footprint. The bolt now spears through "
        "both plates; the bore and counterbore carve a clean hole in each.",
        "Slice it. The G-code preview should show two plates joined by a "
        "circular bolt-shaped piece of geometry, with a counterbore at the "
        "top of plate B and a nut at the bottom of plate A.",
    ]
    add(ListFlowable([ListItem(Paragraph(s, styles["BODY"])) for s in steps],
                     bulletType="1", leftIndent=18))
    add(callout(
        "<b>Pattern this for production parts.</b> Drop the assembly once, "
        "use <b>Ctrl+D + Mirror X</b> (or right-click &rarr; Duplicate &rarr; "
        "Array) to populate corner holes. The bore + counterbore travel with "
        "every copy."))

    # ===================== Section 5 — Composite cousins ===================== #
    add(Paragraph("5. Related composites", styles["H2"]))
    add(Paragraph(
        "The Hardware Library handles full bolt+nut assemblies. For "
        "fastener-related <i>features</i> on your host part without a real "
        "bolt, check the <b>Combo</b> tab in the Left Panel:",
        styles["BODY"]))
    add(keyed_table([
        ["Composite", "Use", "Modifier"],
        ["<b>Slot</b>", "Adjustable / slide-fit hole for a bolt",
         "Negative (default)"],
        ["<b>Countersink</b>", "Flat-head bolt recess (cone cut)",
         "Negative"],
        ["<b>Hex pocket</b>", "Captive nut socket (square or hex)",
         "Negative"],
        ["<b>Gusset</b>", "Corner reinforcement triangle next to a bolt",
         "Positive"],
    ], col_widths=[1.2 * inch, 4.1 * inch, 1.4 * inch]))
    add(Paragraph(
        "These compose with the Hardware Library naturally — drop a hex "
        "pocket where the nut would otherwise float, and you get a captive "
        "nut socket that holds the nut without a wrench during assembly. "
        "Common in 3D-printed enclosures.", styles["BODY"]))

    # ===================== Section 6 — Tips ===================== #
    add(Paragraph("6. Print-and-fit tips", styles["H2"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>Clearance assumes a 0.4&nbsp;mm offset.</b> Most FDM printers "
            "produce holes slightly tighter than designed. For tight-fit "
            "applications (press-fit M5 into PETG), the bolt may need a tap "
            "to start. For sliding fits, increase the bore by 0.2&ndash;0.4&nbsp;"
            "mm via the Inspector after dropping the assembly.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Counterbore depth = head height + 0.2&nbsp;mm.</b> Designed "
            "so the bolt head sits 0.2&nbsp;mm BELOW the surface — no protrusion, "
            "no scuffing. If you want a domed protrusion, set the assembly's "
            "Y position 1&ndash;2&nbsp;mm lower so the head pokes up.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>The bolt is full-thread.</b> ForgeSlicer's bolt primitive "
            "draws threads along the entire shaft. If you want a partial "
            "thread (smooth shank under the head), use the Inspector to "
            "switch headStyle from <i>hex</i> to <i>socket</i>; the shoulder "
            "appears automatically.", styles["BODY"])),
        ListItem(Paragraph(
            "<b>Nut may be unprintable as part of a print.</b> Real metal "
            "nuts thread cleaner than printed ones. Hide the nut layer "
            "before slicing if you intend to use real hardware — or use the "
            "<b>Hex pocket</b> composite to hold it captive.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Imperial and metric are interchangeable.</b> Pick whichever "
            "is closer to your design intent. If you tap a 1/4-20 thread "
            "into a 6&nbsp;mm hole or vice versa, the world doesn't end — "
            "the geometry is consistent.", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    # ===================== Section 7 — Troubleshooting ===================== #
    add(Paragraph("7. Troubleshooting", styles["H2"]))
    add(keyed_table([
        ["Symptom", "Likely cause", "Fix"],
        ["Bolt is visible but the hole isn't appearing in the host",
         "The bore cylinder doesn't overlap the host — assembly was placed in "
         "empty space.",
         "Move the assembly so the bore pierces the host. The hole appears "
         "automatically on the next CSG pass."],
        ["Two assemblies dropped on top of each other",
         "Duplicate clicked too fast.",
         "Ctrl+Z, then use the Inspector to position the second one before "
         "duplicating again."],
        ["Bolt printed but threads look stripped",
         "Thread height &lt; 0.4&nbsp;mm + 0.2&nbsp;mm layer height = invisible.",
         "Print at 0.12 mm layers, or use a 0.2&nbsp;mm nozzle. Or use the "
         "bolt primitive without threads (Inspector &rarr; headStyle &rarr; "
         "<i>simple</i>)."],
        ["Counterbore is too shallow on a thin plate",
         "Counterbore depth = headH + 0.2 mm, exceeds your plate thickness.",
         "Switch to a flat-head bolt + Countersink composite — the cone cut "
         "uses less depth than a counterbore."],
        ["Need a fastener size that's not in the table",
         "Library is intentionally limited to common shop sizes.",
         "Drop the closest grade, then edit individual member dimensions "
         "in the Inspector. Or open <i>hardwareLibrary.js</i> and add a row "
         "to HARDWARE_TABLE."],
    ], col_widths=[2.2 * inch, 2.3 * inch, 2.2 * inch]))

    # ===================== Section 8 — Reference ===================== #
    add(Paragraph("8. Quick reference", styles["H2"]))
    add(Paragraph(
        "<b>Keyboard shortcut:</b> Shift+H opens Hardware Library.<br/>"
        "<b>Source:</b> grade tables live in "
        "<font face='Courier'>frontend/src/lib/hardwareLibrary.js</font>. "
        "Convert a grade + length to fastener opts via "
        "<font face='Courier'>hardwareToFastenerOpts(spec, length)</font>.<br/>"
        "<b>Dialog:</b> "
        "<font face='Courier'>frontend/src/components/dialogs/HardwareLibraryDialog.jsx</font>.<br/>"
        "<b>Builder:</b> "
        "<font face='Courier'>buildFastenerPair</font> in "
        "<font face='Courier'>frontend/src/lib/composites.js</font>.<br/>"
        "<b>Test:</b> "
        "<font face='Courier'>frontend/tests/hardware-library.mjs</font>.",
        styles["BODY"]))

    flow.extend(closing_block())
    chrome = make_chrome_fn(subtitle="Hardware Library Tutorial")
    doc.build(flow, onFirstPage=chrome, onLaterPages=chrome)
    print(f"PDF written: {doc.filename}")


if __name__ == "__main__":
    build()

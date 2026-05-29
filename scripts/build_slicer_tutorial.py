"""Generate the ForgeSlicer Slicer + Compare Engines tutorial PDF.

Run:  python3 scripts/build_slicer_tutorial.py
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
        "ForgeSlicer-Slicer-Tutorial.pdf",
        title="ForgeSlicer Slicer + Compare Engines Tutorial",
        subject="Sending designs to a slicer, comparing engines, and "
                "interpreting slice metrics.",
    )
    flow = []
    add = flow.append

    # ===================== Cover ===================== #
    flow.extend(cover_block(
        "Slicer + Compare Engines Tutorial",
        "Send to OrcaSlicer in two clicks. Run two engines side-by-side. "
        "Pick the one that prints faster, lighter, or stronger.",
    ))
    add(callout(
        "ForgeSlicer ships with a built-in OrcaSlicer engine (Flatpak "
        "distribution on Linux/ARM64, native on macOS/Windows). You "
        "can also send the same 3MF to your desktop OrcaSlicer / "
        "Bambu Studio / PrusaSlicer with one click."))

    # ===================== Section 1 — Concepts ===================== #
    add(PageBreak())
    add(Paragraph("1. Engines, profiles, and the slice pipeline", styles["H2"]))
    add(Paragraph(
        "A <b>slicer engine</b> is the program that converts your 3D mesh "
        "into G-code &mdash; layer-by-layer instructions a printer "
        "actually understands. ForgeSlicer routes slicing requests "
        "to one of:", styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>OrcaSlicer (built-in)</b> &mdash; runs server-side on "
            "ForgeSlicer's CLI. Default. Best for one-click slicing.",
            styles["BODY"])),
        ListItem(Paragraph(
            "<b>Desktop slicer (sent file)</b> &mdash; downloads a 3MF "
            "you open manually in your desktop slicer of choice. Best "
            "when you want full control of advanced settings.",
            styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    add(Paragraph("Profile inheritance", styles["H3"]))
    add(Paragraph(
        "ForgeSlicer profiles inherit from upstream OrcaSlicer system "
        "profiles &mdash; same syntax, same parameter names, same "
        "results. Your custom overrides live in the right panel "
        "(<b>Printer</b>, <b>Filament</b>, <b>Process</b>) and are "
        "applied as a delta on top of the chosen base profile.",
        styles["BODY"]))

    # ===================== Section 2 — Send to Slicer ===================== #
    add(Paragraph("2. Send to Slicer &mdash; the main flow", styles["H2"]))
    add(Paragraph(
        "When your design is ready, click <b>Send to OrcaSlicer</b> in "
        "the top toolbar. A dialog appears with four sections:",
        styles["BODY"]))
    add(keyed_table([
        ["Section", "What it controls"],
        ["<b>Printer</b>",
         "Bed size, nozzle diameter, max print height. Pick a system "
         "profile or a saved custom one."],
        ["<b>Filament</b>",
         "Material (PLA/PETG/ABS/TPU/PA-CF), print temp, bed temp, "
         "flow ratio. Quickly compare materials &mdash; PLA vs PETG can "
         "change your part's print time by 20%."],
        ["<b>Process</b>",
         "Layer height, walls, infill, supports, top/bottom layers. "
         "Most quality-vs-speed tradeoffs live here."],
        ["<b>Engine</b>",
         "Pick OrcaSlicer (server) or download a 3MF for a desktop "
         "slicer. The right panel switches accordingly."],
    ], col_widths=[1.2 * inch, 5.4 * inch]))

    add(Paragraph("Slicing on the server", styles["H3"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "Click <b>Slice</b>. Progress streams to the dialog in "
            "real time (loading mesh &rarr; perimeters &rarr; infill "
            "&rarr; supports &rarr; G-code).", styles["BODY"])),
        ListItem(Paragraph(
            "When done, a <b>Slice Summary</b> appears: estimated print "
            "time, filament length, filament weight, peak nozzle "
            "temperature, and bed level deviation.", styles["BODY"])),
        ListItem(Paragraph(
            "Click <b>Download G-code</b> to save the file, or "
            "<b>Preview G-code</b> to scrub through the layers in a "
            "viewer overlay.", styles["BODY"])),
    ], bulletType="1", leftIndent=18))

    add(callout(
        "<b>Slow first slice?</b> The Flatpak runtime is downloaded "
        "lazily the first time you click Slice on an ARM64 host. "
        "Subsequent slices use the cached runtime and start in &lt;1 s."))

    # ===================== Section 3 — Compare Engines ===================== #
    add(PageBreak())
    add(Paragraph("3. Compare Engines &mdash; A/B your slices", styles["H2"]))
    add(Paragraph(
        "Compare Engines runs the same design through two slicer "
        "configurations and lays the results side-by-side. Use it to "
        "answer questions like:", styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "&#x2713; <i>Does 0.16 mm layer height really save 30% time "
            "over 0.12 mm?</i>", styles["BODY"])),
        ListItem(Paragraph(
            "&#x2713; <i>Is tree support lighter than grid for this "
            "model?</i>", styles["BODY"])),
        ListItem(Paragraph(
            "&#x2713; <i>Does PETG burn meaningfully more filament than "
            "PLA at the same wall count?</i>", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    add(Paragraph("Workflow", styles["H3"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "Open the Slicer dialog as usual. Pick your <b>baseline</b> "
            "configuration (Profile A) on the left.", styles["BODY"])),
        ListItem(Paragraph(
            "Toggle <b>Compare engines</b> at the top of the dialog. A "
            "second panel (Profile B) appears next to A, pre-populated "
            "with A's settings so you only edit what you want to vary.",
            styles["BODY"])),
        ListItem(Paragraph(
            "Change anything in B &mdash; layer height, walls, infill, "
            "supports, material, even the entire engine (Orca vs Cura "
            "vs Prusa).", styles["BODY"])),
        ListItem(Paragraph(
            "Click <b>Slice Both</b>. Progress bars run in parallel; "
            "the slower engine determines total wait time.",
            styles["BODY"])),
        ListItem(Paragraph(
            "Read the side-by-side <b>metrics panel</b> below. Differences "
            "are highlighted: green = better, red = worse. See section 4 "
            "for what each metric means.", styles["BODY"])),
    ], bulletType="1", leftIndent=18))

    # ===================== Section 4 — Metrics ===================== #
    add(Paragraph("4. Metrics &mdash; what every row means", styles["H2"]))
    add(keyed_table([
        ["Metric", "Units", "What it tells you"],
        ["<b>Print time</b>", "h:mm",
         "Estimated wall-clock time. Most important number for batch "
         "production runs."],
        ["<b>Filament length</b>", "m",
         "How much filament is extruded. Useful for spool budgeting."],
        ["<b>Filament weight</b>", "g",
         "Mass of plastic used. Direct cost driver &mdash; multiply by "
         "your &euro;/kg material price."],
        ["<b>Peak temperature</b>", "&deg;C",
         "Hottest extrusion temp. High peaks for PA/CF blends; matters "
         "for hot-end longevity."],
        ["<b>Layer count</b>", "&mdash;",
         "Total layers in the slice. Time = layer count &times; mean "
         "layer time, roughly."],
        ["<b>Support volume</b>", "cm&sup3;",
         "Plastic spent on supports. Tree supports usually score 30&ndash;50% "
         "lower here than grid."],
        ["<b>Wall path length</b>", "m",
         "Total perimeter extrusion. Watch for &gt;3x ratios &mdash; usually "
         "means you cranked up walls/concentric infill."],
        ["<b>Top/bottom area</b>", "cm&sup2;",
         "Surface area of solid top/bottom layers. Big differences here "
         "warn that part orientation changed."],
    ], col_widths=[1.6 * inch, 0.7 * inch, 4.3 * inch]))

    add(callout(
        "<b>Diff coloring:</b> a metric is highlighted green when it's "
        "&ge;5% better in B than A (lower-is-better for time/weight/"
        "supports). Red means &ge;5% worse. Grey means within 5% &mdash; "
        "noise, not signal."))

    # ===================== Section 5 — Recipes ===================== #
    add(PageBreak())
    add(Paragraph("5. Compare-engine recipes", styles["H2"]))

    add(Paragraph("Speed-vs-quality A/B", styles["H3"]))
    add(Paragraph(
        "Profile A: 0.12 mm layer, 4 walls, 25% gyroid infill.<br/>"
        "Profile B: 0.20 mm layer, 3 walls, 15% gyroid infill.<br/>"
        "Expect B to slice 35&ndash;50% faster and 10&ndash;15% lighter, "
        "with visibly more striation. Worth it for prototypes; not for "
        "showpieces.", styles["BODY"]))

    add(Paragraph("Support style A/B", styles["H3"]))
    add(Paragraph(
        "Profile A: tree (organic) supports, 30&deg; threshold.<br/>"
        "Profile B: grid supports, 30&deg; threshold.<br/>"
        "Tree usually wins on support weight by 30&ndash;50%; grid is "
        "more reliable on flat overhangs. Compare both, pick per "
        "geometry.", styles["BODY"]))

    add(Paragraph("Material A/B", styles["H3"]))
    add(Paragraph(
        "Profile A: Generic PLA at 215&deg;C / 60&deg;C.<br/>"
        "Profile B: Generic PETG at 240&deg;C / 80&deg;C.<br/>"
        "Same model, two filaments. Tells you the print-time delta "
        "(PETG ~5% slower due to lower max speeds) and the weight "
        "delta (PETG ~25% denser than PLA).", styles["BODY"]))

    add(Paragraph("Wall count sweep", styles["H3"]))
    add(Paragraph(
        "Profile A: 2 walls.<br/>"
        "Profile B: 4 walls.<br/>"
        "Wall count is the strongest single lever for part strength on "
        "functional prints. The metric panel will show you exactly how "
        "much extra time and filament that strength costs.",
        styles["BODY"]))

    # ===================== Section 6 — Send to Desktop ===================== #
    add(Paragraph("6. Send to your desktop slicer", styles["H2"]))
    add(Paragraph(
        "Sometimes you want the full bells-and-whistles of a desktop "
        "slicer (custom plates, calibration shapes, advanced supports). "
        "ForgeSlicer can hand off in three formats:", styles["BODY"]))
    add(keyed_table([
        ["Format", "Best for"],
        ["<b>.3mf</b>",
         "OrcaSlicer / Bambu Studio. Preserves modifiers, color "
         "assignments, and per-object settings."],
        ["<b>.stl</b>",
         "PrusaSlicer / Cura / generic. Loses modifier metadata but "
         "universally readable."],
        ["<b>.gcode (preview)</b>",
         "Quick eyeball only &mdash; ForgeSlicer's internal preview "
         "engine, not production-quality."],
    ], col_widths=[0.9 * inch, 5.7 * inch]))

    # ===================== Section 7 — Troubleshooting ===================== #
    add(Paragraph("7. Troubleshooting", styles["H2"]))
    add(keyed_table([
        ["Symptom", "Likely cause", "Fix"],
        ["Slice fails with 'mesh not manifold'",
         "Booleans left thin slivers or coincident faces.",
         "Re-run booleans with 0.05 mm overlap, OR enable the slicer's "
         "auto-repair option."],
        ["Print time estimate is wildly off",
         "Accel/jerk profile doesn't match your printer's firmware.",
         "Update the system printer profile to match your machine's "
         "actual max speeds."],
        ["Compare shows huge weight delta but same volume",
         "Materials have different densities (PLA 1.24, PETG 1.27, "
         "TPU 1.21, PA-CF 1.08).",
         "Expected &mdash; the metric is mass, not volume."],
        ["Server slice keeps timing out",
         "Very large mesh (&gt;500&nbsp;k tris) or very fine layer height.",
         "Decimate the mesh first OR raise layer height to 0.20 mm "
         "for the first pass."],
    ], col_widths=[2.1 * inch, 2.4 * inch, 2.2 * inch]))

    # ===================== Section 8 — Quick reference ===================== #
    add(Paragraph("8. Quick reference", styles["H2"]))
    add(Paragraph(
        "<b>Toolbar:</b> Send to Slicer button (orange) is always second "
        "from the right of Row 1.<br/>"
        "<b>Hotkey:</b> Ctrl+P opens the Slicer dialog directly.<br/>"
        "<b>Compare toggle:</b> top of the dialog, next to the engine "
        "picker.<br/>"
        "<b>Source files:</b> "
        "<font face='Courier'>backend/orca_engine.py</font> routes CLI "
        "calls; "
        "<font face='Courier'>frontend/src/components/SlicerDialog.jsx</font> "
        "renders the side-by-side panel.<br/>"
        "<b>Profile docs:</b> System profiles inherit from upstream "
        "OrcaSlicer &mdash; <font face='Courier'>github.com/SoftFever/OrcaSlicer</font> "
        "has the canonical parameter reference.",
        styles["BODY"]))

    flow.extend(closing_block())
    chrome = make_chrome_fn(subtitle="Slicer + Compare Engines Tutorial")
    doc.build(flow, onFirstPage=chrome, onLaterPages=chrome)
    print(f"PDF written: {doc.filename}")


if __name__ == "__main__":
    build()

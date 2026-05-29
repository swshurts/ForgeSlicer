"""Generate the ForgeSlicer Texture Library tutorial PDF.

Run:  python3 scripts/build_texture_tutorial.py
"""
from pathlib import Path
from reportlab.lib.units import inch
from reportlab.platypus import (
    Spacer, Image, PageBreak, Table, TableStyle, KeepTogether,
    ListFlowable, ListItem, Paragraph,
)
from tutorial_lib import (
    make_doc, styles, make_chrome_fn, cover_block, closing_block,
    keyed_table, callout, regenerate_thumbs, PALETTE,
)

THUMBS = Path("/tmp/forge-tex-thumbs")
regenerate_thumbs()


def thumb(name: str, w: float = 1.5 * inch) -> Image:
    return Image(str(THUMBS / f"{name}.png"), width=w, height=w)


def build():
    doc = make_doc(
        "ForgeSlicer-Texture-Tutorial.pdf",
        title="ForgeSlicer Texture Library Tutorial",
        subject="In-depth guide to ForgeSlicer's nine printable surface textures.",
    )
    flow = []
    add = flow.append

    # ===================== Cover ===================== #
    flow.extend(cover_block(
        "Texture Library Tutorial",
        "Designing printable surfaces with knurls, hex grids, "
        "diamond plate, fabric weave, voronoi — and how to wrap them onto cylinders.",
    ))

    patterns = [
        ("knurl_diamond", "Knurl (Diamond)"),
        ("hex", "Hex grid"),
        ("bumps", "Bumps"),
        ("ridges_linear", "Ridges (linear)"),
        ("diamond_plate", "Diamond plate"),
        ("brick", "Brick wall"),
        ("fabric", "Fabric weave"),
        ("hex_camo", "Hex camo"),
        ("voronoi", "Voronoi"),
    ]
    cover_rows = []
    for i in range(0, len(patterns), 3):
        row = []
        for pid, label in patterns[i:i + 3]:
            cell = [thumb(pid, 1.55 * inch), Paragraph(f"<b>{label}</b>", styles["CAPTION"])]
            row.append(cell)
        cover_rows.append(row)
    ct = Table(cover_rows, colWidths=[2.3 * inch] * 3, rowHeights=[1.95 * inch] * 3)
    ct.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    add(ct)
    add(Spacer(1, 12))
    add(callout("All nine textures produce <b>real, printable surface geometry</b> — "
                "they survive STL export, CSG operations and slicing. They are not "
                "visual-only image maps."))
    add(PageBreak())

    # ===================== Section 1 ===================== #
    add(Paragraph("1. Why geometric (not image) textures?", styles["H2"]))
    add(Paragraph(
        "Most CAD packages and renderers fake textures with images projected onto a "
        "surface. Those textures look right on screen but they don't exist in 3D — "
        "when the slicer produces G-code, the model is just smooth plastic again. "
        "Useless for printing.", styles["BODY"]))
    add(Paragraph(
        "ForgeSlicer's textures are <b>actual displaced surface geometry</b>: every "
        "bump, groove, hex cell, and voronoi wall is a tessellated 3D shape. When "
        "the model gets sliced, those reliefs become real tool-path movements. The "
        "result prints exactly as drawn.", styles["BODY"]))
    add(Paragraph(
        "Trade-off: more triangles. A 60&times;60 mm bumps panel can carry "
        "8&ndash;15&nbsp;k triangles by itself; dense knurl on a flashlight grip "
        "can hit 40&ndash;60&nbsp;k. The renderer and slicer both handle these "
        "comfortably, but if you're authoring on a very low-end device, prefer "
        "larger <i>tile size</i> values to drop count fast.", styles["BODY"]))

    add(Paragraph("Modifier: positive vs. negative", styles["H3"]))
    add(Paragraph(
        "Every texture object behaves like any other primitive — it has a "
        "<b>modifier</b> flag. The flag decides whether the relief is added to "
        "or carved from the host:", styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "<b>Positive</b> — the texture is union'd onto the host part. Use "
            "this for raised reliefs: tool-handle grips, diamond-plate flooring, "
            "decorative panels.", styles["BODY"])),
        ListItem(Paragraph(
            "<b>Negative</b> — the texture is subtracted from the host. Use this "
            "for engraved logos, serial numbers, drainage channels, gripping "
            "treads.", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))
    add(Paragraph(
        "Switch the modifier from the Inspector's <b>+/&minus;</b> toggle at any "
        "time — the underlying mesh doesn't change, only the CSG operation applied "
        "to it.", styles["BODY"]))

    # ===================== Section 2 ===================== #
    add(PageBreak())
    add(Paragraph("2. Adding a texture", styles["H2"]))

    add(Paragraph("Method A — From the Texture Library dialog", styles["H3"]))
    add(Paragraph(
        "Open the workspace, click <b>Library &rarr; Textures</b> in the left "
        "toolbar (or use the keyboard shortcut <b>Shift+T</b>). The dialog shows "
        "all nine patterns with live preview thumbnails. Pick one, tune the "
        "sliders, hit <b>Add to scene</b>. A new texture object lands at the "
        "world origin, ready to position.", styles["BODY"]))

    add(Paragraph("Method B — Right-click an existing face", styles["H3"]))
    add(Paragraph(
        "Right-click any visible primitive in the scene and choose <b>Apply "
        "texture to face&hellip;</b>. The Texture Library dialog opens, but now "
        "you'll see a <i>face picker</i> at the top — choose +X / &minus;X / +Y / "
        "&minus;Y / +Z / &minus;Z and the texture's width/depth are auto-sized "
        "to that face's bounding box. The new texture object inherits the "
        "target's transform so it sits flush against the picked face.",
        styles["BODY"]))
    add(callout(
        "<b>Tip:</b> set the modifier to <b>Negative</b> in the picker before "
        "adding if you want to engrave rather than emboss. You can flip it later "
        "in the Inspector but it saves a round-trip."))

    add(Paragraph("Method C — Voice command", styles["H3"]))
    add(Paragraph(
        "If you have voice mode enabled, say <i>“add bumps texture, three by "
        "three centimeters, height one millimeter”</i>. The Whisper transcription "
        "is parsed by GPT-5.2 into a texture-creation intent — same parameters "
        "as the dialog, just faster when your hands are on the model.",
        styles["BODY"]))

    # ===================== Section 3 ===================== #
    add(Paragraph("3. Tuning a texture: the four key parameters", styles["H2"]))
    add(keyed_table([
        ["Parameter", "Effect", "Typical range", "Notes"],
        ["w, d (footprint)", "Width &times; depth of the textured region", "10&ndash;120 mm",
         "Auto-sized when applying via right-click face picker."],
        ["tileSize", "Periodicity of one tile in mm", "1.5&ndash;6 mm",
         "Smaller = denser (more triangles, finer feel)."],
        ["height", "Depth of the relief", "0.4&ndash;3 mm",
         "For positive: how far it sticks up. For negative: how deep it cuts."],
        ["depth (base)", "Thickness of the base plate", "0.4&ndash;1.5 mm",
         "The texture sits ON TOP of a thin base — keep &ge; 0.4 mm to avoid CSG gaps."],
    ], col_widths=[1.2 * inch, 2.05 * inch, 0.95 * inch, 2.3 * inch]))
    add(Spacer(1, 6))
    add(callout(
        "<b>Triangle budget rule of thumb:</b> a 50&times;50 mm patch at "
        "tileSize=2&nbsp;mm produces 20&ndash;30&nbsp;k triangles for the dense "
        "patterns (knurl, hex). Doubling tileSize drops the count by roughly "
        "4&times; without changing the visual character."))

    # ===================== Section 4 ===================== #
    add(Paragraph("4. Wrap modes — flat vs. cylinder", styles["H2"]))
    add(Paragraph(
        "By default a texture is a flat panel sitting on the XZ plane. The Texture "
        "Library dialog has a <b>Wrap</b> selector that lets you bend the flat tile "
        "into a <b>cylinder</b>, with a configurable radius. This is the single "
        "most useful feature for things like flashlight grips, dial-knurls, vase "
        "patterns, and decorative columns.", styles["BODY"]))
    add(Paragraph("Two wrap modes:", styles["H3"]))
    add(ListFlowable([
        ListItem(Paragraph("<b>Flat</b> — texture stays planar (the default).",
                           styles["BODY"])),
        ListItem(Paragraph(
            "<b>Cylinder</b> — width <i>w</i> wraps around the cylinder's "
            "circumference. With <b>Auto radius</b> (<i>wrapRadius=0</i>) the "
            "dialog picks a radius so the texture wraps <i>exactly once</i> "
            "around the cylinder. Set a manual radius to control how tight the "
            "wrap is.", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))
    add(Paragraph(
        "<b>Maths:</b> auto radius = <i>w</i> &divide; 2&pi;. So a 60 mm wide "
        "texture on auto radius produces a cylinder of ~9.5 mm radius. To wrap "
        "onto a known cylinder, set <i>w</i> = 2&pi;&times;target radius (or "
        "just enter the radius directly).", styles["BODY"]))
    add(callout(
        "<b>Sphere wrap?</b> Not yet supported. A flat-to-sphere mapping "
        "requires non-uniform tile scaling near the poles to avoid pinching — "
        "on the V2 backlog."))

    # ===================== Section 5 — Pattern catalog ===================== #
    add(PageBreak())
    add(Paragraph("5. Pattern catalog — pick the right one", styles["H2"]))

    catalog = [
        ("knurl_diamond", "Knurl (Diamond)",
         "Diagonal cross-hatch of square pyramids. The grip standard.",
         "Tool handles, dial-knurls, anti-twist surfaces on threaded caps.",
         "tileSize 1.5&ndash;2.5 mm gives a fine, fingertip-grippable feel. "
         "Larger tiles (4 mm+) look like aggressive industrial knurls."),
        ("hex", "Hex grid",
         "Tiled hexagonal cells with flat tops.",
         "Vents, honeycomb panels, lightweight infill plates, decorative.",
         "Use as a NEGATIVE on a thin plate to produce a perforated grille. "
         "Combine with a positive base to control structural strength."),
        ("bumps", "Bumps",
         "Hemispherical dots on a regular grid.",
         "Anti-slip pads, dot patterns, tactile indicators, braille-style.",
         "Height 0.8 mm with tileSize 3 mm is the standard rubber-foot feel. "
         "For braille, tileSize 2.5 mm + height 0.5 mm hits the spec."),
        ("ridges_linear", "Ridges (linear)",
         "Parallel half-cylinder grooves.",
         "Flashlight grip, column fluting, threaded-cap finger ridges.",
         "Apply with <b>Cylinder wrap</b> to get classic vertical fluting "
         "around a cylindrical body. Orient the texture's rotation to point "
         "the ridges along whichever axis you want."),
        ("diamond_plate", "Diamond plate",
         "Pinwheel of four diamonds per tile — industrial tread.",
         "Floor panels, stair treads, slip-resistant covers.",
         "Default height 1.5 mm is correct — anything less reads as wallpaper. "
         "Don't shrink tileSize below 4 mm; the pinwheel detail collapses."),
        ("brick", "Brick wall",
         "Running-bond brick layout with mortar gaps.",
         "Decorative wall panels, dollhouse facades, miniature dioramas.",
         "Use as POSITIVE on a thin baseplate; the mortar gaps become the "
         "low-relief 'in-between' surface. Default tileSize is the brick width."),
        ("fabric", "Fabric weave",
         "Basket-weave warp+weft cylinders.",
         "Burlap, canvas, woven-mat insets, decorative coasters.",
         "Looks best at tileSize 3&ndash;4 mm with height ~ tileSize/3. "
         "Cylinder wrap turns this into a woven-grip sleeve."),
        ("hex_camo", "Hex camo",
         "Hex grid with randomised cell heights.",
         "Military-style armor panels, futuristic skins, gaming props.",
         "The height variation is per-cell deterministic — same seed &rarr; same "
         "panel. Save your scene; the random heights persist across reloads."),
        ("voronoi", "Voronoi",
         "Irregular polygonal cells from random seed points.",
         "Cracked-glass effects, organic stipple, natural-looking texturing.",
         "Best as a NEGATIVE on a flat panel: the cell walls become engraved "
         "channels that catch light beautifully under FDM line-art lighting."),
    ]
    for idx, (pid, label, descr, uses, tip) in enumerate(catalog, start=1):
        card = [
            Paragraph(f"5.{idx}&nbsp;&nbsp;{label}", styles["H3"]),
            Table([[thumb(pid, 1.4 * inch), [
                Paragraph(f"<i>{descr}</i>", styles["BODY"]),
                Paragraph(f"<b>Use cases.</b> {uses}", styles["BODY"]),
                Paragraph(f"<b>Tip.</b> {tip}", styles["BODY"]),
            ]]], colWidths=[1.6 * inch, 4.9 * inch]),
            Spacer(1, 4),
        ]
        # Style the table inside the card
        card[1].setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        add(KeepTogether(card))

    # ===================== Section 6 — CSG workflow ===================== #
    add(PageBreak())
    add(Paragraph("6. CSG workflow — how textures combine with parts", styles["H2"]))
    add(Paragraph(
        "Texture objects participate in ForgeSlicer's CSG (Constructive Solid "
        "Geometry) engine just like any other primitive. The order of operations is:",
        styles["BODY"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "All <b>positive</b> primitives in the scene are union'd together to "
            "form the base solid.", styles["BODY"])),
        ListItem(Paragraph(
            "All <b>negative</b> primitives are then subtracted from that base "
            "solid.", styles["BODY"])),
        ListItem(Paragraph(
            "The final mesh is what gets sliced and exported as STL / 3MF.",
            styles["BODY"])),
    ], bulletType="1", leftIndent=18))
    add(Paragraph("Practical recipe for an engraved logo:", styles["H3"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "Drop your host part (a cube, a cylinder, an imported STL) — make "
            "sure it's <b>positive</b>.", styles["BODY"])),
        ListItem(Paragraph(
            "Right-click its top face and pick <i>Apply texture to face&hellip;</i> "
            "from the context menu.", styles["BODY"])),
        ListItem(Paragraph(
            "In the dialog: pick the pattern (try <i>voronoi</i> or <i>hex</i>), "
            "select <b>Negative</b> as the modifier, set <i>height</i> to your "
            "desired engraving depth (e.g. 0.6 mm), hit <b>Add to scene</b>.",
            styles["BODY"])),
        ListItem(Paragraph(
            "The texture object lands flush against the picked face. Use the "
            "Inspector to nudge its position if needed.", styles["BODY"])),
        ListItem(Paragraph(
            "Open the Slicer popover and hit <b>Slice &amp; Export</b>. The G-code "
            "preview should show the texture as engraved channels on top of the "
            "host part.", styles["BODY"])),
    ], bulletType="1", leftIndent=18))

    add(Paragraph("Why the base plate matters", styles["H3"]))
    add(Paragraph(
        "Every texture carries a small base plate (the <b>depth</b> parameter, "
        "0.4&ndash;1.5 mm by default). This is intentional — without it, the "
        "relief geometry would float in air at the bottom and the CSG "
        "union/subtract could leave manifold-breaking gaps if your part's "
        "surface is slightly curved or non-coplanar with the texture.",
        styles["BODY"]))
    add(Paragraph(
        "The base plate gives the CSG engine some overlap to merge cleanly. For "
        "a positive texture, the base just embeds slightly into the host (no "
        "visual difference). For a negative texture, the base extends below the "
        "host surface so the engraved channels cut all the way through the "
        "reliefs.", styles["BODY"]))
    add(callout(
        "<b>Set <i>depth</i> to 0.4 mm</b> as a minimum. Going lower can introduce "
        "manifold errors during slicing on highly curved hosts."))

    # ===================== Section 7 — Walkthrough ===================== #
    add(PageBreak())
    add(Paragraph("7. Walkthrough — knurled flashlight grip", styles["H2"]))
    add(Paragraph(
        "End-to-end recipe combining everything above. Goal: a 25 mm diameter, "
        "60 mm tall cylindrical grip with a fine diamond knurl.", styles["BODY"]))
    steps = [
        "From the Primitives tab, drop a <b>Cylinder</b>. Set radius = 12 mm, height = 60 mm.",
        "Open <b>Library &rarr; Textures</b> (or Shift+T).",
        "Pick <b>Knurl (Diamond)</b>. Set <i>tileSize</i> = 2 mm, <i>height</i> = 0.6 mm.",
        "Switch <b>Wrap</b> from Flat to <b>Cylinder</b>. Leave radius at 0 (auto).",
        "Set the texture's <i>w</i> to 2&pi; &times; 12 = <b>75.4 mm</b> so it "
        "wraps exactly once. Set <i>d</i> to 60 (the grip's height).",
        "Hit <b>Add to scene</b>. The knurled sleeve lands at the origin.",
        "In the Inspector, position the texture object to coincide with the "
        "cylinder's centre line. The knurl visually merges with the cylinder body.",
        "Open the Slicer popover, pick a printer, hit <b>Slice &amp; Export</b>. "
        "Layer 1 should show the cylinder profile with the knurl reliefs around "
        "the perimeter.",
    ]
    add(ListFlowable([ListItem(Paragraph(s, styles["BODY"])) for s in steps],
                     bulletType="1", leftIndent=18))
    add(callout(
        "Save this as a Component (right-click &rarr; <b>Save to library</b>) once "
        "you're happy — you can reuse the knurled sleeve on future torches without "
        "rebuilding it."))

    # ===================== Section 8 — Print tips ===================== #
    add(Paragraph("8. Print-quality tips", styles["H2"]))
    add(Paragraph(
        "Textures place additional demands on the printer because the reliefs "
        "are small features. Following these tips will save you from prints "
        "where the texture is blurry or missing entirely:", styles["BODY"]))
    tips = [
        "<b>Layer height vs. relief height.</b> A 0.4 mm relief on a 0.2 mm "
        "layer is only 2 layers tall — the texture will read as flat. Keep "
        "relief <i>height</i> &ge; 3&times; layer height for crisp definition.",
        "<b>Nozzle diameter vs. tile size.</b> A 0.4 mm nozzle can resolve "
        "features down to ~0.5 mm. Tile sizes below 1.5 mm with a 0.4 mm nozzle "
        "will muddle. Use a 0.2 mm nozzle for the finest knurls.",
        "<b>Line width.</b> Set the slicer's outer wall width to match nozzle "
        "diameter, NOT 1.2&times;. Wider lines smear textures.",
        "<b>Ironing OFF on textured top surfaces.</b> Ironing flattens the "
        "relief. Disable ironing globally or use OrcaSlicer's per-object override.",
        "<b>Print speed.</b> Textured walls benefit from slower outer-wall "
        "speeds (20&ndash;35 mm/s). The reliefs ARE the outer wall.",
        "<b>Material choice.</b> PLA and PETG hold fine texture detail. ABS and "
        "ASA tend to smooth-over at typical print speeds due to higher viscosity "
        "and contraction.",
    ]
    add(ListFlowable([ListItem(Paragraph(t, styles["BODY"])) for t in tips],
                     bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    # ===================== Section 9 — Troubleshooting ===================== #
    add(Paragraph("9. Troubleshooting", styles["H2"]))
    add(keyed_table([
        ["Symptom", "Likely cause", "Fix"],
        ["Texture is invisible in viewport",
         "Wrong modifier — texture is negative but no host part to subtract from.",
         "Add a positive primitive first, then apply the negative texture on top."],
        ["Slicer fails: NotManifold error",
         "depth &lt; 0.4 mm caused gaps in CSG union.",
         "Bump depth to 0.5&ndash;0.8 mm and re-slice."],
        ["Print looks flat / no relief",
         "Layer height too coarse for the relief height.",
         "Either drop layer height to 0.12 mm or bump relief height to 1+ mm."],
        ["Wrap looks distorted", "Width is wrong for target radius.",
         "Use w = 2&pi; &times; radius, or set wrapRadius directly and let w follow."],
        ["Voronoi or hex_camo looks different every reload",
         "Random seed not persisted with the project.",
         "Save the project (Ctrl+S) — the seed is captured in the JSON."],
    ], col_widths=[1.7 * inch, 2.3 * inch, 2.5 * inch]))

    # ===================== Section 10 — Reference ===================== #
    add(Paragraph("10. Quick reference", styles["H2"]))
    add(Paragraph(
        "<b>Keyboard shortcuts:</b> Shift+T opens Texture Library &middot; Ctrl+D "
        "duplicates a selected texture &middot; Ctrl+Z undoes a texture add.<br/>"
        "<b>Source:</b> patterns live in "
        "<font face='Courier'>frontend/src/lib/textureGeometry.js</font>. "
        "Defaults are in <font face='Courier'>TEXTURE_PATTERNS</font> + "
        "<font face='Courier'>TEXTURE_DEFAULTS</font>.<br/>"
        "<b>Dialog:</b> "
        "<font face='Courier'>frontend/src/components/dialogs/TextureLibraryDialog.jsx</font>.<br/>"
        "<b>Test:</b> "
        "<font face='Courier'>frontend/tests/texture-geometry.mjs</font>.",
        styles["BODY"]))

    flow.extend(closing_block())
    chrome = make_chrome_fn(subtitle="Texture Library Tutorial")
    doc.build(flow, onFirstPage=chrome, onLaterPages=chrome)
    print(f"PDF written: {doc.filename}")


if __name__ == "__main__":
    build()

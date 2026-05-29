"""Generate the ForgeSlicer Gallery + Sharing tutorial PDF.

Run:  python3 scripts/build_gallery_tutorial.py
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
        "ForgeSlicer-Gallery-Tutorial.pdf",
        title="ForgeSlicer Gallery + Sharing Tutorial",
        subject="Publishing, remixing, licensing, and finding designs in "
                "the public gallery and component library.",
    )
    flow = []
    add = flow.append

    # ===================== Cover ===================== #
    flow.extend(cover_block(
        "Gallery + Sharing Tutorial",
        "Publish a design. Remix someone else's. Save a fastener once and "
        "reuse it everywhere. Pick a license you actually want to live with.",
    ))
    add(callout(
        "The Gallery and Component Library are ForgeSlicer's two community "
        "spaces. The Gallery is for whole designs (a phone stand, a wall "
        "hook). The Library is for reusable parts (an M3 socket-cap screw, "
        "a hinge). They share the same publish flow."))

    # ===================== Section 1 — Anatomy ===================== #
    add(PageBreak())
    add(Paragraph("1. Anatomy of a shared item", styles["H2"]))
    add(Paragraph(
        "Every gallery card is a packaged bundle stored on ForgeSlicer's "
        "server. The bundle contains:", styles["BODY"]))
    add(keyed_table([
        ["Field", "Required?", "Notes"],
        ["<b>Name</b>", "Yes",
         "Shown on every card; max 80 chars; supports emoji."],
        ["<b>Thumbnail</b>", "Auto",
         "Captured from the viewport at publish time. You can re-capture "
         "from the gallery card later if you don't like the angle."],
        ["<b>Description</b>", "No",
         "Markdown supported. Use it to explain print orientation, "
         "intended infill, and any assembly steps."],
        ["<b>STL</b>", "Auto",
         "Baked geometry &mdash; what most users will print."],
        ["<b>Editable project (.forge.json)</b>", "Auto",
         "The original primitives &amp; modifiers, so remixers can edit "
         "the source, not just the mesh."],
        ["<b>License</b>", "Yes",
         "Pick at publish time. See section 4 for the full list."],
        ["<b>Material hint</b>", "No",
         "Suggested material (PLA, PETG, ABS, TPU, PA-CF). Filterable "
         "on the gallery grid."],
        ["<b>Category</b>", "No",
         "Tools, Toys, Tabletop, Lighting, Storage, Functional, "
         "Decorative, Misc. Filterable."],
        ["<b>Tags</b>", "No",
         "Free-form. Each tag becomes a clickable filter pill."],
        ["<b>Bounding box</b>", "Auto",
         "Used by 'Resize to my bed' to scale on remix import."],
        ["<b>Private</b>", "Toggle",
         "On = visible only to you. Useful for works-in-progress."],
    ], col_widths=[2.0 * inch, 0.8 * inch, 3.8 * inch]))

    # ===================== Section 2 — Publishing ===================== #
    add(Paragraph("2. Publishing a design", styles["H2"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "Click <b>Share Design</b> in the top toolbar. A modal "
            "appears with a fresh thumbnail of your current view.",
            styles["BODY"])),
        ListItem(Paragraph(
            "Fill in the Name (required), Description (optional), "
            "Category, Tags, Material hint, License.", styles["BODY"])),
        ListItem(Paragraph(
            "Pick the Privacy mode: <b>Public</b> (default, shows up "
            "on the global feed) or <b>Private</b> (hidden, only you "
            "see it on the 'Mine' filter).", styles["BODY"])),
        ListItem(Paragraph(
            "(Optional) Re-capture the thumbnail by rotating the "
            "viewport to a hero angle and clicking the camera icon "
            "in the modal.", styles["BODY"])),
        ListItem(Paragraph(
            "Hit <b>Publish</b>. The bundle (thumbnail + STL + "
            "<font face='Courier'>.forge.json</font>) is uploaded; "
            "a success toast links to the new card.",
            styles["BODY"])),
    ], bulletType="1", leftIndent=18))

    add(callout(
        "<b>Editing after publish:</b> click any of your own cards "
        "&rarr; Edit. You can change description, tags, license, and "
        "privacy without affecting the geometry. Replace the geometry "
        "(re-share new version) by deleting the old card &amp; "
        "publishing again."))

    # ===================== Section 3 — Component Library ===================== #
    add(PageBreak())
    add(Paragraph("3. The Component Library", styles["H2"]))
    add(Paragraph(
        "Components are <i>reusable parts</i>: a screw, a hinge, a "
        "snap-fit clip. You build them once, save them, then drop "
        "them into any future project.", styles["BODY"]))
    add(Paragraph("Save a component", styles["H3"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "Select the part(s) you want to save (or leave selection "
            "empty to save the whole scene).", styles["BODY"])),
        ListItem(Paragraph(
            "Toolbar &rarr; <b>Component</b> button (next to Share "
            "Design). A focused modal appears &mdash; same fields as a "
            "design plus an <i>Origin offset</i> field.", styles["BODY"])),
        ListItem(Paragraph(
            "<b>Origin offset</b> shifts the component's local origin "
            "so it lands flush to the bed every time you drop it. "
            "Defaults to the bounding box bottom &mdash; leave it.",
            styles["BODY"])),
        ListItem(Paragraph(
            "Pick whether it's a <b>positive</b> assembly (e.g. a "
            "knob you'll add to a project) or a <b>negative</b> "
            "template (e.g. a screw clearance hole you'll subtract).",
            styles["BODY"])),
        ListItem(Paragraph(
            "Publish. The card appears in <b>Gallery &rarr; Components "
            "tab</b>.", styles["BODY"])),
    ], bulletType="1", leftIndent=18))

    add(Paragraph("Add to project", styles["H3"]))
    add(Paragraph(
        "Browse Gallery &rarr; Components tab. Each card has an "
        "<b>Add to project</b> button. The component drops in at the "
        "world origin, modifier set per its publish settings &mdash; "
        "instant assembly. Use the gizmo to place it.", styles["BODY"]))

    add(Paragraph("Verified ✓ badge", styles["H3"]))
    add(Paragraph(
        "Some components carry a green <b>Verified ✓</b> badge. These "
        "are community-vetted parts &mdash; ISO-correct fasteners, "
        "tested fits, accurate tolerances. You can request "
        "verification for your own component via "
        "<font face='Courier'>Profile &rarr; Components &rarr; Request "
        "verification</font>; a maintainer reviews within a week.",
        styles["BODY"]))

    # ===================== Section 4 — Licensing ===================== #
    add(PageBreak())
    add(Paragraph("4. Licensing &mdash; what you actually grant", styles["H2"]))
    add(Paragraph(
        "Picking a license is the most important decision when you "
        "publish. It tells everyone else what they can do with your "
        "design. ForgeSlicer offers nine options; here's a one-line "
        "summary of each.", styles["BODY"]))
    add(keyed_table([
        ["License", "Allow commercial?", "Allow derivative?", "Share-alike?"],
        ["<b>CC-BY 4.0</b> <i>(default)</i>", "Yes", "Yes", "No"],
        ["<b>CC0</b> <i>(public domain)</i>", "Yes", "Yes", "No"],
        ["<b>MIT</b>", "Yes", "Yes", "No"],
        ["<b>Apache 2.0</b>", "Yes", "Yes", "No (patent grant)"],
        ["<b>GPL v3</b>", "Yes", "Yes", "Yes (copyleft)"],
        ["<b>LGPL v3</b>", "Yes", "Yes", "Partial"],
        ["<b>AGPL v3</b>", "Yes", "Yes", "Yes + network"],
        ["<b>CC-BY-SA 4.0</b>", "Yes", "Yes", "Yes"],
        ["<b>CC-BY-NC 4.0</b>", "<b>No</b>", "Yes", "No"],
        ["<b>CC-BY-ND 4.0</b>", "Yes", "<b>No</b>", "&mdash;"],
        ["<b>ForgeSlicer Standard</b>", "Yes (digital only)", "Yes", "No"],
    ], col_widths=[2.0 * inch, 1.5 * inch, 1.5 * inch, 1.5 * inch]))

    add(callout(
        "<b>If you don't care:</b> stick with the default <b>CC-BY 4.0</b>. "
        "Anyone can use your design for any purpose as long as they "
        "credit you. Anything more restrictive (NC, ND) reduces remix "
        "uptake significantly &mdash; community data shows ~70% fewer "
        "remixes for NC-licensed designs."))

    add(Paragraph(
        "Every gallery card shows a license chip you can click to read "
        "the full plain-English summary. The full legal text is "
        "available at <font face='Courier'>creativecommons.org</font> "
        "/ <font face='Courier'>opensource.org</font>.",
        styles["BODY"]))

    # ===================== Section 5 — Remixing ===================== #
    add(Paragraph("5. Remixing &mdash; building on others' work", styles["H2"]))
    add(Paragraph(
        "Every public design has a <b>Remix</b> button on its gallery "
        "card. Click it to load the original editable project into "
        "your workspace &mdash; primitives, modifiers, groups, and "
        "all.", styles["BODY"]))

    add(Paragraph("Remix attribution", styles["H3"]))
    add(Paragraph(
        "When you publish a remix, ForgeSlicer auto-fills a "
        "<i>'Remixed from …'</i> line in your description, linking to "
        "the original card. You can edit or delete it &mdash; but most "
        "licenses (especially CC-BY) <b>require</b> you to keep the "
        "attribution. Don't strip it without permission.",
        styles["BODY"]))

    add(Paragraph("Resize to my bed", styles["H3"]))
    add(Paragraph(
        "If the original was designed for a 300&times;300 printer and "
        "yours is 220&times;220, click <b>Resize to my bed</b> on the "
        "card before remixing. The component is uniformly scaled so "
        "its bounding box fits inside your active printer profile "
        "with a 5 mm margin.", styles["BODY"]))

    # ===================== Section 6 — Filtering & Search ===================== #
    add(PageBreak())
    add(Paragraph("6. Finding things in the gallery", styles["H2"]))
    add(Paragraph(
        "The Gallery has four filter controls plus full-text search:",
        styles["BODY"]))
    add(keyed_table([
        ["Filter", "Filters by"],
        ["<b>Category</b>",
         "Tools / Toys / Tabletop / Lighting / Storage / Functional / "
         "Decorative / Misc"],
        ["<b>Material</b>",
         "PLA / PETG / ABS / TPU / PA-CF (publisher's suggested hint)"],
        ["<b>License</b>",
         "Permissive (CC0, CC-BY, MIT, Apache, ForgeSlicer Standard) "
         "or Copyleft (GPL/LGPL/AGPL/SA) or Restricted (NC/ND)"],
        ["<b>Public / Mine</b>",
         "Only available when signed in. <b>Mine</b> includes your "
         "private items &mdash; they show a small lock badge."],
        ["<b>Search box</b>",
         "Searches name, description, and tag text. Min. 2 chars."],
    ], col_widths=[1.4 * inch, 5.2 * inch]))

    add(Paragraph("Author profile pages", styles["H3"]))
    add(Paragraph(
        "Click any <i>'by …'</i> author name on a card to visit their "
        "public profile (<font face='Courier'>/u/&lt;userId&gt;</font>). "
        "You'll see everything they've chosen to share &mdash; avatar, "
        "location, contact link &mdash; plus their full grid of public "
        "designs and components.", styles["BODY"]))

    # ===================== Section 7 — Troubleshooting ===================== #
    add(Paragraph("7. Troubleshooting", styles["H2"]))
    add(keyed_table([
        ["Symptom", "Likely cause", "Fix"],
        ["Publish button greyed out",
         "You're signed out, or scene is empty.",
         "Sign in (top-right). Add at least one part before publishing."],
        ["Thumbnail is dark / wrong angle",
         "Captured before you framed the part.",
         "Move/rotate the viewport, then re-capture from the publish "
         "modal's camera icon."],
        ["Card shows 'private' lock but I want it public",
         "Privacy toggle was on at publish time.",
         "Edit the card &rarr; flip the toggle &mdash; no need to re-upload."],
        ["Remix loads as a flat mesh, can't edit primitives",
         "Original was published without the editable "
         "<font face='Courier'>.forge.json</font> (rare &mdash; legacy items).",
         "You'll have to slice or rebuild from the STL; ask the author to "
         "republish with the source."],
        ["'Resize to my bed' button missing",
         "No active printer profile selected.",
         "Right panel &rarr; Printer &rarr; pick a profile."],
    ], col_widths=[2.0 * inch, 2.4 * inch, 2.3 * inch]))

    # ===================== Section 8 — Quick reference ===================== #
    add(Paragraph("8. Quick reference", styles["H2"]))
    add(Paragraph(
        "<b>Toolbar buttons:</b> <i>Share Design</i> (designs) and "
        "<i>Component</i> (reusable parts).<br/>"
        "<b>Gallery URL:</b> "
        "<font face='Courier'>/gallery</font> &mdash; sharable, "
        "anonymously browsable.<br/>"
        "<b>Component endpoint:</b> "
        "<font face='Courier'>POST /api/components</font> with "
        "<font face='Courier'>{name, description, thumbnail_base64, "
        "bbox_mm…}</font>.<br/>"
        "<b>Source:</b> "
        "<font face='Courier'>frontend/src/pages/Gallery.jsx</font> "
        "renders the grid; "
        "<font face='Courier'>frontend/src/components/ShareDialog.jsx</font> "
        "is the publish flow; backend lives at "
        "<font face='Courier'>backend/routes/gallery.py</font>.<br/>"
        "<b>Voice triggers:</b> <i>'Open share dialog'</i> / <i>'Save "
        "as component'</i>.",
        styles["BODY"]))

    flow.extend(closing_block())
    chrome = make_chrome_fn(subtitle="Gallery + Sharing Tutorial")
    doc.build(flow, onFirstPage=chrome, onLaterPages=chrome)
    print(f"PDF written: {doc.filename}")


if __name__ == "__main__":
    build()

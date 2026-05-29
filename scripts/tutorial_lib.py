"""Shared chrome + styles for ForgeSlicer tutorial PDFs.

Every tutorial script in this directory imports from here so the PDFs
share a single brand look (orange header band, slate-900 colour scheme,
footer with page numbers) without duplicating 100+ lines of boilerplate.

The tutorial scripts are thin authoring files — they import `make_doc`,
build a list of Platypus flowables, and hand it back to the lib for
final rendering. See `build_texture_tutorial.py` for the canonical
example.

Public API:
  - PALETTE: brand colours (ORANGE, DARK, INK, MUTED, LIGHT, RULE)
  - styles: dict of ParagraphStyle (H1, H2, H3, BODY, CAPTION, CALLOUT,
            CODE, SUBTITLE, FOOTER)
  - make_doc(out_path, title, subject) → SimpleDocTemplate
  - page_chrome(canvas, doc, *, subtitle, version): footer + header band
  - cover_block(title, subtitle, version) → list[Flowable]
  - keyed_table(rows, col_widths) → Table (orange header, zebra rows)
  - callout(text) → Paragraph
  - regenerate_thumbs(): re-run render_texture_thumbs.py for PDFs that
    embed those images.

Adding a new tutorial PDF
-------------------------
1. Create `build_<topic>_tutorial.py` next to this file.
2. Import what you need: `from tutorial_lib import make_doc, styles, ...`
3. Build the flowables list.
4. Call `doc.build(flow, onFirstPage=page_chrome_fn, onLaterPages=page_chrome_fn)`
   where `page_chrome_fn = lambda c, d: page_chrome(c, d, subtitle="...", version="v1.0")`
5. Update `frontend/public/docs/README.md` and the Help mega-menu.
"""
from __future__ import annotations
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Callable, Iterable

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)
from reportlab.pdfgen import canvas as canvas_mod

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "frontend" / "public" / "docs"
DOCS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------- palette
ORANGE = colors.HexColor("#f59e0b")
DARK   = colors.HexColor("#0f172a")
INK    = colors.HexColor("#1e293b")
MUTED  = colors.HexColor("#475569")
LIGHT  = colors.HexColor("#f1f5f9")
RULE   = colors.HexColor("#cbd5e1")
AMBER_BG = colors.HexColor("#fef3c7")

PALETTE = {
    "ORANGE": ORANGE, "DARK": DARK, "INK": INK,
    "MUTED": MUTED, "LIGHT": LIGHT, "RULE": RULE, "AMBER_BG": AMBER_BG,
}

# ---------------------------------------------------------------- styles
_base = getSampleStyleSheet()
styles = {
    "H1": ParagraphStyle("H1", parent=_base["Heading1"], fontName="Helvetica-Bold",
                         fontSize=22, leading=27, textColor=DARK,
                         spaceBefore=0, spaceAfter=6),
    "H2": ParagraphStyle("H2", parent=_base["Heading2"], fontName="Helvetica-Bold",
                         fontSize=15, leading=18, textColor=DARK,
                         spaceBefore=14, spaceAfter=6),
    "H3": ParagraphStyle("H3", parent=_base["Heading3"], fontName="Helvetica-Bold",
                         fontSize=11.5, leading=14, textColor=ORANGE,
                         spaceBefore=10, spaceAfter=4),
    "BODY": ParagraphStyle("Body", parent=_base["BodyText"], fontName="Helvetica",
                           fontSize=10, leading=14, textColor=INK,
                           alignment=TA_JUSTIFY, spaceAfter=6),
    "CAPTION": ParagraphStyle("Caption", parent=_base["BodyText"], fontName="Helvetica",
                              fontSize=8.5, leading=11, textColor=MUTED,
                              alignment=TA_CENTER, spaceBefore=2, spaceAfter=8),
    "CALLOUT": ParagraphStyle("Callout", parent=_base["BodyText"], fontName="Helvetica",
                              fontSize=9.5, leading=13, textColor=DARK,
                              backColor=AMBER_BG, borderColor=ORANGE,
                              borderWidth=0.5, borderPadding=8,
                              leftIndent=0, rightIndent=0,
                              spaceBefore=4, spaceAfter=10, alignment=TA_LEFT),
    "CODE": ParagraphStyle("Code", parent=_base["BodyText"], fontName="Courier",
                           fontSize=9, leading=12, backColor=LIGHT,
                           textColor=DARK, borderColor=RULE, borderWidth=0.5,
                           borderPadding=6, leftIndent=0, rightIndent=0,
                           spaceAfter=8, alignment=TA_LEFT),
    "SUBTITLE": ParagraphStyle("Subtitle", parent=_base["BodyText"], fontName="Helvetica",
                               fontSize=12, leading=16, textColor=MUTED,
                               alignment=TA_LEFT),
    "FOOTER": ParagraphStyle("Footer", parent=_base["BodyText"], fontName="Helvetica",
                             fontSize=9, leading=12, textColor=MUTED,
                             alignment=TA_CENTER),
}


# ---------------------------------------------------------------- chrome
def page_chrome(canv: canvas_mod.Canvas, doc, *, subtitle: str, version: str = "v1.0"):
    """Draws the orange band + footer on every page. Pass via a lambda so
    the tutorial title + subtitle are baked into the closure."""
    canv.saveState()
    # Top band
    canv.setFillColor(ORANGE)
    canv.rect(0, LETTER[1] - 18, LETTER[0], 18, stroke=0, fill=1)
    canv.setFillColor(colors.white)
    canv.setFont("Helvetica-Bold", 9)
    canv.drawString(40, LETTER[1] - 13, "ForgeSlicer — " + subtitle)
    canv.drawRightString(LETTER[0] - 40, LETTER[1] - 13, "forgeslicer.com")
    # Footer
    canv.setFillColor(MUTED)
    canv.setFont("Helvetica", 8)
    canv.drawString(40, 24, f"{version} · {datetime.now():%Y-%m-%d}")
    canv.drawCentredString(LETTER[0] / 2, 24, subtitle)
    canv.drawRightString(LETTER[0] - 40, 24, f"page {doc.page}")
    canv.setStrokeColor(RULE)
    canv.setLineWidth(0.5)
    canv.line(40, 36, LETTER[0] - 40, 36)
    canv.restoreState()


def make_chrome_fn(subtitle: str, version: str = "v1.0") -> Callable:
    """Returns a (canvas, doc) → None callable suitable for `onFirstPage`
    / `onLaterPages` arguments. Closes over the per-PDF subtitle/version."""
    def _draw(canv, doc):
        page_chrome(canv, doc, subtitle=subtitle, version=version)
    return _draw


# ---------------------------------------------------------------- docs
def make_doc(filename: str, title: str, subject: str) -> SimpleDocTemplate:
    """Build a `SimpleDocTemplate` pre-configured with our margins, metadata,
    and brand-consistent page-template defaults. The caller writes flowables
    and calls `.build(flow, onFirstPage=..., onLaterPages=...)`."""
    return SimpleDocTemplate(
        str(DOCS_DIR / filename), pagesize=LETTER,
        leftMargin=40, rightMargin=40,
        topMargin=44, bottomMargin=44,
        title=title, author="ForgeSlicer",
        subject=subject, creator=f"ForgeSlicer {Path(__file__).name}",
    )


# ---------------------------------------------------------------- helpers
def cover_block(title: str, subtitle: str) -> list:
    """Standard cover header — title in H1, subtitle in muted prose, brand
    rule below. Use at the very top of every tutorial's flowable list."""
    return [
        Spacer(1, 0.6 * inch),
        Paragraph(title, styles["H1"]),
        Spacer(1, 6),
        Paragraph(subtitle, styles["SUBTITLE"]),
        Spacer(1, 18),
        HRFlowable(width="100%", thickness=2, color=ORANGE),
        Spacer(1, 18),
    ]


def closing_block() -> list:
    """Standard footer block — orange rule + regeneration hint."""
    return [
        Spacer(1, 18),
        HRFlowable(width="100%", thickness=2, color=ORANGE),
        Spacer(1, 8),
        Paragraph(
            f"<i>Tutorial generated {datetime.now():%B %d, %Y} from ForgeSlicer "
            f"source. Run the corresponding "
            f"<font face='Courier'>scripts/build_*_tutorial.py</font> "
            f"to regenerate after future updates.</i>",
            styles["FOOTER"],
        ),
    ]


def keyed_table(rows: list[list[str]], col_widths: list[float]) -> Table:
    """Build an orange-header / zebra-row table the same way every tutorial
    table does. `rows[0]` is the header row. Strings inside rows may use
    inline ReportLab XML (bold, italic, font face) — they're auto-wrapped
    in BODY-style Paragraphs so they render as flowing prose."""
    body_style = ParagraphStyle("kt_body", parent=styles["BODY"],
                                fontSize=9, leading=12, alignment=TA_LEFT,
                                spaceAfter=0)
    header_style = ParagraphStyle("kt_header", parent=body_style,
                                  fontName="Helvetica-Bold",
                                  textColor=colors.white, alignment=TA_LEFT)
    flowable_rows = [
        [Paragraph(c, header_style) for c in rows[0]]
    ]
    for r in rows[1:]:
        flowable_rows.append([
            Paragraph(c, body_style) for c in r
        ])
    t = Table(flowable_rows, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ORANGE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
    ]))
    return t


def callout(text: str):
    return Paragraph(text, styles["CALLOUT"])


def regenerate_thumbs():
    """Re-render texture pattern thumbnails (needed only by the texture
    tutorial). Safe to call from other scripts — does nothing if the
    PIL renderer is missing."""
    gen = Path(__file__).resolve().parent / "render_texture_thumbs.py"
    if gen.exists():
        subprocess.run(["python3", str(gen)], check=True)

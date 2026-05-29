"""Generate the ForgeSlicer Voice Commands tutorial PDF.

Run:  python3 scripts/build_voice_tutorial.py
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
        "ForgeSlicer-Voice-Tutorial.pdf",
        title="ForgeSlicer Voice Commands Tutorial",
        subject="Hands-free CAD: how to drive ForgeSlicer entirely with your voice.",
    )
    flow = []
    add = flow.append

    # ===================== Cover ===================== #
    flow.extend(cover_block(
        "Voice Commands Tutorial",
        "Drive every primitive, transform, boolean, and export with natural speech. "
        "No syntax to memorise — the LLM understands you.",
    ))
    add(callout(
        "Voice is the fastest way to model in ForgeSlicer once you've used "
        "it for an hour. Most users hit a 3&times; productivity bump over "
        "menu-clicking within their first week."))

    # ===================== Section 1 — How it works ===================== #
    add(PageBreak())
    add(Paragraph("1. How voice control works", styles["H2"]))
    add(Paragraph(
        "ForgeSlicer captures audio with your browser's microphone, sends "
        "it to <b>OpenAI Whisper-1</b> for transcription, then routes the "
        "resulting text through <b>GPT-5.2</b> to extract a structured "
        "intent (action + parameters). The intent runs against the same "
        "scene actions the toolbar buttons use, so anything you can click "
        "you can say.", styles["BODY"]))

    add(Paragraph("Privacy &amp; data flow", styles["H3"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "Audio is streamed to OpenAI only while the mic button shows "
            "<b>Listening</b>. Nothing is recorded otherwise.",
            styles["BODY"])),
        ListItem(Paragraph(
            "Transcripts are NOT stored server-side. The browser keeps the "
            "last 20 in <font face='Courier'>localStorage</font> so you can "
            "scroll through your session, and clears them on sign-out.",
            styles["BODY"])),
        ListItem(Paragraph(
            "GPT-5.2 receives the transcript plus a short scene summary "
            "(currently-selected object IDs, modifier types, last action) "
            "so it can resolve pronouns like <i>'move it,'</i> <i>'flip "
            "that one.'</i>", styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    add(callout(
        "<b>Heads-up — Universal API Key:</b> Voice uses the Emergent "
        "Universal Key by default. If your account runs out of balance "
        "you'll see an amber banner; either top up at "
        "<font face='Courier'>Profile &rarr; Universal Key</font> or "
        "fall back to keyboard / mouse."))

    # ===================== Section 2 — The mic button ===================== #
    add(Paragraph("2. The mic button — three states", styles["H2"]))
    add(keyed_table([
        ["State", "Look", "Behaviour"],
        ["<b>Idle</b>", "Grey mic icon",
         "Click (or press <b>V</b>) to start listening."],
        ["<b>Listening</b>", "Pulsing orange mic",
         "Speak now. Pause ~2&nbsp;s and your transcript appears at the "
         "top of the workspace."],
        ["<b>Processing</b>", "Spinner over the mic",
         "Whisper is transcribing and GPT is parsing. Usually &lt;1.5 s."],
        ["<b>Confirming</b>", "Transcript banner",
         "Say <b>'Run'</b> to execute, or speak again to replace."],
    ], col_widths=[1.0 * inch, 1.6 * inch, 4.0 * inch]))

    add(Paragraph(
        "The mic is push-to-talk by default — start listening, speak, "
        "pause to commit. Hands-free mode (always-listening) lives behind "
        "<font face='Courier'>Profile &rarr; Voice &rarr; Always on</font>.",
        styles["BODY"]))

    # ===================== Section 3 — Phrasing principles ===================== #
    add(PageBreak())
    add(Paragraph("3. Phrasing principles", styles["H2"]))
    add(Paragraph(
        "GPT understands synonyms and verbs in any tense, so feel free "
        "to speak naturally. The principles below are habits that "
        "consistently get accurate intent parsing.", styles["BODY"]))

    add(Paragraph("Be explicit about units when they matter", styles["H3"]))
    add(ListFlowable([
        ListItem(Paragraph(
            "&#x2713; <i>'Move it up ten millimeters'</i> &mdash; explicit.",
            styles["BODY"])),
        ListItem(Paragraph(
            "&#x2717; <i>'Move it up ten'</i> &mdash; ambiguous; the parser "
            "assumes mm but you might mean degrees on rotate.",
            styles["BODY"])),
    ], bulletType="bullet", bulletColor=PALETTE["ORANGE"], leftIndent=18))

    add(Paragraph("Use pronouns — they work", styles["H3"]))
    add(Paragraph(
        "ForgeSlicer feeds the LLM the currently-selected object IDs, so "
        "<i>'rotate it'</i>, <i>'make this taller'</i>, and <i>'delete that "
        "one'</i> all resolve to the active selection. Multi-select works "
        "too: select two parts, then <i>'subtract these'</i> runs CSG.",
        styles["BODY"]))

    add(Paragraph("Chain in one breath", styles["H3"]))
    add(Paragraph(
        "GPT parses compound commands when they're joined by 'and' or "
        "'then'. Example: <i>'add a cube, then move it up ten, then "
        "duplicate it twice.'</i> The parser splits this into three "
        "sequential intents and replays them in order.",
        styles["BODY"]))

    # ===================== Section 4 — Lexicon ===================== #
    add(PageBreak())
    add(Paragraph("4. Lexicon &mdash; what you can say", styles["H2"]))
    add(Paragraph(
        "The full searchable lexicon is in the in-app Help dialog "
        "(<font face='Courier'>?</font> &rarr; Voice Commands). Below "
        "is a quick reference grouped by category.", styles["BODY"]))

    add(Paragraph("Add objects", styles["H3"]))
    add(keyed_table([
        ["Say…", "What happens"],
        ["<i>'Add a cube'</i>", "Default positive cube (20&times;20&times;20 mm)."],
        ["<i>'Add a negative cylinder 5 mm wide'</i>",
         "Negative cylinder, diameter &asymp; 5 mm."],
        ["<i>'Drop a hex prism'</i>", "Cylinder with 6 sides."],
        ["<i>'Add a 10 by 20 by 5 cube'</i>", "Cube with explicit XYZ dims."],
    ], col_widths=[2.6 * inch, 4.0 * inch]))

    add(Paragraph("Move / Rotate / Scale", styles["H3"]))
    add(keyed_table([
        ["Say…", "What happens"],
        ["<i>'Move it up 10'</i>", "+10&nbsp;mm on Y."],
        ["<i>'Slide forward 3'</i>", "+3&nbsp;mm on Z (toward camera)."],
        ["<i>'Rotate 90 degrees on Z'</i>", "Rotates about Z by 90&deg;."],
        ["<i>'Tilt 15 on X'</i>", "Rotates 15&deg; about X."],
        ["<i>'Make it twice as tall'</i>", "Scales Y &times; 2."],
        ["<i>'Resize to 30 by 30 by 5'</i>", "Sets exact dimensions."],
        ["<i>'Position at 0 10 0'</i>", "Absolute coordinates."],
    ], col_widths=[2.6 * inch, 4.0 * inch]))

    add(Paragraph("Scene management", styles["H3"]))
    add(keyed_table([
        ["Say…", "What happens"],
        ["<i>'Drop to bed'</i>", "Snaps bottom to Y=0."],
        ["<i>'Delete it'</i>", "Removes current selection."],
        ["<i>'Duplicate and mirror on X'</i>",
         "Copy &amp; mirror so the new part lands flush."],
        ["<i>'Group these'</i>", "Wraps multi-selection in an Assembly."],
        ["<i>'Ungroup'</i>", "Breaks selection out of its group."],
        ["<i>'Select all'</i>", "Selects every object."],
        ["<i>'Undo / Redo'</i>", "Atomic history step."],
    ], col_widths=[2.6 * inch, 4.0 * inch]))

    add(Paragraph("Booleans &amp; modifiers", styles["H3"]))
    add(keyed_table([
        ["Say…", "What happens"],
        ["<i>'Subtract these two'</i>", "CSG A &minus; B on the two selected."],
        ["<i>'Union them'</i>", "CSG union."],
        ["<i>'Intersect'</i>", "CSG intersection."],
        ["<i>'Make this negative'</i>", "Flip modifier tag."],
    ], col_widths=[2.6 * inch, 4.0 * inch]))

    # ===================== Section 5 — AI Generate by voice ===================== #
    add(PageBreak())
    add(Paragraph("5. AI generation by voice", styles["H2"]))
    add(Paragraph(
        "Voice can fire the Meshy AI text-to-3D pipeline directly. There "
        "are two flavours — auto-submit (uses a credit immediately) and "
        "pre-fill (opens the dialog for review).", styles["BODY"]))

    add(keyed_table([
        ["Trigger phrase", "Behaviour"],
        ["<i>'Generate &lt;noun&gt; with AI'</i>",
         "Opens AI dialog, fills prompt, <b>auto-submits</b> &mdash; "
         "uses one credit."],
        ["<i>'AI a &lt;noun&gt;'</i>",
         "Same as above, terse form. Auto-submits."],
        ["<i>'Make me a &lt;noun&gt; with AI'</i>", "Auto-submits."],
        ["<i>'I want to make a &lt;noun&gt; with AI'</i>",
         "Pre-fills, <b>does NOT auto-submit</b> &mdash; click Generate "
         "yourself to spend the credit."],
        ["<i>'Open the AI generator'</i>",
         "Opens an empty dialog &mdash; no prompt, no credit used."],
    ], col_widths=[2.8 * inch, 3.8 * inch]))

    add(callout(
        "Auto-submit triggers cost one of your monthly credits (free tier: "
        "13/month). The pre-fill phrasing is your safety net &mdash; use "
        "it when you're not sure the prompt will produce what you want."))

    # ===================== Section 6 — Walkthrough ===================== #
    add(Paragraph("6. Walkthrough &mdash; a phone stand by voice only", styles["H2"]))
    add(Paragraph(
        "Goal: build a printable phone stand with a chamfered base and a "
        "negative groove for the phone, using only your voice.",
        styles["BODY"]))
    steps = [
        "Press <b>V</b>. Say <i>'Add a 70 by 50 by 8 cube'</i>. Pause. "
        "Say <i>'Run.'</i> A flat base appears.",
        "Say <i>'Chamfer the edges by 2 millimeters.'</i> The base gets "
        "lead-in bevels.",
        "Say <i>'Add a negative cube 70 by 8 by 30.'</i> A tall, thin "
        "negative slab appears.",
        "Say <i>'Rotate it 15 degrees on X, then move it back 8 mm, then "
        "up 5 mm.'</i> Three transforms chain into one slot for the phone.",
        "Say <i>'Group these.'</i> The stand becomes a single assembly.",
        "Say <i>'Export as STL.'</i> The browser downloads "
        "<font face='Courier'>scene.stl</font> &mdash; ready to slice.",
    ]
    add(ListFlowable([ListItem(Paragraph(s, styles["BODY"])) for s in steps],
                     bulletType="1", leftIndent=18))

    # ===================== Section 7 — Troubleshooting ===================== #
    add(Paragraph("7. Troubleshooting", styles["H2"]))
    add(keyed_table([
        ["Symptom", "Likely cause", "Fix"],
        ["Mic button does nothing on click",
         "Browser blocked microphone permission.",
         "Click the camera/mic icon in the address bar &rarr; Allow."],
        ["Transcript is garbled / wrong language",
         "Whisper auto-detects language; ambient noise or accents trip it.",
         "Speak slightly slower; move away from fans; English-only "
         "phrasing currently has the best accuracy."],
        ["'I don't understand' banner",
         "GPT didn't extract a valid intent.",
         "Rephrase using a verb from the lexicon. Avoid filler words "
         "(<i>'um'</i>, <i>'kind of'</i>)."],
        ["Pronoun didn't resolve",
         "Nothing was selected before the command.",
         "Select first (click in scene or outliner), then say the command."],
        ["Amber 'no credit' banner",
         "Universal Key balance depleted.",
         "Top up at <font face='Courier'>Profile &rarr; Universal Key</font>."],
    ], col_widths=[2.0 * inch, 2.4 * inch, 2.3 * inch]))

    # ===================== Section 8 — Quick reference ===================== #
    add(Paragraph("8. Quick reference", styles["H2"]))
    add(Paragraph(
        "<b>Shortcut:</b> <b>V</b> &mdash; toggle mic on/off.<br/>"
        "<b>Cancel:</b> Esc while listening discards the current "
        "transcript without executing.<br/>"
        "<b>Help dialog:</b> <font face='Courier'>?</font> &rarr; Voice "
        "Commands &mdash; full lexicon with a <i>Try ▶</i> button next to "
        "every phrase so you can fire commands by click while learning.<br/>"
        "<b>Source files:</b> "
        "<font face='Courier'>frontend/src/lib/voice/</font> &mdash; the "
        "Whisper client, GPT prompt template, and intent &rarr; action "
        "router all live here.",
        styles["BODY"]))

    flow.extend(closing_block())
    chrome = make_chrome_fn(subtitle="Voice Commands Tutorial")
    doc.build(flow, onFirstPage=chrome, onLaterPages=chrome)
    print(f"PDF written: {doc.filename}")


if __name__ == "__main__":
    build()

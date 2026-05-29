# Public docs

PDFs and other static documents served at `/docs/<filename>` by the
frontend.

## Contents
- `ForgeSlicer-Getting-Started.pdf` — 4-page overview, your first part end-to-end.
- `ForgeSlicer-Texture-Tutorial.pdf` — 10-page deep-dive on the Texture Library.
- `ForgeSlicer-Hardware-Tutorial.pdf` — Fasteners (ISO M3–M12 + UNC/UNF #4-40 to 1/2-13).
- `ForgeSlicer-Sweep-Tutorial.pdf` — Sketch + sweep workflow.

All four are linked from the **Help mega-menu** in the workspace top toolbar
(testid `help-btn` → `help-mega-menu`).

## Regenerating

```bash
cd /app && python3 scripts/build_all_tutorials.py
```

Or rebuild a single PDF:

```bash
python3 scripts/build_texture_tutorial.py
python3 scripts/build_hardware_tutorial.py
python3 scripts/build_sweep_tutorial.py
python3 scripts/build_getting_started_tutorial.py
```

Shared chrome lives in `scripts/tutorial_lib.py` — change it once,
rebuild all PDFs, brand stays consistent.

## Adding a new tutorial

1. Create `build_<topic>_tutorial.py` next to the existing ones.
2. Import shared chrome: `from tutorial_lib import make_doc, styles, ...`
3. Build flowables, call `doc.build(...)`.
4. Add an entry to the TUTORIALS list in
   `frontend/src/components/toolbar/HelpMegaMenu.jsx`.
5. Re-run `scripts/build_all_tutorials.py`.


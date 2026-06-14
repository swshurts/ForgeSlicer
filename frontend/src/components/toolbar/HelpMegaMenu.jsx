// Help mega-menu — replaces the bare Help button with a dropdown that
// surfaces both the in-app HelpDialog AND the tutorial PDFs.
//
// Design notes
// ------------
// The PDF list lives in TUTORIALS below. To add a new tutorial later:
//   1. Drop the .pdf into frontend/public/docs/
//   2. Add an entry here with file / title / desc / minutes
//   3. The link auto-renders.
//
// The dropdown closes when the user clicks an item or anywhere
// outside the panel. Escape-key also dismisses.
//
// `onOpenInApp` is the existing in-app HelpDialog opener — preserved
// as the first item so the keyboard ? shortcut still has somewhere
// to land.
import React, { useEffect, useRef, useState } from "react";
import { CircleHelp, BookOpen, MessageCircle, ChevronRight, FileText, ExternalLink, Mic, Sparkles } from "lucide-react";
import axios from "axios";
import { API } from "../../lib/api";

// Tutorial catalog — single source of truth for the dropdown.
// Order is intentional: Getting Started first (broadest), then by topic to
// match the dialog labels. Exported so HelpDialog's Tutorials tab reuses it.
export const TUTORIALS = [
  {
    file: "ForgeSlicer-Getting-Started.pdf",
    title: "Getting Started",
    desc: "Workspace tour + your first part in 15 minutes. Read this first.",
    minutes: 10,
  },
  {
    file: "ForgeSlicer-Texture-Tutorial.pdf",
    title: "Texture Library",
    desc: "Nine printable patterns, cylinder wrap math, CSG recipes.",
    minutes: 20,
  },
  {
    file: "ForgeSlicer-Hardware-Tutorial.pdf",
    title: "Hardware Library",
    desc: "ISO M3–M12 + UNC/UNF #4-40 to 1/2-13 with bores & counterbores.",
    minutes: 15,
  },
  {
    file: "ForgeSlicer-Sweep-Tutorial.pdf",
    title: "Sweep + Sketch",
    desc: "Helix, arc, bezier, hand-drawn paths — curved geometry done right.",
    minutes: 25,
  },
  {
    file: "ForgeSlicer-Voice-Tutorial.pdf",
    title: "Voice Commands",
    desc: "Hands-free CAD via Whisper + GPT-5.2 — lexicon, phrasing, AI gen.",
    minutes: 15,
  },
  {
    file: "ForgeSlicer-Slicer-Tutorial.pdf",
    title: "Slicer + Compare Engines",
    desc: "Send to OrcaSlicer, run A/B engine compares, read every metric.",
    minutes: 18,
  },
  {
    file: "ForgeSlicer-Gallery-Tutorial.pdf",
    title: "Gallery + Sharing",
    desc: "Publish, remix, license your designs; build a component library.",
    minutes: 12,
  },
];

export default function HelpMegaMenu({ onOpenInApp }) {
  const [open, setOpen] = useState(false);
  // iter-101.3 — fetch the live voice-template catalogue when the menu
  // opens (lazily so the help button doesn't trigger a request on
  // every page load). Cached for the lifetime of the component.
  const [voiceTemplates, setVoiceTemplates] = useState(null);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open || voiceTemplates !== null) return;
    let cancelled = false;
    axios.get(`${API}/voice/templates`).then((r) => {
      if (!cancelled) setVoiceTemplates(r.data?.templates || []);
    }).catch(() => { if (!cancelled) setVoiceTemplates([]); });
    return () => { cancelled = true; };
  }, [open, voiceTemplates]);

  // Click-outside + Escape behaviour — bound only while the menu is
  // open so we don't intercept events globally.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        data-testid="help-btn"
        onClick={() => setOpen((v) => !v)}
        title="Help & Tutorials"
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-8 w-8 ml-1 rounded text-slate-400 hover:text-orange-300 hover:bg-slate-800 flex items-center justify-center"
      >
        <CircleHelp size={16} />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="help-mega-menu"
          className="absolute right-0 top-9 z-50 w-96 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden max-h-[80vh] overflow-y-auto"
        >
          {/* Voice templates catalogue */}
          <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 bg-slate-950 border-b border-slate-800 flex items-center gap-1.5">
            <Mic size={11} className="text-orange-400" />
            What voice can build
            <span className="ml-auto text-[9px] text-slate-600 normal-case tracking-normal">
              hold space → speak
            </span>
          </div>
          {voiceTemplates === null && (
            <div className="px-4 py-3 text-[11px] text-slate-500">Loading catalogue…</div>
          )}
          {voiceTemplates && voiceTemplates.length === 0 && (
            <div className="px-4 py-3 text-[11px] text-slate-500">No templates registered.</div>
          )}
          {voiceTemplates && voiceTemplates.map((t) => (
            <div
              key={t.id}
              data-testid={`help-voice-template-${t.id}`}
              className="px-4 py-2.5 border-b border-slate-800/60"
            >
              <div className="flex items-start gap-2">
                <Sparkles size={13} className="text-orange-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold text-slate-200">{t.label}</div>
                  <div className="text-[10px] text-slate-500 leading-snug mt-0.5">{t.description}</div>
                  {t.boards && (
                    <div className="text-[9.5px] text-slate-600 mt-1 font-mono leading-snug">
                      Boards: {t.boards.map((b) => b.label).join(" · ")}
                    </div>
                  )}
                  <div className="text-[9.5px] text-slate-600 mt-1">
                    Params:&nbsp;
                    <span className="font-mono text-slate-500">
                      {Object.keys(t.params || {}).slice(0, 6).join(", ")}
                      {Object.keys(t.params || {}).length > 6 ? ", …" : ""}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* In-app help section */}
          <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 bg-slate-950 border-y border-slate-800">
            In-app help
          </div>
          <button
            data-testid="help-menu-in-app"
            onClick={() => {
              setOpen(false);
              onOpenInApp && onOpenInApp();
            }}
            className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-800 text-slate-200"
          >
            <MessageCircle size={15} className="text-orange-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold">User Manual</div>
              <div className="text-[10px] text-slate-500 truncate">
                Quick reference, FAQ, contact form
              </div>
            </div>
            <ChevronRight size={13} className="text-slate-500" />
          </button>

          {/* Tutorial PDFs section */}
          <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-slate-500 bg-slate-950 border-y border-slate-800">
            Tutorial PDFs
            <span className="ml-2 text-[9px] text-slate-600 normal-case tracking-normal">
              (right-click → Save As to download)
            </span>
          </div>
          {TUTORIALS.map((t) => (
            <a
              key={t.file}
              data-testid={`help-menu-pdf-${t.file.replace(/\.pdf$/, "").toLowerCase()}`}
              href={`/docs/${t.file}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 hover:bg-slate-800 text-slate-200 border-b border-slate-800/60 last:border-b-0"
            >
              <div className="flex items-start gap-3">
                <FileText size={15} className="text-orange-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold flex items-center gap-1.5">
                    {t.title}
                    <ExternalLink size={10} className="text-slate-500" />
                  </div>
                  <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
                    {t.desc}
                  </div>
                </div>
                <div className="text-[9.5px] text-slate-500 shrink-0 mt-0.5 font-mono">
                  {t.minutes} min
                </div>
              </div>
            </a>
          ))}

          {/* Download-all callout */}
          <a
            data-testid="help-menu-download-all"
            href="/docs/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 bg-orange-500/10 hover:bg-orange-500/15 text-orange-300 text-[11.5px] font-semibold border-t border-orange-500/30"
          >
            <BookOpen size={13} className="inline mr-1.5 mb-0.5" />
            Browse all docs &amp; PDFs
          </a>
        </div>
      )}
    </div>
  );
}

// Voice command cheatsheet — a popover that lists supported phrases by
// category so users can discover what to say without rummaging the docs.
//
// Anchored under a button next to the Voice mode chevron. Opens on click,
// closes on outside-click / Esc / the explicit X. Categories collapse so
// power users can keep only the section they care about open.
//
// One source of truth: the COMMAND_GROUPS array below. To add a new
// command, edit the matching group — no other file change needed.

import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen, X, ChevronDown, ChevronRight,
  Box, Move3D, MousePointer, Combine, History,
  Copy as CopyIcon, Layers, Settings2, Download, Sparkles, Zap,
} from "lucide-react";

// Each group: { id, label, icon, hint, items: [{ say, does }] }
// "say" is mono-styled; "does" is the plain-English description.
const COMMAND_GROUPS = [
  {
    id: "primitives",
    label: "Add primitives",
    icon: Box,
    hint: "Cube, sphere, cone, cylinder, torus, helix, pipe, wedge — positive or negative.",
    items: [
      { say: "Add a cube", does: "Positive cube at the origin" },
      { say: "Add a 30 mm sphere", does: "Sphere sized to 30 mm" },
      { say: "Add a negative cylinder", does: "Subtractive cylinder (hole)" },
      { say: "Add a torus 50 by 8", does: "Torus, outer 50 mm, tube 8 mm" },
      { say: "Add a helix", does: "Default helical spring" },
    ],
  },
  {
    id: "transform",
    label: "Transform",
    icon: Move3D,
    hint: "Move, rotate, scale, resize and drop to bed. Operates on the current selection.",
    items: [
      { say: "Move X by 10",            does: "Shift selection 10 mm on X" },
      { say: "Move it up 5",            does: "Shift Z by +5 mm" },
      { say: "Rotate Z 90 degrees",     does: "Rotate around Z by 90°" },
      { say: "Scale by 2",              does: "Uniform 2× scale" },
      { say: "Resize to 40 by 40 by 20", does: "Set dimensions in mm" },
      { say: "Position at 100, 50, 0",  does: "Move to absolute coords" },
      { say: "Drop to bed",             does: "Sit selection on Z = 0" },
    ],
  },
  {
    id: "selection",
    label: "Selection & delete",
    icon: MousePointer,
    hint: "Pick what to act on, then operate.",
    items: [
      { say: "Select all",          does: "Selects every component" },
      { say: "Clear selection",     does: "Deselects everything" },
      { say: "Delete it",           does: "Removes selection" },
    ],
  },
  {
    id: "duplicate",
    label: "Duplicate & mirror",
    icon: CopyIcon,
    hint: "Clone selection, optionally mirroring on an axis.",
    items: [
      { say: "Duplicate",            does: "Clone selection in place" },
      { say: "Duplicate and mirror X", does: "Clone + mirror on X axis" },
      { say: "Duplicate and mirror Z", does: "Clone + mirror on Z axis" },
    ],
  },
  {
    id: "boolean",
    label: "Booleans",
    icon: Combine,
    hint: "Combines the last two parts (or the selection + last) via CSG.",
    items: [
      { say: "Subtract",   does: "B − A (negative cut)" },
      { say: "Union",      does: "A ∪ B (fuse together)" },
      { say: "Intersect",  does: "A ∩ B (keep overlap)" },
    ],
  },
  {
    id: "history",
    label: "Undo & redo",
    icon: History,
    hint: "Step backwards or forwards through scene edits.",
    items: [
      { say: "Undo",   does: "Reverts last change" },
      { say: "Redo",   does: "Re-applies undone change" },
    ],
  },
  {
    id: "group",
    label: "Group",
    icon: Layers,
    hint: "Treat several parts as one for transforms.",
    items: [
      { say: "Group",     does: "Bundle selection as an Assembly" },
      { say: "Ungroup",   does: "Split the selected group" },
    ],
  },
  {
    id: "modes",
    label: "Gizmo mode",
    icon: Settings2,
    hint: "Switch the on-screen transform gizmo.",
    items: [
      { say: "Translate mode", does: "Show move arrows" },
      { say: "Rotate mode",    does: "Show rotation rings" },
      { say: "Scale mode",     does: "Show scale handles" },
    ],
  },
  {
    id: "export",
    label: "Export",
    icon: Download,
    hint: "Save the current scene to disk.",
    items: [
      { say: "Export STL",         does: "Save merged STL" },
      { say: "Export 3MF",         does: "Save 3MF (per-part)" },
      { say: "Save project",       does: "Save .forge.json" },
    ],
  },
  {
    id: "ai",
    label: "AI mesh generation",
    icon: Sparkles,
    hint: "Routes to the AI Generate dialog. Mention 'generate' to auto-submit; otherwise it just pre-fills.",
    items: [
      { say: "Generate a small dragon",    does: "Auto-submits to Meshy AI" },
      { say: "I want to make a chess piece with AI", does: "Pre-fills the dialog without sending" },
    ],
  },
  {
    id: "gomode",
    label: "Go-mode controls",
    icon: Zap,
    hint: "Said as the entire utterance, these phrases manage the Go-mode loop without running a command.",
    items: [
      { say: "Wait",          does: "Pause Go mode (mic stays open for 'resume')" },
      { say: "Hold on",       does: "Same — pauses Go mode" },
      { say: "Give me a sec", does: "Same — pauses Go mode" },
      { say: "Resume",        does: "Continue from pause" },
      { say: "Continue",      does: "Same — resumes from pause" },
      { say: "Ready",         does: "Same — resumes from pause" },
      { say: "Stop",          does: "Ends Go mode" },
      { say: "Done",          does: "Ends Go mode" },
      { say: "Exit",          does: "Ends Go mode" },
    ],
  },
];

const COLLAPSE_KEY = "forgeslicer.voicePalette.collapsed";
const HINT_SEEN_KEY = "forgeslicer.voicePalette.hintSeen";

/** Read the persisted "which groups are collapsed" set. Defaults to all
 * collapsed except the first two (so the palette opens at a useful size
 * even on small viewports). */
function readCollapsed() {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    if (!raw) {
      // Default expand state — primitives + transform open, rest closed.
      return new Set(COMMAND_GROUPS.slice(2).map((g) => g.id));
    }
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(COMMAND_GROUPS.slice(2).map((g) => g.id));
  }
}
function writeCollapsed(set) {
  try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(set))); }
  catch { /* noop */ }
}

export function shouldShowPaletteHint() {
  try { return window.localStorage.getItem(HINT_SEEN_KEY) !== "1"; }
  catch { return false; }
}
export function markPaletteHintSeen() {
  try { window.localStorage.setItem(HINT_SEEN_KEY, "1"); } catch { /* noop */ }
}

export default function VoiceCommandPalette() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const wrapRef = useRef(null);

  const toggleGroup = (id) => {
    setCollapsedState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeCollapsed(next);
      return next;
    });
  };

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      if (next) markPaletteHintSeen();
      return next;
    });
  };

  // Click-outside + Esc close. Mouse-down rather than click so picking
  // a category header inside the popover doesn't immediately close it
  // via the same gesture's bubble.
  useEffect(() => {
    if (!open) return;
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
    <div ref={wrapRef} className="relative inline-flex items-center" data-testid="voice-palette-wrap">
      <button
        data-testid="voice-palette-btn"
        onClick={toggleOpen}
        title="Voice command cheatsheet"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`h-8 w-7 ml-1 rounded border flex items-center justify-center transition-colors ${
          open
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
        }`}
      >
        <BookOpen size={13} />
      </button>

      {open && (
        <div
          data-testid="voice-palette"
          role="dialog"
          aria-label="Voice command cheatsheet"
          className="absolute top-full mt-1 left-0 z-[160] w-[360px] max-h-[70vh] bg-slate-900 border border-slate-700 rounded-md shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex-shrink-0 h-9 px-3 flex items-center justify-between bg-slate-950/60 border-b border-slate-800">
            <div className="flex items-center gap-1.5">
              <BookOpen size={12} className="text-orange-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">
                Voice Commands
              </span>
            </div>
            <button
              data-testid="voice-palette-close"
              onClick={() => setOpen(false)}
              className="h-6 w-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800"
              title="Hide cheatsheet (Esc)"
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            <p className="px-3 pt-2 pb-1 text-[10px] text-slate-400 leading-snug">
              Click a category to expand. Speak naturally — phrases below are examples, not the only allowed wording.
            </p>
            {COMMAND_GROUPS.map((g) => {
              const isCollapsed = collapsed.has(g.id);
              const Icon = g.icon;
              return (
                <div key={g.id} className="border-b border-slate-800/60 last:border-b-0">
                  <button
                    data-testid={`voice-palette-group-${g.id}`}
                    onClick={() => toggleGroup(g.id)}
                    aria-expanded={!isCollapsed}
                    className="w-full px-3 py-1.5 flex items-center gap-1.5 hover:bg-slate-800/40 transition-colors text-left"
                  >
                    {isCollapsed
                      ? <ChevronRight size={12} className="text-slate-500 flex-shrink-0" />
                      : <ChevronDown size={12} className="text-orange-400 flex-shrink-0" />}
                    <Icon size={11} className={isCollapsed ? "text-slate-500" : "text-orange-300"} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">
                      {g.label}
                    </span>
                    <span className="ml-auto text-[9px] text-slate-500 font-mono">{g.items.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="px-3 pb-2 space-y-1">
                      {g.hint && (
                        <p className="text-[10px] text-slate-500 leading-snug mb-1.5 italic">{g.hint}</p>
                      )}
                      {g.items.map((it, idx) => (
                        <div
                          key={idx}
                          data-testid={`voice-palette-item-${g.id}-${idx}`}
                          className="bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5"
                        >
                          <div className="text-[11px] font-mono text-orange-300 leading-snug">
                            &ldquo;{it.say}&rdquo;
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                            {it.does}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex-shrink-0 px-3 py-1.5 border-t border-slate-800 bg-slate-950/60 text-[10px] text-slate-500 leading-snug">
            Don&apos;t see what you need? Speak it naturally — the LLM parser handles synonyms and free-form phrasing.
          </div>
        </div>
      )}
    </div>
  );
}

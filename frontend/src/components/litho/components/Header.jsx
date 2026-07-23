// iter-128 — Lithophane Studio in-app header.
// iter-151.31 — Removed the internal "← Workspace" Link: LithoStudio
// is now ALWAYS mounted inside the AI Studio modal (LeftPanel owns
// the outer "← Back" chip), so this duplicated the escape hatch and
// — worse — the Link pointed at "/workspace" which is where we
// already are, so clicking it was a visible no-op.
//
// LithoForge's original Header contained brand, sign-in, pricing links,
// and mode toggle. Now that this workflow lives inside ForgeSlicer, the
// header only needs to identify the page + hand back a "Generate" CTA.
// The global UserMenu / theme switcher stay in the app-level chrome
// (they're not mounted here). Kept intentionally slim so it doesn't
// compete with ForgeSlicer's TopToolbar.
import React from "react";
import { Sparkles, Loader2, Wand2 } from "lucide-react";

export function Header({
  jobsBadge = null,
  onGenerate,
  canGenerate = true,
  generating = false,
  jobId = null,          // eslint-disable-line no-unused-vars
  baseMinLayers = 2,     // eslint-disable-line no-unused-vars
}) {
  return (
    <header
      data-testid="litho-studio-header"
      className="h-14 border-b border-slate-800 bg-slate-950/80 backdrop-blur flex items-center px-4 gap-3 flex-shrink-0"
    >
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-orange-400" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold text-white">Lithophane Studio</div>
          <div className="text-[10px] uppercase tracking-widest text-orange-400 -mt-0.5">
            Photo → CMYKW → Print
          </div>
        </div>
      </div>
      <div className="flex-1" />
      {jobsBadge}
      {/* Primary Generate CTA — the whole studio revolves around this button. */}
      <button
        onClick={() => onGenerate?.()}
        disabled={!canGenerate || generating}
        data-testid="litho-generate-btn"
        className="h-9 px-4 rounded bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold flex items-center gap-1.5 shadow disabled:opacity-40 disabled:cursor-not-allowed"
        title={
          !canGenerate
            ? "Upload a photograph and pick at least 2 filaments first"
            : generating
            ? "Optimizing…"
            : "Optimize the current image + palette into a printable lithophane"
        }
      >
        {generating ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Optimizing…
          </>
        ) : (
          <>
            <Wand2 size={14} /> Generate lithophane
          </>
        )}
      </button>
    </header>
  );
}

export default Header;

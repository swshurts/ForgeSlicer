// iter-128 — Lithophane Studio in-app header.
//
// LithoForge's original Header contained brand, sign-in, pricing links,
// and mode toggle. Now that this workflow lives inside ForgeSlicer, the
// header only needs to identify the page + provide a "back to workspace"
// escape hatch. The global UserMenu / theme switcher stay in the app-
// level chrome (they're not mounted here). Kept intentionally slim so
// it doesn't compete with ForgeSlicer's TopToolbar.
import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Sparkles, Loader2, Wand2 } from "lucide-react";

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
      <Link
        to="/workspace"
        data-testid="litho-back-to-workspace"
        className="h-8 px-2.5 text-xs text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 rounded flex items-center gap-1.5 border border-slate-800"
        title="Back to ForgeSlicer workspace"
      >
        <ArrowLeft size={13} /> Workspace
      </Link>
      <div className="flex items-center gap-2 ml-1">
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

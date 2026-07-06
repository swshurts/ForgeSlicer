import React from "react";
import { Link } from "react-router-dom";
import { Store, ArrowLeft } from "lucide-react";
// iter-130 — LithoForge merged. UserMenu is ForgeSlicer's global one
// (mounted in the app-level chrome), so the marketplace header stays
// slim and doesn't try to render its own sign-in affordance.

/**
 * Shared header for the public marketplace pages.
 * Mirrors the app's brutalist mono aesthetic but with a different
 * primary action ("back to studio" instead of "generate").
 */
export const MarketplaceHeader = ({ subtitle }) => (
  <header
    className="border-b border-zinc-800 bg-zinc-950 flex items-center justify-between px-5 h-14 z-30"
    data-testid="marketplace-header"
  >
    <div className="flex items-center gap-4">
      <Link to="/workspace" className="flex items-center gap-2.5 group">
        <div className="relative w-7 h-7 flex items-center justify-center">
          <div className="absolute inset-0 border border-zinc-700 group-hover:border-zinc-400 transition-colors" />
          <div className="absolute top-0 left-0 w-2 h-2 bg-cmyk-c" />
          <div className="absolute top-0 right-0 w-2 h-2 bg-cmyk-m" />
          <div className="absolute bottom-0 left-0 w-2 h-2 bg-cmyk-y" />
          <div className="absolute bottom-0 right-0 w-2 h-2 bg-cmyk-w border-l border-t border-zinc-700" />
        </div>
        <div>
          <div className="font-display text-base font-black tracking-tighter leading-none">
            LITHOPHANE
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500 leading-none mt-0.5 flex items-center gap-1.5">
            <Store className="w-2.5 h-2.5" />
            Marketplace {subtitle ? `· ${subtitle}` : ""}
          </div>
        </div>
      </Link>
    </div>
    <div className="flex items-center gap-3">
      <Link
        to="/litho"
        data-testid="back-to-studio"
        className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700 hover:border-zinc-400 hover:bg-zinc-900 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-200 transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to studio
      </Link>
    </div>
  </header>
);

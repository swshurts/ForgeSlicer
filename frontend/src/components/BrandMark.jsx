// Iter-90 — shared brand mark for every page header.
//
// Pulls the Celtic-knot anvil from /public so we have one source of
// truth. Variants:
//   - "wordmark" (default): logo + "ForgeSlicer" + "CAD + SLICE" cap
//   - "compact" : logo only, no text — for tight toolbars
//
// Wrap in a <Link to="/"> at the call site if you want it clickable;
// this component is purely visual so it can be reused inside <button>s
// or other links without nesting <a> tags.

import React from "react";

export function BrandMark({ variant = "wordmark", size = 28, className = "" }) {
  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <img
        src="/forgeslicer-logo.webp"
        alt="ForgeSlicer"
        width={size}
        height={size}
        className="rounded shadow-lg shadow-orange-900/30 flex-shrink-0"
        data-testid="brand-mark-logo"
      />
      {variant === "wordmark" && (
        <div className="leading-tight">
          <div className="text-[14px] font-bold tracking-tight text-white">ForgeSlicer</div>
          <div className="text-[9px] uppercase tracking-widest text-orange-400 -mt-0.5">CAD + Slice</div>
        </div>
      )}
    </div>
  );
}

export default BrandMark;

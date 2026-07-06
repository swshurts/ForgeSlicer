import React, { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

/**
 * Tiny "?" button with a click/tap-triggered popover. Designed to sit
 * next to section labels — anonymous and touch-friendly.
 */
export const HelpHint = ({ title, children, testId }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={`Help: ${title}`}
        data-testid={testId || "help-hint"}
        className="inline-flex items-center justify-center w-3.5 h-3.5 text-zinc-600 hover:text-zinc-200 transition-colors"
      >
        <HelpCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 w-[260px] bg-zinc-950 border border-zinc-700 p-3 shadow-xl"
          data-testid="help-hint-popover"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-100 mb-1.5">
            {title}
          </div>
          <div className="font-mono text-[10px] leading-relaxed text-zinc-400">
            {children}
          </div>
        </div>
      )}
    </span>
  );
};

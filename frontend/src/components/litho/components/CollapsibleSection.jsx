// iter-151.34 — Shared collapsible section header for LithoStudio's
// config and stats panels. Persists open/closed state to localStorage
// so returning users don't have to re-expand every session.

import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function CollapsibleSection({
  id,
  title,
  help,
  right,
  defaultOpen = true,
  headerClassName = "",
  children,
}) {
  const storageKey = `litho.section.${id}`;
  const [open, setOpen] = React.useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "0") return false;
      if (v === "1") return true;
    } catch { /* private mode */ }
    return defaultOpen;
  });
  React.useEffect(() => {
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch { /* no-op */ }
  }, [open, storageKey]);

  return (
    <div data-testid={`cfg-section-${id}`}>
      <div className={`flex items-center justify-between mb-3 ${headerClassName}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid={`cfg-section-${id}-toggle`}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500 hover:text-zinc-300 text-left"
        >
          <span className="shrink-0" aria-hidden="true">
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
          <span>{title}</span>
          {help}
        </button>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

export default CollapsibleSection;

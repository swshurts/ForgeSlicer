// Shared popover primitives — extracted from the ~1000-line monolithic
// ActionPopovers.jsx so each transform popover lives in its own file.
//
// Three things live here:
//   • `PopoverShell` — the anchored, scrollable, Escape-closeable card.
//   • `NumberField`  — the numeric input used by Position/Rotation/Scale.
//   • `EmptyMsg`     — the "Select an object first" placeholder.
//
// No behaviour change vs the inline copies in pre-1.14 ActionPopovers.
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function NumberField({ label, value, onChange, step = 1, suffix, testid, disabled }) {
  // Keep a string draft so the user can transiently type "" / "0" / "0.5"
  // without the field firing onChange on every keystroke (which used to
  // collapse the scale to 0 mid-edit and freeze the lock math). Commit on
  // Enter or blur.
  const [draft, setDraft] = React.useState(null);
  // Guard against double-commits when Enter is pressed: commit() runs
  // first, then `e.currentTarget.blur()` synchronously fires the input's
  // blur, which would call commit() AGAIN — but with the STALE draft
  // closure that still holds the typed value, because React hasn't
  // flushed setDraft(null) yet. For delta-based onChange handlers (like
  // multi-select rotation: delta = new - current) this manifested as a
  // doubled rotation (typing 45° rotated by 90°) and corrupted the
  // assembly because the orbit math ran twice.
  const justCommittedRef = React.useRef(false);
  const display = draft !== null ? draft : (Number.isFinite(value) ? String(value) : "");

  const commit = () => {
    if (justCommittedRef.current) { justCommittedRef.current = false; return; }
    if (draft === null) return;
    const v = parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(v)) onChange(v);
  };

  return (
    <label className="flex flex-col gap-1">
      {label !== "" && (
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      )}
      <div className="relative flex items-center">
        <input
          data-testid={testid}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={display}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              // Mark "just committed" so the synchronous blur fired by
              // e.currentTarget.blur() doesn't re-run commit with the
              // stale draft closure. See the explanation on
              // `justCommittedRef` above.
              justCommittedRef.current = true;
              e.currentTarget.blur();
            }
            if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); }
            if (e.key === "ArrowUp") { e.preventDefault(); onChange((Number.isFinite(value) ? value : 0) + step); }
            if (e.key === "ArrowDown") { e.preventDefault(); onChange((Number.isFinite(value) ? value : 0) - step); }
          }}
          className={`h-8 w-full bg-slate-950 rounded text-sm text-white px-2 pr-7 focus:ring-1 outline-none font-mono disabled:opacity-50 ${
            // While the user has an in-flight draft (typed but not yet
            // committed), tint the border amber so they know the value
            // shown ISN'T yet applied to the scene — avoids the classic
            // "I typed 45° and clicked Rotate again, where did my value go" frustration.
            draft !== null
              ? "border border-amber-400 focus:border-amber-400 focus:ring-amber-400"
              : "border border-slate-700 focus:border-orange-500 focus:ring-orange-500"
          }`}
        />
        {/* Tiny amber dot when a draft is unsaved — extra affordance
            next to the input so the state reads at-a-glance even when
            the border is too thin to notice. */}
        {draft !== null && (
          <span
            data-testid={testid ? `${testid}-draft-indicator` : undefined}
            title="Unsaved edit — press Enter to commit"
            className="absolute right-2 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"
            style={{ marginRight: suffix ? 14 : 0 }}
          />
        )}
        {suffix && <span className="absolute right-2 text-[10px] text-slate-500 font-mono">{suffix}</span>}
      </div>
    </label>
  );
}

export function PopoverShell({ title, icon: Icon, onClose, anchor, children, testid, width = 280 }) {
  const ref = useRef(null);

  // Only close on Esc or the explicit X. The previous outside-click handler
  // was removed because it interfered with the user switching between
  // scene-tree components while a popover stays open (which is the
  // expected behavior — the popover should refresh its values for the
  // newly selected object).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Position the popover under its anchor — and cap its height so the
  // primary action button never falls off-screen. On short viewports
  // (laptops below ~720px) the Slicer popover in particular has enough
  // fields that the Slice & Export GCODE button used to render below the
  // fold with no scroll, leading to "where did the button go?" reports.
  const [pos, setPos] = useState({ top: 56, left: 16, maxHeight: 600 });
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8)
    );
    const top = rect.bottom + 6;
    // 16px margin from the viewport bottom keeps the popover from sticking
    // to the edge and lets us scroll inside if content is taller than the
    // window allows.
    const maxHeight = Math.max(240, window.innerHeight - top - 16);
    setPos({ top, left, maxHeight });
  }, [anchor, width]);

  return (
    <div
      ref={ref}
      data-testid={testid}
      className="fixed z-[120] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col"
      style={{ top: pos.top, left: pos.left, width, maxHeight: pos.maxHeight }}
    >
      <div className="h-9 px-3 flex items-center justify-between bg-slate-900/80 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={13} className="text-orange-400" />}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">{title}</span>
        </div>
        <button
          data-testid="popover-close-btn"
          onClick={onClose}
          className="h-6 w-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <X size={14} />
        </button>
      </div>
      <div className="p-3 flex flex-col gap-3 overflow-y-auto">{children}</div>
    </div>
  );
}

export function EmptyMsg({ children }) {
  return <div className="text-xs text-slate-500 italic py-2">{children}</div>;
}

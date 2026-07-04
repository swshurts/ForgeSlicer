// Shared UI primitives for the top toolbar.
//
// Extracted from TopToolbar.jsx during the 1.13 refactor so the row
// composables (`SystemRow`, `EditRow`) and the popover button factory
// can import them without re-declaring the same button styles. No
// behaviour change vs the inline versions — same DOM, same classes,
// same data-testid handling.
import React from "react";

export function IconBtn({ active, onClick, title, testid, children, danger, success, disabled }) {
  const base = "h-8 w-8 rounded flex items-center justify-center border transition-colors";
  let cls = base;
  if (disabled) cls += " bg-slate-900 border-slate-800 text-slate-500 opacity-40 cursor-not-allowed";
  else if (active) cls += " bg-orange-500/20 border-orange-500/60 text-orange-300";
  else if (danger) cls += " bg-slate-900 border-slate-800 text-red-400 hover:bg-red-500/10";
  else if (success) cls += " bg-green-500/20 border-green-500/60 text-green-300 hover:bg-green-500/30";
  else cls += " bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white";
  return (
    <button data-testid={testid} className={cls} onClick={onClick} title={title} disabled={disabled}>
      {children}
    </button>
  );
}

export function Divider() {
  return <div className="h-6 w-px bg-slate-800 mx-1" />;
}

// Tablet-pill style button used for every popover trigger (Position,
// Rotation, Size, Duplicate, Mirror, Cut, Slicer). They all shared the
// same 4-state styling (active/inactive/cut-mode-active/disabled), so
// collapsing them into one component cuts ~120 lines off the toolbar
// without changing any behaviour.
//
// `variant` picks the active-state colour: "orange" (default — for
// edit popovers), "amber" (Cut, which is a destructive-ish mode), or
// "green" (Slicer, which lives at the end of the row as the primary
// CTA).
export const TabPillButton = React.forwardRef(function TabPillButton(
  {
    testid, onClick, title, icon: Icon, label, badge,
    active, disabled, variant = "orange",
  },
  ref,
) {
  const activeCls = active
    ? variant === "amber"
      ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
      : variant === "green"
        ? "bg-green-500/20 border-green-500/60 text-green-300"
        : "bg-orange-500/20 border-orange-500/60 text-orange-300"
    : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white";
  return (
    <button
      ref={ref}
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap border transition-colors ${activeCls} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {Icon ? <Icon size={12} /> : null}
      {label}
      {badge != null && <span className="ml-0.5 text-[10px] text-orange-300">({badge})</span>}
    </button>
  );
});

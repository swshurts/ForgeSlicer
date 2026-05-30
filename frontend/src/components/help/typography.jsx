// Shared typography primitives for the Help dialog sections.
// Extracted from HelpDialog.jsx so individual section files can render
// consistent prose without import cycles. Kept deliberately tiny —
// these are CSS-class wrappers, not abstractions.
import React from "react";

export const H = ({ children }) => (
  <h3 className="text-lg font-bold text-white mt-5 mb-2">{children}</h3>
);
export const P = ({ children }) => (
  <p className="text-sm text-slate-300 leading-relaxed mb-3">{children}</p>
);
export const Code = ({ children }) => (
  <code className="px-1.5 py-0.5 rounded bg-slate-800 text-orange-300 font-mono text-[12px]">
    {children}
  </code>
);
export const Kbd = ({ children }) => (
  <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[11px]">
    {children}
  </kbd>
);
export const Step = ({ n, children }) => (
  <li className="flex gap-3 mb-2">
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/20 border border-orange-500/60 text-orange-300 text-xs font-bold flex items-center justify-center">{n}</span>
    <div className="text-sm text-slate-300 leading-relaxed pt-0.5">{children}</div>
  </li>
);

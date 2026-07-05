// Shared page chrome for the module scaffold pages (Slice, LithoForge,
// Orders, Production, Inventory). Provides the app header (brand + user
// menu), the top-level ModuleTabs, and a scrollable body — so every
// module looks like it lives inside the same native shell.
import React from "react";
import { Link } from "react-router-dom";
import BrandMark from "../BrandMark";
import UserMenu from "../UserMenu";
import ModuleTabs from "./ModuleTabs";

export default function ModuleShell({ title, subtitle, actions, children }) {
  return (
    <div
      className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden"
      style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      data-testid="module-shell"
    >
      <header className="h-12 flex-shrink-0 flex items-center gap-3 px-3 border-b border-slate-800 bg-slate-900">
        <Link to="/" className="flex-shrink-0">
          <BrandMark />
        </Link>
        {title && (
          <>
            <div className="h-5 w-px bg-slate-700 mx-1" />
            <div className="leading-tight min-w-0">
              <div className="text-sm font-semibold text-white truncate">{title}</div>
              {subtitle && (
                <div className="text-[10px] text-slate-400 truncate -mt-0.5">{subtitle}</div>
              )}
            </div>
          </>
        )}
        <div className="flex-1" />
        {actions}
        <UserMenu />
      </header>

      <ModuleTabs />

      <div className="flex-1 overflow-auto" data-testid="module-body">
        {children}
      </div>
    </div>
  );
}

// Small building blocks reused by the scaffold pages.

export function ComingSoon({ icon: Icon, title, blurb, points = [] }) {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      {Icon && (
        <div className="w-16 h-16 mx-auto rounded-2xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center mb-6">
          <Icon size={30} className="text-orange-400" />
        </div>
      )}
      <div className="inline-block text-[10px] uppercase tracking-widest text-orange-400 font-semibold mb-2">
        Planned module
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
      <p className="mt-3 text-sm text-slate-400 leading-relaxed">{blurb}</p>
      {points.length > 0 && (
        <ul className="mt-6 grid sm:grid-cols-2 gap-3 text-left">
          {points.map((p, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs text-slate-300"
            >
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-orange-400 flex-shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/workspace"
        className="inline-flex mt-8 h-10 px-5 items-center gap-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors"
      >
        Back to Design
      </Link>
    </div>
  );
}

export function KpiCard({ label, value, sub, tone = "default" }) {
  const toneCls =
    tone === "up"
      ? "text-emerald-300"
      : tone === "down"
      ? "text-red-300"
      : "text-orange-300";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
      {sub && <div className={`text-[11px] mt-0.5 ${toneCls}`}>{sub}</div>}
    </div>
  );
}

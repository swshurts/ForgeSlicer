// Top-level module tab bar — the "major functionality" switcher
// (Design · Slice · LithoForge · Library · Orders · Production ·
// Inventory). Rendered at the top of the workspace and every module
// scaffold page so the whole product feels like one native shell.
//
// Active tab is derived from the current route (see moduleList.js).
import React from "react";
import { Link, useLocation } from "react-router-dom";
import { MODULES, activeModuleId } from "./moduleList";

export default function ModuleTabs() {
  const { pathname } = useLocation();
  const active = activeModuleId(pathname);

  return (
    <nav
      data-testid="module-tabs"
      aria-label="Modules"
      className="h-9 flex-shrink-0 flex items-center gap-0.5 px-2 bg-slate-900 border-b border-slate-800 overflow-x-auto"
    >
      {MODULES.map(({ id, label, icon: Icon, to, hint, companion }) => {
        const isActive = id === active;
        return (
          <Link
            key={id}
            to={to}
            data-testid={`module-tab-${id}`}
            aria-current={isActive ? "page" : undefined}
            title={hint}
            className={`relative h-full px-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap transition-colors border-b-2 ${
              isActive
                ? "text-orange-300 border-orange-500 bg-orange-500/10"
                : "text-slate-400 border-transparent hover:text-white hover:bg-slate-800"
            }`}
          >
            <Icon size={13} className={isActive ? "text-orange-400" : ""} />
            <span>{label}</span>
            {companion && (
              <span
                title="Companion module"
                className="ml-1 hidden sm:inline text-[8px] leading-none px-1 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 tracking-wider"
              >
                APP
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// Theme switcher — three-segment toggle (Dark / Dim / Light) that
// lives at the right end of the SystemRow next to Help. Persists the
// user's choice via `useTheme` (zustand → localStorage) and updates
// `<html data-theme="…">` so `styles/themes.css` repaints the chrome
// without a reload.
import React from "react";
import { Moon, Cloud, Sun } from "lucide-react";
import { useTheme } from "../../lib/theme";

const THEMES = [
  { id: "dark",  label: "Dark",  icon: Moon,  hint: "Midnight slate — original palette" },
  { id: "dim",   label: "Dim",   icon: Cloud, hint: "Softer dark — in-between contrast" },
  { id: "light", label: "Light", icon: Sun,   hint: "Light mode — bright background" },
];

export default function ThemeSwitcher() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  return (
    <div
      data-testid="theme-switcher"
      className="h-8 ml-1 flex items-center bg-slate-900 border border-slate-700 rounded overflow-hidden"
      role="group"
      aria-label="Color theme"
    >
      {THEMES.map(({ id, label, icon: Icon, hint }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            data-testid={`theme-switcher-${id}`}
            aria-pressed={active}
            onClick={() => setTheme(id)}
            title={hint}
            className={`h-full px-2 flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold transition-colors ${
              active
                ? "bg-orange-500/20 text-orange-300"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            <Icon size={12} />
            <span className="hidden lg:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

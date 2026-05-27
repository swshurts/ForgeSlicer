// Theme switcher — Auto / Dark / Dim / Light segments + an optional
// "Pin to this page" toggle. When pinned, the switcher writes to a
// per-route memory slot so the user can prefer (e.g.) dark in the
// Workspace and light in the Gallery without re-clicking on every
// navigation.
//
// Active-segment highlighting reflects what's CURRENTLY in effect for
// this page (pinned route choice if present, otherwise global).
import React from "react";
import { Moon, Cloud, Sun, MonitorCog, Pin, PinOff } from "lucide-react";
import { useTheme } from "../../lib/theme";

const THEMES = [
  { id: "system", label: "Auto",  icon: MonitorCog, hint: "Follow OS appearance (prefers-color-scheme)" },
  { id: "dark",   label: "Dark",  icon: Moon,       hint: "Midnight slate — original palette" },
  { id: "dim",    label: "Dim",   icon: Cloud,      hint: "Softer dark — in-between contrast" },
  { id: "light",  label: "Light", icon: Sun,        hint: "Light mode — bright background" },
];

export default function ThemeSwitcher() {
  const theme = useTheme((s) => s.theme);
  const resolved = useTheme((s) => s.resolvedTheme);
  const perRouteEnabled = useTheme((s) => s.perRouteEnabled);
  const routeThemes = useTheme((s) => s.routeThemes);
  const currentRoute = useTheme((s) => s.currentRoute);
  const setTheme = useTheme((s) => s.setTheme);
  const togglePerRoute = useTheme((s) => s.togglePerRoute);

  // Which segment is "active" — when pinned, it's the route's choice;
  // otherwise the global choice. Falls through to the global theme if
  // pinning is on but this route has no stored pin yet.
  const activeChoice = (perRouteEnabled && routeThemes[currentRoute]) || theme;

  const pinTitle = perRouteEnabled
    ? `Pinned to ${currentRoute === "/" ? "Home" : currentRoute}. Click to unpin (back to one global theme).`
    : "Pin theme to this page. When pinned, the selector only changes this route's theme.";

  return (
    <div className="h-8 ml-1 flex items-center gap-1" data-testid="theme-switcher-wrap">
      <div
        data-testid="theme-switcher"
        className="h-full flex items-center bg-slate-900 border border-slate-700 rounded overflow-hidden"
        role="group"
        aria-label="Color theme"
      >
        {THEMES.map(({ id, label, icon: Icon, hint }) => {
          const active = activeChoice === id;
          // For "System" we append the currently-resolved theme to
          // the tooltip so users can see what it's evaluating to now.
          const title = id === "system" ? `${hint} — currently ${resolved}` : hint;
          return (
            <button
              key={id}
              data-testid={`theme-switcher-${id}`}
              aria-pressed={active}
              onClick={() => setTheme(id)}
              title={title}
              className={`h-full px-2 flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold transition-colors ${
                active
                  ? "bg-orange-500/20 text-orange-300"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Icon size={12} />
              <span className="hidden xl:inline">{label}</span>
            </button>
          );
        })}
      </div>
      <button
        data-testid="theme-pin-btn"
        onClick={togglePerRoute}
        title={pinTitle}
        aria-pressed={perRouteEnabled}
        className={`h-8 w-8 rounded flex items-center justify-center border transition-colors ${
          perRouteEnabled
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
        }`}
      >
        {perRouteEnabled ? <Pin size={13} /> : <PinOff size={13} />}
      </button>
    </div>
  );
}

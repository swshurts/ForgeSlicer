// Theme switcher — four user-facing choices:
//   • "system" (default) — follow the OS `prefers-color-scheme`
//   • "dark"   — original midnight slate
//   • "dim"    — softer dark, in between
//   • "light"  — proper light mode
//
// The OS-resolved "system" mode resolves to either "dark" or "light"
// (there's no `prefers-color-scheme: dim` — that's our invention) and
// re-resolves automatically when the user flips their OS appearance
// while the tab is open.
//
// Why a separate module? The whole app is styled with hardcoded
// Tailwind utility classes — refactoring each component to use
// semantic CSS variables would touch hundreds of files. Instead, we
// apply a `data-theme` attribute on `<html>` and let
// `styles/themes.css` remap the common slate utilities for "dim" /
// "light" via higher-specificity attribute-prefixed selectors.
import { create } from "zustand";

const STORAGE_KEY = "forgeslicer.theme";
const USER_THEMES = ["system", "dark", "dim", "light"];
const RESOLVED_THEMES = ["dark", "dim", "light"];
const DEFAULT_THEME = "system";

function readStoredTheme() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return USER_THEMES.includes(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function writeStoredTheme(theme) {
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* noop */ }
}

/**
 * Resolve a (possibly "system") theme choice to one of the concrete
 * rendered themes — "dark" | "dim" | "light".
 *
 * "system" maps to "light" or "dark" based on the OS preference; SSR
 * / no-`matchMedia` environments fall back to "dark" to stay
 * consistent with the historical default.
 */
export function resolveTheme(theme) {
  if (RESOLVED_THEMES.includes(theme)) return theme;
  // "system" — consult the media query.
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

/**
 * Applies the resolved (concrete) theme to `<html data-theme="…">`.
 * Safe to call from the index.js boot path (synchronous, before React
 * mounts) so the first paint never flashes the wrong palette.
 *
 * `userChoice` is one of USER_THEMES; this function does the
 * "system" → concrete resolution internally.
 */
export function applyTheme(userChoice) {
  const choice = USER_THEMES.includes(userChoice) ? userChoice : DEFAULT_THEME;
  const resolved = resolveTheme(choice);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-theme", resolved);
  }
  return { choice, resolved };
}

/**
 * Boot-time helper: read the stored theme and apply it before React
 * renders. Returns the resolved theme tuple.
 */
export function bootstrapTheme() {
  return applyTheme(readStoredTheme());
}

// Backgrounds the R3F Canvas reads as a hex string. Mirrors the
// `--viewport-bg` variable in themes.css.
export const VIEWPORT_BG = {
  dark:  "#1E293B", // slate-800 — historical default
  dim:   "#334155", // slate-700 — a touch lighter
  light: "#E2E8F0", // slate-200 — clearly light but not glaring white
};

// Initial state — resolve "system" once at module load so the store's
// `resolved` field is correct before the first render. The media-query
// listener (installed below) keeps it fresh if the OS appearance flips.
const initialChoice = readStoredTheme();
const initialResolved = resolveTheme(initialChoice);

export const useTheme = create((set, get) => ({
  /** What the user picked (incl. "system"). Persisted. */
  theme: initialChoice,
  /** The concrete rendered theme — "dark" | "dim" | "light". */
  resolvedTheme: initialResolved,
  setTheme: (theme) => {
    const { choice, resolved } = applyTheme(theme);
    writeStoredTheme(choice);
    set({ theme: choice, resolvedTheme: resolved });
  },
  /** Internal: called by the OS media-query listener when in "system" mode. */
  _systemThemeChanged: () => {
    if (get().theme !== "system") return;
    const { resolved } = applyTheme("system");
    set({ resolvedTheme: resolved });
  },
}));

// Subscribe to OS appearance changes so "system" mode stays in sync
// without a reload. We listen on the light query and re-resolve via
// the store's internal handler so the side-effect lives in one place.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => useTheme.getState()._systemThemeChanged();
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else if (mq.addListener) mq.addListener(handler); // Safari < 14
}

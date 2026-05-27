// Theme switcher — three modes: Dark (default), Dim (in-between), Light.
//
// Why a separate module? The whole app is styled with hardcoded Tailwind
// utility classes (`bg-slate-900`, `text-slate-300`, etc.) — refactoring
// each component to use semantic CSS variables would touch hundreds of
// files. Instead, we apply a `data-theme` attribute on `<html>` and let
// `styles/themes.css` remap the common slate utilities for "dim" and
// "light" modes via higher-specificity attribute-prefixed selectors.
//
// The viewport (3D canvas) reads its background from the
// `--viewport-bg` CSS variable so the 3D scene stays in sync with the
// chrome.
import { create } from "zustand";

const STORAGE_KEY = "forgeslicer.theme";
const VALID_THEMES = ["dark", "dim", "light"];
const DEFAULT_THEME = "dark";

function readStoredTheme() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.includes(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function writeStoredTheme(theme) {
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* noop */ }
}

/**
 * Applies the given theme to `<html data-theme="…">`. Safe to call from
 * the index.js boot path (synchronous, before React mounts) so the
 * first paint never flashes the wrong palette.
 */
export function applyTheme(theme) {
  const t = VALID_THEMES.includes(theme) ? theme : DEFAULT_THEME;
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-theme", t);
  }
  return t;
}

/**
 * Boot-time helper: read the stored theme and apply it before React
 * renders. Returns the resolved theme.
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

export const useTheme = create((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    const t = applyTheme(theme);
    writeStoredTheme(t);
    set({ theme: t });
  },
}));

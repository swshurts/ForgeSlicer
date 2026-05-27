// Theme switcher — four user-facing choices:
//   • "system" (default) — follow the OS `prefers-color-scheme`
//   • "dark"   — original midnight slate
//   • "dim"    — softer dark, in between
//   • "light"  — proper light mode
//
// Plus an OPTIONAL "per-route" mode (off by default). When the user
// pins the theme to the current page, picking a theme writes to a
// per-route slot in localStorage; navigating to that page in a later
// session restores its pinned theme. Unpinned pages fall back to the
// global theme.
//
// The OS-resolved "system" mode resolves to either "dark" or "light"
// (there's no `prefers-color-scheme: dim` — that's our invention) and
// re-resolves automatically when the user flips their OS appearance.
//
// Why all in one module? The whole app is styled with hardcoded
// Tailwind utility classes — refactoring to semantic CSS variables
// would touch hundreds of files. Instead, we apply a `data-theme`
// attribute on `<html>` and let `styles/themes.css` remap the common
// slate utilities for "dim" / "light" via attribute-prefixed selectors.
import { create } from "zustand";

const STORAGE_KEY = "forgeslicer.theme";
const PER_ROUTE_KEY = "forgeslicer.theme.perRoute";
const ROUTE_THEMES_KEY = "forgeslicer.theme.routes";
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

function readPerRouteEnabled() {
  try { return window.localStorage.getItem(PER_ROUTE_KEY) === "1"; }
  catch { return false; }
}

function writePerRouteEnabled(enabled) {
  try { window.localStorage.setItem(PER_ROUTE_KEY, enabled ? "1" : "0"); }
  catch { /* noop */ }
}

function readRouteThemes() {
  try {
    const raw = window.localStorage.getItem(ROUTE_THEMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null) return {};
    // Keep only entries with a valid theme value — defensive against
    // schema drift / hand-edited storage.
    const cleaned = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (USER_THEMES.includes(v)) cleaned[k] = v;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writeRouteThemes(map) {
  try { window.localStorage.setItem(ROUTE_THEMES_KEY, JSON.stringify(map)); }
  catch { /* noop */ }
}

/**
 * Reduce `/foo/bar/baz` → `/foo`, `/u/abc/xyz` → `/u`, `/` → `/`.
 * Per-route memory works at the top-level segment so users don't end
 * up with one theme per gallery item.
 */
export function normalizeRoute(pathname) {
  if (!pathname || typeof pathname !== "string") return "/";
  const segs = pathname.split("/").filter(Boolean);
  return segs.length === 0 ? "/" : "/" + segs[0];
}

/**
 * Did the user have any stored theme on this device before we
 * bootstrapped? Used by App.js to show a one-time "Auto theme is on,
 * tap a sun/moon to override" hint to brand-new users only.
 */
let HAD_STORED_THEME_AT_BOOT = false;
try {
  HAD_STORED_THEME_AT_BOOT = USER_THEMES.includes(
    window.localStorage.getItem(STORAGE_KEY),
  );
} catch { /* noop */ }

const HINT_SEEN_KEY = "forgeslicer.theme.hintSeen";
export function shouldShowThemeHint() {
  if (HAD_STORED_THEME_AT_BOOT) return false;
  try { return window.localStorage.getItem(HINT_SEEN_KEY) !== "1"; }
  catch { return false; }
}
export function markThemeHintSeen() {
  try { window.localStorage.setItem(HINT_SEEN_KEY, "1"); } catch { /* noop */ }
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
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

/**
 * Applies the resolved (concrete) theme to `<html data-theme="…">`.
 * Safe to call from the index.js boot path (synchronous, before React
 * mounts) so the first paint never flashes the wrong palette.
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
 * Boot-time helper. Reads global + per-route prefs and applies the
 * right one based on the current `location.pathname` at boot. Returns
 * the resolved tuple.
 */
export function bootstrapTheme() {
  const global = readStoredTheme();
  const perRoute = readPerRouteEnabled();
  const routeMap = readRouteThemes();
  let effective = global;
  if (perRoute && typeof window !== "undefined") {
    const route = normalizeRoute(window.location.pathname);
    if (routeMap[route]) effective = routeMap[route];
  }
  return applyTheme(effective);
}

// Backgrounds the R3F Canvas reads as a hex string. Mirrors the
// `--viewport-bg` variable in themes.css.
export const VIEWPORT_BG = {
  dark:  "#1E293B",
  dim:   "#334155",
  light: "#E2E8F0",
};

// ----- Initial state -----
const initialGlobal = readStoredTheme();
const initialPerRoute = readPerRouteEnabled();
const initialRouteMap = readRouteThemes();
const initialPath = typeof window !== "undefined"
  ? normalizeRoute(window.location.pathname)
  : "/";
const initialEffective = (initialPerRoute && initialRouteMap[initialPath])
  ? initialRouteMap[initialPath]
  : initialGlobal;
const initialResolved = resolveTheme(initialEffective);

export const useTheme = create((set, get) => ({
  /** Global default (persisted). May be overridden per-route. */
  theme: initialGlobal,
  /** The concrete rendered theme — "dark" | "dim" | "light". */
  resolvedTheme: initialResolved,
  /** Per-route memory toggle. */
  perRouteEnabled: initialPerRoute,
  /** Top-level path → user choice. */
  routeThemes: initialRouteMap,
  /** Normalized current route — kept in sync by App.js via setRoute. */
  currentRoute: initialPath,

  /**
   * User picked a theme via the switcher. If per-route mode is on,
   * the choice is stored against the current route; otherwise it
   * updates the global default.
   */
  setTheme: (theme) => {
    const choice = USER_THEMES.includes(theme) ? theme : DEFAULT_THEME;
    const { perRouteEnabled, currentRoute, routeThemes } = get();
    if (perRouteEnabled) {
      const next = { ...routeThemes, [currentRoute]: choice };
      writeRouteThemes(next);
      const { resolved } = applyTheme(choice);
      set({ routeThemes: next, resolvedTheme: resolved, theme: get().theme });
    } else {
      writeStoredTheme(choice);
      const { resolved } = applyTheme(choice);
      set({ theme: choice, resolvedTheme: resolved });
    }
  },

  /**
   * Route changed (called by App.js on every <Router> location
   * change). Updates `currentRoute` and, if per-route mode is on,
   * re-applies the theme stored for that route (or falls back to the
   * global theme if the route has no pin yet).
   */
  setRoute: (pathname) => {
    const route = normalizeRoute(pathname);
    const { perRouteEnabled, routeThemes, theme, currentRoute } = get();
    if (route === currentRoute) return;
    const effective = (perRouteEnabled && routeThemes[route]) || theme;
    const { resolved } = applyTheme(effective);
    set({ currentRoute: route, resolvedTheme: resolved });
  },

  /**
   * Flip the per-route toggle. Turning it ON pins the *current* page
   * to whatever theme is showing right now (so the user immediately
   * sees that "this is the per-page choice"). Turning it OFF leaves
   * the saved map intact (so re-enabling restores previous pins) but
   * snaps back to the global theme.
   */
  togglePerRoute: () => {
    const { perRouteEnabled, currentRoute, routeThemes, theme, resolvedTheme } = get();
    const next = !perRouteEnabled;
    writePerRouteEnabled(next);
    if (next) {
      // ON — if the route has no pinned theme, seed it with the
      // currently-resolved one so the user's recent choice "sticks".
      let map = routeThemes;
      if (!routeThemes[currentRoute]) {
        // Use the global user choice (incl. "system") — not the
        // resolved value — so pinning a page in Auto mode stays Auto.
        map = { ...routeThemes, [currentRoute]: theme };
        writeRouteThemes(map);
      }
      set({ perRouteEnabled: next, routeThemes: map });
    } else {
      // OFF — re-resolve to the global theme.
      const { resolved } = applyTheme(theme);
      set({ perRouteEnabled: next, resolvedTheme: resolved });
      // Mark resolvedTheme so re-render if it changed
      void resolvedTheme;
    }
  },

  /** Internal: called by the OS media-query listener when in "system" mode. */
  _systemThemeChanged: () => {
    const { theme, perRouteEnabled, routeThemes, currentRoute } = get();
    const effective = (perRouteEnabled && routeThemes[currentRoute]) || theme;
    if (effective !== "system") return;
    const { resolved } = applyTheme(effective);
    set({ resolvedTheme: resolved });
  },
}));

// Subscribe to OS appearance changes so "system" mode stays in sync.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => useTheme.getState()._systemThemeChanged();
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else if (mq.addListener) mq.addListener(handler); // Safari < 14
}

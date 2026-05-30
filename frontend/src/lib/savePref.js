// Tiny persisted preference: what does Ctrl/Cmd+S do in the workspace?
//
// Three values:
//   "local" — download the current scene as a .forge.json file (default,
//             matches the historical behavior of the toolbar Save button)
//   "cloud" — save the scene into the currently-linked hierarchical project
//             on the server (`PUT /api/projects/{id}` with forge_json). If
//             there's no current project (or the user isn't signed in),
//             we transparently fall back to "local" so Ctrl+S NEVER fails
//             silently. Toast nudges the user to link a project.
//   "both"  — do both. The local download happens first (synchronous), the
//             cloud save fires-and-forgets afterwards.
//
// Stored under localStorage key `forge.save.behavior`. We emit a CustomEvent
// on change so the UI (breadcrumb hint, settings tab) updates without a
// global state container — this preference doesn't justify a Zustand slot.
const KEY = "forge.save.behavior";
const EVT = "forgeslicer:save-behavior-changed";

export const SAVE_BEHAVIORS = ["local", "cloud", "both"];
export const DEFAULT_SAVE_BEHAVIOR = "local";

export function getSaveBehavior() {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_SAVE_BEHAVIOR;
  try {
    const v = window.localStorage.getItem(KEY);
    return SAVE_BEHAVIORS.includes(v) ? v : DEFAULT_SAVE_BEHAVIOR;
  } catch {
    return DEFAULT_SAVE_BEHAVIOR;
  }
}

export function setSaveBehavior(v) {
  const next = SAVE_BEHAVIORS.includes(v) ? v : DEFAULT_SAVE_BEHAVIOR;
  if (typeof window !== "undefined" && window.localStorage) {
    try { window.localStorage.setItem(KEY, next); } catch { /* ignore quota */ }
  }
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent(EVT, { detail: { behavior: next } })); }
    catch { /* ignore in old browsers */ }
  }
}

// Subscribe to changes. Returns an unsubscribe function. Useful in
// components that mirror the preference into render-state.
export function subscribeSaveBehavior(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = (e) => callback(e?.detail?.behavior || getSaveBehavior());
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}

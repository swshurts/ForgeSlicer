// iter-133 — Lithophane Studio state persistence.
//
// The problem: users would spend 10 minutes tuning brightness/palette/
// geometry, accidentally close the tab (or lose their session), and
// come back to a blank studio. Now that uploads spill to disk on the
// backend (iter-132), we can also snapshot the studio's UI state to
// localStorage and reconstruct the exact working set on return.
//
// We deliberately DO NOT persist heavyweight things like the result
// heightmap / preview PNG / job history — those either re-derive from
// a single Generate click or come from the authenticated /my-jobs API.
// Only the "user-supplied tuning" belongs here.

const STORAGE_KEY = "forge.litho.studio.v1";
const DEBOUNCE_MS = 800;

// A single debounced save timer. Keeping this at module scope means
// multiple useEffect passes from React StrictMode collapse into one
// write instead of stacking.
let _saveTimer = null;

function _now() {
  return Date.now();
}

/**
 * Snapshot the tunable studio state. Called from a useEffect that
 * watches every field below — we debounce so a slider drag doesn't
 * hammer localStorage on every frame.
 */
export function saveStudioState(snapshot) {
  if (!snapshot || !snapshot.imageId) {
    // Nothing meaningful to persist yet — user hasn't uploaded.
    return;
  }
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const payload = {
        version: 1,
        savedAt: _now(),
        ...snapshot,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      // localStorage full or private-mode Safari — non-fatal.
      // eslint-disable-next-line no-console
      console.warn("[litho] studio-state save failed:", err);
    }
  }, DEBOUNCE_MS);
}

/**
 * Load the last-saved snapshot. Returns `null` if nothing's stored, if
 * the schema version has moved on, or if the payload is malformed.
 * Callers should tolerate a null return without exploding.
 */
export function loadStudioState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    if (!parsed.imageId) return null;
    // Discard stale (>30d) snapshots — the backend spill will have
    // been GC'd long before then and rehydration would 404 anyway.
    const ageMs = _now() - (parsed.savedAt || 0);
    if (ageMs > 30 * 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

/**
 * Wipe the snapshot. Called on Reset button + on successful hydration
 * failure (backend can't rehydrate the image_id → clear the pointer
 * so we don't nag the user again).
 */
export function clearStudioState() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    /* ignore */
  }
}

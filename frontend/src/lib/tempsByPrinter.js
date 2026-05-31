// Per-printer remembered slicer settings (iter-77).
//
// Background: bedTemp / nozzleTemp / bedSurface / filament were all
// global in `useSliceSettings`. Users who switch between several
// printers (custom SV06 Plus Ace at 55°C, Bambu A1 at 65°C, etc.) had
// to re-enter their preferred values every time. This module persists
// each printer's last-saved temps to localStorage and provides a
// restore API for `useOrcaSlice` to call when the printer dropdown
// changes.
//
// Storage shape (localStorage key `forge:tempsByPrinter`):
//   { [printerId]: { bedTemp, nozzleTemp, bedSurface, filament,
//                    updatedAt: ISO } }
//
// `printerId` may be either a bundled id (e.g. "custom", "bambu_a1")
// OR a user-printer id with the `user:` prefix (e.g. "user:abc-123").
// We don't sanitise here — whatever the slicer dropdown stores, we
// store. localStorage is per-origin so a malicious key can't escape.

const STORAGE_KEY = "forge:tempsByPrinter";

function _readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Quota exceeded, JSON parse error, SSR (no localStorage) —
    // treat as no remembered values. Better silent fallback than
    // a stack trace; the user just enters their temps manually.
    return {};
  }
}

function _writeAll(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage quota / private mode — silently drop. The user just
    // won't get the remembered-temps perk; the rest of the slicer
    // keeps working.
  }
}

/**
 * Return the persisted temps for `printerId`, or `null` if we have
 * nothing on file for that printer. Callers should treat `null` as
 * "use the popover's current defaults" — DO NOT reset to factory.
 */
export function getTempsForPrinter(printerId) {
  if (!printerId) return null;
  const all = _readAll();
  return all[printerId] || null;
}

/**
 * Save the supplied temps under `printerId`. Only writes when the
 * values actually changed from what's already stored — saves the
 * trip through JSON.stringify on every re-render. Pass `null` /
 * `undefined` for any field you don't want to update.
 */
export function setTempsForPrinter(printerId, patch) {
  if (!printerId || !patch) return;
  const all = _readAll();
  const prev = all[printerId] || {};
  const next = {
    ...prev,
    ...(patch.bedTemp     !== undefined && { bedTemp:     patch.bedTemp }),
    ...(patch.nozzleTemp  !== undefined && { nozzleTemp:  patch.nozzleTemp }),
    ...(patch.bedSurface  !== undefined && { bedSurface:  patch.bedSurface }),
    ...(patch.filament    !== undefined && { filament:    patch.filament }),
    updatedAt: new Date().toISOString(),
  };
  // Skip the write when nothing meaningful changed (compare every
  // remembered key except `updatedAt`).
  const changed = ["bedTemp", "nozzleTemp", "bedSurface", "filament"]
    .some((k) => next[k] !== prev[k]);
  if (!changed) return;
  all[printerId] = next;
  _writeAll(all);
}

/**
 * Wipe the memory for one printer (or everything when `printerId` is
 * omitted). Exposed for the Settings tab's "Reset remembered temps"
 * action and for `userPrintersApi.remove` to clean up when a custom
 * printer is deleted.
 */
export function clearTempsForPrinter(printerId) {
  if (!printerId) {
    _writeAll({});
    return;
  }
  const all = _readAll();
  if (printerId in all) {
    delete all[printerId];
    _writeAll(all);
  }
}

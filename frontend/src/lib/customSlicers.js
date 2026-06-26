// Iter-82: user-customisable slicer registry. Lets users add their own
// slicer entries (custom Bambu forks, full-spectrum-colour OrcaSlicer
// modifications, internal company builds, whatever) so the "Send to…"
// menu can hand off to them just like the built-ins.
//
// We persist to localStorage rather than the backend because URL
// protocols are OS-registered, which is per-device. Syncing across
// devices would mislead users into thinking the slicer is available
// on a device where it isn't. A cleaner per-device list is honest
// about what's launchable from the current machine.
//
// Schema (forwards-compatible — add new optional fields freely):
//   { id, name, protocol, installUrl, isUserCustom, isPreferred }
//
// `id` doubles as the localStorage key suffix so duplicates can't
// silently shadow each other.

const LS_KEY = "forgeslicer.customSlicers.v1";
const LS_PREFERRED_KEY = "forgeslicer.preferredSlicerId.v1";

// The seven well-known slicers ForgeSlicer ships with knowledge of.
// Keeping protocol detection central avoids drift between dialogs.
export const BUILTIN_SLICERS = [
  {
    id: "orcaslicer",
    name: "OrcaSlicer",
    protocol: "orcaslicer://",
    installUrl: "https://github.com/SoftFever/OrcaSlicer/releases",
    isUserCustom: false,
  },
  {
    id: "orca-flashforge",
    name: "Orca-Flashforge",
    protocol: "orcaslicer://",
    installUrl: "https://flashforge.com/pages/orca-flashforge",
    isUserCustom: false,
  },
  {
    id: "bambu-studio",
    name: "Bambu Studio",
    protocol: "bambustudioopen://",
    installUrl: "https://bambulab.com/en/download/studio",
    isUserCustom: false,
  },
  {
    id: "prusaslicer",
    name: "PrusaSlicer",
    protocol: "prusaslicer://",
    installUrl: "https://www.prusa3d.com/page/prusaslicer_424/",
    isUserCustom: false,
  },
  {
    id: "superslicer",
    name: "SuperSlicer",
    protocol: "superslicer://",
    installUrl: "https://github.com/supermerill/SuperSlicer/releases",
    isUserCustom: false,
  },
  {
    id: "flashstudio",
    name: "Flash Studio Desktop",
    protocol: "flashforge://",
    installUrl: "https://www.flashforge.com/download-center",
    isUserCustom: false,
  },
  {
    id: "cura",
    name: "Ultimaker Cura",
    protocol: "cura://",
    installUrl: "https://ultimaker.com/software/ultimaker-cura/",
    isUserCustom: false,
  },
];

function safeReadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (err) {
    // eslint-disable-next-line no-console
    console.warn("customSlicers: localStorage write failed", err);
  }
}

/**
 * Load the user's custom-slicer list. Always returns an array (empty
 * on first load) and tolerates corrupted/malformed JSON.
 */
export function loadCustomSlicers() {
  const raw = safeReadLS(LS_KEY, []);
  if (!Array.isArray(raw)) return [];
  // Validate each entry — silently drop malformed ones so a single
  // bad entry doesn't break the whole picker.
  return raw.filter(
    (s) => s
      && typeof s.id === "string"
      && typeof s.name === "string"
      && typeof s.protocol === "string"
      && s.protocol.includes(":"),
  );
}

export function saveCustomSlicers(list) {
  safeWriteLS(LS_KEY, list);
}

/**
 * Return [...builtins, ...userCustoms] tagged with the `isPreferred`
 * flag so callers can render a star next to the user's default and
 * a one-click "Send to default slicer" toolbar action knows what
 * to launch.
 */
export function getAllSlicers() {
  const preferredId = safeReadLS(LS_PREFERRED_KEY, null);
  const custom = loadCustomSlicers().map((s) => ({ ...s, isUserCustom: true }));
  return [...BUILTIN_SLICERS, ...custom].map((s) => ({
    ...s,
    isPreferred: s.id === preferredId,
  }));
}

export function getPreferredSlicer() {
  const all = getAllSlicers();
  return all.find((s) => s.isPreferred) || null;
}

export function setPreferredSlicerId(id) {
  safeWriteLS(LS_PREFERRED_KEY, id);
}

/**
 * Add a new user-custom slicer. Returns the saved entry (with id
 * assigned if absent). Throws if the protocol is malformed or the
 * name conflicts with a built-in.
 */
export function addCustomSlicer({ name, protocol, installUrl = "" }) {
  if (!name || !name.trim()) throw new Error("Slicer name is required.");
  if (!protocol || !/^[a-z][a-z0-9+\-.]*:\/?\/?$/i.test(protocol)) {
    throw new Error(
      'Protocol must look like "myslicer://" or "myslicer:". Letters / digits / + - . only before the colon.',
    );
  }
  const trimmed = name.trim();
  if (BUILTIN_SLICERS.some((b) => b.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`"${trimmed}" is already a built-in slicer name — pick a different name.`);
  }
  const id = `user-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
  const entry = { id, name: trimmed, protocol: protocol.trim(), installUrl: installUrl.trim(), isUserCustom: true };
  const list = loadCustomSlicers();
  list.push(entry);
  saveCustomSlicers(list);
  return entry;
}

export function removeCustomSlicer(id) {
  const list = loadCustomSlicers().filter((s) => s.id !== id);
  saveCustomSlicers(list);
  // If the user just removed their preferred slicer, clear the
  // preference so the toolbar quick-button falls back to "pick one".
  if (safeReadLS(LS_PREFERRED_KEY, null) === id) {
    safeWriteLS(LS_PREFERRED_KEY, null);
  }
}

/**
 * Stage the 3MF bytes on the backend handoff route so the desktop
 * slicer (launched via custom URL protocol) can fetch them. Returns
 * the public URL the slicer should download. Throws on failure so the
 * caller falls back to the plain-download path.
 *
 * Authentication: same Emergent session cookie / Authorization bearer
 * the rest of the app uses. The returned URL itself is unauthenticated
 * (slicer can't forward cookies) but carries a single-shot opaque
 * token that the backend validates.
 */
export async function stageHandoff(bytes, filename) {
  const { API } = await import("./api");
  const url = new URL(`${API}/exports/handoff`, window.location.origin);
  url.searchParams.set("filename", filename || "model.3mf");
  const res = await fetch(url.toString(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!res.ok) {
    let detail;
    try { detail = (await res.json()).detail; } catch { detail = res.statusText; }
    throw new Error(`Handoff staging failed (HTTP ${res.status}): ${detail}`);
  }
  return res.json();   // { token, url, filename, expires_at, size }
}

/**
 * Attempt to launch a slicer via its registered URL protocol. Returns
 * a Promise<{launched: boolean, reason?: string}> that resolves after
 * a 2s probe — `launched: false` doesn't mean it definitely didn't
 * open (browsers don't tell us), it just means the heuristic
 * couldn't confirm.
 *
 * Reliability improvements over the previous iframe approach:
 *   • Uses `window.location.href` (most reliable cross-browser
 *     method per current MDN / Chromium docs as of Feb 2026).
 *   • Falls back to an anchor click for older browsers / Firefox.
 *   • Detects "window lost focus" within 2s as a positive signal
 *     that the OS protocol dialog appeared.
 */
export async function launchSlicer(protocol, { fileUrl = null } = {}) {
  if (!protocol) return { launched: false, reason: "no protocol" };
  // Slicer families that honour `<protocol>open/?file=<URL>` so they
  // auto-open the file on launch (no manual File → Open Project).
  // Cura-derivatives are NOT in this list; for them the caller must
  // fall back to file download + drag-into-slicer guidance.
  const OPEN_FILE_FAMILIES = ["orcaslicer://", "prusaslicer://", "superslicer://", "bambustudioopen://"];
  const supportsOpenArg = OPEN_FILE_FAMILIES.some((p) => protocol.startsWith(p));
  const target = (fileUrl && supportsOpenArg)
    ? `${protocol}open/?file=${encodeURIComponent(fileUrl)}`
    : protocol;
  let focusLost = false;
  const onBlur = () => { focusLost = true; };
  window.addEventListener("blur", onBlur, { once: true });
  try {
    // Primary path: setting window.location to a custom protocol
    // triggers the OS handler dialog without navigating the page.
    // The browser stays on the current URL after handling.
    window.location.href = target;
  } catch (err1) {
    // Fallback: synthesise an anchor click. Works in Firefox where
    // the location-href path is sometimes throttled.
    try {
      const a = document.createElement("a");
      a.href = target;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err2) {
      window.removeEventListener("blur", onBlur);
      // eslint-disable-next-line no-console
      console.warn("launchSlicer fallback failed:", err1, err2);
      return { launched: false, reason: "browser blocked protocol launch" };
    }
  }
  // Give the OS up to 2 s to surface its protocol-handler dialog.
  // If the browser tab loses focus during that window, the OS prompt
  // (or the slicer itself) took focus — strong positive signal.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  window.removeEventListener("blur", onBlur);
  return { launched: focusLost, target, openedWithFile: Boolean(fileUrl && supportsOpenArg) };
}

// Send-to-printer client.
//
// Browser-direct GCODE upload to networked 3D printers. Because the
// user's printer is on their LAN (not the ForgeSlicer backend's
// network), we cannot proxy through our server — the upload runs
// entirely client-side via `fetch`. That's only possible when the
// printer accepts CORS from `forgeslicer.com`. Today the protocols
// that allow this with a one-line config are:
//
//   • Moonraker (Klipper / Mainsail / Fluidd) — every Sovol SV07/SV08,
//     every Voron, and the vast majority of DIY Klipper builds. The
//     user adds our origin to `cors_domains` in moonraker.conf.
//
// PrusaLink, OctoPrint, and Bambu Cloud are intentionally NOT
// implemented in this first pass — they each require disabling CORS
// or using MQTT/OAuth which doesn't work from a pure browser context.
// The UI shows them as "Coming soon" with a tooltip explaining why.
//
// ## Connection profiles
// Saved per-user to localStorage under `forge.printers.v1`. We DO NOT
// store API keys with any encryption — they live next to the rest of
// the localStorage settings. If a user is in a hostile environment
// they should use the "Forget" button instead of saving.
//
// ## Upload flow
//   1. POST <baseUrl>/server/files/upload (multipart) — Moonraker docs:
//      https://moonraker.readthedocs.io/en/latest/web_api/#upload-file
//   2. Optionally POST <baseUrl>/printer/print/start to begin printing.
//
// ## Errors
//   Connection failures throw a typed `PrinterUploadError` with a
//   `.hint` field the dialog can show (e.g., "Add forgeslicer.com to
//   cors_domains in moonraker.conf"). This keeps the dialog UX
//   actionable instead of dumping raw fetch error text on the user.

const STORAGE_KEY = "forge.printers.v1";
const HISTORY_KEY = "forge.printers.history.v1";
const HISTORY_LIMIT = 50;

export class PrinterUploadError extends Error {
  constructor(message, { hint, status, raw } = {}) {
    super(message);
    this.name = "PrinterUploadError";
    this.hint = hint;
    this.status = status;
    this.raw = raw;
  }
}

// ---- Saved connections persistence ----

export function listConnections() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(list) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* noop */ }
}

export function saveConnection(conn) {
  // `id` is the immutable handle — generated on first save and reused
  // on updates. `name` is what the user sees in the picker.
  const list = listConnections();
  if (conn.id) {
    const idx = list.findIndex((c) => c.id === conn.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...conn };
      persist(list);
      return list[idx];
    }
  }
  const fresh = {
    id: `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...conn,
  };
  list.push(fresh);
  persist(list);
  return fresh;
}

export function deleteConnection(id) {
  const list = listConnections().filter((c) => c.id !== id);
  persist(list);
}

// ---- Print history ----
// Lightweight log of every successful upload — surfaces in the
// SendToPrinterDialog as "Recent uploads". We intentionally store ONLY
// metadata (printer, filename, size, status, ISO timestamp). The
// GCODE itself is *not* persisted because it can be 50 MB+ for complex
// prints and localStorage tops out at ~5 MB. Re-upload from history
// is enabled only when the originating slice is still in memory (the
// SlicerPopover's `lastDownload` prop matches by filename).

export function listHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addHistoryEntry({ connId, printerName, filename, size, started }) {
  const entry = {
    id: `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toISOString(),
    connId, printerName, filename, size, started: !!started,
  };
  const list = [entry, ...listHistory()].slice(0, HISTORY_LIMIT);
  try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* noop */ }
  return entry;
}

export function clearHistory() {
  try { window.localStorage.removeItem(HISTORY_KEY); } catch { /* noop */ }
}

// ---- Moonraker protocol implementation ----

function moonrakerBase(conn) {
  // Strip trailing slashes, accept either bare host (we'll prepend
  // http://) or a full URL. Most consumer Klipper installs run on
  // plain HTTP on the LAN; we still support https for those who
  // proxied behind nginx.
  let base = (conn.host || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  if (conn.port && !/:\d+(?:\/|$)/.test(base)) base = `${base}:${conn.port}`;
  return base;
}

function moonrakerHeaders(conn) {
  // Moonraker accepts either an X-Api-Key header or a query string
  // `?token=`. Most Mainsail installs leave auth open on the LAN so
  // the key field is optional. We send the header only when set so
  // an empty key doesn't trigger "invalid token" 401s.
  const h = {};
  if (conn.apiKey) h["X-Api-Key"] = conn.apiKey;
  return h;
}

/**
 * Quick reachability probe used by the "Test Connection" button. Hits
 * `/printer/info` because it's a tiny no-side-effects endpoint that
 * every Moonraker version supports. Returns `{ ok, name, version,
 * status }` so the dialog can show a friendly result.
 */
export async function testMoonraker(conn) {
  const url = `${moonrakerBase(conn)}/printer/info`;
  let resp;
  try {
    resp = await fetch(url, { headers: moonrakerHeaders(conn), method: "GET" });
  } catch (e) {
    throw new PrinterUploadError(
      `Couldn't reach ${moonrakerBase(conn)} — is the printer powered on and on the same network?`,
      {
        hint: "If you see a CORS error in the browser console, open moonraker.conf and add `forgeslicer.com` to the `cors_domains` list under [authorization].",
        raw: String(e),
      },
    );
  }
  if (!resp.ok) {
    throw new PrinterUploadError(
      `Moonraker returned HTTP ${resp.status}.`,
      { status: resp.status, hint: resp.status === 401 ? "API key missing or wrong." : null },
    );
  }
  const data = await resp.json().catch(() => ({}));
  const result = data.result || data || {};
  return {
    ok: true,
    name: result.hostname || result.klipper_path || conn.host,
    version: result.software_version || "Moonraker",
    state: result.state || "unknown",
  };
}

/**
 * Upload a GCODE string to Moonraker. Optionally starts the print
 * immediately. Returns `{ filename, size, started }`.
 *
 * `gcode` is a plain string (we get it from the slicer's output). We
 * wrap it in a Blob+File so the browser sends a proper multipart
 * upload. `print` toggles the `print` form field — Moonraker starts
 * the print straight from upload when it's set to "true".
 */
export async function uploadMoonraker({ conn, gcode, filename, print = false, onProgress }) {
  const url = `${moonrakerBase(conn)}/server/files/upload`;
  const file = new File([gcode], filename, { type: "text/x.gcode" });
  const fd = new FormData();
  fd.append("file", file);
  fd.append("root", "gcodes");
  if (print) fd.append("print", "true");

  // XHR (not fetch) so we can report upload progress — fetch's upload
  // progress API is still not universally implemented in browsers.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    const headers = moonrakerHeaders(conn);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new PrinterUploadError(
      `Couldn't reach ${moonrakerBase(conn)} — network error.`,
      {
        hint: "Most likely cause: moonraker.conf doesn't list forgeslicer.com under cors_domains. See the help link below.",
        raw: "fetch failed",
      },
    ));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* keep empty */ }
        // Log every successful upload to the local history so the
        // dialog's "Recent uploads" section can render it. Failures are
        // intentionally NOT logged — keeps the history a list of what
        // actually made it to the printer.
        addHistoryEntry({
          connId: conn.id,
          printerName: conn.name || conn.host,
          filename, size: file.size, started: !!print,
        });
        resolve({
          filename,
          size: file.size,
          started: !!print,
          response: body,
        });
      } else {
        reject(new PrinterUploadError(
          `Moonraker returned HTTP ${xhr.status}.`,
          { status: xhr.status, raw: xhr.responseText.slice(0, 400) },
        ));
      }
    };
    xhr.send(fd);
  });
}

// ---- Protocol registry — drives the connection-type picker. ----
// Each entry contains the human label + a flag indicating whether the
// upload path is actually implemented today. The UI shows un-implemented
// protocols as disabled radio buttons with a "Coming soon" badge so
// the user can see the roadmap without us breaking when they click.
export const PROTOCOLS = [
  {
    id: "moonraker",
    label: "Moonraker (Klipper / Mainsail / Fluidd)",
    description: "Sovol SV07/SV08, Voron, BTT, all DIY Klipper builds.",
    implemented: true,
    defaultPort: 80,
    test: testMoonraker,
    upload: uploadMoonraker,
    corsHelp: {
      summary: "Moonraker needs to allow uploads from forgeslicer.com.",
      // Concrete copy-paste config the user can drop into their printer.
      configFile: "moonraker.conf",
      snippet: `[authorization]
cors_domains:
  *.forgeslicer.com
  forgeslicer.com
  *.preview.emergentagent.com`,
      after: "Then restart Moonraker (`sudo systemctl restart moonraker`).",
    },
  },
  {
    id: "prusalink",
    label: "PrusaLink (MK4, XL, Mini+)",
    description: "Built-in Prusa printer web UI.",
    implemented: false,
    note: "Prusa firmware locks CORS to its own UI. We're talking to Prusa about whitelisting forgeslicer.com.",
  },
  {
    id: "octoprint",
    label: "OctoPrint",
    description: "Plugin-based Raspberry Pi print server.",
    implemented: false,
    note: "Requires the CORS plugin. Coming in a follow-up release.",
  },
  {
    id: "bambu",
    label: "Bambu Lab (Cloud / Handy)",
    description: "A1 / P1S / X1 Carbon.",
    implemented: false,
    note: "Bambu uses MQTT + OAuth; browsers can't speak that natively. Use Bambu Handy with the downloaded GCODE.",
  },
];

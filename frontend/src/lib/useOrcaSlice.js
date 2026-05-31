// useOrcaSlice — encapsulates everything specific to the OrcaSlicer
// server-side engine so SlicerPopover can focus on view + the
// general slicer settings.
//
// What lives here:
//   - The user's Orca profile selections (printer / process / filament)
//     and the four inline tunables (walls / infill density / pattern /
//     supports / ironing), each persisted to localStorage.
//   - The polled `/api/slice/orca/status` install state + derived
//     `ready` / `building` flags.
//   - Live progress telemetry via EventSource on the slice job id.
//   - The async `runSlice(objects, projectName)` action that wraps
//     STL export, base64 encoding, profile composition, SSE
//     subscription and the orcaApi.slice round-trip into a single call.
//   - A `buildPayload()` helper so the comparison flow can reuse the
//     exact same profile composition as the live slice.
//
// What stays in the popover:
//   - Engine selector (built-in vs orca) — it's a multi-engine choice,
//     not just an Orca concern.
//   - General slice settings (layer height, speeds, etc.) — they apply
//     to BOTH engines.
//   - All view-layer rendering.
import { useEffect, useRef, useState } from "react";
import { orcaApi, userPrintersApi, apiErrorMessage, API as API_BASE } from "./api";
import { buildOrcaPayload, isUserPrinterId, userPrinterIdOf } from "./orcaProfiles";
import { useSliceSettings } from "./store";
import { exportSceneToSTLBytes } from "./exporters";

// Convert an ArrayBuffer / Uint8Array to base64 in 32 KB chunks so we
// don't blow the call-stack on large STLs (Chrome's spread-into-
// fromCharCode tops out around 100 KB). Exported because we'd need
// the same helper if a future engine landed.
export function arrayBufferToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const LS = {
  printer:    "forge.orca.printer",
  process:    "forge.orca.process",
  filament:   "forge.orca.filament",
  walls:      "forge.orca.walls",
  infillPct:  "forge.orca.infillpct",
  pattern:    "forge.orca.pattern",
  supports:   "forge.orca.supports",
  ironing:    "forge.orca.ironing",
};

const lsGet = (key, def) => {
  try { return window.localStorage.getItem(key) ?? def; } catch { return def; }
};
const lsSet = (key, val) => {
  try { window.localStorage.setItem(key, val); } catch { /* noop */ }
};

// Small helper to make the "set + persist" pattern less repetitive
// for the eight profile fields below. Returns a setter that wraps the
// underlying React useState setter and also writes through to
// localStorage as a string.
function persistingSetter(setLocal, key, serialize = String) {
  return (val) => {
    setLocal(val);
    lsSet(key, serialize(val));
  };
}

export function useOrcaSlice() {
  // --- Profile state (UI selections, persisted) ---
  const [printer, _setPrinter] = useState(() => lsGet(LS.printer, "bambu_a1"));
  const [process, _setProcess] = useState(() => lsGet(LS.process, "standard"));
  const [filament, _setFilament] = useState(() => lsGet(LS.filament, "pla"));
  const [walls, _setWalls] = useState(() => parseInt(lsGet(LS.walls, "2"), 10));
  const [infillPct, _setInfillPct] = useState(() => parseInt(lsGet(LS.infillPct, "15"), 10));
  const [pattern, _setPattern] = useState(() => lsGet(LS.pattern, "gyroid"));
  const [supports, _setSupports] = useState(() => lsGet(LS.supports, "false") === "true");
  const [ironing, _setIroning] = useState(() => lsGet(LS.ironing, "false") === "true");

  const setPrinter   = persistingSetter(_setPrinter,   LS.printer);
  const setProcess   = persistingSetter(_setProcess,   LS.process);
  const setFilament  = persistingSetter(_setFilament,  LS.filament);
  const setWalls     = persistingSetter(_setWalls,     LS.walls);
  const setInfillPct = persistingSetter(_setInfillPct, LS.infillPct);
  const setPattern   = persistingSetter(_setPattern,   LS.pattern);
  const setSupports  = persistingSetter(_setSupports,  LS.supports);
  const setIroning   = persistingSetter(_setIroning,   LS.ironing);

  // --- Install status (polled while building) ---
  // `null` = not yet probed. Polled every 5 s while the engine is
  // mid-install (build_in_progress / source === "missing") so the
  // popover can update without the user closing+reopening.
  const [status, setStatus] = useState(null);

  // --- User-defined printers (iter-72) ---
  // Loaded once on mount + refreshed via `reloadUserPrinters` when the
  // UserPrintersDialog mutates the catalogue. Anonymous users get an
  // empty list (the API 401s and we silently fall back).
  const [userPrinters, setUserPrinters] = useState([]);
  const reloadUserPrinters = async () => {
    try {
      const items = await userPrintersApi.list();
      setUserPrinters(items || []);
      return items || [];
    } catch {
      setUserPrinters([]);
      return [];
    }
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await userPrintersApi.list();
        if (!cancelled) setUserPrinters(items || []);
      } catch {
        if (!cancelled) setUserPrinters([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const fetchStatus = async () => {
      try {
        const s = await orcaApi.status();
        if (!cancelled) setStatus(s);
        const keepPolling = s && !s.installed && (s.build_in_progress || s.source === "missing")
          && (s.arch === "x86_64" || s.arch === "amd64");
        if (!cancelled && keepPolling) {
          timerId = setTimeout(fetchStatus, 5000);
        }
      } catch (e) {
        if (!cancelled) setStatus({ installed: false, source: "error", detail: apiErrorMessage(e) });
        if (!cancelled) timerId = setTimeout(fetchStatus, 10000);
      }
    };

    fetchStatus();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // --- Live slice progress (EventSource) ---
  const [progress, setProgress] = useState(null);
  const progressSrcRef = useRef(null);
  // Promise + resolvers tied to the currently-running job. When SSE
  // reports `done: true` we resolve this so `runSlice` can move on to
  // fetching the final result. `error` resolves it with an Error so
  // the caller can surface a clean message.
  const progressDoneRef = useRef(null);

  const subscribeProgress = (jobId) => {
    // Close previous before opening a new one.
    if (progressSrcRef.current) {
      try { progressSrcRef.current.close(); } catch { /* noop */ }
    }
    const url = `${API_BASE}/slice/orca/progress/${encodeURIComponent(jobId)}`;
    let es;
    try { es = new EventSource(url); } catch { return; }
    progressSrcRef.current = es;
    setProgress({ percent: 0, stage: "starting", done: false });
    // Fresh promise per subscription — runSlice awaits this to learn
    // when the backend task has finished (success or failure).
    progressDoneRef.current = (() => {
      let resolveFn, rejectFn;
      const p = new Promise((resolve, reject) => {
        resolveFn = resolve; rejectFn = reject;
      });
      p.resolve = resolveFn; p.reject = rejectFn;
      return p;
    })();
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setProgress(data);
        if (data.done) {
          try { es.close(); } catch { /* noop */ }
          progressSrcRef.current = null;
          const p = progressDoneRef.current;
          if (p) {
            if (data.error) p.reject(new Error(data.error));
            else p.resolve(data);
            progressDoneRef.current = null;
          }
        }
      } catch { /* ignore malformed events */ }
    };
    es.onerror = () => {
      try { es.close(); } catch { /* noop */ }
      progressSrcRef.current = null;
      const p = progressDoneRef.current;
      if (p) {
        p.reject(new Error("Lost connection to slicer progress stream."));
        progressDoneRef.current = null;
      }
    };
  };

  // Close any open SSE on unmount so a remount doesn't leak streams.
  useEffect(() => () => {
    if (progressSrcRef.current) {
      try { progressSrcRef.current.close(); } catch { /* noop */ }
    }
  }, []);

  // --- Profile composition helper ---
  // Public so the engine-compare flow can reuse the exact same payload.
  const buildPayload = () => {
    // When the selected printer id is a `user:<uuid>`, look up the
    // matching record from our `userPrinters` cache so we can pass its
    // display name (for the slice summary) + flag the backend to use
    // the user_printer_id resolution path.
    const upId = userPrinterIdOf(printer);
    const userPrinter = upId ? userPrinters.find((p) => p.printer_id === upId) : null;
    // Pull engine-agnostic temps + plate surface from `useSliceSettings`.
    // iter-75: these used to be silently dropped on the Orca path —
    // the popover's Bed / Hotend / Bed surface fields had no effect on
    // GCODE the OrcaSlicer engine produced. Now we forward them so the
    // Orca filament profile is overridden to match what the popover says.
    const slice = useSliceSettings.getState();
    return buildOrcaPayload({
      printerId: printer, processId: process, filamentId: filament,
      wallLoops: walls, sparseInfillDensity: infillPct,
      sparseInfillPattern: pattern,
      enableSupport: supports, ironing,
      userPrinter,
      bedTemp: slice.bedTemp,
      nozzleTemp: slice.nozzleTemp,
      bedSurface: slice.bedSurface,
    });
  };

  // --- The actual slice action ---
  // Two-step async flow (avoids Cloudflare 524 on slow slices):
  //   1. POST /slice → kicks off backend task, returns immediately with job_id.
  //   2. SSE progress stream keeps the connection warm + drives the UI.
  //   3. Once SSE reports done, GET /result/{job_id} fetches the GCODE.
  // Returns a uniform `{ gcode, stats }` so SlicerPopover doesn't need
  // to know which engine produced it.
  const runSlice = async (objects) => {
    const { bytes, triangleCount } = await exportSceneToSTLBytes(objects);
    const b64 = arrayBufferToBase64(bytes);
    const payload = buildPayload();
    // Pre-generate job id and open the SSE stream BEFORE the POST so
    // the user sees real-time progress from the moment they click Slice.
    const jobId = (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    ).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    subscribeProgress(jobId);
    // Capture the promise BEFORE await; subscribeProgress could
    // re-assign it on a new call, but we want to await THIS slice's
    // completion specifically.
    const donePromise = progressDoneRef.current;
    try {
      // POST returns 202 immediately with { job_id, status: "accepted" }.
      await orcaApi.slice({
        stlBase64: b64,
        jobId,
        printerProfile: payload.printerProfile,
        processProfile: payload.processProfile,
        filamentProfile: payload.filamentProfile,
        printerPresetName:  payload.printerPresetName,
        printerVendor:      payload.printerVendor,
        processPresetName:  payload.processPresetName,
        processVendor:      payload.processVendor,
        filamentPresetName: payload.filamentPresetName,
        filamentVendor:     payload.filamentVendor,
        userPrinterId:      payload.userPrinterId,
      });
    } catch (err) {
      // POST blew up before the task could even start (4xx/5xx).
      // Close the SSE and surface the original error.
      if (progressSrcRef.current) {
        try { progressSrcRef.current.close(); } catch { /* noop */ }
        progressSrcRef.current = null;
      }
      setProgress(null);
      progressDoneRef.current = null;
      throw err;
    }
    // Wait for the SSE stream to report `done: true` (success or
    // failure). The donePromise rejects if the backend marked the
    // job as errored.
    try {
      if (donePromise) await donePromise;
    } catch (sseErr) {
      // SSE-reported failure — fetch /result anyway to get the
      // structured HTTPException detail (status code + message) the
      // backend stamped onto the slot.
      try {
        await orcaApi.sliceResult({ jobId });
        // Shouldn't reach here — sliceResult should throw on error.
        throw sseErr;
      } catch (resErr) {
        throw resErr;
      }
    }
    // Job done — fetch the GCODE + stats.
    const r = await orcaApi.sliceResult({ jobId });
    return {
      gcode: r.gcode,
      stats: {
        layers: r.stats.layers || 0,
        segments: r.stats.gcode_lines,
        filamentMM: r.stats.filament_mm || 0,
        tris: triangleCount,
        engine: "orca",
        durationSec: r.stats.duration_seconds,
        summary: payload.summary,
      },
    };
  };

  return {
    // Status
    status,
    ready: status?.installed === true,
    building: status?.build_in_progress === true,
    // Profile state + setters (persisted)
    profile: { printer, process, filament, walls, infillPct, pattern, supports, ironing },
    setPrinter, setProcess, setFilament, setWalls, setInfillPct,
    setPattern, setSupports, setIroning,
    // Progress
    progress,
    // Actions
    runSlice,
    buildPayload,
    // User-defined printers (iter-72) — list + a refresh hook so the
    // UserPrintersDialog can tell us to re-fetch after CRUD ops.
    userPrinters,
    reloadUserPrinters,
    isUserPrinterId,
  };
}

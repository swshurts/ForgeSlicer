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
import { getTempsForPrinter, setTempsForPrinter } from "./tempsByPrinter";
import { exportSceneToSTLBytes } from "./exporters";
import { exportSTLBytesAsync } from "./workerClient";

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

  // --- Per-printer remembered temps (iter-77) ---
  // When the user switches printers, restore any temps we remembered
  // for that printer the last time they sliced with it. Then track
  // bedTemp / nozzleTemp / bedSurface / filament changes and save
  // them back under the CURRENT printer. The save runs lazily — on
  // every render where the relevant fields change — but `setTempsForPrinter`
  // bails when nothing actually changed, so this is cheap.
  useEffect(() => {
    if (!printer) return;
    const remembered = getTempsForPrinter(printer);
    if (remembered) {
      // Apply with `useSliceSettings.getState().set` so we don't
      // re-render the hook tree on a no-op. Only patch keys we
      // actually remembered to avoid stomping on user-typed values
      // for fields that weren't in the saved snapshot.
      const patch = {};
      if (remembered.bedTemp     !== undefined) patch.bedTemp     = remembered.bedTemp;
      if (remembered.nozzleTemp  !== undefined) patch.nozzleTemp  = remembered.nozzleTemp;
      if (remembered.bedSurface  !== undefined) patch.bedSurface  = remembered.bedSurface;
      if (Object.keys(patch).length) useSliceSettings.getState().set(patch);
      if (remembered.filament    !== undefined && remembered.filament !== filament) {
        setFilament(remembered.filament);
      }
    }
    // Intentionally ONLY watch `printer` — we don't want to restore
    // temps on every filament change, otherwise the user couldn't
    // tweak temps for the current printer without them snapping back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printer]);

  // Subscribe to useSliceSettings changes + persist to localStorage
  // whenever bedTemp / nozzleTemp / bedSurface change while a printer
  // is selected. Also fires on filament change. Debounce isn't needed
  // because `setTempsForPrinter` short-circuits when nothing changed.
  useEffect(() => {
    if (!printer) return undefined;
    const unsub = useSliceSettings.subscribe((state) => {
      setTempsForPrinter(printer, {
        bedTemp: state.bedTemp,
        nozzleTemp: state.nozzleTemp,
        bedSurface: state.bedSurface,
        filament,
      });
    });
    return () => { try { unsub(); } catch { /* noop */ } };
  }, [printer, filament]);

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
  // Tracks the job id of the in-flight slice so the cancel button has
  // something to route its DELETE call against. Cleared when the slice
  // resolves OR rejects (success or failure) so a second click can't
  // re-cancel a long-finished job.
  const activeJobIdRef = useRef(null);

  const cancelActiveSlice = async () => {
    const jobId = activeJobIdRef.current;
    if (!jobId) return null;
    activeJobIdRef.current = null;
    try {
      return await orcaApi.cancel({ jobId });
    } catch {
      // Cancel is fire-and-forget — if the network blip, the SSE
      // stream will still terminate when the subprocess dies or
      // finishes on its own.
      return null;
    }
  };

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
  const runSlice = async (objects, opts = {}) => {
    // `opts.stlBytesOverride` lets a caller (e.g. PrintPreviewDialog,
    // iter-80) hand us pre-baked STL bytes that already encode the
    // user-confirmed orientation. When present we skip the worker
    // export and ship those bytes straight to OrcaSlicer.
    //
    // Use the manifold-3d worker path (same as the user-facing "Flatten
    // to single mesh" feature) instead of the bvh-csg `exportSceneToSTLBytes`.
    //
    // Why: bvh-csg falls back to "carve each positive separately, then
    // concatenate" when its Union step fails on complex assemblies
    // (many positives + many negatives — the canonical case is the
    // RPI mounting tray with 6 positives + 22 negatives). The result
    // is a *single STL file containing N disjoint shells*, which
    // OrcaSlicer's CLI treats as N separate objects. Each shell ends
    // up scattered across the plate, none of them touching the bed
    // coherently, and the slicer drops most geometry / generates
    // spindly tree supports for everything — producing the bad
    // GCODE pattern the user hit repeatedly through iter-78/79.
    //
    // The manifold-3d worker does a proper boolean Union that
    // physically merges all positives into a single watertight body,
    // then subtracts negatives. The output STL has ONE shell,
    // OrcaSlicer slices it correctly. The user's workspace stays as
    // 28 separate editable components — only the STL bytes sent to
    // the slicer are merged. Iter-80.
    //
    // Falls back to bvh-csg only when the worker is unavailable
    // (very old browsers / failed WASM init) — in that case the user
    // gets the old buggy behaviour, but at least it doesn't crash.
    let bytes, triangleCount;
    if (opts.stlBytesOverride) {
      bytes = opts.stlBytesOverride;
      triangleCount = opts.triangleCountOverride || 0;
    } else {
      try {
        const r = await exportSTLBytesAsync(objects);
        bytes = r.bytes;
        triangleCount = r.triangleCount;
      } catch (workerErr) {
        // eslint-disable-next-line no-console
        console.warn("manifold-3d worker STL export failed, falling back to bvh-csg:", workerErr);
        const fb = await exportSceneToSTLBytes(objects);
        bytes = fb.bytes;
        triangleCount = fb.triangleCount;
      }
    }
    const b64 = arrayBufferToBase64(bytes);
    const payload = buildPayload();
    // Pre-generate job id and open the SSE stream BEFORE the POST so
    // the user sees real-time progress from the moment they click Slice.
    const jobId = (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    ).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    subscribeProgress(jobId);
    // Track the currently-running job so a Cancel click can route to
    // the right /api/slice/orca/job/{jobId} DELETE call (iter-77).
    activeJobIdRef.current = jobId;
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
      activeJobIdRef.current = null;
      throw err;
    }
    // Wait for the SSE stream to report `done: true` (success or
    // failure). The donePromise rejects if the backend marked the
    // job as errored OR the SSE connection drops (Cloudflare closes
    // long-lived event-streams after ~30-60 s on production). When
    // the SSE drops, we transparently fall back to long-polling
    // /result/{jobId} so the slice can still complete from the
    // user's perspective. Iter-78.
    let polledResult = null;
    try {
      if (donePromise) await donePromise;
    } catch (sseErr) {
      // Either an SSE network drop ("Lost connection…") or a backend
      // job-failure event. Poll /result/{jobId} — that endpoint is
      // the source of truth:
      //   • If the job is still running, polling continues until
      //     it finishes (success → 200 with GCODE, failure → 4xx/5xx).
      //   • If the job already failed, the very first poll throws
      //     with the backend's structured error detail.
      // Either way, we end up with the right outcome instead of
      // the misleading "Lost connection to slicer progress stream."
      setProgress({ percent: 0, stage: "polling (stream dropped)", done: false });
      try {
        polledResult = await orcaApi.waitForSliceResult({ jobId });
      } catch (resErr) {
        activeJobIdRef.current = null;
        setProgress(null);
        // Prefer the polled result's specific error (e.g. OrcaSlicer
        // exit code + reason) over the generic SSE drop message.
        throw resErr;
      }
    }
    // Job done — fetch the GCODE + stats. If we already polled and
    // got the result above, reuse it; otherwise fetch via the
    // SSE-completion fast path.
    activeJobIdRef.current = null;
    const r = polledResult || await orcaApi.sliceResult({ jobId });
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
        // Non-fatal slicer warnings (empty-layer / floating-regions
        // / can't-be-printed). Pass through so the popover can show
        // a "consider Lay Flat or enable supports" banner. Iter-79.
        warnings: r.stats.warnings || [],
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
    cancelActiveSlice,
    buildPayload,
    // User-defined printers (iter-72) — list + a refresh hook so the
    // UserPrintersDialog can tell us to re-fetch after CRUD ops.
    userPrinters,
    reloadUserPrinters,
    isUserPrinterId,
  };
}

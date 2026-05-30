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
import { orcaApi, apiErrorMessage, API as API_BASE } from "./api";
import { buildOrcaPayload } from "./orcaProfiles";
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
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setProgress(data);
        if (data.done) { try { es.close(); } catch { /* noop */ } progressSrcRef.current = null; }
      } catch { /* ignore malformed events */ }
    };
    es.onerror = () => {
      try { es.close(); } catch { /* noop */ }
      progressSrcRef.current = null;
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
  const buildPayload = () => buildOrcaPayload({
    printerId: printer, processId: process, filamentId: filament,
    wallLoops: walls, sparseInfillDensity: infillPct,
    sparseInfillPattern: pattern,
    enableSupport: supports, ironing,
  });

  // --- The actual slice action ---
  // Caller passes the scene objects + project name. Returns a uniform
  // `{ gcode, stats }` so SlicerPopover doesn't need to know which
  // engine produced it.
  const runSlice = async (objects) => {
    const { bytes, triangleCount } = await exportSceneToSTLBytes(objects);
    const b64 = arrayBufferToBase64(bytes);
    const payload = buildPayload();
    // Pre-generate job id and open the SSE stream BEFORE the POST so
    // the user sees real-time progress (POST is synchronous and would
    // otherwise only return AFTER the slice is already done).
    const jobId = (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    ).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    subscribeProgress(jobId);
    let r;
    try {
      r = await orcaApi.slice({
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
      });
    } catch (err) {
      // If the POST blows up (network / server error) we still need to
      // close the EventSource so the user doesn't end up with a
      // dangling SSE connection until they navigate away from the page.
      if (progressSrcRef.current) {
        try { progressSrcRef.current.close(); } catch { /* noop */ }
        progressSrcRef.current = null;
      }
      setProgress(null);
      throw err;
    }
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
  };
}

// Slicer popover — picks the slicer engine (built-in JS or server-side
// OrcaSlicer), tunes the parameters, runs the slice, and offers the
// resulting GCODE for download / preview / direct-send to a Klipper
// printer over LAN. The OrcaSlicer engine is only selectable when the
// server reports it's installed; otherwise the built-in slicer remains
// the only option.
import React, { useEffect, useState } from "react";
import {
  Sliders, AlertTriangle, CheckCircle2, Download, Eye,
  Cpu, Zap, Loader2, Send, Activity,
} from "lucide-react";
import { useScene, useSliceSettings } from "../../lib/store";
import { sliceToGCODEAsync } from "../../lib/workerClient";
import { downloadText, exportSceneToSTLBytes } from "../../lib/exporters";
import { orcaApi, apiErrorMessage, API as API_BASE } from "../../lib/api";
import { buildOrcaPayload } from "../../lib/orcaProfiles";
import GcodePreviewDialog from "../GcodePreviewDialog";
import SendToPrinterDialog from "../dialogs/SendToPrinterDialog";
import { PopoverShell, NumberField } from "./PopoverShell";
import OrcaProfileEditor from "./OrcaProfileEditor";

// Convert an ArrayBuffer / Uint8Array to base64 without going through
// btoa(String.fromCharCode) which blows the call stack on large STLs
// (Chrome's spread-into-fromCharCode tops out around 100 KB). We
// process in 32 KB chunks — STL exports of typical hobbyist parts run
// 200 KB–5 MB, large hardware-store-imports ~30 MB.
function arrayBufferToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Engine choices. The built-in JS slicer remains the default — it's
// fast, deterministic, fully offline, but emits perimeter-only walls
// and the limited infill repertoire that the user pushed back on.
// "Orca" routes the slice through a server-side OrcaSlicer CLI for
// multi-perimeter walls, real supports, AMS, ironing, etc. Availability
// depends on the backend having Orca installed (status endpoint).
const ENGINES = {
  builtin: { id: "builtin", label: "Built-in", description: "Fast, runs in your browser. Single perimeter, simple infills." },
  orca:    { id: "orca",    label: "OrcaSlicer", description: "Production-quality. Multi-perimeter walls, all infill patterns, supports, AMS." },
};

export function SlicerPopover({ anchor, onClose }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const buildVolume = useScene((s) => s.buildVolume);
  const settings = useSliceSettings();
  const setS = useSliceSettings((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [lastDownload, setLastDownload] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendToPrinterOpen, setSendToPrinterOpen] = useState(false);
  // Engine selector — persisted to localStorage so the user's choice
  // survives a refresh. Defaults to "builtin" so first-time users get
  // the instant slice without a server round-trip.
  const [engine, setEngine] = useState(() => {
    try { return window.localStorage.getItem("forge.slice.engine") || "builtin"; }
    catch { return "builtin"; }
  });
  // Orca profile selections (printer / process / filament) + the four
  // inline tunables that override the process preset. All persisted to
  // localStorage so a returning user lands back on their last setup.
  const lsGet = (key, def) => {
    try { return window.localStorage.getItem(key) ?? def; } catch { return def; }
  };
  const lsSet = (key, val) => {
    try { window.localStorage.setItem(key, val); } catch { /* noop */ }
  };
  const [orcaPrinter, setOrcaPrinter] = useState(() => lsGet("forge.orca.printer", "bambu_a1"));
  const [orcaProcess, setOrcaProcess] = useState(() => lsGet("forge.orca.process", "standard"));
  const [orcaFilament, setOrcaFilament] = useState(() => lsGet("forge.orca.filament", "pla"));
  const [orcaWalls, setOrcaWalls] = useState(() => parseInt(lsGet("forge.orca.walls", "2"), 10));
  const [orcaInfillPct, setOrcaInfillPct] = useState(() => parseInt(lsGet("forge.orca.infillpct", "15"), 10));
  const [orcaPattern, setOrcaPattern] = useState(() => lsGet("forge.orca.pattern", "gyroid"));
  const [orcaSupports, setOrcaSupports] = useState(() => lsGet("forge.orca.supports", "false") === "true");
  const [orcaIroning, setOrcaIroning] = useState(() => lsGet("forge.orca.ironing", "false") === "true");
  // Orca install status — polled when the popover opens so the UI can
  // tell the user up front whether the OrcaSlicer engine is available.
  // null = not yet probed; { installed: bool, ...detail fields }.
  const [orcaStatus, setOrcaStatus] = useState(null);
  // Live slice progress (Orca engine only). When the backend kicks off
  // a slice, it returns a job_id and we open an EventSource on
  // /api/slice/orca/progress/<id> to stream % + stage. null when no
  // slice is in flight or when running the built-in engine.
  const [progress, setProgress] = useState(null);
  const progressJobRef = React.useRef(null);
  const progressSrcRef = React.useRef(null);
  const subscribeProgress = (jobId) => {
    // Close any previous subscription before opening a new one.
    if (progressSrcRef.current) { try { progressSrcRef.current.close(); } catch { /* noop */ } }
    progressJobRef.current = jobId;
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
  // Close any open SSE on unmount so a returning popover doesn't leak streams.
  useEffect(() => () => {
    if (progressSrcRef.current) { try { progressSrcRef.current.close(); } catch { /* noop */ } }
  }, []);
  const pickEngine = (id) => {
    setEngine(id);
    try { window.localStorage.setItem("forge.slice.engine", id); } catch { /* noop */ }
  };
  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const fetchStatus = async () => {
      try {
        const s = await orcaApi.status();
        if (!cancelled) setOrcaStatus(s);
        // Keep polling while the install is in progress (or we
        // don't have a definitive answer yet). The previous code
        // fetched once on mount and never refreshed, so a user who
        // opened the popover during the ~1 min install would see
        // "installing…" forever even after the engine became ready.
        // We poll every 5 s — server endpoint is a 50 ms file-stat,
        // negligible load. Stops polling automatically once installed
        // is true OR the server says we're on the wrong arch.
        const keepPolling = s && !s.installed && (s.build_in_progress || s.source === "missing")
          && (s.arch === "x86_64" || s.arch === "amd64");
        if (!cancelled && keepPolling) {
          timerId = setTimeout(fetchStatus, 5000);
        }
      } catch (e) {
        if (!cancelled) setOrcaStatus({ installed: false, source: "error", detail: apiErrorMessage(e) });
        // Even on error, keep retrying — could be a transient network
        // blip and the user shouldn't have to close+reopen the popover.
        if (!cancelled) {
          timerId = setTimeout(fetchStatus, 10000);
        }
      }
    };

    fetchStatus();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  const handleSlice = async () => {
    setError(""); setBusy(true); setStats(null); setLastDownload(null);
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      const filename = `${safe}.gcode`;
      let gcode = "";
      let st = null;
      if (engine === "orca") {
        // Export merged scene → STL → base64. Reuses the existing CSG
        // pipeline so positives/negatives are pre-merged before Orca
        // sees the geometry (Orca treats input as one solid).
        const { bytes, triangleCount } = await exportSceneToSTLBytes(objects);
        const b64 = arrayBufferToBase64(bytes);
        // Compose the three JSON profiles from the user's picker
        // selections + inline tunables.
        const payload = buildOrcaPayload({
          printerId: orcaPrinter, processId: orcaProcess, filamentId: orcaFilament,
          wallLoops: orcaWalls, sparseInfillDensity: orcaInfillPct,
          sparseInfillPattern: orcaPattern,
          enableSupport: orcaSupports, ironing: orcaIroning,
        });
        // Pre-generate a job id and open the SSE stream BEFORE the
        // slice POST so the user sees a progress bar tick from 0 →
        // 100 % in real time (the POST is synchronous and would
        // otherwise only return after the slice is already done).
        const jobId = (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        ).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
        subscribeProgress(jobId);
        const r = await orcaApi.slice({
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
        gcode = r.gcode;
        st = {
          layers: r.stats.layers || 0,
          segments: r.stats.gcode_lines,
          filamentMM: r.stats.filament_mm || 0,
          tris: triangleCount,
          engine: "orca",
          durationSec: r.stats.duration_seconds,
          summary: payload.summary,
        };
      } else {
        const r = await sliceToGCODEAsync(objects, {
          ...settings,
          bedX: buildVolume.x,
          bedY: buildVolume.y,
        });
        gcode = r.gcode;
        st = { ...r.stats, engine: "builtin" };
      }
      setStats(st);
      downloadText(gcode, filename, "text/plain");
      setLastDownload({ gcode, filename });
    } catch (e) {
      setError(apiErrorMessage(e) || e.message || String(e));
    } finally { setBusy(false); }
  };

  const handleDownloadAgain = () => {
    if (!lastDownload) return;
    downloadText(lastDownload.gcode, lastDownload.filename, "text/plain");
  };

  // Whether the Orca tab is selectable — disabled when the server tells
  // us it's not installed yet. The "Built-in" tab is always selectable.
  const orcaReady = orcaStatus?.installed === true;
  const orcaBuilding = orcaStatus?.build_in_progress === true;

  return (
    <PopoverShell title="Slicer Settings" icon={Sliders} onClose={onClose} anchor={anchor} testid="slicer-popover" width={340}>
      {/* Engine selector — sits above the parameters so the user knows
          which slicer their settings apply to. The built-in fields are
          shown for both engines (they're sane defaults); Orca ignores
          fields it has its own opinion about. */}
      <div className="space-y-1.5" data-testid="slicer-engine-picker">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Slicer Engine</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            data-testid="slicer-engine-builtin"
            onClick={() => pickEngine("builtin")}
            className={`h-12 rounded border text-left px-2 flex items-center gap-2 transition-colors ${
              engine === "builtin"
                ? "bg-orange-500/15 border-orange-500/60 text-orange-100"
                : "bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
            title={ENGINES.builtin.description}
          >
            <Zap size={14} className={engine === "builtin" ? "text-orange-400" : "text-slate-500"} />
            <div className="flex-1 leading-tight">
              <div className="text-[11px] font-semibold">{ENGINES.builtin.label}</div>
              <div className="text-[9px] opacity-70">in-browser</div>
            </div>
          </button>
          <button
            data-testid="slicer-engine-orca"
            onClick={() => orcaReady && pickEngine("orca")}
            disabled={!orcaReady}
            className={`h-12 rounded border text-left px-2 flex items-center gap-2 transition-colors ${
              engine === "orca" && orcaReady
                ? "bg-purple-500/15 border-purple-500/60 text-purple-100"
                : orcaReady
                ? "bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500"
                : "bg-slate-950 border-slate-800 text-slate-500 cursor-not-allowed"
            }`}
            title={orcaReady ? ENGINES.orca.description : "OrcaSlicer is not yet available on the server."}
          >
            <Cpu size={14} className={engine === "orca" && orcaReady ? "text-purple-400" : "text-slate-500"} />
            <div className="flex-1 leading-tight">
              <div className="text-[11px] font-semibold flex items-center gap-1">
                {ENGINES.orca.label}
                {orcaBuilding && <Loader2 size={9} className="animate-spin text-amber-400" />}
              </div>
              <div className="text-[9px] opacity-70">
                {orcaReady ? "server-side" : orcaBuilding ? "installing…" : "unavailable"}
              </div>
            </div>
          </button>
        </div>
        {engine === "orca" && orcaStatus?.version && (
          <div className="text-[10px] text-slate-500 font-mono pl-1" data-testid="slicer-engine-version">
            {orcaStatus.version} · {orcaStatus.arch}
          </div>
        )}
        {!orcaReady && orcaStatus?.detail && (
          <div className="text-[10px] text-amber-300/80 leading-snug pl-1" data-testid="slicer-engine-detail">
            {orcaStatus.detail}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField testid="popover-slice-layer-height" label="Layer Height" value={settings.layerHeight} onChange={(v) => setS({ layerHeight: v })} step={0.05} min={0.05} suffix="mm" />
        <NumberField testid="popover-slice-first-layer" label="First Layer" value={settings.firstLayerHeight} onChange={(v) => setS({ firstLayerHeight: v })} step={0.05} min={0.05} suffix="mm" />
        <NumberField testid="popover-slice-nozzle" label="Nozzle" value={settings.nozzleDiameter} onChange={(v) => setS({ nozzleDiameter: v })} step={0.05} min={0.1} suffix="mm" />
        <NumberField testid="popover-slice-filament" label="Filament Ø" value={settings.filamentDiameter} onChange={(v) => setS({ filamentDiameter: v })} step={0.05} suffix="mm" />
        <NumberField testid="popover-slice-print-speed" label="Print Speed" value={settings.printSpeed} onChange={(v) => setS({ printSpeed: v })} step={5} suffix="mm/s" />
        <NumberField testid="popover-slice-travel-speed" label="Travel" value={settings.travelSpeed} onChange={(v) => setS({ travelSpeed: v })} step={5} suffix="mm/s" />
        <NumberField testid="popover-slice-nozzle-temp" label="Hotend" value={settings.nozzleTemp} onChange={(v) => setS({ nozzleTemp: v })} step={5} suffix="°C" />
        <NumberField testid="popover-slice-bed-temp" label="Bed" value={settings.bedTemp} onChange={(v) => setS({ bedTemp: v })} step={5} suffix="°C" />
        <NumberField testid="popover-slice-bottom-layers" label="Bottom Solid" value={settings.bottomLayers} onChange={(v) => setS({ bottomLayers: Math.max(0, Math.round(v)) })} step={1} min={0} suffix="lyrs" />
        <NumberField testid="popover-slice-top-layers" label="Top Solid" value={settings.topLayers} onChange={(v) => setS({ topLayers: Math.max(0, Math.round(v)) })} step={1} min={0} suffix="lyrs" />
      </div>
      {/* OrcaSlicer profile editor — appears only when the Orca engine
          is selected. Three dropdowns for printer/process/filament +
          four inline tunables for the keys users actually care about.
          Everything else inherits from the chosen process preset. */}
      {engine === "orca" && (
        <OrcaProfileEditor
          printerId={orcaPrinter} onPrinterChange={(v) => { setOrcaPrinter(v); lsSet("forge.orca.printer", v); }}
          processId={orcaProcess} onProcessChange={(v) => { setOrcaProcess(v); lsSet("forge.orca.process", v); }}
          filamentId={orcaFilament} onFilamentChange={(v) => { setOrcaFilament(v); lsSet("forge.orca.filament", v); }}
          walls={orcaWalls} onWallsChange={(v) => { setOrcaWalls(v); lsSet("forge.orca.walls", String(v)); }}
          infillPct={orcaInfillPct} onInfillPctChange={(v) => { setOrcaInfillPct(v); lsSet("forge.orca.infillpct", String(v)); }}
          pattern={orcaPattern} onPatternChange={(v) => { setOrcaPattern(v); lsSet("forge.orca.pattern", v); }}
          supports={orcaSupports} onSupportsChange={(v) => { setOrcaSupports(v); lsSet("forge.orca.supports", String(v)); }}
          ironing={orcaIroning} onIroningChange={(v) => { setOrcaIroning(v); lsSet("forge.orca.ironing", String(v)); }}
        />
      )}
      {/* Sparse infill (Tier-b) — middle layers between the solid bands.
          0% disables sparse fill entirely (perimeter cage). Spacing
          scales with density: 100% = solid, 25% = 4× extrusion-width
          spacing, etc. */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 min-w-0" data-testid="popover-slice-infill-percent-wrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Infill</span>
          <div className="flex items-center gap-2 h-9 bg-slate-950 border border-slate-700 rounded px-2 focus-within:border-orange-500 min-w-0">
            <input
              data-testid="popover-slice-infill-percent"
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.infillPercent}
              onChange={(e) => setS({ infillPercent: parseInt(e.target.value, 10) })}
              className="flex-1 min-w-0 accent-orange-500"
            />
            <span className="text-xs font-mono text-orange-300 w-10 text-right flex-shrink-0">{settings.infillPercent}%</span>
          </div>
        </label>
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Pattern</span>
          <select
            data-testid="popover-slice-infill-pattern"
            value={settings.infillPattern}
            onChange={(e) => setS({ infillPattern: e.target.value })}
            className="h-9 w-full bg-slate-950 border border-slate-700 rounded text-xs text-white px-2 focus:border-orange-500 outline-none"
          >
            <option value="rectilinear">Rectilinear ±45°</option>
            <option value="grid">Grid (crosshatch)</option>
            <option value="gyroid">Gyroid (strong)</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField testid="popover-slice-transition-layers" label="Transition" value={settings.transitionLayers} onChange={(v) => setS({ transitionLayers: Math.max(0, Math.round(v)) })} step={1} min={0} suffix="lyrs" />
      </div>
      <div className="text-[10px] text-amber-400/80 flex items-start gap-1 font-medium leading-tight">
        <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
        <span>Top/bottom solid + sparse infill (rectilinear/grid/gyroid) are now generated. For supports, tree supports, multi-material, and adaptive layer height, export 3MF and slice in OrcaSlicer.</span>
      </div>
      <button
        data-testid="popover-slice-btn"
        onClick={handleSlice}
        disabled={busy || objects.length === 0}
        className="w-full h-10 bg-green-500 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-md shadow-md transition-all uppercase tracking-wide text-sm flex items-center justify-center gap-2"
      >
        <Activity size={16} />
        {busy ? "Slicing..." : "Slice & Export GCODE"}
      </button>
      {error && <div className="text-xs text-red-400" data-testid="popover-slice-error">{error}</div>}
      {busy && engine === "orca" && progress && !progress.done && (
        <div data-testid="popover-slice-progress" className="bg-slate-950 border border-orange-500/40 rounded p-2 space-y-1">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-orange-300 truncate flex-1 mr-2" title={progress.stage}>{progress.stage || "slicing"}</span>
            <span className="text-orange-200">{progress.percent || 0}%</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
            <div
              data-testid="popover-slice-progress-fill"
              className="h-full bg-gradient-to-r from-orange-500 to-amber-300 transition-all duration-200"
              style={{ width: `${progress.percent || 0}%` }}
            />
          </div>
        </div>
      )}
      {stats && (
        <div className="bg-slate-950 border border-slate-700 rounded p-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono" data-testid="popover-slice-stats">
          <span className="text-slate-500">Layers</span><span className="text-orange-400 text-right">{stats.layers}</span>
          <span className="text-slate-500">Segments</span><span className="text-orange-400 text-right">{stats.segments}</span>
          <span className="text-slate-500">Filament</span><span className="text-orange-400 text-right">{stats.filamentMM.toFixed(1)} mm</span>
        </div>
      )}
      {lastDownload && (
        <div
          data-testid="popover-slice-download-confirm"
          className="bg-emerald-500/10 border border-emerald-500/40 rounded p-2 flex flex-col gap-2"
        >
          <div className="flex items-start gap-2 text-[11px] text-emerald-200 leading-tight">
            <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5 text-emerald-400" />
            <div>
              Saved as <span className="font-mono text-emerald-300">{lastDownload.filename}</span> to your Downloads folder.
              <div className="text-emerald-200/70 mt-0.5">If your browser blocked the download, click below.</div>
            </div>
          </div>
          <button
            data-testid="popover-slice-redownload-btn"
            onClick={handleDownloadAgain}
            className="h-8 px-3 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/60 text-emerald-200 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 transition-colors"
          >
            <Download size={12} /> Download {lastDownload.filename} again
          </button>
          <button
            data-testid="popover-slice-send-to-printer-btn"
            onClick={() => setSendToPrinterOpen(true)}
            className="h-8 px-3 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/60 text-orange-200 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 transition-colors"
          >
            <Send size={12} /> Send to my printer
          </button>
          <button
            data-testid="popover-slice-preview-btn"
            onClick={() => setPreviewOpen(true)}
            className="h-8 px-3 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/60 text-orange-200 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 transition-colors"
          >
            <Eye size={12} /> Preview toolpaths layer-by-layer
          </button>
        </div>
      )}
      <GcodePreviewDialog
        open={previewOpen}
        gcode={lastDownload?.gcode}
        filename={lastDownload?.filename}
        onClose={() => setPreviewOpen(false)}
      />
      <SendToPrinterDialog
        open={sendToPrinterOpen}
        gcode={lastDownload?.gcode}
        filename={lastDownload?.filename}
        onClose={() => setSendToPrinterOpen(false)}
      />
    </PopoverShell>
  );
}

// Slicer popover — picks the slicer engine (built-in JS or server-side
// OrcaSlicer), tunes the parameters, runs the slice, and offers the
// resulting GCODE for download / preview / direct-send to a Klipper
// printer over LAN. The OrcaSlicer engine is only selectable when the
// server reports it's installed; otherwise the built-in slicer remains
// the only option.
//
// All OrcaSlicer-specific machinery (profile state + status polling +
// SSE progress + slice action + payload builder) lives in
// `lib/useOrcaSlice.js` so this file can stay focused on the view +
// engine-agnostic settings.
import React, { useEffect, useMemo, useState } from "react";
import {
  Sliders, AlertTriangle, CheckCircle2, Download, Eye,
  Cpu, Zap, Loader2, Send, Activity, GitCompare, Layers,
} from "lucide-react";
import { useScene, useSliceSettings } from "../../lib/store";
import { sliceToGCODEAsync } from "../../lib/workerClient";
import { downloadText } from "../../lib/exporters";
import { apiErrorMessage } from "../../lib/api";
import { useOrcaSlice } from "../../lib/useOrcaSlice";
import { compareEngines } from "../../lib/engineCompare";
import { computeRotatedBBox } from "../../lib/geometry";
import GcodePreviewDialog from "../GcodePreviewDialog";
import SendToPrinterDialog from "../dialogs/SendToPrinterDialog";
import EngineComparisonDialog from "../dialogs/EngineComparisonDialog";
import { PopoverShell, NumberField } from "./PopoverShell";
import OrcaProfileEditor from "./OrcaProfileEditor";

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
  // Engine-comparison modal state — open=true while the dialog is
  // visible; result holds the {builtin, orca, comparison} payload
  // produced by lib/engineCompare.js. `busy` tracks the in-flight
  // dual-slice (shared with the SLICE button so we don't double-fire).
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareResult, setCompareResult] = useState(null);
  const [compareBusy, setCompareBusy] = useState(false);
  // Engine selector — persisted to localStorage so the user's choice
  // survives a refresh. Defaults to "builtin" so first-time users get
  // the instant slice without a server round-trip.
  const [engine, setEngine] = useState(() => {
    try { return window.localStorage.getItem("forge.slice.engine") || "builtin"; }
    catch { return "builtin"; }
  });
  // All OrcaSlicer engine state + actions — install status, progress,
  // persisted profile selections, slice runner, payload composer.
  const orca = useOrcaSlice();

  const pickEngine = (id) => {
    setEngine(id);
    try { window.localStorage.setItem("forge.slice.engine", id); } catch { /* noop */ }
  };

  const handleSlice = async () => {
    setError(""); setBusy(true); setStats(null); setLastDownload(null);
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      const filename = `${safe}.gcode`;
      let gcode = "";
      let st = null;
      if (engine === "orca") {
        const r = await orca.runSlice(objects);
        gcode = r.gcode;
        st = r.stats;
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

  // "Compare engines" — runs the SAME scene through both slicers in
  // parallel and pops the comparison dialog. Re-uses the user's
  // current OrcaSlicer settings (printer / process / filament + the
  // four CLI tunables) so the comparison is faithful to what they'd
  // actually print. Opens the dialog immediately in "busy" state so
  // the user sees the spinner without waiting for the round-trip.
  const handleCompare = async () => {
    setError("");
    setCompareBusy(true);
    setCompareResult(null);
    setCompareOpen(true);
    try {
      const orcaPayload = orca.buildPayload();
      const r = await compareEngines({
        objects,
        settings,
        buildVolume,
        orcaPayload,
      });
      setCompareResult(r);
    } catch (e) {
      // Top-level failure (e.g., compareEngines itself threw outside
      // its per-side try/catch). Surface in the popover error slot so
      // the user sees what happened even after closing the modal.
      setError(apiErrorMessage(e) || e.message || String(e));
      setCompareOpen(false);
    } finally {
      setCompareBusy(false);
    }
  };

  // Whether the Orca tab is selectable — disabled when the server tells
  // us it's not installed yet. The "Built-in" tab is always selectable.
  const orcaReady = orca.ready;
  const orcaBuilding = orca.building;
  const orcaStatus = orca.status;
  const progress = orca.progress;

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
          printerId={orca.profile.printer} onPrinterChange={orca.setPrinter}
          processId={orca.profile.process} onProcessChange={orca.setProcess}
          filamentId={orca.profile.filament} onFilamentChange={orca.setFilament}
          walls={orca.profile.walls} onWallsChange={orca.setWalls}
          infillPct={orca.profile.infillPct} onInfillPctChange={orca.setInfillPct}
          pattern={orca.profile.pattern} onPatternChange={orca.setPattern}
          supports={orca.profile.supports} onSupportsChange={orca.setSupports}
          ironing={orca.profile.ironing} onIroningChange={orca.setIroning}
          userPrinters={orca.userPrinters}
          onReloadUserPrinters={orca.reloadUserPrinters}
          bedSurface={settings.bedSurface}
          onBedSurfaceChange={(v) => setS({ bedSurface: v })}
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
      <SlicerOrientationBadge objects={objects} />
      <button
        data-testid="popover-slice-btn"
        onClick={handleSlice}
        disabled={busy || objects.length === 0}
        className="w-full h-10 bg-green-500 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-md shadow-md transition-all uppercase tracking-wide text-sm flex items-center justify-center gap-2"
      >
        <Activity size={16} />
        {busy ? "Slicing..." : "Slice & Export GCODE"}
      </button>
      {/* Compare engines — runs the same scene through built-in + Orca
          in parallel and pops a side-by-side metrics table. Disabled
          until OrcaSlicer reports installed (otherwise the comparison
          would always have an empty Orca column). */}
      <button
        data-testid="slicer-compare-engines-btn"
        onClick={handleCompare}
        disabled={busy || compareBusy || objects.length === 0 || !orcaReady}
        title={orcaReady
          ? "Slice with both engines and see a side-by-side comparison"
          : "OrcaSlicer engine isn't available on this server — comparison needs both."}
        className="w-full h-9 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 border border-slate-700 disabled:cursor-not-allowed text-slate-200 font-semibold rounded transition-colors text-xs flex items-center justify-center gap-2"
      >
        <GitCompare size={14} />
        {compareBusy ? "Comparing engines…" : "Compare engines (Built-in vs Orca)"}
      </button>
      {error && (
        <div className="text-xs text-red-400 space-y-1" data-testid="popover-slice-error">
          {/* Render the fail-log endpoint (if the backend included one
              in the detail string) as an absolute clickable link so
              the user can grab the full OrcaSlicer log without having
              to copy-paste the path. The regex matches the format
              the backend emits: "...Full log: GET /api/slice/orca/fail-log/{job_id}". */}
          {(() => {
            const m = /\/api\/slice\/orca\/fail-log\/([\w-]+)/.exec(error);
            const before = m ? error.slice(0, m.index).replace(/\s*Full log:\s*GET\s*$/, "").trimEnd() : error;
            return (
              <>
                <div className="whitespace-pre-wrap">{before}</div>
                {m && (
                  <a
                    href={`${window.location.origin}${m[0]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="popover-slice-error-faillog"
                    className="inline-block text-orange-300 hover:text-orange-200 underline font-mono"
                  >
                    Open full OrcaSlicer log →
                  </a>
                )}
              </>
            );
          })()}
        </div>
      )}
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
          {/* Cancel button (iter-77). Sits inside the progress card so
              it only appears while a slice is actively running. Hitting
              this fires DELETE /api/slice/orca/job/{jobId} which kills
              the OrcaSlicer subprocess; the SSE stream then resolves
              with a 499 error and the busy spinner clears. Doesn't
              wait for the network round-trip — the click is fire-and-
              forget so the user gets immediate feedback. */}
          <button
            data-testid="popover-slice-cancel"
            onClick={() => orca.cancelActiveSlice()}
            className="w-full mt-1 text-[10px] text-rose-300 hover:text-rose-100 underline underline-offset-2"
          >
            Cancel slice
          </button>
        </div>
      )}
      {stats && (
        <div className="bg-slate-950 border border-slate-700 rounded p-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono" data-testid="popover-slice-stats">
          <span className="text-slate-500">Layers</span><span className="text-orange-400 text-right">{stats.layers}</span>
          <span className="text-slate-500">Segments</span><span className="text-orange-400 text-right">{stats.segments}</span>
          <span className="text-slate-500">Filament</span><span className="text-orange-400 text-right">{stats.filamentMM.toFixed(1)} mm</span>
        </div>
      )}
      {stats?.warnings && stats.warnings.length > 0 && (
        <div
          data-testid="popover-slice-warnings"
          className="bg-amber-500/10 border border-amber-500/50 rounded p-2 space-y-1.5"
        >
          <div className="flex items-start gap-2 text-[11px] text-amber-200 font-semibold leading-tight">
            <span className="mt-0.5">⚠</span>
            <span>OrcaSlicer reported {stats.warnings.length} warning{stats.warnings.length === 1 ? "" : "s"} — your GCODE may be missing geometry. Consider clicking <b>Lay Flat</b> in the Inspector and re-slicing, or open the project in OrcaSlicer Desktop for full control.</span>
          </div>
          <ul className="text-[10px] font-mono text-amber-300/90 list-disc pl-4 space-y-0.5 max-h-32 overflow-y-auto">
            {stats.warnings.slice(0, 8).map((w, i) => (
              <li key={i} data-testid={`popover-slice-warning-${i}`} className="break-words">{w}</li>
            ))}
            {stats.warnings.length > 8 && (
              <li className="text-amber-400/70">…and {stats.warnings.length - 8} more</li>
            )}
          </ul>
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
      <EngineComparisonDialog
        open={compareOpen}
        busy={compareBusy}
        result={compareResult}
        onClose={() => setCompareOpen(false)}
        onRerun={handleCompare}
      />
    </PopoverShell>
  );
}

// SlicerOrientationBadge — WYSIWYG-ish preview of what the slicer will
// actually see, computed from the current scene's combined AABB.
//
// Why: ForgeSlicer's workspace is Y-up; OrcaSlicer is Z-up. The
// exporter rotates +90° around X at slice time so the model's
// workspace-vertical axis becomes the slicer's vertical. That means
// what looks "lying flat" in workspace may end up standing tall in
// the slicer (and vice-versa). Showing the slicer-frame X/Y footprint
// + Z height right above the SLICE button closes the comprehension
// gap and lets the user spot a "tall thin tower" silhouette before
// it eats 4 hours of print time. Iter-79.
//
// Also surfaces a Lay-Flat shortcut when the model looks tall/thin
// (longest axis > 3× shortest) so the user fixes it in one click.
function SlicerOrientationBadge({ objects }) {
  const layFlatSelection = useScene((s) => s.layFlatSelection);

  const dims = useMemo(() => {
    if (!objects || objects.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let any = false;
    for (const o of objects) {
      if (o.visible === false) continue;
      try {
        const bb = computeRotatedBBox(o);
        const px = o.position[0], py = o.position[1], pz = o.position[2];
        const lo = [px + bb.min.x, py + bb.min.y, pz + bb.min.z];
        const hi = [px + bb.max.x, py + bb.max.y, pz + bb.max.z];
        if (lo[0] < minX) minX = lo[0];
        if (lo[1] < minY) minY = lo[1];
        if (lo[2] < minZ) minZ = lo[2];
        if (hi[0] > maxX) maxX = hi[0];
        if (hi[1] > maxY) maxY = hi[1];
        if (hi[2] > maxZ) maxZ = hi[2];
        any = true;
      } catch { /* skip */ }
    }
    if (!any || !Number.isFinite(minX)) return null;
    // Workspace (Y-up) → slicer (Z-up): exporter applies makeRotationX(+π/2),
    // so old +Y → new +Z and old +Z → new -Y. Net dimensional mapping
    // (extents only, ignoring sign): slicer X = workspace X,
    // slicer Y = workspace Z, slicer Z = workspace Y.
    const slicerX = maxX - minX;
    const slicerY = maxZ - minZ;
    const slicerZ = maxY - minY;
    return { slicerX, slicerY, slicerZ };
  }, [objects]);

  if (!dims) return null;
  const { slicerX, slicerY, slicerZ } = dims;
  const longest = Math.max(slicerX, slicerY, slicerZ);
  const shortest = Math.max(0.01, Math.min(slicerX, slicerY, slicerZ));
  // "Risky" silhouette: longest > 3× shortest AND the slicer-Z (vertical)
  // is the longest axis. That's the canonical "tall thin tower" that
  // makes OrcaSlicer drop layers, generate spindly supports, or fail
  // outright. Iter-79's MiniRack tray case is the prototype.
  const tallThin = longest > 3 * shortest && slicerZ >= longest - 1e-3;

  const onLayFlat = () => {
    // layFlatSelection falls back to "all visible objects" when
    // nothing is selected (store-level fallback added in iter-79).
    layFlatSelection(true);
  };

  return (
    <div
      data-testid="popover-slicer-orientation"
      className={`rounded p-2 text-[11px] font-mono space-y-1 border ${
        tallThin
          ? "bg-amber-500/10 border-amber-500/50"
          : "bg-slate-950 border-slate-700"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
          Slicer sees
        </div>
        <div className="text-slate-300">
          <span className="text-slate-500">X</span> {slicerX.toFixed(1)}
          <span className="text-slate-500 ml-2">Y</span> {slicerY.toFixed(1)}
          <span className="text-slate-500 ml-2">Z</span>{" "}
          <span className={tallThin ? "text-amber-300 font-semibold" : ""}>
            {slicerZ.toFixed(1)}
          </span>{" "}
          <span className="text-slate-500">mm</span>
        </div>
      </div>
      {tallThin && (
        <div className="flex items-start gap-2 pt-1 border-t border-amber-500/20">
          <span className="text-amber-200 text-[10px] leading-tight flex-1">
            Tall &amp; thin silhouette ({(longest / shortest).toFixed(1)}× aspect ratio) — OrcaSlicer may drop geometry or generate spindly supports. Consider laying it flat.
          </span>
          <button
            data-testid="popover-slice-quick-lay-flat-btn"
            onClick={onLayFlat}
            className="h-7 px-2 bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-semibold rounded flex items-center gap-1 whitespace-nowrap"
          >
            <Layers size={11} /> Lay Flat
          </button>
        </div>
      )}
    </div>
  );
}


import React from "react";
import { Download, FileBox, Layers, FileText, Wand2 } from "lucide-react";
import { PaletteEditor } from "./PaletteEditor";
import { JobHistory } from "./JobHistory";
import { HelpHint } from "./HelpHint";
import { LibraryMatchPanel } from "./LibraryMatchPanel";
import { CostSwapSimulator } from "./CostSwapSimulator";
import { ForgeSlicerSendButton } from "./ForgeSlicerSendButton";
import { exportUrl } from "../lib/api";
import { useQuota } from "../lib/quota";

const DeltaBadge = ({ label, value, accent }) => (
  <div className="panel-muted p-3 space-y-1">
    <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
      {label}
    </div>
    <div className="flex items-baseline gap-2">
      <span
        className="font-mono text-2xl font-bold tabular-nums"
        style={{ color: accent }}
      >
        {value.toFixed(2)}
      </span>
      <span className="font-mono text-[10px] text-zinc-500">ΔE</span>
    </div>
  </div>
);

/** Predicted back-light brightness — green ≥8%, amber 4-8%, red <4%. */
const ThroughputBadge = ({ value }) => {
  const pct = Math.max(0, Math.min(100, value));
  const accent = pct >= 8 ? "#22c55e" : pct >= 4 ? "#f59e0b" : "#ef4444";
  const verdict =
    pct >= 12
      ? "Bright"
      : pct >= 8
        ? "Recommended"
        : pct >= 4
          ? "Dim — consider reducing thickness"
          : "Opaque — increase translucent filaments";
  return (
    <div
      className="panel-muted p-3 space-y-1"
      data-testid="light-throughput-badge"
    >
      <div className="flex items-center justify-between">
        <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">
          Light throughput
        </div>
        <div
          className="text-[9px] font-mono uppercase tracking-[0.15em]"
          style={{ color: accent }}
        >
          {pct >= 8 ? "OK" : pct >= 4 ? "LOW" : "BAD"}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="font-mono text-2xl font-bold tabular-nums"
          style={{ color: accent }}
          data-testid="light-throughput-value"
        >
          {pct.toFixed(1)}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">% (deepest)</span>
      </div>
      <div className="font-mono text-[9px] text-zinc-500 leading-tight">
        {verdict}
      </div>
    </div>
  );
};

const quality = (de) => {
  if (de < 2) return { label: "IMPERCEPTIBLE", color: "#22c55e" };
  if (de < 5) return { label: "VERY CLOSE", color: "#84cc16" };
  if (de < 10) return { label: "ACCEPTABLE", color: "#eab308" };
  if (de < 20) return { label: "NOTICEABLE", color: "#f97316" };
  return { label: "FAR", color: "#ef4444" };
};

/**
 * Browser-portable download helper.
 *
 * 1. Fetch the file with credentials so we can catch 401/402 (quota/auth)
 *    BEFORE attempting a browser download. The backend's quota counter
 *    increments on every successful GET, so we can't HEAD-preflight.
 * 2. On desktop, trigger the classic `<a download>` synthetic click.
 * 3. On iOS / iPadOS WebKit (Safari, Chrome, Firefox all use WebKit on
 *    iOS), the `download` attribute is silently ignored — the file
 *    either opens in the same tab or nothing happens, which the user
 *    perceives as "export failed". Instead, open the blob URL in a new
 *    tab so the browser's native "Share → Save to Files" UI surfaces.
 *    Fall back to in-place navigation if popups are blocked.
 */
const isIOSWebKit = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as Mac — distinguishable by touch support.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
};

const downloadFile = async (url, filename) => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const status = res.status;
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail?.error || body?.detail?.message || body?.detail || "";
    } catch {
      /* ignore */
    }
    const err = new Error(detail || `Download failed (${status})`);
    err.status = status;
    err.detail = detail;
    throw err;
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  if (isIOSWebKit()) {
    // iOS workaround: open the blob in a new tab. The browser's native
    // viewer/sheet then offers Share → Save to Files.
    const win = window.open(blobUrl, "_blank");
    if (!win || win.closed || typeof win.closed === "undefined") {
      // Popup blocked — navigate in-place. The user loses the studio
      // tab temporarily but at least gets the file.
      window.location.href = blobUrl;
    }
  } else {
    // Desktop / Android: classic synthetic anchor click. DO NOT add
    // `target=_blank` — combined with `download` it can confuse Chrome's
    // popup blocker (the user-gesture chain is broken by the async
    // fetch above), causing the download to be silently blocked.
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Hold the blob URL alive long enough for the new tab to fully parse
  // the binary on slower iPads.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
};

const DownloadButton = ({ url, filename, icon: Icon, label, sub, testid }) => {
  const [busy, setBusy] = React.useState(false);
  const { refresh, showUpgrade } = useQuota();
  const onClick = async (e) => {
    e.preventDefault();
    if (!url || busy) return;
    setBusy(true);
    try {
      await downloadFile(url, filename);
      // Successful download — bump the quota counter in the header
      // and show a confirmation toast so users know the file landed
      // (Chrome's download dock can be easy to miss if collapsed).
      refresh();
      try {
        (await import("sonner")).toast.success(`Downloaded ${filename}`, {
          duration: 3500,
        });
      } catch {
        /* sonner unavailable — silent */
      }
    } catch (err) {
      // 401 (sign-in required) and 402 (quota exhausted) both open the
      // upgrade/sign-in modal. Everything else surfaces as a toast.
      if (err.status === 401 || err.status === 402) {
        showUpgrade();
      } else {
        try {
          (await import("sonner")).toast.error(err.message || "Download failed");
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!url || busy}
      data-testid={testid}
      className="group w-full flex items-center gap-3 p-3 panel-muted hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 text-left"
    >
      <div className="w-9 h-9 border border-zinc-800 flex items-center justify-center group-hover:bg-zinc-100 group-hover:text-zinc-950 transition-colors duration-150">
        <Icon className="w-4 h-4" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold uppercase tracking-[0.12em]">{label}</div>
        <div className="font-mono text-[10px] text-zinc-500 truncate">
          {busy ? "Preparing…" : sub}
        </div>
      </div>
      <Download
        className="w-4 h-4 text-zinc-600 group-hover:text-zinc-200 transition-colors duration-150"
        strokeWidth={1.5}
      />
    </button>
  );
};

export const StatsPanel = ({
  result,
  filaments,
  setFilaments,
  maxActive,
  autoOrder,
  setAutoOrder,
  onSuggestPalette,
  suggesting,
  canSuggest,
  vibrancy,
  setVibrancy,
  onPaletteSizeChange,
  onRestoreJob,
  baseMinLayers,
  geometry,
  boxDiffuser,
}) => {
  const q = result ? quality(result.delta_e_mean) : null;

  return (
    <div
      className="h-full overflow-y-auto p-5 space-y-6"
      data-testid="stats-panel"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 flex items-center gap-1.5">
            AI palette
            <HelpHint title="Palette suggestion modes" testId="help-palette">
              <strong className="text-zinc-200">Accurate</strong>: lowest
              ΔE — best for muted, true-to-life photographs.
              <br /><br />
              <strong className="text-zinc-200">Balanced</strong>:
              compromise between ΔE accuracy and saturated picks.
              <br /><br />
              <strong className="text-zinc-200">Vibrant</strong>: spreads
              picks around the hue-wheel — best for posters, illustrations
              and anything with bold primary colors.
            </HelpHint>
          </div>
        </div>
        <div className="grid grid-cols-3 border border-zinc-800" data-testid="vibrancy-toggle">
          {[
            { id: 0.0, label: "Accurate" },
            { id: 0.5, label: "Balanced" },
            { id: 1.0, label: "Vibrant" },
          ].map((opt, i) => {
            const active = Math.abs(opt.id - vibrancy) < 0.05;
            return (
              <button
                key={opt.id}
                onClick={() => setVibrancy(opt.id)}
                data-testid={`vibrancy-${opt.label.toLowerCase()}`}
                className={`px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors duration-150 ${
                  active
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
                } ${i > 0 ? "border-l border-zinc-800" : ""}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={onSuggestPalette}
          disabled={!canSuggest || suggesting}
          data-testid="suggest-palette-btn"
          className="w-full flex items-center justify-center gap-2 border border-zinc-700 hover:border-zinc-400 hover:bg-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-zinc-700 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-200 transition-colors duration-150"
        >
          <Wand2 className="w-3 h-3" strokeWidth={1.5} />
          {suggesting ? "Analyzing…" : "Suggest palette from photo"}
        </button>
        {!canSuggest && !suggesting && (
          <div className="font-mono text-[9px] text-zinc-600 text-center">
            Upload a photograph first
          </div>
        )}
      </div>

      <PaletteEditor
        filaments={filaments}
        setFilaments={setFilaments}
        maxActive={maxActive}
        autoOrder={autoOrder}
        setAutoOrder={setAutoOrder}
        onPaletteSizeChange={onPaletteSizeChange}
      />

      <LibraryMatchPanel
        palette={filaments.slice(0, maxActive)}
        scope="mine"
        testIdSuffix=""
        emptyHint="Sign in and add your filaments to see whether this palette is reproducible on your printer."
      />

      <div className="border-t border-zinc-800" />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
            Color fidelity
          </span>
          {q && (
            <span
              className="font-mono text-[10px] font-bold tracking-[0.15em]"
              style={{ color: q.color }}
              data-testid="fidelity-label"
            >
              {q.label}
            </span>
          )}
        </div>
        {result ? (
          <div className="grid grid-cols-2 gap-2">
            <DeltaBadge
              label="Mean"
              value={result.delta_e_mean}
              accent={q.color}
            />
            <DeltaBadge
              label="95th pct"
              value={result.delta_e_p95}
              accent="#a1a1aa"
            />
          </div>
        ) : (
          <div className="panel-muted p-4 text-center">
            <div className="text-xs text-zinc-500">
              Run optimization to see ΔE stats
            </div>
          </div>
        )}
        {result && typeof result.light_throughput_pct === "number" && (
          <ThroughputBadge value={result.light_throughput_pct} />
        )}
      </div>

      <div className="border-t border-zinc-800" />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
            Layer allocation
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            {result ? `${result.total_layers} layers` : "—"}
          </span>
        </div>
        {result ? (
          <div className="space-y-1.5" data-testid="allocation-list">
            {result.timeline.map((t, i) => {
              const pct = result.total_layers > 0
                ? (t.layers / result.total_layers) * 100
                : 0;
              return (
                <div
                  key={`${t.name}-${i}`}
                  className="flex items-center gap-2 font-mono text-[11px]"
                  data-testid={`allocation-row-${i}`}
                >
                  <div
                    className="w-3 h-3 border border-zinc-700"
                    style={{ background: t.color }}
                  />
                  <span className="text-zinc-300 flex-1 truncate">{t.name}</span>
                  <span
                    className="text-emerald-300 tabular-nums w-10 text-right"
                    data-testid={`allocation-usage-${i}`}
                    title="Percentage of total layers using this filament"
                  >
                    {pct.toFixed(0)}%
                  </span>
                  <span className="text-zinc-500 tabular-nums w-8 text-right">
                    {t.layers}×
                  </span>
                  <span className="text-zinc-600 tabular-nums w-20 text-right">
                    {t.start_z_mm.toFixed(2)}–{t.end_z_mm.toFixed(2)}mm
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="panel-muted p-4 text-center text-xs text-zinc-500">
            —
          </div>
        )}
      </div>

      {result?.cost_estimate && (
        <>
          <div className="border-t border-zinc-800" />
          <div className="space-y-3" data-testid="cost-estimate-panel">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                Print estimate
              </span>
              <span
                className="font-mono text-[9px] text-zinc-600 uppercase tracking-[0.15em]"
                title="Heuristic — slicer is the source of truth"
              >
                Heuristic
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="panel-muted p-2.5">
                <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-500">
                  Print time
                </div>
                <div
                  className="font-mono text-sm text-zinc-100 tabular-nums mt-0.5"
                  data-testid="cost-time"
                >
                  {(() => {
                    const m = Math.round(result.cost_estimate.total_time_minutes);
                    const hh = Math.floor(m / 60);
                    const mm = m % 60;
                    return hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
                  })()}
                </div>
              </div>
              <div className="panel-muted p-2.5">
                <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-500">
                  Filament
                </div>
                <div
                  className="font-mono text-sm text-zinc-100 tabular-nums mt-0.5"
                  data-testid="cost-weight"
                >
                  {result.cost_estimate.total_weight_g.toFixed(1)}
                  <span className="text-zinc-600 text-xs ml-1">g</span>
                </div>
              </div>
              <div className="panel-muted p-2.5">
                <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-500">
                  Cost
                </div>
                <div
                  className="font-mono text-sm text-amber-200 tabular-nums mt-0.5"
                  data-testid="cost-usd"
                >
                  ${result.cost_estimate.total_cost_usd.toFixed(2)}
                </div>
              </div>
            </div>
            <CostSwapSimulator costEstimate={result.cost_estimate} />
            <div className="font-mono text-[9px] text-zinc-600 leading-tight">
              Click the ⇄ icon to swap any filament against your library and see live cost changes. Assumes Ø1.75mm filament · 12mm/s extruder throughput · 90s per colour swap. Real prints vary ±20%.
            </div>
          </div>
        </>
      )}

      <div className="border-t border-zinc-800" />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
            Export
          </div>
          {result && result.void_pixels > 0 && (
            <div
              data-testid="voids-badge"
              title={`${result.void_pixels.toLocaleString()} pixel${
                result.void_pixels === 1 ? "" : "s"
              } resolved to 0 layers — the Base fill slider in the Geometry panel will print ${baseMinLayers ?? 2} layer${
                (baseMinLayers ?? 2) === 1 ? "" : "s"
              } of base filament under each, so the slice has no holes.`}
              className="flex items-center gap-1 px-2 py-1 border border-amber-700/50 text-amber-200 font-mono text-[9px] uppercase tracking-[0.15em]"
            >
              <span className="w-1 h-1 rounded-full bg-amber-300 animate-pulse" />
              Voids · {result.void_pixels.toLocaleString()} px → {baseMinLayers ?? 2}L base
            </div>
          )}
        </div>
        <div className="space-y-2">
          <DownloadButton
            url={result ? exportUrl(result.job_id, "stl", { baseMinLayers }) : null}
            filename={result ? `lithophane_${result.job_id}.stl` : "lithophane.stl"}
            icon={FileBox}
            label="STL mesh"
            sub="Heightmap geometry"
            testid="download-stl"
          />
          <DownloadButton
            url={result ? exportUrl(result.job_id, "swaps", { baseMinLayers }) : null}
            filename={result ? `lithophane_${result.job_id}_swaps.txt` : "lithophane_swaps.txt"}
            icon={FileText}
            label="Swap instructions"
            sub="Paste-ready for Prusa/Orca/Bambu/Cura"
            testid="download-swaps"
          />
          <DownloadButton
            url={result ? exportUrl(result.job_id, "3mf", { baseMinLayers }) : null}
            filename={result ? `lithophane_${result.job_id}.3mf` : "lithophane.3mf"}
            icon={Layers}
            label="3MF bundle"
            sub={`Mesh + auto-pause · ${baseMinLayers ?? 2}-layer base fill`}
            testid="download-3mf"
          />
          {geometry === "box" && (
            <>
              <div
                className="pt-3 mt-2 border-t border-amber-700/30 text-[9px] uppercase tracking-[0.18em] text-amber-200/70 font-mono"
                data-testid="lightbox-downloads-header"
              >
                Lightbox parts · print separately
              </div>
              <DownloadButton
                url={result ? exportUrl(result.job_id, "lightbox-frame", { baseMinLayers }) : null}
                filename={result ? `lithophane_${result.job_id}_lightbox_frame.stl` : "lightbox_frame.stl"}
                icon={FileBox}
                label="Lightbox frame"
                sub="Print front-face-down · no supports"
                testid="download-lightbox-frame"
              />
              <DownloadButton
                url={result ? exportUrl(result.job_id, "lightbox-back", { baseMinLayers }) : null}
                filename={result ? `lithophane_${result.job_id}_lightbox_back.stl` : "lightbox_back.stl"}
                icon={FileBox}
                label="Back panel"
                sub="Slide-in · 6 mm cable notch"
                testid="download-lightbox-back"
              />
              {(boxDiffuser ?? true) && (
                <DownloadButton
                  url={result ? exportUrl(result.job_id, "lightbox-diffuser", { baseMinLayers }) : null}
                  filename={result ? `lithophane_${result.job_id}_lightbox_diffuser.stl` : "lightbox_diffuser.stl"}
                  icon={FileBox}
                  label="Diffuser"
                  sub="Translucent PLA · 0% infill · 4 walls"
                  testid="download-lightbox-diffuser"
                />
              )}
            </>
          )}
        </div>
        {result?.job_id && (
          <div
            className="pt-3 mt-3 border-t border-amber-400/20"
            data-testid="forgeslicer-send-section"
          >
            <div className="text-[10px] uppercase tracking-[0.18em] text-amber-200/70 font-mono mb-2 flex items-center justify-between">
              <span>Route to slicer</span>
              <a
                href="https://forgeslicer.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-zinc-500 hover:text-amber-200 transition-colors normal-case tracking-normal"
              >
                forgeslicer.com ↗
              </a>
            </div>
            <ForgeSlicerSendButton
              result={result}
              geometry={geometry}
              boxDiffuser={boxDiffuser}
            />
          </div>
        )}
        {!result && (
          <div className="font-mono text-[10px] text-zinc-600 text-center pt-1">
            Generate a lithophane first
          </div>
        )}
      </div>

      {/* My Jobs history — only renders when the user is logged in */}
      {onRestoreJob && (
        <div className="panel p-4 space-y-3">
          <JobHistory onRestore={onRestoreJob} />
        </div>
      )}
    </div>
  );
};

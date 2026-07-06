// Lithophane Studio — in-app modal that owns the LithoForge pipeline
// (image → CMYKW → STL/3MF). Sends the resulting STL onto ForgeSlicer's
// build plate via the standard import pipeline.
//
// Design intent: dense, keyboard-friendly, no wizard steps. The whole
// workflow (upload → tweak → generate → download / send) fits in one
// modal so it feels first-party rather than a bolted-on sub-app.

import React, { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  X, Upload, Loader2, Download, Send, Sparkles, ImagePlus, Trash2,
} from "lucide-react";
import {
  getDefaultFilaments, getPrinters,
  uploadImageAsFile, optimizeLitho, downloadLithoFile, suggestPalette,
} from "../lib/lithoStudioApi";
import { importAnyMeshFile } from "../lib/exporters";
import { useScene } from "../lib/store";

const DEFAULT_CONFIG = {
  width_mm: 100,
  height_mm: 100,
  thickness_mm: 2.2,
  border_mm: 2,
  layer_height_mm: 0.12,
  max_swaps: 5,
  geometry: "flat",
  curve_radius_mm: 80,
  render_mode: "lithophane",
  relief: 0.5,
  printer_id: "generic_orca",
  nozzle_mm: 0.4,
};

export default function LithoStudioModal({ open, onClose }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [filaments, setFilaments] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [sourceFilename, setSourceFilename] = useState("");
  const [imageId, setImageId] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const fileInputRef = useRef(null);
  const addImportedMesh = useScene((s) => s.addImportedMesh);

  // Load defaults on open.
  useEffect(() => {
    if (!open) return;
    Promise.all([getDefaultFilaments(), getPrinters()])
      .then(([f, p]) => {
        setFilaments(f);
        setPrinters(p);
      })
      .catch(() => toast.error("Failed to load Lithophane defaults"));
  }, [open]);

  // Reset when closed.
  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleReset = () => {
    setSourceUrl(null);
    setSourceFilename("");
    setImageId(null);
    setResult(null);
    setConfig(DEFAULT_CONFIG);
  };

  const handleFile = async (file) => {
    if (!file?.type?.startsWith?.("image/")) {
      toast.error("Please choose an image file (PNG/JPG)");
      return;
    }
    setBusy(true);
    setBusyLabel("Uploading…");
    setResult(null);
    try {
      const url = URL.createObjectURL(file);
      setSourceUrl(url);
      setSourceFilename(file.name);
      const data = await uploadImageAsFile(file);
      setImageId(data.image_id);
      toast.success(`Loaded ${data.width}×${data.height} image`);
    } catch (e) {
      toast.error("Upload failed", { description: e.message });
      setSourceUrl(null);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const handleSuggestPalette = async () => {
    if (!imageId) return;
    setBusy(true);
    setBusyLabel("Suggesting palette…");
    try {
      const chosen = await suggestPalette(imageId, config.max_swaps + 1, 0.5);
      setFilaments(chosen);
      toast.success(`Palette: ${chosen.map((f) => f.name).join(" · ")}`);
    } catch (e) {
      toast.error("Palette suggestion failed", { description: e.message });
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const handleGenerate = async () => {
    if (!imageId) {
      toast.error("Upload an image first");
      return;
    }
    setBusy(true);
    setBusyLabel("Optimizing…");
    try {
      const payload = {
        image_id: imageId,
        ...config,
        filaments: filaments.slice(0, config.max_swaps + 1),
        auto_order: true,
      };
      const data = await optimizeLitho(payload);
      setResult(data);
      toast.success(`Optimized · ΔE ${data.delta_e_mean.toFixed(2)} · ${data.total_layers} layers`);
    } catch (e) {
      toast.error("Optimization failed", { description: e.message });
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const handleDownload = async (kind) => {
    if (!result?.job_id) return;
    setBusy(true);
    setBusyLabel(`Building ${kind.toUpperCase()}…`);
    try {
      const blob = await downloadLithoFile(result.job_id, kind, {
        printer: config.printer_id,
      });
      const ext = kind === "swaps" ? "txt" : kind;
      const suggestedName = (sourceFilename?.replace(/\.[^.]+$/, "") || "lithophane") +
        (kind === "swaps" ? "_swaps" : "") + "." + ext;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Downloaded ${suggestedName}`);
    } catch (e) {
      toast.error(`Download failed`, { description: e.message });
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const handleSendToWorkspace = async () => {
    if (!result?.job_id) return;
    setBusy(true);
    setBusyLabel("Sending to build plate…");
    try {
      const blob = await downloadLithoFile(result.job_id, "stl", {
        printer: config.printer_id,
      });
      const name = (sourceFilename?.replace(/\.[^.]+$/, "") || "lithophane") + ".stl";
      const file = new File([blob], name, { type: "model/stl" });
      const mesh = await importAnyMeshFile(file);
      addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
      toast.success("Lithophane placed on build plate");
      handleClose();
    } catch (e) {
      toast.error("Send to workspace failed", { description: e.message });
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  if (!open) return null;

  const cfg = (k, v) => setConfig((c) => ({ ...c, [k]: v }));

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
      data-testid="litho-studio-modal"
    >
      <div
        className="bg-slate-950 border border-slate-800 rounded-lg shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-gradient-to-r from-orange-950/50 to-slate-900">
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} className="text-orange-400" />
            <div>
              <div className="text-sm font-semibold text-white">Lithophane Studio</div>
              <div className="text-[11px] text-slate-400">Image → CMYKW filament-swap lithophane</div>
            </div>
          </div>
          <button
            data-testid="litho-close-btn"
            onClick={handleClose}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-0 min-h-0">
          {/* Left panel: config */}
          <div className="border-r border-slate-800 overflow-y-auto p-4 space-y-4 min-h-0" data-testid="litho-config-panel">
            <ConfigSection title="Print Size">
              <NumRow label="Width (mm)" value={config.width_mm} onChange={(v) => cfg("width_mm", v)} min={20} max={300} testid="litho-width" />
              <NumRow label="Height (mm)" value={config.height_mm} onChange={(v) => cfg("height_mm", v)} min={20} max={300} testid="litho-height" />
              <NumRow label="Thickness (mm)" value={config.thickness_mm} onChange={(v) => cfg("thickness_mm", v)} min={1} max={8} step={0.1} testid="litho-thickness" />
              <NumRow label="Border (mm)" value={config.border_mm} onChange={(v) => cfg("border_mm", v)} min={0} max={20} step={0.5} testid="litho-border" />
            </ConfigSection>

            <ConfigSection title="Layers & Swaps">
              <NumRow label="Layer Height (mm)" value={config.layer_height_mm} onChange={(v) => cfg("layer_height_mm", v)} min={0.04} max={0.32} step={0.02} testid="litho-layer-height" />
              <NumRow label="Max Filament Swaps" value={config.max_swaps} onChange={(v) => cfg("max_swaps", v)} min={0} max={7} step={1} testid="litho-max-swaps" />
              <SelRow label="Render Mode" value={config.render_mode} onChange={(v) => cfg("render_mode", v)} testid="litho-render-mode" options={[
                ["lithophane", "Backlit lithophane"],
                ["painting", "Front-lit painting"],
              ]} />
            </ConfigSection>

            <ConfigSection title="Geometry">
              <SelRow label="Shape" value={config.geometry} onChange={(v) => cfg("geometry", v)} testid="litho-geometry" options={[
                ["flat", "Flat panel"],
                ["curved", "Curved panel"],
                ["cylindrical", "Cylinder"],
                ["disc", "Disc"],
              ]} />
              {(config.geometry === "curved" || config.geometry === "cylindrical") && (
                <NumRow label="Curve radius (mm)" value={config.curve_radius_mm} onChange={(v) => cfg("curve_radius_mm", v)} min={20} max={300} step={1} testid="litho-curve-radius" />
              )}
            </ConfigSection>

            <ConfigSection title="Printer">
              <SelRow label="Target" value={config.printer_id} onChange={(v) => cfg("printer_id", v)} testid="litho-printer" options={printers.map((p) => [p.id, p.name])} />
            </ConfigSection>
          </div>

          {/* Middle: preview + actions */}
          <div className="overflow-y-auto p-4 min-h-0 flex flex-col gap-3">
            <div className="rounded border border-dashed border-slate-700 bg-slate-900/40 flex-1 flex items-center justify-center relative min-h-[280px]" data-testid="litho-preview-region">
              {busy && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 z-10">
                  <Loader2 size={28} className="animate-spin text-orange-400" />
                  <div className="text-xs text-slate-300 font-mono">{busyLabel}</div>
                </div>
              )}
              {!sourceUrl && !result && (
                <button
                  data-testid="litho-upload-cta"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 text-slate-400 hover:text-orange-400 transition"
                >
                  <ImagePlus size={36} />
                  <div className="text-sm">Upload an image</div>
                  <div className="text-[11px] text-slate-500">PNG or JPG · high-contrast portraits work best</div>
                </button>
              )}
              {result?.preview_png_base64 ? (
                <img
                  data-testid="litho-preview-img"
                  src={`data:image/png;base64,${result.preview_png_base64}`}
                  alt="Lithophane preview"
                  className="max-w-full max-h-[420px] object-contain"
                />
              ) : sourceUrl ? (
                <img
                  data-testid="litho-source-img"
                  src={sourceUrl}
                  alt="Source"
                  className="max-w-full max-h-[420px] object-contain opacity-90"
                />
              ) : null}
            </div>

            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              data-testid="litho-file-input"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                data-testid="litho-choose-file-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="h-9 px-3 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                <Upload size={14} /> {imageId ? "Replace image" : "Choose image"}
              </button>
              {imageId && (
                <button
                  data-testid="litho-suggest-palette-btn"
                  onClick={handleSuggestPalette}
                  disabled={busy}
                  className="h-9 px-3 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles size={14} className="text-amber-400" /> Suggest palette
                </button>
              )}
              {(imageId || result) && (
                <button
                  data-testid="litho-reset-btn"
                  onClick={handleReset}
                  disabled={busy}
                  className="h-9 px-3 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 size={13} /> Reset
                </button>
              )}
              <div className="flex-1" />
              <button
                data-testid="litho-generate-btn"
                onClick={handleGenerate}
                disabled={!imageId || busy}
                className="h-9 px-4 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles size={14} /> Generate lithophane
              </button>
            </div>
          </div>

          {/* Right panel: palette + results */}
          <div className="border-l border-slate-800 overflow-y-auto p-4 space-y-4 min-h-0" data-testid="litho-results-panel">
            <div>
              <div className="text-xs font-semibold text-slate-300 mb-2">Filament order (bottom → top)</div>
              <div className="space-y-1.5">
                {filaments.slice(0, config.max_swaps + 1).map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded px-2 py-1.5"
                    data-testid={`litho-filament-${i}`}
                  >
                    <div
                      className="w-5 h-5 rounded border border-slate-700"
                      style={{ background: f.hex }}
                    />
                    <div className="flex-1 text-[12px] text-slate-200">{f.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">TD {f.td}</div>
                  </div>
                ))}
              </div>
            </div>

            {result && (
              <>
                <div className="rounded bg-slate-900 border border-slate-800 p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-300">Result</div>
                  <StatRow k="ΔE mean" v={result.delta_e_mean.toFixed(2)} />
                  <StatRow k="ΔE p95" v={result.delta_e_p95.toFixed(2)} />
                  <StatRow k="Total layers" v={result.total_layers} />
                  <StatRow k="Backlight" v={`${result.light_throughput_pct?.toFixed?.(1) ?? 0}%`} />
                  {result.cost_estimate && (
                    <>
                      <StatRow k="Est. print time" v={result.cost_estimate.print_time_pretty || "—"} />
                      <StatRow k="Est. filament" v={result.cost_estimate.total_filament_pretty || "—"} />
                    </>
                  )}
                </div>

                <div className="space-y-1.5">
                  <button
                    data-testid="litho-send-to-workspace-btn"
                    onClick={handleSendToWorkspace}
                    disabled={busy}
                    className="w-full h-9 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow disabled:opacity-40"
                  >
                    <Send size={14} /> Send to build plate
                  </button>
                  <div className="grid grid-cols-3 gap-1.5">
                    <DownloadBtn testid="litho-dl-stl" onClick={() => handleDownload("stl")} disabled={busy}>STL</DownloadBtn>
                    <DownloadBtn testid="litho-dl-3mf" onClick={() => handleDownload("3mf")} disabled={busy}>3MF</DownloadBtn>
                    <DownloadBtn testid="litho-dl-swaps" onClick={() => handleDownload("swaps")} disabled={busy}>swaps.txt</DownloadBtn>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigSection({ title, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-orange-400 font-semibold mb-1.5">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function NumRow({ label, value, onChange, min, max, step = 1, testid }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-slate-300">
      <span className="flex-1">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-20 h-7 px-1.5 rounded bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-orange-500 outline-none"
        data-testid={testid}
      />
    </label>
  );
}

function SelRow({ label, value, onChange, options, testid }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-slate-300">
      <span className="flex-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 px-1.5 rounded bg-slate-950 border border-slate-800 text-white text-xs focus:border-orange-500 outline-none max-w-[170px]"
        data-testid={testid}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function StatRow({ k, v }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-slate-400">{k}</span>
      <span className="text-white font-mono">{v}</span>
    </div>
  );
}

function DownloadBtn({ children, onClick, testid, disabled }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className="h-8 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-semibold flex items-center justify-center gap-1 disabled:opacity-40"
    >
      <Download size={12} /> {children}
    </button>
  );
}

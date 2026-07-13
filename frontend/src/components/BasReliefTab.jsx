/**
 * Iter-137 — Bas-Relief tab body, extracted from AIGenerateDialog.jsx.
 *
 * Owns:
 *   - the file input for the reference image (delegates the actual
 *     FileReader work to the parent via `onImagePick` so the parent
 *     can keep image state shared between the From-Image and Bas-Relief
 *     tabs — users can flip between them without re-picking a file).
 *   - all Bas-Relief sliders (diameter, relief height, base thickness,
 *     smoothing, invert) plus the optional Frame Ring block.
 *   - the submit pipeline (POST /api/ai/generate/bas-relief → import
 *     STL bytes into the scene → close dialog).
 *
 * Exposes:
 *   - an imperative `submit()` handle via ref so the parent's shared
 *     footer CTA can trigger generation without duplicating slider
 *     state up the tree.
 *
 * Rationale: AIGenerateDialog had grown past 1200 lines; extracting
 * this ~200-line self-contained pipeline keeps the parent focused on
 * job polling / provider selection and lets the bas-relief tab
 * evolve independently (e.g. additional presets, texture upload,
 * pattern overlay in future iterations).
 */
import React, { forwardRef, useImperativeHandle, useState } from "react";
import axios from "axios";
import JSZip from "jszip";
import { toast } from "sonner";
import { API } from "../lib/api";
import { useScene } from "../lib/store";
import { importAnyMeshFile } from "../lib/exporters";

const BasReliefTab = forwardRef(function BasReliefTab(
  { imageB64, imageMime, imagePreviewUrl, onImagePick, setBusy, setError, onSuccess },
  ref,
) {
  // Iter-136 defaults — the user's stated typical: 220 mm × (3 mm base + 12
  // mm relief = 15 mm total). "dark_is_high" defaults false because most
  // reference photos read better with light-is-high (bright subject pops
  // out of a dark background).
  const [basDiameter, setBasDiameter] = useState(220);
  const [basRelief, setBasRelief] = useState(12);
  const [basBaseThickness, setBasBaseThickness] = useState(3);
  const [basDarkIsHigh, setBasDarkIsHigh] = useState(false);
  const [basSmooth, setBasSmooth] = useState(1.0);
  // Iter-136.1 — Frame ring (Japanese Cork Art wooden border).
  const [basRingEnabled, setBasRingEnabled] = useState(false);
  const [basRingWidth, setBasRingWidth] = useState(10);
  const [basRingHeight, setBasRingHeight] = useState(5);

  const addImportedMesh = useScene((s) => s.addImportedMesh);

  // LOCAL geometry pipeline — no fal.ai / no Meshy — see
  // /app/backend/bas_relief_service.py. Returns STL bytes directly (no
  // polling). Scaling is intentionally NOT applied because the user
  // picked the exact mm diameter they want.
  const submit = async () => {
    if (!imageB64) {
      setError("Choose a reference image first (from the file picker below).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const resp = await axios.post(`${API}/ai/generate/bas-relief`, {
        image_b64: imageB64,
        mime_type: imageMime || "image/png",
        diameter_mm: Number(basDiameter),
        max_relief_mm: Number(basRelief),
        base_thickness_mm: Number(basBaseThickness),
        dark_is_high: !!basDarkIsHigh,
        smooth_sigma: Number(basSmooth),
        grid_size: 512,
        ring_enabled: !!basRingEnabled,
        ring_width_mm: Number(basRingWidth),
        ring_height_mm: Number(basRingHeight),
      }, {
        withCredentials: true,
        responseType: "blob",
      });

      // Iter-138 — Backend bundles medallion + ring as a ZIP when the
      // ring is enabled so we can import each as a SEPARATE scene
      // object (user request: print in different colours / swap
      // frames). Single-STL responses stay legacy-compatible.
      const contentType = (resp.headers?.["content-type"] || resp.data?.type || "").toLowerCase();
      const isZip = contentType.includes("zip");
      const parts = [];
      if (isZip) {
        const zip = await JSZip.loadAsync(resp.data);
        // Preserve a stable insertion order — medallion first, ring second.
        for (const name of ["medallion.stl", "ring.stl"]) {
          const entry = zip.file(name);
          if (entry) parts.push({ name, blob: await entry.async("blob") });
        }
        // Fallback: iterate any *.stl entries the backend might rename later.
        if (parts.length === 0) {
          const stlEntries = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith(".stl"));
          for (const e of stlEntries) parts.push({ name: e.name, blob: await e.async("blob") });
        }
      } else {
        parts.push({ name: `bas-relief-${Date.now().toString(36)}.stl`, blob: resp.data });
      }
      if (parts.length === 0) throw new Error("No STL parts returned by the server.");

      for (const p of parts) {
        const file = new File([p.blob], p.name, { type: "model/stl" });
        const mesh = await importAnyMeshFile(file);
        addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
      }

      const isSplit = parts.length > 1;
      toast?.success?.(
        isSplit
          ? `Bas-relief bundle imported (${parts.length} parts)`
          : "Bas-relief disk ready",
        {
          description: isSplit
            ? `${basDiameter} mm medallion + ${Number(basRingWidth) * 2 + Number(basDiameter)} mm ring · both dropped on the plate`
            : `${basDiameter} mm × ${(Number(basBaseThickness) + Number(basRelief)).toFixed(1)} mm thick · imported to the plate`,
        },
      );
      onSuccess?.();
    } catch (e) {
      // Bas-relief 502 / 400 errors deliver a JSON blob when responseType
      // is 'blob' — parse it back so the user sees a useful detail.
      let detail = e?.response?.data?.detail || e.message || "Bas-relief generation failed";
      if (e?.response?.data instanceof Blob) {
        try { detail = JSON.parse(await e.response.data.text()).detail || detail; } catch { /* keep default */ }
      }
      setError(detail);
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    submit,
    isReady: () => !!imageB64,
  }));

  return (
    <div className="space-y-3" data-testid="ai-bas-relief-panel">
      <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Reference Image</label>
      <input
        data-testid="ai-bas-relief-image-input"
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        onChange={(e) => onImagePick(e.target.files?.[0])}
        className="block w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-amber-500/20 file:text-amber-300 file:font-semibold hover:file:bg-amber-500/30"
      />
      {imagePreviewUrl && (
        <div className="rounded-full border border-amber-600/30 overflow-hidden bg-slate-950 aspect-square max-w-[180px] mx-auto">
          <img src={imagePreviewUrl} alt="preview" className="w-full h-full object-cover" />
        </div>
      )}
      <p className="text-[10px] text-slate-500 leading-snug">
        Best results: high-contrast subject on plain background. Line art / illustrations often work better with <em>Invert</em> enabled.
      </p>

      {/* Sliders */}
      <div className="space-y-2 pt-1">
        <div>
          <div className="flex items-center justify-between text-[11px] mb-0.5">
            <label className="text-slate-300 font-semibold">Diameter</label>
            <span data-testid="bas-relief-diameter-value" className="text-amber-300 font-mono">{basDiameter} mm</span>
          </div>
          <input
            data-testid="bas-relief-diameter"
            type="range" min="60" max="380" step="5"
            value={basDiameter}
            onChange={(e) => setBasDiameter(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] mb-0.5">
            <label className="text-slate-300 font-semibold">Max relief height</label>
            <span data-testid="bas-relief-max-value" className="text-amber-300 font-mono">{basRelief} mm</span>
          </div>
          <input
            data-testid="bas-relief-max"
            type="range" min="1" max="30" step="0.5"
            value={basRelief}
            onChange={(e) => setBasRelief(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] mb-0.5">
            <label className="text-slate-300 font-semibold">Base thickness</label>
            <span data-testid="bas-relief-base-value" className="text-amber-300 font-mono">{basBaseThickness} mm</span>
          </div>
          <input
            data-testid="bas-relief-base"
            type="range" min="1" max="10" step="0.5"
            value={basBaseThickness}
            onChange={(e) => setBasBaseThickness(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] mb-0.5">
            <label className="text-slate-300 font-semibold">Smoothing</label>
            <span className="text-amber-300 font-mono">{basSmooth.toFixed(1)}</span>
          </div>
          <input
            data-testid="bas-relief-smooth"
            type="range" min="0" max="5" step="0.25"
            value={basSmooth}
            onChange={(e) => setBasSmooth(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-300 mt-2 cursor-pointer">
          <input
            data-testid="bas-relief-invert"
            type="checkbox"
            checked={basDarkIsHigh}
            onChange={(e) => setBasDarkIsHigh(e.target.checked)}
            className="accent-amber-500"
          />
          Invert (dark pixels become the tallest peaks)
        </label>

        {/* Iter-136.1 — Frame ring block. Collapsed toggle at the top;
            expands to reveal the two sliders when enabled. Mirrors the
            "wooden circle around the temple" in traditional Japanese
            Cork Art. */}
        <div className="mt-3 border-t border-slate-800 pt-2">
          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              data-testid="bas-relief-ring-toggle"
              type="checkbox"
              checked={basRingEnabled}
              onChange={(e) => setBasRingEnabled(e.target.checked)}
              className="accent-amber-500"
            />
            <span className="font-semibold">Add frame ring</span>
            <span className="text-slate-500 text-[10px]">(separate part — colour it independently)</span>
          </label>
          {basRingEnabled && (
            <div className="space-y-2 mt-2 pl-5" data-testid="bas-relief-ring-panel">
              <div>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <label className="text-slate-300 font-semibold">Ring width</label>
                  <span data-testid="bas-relief-ring-width-value" className="text-amber-300 font-mono">{basRingWidth} mm</span>
                </div>
                <input
                  data-testid="bas-relief-ring-width"
                  type="range" min="1" max="40" step="0.5"
                  value={basRingWidth}
                  onChange={(e) => setBasRingWidth(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <label className="text-slate-300 font-semibold">Ring height</label>
                  <span data-testid="bas-relief-ring-height-value" className="text-amber-300 font-mono">{basRingHeight} mm</span>
                </div>
                <input
                  data-testid="bas-relief-ring-height"
                  type="range" min="0.5" max="30" step="0.5"
                  value={basRingHeight}
                  onChange={(e) => setBasRingHeight(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>
              <div className="text-[10px] text-slate-500">
                Outer diameter with frame: <span className="text-amber-300 font-mono">{(Number(basDiameter) + 2 * Number(basRingWidth)).toFixed(0)} mm</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="text-[10px] text-slate-500 pt-1">
        Total thickness at peak: <span className="text-amber-300 font-mono">{(Number(basBaseThickness) + Number(basRelief)).toFixed(1)} mm</span>
        <span className="text-slate-600"> · </span>
        <span>No quota consumed · generation is local</span>
      </div>
    </div>
  );
});

export default BasReliefTab;

// Iter-87 — Photo-to-plane (experimental).
//
// Client-side image → 3D heightmap converter. The user picks a photo,
// we read its pixels via Canvas, treat each pixel's luminance as a Z
// offset (with optional invert + bias controls), build a triangulated
// plane grid, and drop the resulting mesh into the scene through the
// existing `addImportedMesh` path. No backend, no upload — works
// offline, no API costs.
//
// Use cases:
//   - Lithophanes (white = thin, dark = thick → image visible when lit)
//   - Coin / medallion reliefs
//   - Terrain plates from satellite tiles
//   - Custom emboss/deboss for the back of a phone case etc.
//
// Algorithm:
//   1. Load image into off-screen canvas at the user-chosen RES × RES.
//   2. Compute luminance L ∈ [0..1] per pixel: 0.2126·R + 0.7152·G + 0.0722·B.
//      Apply contrast curve = (L - 0.5) * gain + 0.5, clamped to [0,1].
//      Optional `invert` flips the curve so dark areas extrude tall (the
//      classic lithophane convention — thinner = brighter).
//   3. Top vertex grid: (resW × resH) verts at (x, baseH + L*reliefH, z).
//   4. Bottom vertex grid: same XY, y = 0 (the bed). Connect with
//      perimeter walls + a bottom cap so the mesh is watertight.
//   5. Triangulate quads on both surfaces. Emit a flat Float32Array
//      of triangle vertices (no index buffer — keeps consistent with the
//      existing `importAnyMeshFile` shape).
//
// Defaults are calibrated for lithophane prints on a 0.4 mm nozzle:
//   - 100×100 grid (good detail, ~60k triangles — fast)
//   - 80 mm wide canvas (fits any FDM build plate)
//   - 0.6 mm base thickness (rigid even at small sizes)
//   - 3 mm relief (enough range for visible contrast under backlight)
//   - invert ON (lithophane convention)

import React, { useEffect, useRef, useState } from "react";
import { X, Image as ImageIcon, Loader2, RefreshCw, AlertCircle, Sparkles, Type } from "lucide-react";
import { toast } from "sonner";
import { useScene } from "../../lib/store";
import { loadImage, imageToLuminance, buildHeightmapMesh, estimateTriangleCount, textToCanvas } from "../../lib/heightmap";

// loadImage, imageToLuminance, buildHeightmapMesh, estimateTriangleCount
// moved to lib/heightmap.js (iter-87 follow-up) so the canvas-pixel →
// vertex-grid pipeline can be unit-tested independently of React.
// Iter-88: `textToCanvas` joins the toolkit so the same pipeline can
// produce keychains / name plates / signs from a typed string.

const RESOLUTIONS = [
  { key: "low",  label: "Low (60×60)",   res: 60 },
  { key: "med",  label: "Medium (100×100)", res: 100 },
  { key: "high", label: "High (160×160)", res: 160 },
];

// Built-in font choices. We rely on widely-available system fonts so
// nothing has to ship with the app. The visual style of the heightmap
// is dominated by the bold strokes anyway — exotic display fonts add
// little after the relief extrudes.
const FONTS = [
  { key: "sans",    label: "Sans",    family: "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" },
  { key: "serif",   label: "Serif",   family: "Georgia, 'Times New Roman', Times, serif" },
  { key: "mono",    label: "Mono",    family: "ui-monospace, 'IBM Plex Mono', Menlo, Consolas, monospace" },
  { key: "display", label: "Display", family: "Impact, 'Arial Black', sans-serif" },
];

export default function PhotoToPlaneDialog({ open, onClose }) {
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const [file, setFile] = useState(null);
  const [img, setImg] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resKey, setResKey] = useState("med");
  const [widthMM, setWidthMM] = useState(80);
  const [baseH, setBaseH] = useState(0.6);
  const [reliefH, setReliefH] = useState(3);
  const [invert, setInvert] = useState(true);
  const [gain, setGain] = useState(1.4);
  // Iter-141 — one-click background remover. `bgSample` gets populated
  // from the auto-corner-sample so the UI can render a swatch of the
  // exact colour being keyed out.
  const [removeBg, setRemoveBg] = useState(false);
  const [bgTolerance, setBgTolerance] = useState(35);
  const [bgSample, setBgSample] = useState({ r: 255, g: 255, b: 255 });
  // Iter-88: source mode. "photo" is the original flow. "text" swaps
  // the file dropzone for a text input + font picker, then routes the
  // rendered canvas through the same imageToLuminance pipeline.
  const [sourceMode, setSourceMode] = useState("photo"); // "photo" | "text"
  const [textValue, setTextValue] = useState("ForgeSlicer");
  const [fontKey, setFontKey] = useState("display");
  const previewCanvasRef = useRef(null);

  // Reset when reopened.
  useEffect(() => {
    if (!open) {
      setFile(null); setImg(null); setError(null);
      if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Redraw the live preview whenever inputs change.
  useEffect(() => {
    if (!img || !previewCanvasRef.current) return;
    const ctx = previewCanvasRef.current.getContext("2d");
    const cw = previewCanvasRef.current.width;
    const ch = previewCanvasRef.current.height;
    // `bgRemove.result` is an out-param — imageToLuminance writes the
    // auto-sampled BG colour back so we can render the swatch.
    const sampleOut = { r: 255, g: 255, b: 255 };
    const { lum, alpha, resW, resH } = imageToLuminance(
      img,
      RESOLUTIONS.find((r) => r.key === resKey).res,
      {
        gain, invert,
        bgRemove: removeBg
          ? { enabled: true, tolerance: bgTolerance, sample: null, result: sampleOut }
          : null,
      },
    );
    if (removeBg) {
      // Only update state if the colour actually changed — avoids a
      // preview-loop feedback since bgSample is not a dep of this hook.
      setBgSample((prev) =>
        prev.r === sampleOut.r && prev.g === sampleOut.g && prev.b === sampleOut.b
          ? prev
          : sampleOut,
      );
    }
    // Render the luminance map as a grayscale preview so the user
    // sees exactly what extrusion they'll get (white = tall).
    // Iter-140 — transparent pixels are rendered as a neutral-grey
    // checkerboard so the user immediately sees the effective mesh
    // silhouette (their alpha channel carves the outline).
    const imgData = ctx.createImageData(resW, resH);
    for (let i = 0; i < lum.length; i++) {
      const opaque = !alpha || alpha[i] >= 0.5;
      if (opaque) {
        const g = Math.round(lum[i] * 255);
        imgData.data[i * 4] = g;
        imgData.data[i * 4 + 1] = g;
        imgData.data[i * 4 + 2] = g;
        imgData.data[i * 4 + 3] = 255;
      } else {
        // Checkerboard for out-of-mesh pixels.
        const xi = i % resW;
        const zi = Math.floor(i / resW);
        const c = (((xi >> 2) + (zi >> 2)) & 1) ? 55 : 30;
        imgData.data[i * 4] = c;
        imgData.data[i * 4 + 1] = c;
        imgData.data[i * 4 + 2] = c;
        imgData.data[i * 4 + 3] = 255;
      }
    }
    // Stage to a small canvas, then upsample to the preview canvas.
    const tmp = document.createElement("canvas");
    tmp.width = resW; tmp.height = resH;
    tmp.getContext("2d").putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cw, ch);
    const ar = resW / resH;
    let drawW = cw, drawH = ch;
    if (ar >= 1) drawH = cw / ar; else drawW = ch * ar;
    ctx.drawImage(tmp, (cw - drawW) / 2, (ch - drawH) / 2, drawW, drawH);
  }, [img, resKey, gain, invert, removeBg, bgTolerance]);

  // Iter-88 — when source mode is "text", render the typed string into
  // a canvas and feed it through the SAME `img` slot. `imageToLuminance`
  // accepts any image source `ctx.drawImage` does (canvas counts), so
  // no pipeline changes are needed downstream.
  useEffect(() => {
    if (!open || sourceMode !== "text") return;
    try {
      const canvas = textToCanvas(textValue, {
        fontFamily: FONTS.find((f) => f.key === fontKey).family,
        fontWeight: 800,
      });
      setImg(canvas);
      setFile({ name: `${textValue.replace(/[^a-z0-9_-]+/gi, "_") || "text"}.txt` });
    } catch (e) {
      setError(`Couldn't render text: ${e.message || e}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceMode, textValue, fontKey]);

  const pickFile = async (f) => {
    if (!f) return;
    setError(null);
    setFile(f);
    try {
      const im = await loadImage(f);
      setImg(im);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(f));
    } catch (e) {
      setError(`Couldn't load image: ${e.message || e}`);
    }
  };

  const handleFileInput = (e) => pickFile(e.target.files?.[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    pickFile(e.dataTransfer.files?.[0]);
  };

  const handleGenerate = async () => {
    if (!img) { toast.warning("Pick a photo first."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = RESOLUTIONS.find((r) => r.key === resKey).res;
      const { lum, alpha, resW, resH } = imageToLuminance(img, res, {
        gain, invert,
        bgRemove: removeBg ? { enabled: true, tolerance: bgTolerance, sample: null } : null,
      });
      const { vertices, sizeX, sizeZ, height } = buildHeightmapMesh(lum, resW, resH, widthMM, baseH, reliefH, alpha);
      const name = (file?.name || "photo-plane").replace(/\.[^.]+$/, "");
      addImportedMesh(
        `${name} (heightmap)`,
        vertices,
        null,
        { x: sizeX, y: height, z: sizeZ },
      );
      toast.success(`Added "${name}" — ${(vertices.length / 9).toFixed(0)} triangles, ${sizeX.toFixed(0)}×${sizeZ.toFixed(0)}×${height.toFixed(1)} mm.`);
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="photo-to-plane-dialog"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-cyan-400" />
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Photo / Text → plane</h2>
              <div className="text-[10px] text-slate-500 leading-tight">Heightmap relief from a photo or typed text — great for lithophanes, keychains, signs &amp; coins</div>
            </div>
          </div>
          <button onClick={onClose} data-testid="photo-to-plane-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT — source picker + height-map preview */}
          <div className="space-y-3">
            {/* Iter-88 source-mode toggle. Switches the dropzone to a
                text input + font picker. Clearing img on switch forces
                a fresh render of the chosen source. */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 border border-slate-800 rounded">
              <button
                data-testid="photo-to-plane-mode-photo"
                onClick={() => { setSourceMode("photo"); setImg(null); setFile(null); }}
                className={`h-7 text-[10px] uppercase tracking-wider font-semibold rounded flex items-center justify-center gap-1.5 transition-colors ${
                  sourceMode === "photo" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-white"
                }`}
              >
                <ImageIcon size={11} /> Photo
              </button>
              <button
                data-testid="photo-to-plane-mode-text"
                onClick={() => { setSourceMode("text"); setImg(null); setFile(null); }}
                className={`h-7 text-[10px] uppercase tracking-wider font-semibold rounded flex items-center justify-center gap-1.5 transition-colors ${
                  sourceMode === "text" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-white"
                }`}
              >
                <Type size={11} /> Text
              </button>
            </div>

            {sourceMode === "text" && (
              <div className="space-y-2" data-testid="photo-to-plane-text-controls">
                <input
                  data-testid="photo-to-plane-text-input"
                  type="text"
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  maxLength={48}
                  placeholder="Type a name or short phrase…"
                  className="w-full h-9 bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded text-sm text-white px-3 outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Font</span>
                    <select
                      data-testid="photo-to-plane-font"
                      value={fontKey}
                      onChange={(e) => setFontKey(e.target.value)}
                      className="w-full h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2"
                    >
                      {FONTS.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="text-[10px] text-slate-500 self-end pb-1.5 leading-tight">
                    Dark text → tall extrusion when invert is on (the default).
                  </div>
                </div>
              </div>
            )}

            {sourceMode === "photo" && !img && (
              <label
                data-testid="photo-to-plane-drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="block h-56 rounded-lg border-2 border-dashed border-slate-700 hover:border-cyan-500 hover:bg-cyan-500/5 cursor-pointer flex items-center justify-center text-center p-6 transition-colors"
              >
                <input
                  data-testid="photo-to-plane-file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/heic"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <div>
                  <ImageIcon size={36} className="text-slate-500 mx-auto mb-2" />
                  <div className="text-xs text-slate-300">Drop a photo here</div>
                  <div className="text-[10px] text-slate-500 mt-1">PNG · JPG · WEBP · HEIC</div>
                </div>
              </label>
            )}

            {img && (
              <div className="space-y-2">
                <div className="relative">
                  <canvas
                    ref={previewCanvasRef}
                    width={420}
                    height={sourceMode === "text" ? 180 : 260}
                    className={`w-full bg-slate-950 rounded border border-slate-800 ${sourceMode === "text" ? "h-44" : "h-64"}`}
                    data-testid="photo-to-plane-preview-canvas"
                  />
                  <div className="absolute top-1 left-1 text-[9px] uppercase tracking-wider bg-slate-900/80 text-cyan-300 px-1.5 py-0.5 rounded">
                    Height preview
                  </div>
                </div>
                {sourceMode === "photo" && (
                  <button
                    data-testid="photo-to-plane-clear-btn"
                    onClick={() => { setFile(null); setImg(null); }}
                    className="w-full h-7 text-[10px] uppercase tracking-wider text-slate-300 hover:text-white border border-slate-700 hover:border-slate-500 rounded flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw size={11} /> Pick a different photo
                  </button>
                )}
              </div>
            )}
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/40 rounded p-2 text-xs text-rose-200 flex items-start gap-2" data-testid="photo-to-plane-error">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* RIGHT — controls */}
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-slate-400">Resolution</label>
              <select
                data-testid="photo-to-plane-resolution"
                value={resKey}
                onChange={(e) => setResKey(e.target.value)}
                className="w-full h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500">
                Higher resolution = more detail + more triangles. Med is the lithophane sweet spot.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Width (mm)</span>
                <input
                  data-testid="photo-to-plane-width"
                  type="number" min={10} max={400} step={5}
                  value={widthMM}
                  onChange={(e) => setWidthMM(parseFloat(e.target.value) || 0)}
                  className="w-full h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Base (mm)</span>
                <input
                  data-testid="photo-to-plane-base"
                  type="number" min={0} max={20} step={0.1}
                  value={baseH}
                  onChange={(e) => setBaseH(parseFloat(e.target.value) || 0)}
                  className="w-full h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2"
                />
              </label>
            </div>

            <label className="space-y-1 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Relief (mm) — bright-pixel extrusion above base</span>
              <input
                data-testid="photo-to-plane-relief"
                type="number" min={0.1} max={30} step={0.1}
                value={reliefH}
                onChange={(e) => setReliefH(parseFloat(e.target.value) || 0)}
                className="w-full h-8 bg-slate-950 border border-slate-700 rounded text-xs text-white px-2"
              />
            </label>

            <label className="space-y-1 block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Contrast — {gain.toFixed(1)}×</span>
              <input
                data-testid="photo-to-plane-gain"
                type="range" min={0.3} max={3} step={0.1}
                value={gain}
                onChange={(e) => setGain(parseFloat(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </label>

            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                data-testid="photo-to-plane-invert"
                type="checkbox"
                checked={invert}
                onChange={(e) => setInvert(e.target.checked)}
                className="accent-cyan-500"
              />
              <span>
                Invert (lithophane mode — dark pixels print tall, light pixels stay thin so backlight passes through)
              </span>
            </label>

            {/* Iter-141 — one-click background remover. Auto-samples the
                four corner patches (median RGB) and keys out any pixel
                within `tolerance` of that colour. Turns a JPG snapshot
                on a clean background into a proper cut-out silhouette
                with no external editing. */}
            <div className="border border-slate-800 rounded p-2 space-y-2 bg-slate-950/50">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  data-testid="photo-to-plane-remove-bg"
                  type="checkbox"
                  checked={removeBg}
                  onChange={(e) => setRemoveBg(e.target.checked)}
                  className="accent-cyan-500"
                />
                <span className="font-semibold">Remove background</span>
                <span className="text-[10px] text-slate-500">— auto-samples corners</span>
              </label>
              {removeBg && (
                <div className="space-y-2 pl-5" data-testid="photo-to-plane-bg-panel">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">Sampled:</span>
                    <div
                      data-testid="photo-to-plane-bg-swatch"
                      className="w-5 h-5 rounded border border-slate-600 shadow-inner"
                      style={{ backgroundColor: `rgb(${bgSample.r},${bgSample.g},${bgSample.b})` }}
                      title={`rgb(${bgSample.r}, ${bgSample.g}, ${bgSample.b})`}
                    />
                    <span className="text-[10px] font-mono text-slate-500">
                      {bgSample.r},{bgSample.g},{bgSample.b}
                    </span>
                  </div>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      Tolerance — {bgTolerance}
                    </span>
                    <input
                      data-testid="photo-to-plane-bg-tolerance"
                      type="range" min={0} max={100} step={1}
                      value={bgTolerance}
                      onChange={(e) => setBgTolerance(parseInt(e.target.value, 10))}
                      className="w-full accent-cyan-500"
                    />
                  </label>
                  <p className="text-[10px] text-slate-500 leading-snug">
                    Nudge up if the background bleeds in, down if the subject gets eaten. The preview checkerboard shows what will be carved out.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded p-2 text-[10px] text-slate-400 space-y-0.5">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Est. output</div>
              <div>Plate ≈ {widthMM.toFixed(0)} mm wide</div>
              <div>Total height ≈ {(baseH + reliefH).toFixed(1)} mm</div>
              <div>Triangles ≈ {estimateTriangleCount(RESOLUTIONS.find((x) => x.key === resKey).res).toLocaleString()}</div>
            </div>
          </div>
        </div>

        <footer className="px-4 py-3 border-t border-slate-800 flex items-center justify-between gap-3">
          <p className="text-[10px] text-slate-500">
            Processed locally in your browser. No upload, no API call.
          </p>
          <button
            data-testid="photo-to-plane-generate-btn"
            disabled={!img || busy}
            onClick={handleGenerate}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded"
          >
            {busy
              ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
              : <><Sparkles size={13} /> Generate plane</>}
          </button>
        </footer>
      </div>
    </div>
  );
}

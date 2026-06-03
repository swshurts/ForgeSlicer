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
import { X, Image as ImageIcon, Loader2, RefreshCw, AlertCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useScene } from "../../lib/store";

// Read a File into an HTMLImageElement so Canvas can paint it. Promise-
// based — we only resolve once the image's `decode()` finishes.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e || new Error("Image load failed")); };
    img.src = url;
  });
}

// Sample image into a `resW × resH` luminance grid in [0,1]. Aspect
// ratio is preserved on the wider axis — the shorter axis gets fewer
// rows/cols proportionally.
function imageToLuminance(img, resTarget, opts = {}) {
  const { gain = 1, invert = false } = opts;
  const aspect = img.width / img.height;
  const resW = aspect >= 1 ? resTarget : Math.max(8, Math.round(resTarget * aspect));
  const resH = aspect >= 1 ? Math.max(8, Math.round(resTarget / aspect)) : resTarget;
  const canvas = document.createElement("canvas");
  canvas.width = resW; canvas.height = resH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't get 2D context");
  ctx.drawImage(img, 0, 0, resW, resH);
  const { data } = ctx.getImageData(0, 0, resW, resH);
  const lum = new Float32Array(resW * resH);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // ITU-R BT.709 luminance coefficients — accurate for sRGB photos.
    let l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    // Contrast curve around midpoint, then clamp.
    l = (l - 0.5) * gain + 0.5;
    if (l < 0) l = 0; else if (l > 1) l = 1;
    if (invert) l = 1 - l;
    lum[j] = l;
  }
  return { lum, resW, resH };
}

// Build a watertight heightmap mesh:
//   - Top surface: grid of triangles deformed by `lum` * reliefH (+ base).
//   - Bottom surface: flat grid at y = 0.
//   - Four perimeter walls so the mesh is closed.
// Output: Float32Array of contiguous triangle vertices [x,y,z,x,y,z,...].
function buildHeightmapMesh(lum, resW, resH, widthMM, baseHeight, reliefH) {
  // Physical extents — preserve photo aspect on the plate.
  const aspect = resW / resH;
  const sizeX = aspect >= 1 ? widthMM : widthMM * aspect;
  const sizeZ = aspect >= 1 ? widthMM / aspect : widthMM;
  const dx = sizeX / (resW - 1);
  const dz = sizeZ / (resH - 1);

  // Pre-compute top-grid positions (centered on origin in X/Z).
  const topVerts = new Float32Array(resW * resH * 3);
  for (let zi = 0; zi < resH; zi++) {
    for (let xi = 0; xi < resW; xi++) {
      const idx = (zi * resW + xi) * 3;
      const x = xi * dx - sizeX / 2;
      const z = zi * dz - sizeZ / 2;
      const y = baseHeight + lum[zi * resW + xi] * reliefH;
      topVerts[idx]     = x;
      topVerts[idx + 1] = y;
      topVerts[idx + 2] = z;
    }
  }

  // Allocate output array. Two surfaces × (resW-1)(resH-1) quads × 6
  // vertices/quad × 3 coords. Plus 4 perimeter strips of length (resW-1)
  // or (resH-1) each — also 6 verts/quad. Generous overestimate.
  const triCount = 2 * (resW - 1) * (resH - 1) * 2  // top + bottom
                 + 2 * (resW - 1) * 2               // front + back strips
                 + 2 * (resH - 1) * 2;              // left + right strips
  const out = new Float32Array(triCount * 9);
  let p = 0;

  const writeTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    out[p++] = ax; out[p++] = ay; out[p++] = az;
    out[p++] = bx; out[p++] = by; out[p++] = bz;
    out[p++] = cx; out[p++] = cy; out[p++] = cz;
  };
  const top = (xi, zi) => {
    const i = (zi * resW + xi) * 3;
    return [topVerts[i], topVerts[i + 1], topVerts[i + 2]];
  };
  const bot = (xi, zi) => [xi * dx - sizeX / 2, 0, zi * dz - sizeZ / 2];

  // Top surface — winding CCW when viewed from above (+Y up).
  for (let zi = 0; zi < resH - 1; zi++) {
    for (let xi = 0; xi < resW - 1; xi++) {
      const [a0, a1, a2] = top(xi,     zi);
      const [b0, b1, b2] = top(xi + 1, zi);
      const [c0, c1, c2] = top(xi + 1, zi + 1);
      const [d0, d1, d2] = top(xi,     zi + 1);
      // Two triangles per quad; CCW from +Y.
      writeTri(a0, a1, a2, d0, d1, d2, b0, b1, b2);
      writeTri(b0, b1, b2, d0, d1, d2, c0, c1, c2);
    }
  }
  // Bottom surface — opposite winding (CW from +Y means CCW from -Y).
  for (let zi = 0; zi < resH - 1; zi++) {
    for (let xi = 0; xi < resW - 1; xi++) {
      const [a0, a1, a2] = bot(xi,     zi);
      const [b0, b1, b2] = bot(xi + 1, zi);
      const [c0, c1, c2] = bot(xi + 1, zi + 1);
      const [d0, d1, d2] = bot(xi,     zi + 1);
      writeTri(a0, a1, a2, b0, b1, b2, d0, d1, d2);
      writeTri(b0, b1, b2, c0, c1, c2, d0, d1, d2);
    }
  }
  // Perimeter walls — connect top edge to bottom edge.
  // Front edge (zi=0)
  for (let xi = 0; xi < resW - 1; xi++) {
    const [a0, a1, a2] = top(xi,     0);
    const [b0, b1, b2] = top(xi + 1, 0);
    const [c0, c1, c2] = bot(xi + 1, 0);
    const [d0, d1, d2] = bot(xi,     0);
    writeTri(a0, a1, a2, b0, b1, b2, c0, c1, c2);
    writeTri(a0, a1, a2, c0, c1, c2, d0, d1, d2);
  }
  // Back edge (zi=resH-1) — reversed winding.
  for (let xi = 0; xi < resW - 1; xi++) {
    const [a0, a1, a2] = top(xi,     resH - 1);
    const [b0, b1, b2] = top(xi + 1, resH - 1);
    const [c0, c1, c2] = bot(xi + 1, resH - 1);
    const [d0, d1, d2] = bot(xi,     resH - 1);
    writeTri(b0, b1, b2, a0, a1, a2, d0, d1, d2);
    writeTri(b0, b1, b2, d0, d1, d2, c0, c1, c2);
  }
  // Left edge (xi=0)
  for (let zi = 0; zi < resH - 1; zi++) {
    const [a0, a1, a2] = top(0, zi);
    const [b0, b1, b2] = top(0, zi + 1);
    const [c0, c1, c2] = bot(0, zi + 1);
    const [d0, d1, d2] = bot(0, zi);
    writeTri(b0, b1, b2, a0, a1, a2, d0, d1, d2);
    writeTri(b0, b1, b2, d0, d1, d2, c0, c1, c2);
  }
  // Right edge (xi=resW-1)
  for (let zi = 0; zi < resH - 1; zi++) {
    const [a0, a1, a2] = top(resW - 1, zi);
    const [b0, b1, b2] = top(resW - 1, zi + 1);
    const [c0, c1, c2] = bot(resW - 1, zi + 1);
    const [d0, d1, d2] = bot(resW - 1, zi);
    writeTri(a0, a1, a2, b0, b1, b2, c0, c1, c2);
    writeTri(a0, a1, a2, c0, c1, c2, d0, d1, d2);
  }

  return { vertices: out, sizeX, sizeZ, height: baseHeight + reliefH };
}

const RESOLUTIONS = [
  { key: "low",  label: "Low (60×60)",   res: 60 },
  { key: "med",  label: "Medium (100×100)", res: 100 },
  { key: "high", label: "High (160×160)", res: 160 },
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
    const { lum, resW, resH } = imageToLuminance(img, RESOLUTIONS.find((r) => r.key === resKey).res, { gain, invert });
    // Render the luminance map as a grayscale preview so the user
    // sees exactly what extrusion they'll get (white = tall).
    const imgData = ctx.createImageData(resW, resH);
    for (let i = 0; i < lum.length; i++) {
      const g = Math.round(lum[i] * 255);
      imgData.data[i * 4] = g;
      imgData.data[i * 4 + 1] = g;
      imgData.data[i * 4 + 2] = g;
      imgData.data[i * 4 + 3] = 255;
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
  }, [img, resKey, gain, invert]);

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
      const { lum, resW, resH } = imageToLuminance(img, res, { gain, invert });
      const { vertices, sizeX, sizeZ, height } = buildHeightmapMesh(lum, resW, resH, widthMM, baseH, reliefH);
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
              <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Photo to plane</h2>
              <div className="text-[10px] text-slate-500 leading-tight">Heightmap relief from any photo — great for lithophanes &amp; coins</div>
            </div>
          </div>
          <button onClick={onClose} data-testid="photo-to-plane-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT — drop zone + preview */}
          <div className="space-y-3">
            {!img ? (
              <label
                data-testid="photo-to-plane-drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="block h-64 rounded-lg border-2 border-dashed border-slate-700 hover:border-cyan-500 hover:bg-cyan-500/5 cursor-pointer flex items-center justify-center text-center p-6 transition-colors"
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
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <canvas
                    ref={previewCanvasRef}
                    width={420}
                    height={260}
                    className="w-full h-64 bg-slate-950 rounded border border-slate-800"
                    data-testid="photo-to-plane-preview-canvas"
                  />
                  <div className="absolute top-1 left-1 text-[9px] uppercase tracking-wider bg-slate-900/80 text-cyan-300 px-1.5 py-0.5 rounded">
                    Height preview
                  </div>
                </div>
                <button
                  data-testid="photo-to-plane-clear-btn"
                  onClick={() => { setFile(null); setImg(null); }}
                  className="w-full h-7 text-[10px] uppercase tracking-wider text-slate-300 hover:text-white border border-slate-700 hover:border-slate-500 rounded flex items-center justify-center gap-1.5"
                >
                  <RefreshCw size={11} /> Pick a different photo
                </button>
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

            <div className="bg-slate-950 border border-slate-800 rounded p-2 text-[10px] text-slate-400 space-y-0.5">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Est. output</div>
              <div>Plate ≈ {widthMM.toFixed(0)} mm wide</div>
              <div>Total height ≈ {(baseH + reliefH).toFixed(1)} mm</div>
              <div>Triangles ≈ {(() => {
                const r = RESOLUTIONS.find((x) => x.key === resKey).res;
                return (2 * (r - 1) * (r - 1) * 2 + 8 * (r - 1)).toLocaleString();
              })()}</div>
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

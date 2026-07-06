import React, { useEffect, useRef } from "react";

/**
 * Compact luminance + RGB histogram. Re-computes whenever edits change.
 *
 * Implementation notes:
 *  - We draw the *unfiltered* image to an offscreen canvas and apply
 *    brightness / contrast / saturation directly to the readback pixel
 *    array. Earlier versions relied on `ctx.filter = editsToCssFilter()`
 *    but that's unreliable on iPad WebKit (Safari / iOS Firefox) — the
 *    filter is honoured the first few times and silently no-ops once
 *    the canvas has been reused enough (e.g. after a Generate run
 *    invokes `renderEditedImage`). Doing the math here costs ~80 µs per
 *    update at 200×H px, so it's strictly faster than the round-trip
 *    through CSS filter regardless.
 *  - Crop is still applied via drawImage source-rect.
 */

const BINS = 64;

const CHANNELS = [
  { id: "lum", label: "L",   color: "#a1a1aa", alpha: 0.85 },
  { id: "r",   label: "R",   color: "#ef4444", alpha: 0.55 },
  { id: "g",   label: "G",   color: "#22c55e", alpha: 0.55 },
  { id: "b",   label: "B",   color: "#3b82f6", alpha: 0.55 },
];

const applyEditsInPlace = (data, edits) => {
  // brightness: 100 = identity, 200 = ×2, 20 = ×0.2
  const briMul = edits.brightness / 100;
  // contrast: 100 = identity. Standard formula: out = (in - 128) * c + 128.
  const con = edits.contrast / 100;
  // saturation: 100 = identity, 0 = grayscale, 200 = ×2 chroma.
  const sat = edits.saturation / 100;
  if (briMul === 1 && con === 1 && sat === 1) return;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    // brightness (multiplicative — matches the CSS filter semantic)
    r *= briMul; g *= briMul; b *= briMul;
    // contrast around mid-grey
    r = (r - 128) * con + 128;
    g = (g - 128) * con + 128;
    b = (b - 128) * con + 128;
    // saturation: linear interpolate between luma and original.
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = L + (r - L) * sat;
    g = L + (g - L) * sat;
    b = L + (b - L) * sat;
    // Clamp
    data[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
};

const computeBins = (imageData) => {
  const data = imageData.data;
  const lum = new Uint32Array(BINS);
  const r = new Uint32Array(BINS);
  const g = new Uint32Array(BINS);
  const b = new Uint32Array(BINS);
  for (let i = 0; i < data.length; i += 4) {
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    lum[Math.min(BINS - 1, Math.floor((L / 256) * BINS))]++;
    r[Math.min(BINS - 1, Math.floor((R / 256) * BINS))]++;
    g[Math.min(BINS - 1, Math.floor((G / 256) * BINS))]++;
    b[Math.min(BINS - 1, Math.floor((B / 256) * BINS))]++;
  }
  return { lum, r, g, b };
};

export const Histogram = ({ image, edits }) => {
  const canvasRef = useRef(null);
  const offscreenRef = useRef(null);
  const [visible, setVisible] = React.useState(() => ({
    lum: true, r: true, g: true, b: true,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    if (!image.naturalWidth || !image.naturalHeight) return;
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement("canvas");
    }
    const off = offscreenRef.current;
    const W = 200;
    const H = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * W));
    off.width = W;
    off.height = H;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    // Important: do NOT set offCtx.filter — it's unreliable on iPad
    // WebKit after the canvas has been reused. We apply edits directly
    // to the pixel array below, which is portable and just as fast.
    offCtx.filter = "none";
    // Apply crop too so the histogram reflects the visible region.
    const cx = (edits.cropL / 100) * image.naturalWidth;
    const cy = (edits.cropT / 100) * image.naturalHeight;
    const cw = Math.max(
      1,
      (1 - (edits.cropL + edits.cropR) / 100) * image.naturalWidth
    );
    const ch = Math.max(
      1,
      (1 - (edits.cropT + edits.cropB) / 100) * image.naturalHeight
    );

    let imgData;
    try {
      offCtx.clearRect(0, 0, W, H);
      offCtx.drawImage(image, cx, cy, cw, ch, 0, 0, W, H);
      imgData = offCtx.getImageData(0, 0, W, H);
    } catch (err) {
      // Tainted canvas (cross-origin image) or oversized buffer — skip the
      // histogram silently rather than crashing the whole edit panel.
      // Slider adjustments must keep working even if the histogram can't
      // read pixels back.
      // eslint-disable-next-line no-console
      console.warn("Histogram readback skipped:", err.message);
      return;
    }
    applyEditsInPlace(imgData.data, edits);
    const { lum, r, g, b } = computeBins(imgData);

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const max = Math.max(
      Math.max(...lum),
      Math.max(...r),
      Math.max(...g),
      Math.max(...b),
      1
    );
    const drawSeries = (arr, fill, alpha = 0.55) => {
      ctx.fillStyle = fill;
      ctx.globalAlpha = alpha;
      const bw = cssW / BINS;
      for (let i = 0; i < BINS; i++) {
        const h = (arr[i] / max) * cssH;
        ctx.fillRect(i * bw, cssH - h, bw + 0.5, h);
      }
    };

    const series = { lum, r, g, b };
    // Draw lum LAST so its grey overlay sits on top of the color
    // channels (matches Photoshop / Lightroom convention).
    const drawOrder = ["r", "g", "b", "lum"];
    for (const id of drawOrder) {
      if (!visible[id]) continue;
      const ch = CHANNELS.find((c) => c.id === id);
      drawSeries(series[id], ch.color, ch.alpha);
    }
    ctx.globalAlpha = 1;

    // Clipping markers — strong shadow / highlight clipping warnings.
    const totalPx = imgData.width * imgData.height;
    const shadowClip = lum[0] / totalPx;
    const highlightClip = lum[BINS - 1] / totalPx;
    if (shadowClip > 0.01) {
      ctx.fillStyle = "#1d4ed8";
      ctx.fillRect(0, cssH - 2, 4, 2);
    }
    if (highlightClip > 0.01) {
      ctx.fillStyle = "#facc15";
      ctx.fillRect(cssW - 4, cssH - 2, 4, 2);
    }
  }, [image, edits, visible]);

  if (!image) return null;
  return (
    <div className="space-y-1" data-testid="histogram">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-500">
          Histogram
        </span>
        <div className="flex items-center gap-1" data-testid="histogram-channel-toggles">
          {CHANNELS.map((ch) => (
            <button
              key={ch.id}
              type="button"
              onClick={() =>
                setVisible((v) => ({ ...v, [ch.id]: !v[ch.id] }))
              }
              data-testid={`histogram-toggle-${ch.id}`}
              aria-pressed={visible[ch.id]}
              title={`${visible[ch.id] ? "Hide" : "Show"} ${ch.id.toUpperCase()} channel`}
              className={`w-5 h-5 flex items-center justify-center font-mono text-[9px] font-bold border transition-colors ${
                visible[ch.id]
                  ? "border-zinc-500 text-zinc-100"
                  : "border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400"
              }`}
              style={visible[ch.id] ? { color: ch.color, borderColor: ch.color } : undefined}
            >
              {ch.label}
            </button>
          ))}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full h-12 bg-zinc-950 border border-zinc-800"
      />
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";

const LOUPE_SIZE = 140;
const SAMPLE_RADIUS = 1; // sample a 3×3 average

const rgbToHex = (r, g, b) =>
  "#" +
  [r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const rgbToLab = ([r, g, b]) => {
  // sRGB → linear
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  // linear → XYZ (D65)
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  // XYZ → Lab
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const xN = X / 0.95047, yN = Y / 1.0, zN = Z / 1.08883;
  return [
    116 * f(yN) - 16,
    500 * (f(xN) - f(yN)),
    200 * (f(yN) - f(zN)),
  ];
};

const dE76 = (a, b) =>
  Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );

const hexToRgb = (hex) => {
  const m = hex.replace("#", "").match(/.{2}/g);
  return m ? m.map((x) => parseInt(x, 16)) : [0, 0, 0];
};

/** Magnifier loupe.
 *
 *  Triggered on long-press (mobile) or shift+click (desktop) of the
 *  source image. Shows a 4× zoom circle anchored to the cursor with
 *  the sampled source color, the closest filament from the palette,
 *  and the live ΔE between them.
 *
 *  Props:
 *    imageEl: <img>/<canvas> source element to sample from (raster)
 *    enabled: master switch (only mount when there's a generated result)
 *    filaments: [{name, hex, ...}] palette
 */
export const Loupe = ({ imageEl, enabled, filaments }) => {
  const [pos, setPos] = useState(null); // {x, y, color, mapped, deltaE}
  const sampleCanvasRef = useRef(null);
  const longPressTimer = useRef(null);

  // Pre-compute Lab for each filament once per palette change.
  const filamentLab = React.useMemo(
    () => (filaments || []).map((f) => ({
      ...f,
      _lab: rgbToLab(hexToRgb(f.hex)),
    })),
    [filaments],
  );

  // Lazily prepare an offscreen canvas matching the natural image size.
  // We re-run whenever the <img>'s `complete` flag flips true OR its
  // `src` changes. Using `setLoadTick` to force a re-render on the
  // `load` event is the simplest way to keep this watertight without
  // chaining a half-dozen useEffects.
  const [loadTick, setLoadTick] = useState(0);
  useEffect(() => {
    if (!imageEl) return;
    const bump = () => setLoadTick((n) => n + 1);
    imageEl.addEventListener("load", bump);
    // If the image is ALREADY complete when the Loupe mounts (common
    // when src is a data: URL that decoded synchronously), bump once
    // so the canvas-prep effect runs.
    if (imageEl.complete && imageEl.naturalWidth > 0) bump();
    return () => imageEl.removeEventListener("load", bump);
  }, [imageEl]);

  useEffect(() => {
    if (!imageEl) return;
    if (!imageEl.complete || !imageEl.naturalWidth) return;
    const cv = document.createElement("canvas");
    cv.width = imageEl.naturalWidth;
    cv.height = imageEl.naturalHeight;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(imageEl, 0, 0);
      sampleCanvasRef.current = cv;
    } catch {
      // Tainted canvas — silently disable loupe.
      sampleCanvasRef.current = null;
    }
  }, [imageEl, loadTick]);

  const samplePoint = (clientX, clientY, opts = {}) => {
    if (!imageEl || !sampleCanvasRef.current || !filamentLab.length) return;
    const rect = imageEl.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      setPos(null);
      return;
    }
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    const sx = Math.round(nx * sampleCanvasRef.current.width);
    const sy = Math.round(ny * sampleCanvasRef.current.height);
    const ctx = sampleCanvasRef.current.getContext("2d");
    // 3×3 averaged sample for stability.
    let rr = 0, gg = 0, bb = 0, n = 0;
    for (let dy = -SAMPLE_RADIUS; dy <= SAMPLE_RADIUS; dy++) {
      for (let dx = -SAMPLE_RADIUS; dx <= SAMPLE_RADIUS; dx++) {
        const data = ctx.getImageData(
          Math.max(0, sx + dx),
          Math.max(0, sy + dy),
          1, 1,
        ).data;
        rr += data[0]; gg += data[1]; bb += data[2]; n++;
      }
    }
    const sample = [rr / n, gg / n, bb / n];
    const sampleLab = rgbToLab(sample);
    // Find closest filament by ΔE76.
    let best = filamentLab[0];
    let bestDe = dE76(sampleLab, best._lab);
    for (let i = 1; i < filamentLab.length; i++) {
      const d = dE76(sampleLab, filamentLab[i]._lab);
      if (d < bestDe) {
        bestDe = d;
        best = filamentLab[i];
      }
    }
    setPos({
      x: clientX - rect.left,
      y: clientY - rect.top,
      anchorRect: rect,
      color: rgbToHex(...sample),
      mapped: best,
      deltaE: bestDe,
      _sticky: !!opts.sticky,
    });
  };

  useEffect(() => {
    if (!enabled || !imageEl) return;

    const onPointerDown = (e) => {
      // Desktop: shift+click TOGGLES a sticky loupe (a second shift+click
      // or pressing Escape dismisses it).
      // Mobile: long-press > 350ms shows the loupe while pressed.
      if (e.shiftKey) {
        // If already sticky, dismiss; otherwise sample + lock.
        if (pos?._sticky) {
          setPos(null);
        } else {
          samplePoint(e.clientX, e.clientY, { sticky: true });
        }
        return;
      }
      longPressTimer.current = setTimeout(() => {
        samplePoint(e.clientX, e.clientY, { sticky: false });
      }, 350);
    };
    const onPointerMove = (e) => {
      // Only follow the cursor for non-sticky (long-press) sessions.
      if (pos && !pos._sticky) samplePoint(e.clientX, e.clientY, { sticky: false });
    };
    const onPointerUp = () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      // Don't clear sticky loupes on pointerup — they need a deliberate dismiss.
      if (pos && !pos._sticky) setPos(null);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape" && pos?._sticky) setPos(null);
    };

    imageEl.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      imageEl.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, imageEl, pos, filamentLab]);

  if (!pos) return null;

  return (
    <div
      data-testid="loupe"
      className="pointer-events-none fixed z-[200]"
      style={{
        left: pos.anchorRect.left + pos.x - LOUPE_SIZE / 2,
        top: pos.anchorRect.top + pos.y - LOUPE_SIZE - 16,
        width: LOUPE_SIZE,
      }}
    >
      <div
        className="rounded-full border-2 border-zinc-100 shadow-2xl"
        style={{
          width: LOUPE_SIZE,
          height: LOUPE_SIZE,
          background: pos.color,
        }}
      />
      <div className="mt-2 bg-zinc-950 border border-zinc-800 px-2 py-1.5 space-y-1 font-mono text-[9px] text-center">
        <div className="flex items-center justify-center gap-1.5">
          <div
            className="w-3 h-3 border border-zinc-700"
            style={{ background: pos.color }}
          />
          <span className="text-zinc-300 tabular-nums">{pos.color}</span>
        </div>
        <div className="flex items-center justify-center gap-1.5">
          <div
            className="w-3 h-3 border border-zinc-700"
            style={{ background: pos.mapped.hex }}
          />
          <span className="text-zinc-400 truncate">{pos.mapped.name}</span>
        </div>
        <div className="text-zinc-500 tabular-nums">
          ΔE <span className="text-zinc-200">{pos.deltaE.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
};

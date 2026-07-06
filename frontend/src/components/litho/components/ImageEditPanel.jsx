import React from "react";
import { Slider } from "../../ui/slider";
import { Label } from "../../ui/label";
import { RotateCcw, Minus, Plus } from "lucide-react";
import { Histogram } from "./Histogram";

export const DEFAULT_EDITS = {
  brightness: 100, // 0..200 (100 = unchanged)
  contrast: 100,
  saturation: 100, // 0 = grayscale
  cropL: 0,        // % from left
  cropR: 0,        // % from right
  cropT: 0,        // % from top
  cropB: 0,        // % from bottom
};

export const editsAreActive = (e) =>
  e.brightness !== 100 ||
  e.contrast !== 100 ||
  e.saturation !== 100 ||
  e.cropL !== 0 ||
  e.cropR !== 0 ||
  e.cropT !== 0 ||
  e.cropB !== 0;

export const editsToCssFilter = (e) =>
  `brightness(${e.brightness / 100}) contrast(${e.contrast / 100}) saturate(${e.saturation / 100})`;

export const editsToClipPath = (e) => {
  const l = e.cropL;
  const r = 100 - e.cropR;
  const t = e.cropT;
  const b = 100 - e.cropB;
  return `polygon(${l}% ${t}%, ${r}% ${t}%, ${r}% ${b}%, ${l}% ${b}%)`;
};

const Row = ({ label, value, unit, children, testid }) => (
  <div className="space-y-1.5" data-testid={testid}>
    <div className="flex items-center justify-between">
      <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </Label>
      <span className="font-mono text-xs text-zinc-300 tabular-nums">
        {value}
        <span className="text-zinc-600 ml-1">{unit}</span>
      </span>
    </div>
    {children}
  </div>
);

/**
 * Slider + matching - / + stepper buttons. Touch devices (especially iPad)
 * can't reliably drag a 1-unit change on a continuous 0..200 slider, so
 * we surface explicit steppers next to the slider that nudge by `step`
 * (with Shift held: 10× step) — works with mouse and touch alike.
 */
const SteppedSlider = ({
  testid,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
}) => {
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const nudge = (dir, shift) => {
    const delta = dir * step * (shift ? 10 : 1);
    onChange(clamp(value + delta));
  };
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Decrease"
        data-testid={`${testid}-dec`}
        onClick={(e) => nudge(-1, e.shiftKey)}
        disabled={disabled || value <= min}
        className="w-6 h-6 flex-shrink-0 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 active:bg-zinc-800 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:border-zinc-800 transition-colors duration-150 touch-manipulation"
      >
        <Minus className="w-3 h-3" strokeWidth={2} />
      </button>
      <Slider
        data-testid={testid}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="flex-1"
      />
      <button
        type="button"
        aria-label="Increase"
        data-testid={`${testid}-inc`}
        onClick={(e) => nudge(1, e.shiftKey)}
        disabled={disabled || value >= max}
        className="w-6 h-6 flex-shrink-0 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 active:bg-zinc-800 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:border-zinc-800 transition-colors duration-150 touch-manipulation"
      >
        <Plus className="w-3 h-3" strokeWidth={2} />
      </button>
    </div>
  );
};

export const ImageEditPanel = ({ edits, setEdits, disabled, image }) => {
  const update = (key, v) => setEdits((e) => ({ ...e, [key]: v }));
  const reset = () => setEdits({ ...DEFAULT_EDITS });
  const active = editsAreActive(edits);

  return (
    <div data-testid="image-edit-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
          Image
        </div>
        <button
          onClick={reset}
          disabled={disabled || !active}
          data-testid="image-edit-reset"
          className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors duration-150"
        >
          <RotateCcw className="w-2.5 h-2.5" strokeWidth={2} />
          Reset
        </button>
      </div>

      {image && (
        <div className="mb-3">
          <Histogram image={image} edits={edits} />
        </div>
      )}

      <div className="space-y-3">
        <Row
          label="Brightness"
          value={edits.brightness - 100 >= 0 ? `+${edits.brightness - 100}` : `${edits.brightness - 100}`}
          unit=""
          testid="row-brightness"
        >
          <SteppedSlider
            testid="brightness-slider"
            value={edits.brightness}
            onChange={(v) => update("brightness", v)}
            min={20}
            max={200}
            step={1}
            disabled={disabled}
          />
        </Row>

        <Row
          label="Contrast"
          value={edits.contrast - 100 >= 0 ? `+${edits.contrast - 100}` : `${edits.contrast - 100}`}
          unit=""
          testid="row-contrast"
        >
          <SteppedSlider
            testid="contrast-slider"
            value={edits.contrast}
            onChange={(v) => update("contrast", v)}
            min={20}
            max={200}
            step={1}
            disabled={disabled}
          />
        </Row>

        <Row
          label="Saturation"
          value={
            edits.saturation === 0
              ? "B&W"
              : edits.saturation - 100 >= 0
                ? `+${edits.saturation - 100}`
                : `${edits.saturation - 100}`
          }
          unit=""
          testid="row-saturation"
        >
          <SteppedSlider
            testid="saturation-slider"
            value={edits.saturation}
            onChange={(v) => update("saturation", v)}
            min={0}
            max={200}
            step={1}
            disabled={disabled}
          />
          <div className="font-mono text-[9px] text-zinc-600 mt-0.5">
            0 = black & white · 100 = original · 200 = vivid · hold Shift on ± for 10× step
          </div>
        </Row>

        <div className="border-t border-zinc-800 my-2" />

        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          Crop
        </div>
        <div className="font-mono text-[9px] text-zinc-600 leading-relaxed">
          Drag the handles directly on the viewport to crop. The numbers below
          mirror the overlay and clamp at 45% per side.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Row label="Left" value={edits.cropL} unit="%" testid="row-cropL">
            <Slider
              data-testid="crop-left-slider"
              value={[edits.cropL]}
              onValueChange={([v]) => update("cropL", v)}
              min={0}
              max={45}
              step={1}
              disabled={disabled}
            />
          </Row>
          <Row label="Right" value={edits.cropR} unit="%" testid="row-cropR">
            <Slider
              data-testid="crop-right-slider"
              value={[edits.cropR]}
              onValueChange={([v]) => update("cropR", v)}
              min={0}
              max={45}
              step={1}
              disabled={disabled}
            />
          </Row>
          <Row label="Top" value={edits.cropT} unit="%" testid="row-cropT">
            <Slider
              data-testid="crop-top-slider"
              value={[edits.cropT]}
              onValueChange={([v]) => update("cropT", v)}
              min={0}
              max={45}
              step={1}
              disabled={disabled}
            />
          </Row>
          <Row label="Bottom" value={edits.cropB} unit="%" testid="row-cropB">
            <Slider
              data-testid="crop-bottom-slider"
              value={[edits.cropB]}
              onValueChange={([v]) => update("cropB", v)}
              min={0}
              max={45}
              step={1}
              disabled={disabled}
            />
          </Row>
        </div>
      </div>
    </div>
  );
};

/** Apply current edits to an HTMLImageElement and return a Promise<Blob>. */
export const renderEditedImage = (img, edits, format = "image/png", quality = 0.95) =>
  new Promise((resolve, reject) => {
    try {
      if (!img || !img.naturalWidth) {
        reject(new Error("Image not loaded yet"));
        return;
      }
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const cx = Math.round((edits.cropL / 100) * w);
      const cy = Math.round((edits.cropT / 100) * h);
      const cw = Math.max(1, Math.round((1 - (edits.cropL + edits.cropR) / 100) * w));
      const ch = Math.max(1, Math.round((1 - (edits.cropT + edits.cropB) / 100) * h));

      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      // Browsers without Canvas2D ctx.filter (Safari < 18) silently no-op the
      // assignment; in that case we re-apply brightness/contrast/saturation
      // ourselves via a pixel-loop so the exported blob matches the preview.
      const supportsCtxFilter = "filter" in ctx;
      if (supportsCtxFilter) ctx.filter = editsToCssFilter(edits);
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);

      if (!supportsCtxFilter && editsAreActive(edits)) {
        applyEditsToPixels(ctx, cw, ch, edits);
      }

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
        format,
        quality
      );
    } catch (e) {
      reject(e);
    }
  });

// Fallback pixel transform for browsers without Canvas2D `ctx.filter`.
// Matches the CSS filter chain: brightness → contrast → saturate.
const applyEditsToPixels = (ctx, w, h, edits) => {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const br = edits.brightness / 100;
  const co = edits.contrast / 100;
  const sa = edits.saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * br;
    let g = d[i + 1] * br;
    let b = d[i + 2] * br;
    // contrast around 0.5
    r = (r - 127.5) * co + 127.5;
    g = (g - 127.5) * co + 127.5;
    b = (b - 127.5) * co + 127.5;
    // saturation around luminance
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = lum + (r - lum) * sa;
    g = lum + (g - lum) * sa;
    b = lum + (b - lum) * sa;
    d[i] = Math.max(0, Math.min(255, r));
    d[i + 1] = Math.max(0, Math.min(255, g));
    d[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(imgData, 0, 0);
};

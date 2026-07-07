import React, { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Eye, Grid3x3, SplitSquareHorizontal } from "lucide-react";
import { UploadZone } from "./UploadZone";
import { editsToCssFilter, editsAreActive } from "./ImageEditPanel";
import { CropOverlay } from "./CropOverlay";
import { CompareSlider } from "./CompareSlider";
import { ZoomPanView } from "./ZoomPanView";
import { Loupe } from "./Loupe";

const ViewTabs = ({ active, setActive, hasResult }) => (
  <div
    className="inline-flex border border-zinc-800 bg-zinc-950"
    data-testid="view-tabs"
  >
    {[
      { id: "preview", label: "COLOR", icon: Eye, requiresResult: true },
      { id: "heightmap", label: "HEIGHT", icon: Grid3x3, requiresResult: true },
      { id: "compare", label: "A/B", icon: SplitSquareHorizontal, requiresResult: true },
      { id: "original", label: "SOURCE", icon: RefreshCw, requiresResult: false },
    ].filter((t) => !t.requiresResult || hasResult).map((t) => {
      const Icon = t.icon;
      return (
        <button
          key={t.id}
          data-testid={`view-tab-${t.id}`}
          onClick={() => setActive(t.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.15em] transition-colors duration-150 ${
            active === t.id
              ? "bg-zinc-100 text-zinc-950"
              : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          <Icon className="w-3 h-3" strokeWidth={1.5} />
          {t.label}
        </button>
      );
    })}
  </div>
);

export const Viewport = ({
  onFile,
  onReplace,
  sourceUrl,
  result,
  loading,
  progressLabel,
  onReset,
  renderMode,
  edits,
  setEdits,
  filaments,
}) => {
  const [view, setView] = useState("preview");
  const [zoomed, setZoomed] = useState(false);
  const imgWrapRef = useRef(null);
  // State (not ref) so the Loupe component re-renders when the <img>
  // mounts. Using a ref would never trigger Loupe to subscribe.
  const [imgEl, setImgEl] = useState(null);
  const replaceInputRef = useRef(null);

  useEffect(() => {
    if (result && view === "original") setView("preview");
  }, [result]); // eslint-disable-line

  if (!sourceUrl && !result) {
    return (
      <div className="relative h-full">
        <UploadZone onFile={onFile} />
      </div>
    );
  }

  const previewSrc = result
    ? view === "heightmap"
      ? `data:image/png;base64,${result.heightmap_png_base64}`
      : view === "original"
      ? sourceUrl
      : `data:image/png;base64,${result.preview_png_base64}`
    : sourceUrl;

  // Live edits apply to the un-rendered source view ("source" before
  // generate, or the "Source" tab afterwards). The rendered preview /
  // heightmap already bake in the edits because the optimizer used the
  // edited image, so they show un-filtered.
  const liveEdit = !result || view === "original";
  const filterStyle = liveEdit && edits ? editsToCssFilter(edits) : "none";

  // iter-135 — Crop display. The previous implementation used CSS
  // `clip-path` on the full-sized <img> and left the clipped-out
  // pixels as an empty rectangle inside a fixed viewport container —
  // the user saw a large black band above/below the visible crop
  // (bug reported 2026-07-06). We now wrap the <img> in an
  // `overflow: hidden` box whose aspect ratio matches the crop rect,
  // then scale + translate the underlying <img> so only the crop
  // shows. The visible content fills the viewport at its natural
  // aspect, no dead space. CropOverlay still receives full-container
  // coordinates because the wrapper stays edge-to-edge on the source
  // dimensions — it just crops what's drawn under it.
  const cropActive = liveEdit && edits && editsAreActive(edits) && (
    (edits.cropL || 0) + (edits.cropR || 0) + (edits.cropT || 0) + (edits.cropB || 0) > 0
  );
  const cw = cropActive ? Math.max(1, 100 - (edits.cropL || 0) - (edits.cropR || 0)) : 100;
  const ch = cropActive ? Math.max(1, 100 - (edits.cropT || 0) - (edits.cropB || 0)) : 100;
  const cropImgStyle = cropActive
    ? {
        // Scale the img up so the visible crop rectangle fills the
        // wrapper. The wrapper's aspect ratio is already the crop's
        // aspect ratio, so a `width/height: 100/cw * 100%` scale on
        // each axis yields exactly the crop rect at natural fit.
        width: `${(100 / cw) * 100}%`,
        height: `${(100 / ch) * 100}%`,
        // Shift so the crop's top-left starts at (0,0) of the wrapper.
        // `objectPosition` on a wider-than-container img with
        // object-fit:none positions the pixel origin.
        marginLeft: `${(-(edits.cropL || 0) / cw) * 100}%`,
        marginTop: `${(-(edits.cropT || 0) / ch) * 100}%`,
        maxWidth: "none",
        maxHeight: "none",
        filter: filterStyle,
        ...(view === "heightmap" ? { imageRendering: "pixelated" } : {}),
      }
    : {
        filter: filterStyle,
        ...(view === "heightmap" ? { imageRendering: "pixelated" } : {}),
      };

  return (
    <div
      className="relative h-full flex flex-col grid-bg"
      data-testid="viewport"
    >
      <div className="absolute inset-0 scanline pointer-events-none" />
      <div className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-950/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            Viewport
          </span>
          {result && (
            <span
              className="font-mono text-[10px] text-zinc-400 tabular-nums"
              data-testid="viewport-stats"
            >
              · ΔE {result.delta_e_mean.toFixed(2)} · {result.total_layers}{" "}
              layers · {result.filaments.length} filaments
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ViewTabs active={view} setActive={setView} hasResult={!!result} />
          {onReplace && (
            <>
              <input
                ref={replaceInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                data-testid="replace-photo-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onReplace(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => replaceInputRef.current?.click()}
                data-testid="replace-photo-btn"
                title="Swap the photo without touching your palette, crop, or geometry"
                className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500 hover:text-zinc-200 transition-colors duration-150"
              >
                ⇄ REPLACE
              </button>
            </>
          )}
          <button
            onClick={onReset}
            data-testid="reset-btn"
            className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500 hover:text-zinc-200 transition-colors duration-150"
          >
            ← NEW IMAGE
          </button>
        </div>
      </div>

      <div className="relative z-10 flex-1 flex items-center justify-center p-6 overflow-hidden">
        {view === "compare" && result ? (
          <CompareSlider
            before={sourceUrl}
            after={`data:image/png;base64,${result.preview_png_base64}`}
            leftLabel="ORIGINAL"
            rightLabel={renderMode === "painting" ? "PAINTED" : "LITHOPHANE"}
          />
        ) : (
          <ZoomPanView
            resetKey={`${view}-${sourceUrl}`}
            onZoomChange={setZoomed}
          >
            <div
              ref={imgWrapRef}
              className="relative border border-zinc-800 max-h-full max-w-full inline-block mx-auto overflow-hidden"
              data-testid="viewport-image-wrap"
              style={cropActive ? { aspectRatio: `${cw} / ${ch}`, height: "70vh" } : undefined}
            >
              <img
                ref={setImgEl}
                src={previewSrc}
                alt="lithophane"
                className={
                  cropActive
                    ? "block object-cover"
                    : "block max-h-[70vh] max-w-full object-contain"
                }
                data-testid="viewport-image"
                draggable={false}
                crossOrigin="anonymous"
                style={cropImgStyle}
              />
              {liveEdit && setEdits && !zoomed && !cropActive && (
                <CropOverlay
                  edits={edits}
                  setEdits={setEdits}
                  containerRef={imgWrapRef}
                />
              )}
              {view === "preview" && result && (
                <div className="absolute top-2 left-2 font-mono text-[9px] tracking-[0.2em] text-zinc-300 bg-black/60 px-2 py-0.5 border border-white/10">
                  {renderMode === "painting"
                    ? "PAINT PREVIEW · NEAREST-FILAMENT MAPPING"
                    : "SIMULATED BACKLIT OUTPUT"}
                </div>
              )}
              {view === "heightmap" && (
                <div className="absolute top-2 left-2 font-mono text-[9px] tracking-[0.2em] text-zinc-300 bg-black/60 px-2 py-0.5 border border-white/10">
                  HEIGHT MAP · BRIGHTER = THICKER
                </div>
              )}
            </div>
          </ZoomPanView>
        )}
        {result && filaments?.length > 0 && imgEl && view !== "compare" && (
          <Loupe
            imageEl={imgEl}
            enabled={true}
            filaments={filaments}
          />
        )}
      </div>

      {loading && (
        <div
          className="absolute inset-0 bg-black/70 z-20 flex items-center justify-center backdrop-blur-sm"
          data-testid="loading-overlay"
        >
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-200" strokeWidth={1.5} />
            <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-300">
              {progressLabel || "OPTIMIZING..."}
            </div>
            <div className="font-mono text-[10px] text-zinc-600 max-w-xs text-center tracking-wider">
              Building Beer-Lambert LUT · Matching ΔE in Lab space
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

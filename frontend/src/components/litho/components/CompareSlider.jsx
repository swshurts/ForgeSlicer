import React, { useRef, useState } from "react";

/**
 * A/B compare slider — overlays a "before" image and an "after" image with
 * a draggable vertical divider. Used to compare the source photograph
 * against the rendered output (lithophane / painting simulation).
 */
export const CompareSlider = ({ before, after, leftLabel, rightLabel }) => {
  const [pct, setPct] = useState(50);
  const [drag, setDrag] = useState(false);
  const ref = useRef(null);

  const onMove = (clientX) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.max(0, Math.min(100, p)));
  };

  return (
    <div
      ref={ref}
      data-testid="compare-slider"
      className="relative inline-block"
      onMouseMove={(e) => drag && onMove(e.clientX)}
      onMouseUp={() => setDrag(false)}
      onMouseLeave={() => setDrag(false)}
      onTouchMove={(e) => drag && onMove(e.touches[0].clientX)}
      onTouchEnd={() => setDrag(false)}
    >
      <img
        src={before}
        alt="before"
        className="block max-h-[70vh] max-w-full object-contain select-none"
        draggable={false}
      />
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 0 0 ${pct}%)` }}
      >
        <img
          src={after}
          alt="after"
          className="block max-h-[70vh] max-w-full object-contain select-none"
          draggable={false}
        />
      </div>
      <div
        className="absolute top-0 bottom-0 w-px bg-zinc-100 pointer-events-none"
        style={{ left: `${pct}%` }}
      />
      <button
        data-testid="compare-handle"
        onMouseDown={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onTouchStart={() => setDrag(true)}
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 bg-zinc-100 text-zinc-950 border border-zinc-700 flex items-center justify-center cursor-ew-resize select-none"
        style={{ left: `${pct}%` }}
        aria-label="Drag to compare"
      >
        <span className="font-mono text-[10px] font-bold">↔</span>
      </button>
      <div className="absolute top-2 left-2 font-mono text-[9px] tracking-[0.2em] text-zinc-100 bg-black/60 px-2 py-0.5 border border-white/10">
        {leftLabel}
      </div>
      <div className="absolute top-2 right-2 font-mono text-[9px] tracking-[0.2em] text-zinc-100 bg-black/60 px-2 py-0.5 border border-white/10">
        {rightLabel}
      </div>
    </div>
  );
};

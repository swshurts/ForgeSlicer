import React, { useEffect, useRef, useState } from "react";

/**
 * Drag-handle crop overlay rendered on top of the source image.
 * Uses absolute-positioned divs in percentage coordinates so it stays
 * synced with the edits.cropL/R/T/B values regardless of image scale.
 *
 * 4 corner handles, 4 edge handles + drag-the-rect-itself to move.
 */

const HANDLES = [
  { id: "tl", x: 0,    y: 0,    cursor: "nwse-resize" },
  { id: "tr", x: 100,  y: 0,    cursor: "nesw-resize" },
  { id: "bl", x: 0,    y: 100,  cursor: "nesw-resize" },
  { id: "br", x: 100,  y: 100,  cursor: "nwse-resize" },
  { id: "t",  x: 50,   y: 0,    cursor: "ns-resize" },
  { id: "b",  x: 50,   y: 100,  cursor: "ns-resize" },
  { id: "l",  x: 0,    y: 50,   cursor: "ew-resize" },
  { id: "r",  x: 100,  y: 50,   cursor: "ew-resize" },
];

const MIN_REMAIN_PCT = 10; // never shrink the crop below 10% of either side

export const CropOverlay = ({ edits, setEdits, containerRef }) => {
  const [drag, setDrag] = useState(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((e.clientX - drag.startX) / rect.width) * 100;
      const dy = ((e.clientY - drag.startY) / rect.height) * 100;
      const s = drag.startEdits;
      const next = { ...s };

      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

      if (drag.id === "move") {
        const w = 100 - s.cropL - s.cropR;
        const h = 100 - s.cropT - s.cropB;
        next.cropL = clamp(s.cropL + dx, 0, 100 - w);
        next.cropR = 100 - next.cropL - w;
        next.cropT = clamp(s.cropT + dy, 0, 100 - h);
        next.cropB = 100 - next.cropT - h;
      } else {
        const isCorner = drag.id.length === 2; // tl/tr/bl/br
        const shiftLock = e.shiftKey && isCorner;

        // First, compute the desired raw L/R/T/B from the drag delta.
        let nL = s.cropL;
        let nR = s.cropR;
        let nT = s.cropT;
        let nB = s.cropB;
        if (drag.id.includes("l")) {
          nL = clamp(s.cropL + dx, 0, 100 - s.cropR - MIN_REMAIN_PCT);
        }
        if (drag.id.includes("r")) {
          nR = clamp(s.cropR - dx, 0, 100 - s.cropL - MIN_REMAIN_PCT);
        }
        if (drag.id.includes("t")) {
          nT = clamp(s.cropT + dy, 0, 100 - s.cropB - MIN_REMAIN_PCT);
        }
        if (drag.id.includes("b")) {
          nB = clamp(s.cropB - dy, 0, 100 - s.cropT - MIN_REMAIN_PCT);
        }

        if (shiftLock) {
          // Aspect-ratio lock: preserve the rect aspect (in image-pixel space)
          // captured when the drag started. The dominant axis (whichever has
          // moved more relative to its container side) drives the other.
          const baseAspect = drag.aspectImg; // width / height in PIXELS
          const cw = rect.width;
          const ch = rect.height;
          // current raw rect width/height in pixels
          const newW_px = ((100 - nL - nR) / 100) * cw;
          const newH_px = ((100 - nT - nB) / 100) * ch;
          const driveByWidth =
            Math.abs(newW_px / baseAspect - newH_px) <
            Math.abs(newH_px * baseAspect - newW_px)
              ? false
              : true;

          if (driveByWidth) {
            // Width drives → recompute height to match aspect.
            const targetH_px = newW_px / baseAspect;
            const targetH_pct = (targetH_px / ch) * 100;
            // Anchor the side opposite to the moving corner.
            if (drag.id.includes("t")) {
              nT = clamp(100 - nB - targetH_pct, 0, 100 - nB - MIN_REMAIN_PCT);
            } else {
              nB = clamp(100 - nT - targetH_pct, 0, 100 - nT - MIN_REMAIN_PCT);
            }
          } else {
            const targetW_px = newH_px * baseAspect;
            const targetW_pct = (targetW_px / cw) * 100;
            if (drag.id.includes("l")) {
              nL = clamp(100 - nR - targetW_pct, 0, 100 - nR - MIN_REMAIN_PCT);
            } else {
              nR = clamp(100 - nL - targetW_pct, 0, 100 - nL - MIN_REMAIN_PCT);
            }
          }
        }

        next.cropL = nL;
        next.cropR = nR;
        next.cropT = nT;
        next.cropB = nB;
      }

      // Round to whole percentages for stable values.
      next.cropL = Math.round(next.cropL * 10) / 10;
      next.cropR = Math.round(next.cropR * 10) / 10;
      next.cropT = Math.round(next.cropT * 10) / 10;
      next.cropB = Math.round(next.cropB * 10) / 10;
      setEdits(next);
    };
    const up = () => setDrag(null);
    // Pointer events cover mouse, touch & pen across all browsers — the
    // previous mouse-only handlers meant the crop overlay didn't work on
    // iPad at all.
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
  }, [drag, containerRef, setEdits]);

  const onDown = (id) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    // Capture the *pixel* aspect ratio of the crop at drag start so the
    // Shift-lock keeps the on-screen rect proportional regardless of the
    // container's own width:height.
    let aspectImg = 1;
    if (rect) {
      const w_pct = 100 - edits.cropL - edits.cropR;
      const h_pct = 100 - edits.cropT - edits.cropB;
      const w_px = (w_pct / 100) * rect.width;
      const h_px = (h_pct / 100) * rect.height;
      if (h_px > 0) aspectImg = w_px / h_px;
    }
    setDrag({
      id,
      startX: e.clientX,
      startY: e.clientY,
      startEdits: { ...edits },
      aspectImg,
    });
  };

  const l = edits.cropL;
  const t = edits.cropT;
  const w = 100 - edits.cropL - edits.cropR;
  const h = 100 - edits.cropT - edits.cropB;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      data-testid="crop-overlay"
    >
      {/* dim outside-crop areas */}
      <div
        className="absolute bg-zinc-950/60 pointer-events-none"
        style={{ top: 0, left: 0, right: 0, height: `${t}%` }}
      />
      <div
        className="absolute bg-zinc-950/60 pointer-events-none"
        style={{ top: `${100 - edits.cropB}%`, left: 0, right: 0, bottom: 0 }}
      />
      <div
        className="absolute bg-zinc-950/60 pointer-events-none"
        style={{ top: `${t}%`, left: 0, width: `${l}%`, height: `${h}%` }}
      />
      <div
        className="absolute bg-zinc-950/60 pointer-events-none"
        style={{
          top: `${t}%`,
          right: 0,
          width: `${edits.cropR}%`,
          height: `${h}%`,
        }}
      />

      {/* crop rect — draggable to move */}
      <div
        onPointerDown={onDown("move")}
        data-testid="crop-rect"
        className="absolute border border-zinc-100/80 cursor-move pointer-events-auto touch-none"
        style={{
          left: `${l}%`,
          top: `${t}%`,
          width: `${w}%`,
          height: `${h}%`,
        }}
      >
        {/* rule-of-thirds guides */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/15" />
          <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/15" />
          <div className="absolute top-1/3 left-0 right-0 h-px bg-white/15" />
          <div className="absolute top-2/3 left-0 right-0 h-px bg-white/15" />
        </div>
      </div>

      {/* handles */}
      {HANDLES.map((h0) => {
        const x = l + (w * h0.x) / 100;
        const y = t + (h * h0.y) / 100;
        return (
          <div
            key={h0.id}
            data-testid={`crop-handle-${h0.id}`}
            onPointerDown={onDown(h0.id)}
            className="absolute w-4 h-4 bg-zinc-100 border border-zinc-900 pointer-events-auto touch-none"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-50%, -50%)",
              cursor: h0.cursor,
            }}
          />
        );
      })}
    </div>
  );
};

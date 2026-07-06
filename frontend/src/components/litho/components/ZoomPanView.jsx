import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pinch-to-zoom + pan wrapper for the viewport image.
 *
 * Gesture rules:
 *   • 2-finger pinch (or ctrl/cmd + wheel on desktop) → zoom 1× – 5×
 *   • 1-finger drag → pan (only when zoomed)
 *   • Double-tap / double-click → reset to 100%
 *
 * Crop overlays nested inside are hidden by the parent when `zoomed`
 * fires true, so single-finger drags can't be hijacked by crop handles
 * while inspecting.
 */
export const ZoomPanView = ({ children, resetKey, onZoomChange }) => {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const containerRef = useRef(null);

  // Reset when the underlying image / view changes.
  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    gesture.current = null;
    pointers.current.clear();
  }, [resetKey]);

  useEffect(() => {
    if (onZoomChange) onZoomChange(scale > 1.02);
  }, [scale, onZoomChange]);

  const clampPan = useCallback((rawX, rawY, s) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: rawX, y: rawY };
    const maxX = ((s - 1) * rect.width) / 2;
    const maxY = ((s - 1) * rect.height) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, rawX)),
      y: Math.max(-maxY, Math.min(maxY, rawY)),
    };
  }, []);

  const onPointerDown = (e) => {
    // Skip pointer-capture for built-in interactive children — buttons,
    // crop handles, etc. — at any zoom level so their own onClick fires
    // cleanly without us hijacking the pointer.
    const targetIsInteractive = e.target.closest?.(
      "[data-testid^='crop-handle-'], [data-testid='crop-rect'], [data-testid='zoom-reset'], button, a, input, [role='slider']"
    );
    if (targetIsInteractive) return;

    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers throw if the pointer id is stale; safe to ignore.
    }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        type: "pinch",
        startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        startScale: scale,
        startTx: tx,
        startTy: ty,
      };
    } else if (pointers.current.size === 1 && scale > 1.02) {
      gesture.current = {
        type: "pan",
        startX: e.clientX,
        startY: e.clientY,
        startTx: tx,
        startTy: ty,
      };
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.type === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const newScale = Math.max(
        1,
        Math.min(5, g.startScale * (dist / g.startDist))
      );
      const clamped = clampPan(g.startTx, g.startTy, newScale);
      setScale(newScale);
      setTx(clamped.x);
      setTy(clamped.y);
    } else if (g.type === "pan" && pointers.current.size === 1) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      const clamped = clampPan(g.startTx + dx, g.startTy + dy, scale);
      setTx(clamped.x);
      setTy(clamped.y);
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      // End any in-progress gesture but keep the resulting transform.
      gesture.current = null;
    }
  };

  const onWheel = useCallback(
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0025);
      setScale((cur) => {
        const newScale = Math.max(1, Math.min(5, cur * factor));
        const clamped = clampPan(tx, ty, newScale);
        setTx(clamped.x);
        setTy(clamped.y);
        return newScale;
      });
    },
    [tx, ty, clampPan]
  );

  // React adds `onWheel` handlers as PASSIVE — we can't preventDefault
  // there. Attach the native listener with passive:false so ctrl+wheel
  // zoom doesn't also scroll the page.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const reset = () => {
    setScale(1);
    setTx(0);
    setTy(0);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      className="relative w-full h-full select-none"
      // touch-action: none stops the browser from intercepting our 2-finger
      // pinch as a native page-zoom on iOS Safari. We restore "auto" at
      // scale 1 so taps on crop handles route normally.
      style={{ touchAction: scale > 1.02 ? "none" : "manipulation" }}
      data-testid="zoom-pan-container"
    >
      <div
        style={{
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
          transformOrigin: "center center",
          transition:
            pointers.current.size > 0
              ? "none"
              : "transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)",
          willChange: "transform",
        }}
        className="w-full h-full"
        data-testid="zoom-pan-stage"
      >
        {children}
      </div>
      {scale > 1.02 && (
        <button
          onClick={reset}
          data-testid="zoom-reset"
          className="absolute top-2 right-2 z-40 bg-black/70 backdrop-blur border border-zinc-700 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-200 hover:text-white hover:border-zinc-400 transition-colors"
        >
          {Math.round(scale * 100)}% · reset
        </button>
      )}
    </div>
  );
};

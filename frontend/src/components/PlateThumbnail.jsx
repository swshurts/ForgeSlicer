/**
 * PlateThumbnail — tiny top-down 2D preview drawn into a canvas
 * (iter-151.8, Multi-Plate MVP).
 *
 * Rather than rendering a full offscreen Three.js scene per plate
 * (expensive on tab-hover / scene changes), we draw each object's
 * top-down XY footprint (its rotated bbox, projected to the workplane)
 * as a filled rectangle scaled to the build volume. That's enough for
 * "which plate holds which parts?" glance-recognition without paying
 * the WebGL cost.
 *
 * Redraws whenever the object list for this plate changes. Skipped
 * silently when the plate is empty — the parent chooses whether to
 * render a placeholder in that case.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { useScene } from "../lib/store";
import { computeRotatedBBox } from "../lib/geometry";

const THUMB_W = 44;
const THUMB_H = 32;

export default function PlateThumbnail({ plateId, active }) {
  const canvasRef = useRef(null);
  const objects = useScene((s) => s.objects);
  const buildVolume = useScene((s) => s.buildVolume);

  // Subset scoped to this plate. Membership is decided by `plateId`;
  // any object without one is treated as living on "plate-1" to match
  // the store's rendering contract.
  const scoped = useMemo(
    () => (objects || []).filter(
      (o) => (o.plateId || "plate-1") === plateId && o.visible !== false
    ),
    [objects, plateId]
  );

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    // Retina-crispness: draw at 2× and let CSS scale down.
    const dpr = window.devicePixelRatio || 1;
    cvs.width = THUMB_W * dpr;
    cvs.height = THUMB_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, THUMB_W, THUMB_H);

    // Build-plate outline (X / Y).
    const bvX = Math.max(50, buildVolume?.x || 220);
    const bvY = Math.max(50, buildVolume?.y || 220);
    // Fit build plate into thumbnail with margin.
    const margin = 2;
    const availW = THUMB_W - margin * 2;
    const availH = THUMB_H - margin * 2;
    const scale = Math.min(availW / bvX, availH / bvY);
    const drawW = bvX * scale;
    const drawH = bvY * scale;
    const offX = (THUMB_W - drawW) / 2;
    const offY = (THUMB_H - drawH) / 2;

    // Plate background.
    ctx.fillStyle = active ? "#0c4a6e" : "#0f172a";
    ctx.fillRect(offX, offY, drawW, drawH);
    ctx.strokeStyle = active ? "#38bdf8" : "#334155";
    ctx.lineWidth = 0.7;
    ctx.strokeRect(offX + 0.5, offY + 0.5, drawW - 1, drawH - 1);

    // Objects — draw each as its projected XY rectangle (centered on
    // plate origin, matching the Viewport's world coordinates).
    ctx.fillStyle = active ? "#f97316" : "#94a3b8";
    for (const o of scoped) {
      try {
        const bb = computeRotatedBBox(o);
        const px = o.position?.[0] ?? 0;
        const py = o.position?.[1] ?? 0;
        const minX = bb.min.x + px;
        const maxX = bb.max.x + px;
        const minY = bb.min.y + py;
        const maxY = bb.max.y + py;
        // Map from world XY to canvas — origin is CENTRE of the plate.
        const cx = offX + drawW / 2;
        const cy = offY + drawH / 2;
        const rx = cx + minX * scale;
        const ry = cy - maxY * scale;   // Y is flipped (canvas Y grows down)
        const rw = Math.max(1, (maxX - minX) * scale);
        const rh = Math.max(1, (maxY - minY) * scale);
        ctx.fillRect(rx, ry, rw, rh);
      } catch { /* skip degenerate part */ }
    }
  }, [scoped, buildVolume?.x, buildVolume?.y, active]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={`plate-thumbnail-${plateId}`}
      style={{ width: THUMB_W, height: THUMB_H, display: "block" }}
      className="rounded-sm"
      aria-label={`Thumbnail preview of plate ${plateId}`}
    />
  );
}

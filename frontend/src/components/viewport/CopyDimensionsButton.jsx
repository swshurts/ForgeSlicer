// Iter-131 — Copy dimensions to clipboard.
//
// Floating button in the bottom-right of the viewport. Appears whenever
// (a) DIMS mode is on AND (b) exactly one component is selected — the
// same condition that reveals the dim/position chips. One click copies
// a multi-line, pastable summary of every visible measurement:
//
//   ForgeSlicer measurement — <object name>
//   Bounding box:  W 20.00 mm × D 20.00 mm × H 20.00 mm
//   Position:      X 10.00 mm  Y 10.00 mm  Z 10.00 mm
//   Ruler:         ΔX +20.00 mm  ΔY +20.00 mm  ΔZ +20.00 mm  ‖ 34.6410 mm
//
// The Ruler line is included only when an anchored ruler (rulerAnchor +
// rulerTarget) is active — matches what the user is actually looking
// at on screen. Numbers respect the workspace unit system (mm or in).
import React, { useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { Clipboard, ClipboardCheck } from "lucide-react";
import { useScene } from "../../lib/store";
import { worldBboxOf } from "../../lib/componentDimensions";
import { toDisplayLen } from "../../lib/units";

// Format a signed mm value into the user's display units + string.
function fmt(mm, system, digits) {
  const v = toDisplayLen(mm, system);
  const suffix = system === "in" ? " in" : " mm";
  const d = digits ?? (system === "in" ? 3 : 2);
  return `${v.toFixed(d)}${suffix}`;
}
function fmtSigned(mm, system, digits) {
  const v = toDisplayLen(mm, system);
  const suffix = system === "in" ? " in" : " mm";
  const d = digits ?? (system === "in" ? 3 : 2);
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(d)}${suffix}`;
}

export default function CopyDimensionsButton() {
  const dimLabelsEnabled = useScene((s) => s.dimLabelsEnabled);
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const objects = useScene((s) => s.objects);
  const unitSystem = useScene((s) => s.unitSystem);
  const rulerAnchor = useScene((s) => s.rulerAnchor);
  const rulerTarget = useScene((s) => s.rulerTarget);
  const workplaneOrigin = useScene((s) => s.workplaneRuler?.origin);

  const [copied, setCopied] = useState(false);

  // Only render when the chips would be visible: DIMS on + single-select.
  const obj = useMemo(() => {
    if (!dimLabelsEnabled) return null;
    if (!selectedId) return null;
    // Multi-select would render a different UI in the future; for now
    // the chips only show a single object's dims, so we match that.
    if (selectedIds && selectedIds.length > 1) return null;
    return objects.find((o) => o.id === selectedId) || null;
  }, [dimLabelsEnabled, selectedId, selectedIds, objects]);

  const bbox = useMemo(() => (obj ? worldBboxOf(obj) : null), [obj]);

  const handleCopy = useCallback(async () => {
    if (!obj || !bbox) return;
    const lines = [];
    const name = obj.name || `${obj.type || "Object"} ${obj.id?.slice?.(0, 6) || ""}`.trim();
    lines.push(`ForgeSlicer measurement — ${name}`);

    // Bounding box (W × D × H — X × Y × Z axes).
    const sx = bbox.max[0] - bbox.min[0];
    const sy = bbox.max[1] - bbox.min[1];
    const sz = bbox.max[2] - bbox.min[2];
    lines.push(`Bounding box:  W ${fmt(sx, unitSystem)} × D ${fmt(sy, unitSystem)} × H ${fmt(sz, unitSystem)}`);

    // Position — use the nearest-to-origin corner (matches PositionChip's
    // "bestCorner" convention: the min-min-min corner of the world bbox).
    lines.push(`Position:      X ${fmt(bbox.min[0], unitSystem)}  Y ${fmt(bbox.min[1], unitSystem)}  Z ${fmt(bbox.min[2], unitSystem)}`);

    // If a workplane ruler is placed, position line above is relative
    // to WORLD origin; also emit a "vs. ruler origin" line so users can
    // paste inspection results grounded to their chosen reference.
    if (workplaneOrigin) {
      const [rox, roy, roz] = workplaneOrigin;
      lines.push(`Ruler origin:  ${fmt(rox, unitSystem)}, ${fmt(roy, unitSystem)}, ${fmt(roz, unitSystem)}`);
      lines.push(`Relative pos:  X ${fmtSigned(bbox.min[0] - rox, unitSystem)}  Y ${fmtSigned(bbox.min[1] - roy, unitSystem)}  Z ${fmtSigned(bbox.min[2] - roz, unitSystem)}`);
    }

    // Anchored ruler ΔX/ΔY/ΔZ + Euclidean — only when a full pair is set.
    if (rulerAnchor && rulerTarget) {
      const [ax, ay, az] = rulerAnchor.worldPoint;
      const [tx, ty, tz] = rulerTarget.worldPoint;
      const dx = tx - ax, dy = ty - ay, dz = tz - az;
      const total = Math.hypot(dx, dy, dz);
      // Total distance kept in 4-decimal precision to match the
      // on-screen ruler-dim-total chip (iter-127+).
      const totalStr = unitSystem === "in"
        ? `${(total / 25.4).toFixed(4)} in`
        : `${total.toFixed(4)} mm`;
      lines.push(
        `Ruler:         ΔX ${fmtSigned(dx, unitSystem)}  ΔY ${fmtSigned(dy, unitSystem)}  ΔZ ${fmtSigned(dz, unitSystem)}  ‖ ${totalStr}`
      );
    }

    const text = lines.join("\n");
    try {
      // Modern async clipboard first; fall back to execCommand if the
      // page isn't in a secure context (rare — preview is https).
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success("Dimensions copied", {
        description: `${lines.length} line${lines.length === 1 ? "" : "s"} on your clipboard`,
      });
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error("Copy failed", { description: String(err?.message || err) });
    }
  }, [obj, bbox, unitSystem, rulerAnchor, rulerTarget, workplaneOrigin]);

  if (!obj || !bbox) return null;

  return (
    <button
      data-testid="copy-dimensions-btn"
      type="button"
      onClick={handleCopy}
      title="Copy the visible dimensions to your clipboard"
      className={
        // Sits in the bottom-right of the viewport, above the status bar.
        // Uses ForgeSlicer's accent orange to match the ruler chips
        // when the copy just succeeded, otherwise slate for a calm
        // resting state.
        "absolute bottom-4 right-4 z-30 " +
        "flex items-center gap-2 px-3 py-1.5 rounded-md " +
        "font-mono text-[11px] font-semibold " +
        "border shadow-lg transition-colors select-none " +
        (copied
          ? "bg-emerald-500/95 border-emerald-300 text-white"
          : "bg-slate-900/85 border-slate-700 text-slate-100 hover:bg-slate-800/95 hover:border-slate-600")
      }
      style={{ backdropFilter: "blur(4px)" }}
    >
      {copied ? <ClipboardCheck size={13} /> : <Clipboard size={13} />}
      <span>{copied ? "Copied" : "Copy dims"}</span>
    </button>
  );
}

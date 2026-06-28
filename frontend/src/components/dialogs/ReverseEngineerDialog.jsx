// ReverseEngineerDialog — Phase 3 of the RANSAC primitive-segmentation
// feature. POSTs the selected imported mesh to /api/mesh/segment,
// then renders the detected primitives in a scrollable panel.
//
// Honest-warning behaviour: if the backend reports `coverage < 30%`
// (sculptural / organic mesh — see `classifyMeshShape`), the dialog
// flashes a non-blocking yellow callout explaining that primitive
// reconstruction won't work well for this kind of mesh. The user can
// still "see what RANSAC tried" but is warned not to take the
// results seriously.
//
// Phase 4 will add a "Replace with Primitives" action that swaps the
// static triangle mesh for editable Three.js Box / Cylinder / Sphere
// objects. For now the dialog is read-only — a verification step
// the user can use to inspect what the backend detected.

import React, { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  X,
  Loader2,
  AlertTriangle,
  Square,
  Circle as CircleIcon,
  Cylinder as CylinderIcon,
  Sparkles,
  Replace,
} from "lucide-react";
import { segmentImportedObject, classifyMeshShape } from "../../lib/meshSegmentApi";
import { useScene } from "../../lib/store";
import { primitivesToSceneObjects } from "../../lib/ransacReplace";

const TYPE_META = {
  plane:    { label: "Plane",    icon: Square,         color: "#fb923c" }, // orange-400
  sphere:   { label: "Sphere",   icon: CircleIcon,     color: "#34d399" }, // emerald-400
  cylinder: { label: "Cylinder", icon: CylinderIcon,   color: "#60a5fa" }, // blue-400
};

function fmtNum(n, dp = 2) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}
function fmtVec3(v, dp = 2) {
  if (!Array.isArray(v) || v.length !== 3) return "—";
  return `[${v.map((x) => fmtNum(x, dp)).join(", ")}]`;
}

// ---------------------------------------------------------------------------
// Phase 4 helper — convert RANSAC primitive descriptors into scene
// objects. Implementation lives in lib/ransacReplace.js so it can be
// unit-tested without dragging in the React tree.
// ---------------------------------------------------------------------------

function PrimitiveRow({ primitive, idx }) {
  const meta = TYPE_META[primitive.type] || { label: primitive.type, icon: Square, color: "#94a3b8" };
  const Icon = meta.icon;
  const inlierPct = (primitive.inlier_fraction * 100).toFixed(1);
  return (
    <li
      data-testid={`re-primitive-row-${idx}`}
      className="px-3 py-2.5 hover:bg-slate-800/60 border-b border-slate-800 last:border-b-0"
    >
      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: `${meta.color}22`, color: meta.color }}
        >
          <Icon size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold text-white">
              {meta.label} <span className="text-slate-500 font-mono text-[10px]">#{idx + 1}</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">
              {primitive.inlier_count.toLocaleString()} pts · {inlierPct}%
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 font-mono leading-snug">
            {primitive.type === "plane" && (
              <>normal {fmtVec3(primitive.params.normal, 2)} · d {fmtNum(primitive.params.d, 2)} mm</>
            )}
            {primitive.type === "sphere" && (
              <>centre {fmtVec3(primitive.params.center, 1)} · r {fmtNum(primitive.params.radius, 2)} mm</>
            )}
            {primitive.type === "cylinder" && (
              <>
                centre {fmtVec3(primitive.params.center, 1)} · axis{" "}
                {fmtVec3(primitive.params.axis, 2)} ·{" "}
                r {fmtNum(primitive.params.radius, 2)} mm · h {fmtNum(primitive.params.height, 1)} mm ·{" "}
                arc {fmtNum(primitive.params.arc_degrees, 0)}°
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function ReverseEngineerDialog({ open, onClose, obj }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // iter-111 — Phase 5 sensitivity slider. epsFracPct is the RANSAC
  // inlier tolerance as a fraction of the mesh bbox-diagonal,
  // displayed as a percent (0.2% = the API default, 0.05%-2.0%
  // clamped). Smaller = stricter fits, fewer false-positives but the
  // detector misses noisy surfaces. Larger = looser fits, picks up
  // more primitives but accepts sloppier matches.
  const DEFAULT_EPS_FRAC_PCT = 0.2;
  const [epsFracPct, setEpsFracPct] = useState(DEFAULT_EPS_FRAC_PCT);
  const [pendingEpsFracPct, setPendingEpsFracPct] = useState(DEFAULT_EPS_FRAC_PCT);

  const runScan = React.useCallback(async (epsPct) => {
    if (!obj) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await segmentImportedObject(obj, { epsFrac: epsPct / 100 });
      setResult(r);
      setEpsFracPct(epsPct);
    } catch (err) {
      setError(err.message || String(err));
      toast.error(`Reverse-Engineer failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }, [obj]);

  useEffect(() => {
    if (!open || !obj) return;
    setPendingEpsFracPct(DEFAULT_EPS_FRAC_PCT);
    runScan(DEFAULT_EPS_FRAC_PCT);
  }, [open, obj, runScan]);

  const classification = useMemo(() => {
    if (!result) return null;
    return classifyMeshShape(result.stats.coverage);
  }, [result]);

  const grouped = useMemo(() => {
    if (!result) return { plane: 0, sphere: 0, cylinder: 0 };
    const counts = { plane: 0, sphere: 0, cylinder: 0 };
    for (const p of result.primitives) {
      counts[p.type] = (counts[p.type] || 0) + 1;
    }
    return counts;
  }, [result]);

  // ---- iter-110 — Phase 4: "Overlay with primitives" ---------------
  // Approach (c) — keep the source mesh in the scene as a faded
  // "ghost" reference, drop the detected primitives ON TOP. This is
  // non-destructive: the user can roll the ghost back to a normal
  // mesh from the Inspector, or undo to remove the primitives
  // entirely. Iter-111.2 — changed from `replaceObjects` to
  // ghost+add after the planes-only result showed that an
  // immediately-destructive Replace is too lossy when the
  // reconstruction is only a starting layout.
  const [applying, setApplying] = useState(false);
  const onReplaceWithPrimitives = async () => {
    if (!result || !obj) return;

    // iter-111.3 — clean up the overlay output. The previous version
    // dropped every detected primitive (including N thin plane slabs)
    // on top of the ghost — which looked great in screenshots of
    // mechanical parts but, on planes-only meshes, the 9 floating
    // slabs interfered visually with the ghost and the user couldn't
    // see what was happening. New behaviour:
    //
    //   • Planes are NEVER overlaid as N thin slabs (they don't form
    //     usable solids and they obscure the ghost reference).
    //   • If the detector found CYLINDERS or SPHERES, overlay just
    //     those — they're proper editable replacements that beginners
    //     can manipulate without losing the ghost as scaffolding.
    //   • If the result is PLANES-ONLY, drop a single Box sized to
    //     the source mesh's world bbox as a "starting block". The
    //     user chips away with negative cylinders / Cut tools.
    const useful = result.primitives.filter(
      (p) => p.type === "cylinder" || p.type === "sphere",
    );
    let replacement = primitivesToSceneObjects(useful, obj);
    let fallbackUsed = false;
    if (replacement.length === 0) {
      // Planes-only — drop one bbox-approximation Box. We grab the
      // source object's CURRENT world bbox (not the source-frame
      // mesh extents) so the starting block sits exactly where the
      // ghosted mesh appears on the bed.
      try {
        const { computeRotatedBBox } = await import("../../lib/geometry");
        const bb = computeRotatedBBox(obj);
        const sx = Math.max(1, bb.max.x - bb.min.x);
        const sy = Math.max(1, bb.max.y - bb.min.y);
        const sz = Math.max(1, bb.max.z - bb.min.z);
        const pos = obj.position || [0, 0, 0];
        const cx = pos[0] + (bb.max.x + bb.min.x) / 2;
        const cy = pos[1] + (bb.max.y + bb.min.y) / 2;
        const cz = pos[2] + (bb.max.z + bb.min.z) / 2;
        const { buildPrimitive } = await import("../../lib/primitiveDefaults");
        replacement = [
          buildPrimitive("cube", "positive", {
            name: `${obj.name || "Source"} (approx solid)`,
            dims: { x: sx, y: sy, z: sz },
            position: [cx, cy, cz],
          }),
        ];
        fallbackUsed = true;
      } catch (e) {
        toast.error(`Couldn't build approximation Box: ${e.message || e}`);
        return;
      }
    }

    setApplying(true);
    try {
      const store = useScene.getState();
      store.pushHistory();
      useScene.setState((st) => ({
        objects: [
          ...st.objects.map((o) =>
            o.id === obj.id ? { ...o, ghosted: true, locked: true } : o,
          ),
          ...replacement,
        ],
        selectedId: replacement[0].id,
        selectedIds: replacement.map((r) => r.id),
      }));

      if (fallbackUsed) {
        toast.success(
          `No editable primitives — dropped one source-sized Box approximation. Chip away with Cut & negative cylinders. Source kept as a faded reference.`,
        );
      } else {
        const cyls = useful.filter((p) => p.type === "cylinder").length;
        const sphs = useful.filter((p) => p.type === "sphere").length;
        const summary = [];
        if (cyls) summary.push(`${cyls} cylinder${cyls === 1 ? "" : "s"}`);
        if (sphs) summary.push(`${sphs} sphere${sphs === 1 ? "" : "s"}`);
        const skipped = result.primitives.length - useful.length;
        toast.success(
          `Overlaid ${summary.join(" · ")} on "${obj.name || "mesh"}" — ${skipped} plane${skipped === 1 ? "" : "s"} skipped (not useful as overlay). Source is now a faded reference.`,
        );
      }
      onClose();
    } catch (e) {
      toast.error(`Overlay failed: ${e.message || e}`);
    } finally {
      setApplying(false);
    }
  };
  const canReplace = !!result && !busy && !error && result.primitives.length > 0 && classification !== "organic";
  // When every detected primitive is a plane, the resulting scene is
  // N thin slabs floating where the source surfaces were — visually
  // it will NOT resemble the source mesh. Flag this so the user
  // doesn't think the feature is broken (iter-111.1 lesson learned).
  const allPlanes = !!result && result.primitives.length > 0 && result.primitives.every((p) => p.type === "plane");

  if (!open) return null;

  return (
    <div
      data-testid="re-dialog-overlay"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="re-dialog"
        className="w-[560px] max-h-[80vh] bg-slate-950 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-orange-400" />
              <h2 className="text-[14px] font-bold text-white tracking-tight">Reverse Engineer</h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              RANSAC primitive detection on{" "}
              <span className="font-mono text-slate-300">{obj?.name || "selected mesh"}</span>
            </p>
          </div>
          <button
            data-testid="re-close-btn"
            onClick={onClose}
            className="text-slate-500 hover:text-white p-1 -m-1 rounded"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto" data-testid="re-body">
          {busy && (
            <div
              data-testid="re-loading"
              className="flex flex-col items-center justify-center py-16 px-6 text-center"
            >
              <Loader2 size={28} className="text-orange-400 animate-spin mb-3" />
              <p className="text-[13px] text-slate-200 font-medium">Detecting primitives…</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-[320px]">
                Iterative RANSAC: spheres first, then cylinders (Hough-on-Gauss-map +
                2D circle fit), then planes catch the rest. 1–8 s for typical meshes.
              </p>
            </div>
          )}

          {!busy && error && (
            <div
              data-testid="re-error"
              className="m-5 p-4 rounded-lg bg-rose-950/40 border border-rose-700/60 text-[12px] text-rose-200"
            >
              <strong className="text-rose-100">Segmentation failed.</strong>
              <p className="mt-1 leading-snug">{error}</p>
            </div>
          )}

          {!busy && !error && result && (
            <>
              {/* Honest-warning banner for organic / sculptural meshes */}
              {classification === "organic" && (
                <div
                  data-testid="re-organic-warning"
                  className="mx-5 mt-5 p-3.5 rounded-lg bg-amber-950/40 border border-amber-600/60"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="text-[12px] text-amber-100 leading-snug">
                      <strong className="text-amber-50">This looks like an art piece.</strong>
                      <p className="mt-1">
                        Only{" "}
                        <span className="font-mono">
                          {(result.stats.coverage * 100).toFixed(0)}%
                        </span>{" "}
                        of the mesh fits geometric primitives — sculptures, organic forms,
                        and freeform CAD won&apos;t reconstruct cleanly from planes / cylinders /
                        spheres. The detected primitives below are a best-effort
                        approximation, not an accurate parametric model. Reverse-Engineering
                        works best on mechanical parts.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {classification === "mixed" && (
                <div
                  data-testid="re-mixed-warning"
                  className="mx-5 mt-5 p-3 rounded-lg bg-sky-950/40 border border-sky-600/50 text-[11px] text-sky-200"
                >
                  <strong className="text-sky-100">Partial coverage</strong> — RANSAC
                  classified <span className="font-mono">{(result.stats.coverage * 100).toFixed(0)}%</span>{" "}
                  of the mesh. Review the primitives carefully; some freeform regions are
                  approximated by the closest-fit shape.
                </div>
              )}

              {/* Stats summary */}
              <div
                data-testid="re-stats"
                className="mx-5 mt-5 grid grid-cols-4 gap-2 text-center"
              >
                {[
                  { label: "Planes", v: grouped.plane, color: TYPE_META.plane.color },
                  { label: "Cylinders", v: grouped.cylinder, color: TYPE_META.cylinder.color },
                  { label: "Spheres", v: grouped.sphere, color: TYPE_META.sphere.color },
                  {
                    label: "Coverage",
                    v: `${(result.stats.coverage * 100).toFixed(0)}%`,
                    color: classification === "organic" ? "#fbbf24" : "#a3e635",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="bg-slate-900/80 border border-slate-800 rounded p-2"
                  >
                    <div
                      className="text-[18px] font-bold leading-none"
                      style={{ color: s.color }}
                    >
                      {s.v}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* iter-111 — Phase 5 sensitivity slider. Live-edits
                  `pendingEpsFracPct`; the "Re-run" button commits it
                  and re-triggers segmentation. Splitting pending vs
                  committed avoids hammering the backend on every
                  micro-slider-twitch. */}
              <div
                data-testid="re-sensitivity"
                className="mx-5 mt-3 p-3 rounded border border-slate-800 bg-slate-900/40"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                    Sensitivity
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    ε = {pendingEpsFracPct.toFixed(2)}% of bbox-diagonal
                  </span>
                </div>
                <input
                  type="range"
                  data-testid="re-sensitivity-slider"
                  min="0.05"
                  max="2.0"
                  step="0.05"
                  value={pendingEpsFracPct}
                  onChange={(e) => setPendingEpsFracPct(parseFloat(e.target.value))}
                  className="w-full mt-2 accent-orange-500"
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-slate-500">stricter (fewer primitives)</span>
                  <span className="text-[9px] text-slate-500">looser (more primitives)</span>
                </div>
                {Math.abs(pendingEpsFracPct - epsFracPct) > 0.001 && (
                  <button
                    data-testid="re-rescan-btn"
                    onClick={() => runScan(pendingEpsFracPct)}
                    disabled={busy}
                    className="mt-2 w-full h-7 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 text-white text-[11px] font-semibold rounded inline-flex items-center justify-center gap-1.5"
                  >
                    {busy && <Loader2 size={11} className="animate-spin" />}
                    Re-run with ε = {pendingEpsFracPct.toFixed(2)}%
                  </button>
                )}
              </div>

              {/* Primitive list */}
              {result.primitives.length === 0 ? (
                <div className="mx-5 my-6 text-[12px] text-slate-400 italic text-center">
                  No primitives detected. Either the mesh is fully organic, or the
                  RANSAC tolerance is too tight for this scale.
                </div>
              ) : (
                <ul
                  data-testid="re-primitive-list"
                  className="mt-4 mx-5 mb-5 border border-slate-800 rounded-lg overflow-hidden divide-y divide-slate-800 bg-slate-900/40"
                >
                  {result.primitives.map((p, i) => (
                    <PrimitiveRow key={i} primitive={p} idx={i} />
                  ))}
                </ul>
              )}

              {/* Footer with meta */}
              <div className="px-5 py-2.5 border-t border-slate-800 bg-slate-900/40 text-[10px] font-mono text-slate-500 flex items-center justify-between">
                <span>{result.stats.in_tris.toLocaleString()} tris · ε = {fmtNum(result.stats.eps, 3)} mm</span>
                <span>{(result.stats.elapsed_seconds).toFixed(2)}s</span>
              </div>
            </>
          )}
        </div>

        {/* Action bar */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between gap-3">
          {canReplace ? (
            <span
              data-testid="re-replace-hint"
              className="text-[10px] text-slate-400 leading-snug max-w-[300px]"
            >
              {allPlanes ? (
                <>
                  <span className="text-amber-300 font-semibold">Planes-only result.</span> Overlay drops a single source-sized Box approximation on top of the ghost — a starting block you can chip away with Cut + negative cylinders. Inspector → Restore un-ghosts the source.
                </>
              ) : (
                <>Overlay drops editable Cylinder + Sphere primitives over the source (planes are skipped — they don&apos;t form usable solids). The source becomes a faded reference you can re-enable later.</>
              )}
            </span>
          ) : (
            <span className="text-[10px] text-slate-500 max-w-[260px] leading-snug">
              {classification === "organic"
                ? "This mesh is too organic to reconstruct — Replace is disabled."
                : "Replace will activate once primitives are detected."}
            </span>
          )}
          <div className="flex items-center gap-2">
            {canReplace && (
              <button
                data-testid="re-apply-btn"
                onClick={onReplaceWithPrimitives}
                disabled={applying}
                className="h-8 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-[12px] font-semibold rounded border border-emerald-400/40 inline-flex items-center gap-1.5"
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : <Replace size={12} />}
                Overlay with primitives
              </button>
            )}
            <button
              data-testid="re-done-btn"
              onClick={onClose}
              className="h-8 px-4 bg-slate-800 hover:bg-slate-700 text-white text-[12px] font-semibold rounded border border-slate-700"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

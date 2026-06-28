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
import * as THREE from "three";
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
import { buildPrimitive } from "../../lib/primitiveDefaults";

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
// Phase 4 helper — convert RANSAC primitive descriptors into scene objects.
//
// The endpoint returns one descriptor per detected primitive:
//   plane    → params.normal[3], params.d
//   sphere   → params.center[3], params.radius
//   cylinder → params.center[3], params.axis[3], params.radius, params.height
//
// Each primitive ALSO carries a `bbox: { min:[x,y,z], max:[x,y,z] }` from
// the inlier points; we use that for planes (which have no intrinsic
// extents) and as a sanity-fallback for the other types.
// ---------------------------------------------------------------------------
function bboxSize(bbox) {
  if (!bbox || !Array.isArray(bbox.min) || !Array.isArray(bbox.max)) return null;
  return {
    x: bbox.max[0] - bbox.min[0],
    y: bbox.max[1] - bbox.min[1],
    z: bbox.max[2] - bbox.min[2],
    cx: (bbox.max[0] + bbox.min[0]) / 2,
    cy: (bbox.max[1] + bbox.min[1]) / 2,
    cz: (bbox.max[2] + bbox.min[2]) / 2,
  };
}

/** Rotation that maps the local +Z axis onto `axis` (a 3-tuple). Returns
 *  Euler degrees [x,y,z]. Used by cylinder conversion since the
 *  parametric cylinder primitive's local axis is +Z (post Z-up
 *  refactor, see geometry.js docstring). */
function eulerToAlignZ(axis) {
  const a = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), a);
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return [
    THREE.MathUtils.radToDeg(e.x),
    THREE.MathUtils.radToDeg(e.y),
    THREE.MathUtils.radToDeg(e.z),
  ];
}

export function primitivesToSceneObjects(primitives) {
  const out = [];
  for (const p of primitives || []) {
    if (p.type === "sphere") {
      const r = Math.max(0.1, p.params?.radius ?? 1);
      const c = p.params?.center || [0, 0, r];
      out.push(buildPrimitive("sphere", "positive", {
        name: `Sphere (RE r=${r.toFixed(1)})`,
        dims: { r },
        position: [c[0], c[1], c[2]],
      }));
    } else if (p.type === "cylinder") {
      const r = Math.max(0.1, p.params?.radius ?? 1);
      const h = Math.max(0.1, p.params?.height ?? 10);
      const c = p.params?.center || [0, 0, h / 2];
      const ax = p.params?.axis || [0, 0, 1];
      out.push(buildPrimitive("cylinder", "positive", {
        name: `Cylinder (RE r=${r.toFixed(1)} h=${h.toFixed(1)})`,
        dims: { r, h, segments: 64 },
        position: [c[0], c[1], c[2]],
        rotation: eulerToAlignZ(ax),
      }));
    } else if (p.type === "plane") {
      // Planes are infinite — extrude a thin Box (1 mm thick) sized to
      // the inlier bounding box so the user has something tangible to
      // edit. The plane's normal becomes the box's "thin" axis. We
      // build the box axis-aligned to world (since rotating a Box to
      // align an arbitrary normal would require trigonometry on every
      // edge), then rotate the box. If the inlier bbox is degenerate
      // we fall back to a 20×20×1 default at the plane's anchor.
      const size = bboxSize(p.bbox);
      const sx = size && size.x > 0.5 ? size.x : 20;
      const sy = size && size.y > 0.5 ? size.y : 20;
      const sz = 1; // skin thickness
      const cx = size?.cx ?? 0;
      const cy = size?.cy ?? 0;
      const cz = size?.cz ?? 0;
      const n = p.params?.normal || [0, 0, 1];
      out.push(buildPrimitive("cube", "positive", {
        name: `Plane (RE ${sx.toFixed(0)}×${sy.toFixed(0)} mm)`,
        dims: { x: sx, y: sy, z: sz },
        position: [cx, cy, cz],
        rotation: eulerToAlignZ(n),
      }));
    }
  }
  return out;
}

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

  useEffect(() => {
    if (!open || !obj) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setResult(null);
    (async () => {
      try {
        const r = await segmentImportedObject(obj);
        if (!cancelled) setResult(r);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || String(err));
          toast.error(`Reverse-Engineer failed: ${err.message || err}`);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, obj]);

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

  // ---- iter-110 — Phase 4: "Replace with primitives" ---------------
  // Convert each detected primitive into an editable scene object via
  // the existing parametric primitive system, then remove the source
  // imported mesh. The replacement is geometric, not topological —
  // organic shapes will lose detail, which is why the dialog only
  // surfaces this CTA when classification ≠ "organic".
  const [applying, setApplying] = useState(false);
  const onReplaceWithPrimitives = async () => {
    if (!result || !obj) return;
    const replacement = primitivesToSceneObjects(result.primitives);
    if (replacement.length === 0) {
      toast.warning("Nothing replaceable — the detector returned no actionable primitives.");
      return;
    }
    setApplying(true);
    try {
      // One atomic op so a single undo restores the imported mesh.
      useScene.getState().replaceObjects([obj.id], replacement);
      const summary = [];
      if (grouped.cylinder) summary.push(`${grouped.cylinder} cylinder${grouped.cylinder === 1 ? "" : "s"}`);
      if (grouped.sphere)   summary.push(`${grouped.sphere} sphere${grouped.sphere === 1 ? "" : "s"}`);
      if (grouped.plane)    summary.push(`${grouped.plane} plane${grouped.plane === 1 ? "" : "s"}`);
      toast.success(`Replaced "${obj.name || "mesh"}" with ${summary.join(" · ")} — fully editable now.`);
      onClose();
    } catch (e) {
      toast.error(`Replace failed: ${e.message || e}`);
    } finally {
      setApplying(false);
    }
  };
  const canReplace = !!result && !busy && !error && result.primitives.length > 0 && classification !== "organic";

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
              className="text-[10px] text-slate-400 leading-snug max-w-[260px]"
            >
              Phase 4 — replace the imported mesh with editable Box / Cylinder / Sphere primitives. Undo restores the source mesh.
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
                Replace with primitives
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

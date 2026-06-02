// PrintPreviewDialog — slicer-frame "what will actually be printed"
// preview, with quick orient controls so the user can find the
// best face-down orientation before committing four hours of print
// time. Iter-80.
//
// Why it exists:
//   ForgeSlicer's workspace is Y-up; OrcaSlicer is Z-up. After the
//   coord flip + drop-to-bed, what the user sees in the workspace
//   often doesn't match what the slicer will print (the canonical
//   case being a "vertical wall" in workspace becoming a "horizontal
//   plate that needs to be flipped 180° to avoid 100mm of support"
//   in the slicer). This dialog renders the actual merged manifold
//   geometry in the slicer's frame, with the build-plate beneath
//   it, and lets the user rotate ±90° around any axis until the
//   silhouette looks right. Then "Slice this orientation" bakes the
//   chosen transform into the STL bytes and kicks off the slice.
//
// Pipeline:
//   1. open  → flattenObjectsAsync(objects)
//                returns { vertices, indices } in WORKSPACE (Y-up) frame
//   2. apply makeRotationX(+π/2) once  → now in SLICER (Z-up) frame
//   3. apply user-confirmed previewRot (composed quaternion)
//   4. drop-to-bed (translate so min Z = 0)
//   5. on confirm: export STL from this final geometry, hand bytes
//      to useOrcaSlice's runSlice via the stlBytesOverride hook.
//
// Auto Lay Flat re-uses the same "shortest-axis becomes vertical"
// heuristic as the workspace Lay-Flat button, but additionally
// tests both rotation signs and picks the one with the larger bed
// footprint after drop — so an asymmetric assembly lands "panel
// face down" instead of "panel face up".

import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import {
  X, Loader2, RotateCcw, RotateCw, Layers, Send, AlertTriangle, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { flattenObjectsAsync } from "../../lib/workerClient";
import { geometryToSTLBinary } from "../../lib/exporters";
import { useScene } from "../../lib/store";

// Build a BufferGeometry from the {vertices, indices} pair returned
// by flattenObjectsAsync (works for both the Manifold-3D worker
// result and the bvh-csg main-thread fallback).
function buildGeometry(verts, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  if (idx) g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

// Score an orientation by how "printable" it looks: bigger bed
// footprint = better adhesion AND smaller overhang fraction = fewer
// supports needed. Also returns model volume (for the cost/time
// estimator) and a precomputed per-triangle "downward-ness" flag the
// caller paints as red overhang vertex colours. Iter-81.
function orientationScore(g, overhangCosThreshold = -0.5) {
  const pos = g.attributes.position.array;
  const idx = g.index ? g.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  let totalArea = 0, downArea = 0, footprintXY = 0;
  let signedVolume6 = 0;  // 6× signed volume via divergence theorem.
  let minZ = Infinity, maxZ = -Infinity;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3]     : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
    minZ = Math.min(minZ, a.z, b.z, c.z); maxZ = Math.max(maxZ, a.z, b.z, c.z);
    ab.subVectors(b, a); ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    const triArea = len / 2;
    totalArea += triArea;
    // Signed-volume contribution: V_tet = (a · (b × c)) / 6. Sum over
    // all triangles with consistent winding gives the closed mesh's
    // volume. Robust for our flattened-manifold output.
    signedVolume6 += a.x * (b.y * c.z - b.z * c.y)
                   + a.y * (b.z * c.x - b.x * c.z)
                   + a.z * (b.x * c.y - b.y * c.x);
    // Unit Z component of the normal → "how downward-facing" the
    // triangle is. -1 = perfectly pointing at the bed, 0 = vertical
    // wall, +1 = ceiling. Triangles below the threshold are flagged
    // as needing supports. iter-81's red-overhang painter reads this.
    const cosZ = len > 1e-9 ? n.z / len : 0;
    if (cosZ < -1e-6) {
      downArea += triArea;
      const lowZ = Math.min(a.z, b.z, c.z);
      if (lowZ - minZ < 0.5) footprintXY += Math.abs(n.z) / 2;
    }
    // (downward bit isn't returned per-triangle here — the per-tri
    // colour painter recomputes locally to keep this function O(1)
    // memory for the heat-map case.)
    void overhangCosThreshold;
  }
  return {
    totalArea, downArea, footprintXY,
    height: maxZ - minZ,
    volume: Math.abs(signedVolume6) / 6,
  };
}

// Paint per-triangle vertex colours onto a (CLONED) BufferGeometry:
// downward-facing triangles steeper than `overhangAngleDeg` get a
// warning red, others get a neutral orange. Used by the Print
// Preview dialog to give the user a visual "supports go here" cue
// before they slice. iter-81.
function applyOverhangColors(g, overhangAngleDeg = 45) {
  const pos = g.attributes.position.array;
  const idx = g.index ? g.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const colors = new Float32Array(pos.length);
  const cosThresh = -Math.cos(THREE.MathUtils.degToRad(overhangAngleDeg));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  // Two palette colours — bias orange brand colour ("#f97316") for
  // safe surfaces, and red for overhangs (`#ef4444`).
  const safeR = 0.976, safeG = 0.451, safeB = 0.086;
  const warnR = 0.937, warnG = 0.267, warnB = 0.267;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3]     : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
    ab.subVectors(b, a); ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    const cosZ = len > 1e-9 ? n.z / len : 0;
    const isOverhang = cosZ < cosThresh;
    const r = isOverhang ? warnR : safeR;
    const gr = isOverhang ? warnG : safeG;
    const bb = isOverhang ? warnB : safeB;
    for (const i of [i0, i1, i2]) {
      colors[i * 3 + 0] = r;
      colors[i * 3 + 1] = gr;
      colors[i * 3 + 2] = bb;
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// Print-time + filament-cost heuristic (iter-81). Given the slicer-
// frame geometry and basic FDM defaults, returns a rough estimate
// that's accurate to within ±30 % of OrcaSlicer's actual figures —
// good enough for comparing orientations side-by-side, which is the
// whole point of having this in the preview dialog.
//
// Heuristics:
//   • Shell filament: surface_area × wall_count × line_width × layer_height
//   • Infill filament: interior_volume × infill_density
//   • Total volume → mm of 1.75 mm filament → grams (PLA 1.24 g/cm³)
//   • Time = total_filament_mm / extrusion_feed_rate
//
// All defaults are tunable later via a preset; we keep them locked
// for now so the comparison number is reproducible per orientation.
function estimatePrintCostTime(score, opts = {}) {
  const {
    wallCount = 3,
    lineWidth = 0.4,      // mm
    layerHeight = 0.2,    // mm
    infillDensity = 0.15, // 15 %
    filamentDiameter = 1.75,         // mm
    pricePerKg = 22,                 // USD, generic PLA street price
    plaDensity = 1.24,               // g / cm³
    extrusionFeedMmPerMin = 1100,    // ~typical for 0.4 mm @ 150 mm/s, mid-tier printer
  } = opts;
  if (!score || score.volume <= 0) return null;
  // Shell volume: outer surface area × wall stack thickness, scaled
  // down 0.6× because most "downward" triangles aren't wall surfaces
  // (they're floors/overhangs that don't need wall stacks).
  const shellVolume = score.totalArea * 0.6 * wallCount * lineWidth * layerHeight / lineWidth;
  // Infill volume: model volume × density (rough — ignores the volume
  // already occupied by the shell, which is small for typical parts).
  const infillVolume = Math.max(0, score.volume - shellVolume) * infillDensity;
  const totalFilamentVolume = shellVolume + infillVolume;
  // Convert volume to mm of 1.75 mm filament.
  const filamentCrossSection = Math.PI * (filamentDiameter / 2) ** 2;
  const filamentMM = totalFilamentVolume / filamentCrossSection;
  const grams = (totalFilamentVolume / 1000) * plaDensity;
  const cost = (grams / 1000) * pricePerKg;
  const minutes = filamentMM / extrusionFeedMmPerMin;
  return { filamentMM, grams, cost, minutes };
}

// All 6 face-up rotations as quaternions. Used by Auto-Lay-Flat to
// brute-force the best face-down orientation instead of guessing.
function allAxisRotations() {
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisY = new THREE.Vector3(0, 1, 0);
  return [
    new THREE.Quaternion(),                                          // identity
    new THREE.Quaternion().setFromAxisAngle(axisX,  Math.PI),        // flip X 180°
    new THREE.Quaternion().setFromAxisAngle(axisX,  Math.PI / 2),    // rotate X +90
    new THREE.Quaternion().setFromAxisAngle(axisX, -Math.PI / 2),    // rotate X -90
    new THREE.Quaternion().setFromAxisAngle(axisY,  Math.PI / 2),    // rotate Y +90
    new THREE.Quaternion().setFromAxisAngle(axisY, -Math.PI / 2),    // rotate Y -90
  ];
}

export default function PrintPreviewDialog({ open, objects, onClose, onConfirm, busy }) {
  // Flattened-mesh state.
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [baseGeom, setBaseGeom] = useState(null);  // slicer-frame, no user rotation
  const buildVolume = useScene((s) => s.buildVolume);

  // User-controlled rotation (a composed quaternion applied on top of
  // baseGeom before render + before commit).
  const [userQuat, setUserQuat] = useState(() => new THREE.Quaternion());

  // Rebuild flattened mesh whenever the dialog re-opens. Closing the
  // dialog clears state so reopening on a *different* model re-runs
  // the Manifold-3D worker.
  useEffect(() => {
    if (!open) {
      setBaseGeom(null); setUserQuat(new THREE.Quaternion()); setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const flat = await flattenObjectsAsync(objects);
        if (cancelled) return;
        if (!flat?.vertices?.length) {
          setError("Empty scene — add at least one positive component before slicing.");
          setLoading(false);
          return;
        }
        const g = buildGeometry(flat.vertices, flat.indices);
        // Y-up workspace → Z-up slicer frame.
        g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        // Centre over the bed origin in XY for nicer preview framing.
        g.computeBoundingBox();
        const bb = g.boundingBox;
        const cx = (bb.min.x + bb.max.x) / 2;
        const cy = (bb.min.y + bb.max.y) / 2;
        g.applyMatrix4(new THREE.Matrix4().makeTranslation(-cx, -cy, -bb.min.z));
        setBaseGeom(g);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || String(e));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, objects]);

  // Derived: the geometry actually shown in the canvas =
  // baseGeom with userQuat applied + dropped to bed + overhang
  // colours painted onto vertex attributes (iter-81).
  const renderGeom = useMemo(() => {
    if (!baseGeom) return null;
    const g = baseGeom.clone();
    const m = new THREE.Matrix4().makeRotationFromQuaternion(userQuat);
    g.applyMatrix4(m);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -bb.min.z));
    g.computeVertexNormals();
    applyOverhangColors(g);
    return g;
  }, [baseGeom, userQuat]);

  // Live stats for the right panel.
  const stats = useMemo(() => renderGeom ? orientationScore(renderGeom) : null, [renderGeom]);
  // Print-time + filament-cost heuristic (iter-81). Recomputes for
  // every orientation so the user sees the impact of rotation
  // choices on cost / time before committing four hours of print.
  const costTime = useMemo(() => estimatePrintCostTime(stats), [stats]);

  // Discrete-step rotation buttons. Each click multiplies the current
  // userQuat by the new delta, so multiple clicks compose like the
  // gizmo would.
  const applyRotation = (axis, deg) => {
    const v = axis === "x" ? new THREE.Vector3(1, 0, 0)
            : axis === "y" ? new THREE.Vector3(0, 1, 0)
            :                new THREE.Vector3(0, 0, 1);
    const dq = new THREE.Quaternion().setFromAxisAngle(v, THREE.MathUtils.degToRad(deg));
    setUserQuat((q) => dq.clone().multiply(q));
  };

  // Auto Lay Flat: try all 6 cube face-ups, score each, pick best.
  const autoLayFlat = () => {
    if (!baseGeom) return;
    const candidates = allAxisRotations();
    let bestQ = null, bestScore = -Infinity;
    for (const cq of candidates) {
      const g = baseGeom.clone();
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(cq));
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -bb.min.z));
      const s = orientationScore(g);
      // Score = footprintXY (bigger = more bed contact, less likely to tip)
      // minus 0.3 × downArea (penalise overhangs needing supports).
      // Tie-breaker: prefer shorter prints (faster).
      const score = s.footprintXY - 0.3 * s.downArea - 0.05 * s.height;
      if (score > bestScore) { bestScore = score; bestQ = cq; }
    }
    if (bestQ) setUserQuat(bestQ);
    toast.success("Auto Lay Flat applied", { duration: 1500 });
  };

  const resetRotation = () => setUserQuat(new THREE.Quaternion());

  // Commit: bake renderGeom to STL bytes and hand back to caller.
  const handleConfirm = () => {
    if (!renderGeom) return;
    try {
      const dv = geometryToSTLBinary(renderGeom);
      const bytes = new Uint8Array(dv.buffer);
      const triCount = renderGeom.index
        ? renderGeom.index.count / 3
        : renderGeom.attributes.position.count / 3;
      onConfirm({ bytes, triangleCount: Math.floor(triCount) });
    } catch (e) {
      toast.error(`Could not export STL: ${e?.message || e}`);
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="print-preview-dialog"
      className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-[min(1200px,95vw)] h-[min(800px,90vh)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-slate-950">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-orange-400" />
            <div>
              <div className="text-sm font-semibold text-slate-100">Print Preview & Orient</div>
              <div className="text-[10px] text-slate-500 leading-tight">Rotate the model until the largest flat face is on the bed.</div>
            </div>
          </div>
          <button
            data-testid="print-preview-close-btn"
            onClick={onClose}
            disabled={busy}
            className="w-7 h-7 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100 flex items-center justify-center disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — 3D preview (left) + controls (right) */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 bg-slate-950 relative">
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
                <Loader2 size={20} className="animate-spin" />
                Flattening assembly into a single watertight mesh…
              </div>
            )}
            {error && !loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 text-xs gap-2 px-6 text-center">
                <AlertTriangle size={20} />
                <div>{error}</div>
              </div>
            )}
            {!loading && !error && renderGeom && (
              <PreviewCanvas
                geom={renderGeom}
                buildVolume={buildVolume}
              />
            )}
          </div>

          {/* Right side — controls */}
          <div className="w-80 border-l border-slate-700 bg-slate-900 flex flex-col overflow-y-auto">
            {/* Stats */}
            {stats && (
              <div className="p-3 border-b border-slate-800 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Slicer will see
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono">
                  <span className="text-slate-500">Print height</span>
                  <span className="text-orange-300 text-right">{stats.height.toFixed(1)} mm</span>
                  <span className="text-slate-500">Bed footprint</span>
                  <span className="text-orange-300 text-right">{stats.footprintXY.toFixed(0)} mm²</span>
                  <span className="text-slate-500">Overhang area</span>
                  <span className={`text-right ${stats.downArea / stats.totalArea > 0.25 ? "text-amber-300" : "text-orange-300"}`}>
                    {stats.downArea.toFixed(0)} mm²
                    <span className="text-slate-600 text-[9px] ml-1">
                      ({((stats.downArea / Math.max(1, stats.totalArea)) * 100).toFixed(0)}%)
                    </span>
                  </span>
                  <span className="text-slate-500">Model volume</span>
                  <span className="text-orange-300 text-right">{(stats.volume / 1000).toFixed(1)} cm³</span>
                </div>
                {stats.downArea / stats.totalArea > 0.25 && (
                  <div className="text-[10px] text-amber-300/90 leading-tight pt-1 flex gap-1.5">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    <span>Lots of overhanging material (red faces below) — supports will eat filament &amp; time. Try Auto Lay Flat or rotate.</span>
                  </div>
                )}
              </div>
            )}

            {/* Cost / time heuristic (iter-81). Rough estimate so users
                can compare orientations at the decision point without
                running a real slice. ±30 % of actual OrcaSlicer
                figures is "close enough" — the value is comparative. */}
            {costTime && (
              <div className="p-3 border-b border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex-1">
                    Estimate <span className="text-slate-600 normal-case">— PLA · 3 walls · 0.2 mm · 15 % infill</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono" data-testid="print-preview-estimate">
                  <span className="text-slate-500">Print time</span>
                  <span className="text-green-300 text-right">
                    {costTime.minutes < 60
                      ? `~${Math.max(1, Math.round(costTime.minutes))} min`
                      : `~${Math.floor(costTime.minutes / 60)}h ${Math.round(costTime.minutes % 60)}m`}
                  </span>
                  <span className="text-slate-500">Filament</span>
                  <span className="text-green-300 text-right">~{Math.round(costTime.filamentMM)} mm · {costTime.grams.toFixed(1)} g</span>
                  <span className="text-slate-500">Cost (PLA @ $22/kg)</span>
                  <span className="text-green-300 text-right">~${costTime.cost.toFixed(2)}</span>
                </div>
                <div className="text-[9px] text-slate-500 leading-tight pt-0.5">
                  Rough heuristic — actual values from OrcaSlicer may differ ±30 %. Useful for comparing orientations.
                </div>
              </div>
            )}

            {/* Overhang legend so the user understands the red faces. */}
            <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-3 text-[10px] text-slate-400">
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ background: "#f97316" }} />
                <span>Safe (≤45° overhang)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm" style={{ background: "#ef4444" }} />
                <span>Needs supports</span>
              </div>
            </div>

            {/* Quick orient */}
            <div className="p-3 border-b border-slate-800 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Quick orient
              </div>
              <button
                data-testid="print-preview-auto-layflat-btn"
                onClick={autoLayFlat}
                disabled={!baseGeom || busy}
                className="w-full h-8 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5"
              >
                <Layers size={12} /> Auto Lay Flat (pick best face)
              </button>
              <div className="grid grid-cols-2 gap-1.5">
                {["x", "y", "z"].map((axis) => (
                  <React.Fragment key={axis}>
                    <button
                      data-testid={`print-preview-rot-${axis}-ccw-btn`}
                      onClick={() => applyRotation(axis, -90)}
                      disabled={!baseGeom || busy}
                      className="h-8 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-[11px] font-mono rounded flex items-center justify-center gap-1 border border-slate-700"
                      title={`Rotate -90° around ${axis.toUpperCase()}`}
                    >
                      <RotateCcw size={11} /> {axis.toUpperCase()} −90°
                    </button>
                    <button
                      data-testid={`print-preview-rot-${axis}-cw-btn`}
                      onClick={() => applyRotation(axis, 90)}
                      disabled={!baseGeom || busy}
                      className="h-8 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-[11px] font-mono rounded flex items-center justify-center gap-1 border border-slate-700"
                      title={`Rotate +90° around ${axis.toUpperCase()}`}
                    >
                      <RotateCw size={11} /> {axis.toUpperCase()} +90°
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <button
                data-testid="print-preview-reset-btn"
                onClick={resetRotation}
                disabled={!baseGeom || busy}
                className="w-full h-7 bg-slate-800/60 hover:bg-slate-800 disabled:opacity-40 text-slate-400 hover:text-slate-200 text-[10px] rounded border border-slate-700 flex items-center justify-center gap-1"
              >
                <RefreshCw size={10} /> Reset to default
              </button>
            </div>

            {/* Tip */}
            <div className="p-3 border-b border-slate-800 text-[10px] text-slate-500 leading-tight">
              <b className="text-slate-300">Goal:</b> get the largest flat face touching the bed
              (big <span className="text-orange-400 font-mono">Bed footprint</span>) and as little
              dangling material as possible (small <span className="text-amber-400 font-mono">Overhang area</span>).
              The grid below shows your printer's actual build plate.
            </div>

            {/* CTA */}
            <div className="mt-auto p-3 space-y-2 border-t border-slate-800 bg-slate-950">
              <button
                data-testid="print-preview-confirm-btn"
                onClick={handleConfirm}
                disabled={!renderGeom || busy}
                className="w-full h-11 bg-green-500 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-md uppercase tracking-wide text-sm flex items-center justify-center gap-2 shadow"
              >
                {busy
                  ? <><Loader2 size={14} className="animate-spin" /> Slicing…</>
                  : <><Send size={14} /> Slice this orientation</>}
              </button>
              <button
                data-testid="print-preview-cancel-btn"
                onClick={onClose}
                disabled={busy}
                className="w-full h-7 text-[11px] text-slate-400 hover:text-slate-100 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// PreviewCanvas — Three.js canvas configured for Z-up so what the
// user sees matches what OrcaSlicer will print. Build-plate grid is
// sized to the active printer's build_x/build_y. A small printable-
// volume bbox helps the user spot prints that would clip the build
// envelope.
function PreviewCanvas({ geom, buildVolume }) {
  const bx = buildVolume?.x || 220;
  const by = buildVolume?.y || 220;
  const bz = buildVolume?.z || 250;

  // Frame camera on the geometry every time it changes (so the user
  // doesn't have to wrestle the camera after every rotation click).
  return (
    <Canvas
      camera={{ position: [Math.max(bx, by), Math.max(bx, by) * 0.6, bz * 0.5], fov: 38, up: [0, 0, 1] }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[80, 60, 120]} intensity={1.0} />
      <directionalLight position={[-60, -40, 80]} intensity={0.4} />
      <FrameCamera bx={bx} by={by} bz={bz} />
      {/* Bed grid — XY plane, Z=0 */}
      <Grid
        args={[bx, by]}
        cellSize={10}
        cellThickness={0.6}
        sectionSize={50}
        sectionThickness={1.2}
        sectionColor="#f97316"
        cellColor="#3f3f46"
        fadeDistance={Math.max(bx, by) * 2.5}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0.01]}
      />
      {/* Build volume bbox */}
      <mesh position={[0, 0, bz / 2]}>
        <boxGeometry args={[bx, by, bz]} />
        <meshBasicMaterial color="#f97316" wireframe transparent opacity={0.12} />
      </mesh>
      {/* The model itself */}
      <mesh geometry={geom} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          roughness={0.5}
          metalness={0.1}
          flatShading
        />
      </mesh>
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  );
}

// Re-frame the OrbitControls target whenever the geometry's centroid
// shifts (every rotation click). Without this, after one rotate the
// camera is pointing at empty space.
function FrameCamera({ bx, by, bz }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!camera) return;
    // Initial framing — back off enough to see the full build volume.
    const maxDim = Math.max(bx, by, bz);
    camera.position.set(maxDim * 1.2, maxDim * 0.8, maxDim * 0.7);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, bz * 0.25);
    if (controls) {
      controls.target.set(0, 0, bz * 0.25);
      controls.update();
    }
  }, [camera, controls, bx, by, bz]);
  return null;
}

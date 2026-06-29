// Iter-87 — Blender-style component-pair dimension overlay extracted
// from Viewport.jsx.
//
// Renders one yellow dashed line + ΔX / ΔY / ΔZ chip per stored pair
// in `componentDimensions`. Math is recomputed every render from the
// live store so the chip values stay accurate during a transform drag.
// We DO NOT subscribe per-object — `objects` is read once and React's
// normal re-render cycle fires when the store mutates.
//
// API:
//   - ComponentDimensionLine : one yellow line + chip
//   - ComponentDimensionsLayer : layer wrapper that reads the store
//                                and emits one line per stored pair
import React, { useMemo } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import { useScene } from "../../lib/store";
import { computeComponentDimension, fmtSignedMm } from "../../lib/componentDimensions";
import { formatLen, toDisplayLen } from "../../lib/units";

// Unit-aware sign formatter — mirrors `fmtSignedMm` but converts to
// the user's display unit first.
function fmtSigned(mm, unitSystem) {
  if (unitSystem === "in") {
    const v = toDisplayLen(mm, "in");
    return `${v >= 0 ? "+" : ""}${v.toFixed(3)} in`;
  }
  return fmtSignedMm(mm);
}

export function ComponentDimensionLine({ dim, objects, onRemove }) {
  const a = objects.find((o) => o.id === dim.objIdA);
  const b = objects.find((o) => o.id === dim.objIdB);
  const unitSystem = useScene((s) => s.unitSystem);
  const d = useMemo(() => computeComponentDimension(a, b), [a, b]);
  // Hook order MUST be stable: keep every hook call above any early-return.
  // `points` is a cheap derivation from `d` so we compute it
  // unconditionally (it's discarded when d is null below).
  const points = useMemo(() => {
    if (!d) return [new THREE.Vector3(), new THREE.Vector3()];
    return [
      new THREE.Vector3(d.centerA[0], d.centerA[1], d.centerA[2]),
      new THREE.Vector3(d.centerB[0], d.centerB[1], d.centerB[2]),
    ];
  }, [d]);
  if (!d) return null;
  const mid = new THREE.Vector3(
    (d.centerA[0] + d.centerB[0]) / 2,
    (d.centerA[1] + d.centerB[1]) / 2,
    (d.centerA[2] + d.centerB[2]) / 2,
  );
  return (
    <group>
      <Line points={points} color="#FBBF24" lineWidth={2} dashed dashSize={2} gapSize={1.5} depthTest={false} />
      <mesh position={points[0]} renderOrder={1000}>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#FBBF24" depthTest={false} />
      </mesh>
      <mesh position={points[1]} renderOrder={1000}>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#FBBF24" depthTest={false} />
      </mesh>
      <Html position={mid} center zIndexRange={[50, 0]} sprite={false}>
        <div
          data-testid={`component-dim-label-${dim.id}`}
          className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-950/95 border border-amber-400/70 text-amber-200 text-[11px] font-mono rounded-md shadow-xl whitespace-nowrap select-none"
          style={{ pointerEvents: "auto" }}
        >
          <div className="flex flex-col leading-tight">
            <span className="text-amber-300 text-[9px] uppercase tracking-wider">
              {(a?.name || "?")} ↔ {(b?.name || "?")}
            </span>
            <span className="font-bold tracking-tight text-white">
              {formatLen(d.distance, unitSystem)}
            </span>
            <span className="text-[9.5px] text-slate-400">
              <span data-testid={`component-dim-dx-${dim.id}`}>ΔX {fmtSigned(d.delta[0], unitSystem)}</span>
              {" · "}
              <span data-testid={`component-dim-dy-${dim.id}`}>ΔY {fmtSigned(d.delta[1], unitSystem)}</span>
              {" · "}
              <span data-testid={`component-dim-dz-${dim.id}`}>ΔZ {fmtSigned(d.delta[2], unitSystem)}</span>
            </span>
          </div>
          <button
            data-testid={`component-dim-close-${dim.id}`}
            onClick={(e) => { e.stopPropagation(); onRemove(dim.id); }}
            className="w-4 h-4 rounded-sm bg-slate-800 hover:bg-red-500/40 text-slate-400 hover:text-white flex items-center justify-center leading-none"
            title="Remove this dimension"
          >
            <span className="text-[12px] leading-none -mt-px">×</span>
          </button>
        </div>
      </Html>
    </group>
  );
}

export function ComponentDimensionsLayer() {
  const dims = useScene((s) => s.componentDimensions);
  const objects = useScene((s) => s.objects);
  const removeComponentDimension = useScene((s) => s.removeComponentDimension);
  if (!dims || dims.length === 0) return null;
  return (
    <group>
      {dims.map((d) => (
        <ComponentDimensionLine
          key={d.id}
          dim={d}
          objects={objects}
          onRemove={removeComponentDimension}
        />
      ))}
    </group>
  );
}

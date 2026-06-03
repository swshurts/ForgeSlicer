// Iter-87 — Measurements overlay extracted from Viewport.jsx.
//
// Three React-Three-Fiber components that render the green "I want
// to measure between these two clicks" tool. They were ~100 lines of
// JSX inlined into Viewport.jsx; pulling them out cleans up the
// viewport file and gives any future measurement variants (e.g.
// distance-to-bed, surface-to-surface) a focused home.
//
// API:
//   - MeasurementLine : single 3D distance chip between two world points
//   - PendingMarker   : yellow sphere shown after the first click,
//                       before the second click completes the segment
//   - MeasurementsLayer : reads the store and renders every committed
//                         measurement + the pending marker. Hidden
//                         entirely when measureMode is off.
//
// All inputs come from the Zustand store; nothing is passed via props.
import React, { useMemo } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import { useScene } from "../../lib/store";

export function MeasurementLine({ measurement, onRemove }) {
  const { a, b, id } = measurement;
  const points = useMemo(() => [
    new THREE.Vector3(a[0], a[1], a[2]),
    new THREE.Vector3(b[0], b[1], b[2]),
  ], [a, b]);
  const mid = new THREE.Vector3(
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  );
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return (
    <group>
      <Line points={points} color="#22C55E" lineWidth={3} dashed={false} depthTest={false} />
      <mesh position={points[0]} renderOrder={1000}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshBasicMaterial color="#22C55E" depthTest={false} />
      </mesh>
      <mesh position={points[1]} renderOrder={1000}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshBasicMaterial color="#22C55E" depthTest={false} />
      </mesh>
      <Html position={mid} center zIndexRange={[50, 0]} sprite={false}>
        <div
          data-testid={`measurement-label-${id}`}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 border border-green-500/70 text-green-300 text-sm font-mono rounded-md shadow-lg whitespace-nowrap select-none"
          style={{ pointerEvents: "auto" }}
        >
          <span className="font-bold tracking-tight">{dist.toFixed(2)} mm</span>
          <button
            data-testid={`measurement-close-${id}`}
            onClick={(e) => { e.stopPropagation(); onRemove(id); }}
            className="ml-1 w-4 h-4 rounded-sm bg-slate-800 hover:bg-red-500/40 text-slate-400 hover:text-white flex items-center justify-center leading-none"
            title="Remove this measurement"
          >
            <span className="text-[12px] leading-none -mt-px">×</span>
          </button>
        </div>
      </Html>
    </group>
  );
}

export function PendingMarker({ pt }) {
  if (!pt) return null;
  return (
    <mesh position={pt} renderOrder={1000}>
      <sphereGeometry args={[1.4, 18, 18]} />
      <meshBasicMaterial color="#FACC15" depthTest={false} />
    </mesh>
  );
}

export function MeasurementsLayer() {
  const measurements = useScene((s) => s.measurements);
  const pending = useScene((s) => s.pendingMeasurePoint);
  const measureMode = useScene((s) => s.measureMode);
  const removeMeasurement = useScene((s) => s.removeMeasurement);
  if (!measureMode) return null; // hide everything when measure tool is off
  return (
    <group>
      {measurements.map((m) => (
        <MeasurementLine key={m.id} measurement={m} onRemove={removeMeasurement} />
      ))}
      <PendingMarker pt={pending} />
    </group>
  );
}

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
import { formatLen } from "../../lib/units";

export function MeasurementLine({ measurement, onRemove }) {
  const { a, b, id } = measurement;
  const unitSystem = useScene((s) => s.unitSystem);
  const points = useMemo(() => [
    new THREE.Vector3(a[0], a[1], a[2]),
    new THREE.Vector3(b[0], b[1], b[2]),
  ], [a, b]);
  const mid = useMemo(() => new THREE.Vector3(
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ), [a, b]);
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  // TinkerCAD-style: float the label above the measured segment so it
  // doesn't cover the picked points. We compute an offset perpendicular
  // to the line, biased toward world-up so the chip always lifts off
  // the geometry. When the segment is itself near-vertical we fall back
  // to a perpendicular in the world-X-Z plane so the chip slides aside
  // instead of trying to "lift up" along the same axis as the line.
  // The leader line connects the chip back to the midpoint so the user
  // still knows which segment the value applies to.
  const labelPos = useMemo(() => {
    const dir = new THREE.Vector3().subVectors(points[1], points[0]);
    const len = dir.length();
    if (len < 1e-6) return mid.clone().add(new THREE.Vector3(0, 8, 0));
    dir.normalize();
    // Perpendicular in the "up-ish" plane: cross line × world-Y, then
    // cross back, gives the in-plane perpendicular that has the most
    // +Y component. Defensive against horizontal lines (cross with Y
    // alone would be 0).
    const worldUp = new THREE.Vector3(0, 1, 0);
    let perp = new THREE.Vector3().crossVectors(dir, worldUp);
    if (perp.lengthSq() < 1e-6) {
      // Line is parallel to Y — pick an arbitrary horizontal perp.
      perp.set(1, 0, 0);
    } else {
      perp.normalize();
      perp.crossVectors(perp, dir).normalize();
      if (perp.y < 0) perp.multiplyScalar(-1); // always lift toward +Y
    }
    // Magnitude — scales gently with measurement length so a 100 mm
    // segment doesn't get a 4 mm offset that still overlaps the chip.
    const off = Math.max(6, Math.min(18, len * 0.12));
    return mid.clone().add(perp.multiplyScalar(off));
  }, [points, mid]);
  const leaderPoints = useMemo(() => [mid.clone(), labelPos.clone()], [mid, labelPos]);
  return (
    <group>
      <Line points={points} color="#22C55E" lineWidth={3} dashed={false} depthTest={false} />
      {/* Dashed leader from segment midpoint up to the floating label
          — so users still know which line the value refers to. */}
      <Line points={leaderPoints} color="#22C55E" lineWidth={1} dashed dashSize={1.4} gapSize={1} depthTest={false} opacity={0.6} transparent />
      <mesh position={points[0]} renderOrder={1000}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshBasicMaterial color="#22C55E" depthTest={false} />
      </mesh>
      <mesh position={points[1]} renderOrder={1000}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshBasicMaterial color="#22C55E" depthTest={false} />
      </mesh>
      <Html position={labelPos} center zIndexRange={[50, 0]} sprite={false}>
        <div
          data-testid={`measurement-label-${id}`}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 border border-green-500/70 text-green-300 text-sm font-mono rounded-md shadow-lg whitespace-nowrap select-none"
          style={{ pointerEvents: "auto" }}
        >
          <span className="font-bold tracking-tight">{formatLen(dist, unitSystem)}</span>
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

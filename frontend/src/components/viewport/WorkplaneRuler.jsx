// Iter-113 — TinkerCAD-style workplane ruler.
//
// A persistent reference widget the user drops onto the build plate.
// Once active it renders:
//   • two perpendicular arrows along +X (rose) and +Y (emerald) at Z=0
//   • a draggable origin sphere (drag with the cursor to reposition)
//   • numeric tick marks every 10 mm along both arrows
//   • when an object is selected: signed ΔX / ΔY / ΔZ chips showing
//     the offset from the ruler origin to the selection's bbox centre
//   • a small × button to remove the ruler
//
// The ruler is intentionally non-interactive with measurement / cut
// modes — those overlays own the canvas while active. This component
// renders nothing whenever `workplaneRuler.active === false`.
//
// Storage: the ruler origin lives in mm in world space. Display strings
// respect the global mm/inch toggle.
import React, { useRef, useState, useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { X } from "lucide-react";
import { useScene } from "../../lib/store";
import { computeRotatedBBox } from "../../lib/geometry";
import { toDisplayLen } from "../../lib/units";

const COLOR_X = "#FB7185";
const COLOR_Y = "#34D399";
const COLOR_Z = "#60A5FA";
const RULER_LEN = 120; // mm — visual reach of each arm

function fmtSigned(mm, system) {
  const v = toDisplayLen(mm, system);
  const dp = system === "in" ? 3 : 1;
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(dp)} ${system}`;
}

export function WorkplaneRuler() {
  const ruler = useScene((s) => s.workplaneRuler);
  const setRuler = useScene((s) => s.setWorkplaneRuler);
  const removeRuler = useScene((s) => s.removeWorkplaneRuler);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const unitSystem = useScene((s) => s.unitSystem);
  const measureMode = useScene((s) => s.measureMode);
  const rulerMode = useScene((s) => s.rulerMode);
  const cutMode = useScene((s) => s.cutMode);

  const { camera, gl } = useThree();
  const draggingRef = useRef(false);
  // Iter-114.7 — track pointer-down position so we can tell a CLICK
  // from a DRAG. A click on the origin sphere with negligible
  // movement (<5 px) triggers re-placement: ruler drops out, user
  // picks a new spot without touching the toolbar.
  const downPosRef = useRef(null);
  const enterPlacing = useScene((s) => s.enterWorkplaneRulerPlacing);
  const [, force] = useState(0); // re-render trigger for drag updates

  if (!ruler || !ruler.active) return null;
  if (measureMode || rulerMode || cutMode) return null;

  const [ox, oy, oz] = ruler.origin || [0, 0, 0];

  // ---- pointer-driven origin drag on the workplane (Z = 0) ----
  const onOriginPointerDown = (e) => {
    e.stopPropagation();
    draggingRef.current = true;
    downPosRef.current = { x: e.clientX, y: e.clientY, moved: false };
    try { gl.domElement.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onOriginPointerMove = (e) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    // Mark this gesture as a drag once the pointer has travelled more
    // than 5 px from its start — anything less stays a "click".
    if (downPosRef.current) {
      const dx = e.clientX - downPosRef.current.x;
      const dy = e.clientY - downPosRef.current.y;
      if (Math.hypot(dx, dy) > 5) downPosRef.current.moved = true;
    }
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const ndc = new THREE.Vector2(x, y);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) {
      setRuler({ origin: [hit.x, hit.y, 0] });
      force((n) => n + 1);
    }
  };
  const onOriginPointerUp = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { gl.domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    // Pure click → re-enter placement. Drags already handled the move
    // during pointer-move.
    if (downPosRef.current && !downPosRef.current.moved) {
      enterPlacing();
    }
    downPosRef.current = null;
  };

  // ---- selection delta chips ----
  let selDeltas = null;
  const selObj = objects.find((o) => o.id === selectedId);
  if (selObj && selObj.visible !== false) {
    try {
      const bb = computeRotatedBBox(selObj);
      const cx = (bb.min.x + bb.max.x) / 2 + (selObj.position?.[0] || 0);
      const cy = (bb.min.y + bb.max.y) / 2 + (selObj.position?.[1] || 0);
      const cz = (bb.min.z + bb.max.z) / 2 + (selObj.position?.[2] || 0);
      selDeltas = {
        dx: cx - ox,
        dy: cy - oy,
        dz: cz - oz,
        targetX: cx,
        targetY: cy,
        targetZ: cz,
      };
    } catch { /* ignore */ }
  }

  // Tick marks every 10mm along each arm. Bidirectional — produce
  // negative-direction ticks too so the user can read offsets either
  // side of the origin (iter-114.4 — fixes "ruler arms point away
  // from the part when placed off to the side").
  const ticks = [];
  for (let i = 1; i <= Math.floor(RULER_LEN / 10); i += 1) {
    ticks.push(i * 10);
    ticks.push(-i * 10);
  }

  return (
    <group>
      {/* X arm — rose. Bidirectional so users can place the ruler on
          either side of a part and still get a meaningful reading. */}
      <Line
        points={[[ox - RULER_LEN, oy, 0.05], [ox + RULER_LEN, oy, 0.05]]}
        color={COLOR_X}
        lineWidth={2}
        depthTest={false}
      />
      {/* Y arm — emerald, bidirectional. */}
      <Line
        points={[[ox, oy - RULER_LEN, 0.05], [ox, oy + RULER_LEN, 0.05]]}
        color={COLOR_Y}
        lineWidth={2}
        depthTest={false}
      />
      {/* X-tick marks (both directions) */}
      {ticks.map((t) => (
        <Line
          key={`tx-${t}`}
          points={[
            [ox + t, oy - (Math.abs(t) % 50 === 0 ? 5 : 2.5), 0.05],
            [ox + t, oy + (Math.abs(t) % 50 === 0 ? 5 : 2.5), 0.05],
          ]}
          color={COLOR_X}
          lineWidth={Math.abs(t) % 50 === 0 ? 1.4 : 0.8}
          opacity={Math.abs(t) % 50 === 0 ? 0.9 : 0.5}
          transparent
          depthTest={false}
        />
      ))}
      {/* Y-tick marks (both directions) */}
      {ticks.map((t) => (
        <Line
          key={`ty-${t}`}
          points={[
            [ox - (Math.abs(t) % 50 === 0 ? 5 : 2.5), oy + t, 0.05],
            [ox + (Math.abs(t) % 50 === 0 ? 5 : 2.5), oy + t, 0.05],
          ]}
          color={COLOR_Y}
          lineWidth={Math.abs(t) % 50 === 0 ? 1.4 : 0.8}
          opacity={Math.abs(t) % 50 === 0 ? 0.9 : 0.5}
          transparent
          depthTest={false}
        />
      ))}
      {/* Axis end labels — +X, -X, +Y, -Y (iter-114.4 bidirectional). */}
      <Html position={[ox + RULER_LEN + 4, oy, 0.05]} center zIndexRange={[60, 0]} sprite={false}>
        <div
          data-testid="workplane-ruler-x-label"
          className="px-1 py-0.5 rounded bg-black/70 font-mono text-[9px] font-bold select-none"
          style={{ pointerEvents: "none", color: COLOR_X }}
        >
          +X · {toDisplayLen(RULER_LEN, unitSystem).toFixed(unitSystem === "in" ? 2 : 0)} {unitSystem}
        </div>
      </Html>
      <Html position={[ox - RULER_LEN - 4, oy, 0.05]} center zIndexRange={[60, 0]} sprite={false}>
        <div
          data-testid="workplane-ruler-x-neg-label"
          className="px-1 py-0.5 rounded bg-black/70 font-mono text-[9px] font-bold select-none"
          style={{ pointerEvents: "none", color: COLOR_X }}
        >
          -X · {toDisplayLen(RULER_LEN, unitSystem).toFixed(unitSystem === "in" ? 2 : 0)} {unitSystem}
        </div>
      </Html>
      <Html position={[ox, oy + RULER_LEN + 4, 0.05]} center zIndexRange={[60, 0]} sprite={false}>
        <div
          data-testid="workplane-ruler-y-label"
          className="px-1 py-0.5 rounded bg-black/70 font-mono text-[9px] font-bold select-none"
          style={{ pointerEvents: "none", color: COLOR_Y }}
        >
          +Y · {toDisplayLen(RULER_LEN, unitSystem).toFixed(unitSystem === "in" ? 2 : 0)} {unitSystem}
        </div>
      </Html>
      <Html position={[ox, oy - RULER_LEN - 4, 0.05]} center zIndexRange={[60, 0]} sprite={false}>
        <div
          data-testid="workplane-ruler-y-neg-label"
          className="px-1 py-0.5 rounded bg-black/70 font-mono text-[9px] font-bold select-none"
          style={{ pointerEvents: "none", color: COLOR_Y }}
        >
          -Y · {toDisplayLen(RULER_LEN, unitSystem).toFixed(unitSystem === "in" ? 2 : 0)} {unitSystem}
        </div>
      </Html>
      {/* Origin sphere — click to re-place, drag to fine-tune. */}
      <mesh
        position={[ox, oy, oz + 0.5]}
        renderOrder={1002}
        onPointerDown={onOriginPointerDown}
        onPointerMove={onOriginPointerMove}
        onPointerUp={onOriginPointerUp}
        onPointerOut={onOriginPointerUp}
        onPointerOver={() => { document.body.style.cursor = "pointer"; }}
        onPointerLeave={() => { document.body.style.cursor = ""; }}
      >
        <sphereGeometry args={[3.5, 24, 24]} />
        <meshBasicMaterial color="#F8FAFC" depthTest={false} />
      </mesh>
      {/* Smaller inner ring for visual feedback */}
      <mesh position={[ox, oy, oz + 0.6]} renderOrder={1003}>
        <sphereGeometry args={[2.2, 18, 18]} />
        <meshBasicMaterial color="#0EA5E9" depthTest={false} />
      </mesh>
      {/* × remove button */}
      <Html position={[ox, oy, oz + 0.5]} center zIndexRange={[90, 0]} sprite={false}>
        <button
          data-testid="workplane-ruler-remove"
          onClick={(e) => { e.stopPropagation(); removeRuler(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="translate-x-5 -translate-y-5 w-5 h-5 rounded-full bg-slate-900/95 hover:bg-red-500/70 text-slate-300 hover:text-white flex items-center justify-center border border-slate-700 shadow"
          style={{ pointerEvents: "auto" }}
          title="Remove workplane ruler"
        >
          <X size={11} />
        </button>
      </Html>
      {/* Origin coordinate label */}
      <Html position={[ox, oy, oz + 1]} center zIndexRange={[60, 0]} sprite={false}>
        <div
          data-testid="workplane-ruler-origin-label"
          className="translate-y-5 px-1.5 py-0.5 rounded bg-slate-950/85 border border-slate-700 font-mono text-[9.5px] text-slate-300 whitespace-nowrap select-none"
          style={{ pointerEvents: "none" }}
        >
          origin · {toDisplayLen(ox, unitSystem).toFixed(unitSystem === "in" ? 2 : 1)}, {toDisplayLen(oy, unitSystem).toFixed(unitSystem === "in" ? 2 : 1)}
        </div>
      </Html>

      {/* Selection-relative Δ chips (iter-113) — REPLACED by the
          corner-pinned PositionChips in SelectionDimLabels.jsx as of
          iter-114.3. The new chips read X/Y/Z = N.NN at the front-
          left-bottom corner of the selected bbox (TinkerCAD parity),
          which is unambiguous when multiple parts share the scene.
          Kept the dashed reference line below so the user can SEE
          which selection the ruler is currently anchoring to. */}
      {selDeltas && (
        <Line
          points={[[ox, oy, 0.05], [selDeltas.targetX, selDeltas.targetY, selDeltas.targetZ]]}
          color="#94A3B8"
          lineWidth={1}
          dashed
          dashSize={3}
          gapSize={2}
          depthTest={false}
          opacity={0.45}
          transparent
        />
      )}
    </group>
  );
}

export default WorkplaneRuler;

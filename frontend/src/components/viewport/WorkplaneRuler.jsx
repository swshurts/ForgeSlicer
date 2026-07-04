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
import React, { useRef, useState } from "react";
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { X } from "lucide-react";
import { useScene } from "../../lib/store";
import { toDisplayLen } from "../../lib/units";
import { priorityRaycast } from "../../lib/priorityRaycast";

const COLOR_X = "#FB7185";
const COLOR_Y = "#34D399";
const RULER_LEN = 120; // mm — visual reach of each arm
// Finger-sized ruler buttons on touch devices.
const RULER_BTN = (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches)
  ? "w-10 h-10" : "w-6 h-6";

export function WorkplaneRuler() {
  const ruler = useScene((s) => s.workplaneRuler);
  const setRuler = useScene((s) => s.setWorkplaneRuler);
  const removeRuler = useScene((s) => s.removeWorkplaneRuler);
  const unitSystem = useScene((s) => s.unitSystem);
  const measureMode = useScene((s) => s.measureMode);
  const rulerMode = useScene((s) => s.rulerMode);
  const cutMode = useScene((s) => s.cutMode);

  const { camera, gl, controls } = useThree();
  const draggingRef = useRef(false);
  // Iter-114.7 — track pointer-down position so we can tell a CLICK
  // from a DRAG. Iter-114.8 bumped the threshold to 10 px because
  // 5 px was too tight — fine-tune drags were being misclassified as
  // clicks and triggering re-placement instead of moving the ruler.
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
    // Iter-114.8 — disable OrbitControls while the user is dragging
    // the origin sphere. Without this, OrbitControls eats the drag
    // and rotates the camera instead of moving the ruler.
    if (controls) controls.enabled = false;
    try { gl.domElement.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onOriginPointerMove = (e) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    if (downPosRef.current) {
      const dx = e.clientX - downPosRef.current.x;
      const dy = e.clientY - downPosRef.current.y;
      if (Math.hypot(dx, dy) > 10) downPosRef.current.moved = true;
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
    if (controls) controls.enabled = true;
    try { gl.domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    // Iter-114.10 — the explicit ↻ button replaced the
    // click-to-re-place heuristic (which was unreliable when the
    // origin sphere sat under another object's TransformControls
    // gizmo). Origin sphere now drags only.
    downPosRef.current = null;
  };

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
      {/* Origin sphere — click to re-place, drag to fine-tune.
          Iter-114.11 — `priorityRaycast` forces this sphere to be the
          FIRST intersected mesh regardless of stacked geometry it
          lives inside (matches the visual `depthTest={false}` promise).
          Without this, on assemblies like "cone on cube" the parent
          mesh's onClick called stopPropagation before the sphere's
          handlers could fire, leaving the ruler UI unresponsive. */}
      <mesh
        position={[ox, oy, oz + 0.5]}
        renderOrder={1002}
        raycast={priorityRaycast}
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
      <mesh position={[ox, oy, oz + 0.6]} renderOrder={1003} raycast={priorityRaycast}>
        <sphereGeometry args={[2.2, 18, 18]} />
        <meshBasicMaterial color="#0EA5E9" depthTest={false} />
      </mesh>
      {/* Origin action buttons — × (remove) + ↻ (re-place). The
          re-place button replaces the click-vs-drag heuristic from
          iter-114.7/.8 which proved unreliable on top of an
          object's TransformControls gizmo. Now an unambiguous
          dedicated button. The origin sphere still drags to
          fine-tune the position via the pointer-move handler. */}
      <Html position={[ox, oy, oz + 0.5]} center zIndexRange={[9999, 9990]} sprite={false}>
        <div className="flex gap-1.5 translate-x-6 -translate-y-6" style={{ pointerEvents: "auto" }}>
          <button
            data-testid="workplane-ruler-replace"
            onClick={(e) => { e.stopPropagation(); enterPlacing(); }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            className={`${RULER_BTN} rounded-full bg-slate-900/95 hover:bg-orange-500/80 text-slate-100 hover:text-white flex items-center justify-center border border-orange-400/60 shadow-lg text-[13px] font-bold leading-none`}
            title="Re-place the ruler — pick a new bed location"
          >
            ↻
          </button>
          <button
            data-testid="workplane-ruler-remove"
            onClick={(e) => { e.stopPropagation(); removeRuler(); }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            className={`${RULER_BTN} rounded-full bg-slate-900/95 hover:bg-red-500/80 text-slate-100 hover:text-white flex items-center justify-center border border-red-400/50 shadow-lg`}
            title="Remove workplane ruler"
          >
            <X size={13} />
          </button>
        </div>
      </Html>
      {/* Origin coordinate label. iter-125.1 — include Z whenever the
          ruler is elevated (dropped onto the top of a stacked object).
          Previously the label only showed X/Y, so a ruler placed at
          (10, -10, 20) read "origin · 10, -10" — visually identical to
          a bed-level placement, causing "readings look wrong"
          confusion when the selected part's distance chips reported
          numbers relative to an elevated reference plane. */}
      <Html position={[ox, oy, oz + 1]} center zIndexRange={[60, 0]} sprite={false}>
        <div
          data-testid="workplane-ruler-origin-label"
          className="translate-y-5 px-1.5 py-0.5 rounded bg-slate-950/85 border border-slate-700 font-mono text-[9.5px] text-slate-300 whitespace-nowrap select-none"
          style={{ pointerEvents: "none" }}
        >
          origin · {toDisplayLen(ox, unitSystem).toFixed(unitSystem === "in" ? 2 : 1)}, {toDisplayLen(oy, unitSystem).toFixed(unitSystem === "in" ? 2 : 1)}
          {Math.abs(oz) > 0.05 && (
            <span data-testid="workplane-ruler-origin-z" className="text-amber-300 ml-1">
              ↑ {toDisplayLen(oz, unitSystem).toFixed(unitSystem === "in" ? 2 : 1)}{unitSystem === "in" ? '"' : "mm"}
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}

export default WorkplaneRuler;

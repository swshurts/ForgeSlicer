import React, { useRef, useMemo, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls, GizmoHelper, GizmoViewport, Edges, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../lib/store";
import { useTheme, VIEWPORT_BG } from "../lib/theme";
import { buildGeometry, computeRotatedBBox } from "../lib/geometry";
import { MULTICOLOR_PALETTE } from "../lib/presets";
import { computeComponentDimension, fmtSignedMm } from "../lib/componentDimensions";
import { nearestCorner, offsetToObject } from "../lib/rulerAnchor";
import ContextMenu from "./ContextMenu";

const POSITIVE_COLOR = "#F97316";
const NEGATIVE_COLOR = "#06B6D4";

function colorForObject(obj) {
  if (obj.modifier === "negative") return NEGATIVE_COLOR;
  const idx = obj.colorIndex | 0;
  // Map the picker swatch directly to the rendered colour. We used to special-
  // case slot-0 to ForgeSlicer's house orange, which meant picking "White"
  // visually rendered orange — confusing because the picker UI did show a
  // white swatch. New positives now default to slot 7 (Orange) in the store
  // so the historical "default = orange" behaviour is preserved without the
  // 1:1 picker/render mismatch.
  return (MULTICOLOR_PALETTE[idx] && MULTICOLOR_PALETTE[idx].hex) || POSITIVE_COLOR;
}

function SceneObject({ obj, isSelected, onSelect, measureMode, onMeasureHit, rulerMode, onRulerHit, onContextMenu, scene }) {
  const meshRef = useRef();
  // For sweep objects with `kind:"ref"` paths we have to invalidate the
  // memo whenever the SOURCE object's relevant fields change — depend
  // on a derived signature of the source so a ref-sweep updates live
  // when the user edits the helix it rides along. Other primitive types
  // don't read the scene and ignore this dep.
  const refSig = obj.type === "sweep" && obj.dims?.path?.kind === "ref" && scene?.objects
    ? (() => {
        const src = scene.objects.find((o) => o.id === obj.dims.path.objectId);
        return src
          ? JSON.stringify({ d: src.dims, p: src.position, r: src.rotation, s: src.scale, t: src.type })
          : "missing";
      })()
    : null;
  const geom = useMemo(
    () => buildGeometry(obj, scene),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [obj.type, JSON.stringify(obj.dims), refSig]
  );
  const color = colorForObject(obj);

  useEffect(() => () => geom.dispose(), [geom]);
  if (!obj.visible) return null;

  return (
    <mesh
      ref={meshRef}
      position={obj.position}
      rotation={[
        THREE.MathUtils.degToRad(obj.rotation[0]),
        THREE.MathUtils.degToRad(obj.rotation[1]),
        THREE.MathUtils.degToRad(obj.rotation[2]),
      ]}
      scale={obj.scale}
      geometry={geom}
      onClick={(e) => {
        e.stopPropagation();
        if (measureMode) {
          onMeasureHit([e.point.x, e.point.y, e.point.z], obj.id);
        } else if (rulerMode) {
          onRulerHit([e.point.x, e.point.y, e.point.z], obj.id);
        } else {
          const ne = e.nativeEvent || {};
          const mode = ne.ctrlKey || ne.metaKey ? "toggle" : ne.shiftKey ? "add" : null;
          onSelect(obj.id, mode);
        }
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        // R3F event wraps a real React MouseEvent at e.nativeEvent.
        if (onContextMenu) onContextMenu(e.nativeEvent || e, obj.id);
      }}
      castShadow
      receiveShadow
      userData={{ id: obj.id }}
    >
      <meshStandardMaterial
        color={color}
        roughness={0.55}
        metalness={0.05}
        transparent={obj.modifier === "negative"}
        opacity={obj.modifier === "negative" ? 0.55 : 1}
      />
      {isSelected && <Edges threshold={20} color="#FFFFFF" scale={1.001} />}
    </mesh>
  );
}

// ---------- Cut Plane Gizmo ----------
// Visible plane that the user can translate/rotate to position the cut.
// Attaches TransformControls to the plane mesh so it reuses the same gizmo
// the user already knows. The plane is double-sided + semi-transparent and
// excluded from object raycasting (userData.cutPlane = true is the marker).
function CutPlaneGizmo() {
  const cutMode = useScene((s) => s.cutMode);
  const cutPlane = useScene((s) => s.cutPlane);
  const setCutPlane = useScene((s) => s.setCutPlane);
  const transformMode = useScene((s) => s.transformMode);
  const meshRef = useRef();
  const lastPos = useRef([0, 25, 0]);
  const lastRot = useRef([0, 0, 0]);
  const size = cutPlane?.size || 200;
  // PlaneGeometry has its normal pointing along +Z by default, but the CSG
  // cut code assumes the plane's local +Y is the cut "up" direction. Rotate
  // the geometry once at construction so the visible plane is horizontal
  // (normal = +Y) at zero rotation — this is what users expect from a "drop
  // a cutting plane onto your model" tool. The mesh's own rotation prop
  // then represents user-applied tilts on top of that horizontal default.
  const planeGeom = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [size]);
  const edgeGeom = useMemo(() => new THREE.EdgesGeometry(planeGeom), [planeGeom]);
  if (!cutMode) return null;
  return (
    <>
      <mesh
        ref={meshRef}
        position={cutPlane.position}
        rotation={cutPlane.rotation}
        userData={{ cutPlane: true }}
        raycast={() => null}
        geometry={planeGeom}
      >
        <meshBasicMaterial
          color="#fbbf24"
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          depthWrite={false}
          attach="material"
        />
      </mesh>
      <lineSegments
        position={cutPlane.position}
        rotation={cutPlane.rotation}
        raycast={() => null}
        geometry={edgeGeom}
      >
        <lineBasicMaterial color="#f59e0b" attach="material" />
      </lineSegments>
      {meshRef.current && (
        <TransformControls
          object={meshRef.current}
          mode={transformMode === "scale" ? "translate" : transformMode}
          size={0.9}
          translationSnap={0.5}
          rotationSnap={Math.PI / 36}
          onChange={() => {
            if (!meshRef.current) return;
            const m = meshRef.current;
            const pos = [m.position.x, m.position.y, m.position.z];
            const rot = [m.rotation.x, m.rotation.y, m.rotation.z];
            if (
              pos[0] !== lastPos.current[0] || pos[1] !== lastPos.current[1] || pos[2] !== lastPos.current[2] ||
              rot[0] !== lastRot.current[0] || rot[1] !== lastRot.current[1] || rot[2] !== lastRot.current[2]
            ) {
              lastPos.current = pos;
              lastRot.current = rot;
              setCutPlane({ position: pos, rotation: rot });
            }
          }}
        />
      )}
    </>
  );
}


function SelectedTransform() {
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const transformMode = useScene((s) => s.transformMode);
  const snapEnabled = useScene((s) => s.snapEnabled);
  const snapTranslate = useScene((s) => s.snapTranslate);
  const snapRotate = useScene((s) => s.snapRotate);
  const setTransform = useScene((s) => s.setTransform);
  const beginTransform = useScene((s) => s.beginTransform);
  const dropToBed = useScene((s) => s.dropToBed);
  const autoDropOnRotate = useScene((s) => s.autoDropOnRotate);
  const objects = useScene((s) => s.objects);
  const { scene } = useThree();
  const draggingRef = useRef(false);
  // Drag-start snapshot used to propagate the gizmo delta to ALL other
  // selected objects (so moving a group / assembly moves every member, not
  // just the primary that the gizmo is attached to).
  const dragStartRef = useRef(null);

  // Resolve the THREE.Mesh for the current selection on EVERY render. We
  // used to memoize this on [selectedId, objects.length] but when geometry
  // rebuilds (e.g. user changes a primitive's dimensions or modifier flag)
  // R3F swaps the underlying mesh instance without changing those deps, so
  // TransformControls ended up bound to a stale Object3D — causing the
  // gizmo to feel "spotty" / require toggling Position↔Size to recover.
  // Scene traversal is O(n) with tiny n, well under one frame.
  let mesh = null;
  if (selectedId) {
    scene.traverse((c) => {
      if (c.isMesh && c.userData && c.userData.id === selectedId) mesh = c;
    });
  }

  const obj = objects.find((o) => o.id === selectedId);
  if (!obj || !mesh) return null;

  const otherIds = (selectedIds || []).filter((id) => id !== selectedId);

  const captureDragStart = () => {
    const primary = objects.find((o) => o.id === selectedId);
    if (!primary) return;
    const others = new Map();
    for (const id of otherIds) {
      const o = objects.find((x) => x.id === id);
      if (o) others.set(id, {
        pos: [...o.position],
        rot: [...o.rotation],
        scl: [...o.scale],
      });
    }
    dragStartRef.current = {
      primary: { pos: [...primary.position], rot: [...primary.rotation], scl: [...primary.scale] },
      others,
    };
  };

  const handleChange = () => {
    const newPos = [mesh.position.x, mesh.position.y, mesh.position.z];
    // Strip floating-point noise from snapped rotations — `radToDeg(π/12)`
    // returns 14.999999999999998, which the inspector popover would render
    // as "14.99°" after snapping to 15° in the gizmo. Rounding to 4
    // decimals preserves user-level precision while collapsing the noise.
    const newRot = [
      Math.round(THREE.MathUtils.radToDeg(mesh.rotation.x) * 1e4) / 1e4,
      Math.round(THREE.MathUtils.radToDeg(mesh.rotation.y) * 1e4) / 1e4,
      Math.round(THREE.MathUtils.radToDeg(mesh.rotation.z) * 1e4) / 1e4,
    ];
    const newScl = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
    setTransform(obj.id, "position", newPos);
    setTransform(obj.id, "rotation", newRot);
    setTransform(obj.id, "scale", newScl);

    // Propagate delta to every other selected object so the WHOLE group
    // follows the gizmo. Translate uses additive delta; rotate uses additive
    // Euler delta (rotates each member in place by the same amount); scale
    // uses a multiplicative ratio relative to the primary's drag-start scale.
    const start = dragStartRef.current;
    if (!start || start.others.size === 0) return;
    const dPos = [
      newPos[0] - start.primary.pos[0],
      newPos[1] - start.primary.pos[1],
      newPos[2] - start.primary.pos[2],
    ];
    const dRot = [
      newRot[0] - start.primary.rot[0],
      newRot[1] - start.primary.rot[1],
      newRot[2] - start.primary.rot[2],
    ];
    const sRatio = [
      start.primary.scl[0] ? newScl[0] / start.primary.scl[0] : 1,
      start.primary.scl[1] ? newScl[1] / start.primary.scl[1] : 1,
      start.primary.scl[2] ? newScl[2] / start.primary.scl[2] : 1,
    ];
    start.others.forEach((s, id) => {
      if (transformMode === "translate") {
        setTransform(id, "position", [s.pos[0] + dPos[0], s.pos[1] + dPos[1], s.pos[2] + dPos[2]]);
      } else if (transformMode === "rotate") {
        // Rigid-body group rotation via QUATERNION delta so the
        // assembly stays cohesive across consecutive rotations.
        //
        // ❌ Previous bug: we subtracted Euler components
        // (`dRot = newRot - startRot`) and rebuilt the rotation
        // matrix with `Matrix4.makeRotationFromEuler`. For any
        // primary that starts with a non-trivial rotation (e.g.,
        // already (45,0,0)) and is then rotated around a world
        // axis, the Euler XYZ decomposition of the new orientation
        // contains cross-axis values (e.g., (54.74, 30, -35.26) for
        // a +45°-around-world-Y rotation of a (45,0,0)-rotated
        // body). Naive Euler subtraction yields a delta-Euler that
        // expands to a DIFFERENT rotation matrix than the actual
        // world delta — every member orbits the wrong way and
        // distances skew over consecutive rotations, scattering
        // the assembly.
        //
        // ✓ Fix: compute the world-space rotation as `newQ ·
        // startQ⁻¹` and apply that quaternion to (a) each child's
        // start-of-drag offset from the primary (rigid orbit) and
        // (b) each child's start-of-drag quaternion (so the child's
        // local orientation tracks the same world rotation, not a
        // bogus Euler-decomposed approximation).
        const primaryStart = start.primary.pos;
        const startQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(start.primary.rot[0]),
          THREE.MathUtils.degToRad(start.primary.rot[1]),
          THREE.MathUtils.degToRad(start.primary.rot[2]),
          "XYZ",
        ));
        const newQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(newRot[0]),
          THREE.MathUtils.degToRad(newRot[1]),
          THREE.MathUtils.degToRad(newRot[2]),
          "XYZ",
        ));
        const dQ = newQ.clone().multiply(startQ.clone().invert());
        const offset = new THREE.Vector3(
          s.pos[0] - primaryStart[0],
          s.pos[1] - primaryStart[1],
          s.pos[2] - primaryStart[2],
        ).applyQuaternion(dQ);
        const childStartQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(s.rot[0]),
          THREE.MathUtils.degToRad(s.rot[1]),
          THREE.MathUtils.degToRad(s.rot[2]),
          "XYZ",
        ));
        const childNewQ = dQ.clone().multiply(childStartQ);
        const childNewEuler = new THREE.Euler().setFromQuaternion(childNewQ, "XYZ");
        setTransform(id, "rotation", [
          Math.round(THREE.MathUtils.radToDeg(childNewEuler.x) * 1e4) / 1e4,
          Math.round(THREE.MathUtils.radToDeg(childNewEuler.y) * 1e4) / 1e4,
          Math.round(THREE.MathUtils.radToDeg(childNewEuler.z) * 1e4) / 1e4,
        ]);
        setTransform(id, "position", [
          primaryStart[0] + offset.x,
          primaryStart[1] + offset.y,
          primaryStart[2] + offset.z,
        ]);
      } else if (transformMode === "scale") {
        setTransform(id, "scale", [s.scl[0] * sRatio[0], s.scl[1] * sRatio[1], s.scl[2] * sRatio[2]]);
      }
    });
  };

  return (
    <TransformControls
      object={mesh}
      mode={transformMode}
      translationSnap={snapEnabled ? snapTranslate : null}
      rotationSnap={snapEnabled ? THREE.MathUtils.degToRad(snapRotate) : null}
      scaleSnap={snapEnabled ? 0.1 : null}
      onObjectChange={handleChange}
      onMouseDown={() => { beginTransform(); captureDragStart(); }}
      onChange={(e) => {
        if (e && e.target && typeof e.target.dragging === "boolean") {
          const dragging = e.target.dragging;
          if (dragging && !draggingRef.current) {
            draggingRef.current = true;
            // Some drei builds skip onMouseDown; ensure snapshot exists.
            if (!dragStartRef.current) captureDragStart();
          } else if (!dragging && draggingRef.current) {
            draggingRef.current = false;
            dragStartRef.current = null;
            // Auto-drop after rotation drag completes. Translate the
            // WHOLE selection by the same dy so the bottom-most point
            // lands on Y=0 — preserving every member's relative offset
            // inside an assembly. See `dropSelectionToBed` for the
            // group-aware math (used by both the gizmo and the popover
            // so the two stay in lockstep).
            if (autoDropOnRotate && transformMode === "rotate") {
              setTimeout(() => {
                const st = useScene.getState();
                const ids = st.selectedIds.length ? st.selectedIds : [obj.id];
                if (ids.length <= 1) {
                  st.dropToBed(obj.id, false);
                } else {
                  st.dropSelectionToBed(false);
                }
              }, 0);
            }
          }
        }
      }}
      size={0.9}
    />
  );
}

function BuildPlate() {
  const buildVolume = useScene((s) => s.buildVolume);
  const gridVisible = useScene((s) => s.gridVisible);
  const { x, y } = buildVolume;
  return (
    <group>
      <mesh receiveShadow position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[x, y]} />
        <meshStandardMaterial color="#0F172A" roughness={0.9} />
      </mesh>
      {gridVisible && (
        <Grid
          args={[x, y]}
          position={[0, 0, 0]}
          cellSize={5}
          cellThickness={0.5}
          cellColor="#334155"
          sectionSize={50}
          sectionThickness={1}
          sectionColor="#F97316"
          fadeDistance={x * 2}
          infiniteGrid={false}
        />
      )}
    </group>
  );
}

function MeasurementLine({ measurement, onRemove }) {
  const { a, b, id } = measurement;
  const points = useMemo(() => [
    new THREE.Vector3(a[0], a[1], a[2]),
    new THREE.Vector3(b[0], b[1], b[2]),
  ], [a, b]);
  const mid = new THREE.Vector3(
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2
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

function PendingMarker({ pt }) {
  if (!pt) return null;
  return (
    <mesh position={pt} renderOrder={1000}>
      <sphereGeometry args={[1.4, 18, 18]} />
      <meshBasicMaterial color="#FACC15" depthTest={false} />
    </mesh>
  );
}

// Pinned dimension chip — renders OUTSIDE the Canvas (as a plain DOM
// element in Viewport) so it never overlaps the geometry the user is
// editing. It reads the active selection straight from the store and
// computes a rotated/scaled bbox on the fly.
function BBoxChip() {
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const obj = objects.find((o) => o.id === selectedId);
  if (!obj || !obj.visible) return null;
  let size = null;
  try {
    const bb = computeRotatedBBox(obj);
    size = {
      x: bb.max.x - bb.min.x,
      y: bb.max.y - bb.min.y,
      z: bb.max.z - bb.min.z,
    };
  } catch (e) {
    return null;
  }
  if (!size || !isFinite(size.x)) return null;
  return (
    <div
      data-testid="bbox-overlay"
      className="absolute bottom-3 left-3 z-10 px-2.5 py-1.5 bg-black/85 border border-orange-500/40 rounded text-[10px] font-mono text-orange-300 whitespace-nowrap pointer-events-none flex items-center gap-2"
    >
      <span className="text-slate-500">SIZE</span>
      <span data-testid="bbox-size-label">
        {size.x.toFixed(1)} × {size.y.toFixed(1)} × {size.z.toFixed(1)} mm
      </span>
      <span className="text-slate-600">·</span>
      <span className="text-slate-400">{obj.name}</span>
    </div>
  );
}

function MeasurementsLayer() {
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

// ---- Component-pair dimension overlay (Blender-style) ----
// One <ComponentDimensionLine/> per stored {objIdA, objIdB} pair. Math
// is recomputed every render from the current store state so the chip
// values stay live during a transform drag. We DO NOT subscribe to the
// individual object positions — instead we read `objects` once (it's
// already in render scope via the parent group), and let React's normal
// re-render cycle fire when the store changes.
function ComponentDimensionLine({ dim, objects, onRemove }) {
  const a = objects.find((o) => o.id === dim.objIdA);
  const b = objects.find((o) => o.id === dim.objIdB);
  const d = useMemo(() => computeComponentDimension(a, b), [a, b]);
  // Hook order MUST be stable: keep every hook call above any early-return.
  // `points` and `mid` are cheap derivations from `d` so we compute them
  // unconditionally (they're discarded when d is null below).
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
    (d.centerA[2] + d.centerB[2]) / 2
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
              {d.distance.toFixed(2)} mm
            </span>
            <span className="text-[9.5px] text-slate-400">
              <span data-testid={`component-dim-dx-${dim.id}`}>ΔX {fmtSignedMm(d.delta[0])}</span>
              {" · "}
              <span data-testid={`component-dim-dy-${dim.id}`}>ΔY {fmtSignedMm(d.delta[1])}</span>
              {" · "}
              <span data-testid={`component-dim-dz-${dim.id}`}>ΔZ {fmtSignedMm(d.delta[2])}</span>
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

function ComponentDimensionsLayer() {
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

// ---- Anchored Ruler overlay (TinkerCAD-style) ----
// Renders three blue dashed axis-rays from the anchor world-point out to
// the build-plate edges (filtered by rulerAxesMode), a glowing dot at the
// origin with a "0.00" label, and one signed-offset chip per other visible
// scene object. The chips track the nearest-corner of each object so the
// reading matches the TinkerCAD UX: "this part is +12 mm to the right of
// my anchor." Everything is recomputed every render from the live store,
// so dragging a part updates its chip in real time.
function RulerAnchorLayer() {
  const mode = useScene((s) => s.rulerMode);
  const anchor = useScene((s) => s.rulerAnchor);
  const targetId = useScene((s) => s.rulerTargetId);
  const axes = useScene((s) => s.rulerAxesMode);
  const objects = useScene((s) => s.objects);
  const buildVolume = useScene((s) => s.buildVolume);
  const clearRulerAnchor = useScene((s) => s.clearRulerAnchor);
  const clearRulerTarget = useScene((s) => s.clearRulerTarget);
  const cycleRulerAxes = useScene((s) => s.cycleRulerAxes);
  if (!mode || !anchor) return null;
  const [ax, ay, az] = anchor.worldPoint;
  const halfX = (buildVolume?.x || 220) / 2;
  const halfZ = (buildVolume?.z || 220) / 2;
  const maxY = buildVolume?.y || 250;
  const showX = axes === "xyz" || axes === "x";
  const showY = axes === "xyz" || axes === "y";
  const showZ = axes === "xyz" || axes === "z";
  const targetObj = targetId ? objects.find((o) => o.id === targetId && o.visible !== false) : null;
  return (
    <group>
      {/* Origin marker — small blue sphere with a "0.00" label */}
      <mesh position={[ax, ay, az]} renderOrder={1001}>
        <sphereGeometry args={[1.6, 24, 24]} />
        <meshBasicMaterial color="#38BDF8" depthTest={false} />
      </mesh>
      {/* Axis rays — extend each visible axis to the build-volume edges */}
      {showX && (
        <Line
          points={[[-halfX, ay, az], [halfX, ay, az]]}
          color="#38BDF8" lineWidth={1.5} dashed dashSize={3} gapSize={2} depthTest={false}
        />
      )}
      {showY && (
        <Line
          points={[[ax, 0, az], [ax, maxY, az]]}
          color="#38BDF8" lineWidth={1.5} dashed dashSize={3} gapSize={2} depthTest={false}
        />
      )}
      {showZ && (
        <Line
          points={[[ax, ay, -halfZ], [ax, ay, halfZ]]}
          color="#38BDF8" lineWidth={1.5} dashed dashSize={3} gapSize={2} depthTest={false}
        />
      )}
      {/* Anchor HUD card — sits at the origin, shows the anchored part's
          name + dismiss / axis-toggle + (when a target is locked) a small
          "swap target" hint. Mirrors TinkerCAD's tiny panel. */}
      <Html position={[ax, ay, az]} center zIndexRange={[100, 0]} sprite={false}>
        <div
          data-testid="ruler-anchor-hud"
          className="flex items-center gap-1 px-2 py-1 bg-slate-950/95 border border-sky-400/70 rounded-md shadow-xl whitespace-nowrap select-none translate-x-3 -translate-y-7"
          style={{ pointerEvents: "auto" }}
        >
          <span className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">0.00</span>
          <span className="text-[10px] text-slate-400">·</span>
          <span className="text-[10px] text-slate-200 max-w-[10ch] truncate">{anchor.objName}</span>
          <button
            data-testid="ruler-cycle-axes-btn"
            onClick={(e) => { e.stopPropagation(); cycleRulerAxes(); }}
            className="ml-1 w-5 h-5 rounded-sm bg-slate-800 hover:bg-sky-500/40 text-slate-300 hover:text-white flex items-center justify-center"
            title={`Axes: ${axes.toUpperCase()} — click to cycle`}
          >
            <span className="text-[9px] font-mono font-bold leading-none">{axes.toUpperCase()}</span>
          </button>
          <button
            data-testid="ruler-clear-anchor-btn"
            onClick={(e) => { e.stopPropagation(); clearRulerAnchor(); }}
            className="w-5 h-5 rounded-sm bg-slate-800 hover:bg-red-500/40 text-slate-400 hover:text-white flex items-center justify-center"
            title="Dismiss the anchor (turns the scale off)"
          >
            <span className="text-[12px] leading-none -mt-px">×</span>
          </button>
        </div>
      </Html>
      {/* Hint OR single target chip. Two-step UX: when anchor is set but no
          target yet, we render a small "Pick a second part…" tooltip near
          the anchor so the user knows what to do next. Once a target is
          picked, ONLY that target gets the offset chip — no more global
          chip-spam across the scene. Most-recent click replaces target. */}
      {!targetObj && (
        <Html position={[ax, ay, az]} center zIndexRange={[80, 0]} sprite={false}>
          <div
            data-testid="ruler-pick-target-hint"
            className="px-2 py-1 bg-sky-950/95 border border-sky-500/40 text-sky-200 text-[10px] rounded-md shadow whitespace-nowrap select-none translate-y-7"
            style={{ pointerEvents: "none" }}
          >
            Click a second part to read its offset…
          </div>
        </Html>
      )}
      {targetObj && (
        <RulerOffsetChip
          obj={targetObj}
          anchorPt={anchor.worldPoint}
          axes={axes}
          onClear={clearRulerTarget}
        />
      )}
    </group>
  );
}

// Per-object offset chip — anchors to the world centre of `obj` (NOT the
// nearest corner) because the chip needs a stable, predictable position
// while the user is reading it. The numbers inside the chip ARE the
// nearest-corner offsets, matching TinkerCAD's "this edge is X mm from 0".
// Now also has its own × button to clear ONLY the target (anchor stays).
function RulerOffsetChip({ obj, anchorPt, axes, onClear }) {
  const off = offsetToObject(anchorPt, obj);
  if (!off) return null;
  const [dx, dy, dz] = off.delta;
  const cx = obj.position?.[0] || 0;
  const cy = obj.position?.[1] || 0;
  const cz = obj.position?.[2] || 0;
  return (
    <Html position={[cx, cy, cz]} center zIndexRange={[80, 0]} sprite={false}>
      <div
        data-testid={`ruler-offset-chip-${obj.id}`}
        className="flex flex-col gap-0 px-2 py-1 bg-slate-950/95 border border-sky-500/70 rounded-md shadow-xl whitespace-nowrap select-none translate-y-2"
        style={{ pointerEvents: "auto" }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-sky-300 leading-tight">{obj.name || obj.type}</span>
          {onClear && (
            <button
              data-testid={`ruler-clear-target-btn`}
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="w-3.5 h-3.5 rounded-sm bg-slate-800 hover:bg-red-500/40 text-slate-400 hover:text-white flex items-center justify-center"
              title="Clear target — click another part to pick a new one"
            >
              <span className="text-[10px] leading-none -mt-px">×</span>
            </button>
          )}
        </div>
        <div className="flex gap-2 font-mono text-[10px] leading-tight">
          {(axes === "xyz" || axes === "x") && (
            <span data-testid={`ruler-offset-x-${obj.id}`} className="text-rose-300">X {fmtSignedMm(dx)}</span>
          )}
          {(axes === "xyz" || axes === "y") && (
            <span data-testid={`ruler-offset-y-${obj.id}`} className="text-emerald-300">Y {fmtSignedMm(dy)}</span>
          )}
          {(axes === "xyz" || axes === "z") && (
            <span data-testid={`ruler-offset-z-${obj.id}`} className="text-amber-300">Z {fmtSignedMm(dz)}</span>
          )}
        </div>
      </div>
    </Html>
  );
}

// Tiny bridge component placed INSIDE the Canvas so we can grab camera / gl
// / scene refs and use them from the outer DOM (marquee picker).
function CanvasBridge({ bridgeRef }) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    bridgeRef.current = { camera, gl, scene };
  }, [bridgeRef, camera, gl, scene]);
  return null;
}

export default function Viewport() {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const selectObject = useScene((s) => s.selectObject);
  const clearSelection = useScene((s) => s.clearSelection);
  const buildVolume = useScene((s) => s.buildVolume);
  const measureMode = useScene((s) => s.measureMode);
  const handleMeasureClick = useScene((s) => s.handleMeasureClick);
  const measurementsCount = useScene((s) => s.measurements.length);
  const rulerMode = useScene((s) => s.rulerMode);
  const setRulerAnchor = useScene((s) => s.setRulerAnchor);
  const setRulerTarget = useScene((s) => s.setRulerTarget);
  // Canvas background tracks the global UI theme so the 3D scene
  // doesn't sit on a slate-800 island when the user picks Light/Dim.
  // Uses the *resolved* theme (concrete dark/dim/light) so "system"
  // mode follows the OS without a separate code path here.
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const viewportBg = VIEWPORT_BG[resolvedTheme] || VIEWPORT_BG.dark;
  const [ctxMenu, setCtxMenu] = React.useState(null);

  // ---- Marquee (Shift + left-drag) box selection ----
  const [shiftHeld, setShiftHeld] = React.useState(false);
  const [marquee, setMarquee] = React.useState(null); // {x0,y0,x1,y1, additive}
  const bridgeRef = React.useRef(null);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    const down = (e) => { if (e.key === "Shift") setShiftHeld(true); };
    const up = (e) => { if (e.key === "Shift") setShiftHeld(false); };
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const handleContextMenu = (e, hitId) => {
    e.preventDefault();
    if (hitId) {
      // Right-click on a mesh selects it (if not already in the selection)
      // so the menu's "selected count" reflects what the user is pointing at.
      const inSel = (selectedIds && selectedIds.includes(hitId)) || hitId === selectedId;
      if (!inSel) selectObject(hitId);
    }
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  // Compute which scene meshes fall inside the final marquee rect by
  // projecting their world bounding-box corners into screen space.
  const finalizeMarquee = (rect, additive) => {
    setMarquee(null);
    if (!bridgeRef.current || !containerRef.current) return;
    const w = Math.abs(rect.x1 - rect.x0);
    const h = Math.abs(rect.y1 - rect.y0);
    // Treat tiny drags as a "click on empty space" — clear selection unless
    // additive — and don't run picking math.
    if (w < 4 && h < 4) {
      if (!additive) clearSelection();
      return;
    }
    const { camera, gl, scene } = bridgeRef.current;
    const canvasRect = gl.domElement.getBoundingClientRect();
    const contRect = containerRef.current.getBoundingClientRect();
    // Marquee rect is in container-local px; convert to canvas-local px.
    const minX = Math.min(rect.x0, rect.x1) + (contRect.left - canvasRect.left);
    const maxX = Math.max(rect.x0, rect.x1) + (contRect.left - canvasRect.left);
    const minY = Math.min(rect.y0, rect.y1) + (contRect.top - canvasRect.top);
    const maxY = Math.max(rect.y0, rect.y1) + (contRect.top - canvasRect.top);
    const hits = [];
    scene.traverse((c) => {
      if (!c.isMesh || !c.userData || !c.userData.id) return;
      if (c.visible === false) return;
      const box = new THREE.Box3().setFromObject(c);
      if (!isFinite(box.min.x)) return;
      const corners = [
        [box.min.x, box.min.y, box.min.z],
        [box.max.x, box.min.y, box.min.z],
        [box.min.x, box.max.y, box.min.z],
        [box.max.x, box.max.y, box.min.z],
        [box.min.x, box.min.y, box.max.z],
        [box.max.x, box.min.y, box.max.z],
        [box.min.x, box.max.y, box.max.z],
        [box.max.x, box.max.y, box.max.z],
      ];
      let inside = false;
      const v = new THREE.Vector3();
      for (const [x, y, z] of corners) {
        v.set(x, y, z).project(camera);
        const sx = (v.x * 0.5 + 0.5) * canvasRect.width;
        const sy = (-v.y * 0.5 + 0.5) * canvasRect.height;
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
          inside = true;
          break;
        }
      }
      if (inside) hits.push(c.userData.id);
    });
    if (!additive) clearSelection();
    // Expand any group hits to include all sibling members, so dragging a
    // box around a grouped assembly grabs the whole thing (matches the
    // "click any member selects the group" behaviour in selectObject).
    const objects = useScene.getState().objects;
    const expanded = new Set();
    for (const id of hits) {
      const o = objects.find((x) => x.id === id);
      if (o && o.groupId) {
        objects.filter((x) => x.groupId === o.groupId).forEach((m) => expanded.add(m.id));
      } else {
        expanded.add(id);
      }
    }
    for (const id of expanded) selectObject(id, "add");
  };

  const onMarqueeDown = (e) => {
    if (e.button !== 0) return;
    if (measureMode) return;
    e.preventDefault();
    e.stopPropagation();
    const r = containerRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const additive = e.ctrlKey || e.metaKey;
    setMarquee({ x0: x, y0: y, x1: x, y1: y, additive });
    // Pointer capture is best-effort; some browsers throw on synthetic
    // pointer ids during automated testing. Marquee still works without it.
    try { e.currentTarget.setPointerCapture(e.pointerId); }
    catch (capErr) {
      // eslint-disable-next-line no-console
      console.debug("setPointerCapture not available:", capErr?.message || capErr);
    }
  };
  const onMarqueeMove = (e) => {
    if (!marquee) return;
    const r = containerRef.current.getBoundingClientRect();
    setMarquee((m) => m ? ({ ...m, x1: e.clientX - r.left, y1: e.clientY - r.top }) : null);
  };
  const onMarqueeUp = (e) => {
    if (!marquee) return;
    const r = containerRef.current.getBoundingClientRect();
    const finalRect = { x0: marquee.x0, y0: marquee.y0, x1: e.clientX - r.left, y1: e.clientY - r.top };
    finalizeMarquee(finalRect, marquee.additive);
  };

  const marqueeOverlayActive = (shiftHeld || marquee) && !measureMode;

  return (
    <div ref={containerRef} className="w-full h-full relative" data-testid="viewport-container" onContextMenu={(e) => handleContextMenu(e, null)}>
      {measureMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-black/85 border border-green-500/40 rounded text-[11px] font-mono text-green-300 pointer-events-none flex items-center gap-2" data-testid="measure-hint">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          MEASURE MODE — click two points on any object (Esc to exit)
          {measurementsCount > 0 && (
            <span className="text-slate-400">| {measurementsCount} measurement{measurementsCount === 1 ? "" : "s"}</span>
          )}
        </div>
      )}
      {marqueeOverlayActive && (
        <div
          data-testid="marquee-hint"
          className="absolute top-3 right-3 z-10 px-2.5 py-1 bg-black/85 border border-orange-500/40 rounded text-[10px] font-mono text-orange-300 pointer-events-none flex items-center gap-1.5"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
          BOX SELECT — drag a rectangle (Ctrl to add)
        </div>
      )}
      <Canvas
        shadows
        camera={{ position: [0, 160, 280], fov: 45, near: 0.1, far: 5000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={(e) => {
          if (measureMode || marquee || shiftHeld) return;
          // Right-click is reserved for the context menu — DON'T wipe the
          // selection on its pointerup, otherwise the menu's actions
          // (Group, Flatten, …) read an empty selection set.
          if (e && (e.button === 2 || e.which === 3)) return;
          clearSelection();
        }}
        style={{ background: viewportBg }}
      >
        <color attach="background" args={[viewportBg]} />
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[150, 250, 100]}
          intensity={1.0}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-100, 120, -100]} intensity={0.35} />

        <BuildPlate />

        {objects.map((o) => (
          <SceneObject
            key={o.id}
            obj={o}
            isSelected={o.id === selectedId || (selectedIds && selectedIds.includes(o.id))}
            onSelect={selectObject}
            measureMode={measureMode}
            onMeasureHit={handleMeasureClick}
            rulerMode={rulerMode}
            onRulerHit={(point, objId) => {
              const oo = objects.find((x) => x.id === objId);
              if (!oo) return;
              // Two-step workflow (TinkerCAD-style):
              //   1. No anchor → set anchor (the "0.00" origin) on the
              //      nearest bbox corner of the clicked object.
              //   2. Anchor already set & you click a DIFFERENT object →
              //      that becomes the single target (shows ΔX/ΔY/ΔZ).
              //   3. Anchor set & you click the SAME object that's the
              //      anchor → keep the anchor (no-op; let the user
              //      explicitly clear via × or Esc).
              const cur = useScene.getState();
              if (!cur.rulerAnchor) {
                const c = nearestCorner(oo, point);
                if (!c) return;
                setRulerAnchor({
                  worldPoint: [c.x, c.y, c.z],
                  objId: oo.id,
                  objName: oo.name || "Anchor",
                  cornerKey: c.key,
                });
                return;
              }
              if (oo.id === cur.rulerAnchor.objId) {
                // Clicking the anchor itself again — do nothing (user
                // can dismiss the anchor with × in the HUD or Esc).
                return;
              }
              setRulerTarget(oo.id);
            }}
            onContextMenu={handleContextMenu}
            scene={{ objects }}
          />
        ))}

        {!measureMode && !rulerMode && <SelectedTransform />}
        <MeasurementsLayer />
        <ComponentDimensionsLayer />
        <RulerAnchorLayer />
        <CutPlaneGizmo />
        <CanvasBridge bridgeRef={bridgeRef} />

        <OrbitControls
          makeDefault
          enabled={!marquee}
          enableDamping
          dampingFactor={0.08}
          target={[0, buildVolume.z / 4, 0]}
          maxDistance={1500}
          minDistance={20}
        />
        <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
          <GizmoViewport axisColors={["#F97316", "#22C55E", "#06B6D4"]} labelColor="#F8FAFC" />
        </GizmoHelper>
      </Canvas>

      {/* Transparent capture overlay: only visible while Shift is held OR a
          marquee drag is in progress. Sits above the Canvas to intercept the
          pointer events that would otherwise drive OrbitControls / mesh picks. */}
      {marqueeOverlayActive && (
        <div
          data-testid="marquee-overlay"
          className="absolute inset-0 z-20"
          style={{ cursor: "crosshair" }}
          onPointerDown={onMarqueeDown}
          onPointerMove={onMarqueeMove}
          onPointerUp={onMarqueeUp}
          onContextMenu={(e) => { e.preventDefault(); }}
        >
          {marquee && (
            <div
              data-testid="marquee-rect"
              style={{
                position: "absolute",
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
                border: "1px dashed #F97316",
                background: "rgba(249,115,22,0.10)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      )}
      {ctxMenu && <ContextMenu position={ctxMenu} onClose={() => setCtxMenu(null)} />}
      {!measureMode && <BBoxChip />}
    </div>
  );
}

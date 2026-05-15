import React, { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls, GizmoHelper, GizmoViewport, Edges, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../lib/store";
import { buildGeometry } from "../lib/geometry";

const POSITIVE_COLOR = "#F97316";
const NEGATIVE_COLOR = "#06B6D4";

function SceneObject({ obj, isSelected, onSelect, measureMode, onMeasureHit }) {
  const meshRef = useRef();
  const geom = useMemo(
    () => buildGeometry(obj),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [obj.type, JSON.stringify(obj.dims)]
  );
  const color = obj.modifier === "negative" ? NEGATIVE_COLOR : POSITIVE_COLOR;

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
          onMeasureHit([e.point.x, e.point.y, e.point.z]);
        } else {
          onSelect(obj.id);
        }
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

function SelectedTransform() {
  const selectedId = useScene((s) => s.selectedId);
  const transformMode = useScene((s) => s.transformMode);
  const snapEnabled = useScene((s) => s.snapEnabled);
  const snapTranslate = useScene((s) => s.snapTranslate);
  const snapRotate = useScene((s) => s.snapRotate);
  const setTransform = useScene((s) => s.setTransform);
  const beginTransform = useScene((s) => s.beginTransform);
  const objects = useScene((s) => s.objects);
  const { scene } = useThree();
  const draggingRef = useRef(false);

  const mesh = useMemo(() => {
    if (!selectedId) return null;
    let found = null;
    scene.traverse((c) => {
      if (c.isMesh && c.userData && c.userData.id === selectedId) found = c;
    });
    return found;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, objects.length, scene]);

  const obj = objects.find((o) => o.id === selectedId);
  if (!obj || !mesh) return null;

  const handleChange = () => {
    setTransform(obj.id, "position", [mesh.position.x, mesh.position.y, mesh.position.z]);
    setTransform(obj.id, "rotation", [
      THREE.MathUtils.radToDeg(mesh.rotation.x),
      THREE.MathUtils.radToDeg(mesh.rotation.y),
      THREE.MathUtils.radToDeg(mesh.rotation.z),
    ]);
    setTransform(obj.id, "scale", [mesh.scale.x, mesh.scale.y, mesh.scale.z]);
  };

  const handleDragChange = (e) => {
    // drei's TransformControls forwards three.js TransformControls `dragging-changed`
    const dragging = e?.value ?? e?.target?.dragging;
    if (dragging && !draggingRef.current) {
      draggingRef.current = true;
      beginTransform();
    } else if (!dragging) {
      draggingRef.current = false;
    }
  };

  return (
    <TransformControls
      object={mesh}
      mode={transformMode}
      translationSnap={snapEnabled ? snapTranslate : null}
      rotationSnap={snapEnabled ? THREE.MathUtils.degToRad(snapRotate) : null}
      scaleSnap={snapEnabled ? 0.1 : null}
      onObjectChange={handleChange}
      onMouseDown={beginTransform}
      onChange={(e) => {
        // also listen to dragging-changed (legacy event passthrough)
        if (e && e.target && typeof e.target.dragging === "boolean") {
          handleDragChange({ value: e.target.dragging, target: e.target });
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

function MeasurementLine({ a, b }) {
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
      <Line points={points} color="#22C55E" lineWidth={2} dashed={false} />
      <mesh position={points[0]}>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshBasicMaterial color="#22C55E" />
      </mesh>
      <mesh position={points[1]}>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshBasicMaterial color="#22C55E" />
      </mesh>
      <Html position={mid} center distanceFactor={120} zIndexRange={[100, 0]}>
        <div className="px-2 py-0.5 bg-black/85 border border-green-500/50 text-green-300 text-[11px] font-mono rounded pointer-events-none whitespace-nowrap">
          {dist.toFixed(2)} mm
        </div>
      </Html>
    </group>
  );
}

function PendingMarker({ pt }) {
  if (!pt) return null;
  return (
    <mesh position={pt}>
      <sphereGeometry args={[0.8, 16, 16]} />
      <meshBasicMaterial color="#FACC15" />
    </mesh>
  );
}

function BBoxOverlay() {
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const { scene } = useThree();
  const obj = objects.find((o) => o.id === selectedId);
  if (!obj || !obj.visible) return null;

  let mesh = null;
  scene.traverse((c) => {
    if (c.isMesh && c.userData && c.userData.id === selectedId) mesh = c;
  });
  if (!mesh) return null;
  const box = new THREE.Box3().setFromObject(mesh);
  if (!isFinite(box.min.x)) return null;
  const size = new THREE.Vector3();
  box.getSize(size);
  const top = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    box.max.y + 6,
    (box.min.z + box.max.z) / 2
  );
  return (
    <Html position={top} center zIndexRange={[80, 0]}>
      <div className="px-2 py-1 bg-black/80 border border-orange-500/40 rounded text-[10px] font-mono text-orange-300 whitespace-nowrap pointer-events-none"
        data-testid="bbox-overlay">
        {size.x.toFixed(1)} × {size.z.toFixed(1)} × {size.y.toFixed(1)} mm
      </div>
    </Html>
  );
}

function MeasurementsLayer() {
  const measurements = useScene((s) => s.measurements);
  const pending = useScene((s) => s.pendingMeasurePoint);
  return (
    <group>
      {measurements.map((m) => (
        <MeasurementLine key={m.id} a={m.a} b={m.b} />
      ))}
      <PendingMarker pt={pending} />
    </group>
  );
}

export default function Viewport() {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const selectObject = useScene((s) => s.selectObject);
  const clearSelection = useScene((s) => s.clearSelection);
  const buildVolume = useScene((s) => s.buildVolume);
  const measureMode = useScene((s) => s.measureMode);
  const handleMeasureClick = useScene((s) => s.handleMeasureClick);

  return (
    <div className="w-full h-full relative" data-testid="viewport-container">
      {measureMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-black/80 border border-green-500/40 rounded text-[11px] font-mono text-green-300 pointer-events-none flex items-center gap-2" data-testid="measure-hint">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          MEASURE MODE — click two points on any object (Esc to exit)
        </div>
      )}
      <Canvas
        shadows
        camera={{ position: [180, 160, 200], fov: 45, near: 0.1, far: 5000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => { if (!measureMode) clearSelection(); }}
        style={{ background: "#1E293B" }}
      >
        <color attach="background" args={["#1E293B"]} />
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
            isSelected={o.id === selectedId}
            onSelect={selectObject}
            measureMode={measureMode}
            onMeasureHit={handleMeasureClick}
          />
        ))}

        {!measureMode && <SelectedTransform />}
        {!measureMode && <BBoxOverlay />}
        <MeasurementsLayer />

        <OrbitControls
          makeDefault
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
    </div>
  );
}

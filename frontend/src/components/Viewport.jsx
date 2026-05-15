import React, { useRef, useMemo, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls, GizmoHelper, GizmoViewport, Edges } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../lib/store";
import { buildGeometry } from "../lib/geometry";

const POSITIVE_COLOR = "#F97316";
const NEGATIVE_COLOR = "#06B6D4";

function SceneObject({ obj, isSelected, onSelect }) {
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
        onSelect(obj.id);
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
  const objects = useScene((s) => s.objects);
  const { scene } = useThree();

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

  return (
    <TransformControls
      object={mesh}
      mode={transformMode}
      translationSnap={snapEnabled ? snapTranslate : null}
      rotationSnap={snapEnabled ? THREE.MathUtils.degToRad(snapRotate) : null}
      scaleSnap={snapEnabled ? 0.1 : null}
      onObjectChange={handleChange}
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

export default function Viewport() {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const selectObject = useScene((s) => s.selectObject);
  const clearSelection = useScene((s) => s.clearSelection);
  const buildVolume = useScene((s) => s.buildVolume);

  return (
    <div className="w-full h-full relative" data-testid="viewport-container">
      <Canvas
        shadows
        camera={{ position: [180, 160, 200], fov: 45, near: 0.1, far: 5000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => clearSelection()}
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
          />
        ))}

        <SelectedTransform />

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

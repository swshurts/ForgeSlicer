import React, { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls, GizmoHelper, GizmoViewport, Edges, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { X, Pin } from "lucide-react";
import { useScene } from "../lib/store";
import { useTheme, VIEWPORT_BG } from "../lib/theme";
import { buildGeometry, computeRotatedBBox } from "../lib/geometry";
import { buildCubeGeometryWithFillets, hasActiveEdgeFillets } from "../lib/partialFillet";
import { onFontLoaded } from "../lib/textGeometry";
import { cubeEdgeEndpoints, cubeFaceQuads, cubeVertexPositions } from "../lib/edgeFaceMeta";
import { MULTICOLOR_PALETTE } from "../lib/presets";
import { nearestSnapPoint, resolveSnapTargetForGroup } from "../lib/rulerAnchor";
import { computePlaceOnFace } from "../lib/placeOnFace";
import ContextMenu from "./ContextMenu";
import { MeasurementsLayer } from "./viewport/MeasurementsOverlay";
import { ComponentDimensionsLayer } from "./viewport/ComponentDimensionsOverlay";
import { RulerAnchorLayer, PinnedRulerLayer } from "./viewport/RulerLayers";
import { SelectionDimLabels } from "./viewport/SelectionDimLabels";
import { WorkplaneRuler } from "./viewport/WorkplaneRuler";
import PrintabilityOverlay from "./PrintabilityOverlay";

const POSITIVE_COLOR = "#F97316";
const NEGATIVE_COLOR = "#06B6D4";

function colorForObject(obj) {
  if (obj.modifier === "negative") return NEGATIVE_COLOR;
  // Iter-94 Phase 2 — when a 3MF was imported with a per-object
  // displaycolor (typically from LithoForge's per-tone export), the
  // store stores that hex on `customColor`. It overrides the palette
  // lookup so the viewport reproduces the source colours exactly,
  // not just to the nearest of the 8 palette slots. User can still
  // override via the Inspector's color picker (which writes
  // colorIndex AND clears customColor).
  if (typeof obj.customColor === "string" && /^#[0-9a-f]{6}$/i.test(obj.customColor)) {
    return obj.customColor;
  }
  const idx = obj.colorIndex | 0;
  // Map the picker swatch directly to the rendered colour. We used to special-
  // case slot-0 to ForgeSlicer's house orange, which meant picking "White"
  // visually rendered orange — confusing because the picker UI did show a
  // white swatch. New positives now default to slot 7 (Orange) in the store
  // so the historical "default = orange" behaviour is preserved without the
  // 1:1 picker/render mismatch.
  return (MULTICOLOR_PALETTE[idx] && MULTICOLOR_PALETTE[idx].hex) || POSITIVE_COLOR;
}

function SceneObject({ obj, isSelected, onSelect, measureMode, onMeasureHit, rulerMode, onRulerHit, placeOnFaceMode, onPlaceFaceHit, workplaneRulerPlacing, onWorkplaneRulerPlace, onContextMenu, scene }) {
  // Font-load tick — when the text primitive's typeface.json arrives
  // we bump this counter, which invalidates the `geom` useMemo below
  // and rebuilds with real glyphs (instead of the placeholder slab
  // returned by buildTextGeometry while the font was loading).
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    if (obj.type !== "text") return undefined;
    const unsubscribe = onFontLoaded(() => setFontTick((t) => t + 1));
    return unsubscribe;
  }, [obj.type]);
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
    [obj.type, JSON.stringify(obj.dims), refSig, JSON.stringify(obj.edgeFillets || null), fontTick]
  );
  // Async override: if this is a cube with per-edge fillets, the sync
  // path returned a SHARP cube as a placeholder. Kick off a Manifold-
  // based partial-fillet build and swap the geometry in when ready.
  // Signature includes obj.edgeFillets so any edit retriggers a rebuild.
  const [asyncGeom, setAsyncGeom] = useState(null);
  const filletSig = obj.type === "cube" ? JSON.stringify(obj.edgeFillets || null) : null;
  useEffect(() => {
    if (obj.type !== "cube" || !hasActiveEdgeFillets(obj)) {
      setAsyncGeom(null);
      return;
    }
    let cancelled = false;
    buildCubeGeometryWithFillets(obj)
      .then((g) => { if (!cancelled && g) setAsyncGeom(g); })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("partial-fillet build failed; falling back to sharp cube:", err);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.type, filletSig, JSON.stringify(obj.dims)]);

  const liveGeom = asyncGeom || geom;
  const color = colorForObject(obj);

  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => { if (asyncGeom) asyncGeom.dispose(); }, [asyncGeom]);
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
      geometry={liveGeom}
      onClick={(e) => {
        e.stopPropagation();
        if (measureMode) {
          onMeasureHit([e.point.x, e.point.y, e.point.z], obj.id);
        } else if (rulerMode) {
          onRulerHit([e.point.x, e.point.y, e.point.z], obj.id);
        } else if (workplaneRulerPlacing && onWorkplaneRulerPlace) {
          // Iter-114.2 — clicking an object face in ruler placement
          // mode drops the ruler origin AT THE CLICK POINT. The
          // handler tries to snap to the nearest vertex / edge-mid /
          // face-centre via `nearestSnapPoint`; falls back to raw hit
          // if no snap candidate within the picker radius.
          onWorkplaneRulerPlace(
            { x: e.point.x, y: e.point.y, z: e.point.z },
            obj.id,
          );
        } else if (placeOnFaceMode && onPlaceFaceHit) {
          // Iter-113 — snap-to-face placement.
          const worldNormal = new THREE.Vector3().copy(e.face.normal)
            .transformDirection(e.object.matrixWorld)
            .normalize();
          onPlaceFaceHit(
            { x: e.point.x, y: e.point.y, z: e.point.z },
            { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z },
            obj.id,
          );
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
        color={obj.ghosted ? "#64748b" : color}
        roughness={0.55}
        metalness={0.05}
        transparent={obj.modifier === "negative" || obj.ghosted}
        opacity={obj.ghosted ? 0.18 : (obj.modifier === "negative" ? 0.55 : 1)}
        depthWrite={!obj.ghosted}
      />
      {isSelected && !obj.ghosted && <Edges threshold={20} color="#FFFFFF" scale={1.001} />}
      {obj.ghosted && <Edges threshold={20} color="#94a3b8" scale={1.001} />}
    </mesh>
  );
}

// ---------- Sub-element pick overlay (face / edge / vertex) ----------
// Renders hover/clickable widgets over a cube, cylinder, or cone to let
// the user pick a face / edge / corner for the EdgeControls panel. The
// overlay is positioned so it shares the same transform as the host
// object (its `position`, `rotation`, `scale`), then sits in object-
// local space — keeping the edge IDs stable under any rotation.
function SubElementPickOverlay({ obj }) {
  const subSelectMode = useScene((s) => s.subSelectMode);
  const subSelection = useScene((s) => s.subSelection);
  const setSubSelection = useScene((s) => s.setSubSelection);
  const measureMode = useScene((s) => s.measureMode);
  const rulerMode = useScene((s) => s.rulerMode);
  const cutMode = useScene((s) => s.cutMode);
  const placeOnFaceMode = useScene((s) => s.placeOnFaceMode);
  const workplaneRulerPlacing = useScene((s) => s.workplaneRuler?.placing);
  const filletMap = obj.edgeFillets || {};
  const [hoverId, setHoverId] = useState(null);

  if (subSelectMode === "object") return null;
  // Other interactive modes own the pointer — hide our picker so clicks
  // don't get swallowed before they reach the measure / ruler / cut /
  // snap-to-face / ruler-place pointer handlers on the underlying mesh.
  if (measureMode || rulerMode || cutMode || placeOnFaceMode || workplaneRulerPlacing) return null;
  if (!["cube", "cylinder", "cone"].includes(obj.type)) return null;

  const onPick = (kind, id) => (e) => {
    e.stopPropagation();
    setSubSelection({ kind, id });
  };

  const baseProps = {
    position: obj.position,
    rotation: [
      THREE.MathUtils.degToRad(obj.rotation[0]),
      THREE.MathUtils.degToRad(obj.rotation[1]),
      THREE.MathUtils.degToRad(obj.rotation[2]),
    ],
    scale: obj.scale,
  };

  // ── Cube: 12 edges, 6 faces, 8 vertices ──
  if (obj.type === "cube") {
    const dims = obj.dims || {};
    if (subSelectMode === "edge") {
      const edges = cubeEdgeEndpoints(dims);
      return (
        <group {...baseProps}>
          {edges.map((e) => {
            const isPicked = subSelection?.kind === "edge" && subSelection.id === e.id;
            const isHover = hoverId === e.id;
            const hasFillet = !!filletMap[e.id];
            const color = isPicked ? "#F97316" : isHover ? "#FB923C" : hasFillet ? "#22C55E" : "#94A3B8";
            // Centerpoint + axis length for the hit cylinder.
            const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2];
            const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], dz = e.b[2] - e.a[2];
            const len = Math.hypot(dx, dy, dz);
            const dir = new THREE.Vector3(dx, dy, dz).normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            const r = (isPicked || isHover) ? 0.9 : 0.4;
            // Unpicked default — subtle, gets stronger on hover / pick so
            // the overlay reads as "here are the edges you CAN click",
            // not "your cube is now striped".
            const opacity = isPicked ? 1 : isHover ? 0.85 : hasFillet ? 0.7 : 0.35;
            return (
              <mesh
                key={e.id}
                position={mid}
                quaternion={q}
                onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(e.id); }}
                onPointerOut={() => setHoverId((h) => h === e.id ? null : h)}
                onClick={onPick("edge", e.id)}
                renderOrder={2000}
              >
                <cylinderGeometry args={[r, r, len, 12]} />
                <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
              </mesh>
            );
          })}
        </group>
      );
    }
    if (subSelectMode === "face") {
      const quads = cubeFaceQuads(dims);
      return (
        <group {...baseProps}>
          {quads.map((f) => {
            const isPicked = subSelection?.kind === "face" && subSelection.id === f.id;
            const isHover = hoverId === f.id;
            const color = isPicked ? "#F97316" : isHover ? "#FB923C" : "#0EA5E9";
            // Build a quad oriented along the face normal. Use a Plane
            // geometry whose +Z normal we rotate to match `f.normal`.
            const n = new THREE.Vector3(...f.normal);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
            return (
              <mesh
                key={f.id}
                position={f.center}
                quaternion={q}
                onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(f.id); }}
                onPointerOut={() => setHoverId((h) => h === f.id ? null : h)}
                onClick={onPick("face", f.id)}
                renderOrder={1990}
              >
                <planeGeometry args={[f.half[0] * 2 * 0.96, f.half[1] * 2 * 0.96]} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={isPicked ? 0.45 : isHover ? 0.35 : 0.18}
                  depthTest={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            );
          })}
        </group>
      );
    }
    if (subSelectMode === "vertex") {
      const verts = cubeVertexPositions(dims);
      return (
        <group {...baseProps}>
          {verts.map((v) => {
            const isPicked = subSelection?.kind === "vertex" && subSelection.id === v.id;
            const isHover = hoverId === v.id;
            const color = isPicked ? "#F97316" : isHover ? "#FB923C" : "#EAB308";
            const r = (isPicked || isHover) ? 1.4 : 1.0;
            return (
              <mesh
                key={v.id}
                position={v.p}
                onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(v.id); }}
                onPointerOut={() => setHoverId((h) => h === v.id ? null : h)}
                onClick={onPick("vertex", v.id)}
                renderOrder={2010}
              >
                <sphereGeometry args={[r, 16, 16]} />
                <meshBasicMaterial color={color} transparent opacity={isPicked ? 1 : 0.9} depthTest={false} />
              </mesh>
            );
          })}
        </group>
      );
    }
  }

  // ── Cylinder: 2 edges (torus rings), 3 faces (caps + side) ──
  // Cylinder axis is +Z (Z-up); top edge at +Z/2, bottom at -Z/2.
  if (obj.type === "cylinder") {
    const r = obj.dims?.r || 10;
    const h = obj.dims?.h || 20;
    const half = h / 2;
    if (subSelectMode === "edge") {
      // Render two thin torus rings at z=±half. TorusGeometry's hole
      // axis is +Z by default → no rotation needed for Z-up cylinder.
      const ringR = Math.max(0.5, Math.min(1.0, r * 0.05));
      return (
        <group {...baseProps}>
          {["e_top", "e_bottom"].map((id) => {
            const z = id === "e_top" ? half : -half;
            const isPicked = subSelection?.kind === "edge" && subSelection.id === id;
            const isHover = hoverId === id;
            const hasFillet = !!filletMap[id];
            const color = isPicked ? "#F97316" : isHover ? "#FB923C" : hasFillet ? "#22C55E" : "#94A3B8";
            return (
              <mesh
                key={id}
                position={[0, 0, z]}
                onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(id); }}
                onPointerOut={() => setHoverId((hh) => hh === id ? null : hh)}
                onClick={onPick("edge", id)}
                renderOrder={2000}
              >
                <torusGeometry args={[r, ringR, 8, 48]} />
                <meshBasicMaterial color={color} transparent opacity={isPicked ? 1 : 0.85} depthTest={false} />
              </mesh>
            );
          })}
        </group>
      );
    }
    if (subSelectMode === "face") {
      return (
        <group {...baseProps}>
          {/* Top / bottom caps lie in the XY plane — circleGeometry default
              normal is +Z, perfect for Z-up cylinder. */}
          {["f_top", "f_bottom"].map((id) => {
            const z = id === "f_top" ? half : -half;
            const isPicked = subSelection?.kind === "face" && subSelection.id === id;
            const isHover = hoverId === id;
            const color = isPicked ? "#F97316" : isHover ? "#FB923C" : "#0EA5E9";
            return (
              <mesh
                key={id}
                position={[0, 0, z]}
                onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(id); }}
                onPointerOut={() => setHoverId((hh) => hh === id ? null : hh)}
                onClick={onPick("face", id)}
                renderOrder={1990}
              >
                <circleGeometry args={[r * 0.97, 48]} />
                <meshBasicMaterial color={color} transparent opacity={isPicked ? 0.45 : isHover ? 0.35 : 0.18} depthTest={false} side={THREE.DoubleSide} />
              </mesh>
            );
          })}
          {/* Side — drei cylinderGeometry has axis +Y; rotate to align with +Z. */}
          {(() => {
            const id = "f_side";
            const isPicked = subSelection?.kind === "face" && subSelection.id === id;
            const isHover = hoverId === id;
            const color = isPicked ? "#F97316" : isHover ? "#FB923C" : "#0EA5E9";
            return (
              <mesh
                key={id}
                rotation={[Math.PI / 2, 0, 0]}
                onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(id); }}
                onPointerOut={() => setHoverId((hh) => hh === id ? null : hh)}
                onClick={onPick("face", id)}
                renderOrder={1985}
              >
                <cylinderGeometry args={[r * 1.005, r * 1.005, h * 0.98, 48, 1, true]} />
                <meshBasicMaterial color={color} transparent opacity={isPicked ? 0.4 : isHover ? 0.3 : 0.15} depthTest={false} side={THREE.DoubleSide} />
              </mesh>
            );
          })()}
        </group>
      );
    }
  }

  // ── Cone: 1 edge (base ring), 2 faces (base + side) ──
  // Cone axis +Z, base at -Z/2.
  if (obj.type === "cone") {
    const r = obj.dims?.r || 10;
    const h = obj.dims?.h || 20;
    const half = h / 2;
    if (subSelectMode === "edge") {
      const ringR = Math.max(0.5, Math.min(1.0, r * 0.05));
      const id = "e_base";
      const isPicked = subSelection?.kind === "edge" && subSelection.id === id;
      const isHover = hoverId === id;
      const hasFillet = !!filletMap[id];
      const color = isPicked ? "#F97316" : isHover ? "#FB923C" : hasFillet ? "#22C55E" : "#94A3B8";
      return (
        <group {...baseProps}>
          <mesh
            position={[0, 0, -half]}
            onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(id); }}
            onPointerOut={() => setHoverId((hh) => hh === id ? null : hh)}
            onClick={onPick("edge", id)}
            renderOrder={2000}
          >
            <torusGeometry args={[r, ringR, 8, 48]} />
            <meshBasicMaterial color={color} transparent opacity={isPicked ? 1 : 0.85} depthTest={false} />
          </mesh>
        </group>
      );
    }
    if (subSelectMode === "face") {
      const baseId = "f_base", sideId = "f_side";
      const baseIsPicked = subSelection?.kind === "face" && subSelection.id === baseId;
      const sideIsPicked = subSelection?.kind === "face" && subSelection.id === sideId;
      const baseHover = hoverId === baseId, sideHover = hoverId === sideId;
      return (
        <group {...baseProps}>
          <mesh
            position={[0, 0, -half]}
            onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(baseId); }}
            onPointerOut={() => setHoverId((hh) => hh === baseId ? null : hh)}
            onClick={onPick("face", baseId)}
            renderOrder={1990}
          >
            <circleGeometry args={[r * 0.97, 48]} />
            <meshBasicMaterial color={baseIsPicked ? "#F97316" : baseHover ? "#FB923C" : "#0EA5E9"} transparent opacity={baseIsPicked ? 0.45 : baseHover ? 0.35 : 0.18} depthTest={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh
            rotation={[Math.PI / 2, 0, 0]}
            onPointerOver={(ev) => { ev.stopPropagation(); setHoverId(sideId); }}
            onPointerOut={() => setHoverId((hh) => hh === sideId ? null : hh)}
            onClick={onPick("face", sideId)}
            renderOrder={1985}
          >
            <coneGeometry args={[r * 1.005, h * 0.98, 48, 1, true]} />
            <meshBasicMaterial color={sideIsPicked ? "#F97316" : sideHover ? "#FB923C" : "#0EA5E9"} transparent opacity={sideIsPicked ? 0.4 : sideHover ? 0.3 : 0.15} depthTest={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    }
  }

  return null;
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
  // With DEFAULT_UP = +Z, a PlaneGeometry's default normal is +Z which
  // matches the desired "horizontal cutting plane" orientation. The
  // user's `cutPlane.rotation` then represents tilts on top of that.
  const planeGeom = useMemo(() => new THREE.PlaneGeometry(size, size), [size]);
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
          opacity={0.32}
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
        <lineBasicMaterial color="#fde047" linewidth={2} attach="material" />
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
  const snapScale = useScene((s) => s.snapScale);
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
      scaleSnap={snapEnabled ? snapScale : null}
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

// Iter-103 — "Faux" design plate.
//
// A user-defined modelling envelope (defaults 1 m × 1 m × 1 m, can go to a
// few meters per axis) rendered UNDER the real printer plate as a
// translucent dashed outline + secondary grid. Drawn so the printer
// plate stays the visually dominant surface (sharper colour, higher
// in the layer stack), but you can immediately see the boundary of
// "the big thing you're designing".
//
// Footprint is X (width) × Y (depth on the bed) and the height label
// (designPlate.z) is drawn floating above the back-left corner so users
// can confirm their modelling envelope without an extra dimension HUD.
function DesignPlate() {
  const designPlate = useScene((s) => s.designPlate);
  const gridVisible = useScene((s) => s.gridVisible);
  if (!designPlate || !designPlate.enabled) return null;
  const dx = Math.max(50, designPlate.x);
  const dy = Math.max(50, designPlate.y);
  const dz = Math.max(50, designPlate.z);

  // Slightly below the printer plate (Z=0) so the cyan perimeter isn't
  // z-fighting and the design plate reads as a separate, lower layer.
  const baseZ = -0.15;

  // Footprint on the XY plane. Half-extents for the boundary rectangle.
  const halfX = dx / 2, halfY = dy / 2;
  // Outline rectangle (closed) lies in the XY plane at Z = baseZ.
  const outline = [
    new THREE.Vector3(-halfX, -halfY, baseZ),
    new THREE.Vector3(+halfX, -halfY, baseZ),
    new THREE.Vector3(+halfX, +halfY, baseZ),
    new THREE.Vector3(-halfX, +halfY, baseZ),
    new THREE.Vector3(-halfX, -halfY, baseZ),
  ];

  // Vertical "envelope" wireframe to communicate the modelling
  // height (designPlate.z). 4 verticals + a top rectangle along +Z.
  const top = baseZ + dz;
  const verticals = [
    [new THREE.Vector3(-halfX, -halfY, baseZ), new THREE.Vector3(-halfX, -halfY, top)],
    [new THREE.Vector3(+halfX, -halfY, baseZ), new THREE.Vector3(+halfX, -halfY, top)],
    [new THREE.Vector3(+halfX, +halfY, baseZ), new THREE.Vector3(+halfX, +halfY, top)],
    [new THREE.Vector3(-halfX, +halfY, baseZ), new THREE.Vector3(-halfX, +halfY, top)],
  ];
  const topRect = [
    new THREE.Vector3(-halfX, -halfY, top),
    new THREE.Vector3(+halfX, -halfY, top),
    new THREE.Vector3(+halfX, +halfY, top),
    new THREE.Vector3(-halfX, +halfY, top),
    new THREE.Vector3(-halfX, -halfY, top),
  ];

  return (
    <group data-testid="design-plate">
      {/* Translucent floor on the XY plane (Z-up). PlaneGeometry's default
          normal is +Z so no rotation is needed here. */}
      <mesh position={[0, 0, baseZ]} receiveShadow={false}>
        <planeGeometry args={[dx, dy]} />
        <meshBasicMaterial color="#1E293B" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      {gridVisible && (
        <Grid
          args={[dx, dy]}
          position={[0, 0, baseZ + 0.01]}
          rotation={[Math.PI / 2, 0, 0]}
          cellSize={50}
          cellThickness={0.5}
          cellColor="#475569"
          sectionSize={500}
          sectionThickness={1}
          sectionColor="#22D3EE"
          fadeDistance={Math.max(dx, dy) * 2}
          infiniteGrid={false}
        />
      )}
      <Line points={outline} color="#22D3EE" lineWidth={1.5} dashed dashSize={6} gapSize={4} transparent opacity={0.85} />
      {verticals.map((seg, i) => (
        <Line key={`v-${i}`} points={seg} color="#22D3EE" lineWidth={1} dashed dashSize={6} gapSize={4} transparent opacity={0.55} />
      ))}
      <Line points={topRect} color="#22D3EE" lineWidth={1} dashed dashSize={6} gapSize={4} transparent opacity={0.55} />
      {gridVisible && (
        <Html position={[-halfX, halfY + 8, baseZ + 4]} center={false} zIndexRange={[18, 0]} sprite={false}>
          <div
            data-testid="design-plate-label"
            className="px-2 py-0.5 rounded bg-slate-950/85 border border-cyan-500/60 text-cyan-300 text-[11px] font-mono tracking-tight shadow-md whitespace-nowrap select-none"
            style={{ pointerEvents: "none" }}
          >
            {designPlate.name || "Design plate"}: {Math.round(dx)} × {Math.round(dy)} × {Math.round(dz)} mm
          </div>
        </Html>
      )}
    </group>
  );
}

function BuildPlate() {
  const buildVolume = useScene((s) => s.buildVolume);
  const gridVisible = useScene((s) => s.gridVisible);
  // Theme-aware grid colour (see Cartesian branch comment below).
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const { x, y, kinematics } = buildVolume;

  // Delta machines have a circular bed.
  if (kinematics === "delta") {
    const radius = Math.max(x, y) / 2;
    const ringPoints = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const a = (2 * Math.PI * i) / N;
      ringPoints.push(new THREE.Vector3(radius * Math.cos(a), radius * Math.sin(a), 0));
    }
    return (
      <group>
        {/* Solid dark disk on the XY plane (Z-up) just below Z=0 so the
            ring on top of it isn't z-fighting. */}
        <mesh receiveShadow position={[0, 0, -0.05]}>
          <circleGeometry args={[radius, 64]} />
          <meshStandardMaterial color="#0F172A" roughness={0.9} />
        </mesh>
        <Line
          points={ringPoints}
          color="#F97316"
          lineWidth={2}
          depthTest
          transparent={false}
        />
        {gridVisible && (
          <Html
            position={[0, radius + 6, 0.1]}
            center
            zIndexRange={[20, 0]}
            sprite={false}
          >
            <div
              data-testid="delta-plate-diameter-label"
              className="px-2 py-0.5 rounded bg-slate-950/85 border border-orange-500/60 text-orange-300 text-[11px] font-mono tracking-tight shadow-md whitespace-nowrap select-none"
              style={{ pointerEvents: "none" }}
            >
              Build diameter: {Math.round(radius * 2)}&nbsp;mm
            </div>
          </Html>
        )}
      </group>
    );
  }

  // Cartesian (default) — square/rectangular bed on the XY plane at Z=0.
  // drei's <Grid> renders its lines in the XZ plane natively; rotate by
  // +90° about X so the grid lies in the XY plane (normal = +Z).
  //
  // iter-108.x — Theme-aware minor cell colour. Before this change the
  // 5 mm cell colour was hard-coded to slate-700 (#334155) — which is
  // *exactly* the Dim viewport background, so the minor grid lines
  // vanished in Dim mode (only the 50 mm orange section lines stayed
  // visible). Now picks a per-theme tone that keeps comfortable
  // contrast against the bed mesh AND the surrounding canvas in every
  // theme. Section lines (orange) are theme-independent — they look
  // fine on all three backgrounds.
  const cellColor =
    resolvedTheme === "dim"   ? "#94A3B8" :   // slate-400 — bright enough to stand off slate-700 bg
    resolvedTheme === "light" ? "#475569" :   // slate-600 — readable on the slate-200 page
                                "#64748B";    // slate-500 — default dark theme
  return (
    <group>
      <mesh receiveShadow position={[0, 0, -0.05]}>
        <planeGeometry args={[x, y]} />
        <meshStandardMaterial color="#0F172A" roughness={0.9} />
      </mesh>
      {gridVisible && (
        <Grid
          args={[x, y]}
          position={[0, 0, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          cellSize={5}
          cellThickness={0.6}
          cellColor={cellColor}
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
  const unitSystem = useScene((s) => s.unitSystem);
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
        {(() => {
          const dp = unitSystem === "in" ? 3 : 1;
          const f = unitSystem === "in" ? 1 / 25.4 : 1;
          return `${(size.x * f).toFixed(dp)} × ${(size.y * f).toFixed(dp)} × ${(size.z * f).toFixed(dp)} ${unitSystem}`;
        })()}
      </span>
      <span className="text-slate-600">·</span>
      <span className="text-slate-400">{obj.name}</span>
    </div>
  );
}

// MeasurementsLayer is imported from ./viewport/MeasurementsOverlay
// (iter-87 extraction). The PendingMarker + MeasurementLine helpers
// it composes also live there now.

// ComponentDimensionsLayer + ComponentDimensionLine are imported from
// ./viewport/ComponentDimensionsOverlay (iter-87 extraction). They
// render the yellow dashed pair-lines + ΔX/ΔY/ΔZ chips.

// RulerAnchorLayer + PinnedRulerLayer + resolveSnapWorld are imported
// from ./viewport/RulerLayers (iter-90 extraction). The previous inline
// implementations lived here (~240 lines) and were lifted as-is with
// no behavioural changes.

// can never occlude the snap points the user is trying to measure. Shows
// anchor name / target name / snap-kind pills / axis-cycle / × controls
// all in a single panel pinned to the bottom-left of the viewport (just
// above the status bar). This was iteration 62-e: prior versions used
// BedAxisGizmo (iter-77) — small static axis indicator anchored to the
// bottom-left of the viewport. Shows the slicer-convention XYZ frame
// (Z = up = print direction) so users can sanity-check orientation
// after import and before slicing.
//
// Why a DOM overlay instead of a 3D triad inside the Canvas:
//   1. Always visible regardless of camera orbit / zoom level.
//   2. No risk of being occluded by scene geometry.
//   3. Zero runtime cost — pure CSS.
//   4. Doesn't need to track camera rotation; the bed axes don't
//      rotate with the camera (they're a property of the print frame,
//      not the view).
function BedAxisGizmo() {
  return (
    <div
      data-testid="bed-axis-gizmo"
      className="absolute bottom-3 left-3 z-10 pointer-events-none select-none"
      title="Print orientation — Z is up (height). Imported STL/OBJ/3MF files are auto-rotated to this frame."
    >
      <div className="flex items-end gap-1.5 px-2.5 py-1.5 bg-black/75 backdrop-blur-sm border border-slate-700/60 rounded">
        <svg width="42" height="42" viewBox="0 0 42 42" className="flex-shrink-0">
          {/* Origin point */}
          <circle cx="14" cy="30" r="1.5" fill="#94a3b8" />
          {/* X axis — right, rose */}
          <line x1="14" y1="30" x2="36" y2="30" stroke="#f87171" strokeWidth="1.6" markerEnd="url(#arr-x)" />
          <text x="38" y="33" fill="#f87171" fontSize="9" fontWeight="700" fontFamily="ui-monospace, monospace">X</text>
          {/* Y axis — back-right, emerald (a 30° diagonal for an isometric feel) */}
          <line x1="14" y1="30" x2="26" y2="20" stroke="#34d399" strokeWidth="1.6" markerEnd="url(#arr-y)" />
          <text x="27" y="18" fill="#34d399" fontSize="9" fontWeight="700" fontFamily="ui-monospace, monospace">Y</text>
          {/* Z axis — straight up, sky-blue */}
          <line x1="14" y1="30" x2="14" y2="8" stroke="#60a5fa" strokeWidth="1.6" markerEnd="url(#arr-z)" />
          <text x="9" y="9" fill="#60a5fa" fontSize="9" fontWeight="700" fontFamily="ui-monospace, monospace">Z</text>
          <defs>
            <marker id="arr-x" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 6 3 L 0 6 z" fill="#f87171" />
            </marker>
            <marker id="arr-y" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 6 3 L 0 6 z" fill="#34d399" />
            </marker>
            <marker id="arr-z" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 6 3 L 0 6 z" fill="#60a5fa" />
            </marker>
          </defs>
        </svg>
        <div className="flex flex-col leading-tight">
          <span className="text-[9px] uppercase tracking-wider text-slate-300 font-semibold">Print frame</span>
          <span className="text-[8px] font-mono text-sky-300">Z = up (height)</span>
        </div>
      </div>
    </div>
  );
}


// drei <Html> overlays welded to the world point and the user reported
// labels covering the very corners they wanted to measure.
function RulerScreenHud() {
  const mode = useScene((s) => s.rulerMode);
  const anchor = useScene((s) => s.rulerAnchor);
  const target = useScene((s) => s.rulerTarget);
  const axes = useScene((s) => s.rulerAxesMode);
  const snapKinds = useScene((s) => s.rulerSnapKinds);
  const pinned = useScene((s) => s.pinnedRulerDims);
  const clearRulerAnchor = useScene((s) => s.clearRulerAnchor);
  const clearRulerTarget = useScene((s) => s.clearRulerTarget);
  const cycleRulerAxes = useScene((s) => s.cycleRulerAxes);
  const toggleRulerSnapKind = useScene((s) => s.toggleRulerSnapKind);
  const pinRulerMeasurement = useScene((s) => s.pinRulerMeasurement);
  const clearPinnedRulerDims = useScene((s) => s.clearPinnedRulerDims);
  if (!mode || !anchor) return null;
  const pinnedCount = (pinned || []).length;
  return (
    <div
      data-testid="ruler-hud-stack"
      className="absolute top-1/2 -translate-y-1/2 left-[252px] z-20 flex flex-col items-start gap-1 select-none"
      style={{ pointerEvents: "auto" }}
    >
      <div
        data-testid="ruler-anchor-hud"
        className="flex items-center gap-1 px-2 py-1 bg-slate-950/95 border border-sky-400/70 rounded-md shadow-xl whitespace-nowrap"
      >
        <span className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">0.00</span>
        <span className="text-[10px] text-slate-400">·</span>
        <span className="text-[10px] text-slate-200 max-w-[14ch] truncate">{anchor.objName}</span>
        <span className="text-[8.5px] text-slate-500 ml-1">({anchor.snapKind})</span>
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
          <X size={11} />
        </button>
      </div>
      {target && (
        <div
          data-testid="ruler-target-hud"
          className="flex items-center gap-1 px-2 py-1 bg-slate-950/95 border border-amber-400/70 rounded-md shadow-xl whitespace-nowrap"
        >
          <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">to</span>
          <span className="text-[10px] text-slate-400">·</span>
          <span className="text-[10px] text-slate-200 max-w-[14ch] truncate">{target.objName}</span>
          <span className="text-[8.5px] text-slate-500 ml-1">({target.snapKind})</span>
          <button
            data-testid="ruler-pin-btn"
            onClick={(e) => { e.stopPropagation(); pinRulerMeasurement(); }}
            className="w-4 h-4 rounded-sm bg-slate-800 hover:bg-emerald-500/40 text-emerald-300 hover:text-white flex items-center justify-center"
            title="Pin this measurement — saves it as a persistent annotation and resets the target so you can pick another"
          >
            <Pin size={9} />
          </button>
          <button
            data-testid="ruler-clear-target-btn"
            onClick={(e) => { e.stopPropagation(); clearRulerTarget(); }}
            className="w-4 h-4 rounded-sm bg-slate-800 hover:bg-red-500/40 text-slate-400 hover:text-white flex items-center justify-center"
            title="Clear target — pick a new one"
          >
            <X size={10} />
          </button>
        </div>
      )}
      <div
        data-testid="ruler-snap-pills"
        className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-950/90 border border-sky-500/30 rounded-md shadow whitespace-nowrap text-[9px]"
      >
        <span className="text-slate-500 uppercase tracking-wider text-[8.5px]">Snap:</span>
        {["corner", "edge", "face", "center"].map((k) => {
          const on = (snapKinds || []).includes(k);
          return (
            <button
              key={k}
              data-testid={`ruler-snap-toggle-${k}`}
              onClick={(e) => { e.stopPropagation(); toggleRulerSnapKind(k); }}
              className={`px-1.5 py-0.5 rounded font-mono uppercase tracking-wider ${
                on ? "bg-sky-500/30 text-sky-100 border border-sky-400/60"
                   : "bg-slate-800/60 text-slate-500 border border-slate-700/60"
              }`}
              title={`Toggle snapping to ${k}s`}
            >
              {k.slice(0, 3)}
            </button>
          );
        })}
      </div>
      {pinnedCount > 0 && (
        <div
          data-testid="ruler-pinned-count"
          className="flex items-center gap-1 px-2 py-0.5 bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 text-[9.5px] rounded-md shadow"
        >
          <Pin size={9} />
          <span className="font-mono">{pinnedCount} pinned</span>
          <button
            data-testid="ruler-clear-pinned-btn"
            onClick={(e) => { e.stopPropagation(); clearPinnedRulerDims(); }}
            className="ml-1 w-3.5 h-3.5 rounded-sm bg-slate-800 hover:bg-red-500/40 text-slate-400 hover:text-white flex items-center justify-center"
            title="Clear all pinned measurements"
          >
            <X size={9} />
          </button>
        </div>
      )}
      {!target && (
        <div
          data-testid="ruler-pick-target-hint"
          className="px-2 py-1 bg-sky-950/95 border border-sky-500/40 text-sky-200 text-[10px] rounded-md shadow whitespace-nowrap"
          style={{ pointerEvents: "none" }}
        >
          Click a 2nd point (any part, even this one) to measure
        </div>
      )}
    </div>
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

// Frame-to-bbox listener — when something (e.g., the oversize-detection
// toast) dispatches `forgeslicer:frame-bbox` with `detail: { min, max }`,
// pan the OrbitControls target to the bbox centre and move the camera
// far enough out that the bbox plus a margin fits in view. Used so an
// AI-imported giant model is visible immediately, with the build plate
// looking small underneath it.
function FrameBboxListener() {
  const { camera, controls } = useThree();
  useEffect(() => {
    const onFrame = (e) => {
      const d = e?.detail || {};
      const { min, max } = d;
      if (!min || !max) return;
      const c = controls; // OrbitControls instance (makeDefault)
      if (!c || !camera) return;
      const cx = (min.x + max.x) / 2;
      const cy = (min.y + max.y) / 2;
      const cz = (min.z + max.z) / 2;
      const sx = max.x - min.x;
      const sy = max.y - min.y;
      const sz = max.z - min.z;
      // Distance: pick the largest axis size and back off so the bbox
      // occupies ~60% of the FOV. Add a small margin so the build plate
      // also fits in frame.
      const maxDim = Math.max(sx, sy, sz, 1);
      const fov = (camera.fov || 50) * (Math.PI / 180);
      const dist = (maxDim / Math.tan(fov / 2)) * 0.9 + 60;
      // Preserve the current view direction (offset from target).
      const dir = new THREE.Vector3().subVectors(camera.position, c.target).normalize();
      if (dir.lengthSq() < 1e-6) dir.set(1, 0.6, 1).normalize();
      c.target.set(cx, cy, cz);
      camera.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
      c.update();
    };
    window.addEventListener("forgeslicer:frame-bbox", onFrame);
    return () => window.removeEventListener("forgeslicer:frame-bbox", onFrame);
  }, [camera, controls]);
  return null;
}

// Iter-100.8 — reframe the camera whenever the user picks a different
// printer (and thus a different build-volume). Without this, switching
// from a Bambu A1 (256 mm cube) to an FLSUN V400 (300 mm × 410 mm) left
// the camera so close it only showed the lower half of the plate. We
// listen on `printerId` (not `buildVolume`) so that programmatic
// buildVolume tweaks elsewhere don't yank the user's view.
function CameraFitOnPrinterChange() {
  const { camera, controls } = useThree();
  const printerId = useScene((s) => s.printerId);
  const buildVolume = useScene((s) => s.buildVolume);
  useEffect(() => {
    if (!camera || !controls) return;
    const { x = 220, y = 220, z = 250 } = buildVolume || {};
    // Z-up: bed footprint is XY, build height is Z.
    const plate = Math.max(x, y);
    const fov = (camera.fov || 45) * (Math.PI / 180);
    const span = Math.hypot(plate, z * 0.6);
    const dist = (span / (2 * Math.tan(fov / 2))) * 1.25 + 30;
    // Preserve the user's current orbit direction if they've moved.
    let dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.7, -0.7, 0.55).normalize();
    // Aim slightly above the plate centre (Z above zero) — better
    // default framing than staring at Z=0.
    const targetZ = Math.min(z * 0.2, plate * 0.15);
    controls.target.set(0, 0, targetZ);
    camera.position.set(
      dir.x * dist,
      dir.y * dist,
      Math.max(dir.z * dist, plate * 0.35),
    );
    camera.updateProjectionMatrix();
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printerId, buildVolume?.x, buildVolume?.y, buildVolume?.z]);
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
  // Iter-113 — Snap-to-face placement mode.
  const placeOnFaceMode = useScene((s) => s.placeOnFaceMode);
  const setPlaceOnFaceMode = useScene((s) => s.setPlaceOnFaceMode);
  const updateObject = useScene((s) => s.updateObject);
  // Iter-114.2 — Workplane ruler placement. While `placing` is true,
  // the next click anywhere in the scene (workplane or face) drops
  // the ruler origin at that point. Snaps to the nearest snap point
  // on the clicked object via `nearestSnapPoint`.
  const workplaneRulerPlacing = useScene((s) => s.workplaneRuler?.placing);
  const placeWorkplaneRuler = useScene((s) => s.placeWorkplaneRuler);
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
      {placeOnFaceMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-black/85 border border-fuchsia-500/40 rounded text-[11px] font-mono text-fuchsia-300 pointer-events-none flex items-center gap-2" data-testid="place-on-face-hint">
          <span className="w-2 h-2 rounded-full bg-fuchsia-400 animate-pulse" />
          SNAP TO FACE — click any face on another object to land the selection on it (Esc to cancel)
        </div>
      )}
      {workplaneRulerPlacing && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-black/85 border border-orange-500/40 rounded text-[11px] font-mono text-orange-300 pointer-events-none flex items-center gap-2" data-testid="workplane-ruler-placing-hint">
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          PLACE RULER — click anywhere on the bed, or on any face / edge / vertex of an object (Esc to cancel)
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
      <RulerScreenHud />
      <BedAxisGizmo />
      <Canvas
        shadows
        camera={{ position: [220, -260, 200], up: [0, 0, 1], fov: 45, near: 0.1, far: 5000 }}
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
          position={[150, 100, 250]}
          intensity={1.0}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-100, -100, 120]} intensity={0.35} />

        <DesignPlate />
        <BuildPlate />
        <CameraFitOnPrinterChange />

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
              // Resolve to the assembly when the clicked child belongs to
              // a group — measures should snap to the outer corners of
              // the whole Fastener Pair / Slot / etc., not whichever sub-
              // mesh the cursor happened to land on.
              const probe = resolveSnapTargetForGroup(oo, objects);
              const cur = useScene.getState();
              const kinds = cur.rulerSnapKinds || ["corner", "edge", "face", "center"];
              const sp = nearestSnapPoint(probe, point, kinds);
              if (!sp) return;
              const snapRecord = {
                worldPoint: [sp.x, sp.y, sp.z],
                objId: probe.id || oo.id,
                objName: probe.name || oo.name || "Anchor",
                snapKey: sp.key,
                snapKind: sp.kind,
              };
              if (!cur.rulerAnchor) {
                setRulerAnchor(snapRecord);
                return;
              }
              if (cur.rulerAnchor.objId === snapRecord.objId &&
                  cur.rulerAnchor.snapKey === snapRecord.snapKey) {
                return;
              }
              setRulerTarget(snapRecord);
            }}
            placeOnFaceMode={placeOnFaceMode}
            onPlaceFaceHit={(hitPoint, worldNormal, hitObjId) => {
              // Compute placement against the CURRENTLY-selected object —
              // not the clicked target. The clicked face IS the surface
              // we're snapping ONTO. Refuse to place an object on itself.
              const sel = useScene.getState().objects.find((x) => x.id === selectedId);
              if (!sel || sel.id === hitObjId) return;
              const patch = computePlaceOnFace(sel, hitPoint, worldNormal);
              if (!patch) return;
              updateObject(sel.id, patch);
              // Single-shot: exit the mode after a successful placement.
              setPlaceOnFaceMode(false);
            }}
            workplaneRulerPlacing={workplaneRulerPlacing}
            onWorkplaneRulerPlace={(hitPoint, hitObjId) => {
              // Iter-114.2 — snap-to-snap-point on the clicked object's
              // 27-point grid (8 corners + 12 edge midpoints + 6 face
              // centres + 1 centre). Fallback: raw click point. The
              // anchor-ruler infrastructure (nearestSnapPoint) already
              // implements this picker; we reuse it for consistency.
              const obj = useScene.getState().objects.find((x) => x.id === hitObjId);
              let origin = [hitPoint.x, hitPoint.y, hitPoint.z];
              if (obj) {
                try {
                  const snap = nearestSnapPoint(obj, hitPoint);
                  if (snap) origin = [snap.x, snap.y, snap.z];
                } catch { /* fallback to raw hit */ }
              }
              placeWorkplaneRuler(origin);
            }}
            onContextMenu={handleContextMenu}
            scene={{ objects }}
          />
        ))}

        {/* Iter-114.2 — invisible workplane catch-plane. Renders only
            while the user is in ruler-placement mode and clicks on
            the BED (no object underneath). Bounded to the build
            volume so clicks outside still hit `onPointerMissed`. */}
        {workplaneRulerPlacing && (
          <mesh
            data-testid="workplane-ruler-placer-plane"
            position={[0, 0, 0.01]}
            onClick={(e) => {
              e.stopPropagation();
              placeWorkplaneRuler([e.point.x, e.point.y, 0]);
            }}
          >
            <planeGeometry args={[buildVolume.x * 2, buildVolume.y * 2]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}

        {!measureMode && !rulerMode && !placeOnFaceMode && !workplaneRulerPlacing && <SelectedTransform />}
        {/* Sub-element pick overlay: rendered ONLY for the currently-
            primary-selected object, and only when subSelectMode != "object".
            The overlay attaches its own click handlers so sub-pick clicks
            don't fall through to the underlying SceneObject mesh. */}
        {(() => {
          const sel = objects.find((o) => o.id === selectedId);
          if (!sel) return null;
          return <SubElementPickOverlay obj={sel} />;
        })()}
        <MeasurementsLayer />
        <ComponentDimensionsLayer />
        <RulerAnchorLayer />
        <PinnedRulerLayer />
        <SelectionDimLabels />
        <WorkplaneRuler />
        <PrintabilityOverlay />
        <CutPlaneGizmo />
        <CanvasBridge bridgeRef={bridgeRef} />
        <FrameBboxListener />

        <OrbitControls
          makeDefault
          enabled={!marquee}
          enableDamping
          dampingFactor={0.08}
          target={[0, 0, buildVolume.z / 4]}
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

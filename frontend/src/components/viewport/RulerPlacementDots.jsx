// TinkerCAD-parity ruler placement dots.
//
// While the user is in ruler-placement mode, every visible object's
// bbox corners light up as amber dots. Clicking a dot drops the
// workplane ruler exactly there. Clicking the bed or an object face
// still works via Viewport's fallback handlers — the dots are the
// precise "pick a vertex" affordance from TinkerCAD.
import React from "react";
import * as THREE from "three";
import { useScene } from "../../lib/store";
import { computeRotatedBBox } from "../../lib/geometry";

// Custom raycast that forces the target mesh to be picked BEFORE any
// other scene geometry. Critical for corner dots sitting flush on (or
// inside) mesh surfaces — vanilla raycast orders by distance, so the
// host mesh's onClick would fire first and stopPropagation before the
// dot ever receives the click.
export function priorityRaycast(raycaster, intersects) {
  const local = [];
  THREE.Mesh.prototype.raycast.call(this, raycaster, local);
  for (const hit of local) {
    hit.distance = -1e-4; // negative sorts absolutely first
    intersects.push(hit);
  }
}

export default function RulerPlacementDots() {
  const placing = useScene((s) => s.workplaneRuler?.placing);
  const objects = useScene((s) => s.objects);
  const placeWorkplaneRuler = useScene((s) => s.placeWorkplaneRuler);

  if (!placing) return null;

  const dots = [];
  for (const o of objects) {
    if (o.visible === false) continue;
    try {
      const bb = computeRotatedBBox(o);
      if (!Number.isFinite(bb.min.x)) continue;
      const [px, py, pz] = o.position || [0, 0, 0];
      const xs = [bb.min.x + px, bb.max.x + px];
      const ys = [bb.min.y + py, bb.max.y + py];
      const zs = [bb.min.z + pz, bb.max.z + pz];
      for (const x of xs) for (const y of ys) for (const z of zs) dots.push([x, y, z]);
    } catch { /* skip unmeasurable objects */ }
  }
  dots.push([0, 0, 0]); // workplane origin is always pickable
  const seen = new Set();
  const unique = dots.filter((p) => {
    const k = p.map((v) => Math.round(v * 10)).join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <group renderOrder={1004}>
      {unique.map((p, i) => (
        <mesh
          key={i}
          position={p}
          renderOrder={1004}
          raycast={priorityRaycast}
          onClick={(e) => {
            e.stopPropagation();
            placeWorkplaneRuler(p);
            document.body.style.cursor = "";
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "crosshair"; }}
          onPointerOut={() => { document.body.style.cursor = ""; }}
        >
          <sphereGeometry args={[2.6, 16, 16]} />
          <meshBasicMaterial color="#F59E0B" transparent opacity={0.95} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

// TinkerCAD-parity ruler placement dots + vertex probe dots.
//
// Two modes share this component:
//   1. PLACING mode — the user just clicked the workplane-ruler
//      toolbar button but hasn't committed an origin yet. Dots on all
//      bbox corners + top/bottom-center + face-centers light up.
//      Clicking a dot DROPS the ruler at that world position.
//
//   2. PROBING mode (iter-125.3) — the ruler is already active AND
//      the user clicked the "probe" (+) button in the ruler UI. Same
//      dot vocabulary lights up, but clicking a dot ADDS a persistent
//      probe (dashed line + 3D distance chip from ruler origin to the
//      picked point) instead of repositioning the ruler. Users can
//      stack probes on multiple vertices — e.g. measure a bed corner
//      to every vertex of a cantilevered assembly.
import React, { useState } from "react";
import { Billboard, Line } from "@react-three/drei";
import { useScene } from "../../lib/store";
import { computeRotatedBBox } from "../../lib/geometry";
import { priorityRaycast } from "../../lib/priorityRaycast";

// Re-export so existing imports keep working.
export { priorityRaycast };

export default function RulerPlacementDots() {
  const placing = useScene((s) => s.workplaneRuler?.placing);
  const probing = useScene((s) => s.workplaneRuler?.probing);
  const objects = useScene((s) => s.objects);
  const placeWorkplaneRuler = useScene((s) => s.placeWorkplaneRuler);
  const addProbe = useScene((s) => s.addWorkplaneRulerProbe);
  // iter-125.6 — hovered-dot index for the snap-to-vertex crosshair.
  // Only one dot is ever "hovered" at a time; storing the index (vs
  // an object identity) keeps the state cheap and re-renders local.
  const [hoveredIdx, setHoveredIdx] = useState(-1);

  if (!placing && !probing) return null;

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
      // 8 bbox corners
      for (const x of xs) for (const y of ys) for (const z of zs) dots.push([x, y, z]);
      // Center columns — top-center (cone tip / cyl top), bottom-center,
      // and mid-height center. iter-125.3 also adds face-centers on the
      // 4 side faces so users can measure "to the front face of the
      // cube" in one click, not just to corners.
      const cx = (bb.min.x + bb.max.x) * 0.5 + px;
      const cy = (bb.min.y + bb.max.y) * 0.5 + py;
      const cz = (bb.min.z + bb.max.z) * 0.5 + pz;
      dots.push([cx, cy, bb.max.z + pz]); // top-center
      dots.push([cx, cy, bb.min.z + pz]); // bottom-center
      dots.push([cx, cy, cz]);            // volume center
      // 4 side-face centers
      dots.push([bb.min.x + px, cy, cz]);
      dots.push([bb.max.x + px, cy, cz]);
      dots.push([cx, bb.min.y + py, cz]);
      dots.push([cx, bb.max.y + py, cz]);
      // 4 vertical-edge midpoints (very useful for cantilevered stacks)
      for (const x of xs) for (const y of ys) dots.push([x, y, cz]);
    } catch { /* skip unmeasurable objects */ }
  }
  if (placing) dots.push([0, 0, 0]); // workplane origin — only useful when placing

  const seen = new Set();
  const unique = dots.filter((p) => {
    const k = p.map((v) => Math.round(v * 10)).join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // iter-125.5 — user asked for ORANGE, small, and truly hollow.
  // Both modes now use the same orange color to stay visually
  // consistent with the ForgeSlicer accent. Placing vs probing is
  // distinguished by the toolbar button state (glowing cyan when
  // probing) and the ruler UI, not by dot color.
  const color = "#F97316";

  return (
    <group renderOrder={1004}>
      {/* iter-125.6 — snap-to-vertex crosshair. Rendered ONLY on the
          currently-hovered dot so users get an unmistakable "you are
          snapped to a discrete vertex" affordance (rather than a
          smooth continuous surface pick). Four short line segments
          form a "+" that outer-wraps the hover dot. Uses Billboard
          so the crosshair stays camera-facing at all rotations. */}
      {hoveredIdx >= 0 && hoveredIdx < unique.length && (
        <Billboard position={unique[hoveredIdx]} follow>
          <Line
            points={[[-3.2, 0, 0], [-1.6, 0, 0]]}
            color={color}
            lineWidth={2}
            depthTest={false}
            transparent
            opacity={1}
          />
          <Line
            points={[[1.6, 0, 0], [3.2, 0, 0]]}
            color={color}
            lineWidth={2}
            depthTest={false}
            transparent
            opacity={1}
          />
          <Line
            points={[[0, -3.2, 0], [0, -1.6, 0]]}
            color={color}
            lineWidth={2}
            depthTest={false}
            transparent
            opacity={1}
          />
          <Line
            points={[[0, 1.6, 0], [0, 3.2, 0]]}
            color={color}
            lineWidth={2}
            depthTest={false}
            transparent
            opacity={1}
          />
        </Billboard>
      )}
      {unique.map((p, i) => (
        <Billboard key={i} position={p} follow>
          {/* Tiny invisible hit-target so click detection still works;
              its `priorityRaycast` overrides ensure it wins over the
              underlying object geometry (see priorityRaycast.js). */}
          <mesh
            renderOrder={1004}
            raycast={priorityRaycast}
            onClick={(e) => {
              e.stopPropagation();
              if (probing) {
                addProbe(p);
              } else {
                placeWorkplaneRuler(p);
              }
              document.body.style.cursor = "";
              setHoveredIdx(-1);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = "crosshair";
              setHoveredIdx(i);
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
              setHoveredIdx((prev) => (prev === i ? -1 : prev));
            }}
          >
            {/* Flat plane sized to the hit area — invisible material,
                only its bounds matter for raycasting. */}
            <planeGeometry args={[2.4, 2.4]} />
            <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
          </mesh>
          {/* Visible hollow ring — always faces the camera thanks to
              the enclosing <Billboard>, so it reads as a clean unfilled
              circle from every angle. innerRadius/outerRadius chosen
              so the ring is 0.4 mm thick at 1.2 mm outer diameter. */}
          <mesh renderOrder={1005}>
            <ringGeometry args={[0.8, 1.2, 24]} />
            <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} side={2} />
          </mesh>
        </Billboard>
      ))}
    </group>
  );
}

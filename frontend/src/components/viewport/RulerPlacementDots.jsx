// Iter-126 — Ruler hover-preview ring.
//
// REPLACES the old 21-dot cloud (iter-125.x). Users reported the cloud
// overwhelmed complex drawings — even a modest scene with 4 components
// lit up 80+ orange rings that made the viewport unusable.
//
// New UX (agreed with user):
//   • No pre-rendered snap dots.
//   • As the user moves the cursor over a mesh with ANY ruler mode
//     active (anchored ruler `rulerMode`, or workplane-ruler placing
//     / probing), a SINGLE preview ring appears at the point that
//     WOULD be committed on click.
//   • Snap hierarchy is vertex > edge > body-centre (see
//     `smartSnapForClick` in lib/rulerAnchor.js).
//
// Hover state is written to the store by SceneObject.onPointerMove
// (see Viewport.jsx), so this component is a dumb reader that renders
// one ring at `rulerHoverSnap.worldPoint`.
//
// The `priorityRaycast` re-export is kept because other modules still
// import it from this path (was originally colocated with the cloud).
import React from "react";
import { Billboard, Line } from "@react-three/drei";
import { useScene } from "../../lib/store";
import { priorityRaycast } from "../../lib/priorityRaycast";

// Re-export so existing imports keep working.
export { priorityRaycast };

export default function RulerPlacementDots() {
  const placing = useScene((s) => s.workplaneRuler?.placing);
  const probing = useScene((s) => s.workplaneRuler?.probing);
  const rulerMode = useScene((s) => s.rulerMode);
  const hoverSnap = useScene((s) => s.rulerHoverSnap);

  // Hide everything unless SOME ruler mode is active. This also means
  // the hover ring only renders when the user is actively measuring —
  // no leftover ghost dots after the tool is closed.
  const active = !!(placing || probing || rulerMode);
  if (!active) return null;
  if (!hoverSnap || !hoverSnap.worldPoint) return null;

  const color = "#F97316"; // ForgeSlicer accent orange
  const p = hoverSnap.worldPoint;
  // Ring gets slightly larger for less-precise snaps so the user can
  // tell at a glance what kind of point they've locked onto:
  //   corner → tight ring (1.0 mm outer)
  //   edge   → medium (1.4 mm)
  //   center → loose (1.8 mm)
  const kind = hoverSnap.snapKind || "corner";
  const ringOuter = kind === "corner" ? 1.0 : kind === "edge" ? 1.4 : 1.8;
  const ringInner = ringOuter - 0.4;

  return (
    <group renderOrder={1004} raycast={priorityRaycast}>
      <Billboard position={p} follow>
        {/* Camera-facing crosshair for the extra-clear "you are locked
            onto a snap" affordance the user asked for in the plan. */}
        <Line
          points={[[-3.2, 0, 0], [-1.6, 0, 0]]}
          color={color} lineWidth={2} depthTest={false} transparent opacity={1}
        />
        <Line
          points={[[1.6, 0, 0], [3.2, 0, 0]]}
          color={color} lineWidth={2} depthTest={false} transparent opacity={1}
        />
        <Line
          points={[[0, -3.2, 0], [0, -1.6, 0]]}
          color={color} lineWidth={2} depthTest={false} transparent opacity={1}
        />
        <Line
          points={[[0, 1.6, 0], [0, 3.2, 0]]}
          color={color} lineWidth={2} depthTest={false} transparent opacity={1}
        />
        {/* Hollow ring — sized by snap kind. NOTE: no data-testid here
            because react-three-fiber rejects DOM attributes on scene
            primitives ("Cannot set data-testid" runtime error). Tests
            can read `useScene.getState().rulerHoverSnap.snapKind`
            instead (exposed via window.__forgeStore in dev/test). */}
        <mesh renderOrder={1005}>
          <ringGeometry args={[ringInner, ringOuter, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} side={2} />
        </mesh>
      </Billboard>
    </group>
  );
}

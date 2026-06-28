// Viewport overlay for Pre-flight Printability findings.
//
// Renders inside the R3F Canvas (siblings to MeasurementsLayer). Draws
// the highlight geometry of every visible finding as faint dashed
// lines, then promotes the currently-hovered finding to a brighter
// solid stroke so the user can pinpoint the offending region without
// hunting through hundreds of edges.
//
// iter-108.x ships highlights of `type:"edges"` only (Check #1's open
// /T-junction edges). Future checks that need face overlays can
// register additional `highlight.type` branches here.

import React, { useMemo } from "react";
import * as THREE from "three";
import { usePrintability } from "../lib/printabilityStore";

const HOVER_COLOR = "#ef4444";     // red-500 — pops on both light & dark viewports
const QUIET_COLOR = "#f97316";     // orange-500 — matches the brand accent

function EdgeSegments({ positions, color, opacity, depthTest }) {
  // Memoise the BufferGeometry so React doesn't allocate a fresh GPU
  // buffer on every render. The array reference from runAllChecks is
  // stable per recheck() call, so memoising on identity is correct.
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  return (
    <lineSegments geometry={geom} renderOrder={999}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={depthTest}
        linewidth={2}
      />
    </lineSegments>
  );
}

export default function PrintabilityOverlay() {
  const findings = usePrintability((s) => s.findings);
  const hoveredId = usePrintability((s) => s.hoveredFindingId);
  const panelOpen = usePrintability((s) => s.panelOpen);

  // Stay invisible when the panel isn't open — the highlights would be
  // confusing in a "I haven't asked for this" context.
  if (!panelOpen || findings.length === 0) return null;

  return (
    <group data-testid="printability-overlay">
      {findings.map((f) => {
        const positions = f?.highlight?.positions;
        if (!positions || positions.length === 0) return null;
        if (f.highlight.type !== "edges") return null;
        const isHovered = f.id === hoveredId;
        return (
          <EdgeSegments
            key={f.id}
            positions={positions}
            color={isHovered ? HOVER_COLOR : QUIET_COLOR}
            opacity={isHovered ? 0.95 : 0.35}
            depthTest={!isHovered}
          />
        );
      })}
    </group>
  );
}

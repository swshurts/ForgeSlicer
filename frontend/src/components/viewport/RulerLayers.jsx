// Iter-90 — Anchored Ruler overlay extracted from Viewport.jsx.
//
// Three components:
//   - RulerAnchorLayer : the live anchor-to-target measurement with
//                        bed-wide axis rays + L-bracket segments + ΔX
//                        / ΔY / ΔZ axis labels (~115 lines)
//   - resolveSnapWorld : helper that re-resolves a saved snap-point's
//                        CURRENT world position from the live scene
//   - PinnedRulerLayer : every saved measurement in `pinnedRulerDims`,
//                        rendered with muted colours so the user can
//                        tell live vs pinned at a glance
//
// Lifted as-is — no behavioural changes. The unused RulerOffsetChip
// stub was also dropped since nothing was importing it.
import React from "react";
import { Html, Line } from "@react-three/drei";
import { X } from "lucide-react";
import { useScene } from "../../lib/store";
import { fmtSignedMm } from "../../lib/componentDimensions";
import { allSnapPoints, resolveSnapTargetForGroup } from "../../lib/rulerAnchor";

// ---- Anchored Ruler overlay (TinkerCAD-style) ----
// Renders three blue dashed axis-rays from the anchor world-point out to
// the build-plate edges (filtered by rulerAxesMode), a glowing dot at the
// origin with a "0.00" label, and one signed-offset chip per other visible
// scene object. The chips track the nearest-corner of each object so the
// reading matches the TinkerCAD UX: "this part is +12 mm to the right of
// my anchor." Everything is recomputed every render from the live store,
// so dragging a part updates its chip in real time.
export function RulerAnchorLayer() {
  const mode = useScene((s) => s.rulerMode);
  const anchor = useScene((s) => s.rulerAnchor);
  const target = useScene((s) => s.rulerTarget);
  const axes = useScene((s) => s.rulerAxesMode);
  const buildVolume = useScene((s) => s.buildVolume);
  if (!mode || !anchor) return null;
  const [ax, ay, az] = anchor.worldPoint;
  const halfX = (buildVolume?.x || 220) / 2;
  const halfZ = (buildVolume?.z || 220) / 2;
  const maxY = buildVolume?.y || 250;
  const showX = axes === "xyz" || axes === "x";
  const showY = axes === "xyz" || axes === "y";
  const showZ = axes === "xyz" || axes === "z";
  // Endpoint coordinates: target if present, else fallback to anchor
  // (so the bed-wide axis lines still draw with no target).
  const tx = target ? target.worldPoint[0] : ax;
  const ty = target ? target.worldPoint[1] : ay;
  const tz = target ? target.worldPoint[2] : az;
  const dx = tx - ax;
  const dy = ty - ay;
  const dz = tz - az;
  return (
    <group>
      {/* === Bed-wide axis scale === */}
      {showX && (
        <Line points={[[-halfX, ay, az], [halfX, ay, az]]}
          color="#38BDF8" lineWidth={1.2} dashed dashSize={3} gapSize={2} depthTest={false} opacity={0.3} transparent />
      )}
      {showY && (
        <Line points={[[ax, 0, az], [ax, maxY, az]]}
          color="#38BDF8" lineWidth={1.2} dashed dashSize={3} gapSize={2} depthTest={false} opacity={0.3} transparent />
      )}
      {showZ && (
        <Line points={[[ax, ay, -halfZ], [ax, ay, halfZ]]}
          color="#38BDF8" lineWidth={1.2} dashed dashSize={3} gapSize={2} depthTest={false} opacity={0.3} transparent />
      )}
      {/* === Anchor + target markers === */}
      <mesh position={[ax, ay, az]} renderOrder={1001}>
        <sphereGeometry args={[1.8, 24, 24]} />
        <meshBasicMaterial color="#38BDF8" depthTest={false} />
      </mesh>
      {target && (
        <mesh position={[tx, ty, tz]} renderOrder={1001}>
          <sphereGeometry args={[1.8, 24, 24]} />
          <meshBasicMaterial color="#F59E0B" depthTest={false} />
        </mesh>
      )}
      {/* === L-bracket axis segments anchor → target === */}
      {target && showX && Math.abs(dx) > 0.001 && (
        <Line points={[[ax, ay, az], [tx, ay, az]]} color="#FB7185" lineWidth={2} depthTest={false} />
      )}
      {target && showY && Math.abs(dy) > 0.001 && (
        <Line points={[[tx, ay, az], [tx, ty, az]]} color="#34D399" lineWidth={2} depthTest={false} />
      )}
      {target && showZ && Math.abs(dz) > 0.001 && (
        <Line points={[[tx, ty, az], [tx, ty, tz]]} color="#FBBF24" lineWidth={2} depthTest={false} />
      )}
      {target && showX && Math.abs(dx) > 0.001 && (
        <Html position={[(ax + tx) / 2, ay - 6, az + 6]} center zIndexRange={[80, 0]} sprite={false}>
          <div
            data-testid="ruler-dim-x"
            className="font-mono text-[11px] font-semibold whitespace-nowrap select-none"
            style={{ pointerEvents: "none", color: "#fff", textShadow: "0 0 3px #0008, 0 1px 1px #000c" }}
          >
            <span style={{ color: "#FB7185", marginRight: 3 }}>•</span>{fmtSignedMm(dx)}
          </div>
        </Html>
      )}
      {target && showY && Math.abs(dy) > 0.001 && (
        <Html position={[tx + (dx >= 0 ? 8 : -8), (ay + ty) / 2, az - 6]} center zIndexRange={[80, 0]} sprite={false}>
          <div
            data-testid="ruler-dim-y"
            className="font-mono text-[11px] font-semibold whitespace-nowrap select-none"
            style={{ pointerEvents: "none", color: "#fff", textShadow: "0 0 3px #0008, 0 1px 1px #000c" }}
          >
            <span style={{ color: "#34D399", marginRight: 3 }}>•</span>{fmtSignedMm(dy)}
          </div>
        </Html>
      )}
      {target && showZ && Math.abs(dz) > 0.001 && (
        <Html position={[tx + (dx >= 0 ? 8 : -8), ty + 8, (az + tz) / 2]} center zIndexRange={[80, 0]} sprite={false}>
          <div
            data-testid="ruler-dim-z"
            className="font-mono text-[11px] font-semibold whitespace-nowrap select-none"
            style={{ pointerEvents: "none", color: "#fff", textShadow: "0 0 3px #0008, 0 1px 1px #000c" }}
          >
            <span style={{ color: "#FBBF24", marginRight: 3 }}>•</span>{fmtSignedMm(dz)}
          </div>
        </Html>
      )}
    </group>
  );
}

// Re-resolve a snap-point record's CURRENT world position from the live
// scene state. Used by PinnedRulerLayer so saved measurements track
// moving parts. Returns null when the source object has been removed —
// the cascade cleanup in the store will already have pruned the entry,
// but we still defensive-check here for the one-frame race between
// store update and render.
export function resolveSnapWorld(snapRec, allObjects) {
  if (!snapRec) return null;
  let probe = allObjects.find((o) => o.id === snapRec.objId);
  if (!probe) {
    const sibling = allObjects.find((o) => o.groupId === snapRec.objId);
    if (sibling) probe = resolveSnapTargetForGroup(sibling, allObjects);
  } else if (probe.groupId) {
    probe = resolveSnapTargetForGroup(probe, allObjects);
  }
  if (!probe) return null;
  const pts = allSnapPoints(probe);
  return pts.find((p) => p.key === snapRec.snapKey) || null;
}

// Pinned-measurement render layer — one L-bracket per saved entry,
// drawn with slightly muted colours so the user can tell live vs pinned
// at a glance. Each pin gets its own × button beside the longest axis
// label so it can be removed individually.
export function PinnedRulerLayer() {
  const pinned = useScene((s) => s.pinnedRulerDims);
  const objects = useScene((s) => s.objects);
  const removePinned = useScene((s) => s.removePinnedRulerDim);
  if (!pinned || pinned.length === 0) return null;
  return (
    <group>
      {pinned.map((dim) => {
        const aPt = resolveSnapWorld(dim.anchor, objects);
        const tPt = resolveSnapWorld(dim.target, objects);
        if (!aPt || !tPt) return null;
        const dx = tPt.x - aPt.x;
        const dy = tPt.y - aPt.y;
        const dz = tPt.z - aPt.z;
        return (
          <group key={dim.id}>
            <mesh position={[aPt.x, aPt.y, aPt.z]} renderOrder={998}>
              <sphereGeometry args={[1.2, 16, 16]} />
              <meshBasicMaterial color="#0EA5E9" depthTest={false} />
            </mesh>
            <mesh position={[tPt.x, tPt.y, tPt.z]} renderOrder={998}>
              <sphereGeometry args={[1.2, 16, 16]} />
              <meshBasicMaterial color="#D97706" depthTest={false} />
            </mesh>
            {Math.abs(dx) > 0.001 && (
              <Line points={[[aPt.x, aPt.y, aPt.z], [tPt.x, aPt.y, aPt.z]]} color="#BE123C" lineWidth={1.5} depthTest={false} />
            )}
            {Math.abs(dy) > 0.001 && (
              <Line points={[[tPt.x, aPt.y, aPt.z], [tPt.x, tPt.y, aPt.z]]} color="#047857" lineWidth={1.5} depthTest={false} />
            )}
            {Math.abs(dz) > 0.001 && (
              <Line points={[[tPt.x, tPt.y, aPt.z], [tPt.x, tPt.y, tPt.z]]} color="#B45309" lineWidth={1.5} depthTest={false} />
            )}
            {Math.abs(dx) > 0.001 && (
              <Html position={[(aPt.x + tPt.x) / 2, aPt.y - 6, aPt.z + 6]} center zIndexRange={[80, 0]} sprite={false}>
                <div
                  data-testid={`pinned-dim-x-${dim.id}`}
                  className="font-mono text-[10.5px] font-semibold whitespace-nowrap select-none"
                  style={{ pointerEvents: "none", color: "#fff", textShadow: "0 0 3px #0008, 0 1px 1px #000c" }}
                >
                  <span style={{ color: "#FB7185", marginRight: 3 }}>•</span>{fmtSignedMm(dx)}
                </div>
              </Html>
            )}
            {Math.abs(dy) > 0.001 && (
              <Html position={[tPt.x + (dx >= 0 ? 8 : -8), (aPt.y + tPt.y) / 2, aPt.z - 6]} center zIndexRange={[80, 0]} sprite={false}>
                <div
                  data-testid={`pinned-dim-y-${dim.id}`}
                  className="font-mono text-[10.5px] font-semibold whitespace-nowrap select-none"
                  style={{ pointerEvents: "none", color: "#fff", textShadow: "0 0 3px #0008, 0 1px 1px #000c" }}
                >
                  <span style={{ color: "#34D399", marginRight: 3 }}>•</span>{fmtSignedMm(dy)}
                </div>
              </Html>
            )}
            {Math.abs(dz) > 0.001 && (
              <Html position={[tPt.x + (dx >= 0 ? 8 : -8), tPt.y + 8, (aPt.z + tPt.z) / 2]} center zIndexRange={[80, 0]} sprite={false}>
                <div
                  data-testid={`pinned-dim-z-${dim.id}`}
                  className="font-mono text-[10.5px] font-semibold whitespace-nowrap select-none"
                  style={{ pointerEvents: "none", color: "#fff", textShadow: "0 0 3px #0008, 0 1px 1px #000c" }}
                >
                  <span style={{ color: "#FBBF24", marginRight: 3 }}>•</span>{fmtSignedMm(dz)}
                </div>
              </Html>
            )}
            <Html position={[tPt.x, tPt.y, tPt.z]} center zIndexRange={[85, 0]} sprite={false}>
              <button
                data-testid={`pinned-dim-close-${dim.id}`}
                onClick={(e) => { e.stopPropagation(); removePinned(dim.id); }}
                className="translate-x-3 -translate-y-3 w-4 h-4 rounded-sm bg-slate-800/95 hover:bg-red-500/60 text-slate-300 hover:text-white flex items-center justify-center border border-slate-700"
                style={{ pointerEvents: "auto" }}
                title="Remove this pinned measurement"
              >
                <X size={9} />
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

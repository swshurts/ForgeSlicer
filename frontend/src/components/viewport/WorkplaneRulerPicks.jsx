// Iter-114.5 — TinkerCAD-style pick-a-point measurements anchored to
// the workplane ruler origin.
//
// Renders:
//   • Small translucent snap dots on the 27-point grid of the
//     CURRENTLY SELECTED object whenever the workplane ruler is
//     active. Clicking a dot adds a persistent pick measurement.
//   • For each pick: a dashed blue leader line from the ruler origin
//     to the picked point, plus four chips —
//       ΔX, ΔY, ΔZ (offsets along each axis from ruler origin)
//       D     (diagonal Euclidean distance)
//   • A small × button on each pick chip to remove it individually.
//
// All chips use the same translucent white styling as
// SelectionDimLabels for visual coherence.
import React from "react";
import { Html, Line } from "@react-three/drei";
import { X } from "lucide-react";
import { useScene } from "../../lib/store";
import { computeRotatedBBox } from "../../lib/geometry";
import { toDisplayLen } from "../../lib/units";

const COLOR_X = "#E11D48";
const COLOR_Y = "#059669";
const COLOR_Z = "#2563EB";
const COLOR_D = "#475569"; // slate-600 — diagonal distance is "neutral"
const PICK_LINE = "#3B82F6"; // blue-500 — TinkerCAD leader-line colour

function fmtSigned(mm, system, dp) {
  const v = toDisplayLen(mm, system);
  const sign = v >= 0 ? "" : "−";
  return `${sign}${Math.abs(v).toFixed(dp)}`;
}

/**
 * Compute the candidate snap points for a given object's world bbox.
 * Iter-114.6 reduces the picker set from 27 → 14 (8 corners + 6 face
 * centres) per user feedback that small primitives like cones became
 * unreadably busy. Edge midpoints + body centre are dropped — corners
 * cover the common case, face centres handle thickness picks.
 */
function objectSnapPoints(obj) {
  if (!obj) return [];
  try {
    const bb = computeRotatedBBox(obj);
    if (!Number.isFinite(bb.min.x)) return [];
    const px = obj.position?.[0] || 0;
    const py = obj.position?.[1] || 0;
    const pz = obj.position?.[2] || 0;
    const x0 = bb.min.x + px, x1 = bb.max.x + px;
    const y0 = bb.min.y + py, y1 = bb.max.y + py;
    const z0 = bb.min.z + pz, z1 = bb.max.z + pz;
    const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2, zm = (z0 + z1) / 2;
    const xs = [x0, x1], ys = [y0, y1], zs = [z0, z1];
    const pts = [];
    // 8 corners.
    for (const x of xs) for (const y of ys) for (const z of zs) {
      pts.push({ p: [x, y, z], kind: "corner" });
    }
    // 6 face centres.
    for (const x of xs) pts.push({ p: [x, ym, zm], kind: "face" });
    for (const y of ys) pts.push({ p: [xm, y, zm], kind: "face" });
    for (const z of zs) pts.push({ p: [xm, ym, z], kind: "face" });
    return pts;
  } catch { return []; }
}

/**
 * Small translucent dots rendered on every snap point of the
 * currently selected object. Clicking a dot drops a persistent pick
 * measurement anchored to that point relative to the ruler origin.
 */
function SnapDots({ selectedObj, addRulerPick }) {
  if (!selectedObj) return null;
  const pts = objectSnapPoints(selectedObj);
  if (!pts.length) return null;
  return (
    <group renderOrder={1004}>
      {pts.map((entry, i) => (
        <mesh
          key={i}
          position={entry.p}
          renderOrder={1004}
          onClick={(e) => {
            e.stopPropagation();
            addRulerPick(entry.p, { snapKind: entry.kind, objId: selectedObj.id });
          }}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "crosshair"; }}
          onPointerOut={() => { document.body.style.cursor = ""; }}
        >
          <sphereGeometry args={[1.8, 16, 16]} />
          <meshBasicMaterial
            color={entry.kind === "corner" ? "#F59E0B" : "#C084FC"}
            transparent
            opacity={0.95}
            depthTest={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Renders a single persistent pick:
 *   • Blue dashed leader line from ruler origin to the picked point.
 *   • A small dot at the picked point.
 *   • Four chips floating beside the point: ΔX, ΔY, ΔZ, D.
 *   • × button to remove this pick.
 */
function PickMeasurement({ origin, pick, unitSystem, onRemove }) {
  const [px, py, pz] = pick.point;
  const [ox, oy, oz] = origin;
  const dx = px - ox;
  const dy = py - oy;
  const dz = pz - oz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const dp = unitSystem === "in" ? 3 : 2;

  return (
    <group>
      {/* Leader line origin → picked point */}
      <Line
        points={[[ox, oy, oz], [px, py, pz]]}
        color={PICK_LINE}
        lineWidth={1.3}
        dashed
        dashSize={2}
        gapSize={1.5}
        depthTest={false}
        transparent
        opacity={0.75}
      />
      {/* Dot at the picked point */}
      <mesh position={pick.point} renderOrder={1005}>
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshBasicMaterial color={PICK_LINE} depthTest={false} />
      </mesh>
      {/* Chips cluster */}
      <Html position={pick.point} center zIndexRange={[71, 0]} sprite={false}>
        <div
          data-testid={`ruler-pick-${pick.id}`}
          style={{
            transform: "translate(18px, -28px)",
            pointerEvents: "auto",
            background: "rgba(255,255,255,0.84)",
            border: `1px solid ${PICK_LINE}80`,
            color: "#0F172A",
            boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
            minWidth: 96,
          }}
          className="rounded font-mono text-[10.5px] font-semibold select-none p-1 leading-tight"
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-500">Pick</span>
            <button
              data-testid={`ruler-pick-remove-${pick.id}`}
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-slate-400 hover:text-red-500 -mr-0.5"
              title="Remove this measurement"
            >
              <X size={10} />
            </button>
          </div>
          <div className="flex justify-between gap-2">
            <span style={{ color: COLOR_X }} className="font-bold">ΔX</span>
            <span>{fmtSigned(dx, unitSystem, dp)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span style={{ color: COLOR_Y }} className="font-bold">ΔY</span>
            <span>{fmtSigned(dy, unitSystem, dp)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span style={{ color: COLOR_Z }} className="font-bold">ΔZ</span>
            <span>{fmtSigned(dz, unitSystem, dp)}</span>
          </div>
          <div className="flex justify-between gap-2 border-t border-slate-300 mt-0.5 pt-0.5">
            <span style={{ color: COLOR_D }} className="font-bold">D</span>
            <span>{toDisplayLen(dist, unitSystem).toFixed(dp)} {unitSystem}</span>
          </div>
        </div>
      </Html>
    </group>
  );
}

export default function WorkplaneRulerPicks() {
  const workplaneRuler = useScene((s) => s.workplaneRuler);
  const rulerPicks = useScene((s) => s.rulerPicks || []);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const unitSystem = useScene((s) => s.unitSystem);
  const addRulerPick = useScene((s) => s.addRulerPick);
  const removeRulerPick = useScene((s) => s.removeRulerPick);
  const measureMode = useScene((s) => s.measureMode);
  const rulerMode = useScene((s) => s.rulerMode);
  const cutMode = useScene((s) => s.cutMode);
  const placeOnFaceMode = useScene((s) => s.placeOnFaceMode);

  if (!workplaneRuler?.active) return null;
  if (measureMode || rulerMode || cutMode || placeOnFaceMode) return null;

  const selectedObj = objects.find((o) => o.id === selectedId);
  const origin = workplaneRuler.origin;

  return (
    <group>
      <SnapDots selectedObj={selectedObj} addRulerPick={addRulerPick} />
      {rulerPicks.map((p) => (
        <PickMeasurement
          key={p.id}
          origin={origin}
          pick={p}
          unitSystem={unitSystem}
          onRemove={() => removeRulerPick(p.id)}
        />
      ))}
    </group>
  );
}

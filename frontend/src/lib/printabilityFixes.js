// Maps a Finding.fixes[].id to an async action. Keeps the panel
// component free of any business logic — it just calls `runFix(scene,
// finding, fixId)`.
//
// iter-108 — shipped repair + silence (Check #1).
// iter-109 — adds:
//   • drop-to-bed   (Check #4 floating parts)
//   • scale-to-fit  (Check #6 build-volume violations)
//   • scale-up      (Check #7 very small features — scale uniformly so
//                    shortest dim hits the 1 mm safe-print minimum)
//   • select-pair   (Check #5 intersecting geometry — select the two
//                    so the user can hit the Union toolbar button)
//   • auto-orient   (Check #3 overhangs — rotate so the largest flat
//                    face sits on the bed)

import * as THREE from "three";
import { toast } from "sonner";
import { repairImportedObject } from "./meshRepairApi";
import { useScene } from "./store";
import { usePrintability } from "./printabilityStore";
import { computeRotatedBBox, buildGeometry } from "./geometry";

const SAFE_PRINT_MIN_MM = 1.0;

function getObj(finding, requireType = null) {
    const objId = finding.affectedObjectIds?.[0];
    const obj = useScene.getState().objects.find((o) => o.id === objId);
    if (!obj) throw new Error("That object is no longer in the scene.");
    if (requireType && obj.type !== requireType) {
        throw new Error(`This fix only works on ${requireType} meshes.`);
    }
    return obj;
}

/** Sample the geometry and return the world-space normal of the
 *  triangle with the largest area. Used by auto-orient to figure out
 *  which face deserves to be on the bed. */
function dominantFlatNormal(obj) {
    const g = buildGeometry(obj);
    try {
        const pos = g.getAttribute("position");
        const idx = g.index;
        const n = idx ? idx.count : pos.count;
        const get = (i) => idx ? idx.getX(i) : i;
        const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
        const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
        // Bucket near-coplanar triangles by their normal direction; the
        // bucket with the most cumulative area wins. This makes a
        // 100-segment cylinder cap beat a single large but unique
        // slanted triangle on the side.
        const buckets = new Map();
        for (let t = 0; t < n; t += 3) {
            va.fromBufferAttribute(pos, get(t));
            vb.fromBufferAttribute(pos, get(t + 1));
            vc.fromBufferAttribute(pos, get(t + 2));
            ab.subVectors(vb, va);
            ac.subVectors(vc, va);
            cross.crossVectors(ab, ac);
            const area = cross.length() * 0.5;
            if (area < 1e-6) continue;
            cross.divideScalar(area * 2);
            // Quantise normals to 5° buckets so coplanar tris merge.
            const qx = Math.round(cross.x * 20);
            const qy = Math.round(cross.y * 20);
            const qz = Math.round(cross.z * 20);
            const key = `${qx},${qy},${qz}`;
            buckets.set(key, (buckets.get(key) || 0) + area);
        }
        let best = null, bestArea = 0;
        for (const [key, area] of buckets) {
            if (area > bestArea) { bestArea = area; best = key; }
        }
        if (!best) return null;
        const [qx, qy, qz] = best.split(",").map(Number);
        return new THREE.Vector3(qx / 20, qy / 20, qz / 20).normalize();
    } finally {
        g.dispose();
    }
}

/** Execute a fix against the scene. Returns a Promise that resolves
 *  when the fix completes (so callers can show spinners). Throws on
 *  user-facing failures with a friendly message. */
export async function runFix(finding, fixId) {
    const fix = (finding.fixes || []).find((f) => f.id === fixId);
    if (!fix) throw new Error(`Unknown fix id: ${fixId}`);

    if (fix.kind === "silence") {
        usePrintability.getState().silence(finding.id);
        return;
    }

    switch (fix.id) {
        // -------- Check #1: Non-manifold / open geometry ----------------
        case "repair": {
            const obj = getObj(finding, "imported");
            toast.loading("Repairing mesh on the server…", { id: "repair-toast" });
            try {
                const { update, stats } = await repairImportedObject(obj);
                useScene.getState().updateObject(obj.id, update);
                const fullyHealed = stats.watertight && stats.windingConsistent;
                const triBefore = stats.inputTris || 0;
                const triAfter = stats.outputTris || 0;
                const elapsed = (stats.elapsedSec || 0).toFixed(1);
                toast.success(
                    fullyHealed
                        ? `Repair complete · ${triAfter.toLocaleString()} tris · ${elapsed}s`
                        : `Repair done · ${triBefore.toLocaleString()} → ${triAfter.toLocaleString()} tris · ${elapsed}s — re-check for residual defects.`,
                    { id: "repair-toast" },
                );
            } catch (e) {
                toast.error(e.message || String(e), { id: "repair-toast" });
                throw e;
            }
            return;
        }

        // -------- Check #3: Overhangs ------------------------------------
        case "auto-orient": {
            const obj = getObj(finding);
            const n = dominantFlatNormal(obj);
            if (!n) {
                toast.error("Couldn't find a flat face to orient.");
                return;
            }
            // Apply the object's existing rotation to the local
            // normal, then compute the rotation that maps that
            // world-normal onto -Z (face-down on the bed).
            const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                THREE.MathUtils.degToRad(obj.rotation[0]),
                THREE.MathUtils.degToRad(obj.rotation[1]),
                THREE.MathUtils.degToRad(obj.rotation[2]),
            ));
            const worldNormal = n.clone().applyQuaternion(q0);
            const target = new THREE.Vector3(0, 0, -1);
            const correction = new THREE.Quaternion().setFromUnitVectors(worldNormal, target);
            const final = correction.multiply(q0);
            const e = new THREE.Euler().setFromQuaternion(final);
            useScene.getState().updateObject(obj.id, {
                rotation: [
                    THREE.MathUtils.radToDeg(e.x),
                    THREE.MathUtils.radToDeg(e.y),
                    THREE.MathUtils.radToDeg(e.z),
                ],
            });
            // Drop to bed so the newly-flat face touches Z=0.
            useScene.getState().dropToBed(obj.id);
            toast.success("Reoriented so the largest flat face sits on the bed.");
            return;
        }

        // -------- Check #4: Floating parts -------------------------------
        case "drop-to-bed": {
            const obj = getObj(finding);
            useScene.getState().dropToBed(obj.id);
            toast.success("Dropped to bed.");
            return;
        }

        // -------- Check #5: Intersecting geometry ------------------------
        case "select-pair": {
            const [aId, bId] = finding.affectedObjectIds || [];
            if (!aId || !bId) throw new Error("Couldn't find the overlapping pair.");
            useScene.setState({ selectedId: bId, selectedIds: [aId, bId] });
            usePrintability.getState().setPanelOpen(false);
            toast.success("Selected both parts — click Union (∪) in the toolbar to merge.");
            return;
        }

        // -------- Check #6: Build-volume violations ----------------------
        case "scale-to-fit": {
            const r = useScene.getState().resizeSceneToBed({ targetFraction: 0.95 });
            if (!r?.ok) {
                toast.warning(r?.reason || "Couldn't scale the scene.");
                return;
            }
            toast.success(`Scaled scene to fit (${(r.scaleFactor * 100).toFixed(0)}%).`);
            return;
        }

        // -------- Check #7: Very small features --------------------------
        case "scale-up": {
            const obj = getObj(finding);
            // Find the shortest current world dimension; multiply
            // scale so that hits SAFE_PRINT_MIN_MM.
            const bb = computeRotatedBBox(obj);
            const size = {
                x: bb.max.x - bb.min.x,
                y: bb.max.y - bb.min.y,
                z: bb.max.z - bb.min.z,
            };
            const shortest = Math.min(size.x, size.y, size.z);
            if (shortest <= 0) {
                toast.error("This part has zero extent — can't scale.");
                return;
            }
            const factor = Math.max(1, SAFE_PRINT_MIN_MM / shortest);
            const sc = obj.scale || [1, 1, 1];
            useScene.getState().updateObject(obj.id, {
                scale: [sc[0] * factor, sc[1] * factor, sc[2] * factor],
            });
            useScene.getState().dropToBed(obj.id);
            toast.success(`Scaled up by ${factor.toFixed(2)}× to ${SAFE_PRINT_MIN_MM} mm minimum.`);
            return;
        }

        default:
            throw new Error(`Unsupported fix kind: ${fix.id}`);
    }
}

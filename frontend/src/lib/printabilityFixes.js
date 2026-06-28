// Maps a Finding.fixes[].id to an async action. Keeps the panel
// component free of any business logic — it just calls `runFix(scene,
// finding, fixId)`. iter-108.x supports only the "repair" fix (Check
// #1); future checks register additional fix kinds here.

import { toast } from "sonner";
import { repairImportedObject } from "./meshRepairApi";
import { useScene } from "./store";
import { usePrintability } from "./printabilityStore";

/** Execute a fix against the scene. Returns a Promise resolved when
 *  the fix completes (so callers can show spinners). Throws on
 *  user-facing failures with a friendly message. */
export async function runFix(finding, fixId) {
    const fix = (finding.fixes || []).find((f) => f.id === fixId);
    if (!fix) throw new Error(`Unknown fix id: ${fixId}`);

    if (fix.kind === "silence") {
        usePrintability.getState().silence(finding.id);
        return;
    }

    if (fix.id === "repair") {
        // Look up the live scene object — the finding only stores its id,
        // so the actual mesh might have been edited since detection.
        const objId = finding.affectedObjectIds?.[0];
        const obj = useScene.getState().objects.find((o) => o.id === objId);
        if (!obj || obj.type !== "imported") {
            throw new Error("The mesh to repair is no longer in the scene.");
        }
        toast.loading("Repairing mesh on the server…", { id: "repair-toast" });
        try {
            const { update, stats } = await repairImportedObject(obj);
            useScene.getState().updateObject(obj.id, update);
            const fullyHealed = stats.watertight && stats.windingConsistent;
            const triBefore = stats.inputTris || 0;
            const triAfter = stats.outputTris || 0;
            const elapsed = (stats.elapsedSec || 0).toFixed(1);
            if (fullyHealed) {
                toast.success(
                    `Repair complete · ${triAfter.toLocaleString()} tris · ${elapsed}s`,
                    { id: "repair-toast" },
                );
            } else {
                // PyMeshFix ran and reduced defects, but trimesh's
                // post-check still finds residual non-manifold edges
                // (common on AI/photogrammetry meshes with degenerate
                // slivers). The mesh has been rebuilt and re-checked
                // is wired below — frame it as success-with-caveat
                // rather than a generic warning so the user knows the
                // repair pass did its job.
                toast.success(
                    `Repair done · ${triBefore.toLocaleString()} → ${triAfter.toLocaleString()} tris · ${elapsed}s — re-check for residual defects.`,
                    { id: "repair-toast" },
                );
            }
        } catch (e) {
            toast.error(e.message || String(e), { id: "repair-toast" });
            throw e;
        }
        return;
    }

    throw new Error(`Unsupported fix kind: ${fix.id}`);
}

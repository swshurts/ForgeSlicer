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
            const ok = stats.watertight && stats.windingConsistent;
            toast[ok ? "success" : "warning"](
                ok
                    ? `Repair complete · ${stats.outputTris.toLocaleString()} tris · ${stats.elapsedSec.toFixed(1)}s`
                    : "Repair partially completed — some defects remained. Consider simplifying the source mesh.",
                { id: "repair-toast" },
            );
        } catch (e) {
            toast.error(e.message || String(e), { id: "repair-toast" });
            throw e;
        }
        return;
    }

    throw new Error(`Unsupported fix kind: ${fix.id}`);
}

// Iter-114 — Imported-mesh tools cluster.
//
// Extracted from RightPanel.jsx during the refactor. Encapsulates:
//   • Repair Mesh (server-side MeshLab) — the long-standing button.
//   • Fillet / Chamfer Mesh (Manifold Minkowski) — new in iter-114.
//
// Owns its own busy / dialog-open state. The parent Inspector only
// needs to render this with the current `obj` and the
// `updateObject` action; everything else is self-contained.
import React, { useState } from "react";
import { Loader2, Wrench, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useScene } from "../../lib/store";
import { repairImportedObject } from "../../lib/meshRepairApi";
import MeshFilletDialog from "../dialogs/MeshFilletDialog";

export default function MeshImportTools({ obj }) {
  const updateObject = useScene((s) => s.updateObject);
  const [repairBusy, setRepairBusy] = useState(false);
  const [meshFilletOpen, setMeshFilletOpen] = useState(false);

  if (obj?.type !== "imported" || !obj.geometry) return null;

  const handleRepairMesh = async () => {
    if (repairBusy) return;
    setRepairBusy(true);
    const t0 = performance.now();
    try {
      const { update, stats } = await repairImportedObject(obj);
      updateObject(obj.id, update);
      const totalElapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const { inputTris, outputTris, elapsedSec, watertight, windingConsistent } = stats;
      if (watertight && windingConsistent) {
        toast.success(
          `Mesh repaired & watertight — ${inputTris | 0} → ${outputTris | 0} tris (MeshFix ${elapsedSec.toFixed(1)}s, total ${totalElapsed}s)`,
          { duration: 6000 },
        );
      } else {
        const issues = [];
        if (!watertight) issues.push("still has open edges");
        if (!windingConsistent) issues.push("inconsistent face winding");
        toast.warning(
          `Mesh partially repaired — ${inputTris | 0} → ${outputTris | 0} tris, but ${issues.join(" and ")}. Boolean cuts may still drop. Try simplifying the mesh first.`,
          { duration: 10000 },
        );
      }
    } catch (err) {
      toast.error(`Repair failed: ${err.message || err}`, { duration: 6000 });
    } finally {
      setRepairBusy(false);
    }
  };

  return (
    <div className="space-y-1.5" data-testid="repair-mesh-block">
      <button
        data-testid="repair-mesh-btn"
        onClick={handleRepairMesh}
        disabled={repairBusy}
        className="w-full h-8 bg-emerald-600/90 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-emerald-400/40"
        title="Repair this mesh via MeshLab (same engine as Microsoft 3D Builder). Closes holes, fixes non-manifold edges & vertices, removes duplicates. Use when STL Preview warned that a Boolean cut was dropped because the host is non-manifold. Typical round-trip: 5–20 seconds."
      >
        {repairBusy ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
        {repairBusy ? "Repairing via MeshLab…" : "Repair Mesh"}
      </button>
      <button
        data-testid="fillet-mesh-btn"
        onClick={() => setMeshFilletOpen(true)}
        disabled={repairBusy}
        className="w-full h-8 bg-orange-600/90 hover:bg-orange-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-orange-400/40"
        title="Fillet or Chamfer every edge of this mesh using a rolling ball (Manifold Minkowski). Outer rounds convex edges, Inner rounds concave corners. Slow on large meshes."
      >
        <Sparkles size={13} />
        Fillet / Chamfer Mesh…
      </button>
      <p className="text-[10px] text-slate-500 leading-snug">
        Server-side MeshLab repair. Closes hairline holes, fixes non-manifold edges and vertices, and removes duplicate geometry. Use this when STL Preview reports a dropped Boolean cut.
      </p>
      <MeshFilletDialog
        open={meshFilletOpen}
        onClose={() => setMeshFilletOpen(false)}
        objectId={obj.id}
      />
    </div>
  );
}

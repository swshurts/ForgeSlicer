// iter-128 — ForgeSlicerSendButton merged in-tree.
//
// Iter-151.33 — Ship the 3MF (not the STL) so the per-tone
// `<basematerials>` displaycolor survives the hand-off. STL is a
// flat single-color mesh — everything the palette optimiser did
// (which filament prints which layer, tone-swap heights, auto-pause
// metadata) is lost. The 3MF export from the studio carries a
// multi-object envelope where each tone is its own <object> with its
// own hex color, so we route the download through
// `import3MFFileMulti` and drop each tone onto the buildplate with
// its display color set. That way the workspace outliner still
// reads "Litho tone 1 / tone 2 / …" and the pristine 3MF bytes are
// stashed so Send-to-OrcaSlicer round-trips the full palette.

import React, { useState } from "react";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";
import { downloadLithoFile } from "../../../lib/lithoStudioApi";
import { import3MFFileMulti, importAnyMeshFile } from "../../../lib/exporters";
import { useScene } from "../../../lib/store";

export function ForgeSlicerSendButton({
  jobId,
  disabled,
  printerId,
  part = "lithophane",
  filename = "lithophane",
  onSent,
}) {
  const [busy, setBusy] = useState(false);
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const setPristineImport = useScene((s) => s.setPristineImport);

  const handleSend = async () => {
    if (!jobId || busy) return;
    setBusy(true);
    try {
      // Ask the studio's export endpoint for the multi-material 3MF —
      // that's the only format that preserves the palette + swap
      // heights + per-tone displaycolor that the optimiser produced.
      const blob = await downloadLithoFile(jobId, "3mf", { printer: printerId });
      const cleanName = (filename?.replace(/\.[^.]+$/, "") || "lithophane") + "_" + part + ".3mf";
      const file = new File([blob], cleanName, { type: "model/3mf" });

      // Stash the pristine bytes so Send-to-OrcaSlicer can round-trip
      // the full 3MF envelope (basematerials, pauses, metadata) rather
      // than re-emitting from the workspace's decomposed meshes.
      try {
        const buf = await blob.arrayBuffer();
        setPristineImport(new Uint8Array(buf), cleanName);
      } catch { /* non-fatal — pristine slot is a performance perk, not required */ }

      // Multi-object 3MF path: each tone becomes its own Outliner row
      // with the correct color chip, ready for chamfer / boolean /
      // mounting-plaque operations.
      let added = 0;
      try {
        const multi = await import3MFFileMulti(file);
        multi.objects.forEach((o) => {
          addImportedMesh(o.name, o.vertices, o.indices, o.originalBbox, {
            customColor: o.displaycolor || undefined,
            materialName: o.materialName || undefined,
          });
          added += 1;
        });
      } catch (multiErr) {
        // Single-object fallback (rare — happens if the export is a
        // single-tone painting or a bas-relief-style flat mesh).
        const mesh = await importAnyMeshFile(file);
        addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
        added = 1;
      }

      toast.success(
        added > 1 ? `Sent ${added} tones to the build plate` : "Sent to build plate",
        { description: cleanName },
      );
      // Close the LithoStudio modal so the user lands directly on the
      // workspace with the freshly-imported meshes selected and ready
      // for fillets / chamfers / mounting-plaque booleans.
      if (typeof onSent === "function") onSent();
    } catch (e) {
      toast.error("Send to workspace failed", { description: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleSend}
      disabled={disabled || busy || !jobId}
      data-testid="litho-send-to-forgeslicer-btn"
      className="h-9 px-3 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow disabled:opacity-40 disabled:cursor-not-allowed"
      title="Send this lithophane onto the ForgeSlicer build plate"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
      {busy ? "Sending…" : "Send to Build Plate"}
    </button>
  );
}

export default ForgeSlicerSendButton;

// iter-128 — ForgeSlicerSendButton merged in-tree.
//
// LithoForge's original button POSTed the finished 3MF to a separate
// ForgeSlicer instance via the cross-app inbox API. Now that the
// pipeline is a single app, this component pulls the STL/3MF from the
// studio export endpoint and imports it directly onto the ForgeSlicer
// build plate using the same `importAnyMeshFile` pipeline as drag-and-
// drop. Modal closes and the mesh is selected + inspectable.
//
// Iter-151.32 — Wired props correctly. StatsPanel used to pass
// `{result, geometry, boxDiffuser}` which left `jobId` undefined and
// silently disabled the button. Now takes `jobId` + `printerId` + an
// optional `onSent` callback so LithoStudio can dismiss the modal and
// drop the user back onto the buildplate as soon as the mesh lands.

import React, { useState } from "react";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";
import { downloadLithoFile } from "../../../lib/lithoStudioApi";
import { importAnyMeshFile } from "../../../lib/exporters";
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

  const handleSend = async () => {
    if (!jobId || busy) return;
    setBusy(true);
    try {
      const blob = await downloadLithoFile(jobId, "stl", { printer: printerId });
      const cleanName = (filename?.replace(/\.[^.]+$/, "") || "lithophane") + "_" + part + ".stl";
      const file = new File([blob], cleanName, { type: "model/stl" });
      const mesh = await importAnyMeshFile(file);
      addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
      toast.success("Sent to build plate", { description: cleanName });
      // Close the LithoStudio modal so the user lands directly on the
      // workspace with the freshly-imported mesh selected and ready
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

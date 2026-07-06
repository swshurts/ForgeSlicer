// iter-128 — ForgeSlicerSendButton merged in-tree.
//
// LithoForge's original button POSTed the finished 3MF to a separate
// ForgeSlicer instance via the cross-app inbox API. Now that the
// pipeline is a single app, this component pulls the STL/3MF from the
// studio export endpoint and imports it directly onto the ForgeSlicer
// build plate using the same `importAnyMeshFile` pipeline as drag-and-
// drop. Modal closes and the mesh is selected + inspectable.

import React, { useState } from "react";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";
import { downloadLithoFile } from "../../../lib/lithoStudioApi";
import { importAnyMeshFile } from "../../../lib/exporters";
import { useScene } from "../../../lib/store";
import { useNavigate } from "react-router-dom";

export function ForgeSlicerSendButton({ jobId, disabled, printerId, part = "lithophane", filename = "lithophane" }) {
  const [busy, setBusy] = useState(false);
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const navigate = useNavigate();

  const handleSend = async () => {
    if (!jobId || busy) return;
    setBusy(true);
    try {
      const blob = await downloadLithoFile(jobId, "stl", { printer: printerId });
      const cleanName = (filename?.replace(/\.[^.]+$/, "") || "lithophane") + "_" + part + ".stl";
      const file = new File([blob], cleanName, { type: "model/stl" });
      const mesh = await importAnyMeshFile(file);
      addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
      toast.success("Sent to build plate", {
        description: cleanName,
        action: { label: "Open", onClick: () => navigate("/workspace") },
      });
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

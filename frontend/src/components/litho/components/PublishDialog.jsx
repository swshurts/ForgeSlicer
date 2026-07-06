// iter-128 — PublishDialog stub.
//
// The marketplace publishing flow ships in Phase 2 of the merge. For
// now, the Publish button in JobHistory opens a friendly "coming soon"
// toast instead of the full dialog. This lets the rest of the studio
// (config, palette, timeline, export, history) run without pulling in
// the marketplace backend which is still in Phase 2 scope.
import React from "react";
import { toast } from "sonner";

export function PublishDialog({ open, onClose }) {
  React.useEffect(() => {
    if (!open) return;
    toast.info("Marketplace launches in Phase 2", {
      description: "Publish, browse, and buy lithophanes is coming next iteration.",
      duration: 5000,
    });
    onClose?.();
  }, [open, onClose]);
  return null;
}

export default PublishDialog;

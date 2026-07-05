// Slice module — print-prep scaffold. Slicing today lives in the
// Design workspace ("Send to Slicer" / OrcaSlicer hand-off); this tab
// is where a dedicated slice/preview surface will live.
import React from "react";
import { Layers } from "lucide-react";
import ModuleShell, { ComingSoon } from "./ModuleShell";

export default function SlicePage() {
  return (
    <ModuleShell title="Slice" subtitle="Prepare & slice for printing">
      <ComingSoon
        icon={Layers}
        title="Dedicated slicing workspace"
        blurb="Slicing currently runs inside the Design workspace via “Send to Slicer” (OrcaSlicer / Bambu / Prusa hand-off) and the built-in browser slicer. This tab will graduate that into a first-class module."
        points={[
          "Layer preview & travel-move inspection",
          "Per-object process & filament assignment",
          "Print-time and material-cost estimates",
          "One-click hand-off to the Production queue",
        ]}
      />
    </ModuleShell>
  );
}

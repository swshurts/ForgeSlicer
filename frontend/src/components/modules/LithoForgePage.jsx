// LithoForge module — companion app (photo → lithophane) that will be
// imported in-process as a module. For now this is a visual scaffold
// describing the integration.
import React from "react";
import { Image as ImageIcon, UploadCloud } from "lucide-react";
import ModuleShell, { ComingSoon } from "./ModuleShell";

export default function LithoForgePage() {
  return (
    <ModuleShell title="LithoForge" subtitle="Photo → lithophane · companion module">
      <div className="max-w-3xl mx-auto px-6 pt-10">
        <div className="rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/50 py-12 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center mb-4">
            <UploadCloud size={26} className="text-sky-300" />
          </div>
          <div className="text-sm font-semibold text-white">Drop a photo to forge a lithophane</div>
          <div className="text-xs text-slate-400 mt-1">
            LithoForge converts images into printable lithophane models, then hands them straight to Design & Slice.
          </div>
        </div>
      </div>
      <ComingSoon
        icon={ImageIcon}
        title="LithoForge is coming in-app"
        blurb="LithoForge is a separate creation being merged into ForgeSlicer as a native module (it already exchanges models with Design via the LithoForge hand-off). This tab will host the full photo-to-lithophane workflow."
        points={[
          "Image → height-map → watertight lithophane mesh",
          "Curved, flat & lamp-shade presets",
          "Send the result straight into the Design workspace",
          "Shared accounts, library & billing with ForgeSlicer",
        ]}
      />
    </ModuleShell>
  );
}

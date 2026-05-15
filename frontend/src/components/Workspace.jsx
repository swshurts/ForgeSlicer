import React, { useState } from "react";
import TopToolbar from "./TopToolbar";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import StatusBar from "./StatusBar";
import Viewport from "./Viewport";
import { ShareDialog, OrcaDialog, SavePrinterDialog } from "./Dialogs";

export default function Workspace() {
  const [shareOpen, setShareOpen] = useState(false);
  const [orcaOpen, setOrcaOpen] = useState(false);
  const [targetSlicer, setTargetSlicer] = useState(null);
  const [savePrinterOpen, setSavePrinterOpen] = useState(false);

  const handleSendTo = (slicer) => {
    setTargetSlicer(slicer);
    setOrcaOpen(true);
  };

  return (
    <div
      className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden"
      style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      data-testid="workspace"
    >
      <TopToolbar onShare={() => setShareOpen(true)} onSendToOrca={handleSendTo} />
      <div className="flex-1 flex overflow-hidden">
        <LeftPanel />
        <main className="flex-1 relative overflow-hidden bg-slate-800" data-testid="viewport-main">
          <Viewport />
        </main>
        <RightPanel onSavePrinter={() => setSavePrinterOpen(true)} />
      </div>
      <StatusBar />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      <OrcaDialog open={orcaOpen} onClose={() => setOrcaOpen(false)} targetSlicer={targetSlicer} />
      <SavePrinterDialog open={savePrinterOpen} onClose={() => setSavePrinterOpen(false)} />
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import TopToolbar from "./TopToolbar";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import StatusBar from "./StatusBar";
import Viewport from "./Viewport";
import { ShareDialog, OrcaDialog, SavePrinterDialog } from "./Dialogs";
import { useScene } from "../lib/store";
import { importSTLFile } from "../lib/exporters";
import { API } from "../lib/api";

export default function Workspace() {
  const [shareOpen, setShareOpen] = useState(false);
  const [orcaOpen, setOrcaOpen] = useState(false);
  const [targetSlicer, setTargetSlicer] = useState(null);
  const [savePrinterOpen, setSavePrinterOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const remixId = searchParams.get("remix");
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const setProjectName = useScene((s) => s.setProjectName);
  const setRemixOf = useScene((s) => s.setRemixOf);

  // Load remix STL when ?remix=<id> is present
  useEffect(() => {
    let cancelled = false;
    if (!remixId) return;
    (async () => {
      try {
        const res = await fetch(`${API}/gallery/${remixId}/download`);
        if (!res.ok) throw new Error("Could not fetch remix source");
        const blob = await res.blob();
        const filename = (res.headers.get("Content-Disposition") || "")
          .match(/filename="([^"]+)"/)?.[1] || "remix.stl";
        const file = new File([blob], filename, { type: "model/stl" });
        const mesh = await importSTLFile(file);
        if (cancelled) return;
        addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
        setProjectName(`Remix of ${mesh.name}`);
        setRemixOf(remixId);
        // Clear the query param so a refresh doesn't re-import
        setSearchParams({}, { replace: true });
      } catch (e) {
        console.warn("Remix load failed:", e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remixId]);

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

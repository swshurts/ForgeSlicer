import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import TopToolbar from "./TopToolbar";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import StatusBar from "./StatusBar";
import Viewport from "./Viewport";
import { ShareDialog, OrcaDialog, SavePrinterDialog } from "./Dialogs";
import { useScene } from "../lib/store";
import { importSTLFile, importAnyMeshFile } from "../lib/exporters";
import { takePendingImport } from "../lib/pendingImport";
import { API } from "../lib/api";

export default function Workspace() {
  const [shareOpen, setShareOpen] = useState(false);
  const [orcaOpen, setOrcaOpen] = useState(false);
  const [targetSlicer, setTargetSlicer] = useState(null);
  const [savePrinterOpen, setSavePrinterOpen] = useState(false);
  const [importBanner, setImportBanner] = useState(null); // { kind, message }
  const [searchParams, setSearchParams] = useSearchParams();
  const remixId = searchParams.get("remix");
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const setProjectName = useScene((s) => s.setProjectName);
  const setRemixOf = useScene((s) => s.setRemixOf);

  // Load a file handed off from the Landing page (one-shot).
  useEffect(() => {
    const file = takePendingImport();
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const mesh = await importAnyMeshFile(file);
        if (cancelled) return;
        addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
        setProjectName(mesh.name);
        setImportBanner({
          kind: "ok",
          message: `Imported "${file.name}" — ready to edit.`,
        });
        setTimeout(() => setImportBanner(null), 4000);
      } catch (e) {
        if (cancelled) return;
        setImportBanner({
          kind: "err",
          message: `Could not import "${file.name}": ${e.message || e}`,
        });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {importBanner && (
        <div
          data-testid="import-banner"
          className={`fixed bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-md border shadow-lg text-sm z-50 flex items-center gap-3 ${
            importBanner.kind === "ok"
              ? "bg-green-500/10 border-green-500/50 text-green-200"
              : "bg-red-500/10 border-red-500/50 text-red-200"
          }`}
        >
          <span>{importBanner.message}</span>
          {importBanner.kind === "err" && (
            <button
              data-testid="import-banner-dismiss"
              onClick={() => setImportBanner(null)}
              className="text-[11px] underline hover:text-white"
            >
              dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}

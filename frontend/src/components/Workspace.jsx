import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import TopToolbar from "./TopToolbar";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import StatusBar from "./StatusBar";
import Viewport from "./Viewport";
import { ShareDialog, OrcaDialog, SavePrinterDialog, SaveComponentDialog } from "./Dialogs";
import { useScene } from "../lib/store";
import { importSTLFile, importAnyMeshFile } from "../lib/exporters";
import { computeRotatedBBox } from "../lib/geometry";
import { takePendingImport } from "../lib/pendingImport";
import { API } from "../lib/api";

export default function Workspace() {
  const [shareOpen, setShareOpen] = useState(false);
  const [orcaOpen, setOrcaOpen] = useState(false);
  const [targetSlicer, setTargetSlicer] = useState(null);
  const [savePrinterOpen, setSavePrinterOpen] = useState(false);
  const [saveComponentOpen, setSaveComponentOpen] = useState(false);
  const [importBanner, setImportBanner] = useState(null); // { kind, message }
  const [searchParams, setSearchParams] = useSearchParams();

  // Voice command may emit a "forgeslicer:open-dialog" event to open a named
  // dialog (e.g. user says "save as component").
  useEffect(() => {
    const handler = (e) => {
      const name = e?.detail?.name;
      if (name === "save_component") setSaveComponentOpen(true);
      else if (name === "share_gallery") setShareOpen(true);
      else if (name === "slicer") setOrcaOpen(true);
    };
    window.addEventListener("forgeslicer:open-dialog", handler);
    return () => window.removeEventListener("forgeslicer:open-dialog", handler);
  }, []);

  const remixId = searchParams.get("remix");
  const addComponentParam = searchParams.get("addComponent");
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const addRawObject = useScene((s) => s.addRawObject);
  const setProjectName = useScene((s) => s.setProjectName);
  const setRemixOf = useScene((s) => s.setRemixOf);
  const loadProject = useScene((s) => s.loadProject);
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const serialize = useScene((s) => s.serialize);

  // Auto-save the editable project JSON to the user's chosen file (if any).
  // Debounced ~3s after the last change so rapid edits don't thrash the
  // disk. The picker / toggle UI lives in the right panel; here we just run
  // the writer when the scene changes.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const mod = await import("../lib/autoSave");
        if (cancelled) return;
        if (!mod.getActiveAutoSaveLabel()) return;
        await mod.performAutoSave(serialize());
      } catch (err) {
        // performAutoSave already logs the underlying cause; this outer
        // catch just stops React from logging an unhandled-promise.
        // eslint-disable-next-line no-console
        console.warn("auto-save debounce failed:", err);
      }
    }, 3000);
    return () => { cancelled = true; clearTimeout(t); };
    // Trigger when ANYTHING about the scene changes (object count, project
    // name, individual transform tweaks all bubble through `objects`).
  }, [objects, projectName, serialize]);

  // Manual "save now" triggered when the user first picks a destination —
  // we don't want to wait 3s for the first write.
  useEffect(() => {
    const handler = async () => {
      try {
        const mod = await import("../lib/autoSave");
        if (mod.getActiveAutoSaveLabel()) await mod.performAutoSave(serialize());
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("auto-save (immediate) failed:", err);
      }
    };
    window.addEventListener("forgeslicer:auto-save-now", handler);
    return () => window.removeEventListener("forgeslicer:auto-save-now", handler);
  }, [serialize]);

  // Load a file handed off from the Landing page (one-shot, survives
  // StrictMode double-mount because takePendingImport() is idempotent — once
  // it returns the File, subsequent calls return null even if the effect
  // re-runs. We intentionally do NOT abort the in-flight work on cleanup so
  // the imported mesh always lands in the Zustand store (which is global,
  // not tied to this component instance).
  useEffect(() => {
    const file = takePendingImport();
    if (!file) return;
    (async () => {
      try {
        const mesh = await importAnyMeshFile(file);
        addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
        setProjectName(mesh.name);
        setImportBanner({
          kind: "ok",
          message: `Imported "${file.name}" — ready to edit.`,
        });
        setTimeout(() => setImportBanner(null), 4000);
      } catch (e) {
        setImportBanner({
          kind: "err",
          message: `Could not import "${file.name}": ${e.message || e}`,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load remix STL when ?remix=<id> is present
  useEffect(() => {
    let cancelled = false;
    if (!remixId) return;
    (async () => {
      try {
        // Prefer the SAVED PROJECT JSON if the gallery record has one — it
        // restores every original primitive with its positive/negative tag,
        // colors, dimensions, transforms and groups. Falling back to the
        // STL would lose all of that (the STL is the *baked* result, so any
        // negative cylinders that carved the panel are now permanently
        // melted into the mesh and can no longer be removed/moved/edited).
        const meta = await fetch(`${API}/gallery/${remixId}`);
        let projectLoaded = false;
        if (meta.ok) {
          const rec = await meta.json();
          const rawData = rec?.data;
          if (rawData) {
            try {
              const project = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
              if (project && Array.isArray(project.objects) && project.objects.length > 0) {
                if (cancelled) return;
                // Reconstitute typed arrays for any imported meshes.
                project.objects = project.objects.map((o) => {
                  if (o.geometry && Array.isArray(o.geometry.vertices)) {
                    return {
                      ...o,
                      geometry: {
                        vertices: new Float32Array(o.geometry.vertices),
                        indices: o.geometry.indices ? new Uint32Array(o.geometry.indices) : null,
                      },
                    };
                  }
                  return o;
                });
                loadProject(project);
                setProjectName(`Remix of ${project.projectName || rec.name || "Design"}`);
                setRemixOf(remixId);
                setSearchParams({}, { replace: true });
                projectLoaded = true;
              }
            } catch (jsonErr) {
              // Fall through to STL fallback below if the project JSON is malformed.
              // eslint-disable-next-line no-console
              console.warn("Remix project JSON malformed; falling back to STL:", jsonErr);
            }
          }
        }
        if (projectLoaded) return;
        // STL fallback (older gallery entries saved before project JSON
        // round-trip was wired through). Imports a single baked mesh.
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
        setSearchParams({}, { replace: true });
      } catch (e) {
        console.warn("Remix load failed:", e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remixId]);

  // Consume an "add component" handoff from the Gallery's Component tab.
  useEffect(() => {
    if (!addComponentParam) return;
    try {
      const raw = sessionStorage.getItem("forgeslicer.addComponent");
      if (!raw) return;
      sessionStorage.removeItem("forgeslicer.addComponent");
      const payload = JSON.parse(raw);
      let added = 0;
      // Preferred path: editable project JSON — restores primitive types so
      // the user can keep resizing the component via real-size after dropping
      // it in. We force-override modifier so a "negative" library part stays
      // negative even if the source author saved it as positive while
      // designing.
      let projectObjs = null;
      if (payload.project_json) {
        try {
          const parsed = JSON.parse(payload.project_json);
          projectObjs = parsed.objects || [];
        } catch (err) {
          // Malformed project JSON — fall through to STL fallback below so
          // the user still gets *something* on the build plate.
          // eslint-disable-next-line no-console
          console.warn("addComponent: project_json parse failed, using STL fallback:", err);
        }
      }
      if (projectObjs && projectObjs.length > 0) {
        const newIds = [];
        // If MULTIPLE parts are being recalled, skip the per-object auto-drop
        // inside addRawObject — it would translate each member independently
        // and shred the assembly's relative spacing. We then do ONE batched
        // world-space drop below so the whole group rests as a unit.
        const multipart = projectObjs.length > 1;
        // Re-stamp a FRESH groupId for the recalled assembly so dropping the
        // same component twice produces two independent assemblies that can
        // be moved separately. Without this, both copies share the saved
        // component's original groupId and selecting one would also grab the
        // other.
        const savedGroupIds = new Set();
        for (const o of projectObjs) if (o.groupId) savedGroupIds.add(o.groupId);
        const groupIdRemap = {};
        for (const gid of savedGroupIds) {
          groupIdRemap[gid] = `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        }
        for (const o of projectObjs) {
          const newGroupId = o.groupId ? groupIdRemap[o.groupId] : undefined;
          const id = addRawObject({
            ...o,
            id: undefined,
            modifier: o.modifier || payload.modifier || "positive",
            groupId: newGroupId,
            // Carry the saved groupName forward so the Outliner header reads
            // the component's name. Fall back to the payload name if absent.
            groupName: o.groupName || (newGroupId ? (payload.name || "Assembly") : undefined),
            __skipAutoDrop: multipart,
          });
          if (id) { added += 1; newIds.push(id); }
        }
        // Drop the WHOLE recalled assembly onto the bed (translate all
        // members down together) so users don't get parts floating above
        // Y=0 just because the original scene saved them mid-air.
        // Note: computeRotatedBBox returns bbox in OBJECT-LOCAL space
        // (centred at origin, ignoring obj.position). World-space minY is
        // obj.position[1] + bb.min.y. We translate the WHOLE assembly by
        // -worldMinY so the lowest point lands exactly on Y=0.
        try {
          const st = useScene.getState();
          let worldMinY = Infinity;
          const newObjs = st.objects.filter((x) => newIds.includes(x.id));
          for (const o of newObjs) {
            try {
              const bb = computeRotatedBBox(o);
              const wy = (o.position?.[1] ?? 0) + bb.min.y;
              if (wy < worldMinY) worldMinY = wy;
            } catch (err) {
              // Surface bbox-calc failures so future drops aren't silent.
              // eslint-disable-next-line no-console
              console.warn("drop-to-bed: bbox failed for", o.id, err);
            }
          }
          if (isFinite(worldMinY) && Math.abs(worldMinY) > 1e-3) {
            const dy = -worldMinY;
            useScene.setState((s) => ({
              objects: s.objects.map((o) =>
                newIds.includes(o.id)
                  ? { ...o, position: [o.position[0], o.position[1] + dy, o.position[2]] }
                  : o
              ),
            }));
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("drop-to-bed pass failed:", err);
        }
      } else if (payload.stl_base64) {
        // Fallback path: import the STL bytes as a single mesh.
        const bin = atob(payload.stl_base64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const file = new File([buf], `${payload.name || "component"}.stl`, { type: "model/stl" });
        importSTLFile(file).then((mesh) => {
          addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
          // Tag it with the requested modifier (positive/negative).
          const objs = useScene.getState().objects;
          const last = objs[objs.length - 1];
          if (last && payload.modifier === "negative") {
            useScene.getState().flipModifier(last.id);
          }
        });
      }
      setImportBanner({
        kind: "ok",
        message: `Added "${payload.name}" (${payload.modifier || "positive"}) to scene${added > 0 ? ` — ${added} object${added === 1 ? "" : "s"}` : ""}.`,
      });
      setTimeout(() => setImportBanner(null), 4500);
      setSearchParams({}, { replace: true });
    } catch (e) {
      setImportBanner({ kind: "err", message: `Could not add component: ${e.message || e}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addComponentParam]);

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
      <TopToolbar onShare={() => setShareOpen(true)} onSendToOrca={handleSendTo} onSaveComponent={() => setSaveComponentOpen(true)} />
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
      <SaveComponentDialog open={saveComponentOpen} onClose={() => setSaveComponentOpen(false)} />
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

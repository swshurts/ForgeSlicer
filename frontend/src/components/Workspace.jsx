import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Scissors, X, Move3D, RotateCw, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import TopToolbar from "./TopToolbar";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import StatusBar from "./StatusBar";
import Viewport from "./Viewport";
import { ShareDialog, OrcaDialog, SavePrinterDialog, SaveComponentDialog } from "./Dialogs";
import HelpDialog from "./HelpDialog";
import { parseTranscript, executeCommand } from "../lib/voiceCommands";
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
  const [helpOpen, setHelpOpen] = useState(false);
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
      else if (name === "help") setHelpOpen(true);
    };
    window.addEventListener("forgeslicer:open-dialog", handler);
    return () => window.removeEventListener("forgeslicer:open-dialog", handler);
  }, []);

  // Global "?" shortcut to open the Help manual from anywhere in the
  // workspace. Skips when the user is typing in an input/textarea so we
  // don't intercept a literal "?" they're trying to type.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "?" && !(e.shiftKey && e.key === "/")) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setHelpOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  // Pipe a literal voice-phrase from the in-app manual through the existing
  // command parser/executor — same path the microphone uses, just with the
  // transcript handed in as text. Closes the help dialog so the user can
  // see the effect.
  const handleTryVoice = async (phrase) => {
    setHelpOpen(false);
    setImportBanner({ kind: "ok", message: `Voice: "${phrase}" — parsing…` });
    try {
      const cmd = await parseTranscript(phrase);
      const result = await executeCommand(cmd);
      setImportBanner({ kind: "ok", message: `Voice: ${result}` });
      setTimeout(() => setImportBanner(null), 4000);
    } catch (e) {
      setImportBanner({ kind: "err", message: `Voice failed: ${e.message || e}` });
    }
  };

  return (
    <div
      className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden"
      style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      data-testid="workspace"
    >
      <TopToolbar onShare={() => setShareOpen(true)} onSendToOrca={handleSendTo} onSaveComponent={() => setSaveComponentOpen(true)} onOpenHelp={() => setHelpOpen(true)} />
      <div className="flex-1 flex overflow-hidden">
        <LeftPanel />
        <main className="flex-1 relative overflow-hidden bg-slate-800" data-testid="viewport-main">
          <Viewport />
          <CutHUD />
        </main>
        <RightPanel onSavePrinter={() => setSavePrinterOpen(true)} />
      </div>
      <StatusBar />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      <OrcaDialog open={orcaOpen} onClose={() => setOrcaOpen(false)} targetSlicer={targetSlicer} />
      <SavePrinterDialog open={savePrinterOpen} onClose={() => setSavePrinterOpen(false)} />
      <SaveComponentDialog open={saveComponentOpen} onClose={() => setSaveComponentOpen(false)} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} onTryVoice={handleTryVoice} />
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

// ---- Cut tool HUD ----
// Floating overlay shown when cutMode is active. Lets the user pick
// translate/rotate of the cut plane, then commits with one of three
// keep-which-side buttons. Sits over the viewport so it doesn't take
// dedicated screen real estate.
function CutHUD() {
  const cutMode = useScene((s) => s.cutMode);
  const setCutMode = useScene((s) => s.setCutMode);
  const cutPlane = useScene((s) => s.cutPlane);
  const setCutPlane = useScene((s) => s.setCutPlane);
  const transformMode = useScene((s) => s.transformMode);
  const setTransformMode = useScene((s) => s.setTransformMode);
  const applyCut = useScene((s) => s.applyCut);
  const selectedIds = useScene((s) => s.selectedIds);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const [busy, setBusy] = useState(false);

  if (!cutMode) return null;

  const targetCount = selectedIds.length || (selectedId ? 1 : 0);
  const target = objects.find((o) => o.id === (selectedIds[0] || selectedId));

  const handleApply = (keep) => {
    setBusy(true);
    setTimeout(async () => {
      try {
        const result = await applyCut(keep);
        if (result.ok) {
          const pieces = result.pieces;
          toast.success(`Cut applied: ${pieces} piece${pieces > 1 ? "s" : ""} created`);
          if (result.errors && result.errors.length > 0) {
            toast.warning("Some objects had issues", { description: result.errors.join("\n") });
          }
        } else {
          toast.error("Cut failed", { description: result.error });
        }
      } finally {
        setBusy(false);
      }
    }, 50);
  };

  const handleReset = () => {
    setCutPlane({ position: [0, target ? 25 : 25, 0], rotation: [0, 0, 0] });
  };

  return (
    <div
      data-testid="cut-hud"
      className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-slate-900/95 backdrop-blur-sm border border-amber-500/50 rounded-lg shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[600px]"
    >
      <Scissors size={16} className="text-amber-400 flex-shrink-0" />
      <div className="flex-1">
        <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">Cut Plane</div>
        <div className="text-[10px] text-slate-400">
          {targetCount === 0
            ? "Select an object to cut, then position the plane below."
            : `${targetCount} target${targetCount > 1 ? "s" : ""}: ${target?.name || ""}`}
        </div>
      </div>

      <div className="flex gap-1 bg-slate-950 rounded p-0.5 border border-slate-700">
        <button
          data-testid="cut-mode-translate"
          onClick={() => setTransformMode("translate")}
          className={`px-2 h-7 rounded text-[10px] font-semibold flex items-center gap-1 ${transformMode === "translate" ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-white"}`}
          title="Translate the plane"
        >
          <Move3D size={11} /> Move
        </button>
        <button
          data-testid="cut-mode-rotate"
          onClick={() => setTransformMode("rotate")}
          className={`px-2 h-7 rounded text-[10px] font-semibold flex items-center gap-1 ${transformMode === "rotate" ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-white"}`}
          title="Rotate the plane"
        >
          <RotateCw size={11} /> Rotate
        </button>
      </div>

      <button
        data-testid="cut-reset-btn"
        onClick={handleReset}
        className="h-7 px-2 text-[10px] text-slate-300 hover:text-white border border-slate-700 hover:border-slate-600 rounded"
        title="Reset plane to horizontal at center"
      >
        Reset
      </button>

      <div className="h-6 w-px bg-slate-700 mx-1" />

      <button
        data-testid="cut-apply-upper-btn"
        onClick={() => handleApply("upper")}
        disabled={busy || targetCount === 0}
        className="h-8 px-2.5 text-[10px] font-bold rounded border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 disabled:opacity-50 flex items-center gap-1.5"
        title="Keep only the upper half (above the plane)"
      >
        <ArrowUp size={11} /> Keep Upper
      </button>
      <button
        data-testid="cut-apply-both-btn"
        onClick={() => handleApply("both")}
        disabled={busy || targetCount === 0}
        className="h-8 px-3 text-[10px] font-bold rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 flex items-center gap-1.5"
        title="Split into two pieces (keep both halves)"
      >
        <ArrowUpDown size={11} /> Split (both)
      </button>
      <button
        data-testid="cut-apply-lower-btn"
        onClick={() => handleApply("lower")}
        disabled={busy || targetCount === 0}
        className="h-8 px-2.5 text-[10px] font-bold rounded border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 disabled:opacity-50 flex items-center gap-1.5"
        title="Keep only the lower half (below the plane)"
      >
        <ArrowDown size={11} /> Keep Lower
      </button>

      <button
        data-testid="cut-cancel-btn"
        onClick={() => setCutMode(false)}
        className="h-7 w-7 flex items-center justify-center text-slate-400 hover:text-white rounded hover:bg-slate-800"
        title="Cancel"
      >
        <X size={14} />
      </button>
    </div>
  );
}


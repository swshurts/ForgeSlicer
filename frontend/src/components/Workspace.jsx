import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Scissors, X, Move3D, RotateCw, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import TopToolbar from "./TopToolbar";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";
import StatusBar from "./StatusBar";
import Viewport from "./Viewport";
import SketchOverlay from "./SketchOverlay";
import { ShareDialog, OrcaDialog, SavePrinterDialog, SaveComponentDialog } from "./Dialogs";
import HelpDialog from "./HelpDialog";
import SettingsDialog from "./dialogs/SettingsDialog";
import ProjectExplorerDialog from "./dialogs/ProjectExplorerDialog";
import { parseTranscript, executeCommand } from "../lib/voiceCommands";
import { expandTemplate, executePlan } from "../lib/voicePlanExecutor";
import { useScene } from "../lib/store";
import { importSTLFile, importAnyMeshFile, import3MFFileMulti, countMeshTriangles, HEAVY_MESH_TRIANGLE_THRESHOLD } from "../lib/exporters";
import { computeRotatedBBox } from "../lib/geometry";
import { takePendingImport } from "../lib/pendingImport";
import { API } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { projectsApi } from "../lib/api";
import { getSaveBehavior } from "../lib/savePref";
import { saveProjectJSON } from "../lib/exporters";
import { pickNextUnseen, markSeen, tipProgress } from "../lib/tipsLibrary";
import { reportSceneOversize } from "../lib/oversizeCheck";
import SubdivideDialog from "./dialogs/SubdivideDialog";
import PlanPreviewDialog from "./PlanPreviewDialog";
import WorkspaceDropZone from "./WorkspaceDropZone";
import LithoInboxWatcher from "./LithoInboxWatcher";

export default function Workspace() {
  const [shareOpen, setShareOpen] = useState(false);
  const [orcaOpen, setOrcaOpen] = useState(false);
  const [targetSlicer, setTargetSlicer] = useState(null);
  const [savePrinterOpen, setSavePrinterOpen] = useState(false);
  const [saveComponentOpen, setSaveComponentOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Optional deep-link tab — set by callers that want to land on a
  // specific Settings page (e.g., the iter-66 save-pref tip jumps to
  // "saving"). Resets to "appearance" when the dialog closes so a normal
  // toolbar click always opens to the default tab.
  const [settingsInitialTab, setSettingsInitialTab] = useState("appearance");
  // Subdivide dialog — opened by the oversize toast when a model bigger
  // than the build plate enters the scene (import / paste / printer
  // change). `subdivideTargetId` carries the object id to operate on.
  const [subdivideTargetId, setSubdivideTargetId] = useState(null);
  const [projectExplorerOpen, setProjectExplorerOpen] = useState(false);
  const [importBanner, setImportBanner] = useState(null); // { kind, message }
  // Iter-92 — when an STL arrives via cross-app handoff (LithoForge ➜
  // ForgeSlicer) we stash the attribution metadata so a sticky chip
  // can show "Imported from LithoForge · model.stl" with a back-link
  // to the original project page. Independent of `importBanner` (which
  // auto-dismisses) — the chip persists until the user closes it.
  const [importSource, setImportSource] = useState(null);
  // Iter-96 — { triangleCount, filename } | null. Persistent warning chip
  // shown when an import exceeds HEAVY_MESH_TRIANGLE_THRESHOLD so users
  // know future actions (boolean ops, slicing, OrcaSlicer hand-off)
  // will be slower than usual. Dismissable via the chip's × button.
  const [heavyMeshWarning, setHeavyMeshWarning] = useState(null);
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
      else if (name === "settings") setSettingsOpen(true);
      else if (name === "projects") setProjectExplorerOpen(true);
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
  const remixFit = searchParams.get("fit") === "1";
  const addComponentParam = searchParams.get("addComponent");
  const templateParam = searchParams.get("template");
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const addRawObject = useScene((s) => s.addRawObject);
  const setProjectName = useScene((s) => s.setProjectName);
  const setRemixOf = useScene((s) => s.setRemixOf);
  const loadProject = useScene((s) => s.loadProject);
  const resizeSceneToBed = useScene((s) => s.resizeSceneToBed);
  const setPristineImport = useScene((s) => s.setPristineImport);
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const serialize = useScene((s) => s.serialize);
  const buildVolume = useScene((s) => s.buildVolume);
  // Default printer + hierarchical project breadcrumb glue.
  const myPrinterId = useScene((s) => s.myPrinterId);
  const printerId = useScene((s) => s.printerId);
  const setPrinter = useScene((s) => s.setPrinter);
  const communityPrinters = useScene((s) => s.communityPrinters);
  const setCommunityPrinters = useScene((s) => s.setCommunityPrinters);
  const currentProjectId = useScene((s) => s.currentProjectId);
  const [projectMetas, setProjectMetas] = useState([]);
  const { user } = useAuth();

  // Restore the user's saved default printer ON FIRST MOUNT only.
  // We deliberately don't re-apply on every printer change — that would
  // fight the user's manual pick. We also pull community printers first
  // so the lookup table has the user's saved printer available before
  // setPrinter() runs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!myPrinterId) return;
      // If the saved id is already the active one, nothing to do.
      if (myPrinterId === printerId) return;
      // Pull community printers if we don't yet have them — the user's
      // saved printer might live in that list (not the built-ins).
      try {
        if (communityPrinters.length === 0) {
          const { printersApi: api } = await import("../lib/api");
          const list = await api.list();
          if (!cancelled) setCommunityPrinters(list || []);
        }
      } catch (err) {
        // Non-fatal — setPrinter falls back to the built-in default if
        // it can't resolve the id.
        // eslint-disable-next-line no-console
        console.warn("could not fetch community printers for default restore:", err);
      }
      if (!cancelled) setPrinter(myPrinterId);
    })();
    return () => { cancelled = true; };
    // Run once on mount. We intentionally don't depend on printerId so
    // a subsequent manual change doesn't snap back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the user's hierarchical project list when they're signed in
  // — used by the breadcrumb in the top toolbar to resolve the ancestry
  // of `currentProjectId`. Cheap (~one round-trip) and updates whenever
  // the project explorer dialog closes (forced via a refresh tick).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setProjectMetas([]); return; }
      try {
        const list = await projectsApi.list();
        if (!cancelled) setProjectMetas(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) setProjectMetas([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, projectExplorerOpen, currentProjectId]);

  // Ctrl/Cmd+S — runs the save flow per the user's persisted preference
  // ("local" / "cloud" / "both"). We intercept the keystroke globally so
  // the browser's native "Save Page" dialog never appears in the
  // workspace. Inputs / textareas are exempt so the shortcut doesn't
  // hijack typed text. State is read fresh via useScene.getState() and
  // a ref to `user` so the listener never goes stale.
  const userRef = React.useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => {
    const onKey = async (e) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")) return;
      if (e.shiftKey) return; // leave Ctrl+Shift+S to the browser
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.target?.isContentEditable) return;
      e.preventDefault();
      const behavior = getSaveBehavior();
      const sceneState = useScene.getState();
      const payload = sceneState.serialize();
      const safe = (sceneState.projectName || "project").replace(/[^a-z0-9-_]/gi, "_");
      const localSave = () => {
        saveProjectJSON(payload, `${safe}.forge.json`);
      };
      const cloudSave = async () => {
        const pid = sceneState.currentProjectId;
        if (!pid) {
          toast.message("No project linked to this scene", {
            description: "Open or create a project in the Projects dialog first, then Ctrl+S will save into it.",
          });
          return false;
        }
        if (!userRef.current) {
          toast.message("Sign in to save to the cloud", { description: "Falling back to a local file." });
          return false;
        }
        try {
          await projectsApi.update(pid, { forge_json: payload });
          toast.success(`Saved into “${sceneState.currentProjectName || "project"}”`);
          return true;
        } catch (err) {
          toast.error("Cloud save failed — saving locally as fallback");
          // eslint-disable-next-line no-console
          console.warn("cloud save failed:", err);
          return false;
        }
      };
      if (behavior === "local") {
        localSave();
        toast.success("Saved locally", { duration: 1500 });
      } else if (behavior === "cloud") {
        const ok = await cloudSave();
        if (!ok) localSave();
      } else if (behavior === "both") {
        localSave();
        await cloudSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tip-of-the-day system (iter 67 + iter 68).
  // Surfaces a library of dismissible tips one at a time. The toast has
  // a "Next tip" button that immediately fires the next unseen tip in
  // the library, so a curious user can power through several in a row;
  // a "Got it" button just dismisses the current one and goes quiet.
  // Each tip's id is persisted as "seen" so it never reappears.
  const tipFiredRef = React.useRef(false);

  // Forward declare openSettings deep-link so the tip's CTA can use it.
  const openSettingsDeepLink = React.useCallback((tabId) => {
    if (tabId) setSettingsInitialTab(tabId);
    setSettingsOpen(true);
  }, []);

  const showTip = React.useCallback((tip) => {
    if (!tip) return;
    const { seen, total } = tipProgress({ isSignedIn: !!userRef.current });
    const ack = () => markSeen(tip.id);
    const showNext = () => {
      ack();
      const next = pickNextUnseen({ isSignedIn: !!userRef.current });
      if (next) {
        // Slight delay so the previous toast finishes its dismiss
        // animation — feels less abrupt than instant swap.
        setTimeout(() => showTip(next), 200);
      } else {
        toast.success("That's all the tips for now.", { duration: 2500 });
      }
    };
    const action = tip.cta
      ? {
          label: tip.cta.label,
          onClick: () => {
            ack();
            try { tip.cta.run({ openSettings: openSettingsDeepLink }); }
            catch (err) { /* eslint-disable-next-line no-console */
              console.warn("tip CTA failed:", err);
            }
          },
        }
      : { label: "Next tip", onClick: showNext };
    const cancel = tip.cta
      ? { label: "Next tip", onClick: showNext }
      : { label: "Got it", onClick: ack };
    toast.message(tip.title, {
      description: `${tip.description}\n\nTip ${seen + 1} of ${total}`,
      duration: 14000,
      action,
      cancel,
    });
    // Belt-and-suspenders: even if the user lets the toast auto-fade,
    // mark it seen so the same one doesn't reappear next time.
    setTimeout(ack, 14500);
  }, [openSettingsDeepLink]);

  useEffect(() => {
    if (tipFiredRef.current) return;
    if (!user || !currentProjectId) return;
    const next = pickNextUnseen({ isSignedIn: true });
    if (!next) return;
    tipFiredRef.current = true;
    showTip(next);
  }, [user, currentProjectId, showTip]);

  // Manual trigger from the Help dialog's "Tip of the day" button. Fires
  // the next-unseen tip, OR — if the user has already seen them all —
  // a friendly "you're all caught up" toast with a Reset action so they
  // can re-watch the carousel from the beginning.
  useEffect(() => {
    const onShowTip = () => {
      const next = pickNextUnseen({ isSignedIn: !!userRef.current });
      if (next) {
        showTip(next);
      } else {
        toast.success("You've seen every tip already.", {
          description: "Want a refresher? Reset the carousel and walk through them again.",
          duration: 5000,
          action: {
            label: "Reset",
            onClick: () => {
              // Lazy-import so HelpDialog → Workspace doesn't pay this
              // cost on every render.
              import("../lib/tipsLibrary").then(({ resetSeen }) => {
                resetSeen();
                const first = pickNextUnseen({ isSignedIn: !!userRef.current });
                if (first) setTimeout(() => showTip(first), 200);
              });
            },
          },
        });
      }
    };
    window.addEventListener("forgeslicer:show-tip", onShowTip);
    return () => window.removeEventListener("forgeslicer:show-tip", onShowTip);
  }, [showTip]);

  // -------------------------------------------------------------------
  // Oversize detection (iter 69).
  // Subscribes to the scene's object list + active build volume and
  // surfaces a toast the FIRST time any positive object exceeds the
  // current printer. The toast offers a "Subdivide…" action that opens
  // the SubdivideDialog on that object. We track already-toasted ids in
  // a ref so the same banner doesn't reappear on every minor edit, but
  // we DO re-fire when:
  //   • A new oversized object enters the scene (id we haven't seen)
  //   • The user switches to a smaller printer that pushes a previously-
  //     fitting object over the edge.
  // -------------------------------------------------------------------
  const oversizeToastedRef = React.useRef(new Set());
  const lastPrinterRef = React.useRef(null);
  useEffect(() => {
    // Printer change → clear the toasted-set so re-fits / re-overflows
    // re-toast appropriately.
    if (lastPrinterRef.current !== null && lastPrinterRef.current !== printerId) {
      oversizeToastedRef.current = new Set();
    }
    lastPrinterRef.current = printerId;
  }, [printerId]);
  useEffect(() => {
    // Tiny debounce so dragging a primitive past the bed edge doesn't
    // fire dozens of toasts during the drag.
    const t = setTimeout(() => {
      const sceneObjs = useScene.getState().objects;
      const bv = useScene.getState().buildVolume;
      const reports = reportSceneOversize(sceneObjs, bv);
      const seen = oversizeToastedRef.current;
      // Forget ids that are no longer in the scene OR no longer oversized.
      const stillIds = new Set(reports.map((r) => r.id));
      for (const id of Array.from(seen)) if (!stillIds.has(id)) seen.delete(id);
      // Toast the first new offender. We don't stack multiple toasts —
      // one banner is sufficient; users can open Subdivide and handle the
      // rest one at a time.
      const fresh = reports.find((r) => !seen.has(r.id));
      if (!fresh) return;
      seen.add(fresh.id);
      // Frame the viewport on the oversize bbox so the user can SEE it
      // even if it spilled off-screen — the build plate will shrink
      // relative to the model on screen.
      try {
        window.dispatchEvent(new CustomEvent("forgeslicer:frame-bbox", {
          detail: { min: fresh.bbox.min, max: fresh.bbox.max },
        }));
      } catch { /* noop */ }
      toast.warning(`“${fresh.name}” exceeds the build plate`, {
        description:
          `${fresh.size.x.toFixed(0)} × ${fresh.size.y.toFixed(0)} × ${fresh.size.z.toFixed(0)} mm — over by ` +
          [fresh.over.x, fresh.over.y, fresh.over.z]
            .filter((v) => v > 0.5)
            .map((v) => `${v.toFixed(0)} mm`)
            .join(", ") +
          " on at least one axis.",
        duration: 14000,
        action: {
          label: "Subdivide…",
          onClick: () => setSubdivideTargetId(fresh.id),
        },
        cancel: {
          label: "Ignore",
          onClick: () => { /* user dismissed — seen-set already updated */ },
        },
      });
    }, 350);
    return () => clearTimeout(t);
  }, [objects, buildVolume, printerId]);

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

  // Load a file handed off from the Landing page OR from a sister-app
  // postMessage flow (Iter-92, /handoff). One-shot, survives StrictMode
  // double-mount because takePendingImport() is idempotent — once it
  // returns the payload, subsequent calls return null even if the
  // effect re-runs. We intentionally do NOT abort the in-flight work on
  // cleanup so the imported mesh always lands in the Zustand store.
  useEffect(() => {
    const payload = takePendingImport();
    if (!payload) return;
    const file = payload.file;
    const meta = payload.meta;
    (async () => {
      try {
        // Iter-94 Phase 2 — when the incoming file is a 3MF, use the
        // multi-object importer so per-object colors from
        // <basematerials> reach the workspace. STL/OBJ/etc fall back
        // to the legacy single-mesh importer.
        const isThreeMF = /\.3mf$/i.test(file.name);
        let primaryName = "";
        let totalTriangles = 0;
        if (isThreeMF) {
          const multi = await import3MFFileMulti(file);
          primaryName = multi.fileName;
          // Add each object as a separate mesh. The first object's
          // name becomes the project name; subsequent objects keep
          // their own names (visible in the Outliner) so the user can
          // identify tone-by-tone.
          multi.objects.forEach((o) => {
            addImportedMesh(o.name, o.vertices, o.indices, o.originalBbox, {
              customColor: o.displaycolor || undefined,
              materialName: o.materialName || undefined,
            });
            totalTriangles += countMeshTriangles(o.vertices, o.indices);
          });
        } else {
          const mesh = await importAnyMeshFile(file);
          primaryName = mesh.name;
          addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
          totalTriangles = countMeshTriangles(mesh.vertices, mesh.indices);
        }
        setProjectName(primaryName);
        // Iter-96 — surface a heavy-mesh warning chip so users know
        // why subsequent actions feel slow. Specifically motivated by
        // LithoForge handoffs that arrived at 4M+ triangles before
        // its decimation fix.
        if (totalTriangles > HEAVY_MESH_TRIANGLE_THRESHOLD) {
          setHeavyMeshWarning({ triangleCount: totalTriangles, filename: file.name });
        }
        // Iter-94 — stash the pristine 3MF bytes (if any) so OrcaDialog
        // can hand them off to OrcaSlicer's desktop app with all the
        // original color / multi-material metadata intact.
        if (meta?.pristineBytes) {
          setPristineImport(meta.pristineBytes, meta.pristineFilename || file.name);
        }
        setImportBanner({
          kind: "ok",
          message: meta?.sourceLabel
            ? `Imported "${file.name}" from ${meta.sourceLabel} — ready to edit.`
            : `Imported "${file.name}" — ready to edit.`,
        });
        if (meta?.sourceLabel) {
          setImportSource({ ...meta, filename: file.name });
        }
        setTimeout(() => setImportBanner(null), 4000);

        // Iter-92 — Guest mode from a sister-app handoff: nudge sign-up
        // ONCE after the model lands. Skipped for already-signed-in
        // users; the toast itself is best-effort (toast import already
        // present at the top of this file).
        const fromParam = searchParams.get("from");
        if (fromParam && !user) {
          setTimeout(() => {
            toast.info("Save your work?", {
              description: "Create a free ForgeSlicer account to keep this design, publish it to the gallery, or hand it off to your slicer.",
              duration: 10000,
              action: {
                label: "Sign up",
                onClick: () => {
                  window.location.href = `/signin?mode=register&return=${encodeURIComponent("/workspace")}`;
                },
              },
            });
          }, 1500);
        }
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
                // ?fit=1 — auto-scale to fit the user's printer bed.
                // Defer one frame so the loaded objects are present before
                // we compute their AABB.
                if (remixFit) {
                  setTimeout(() => {
                    const r = resizeSceneToBed();
                    if (r?.ok) {
                      toast.success(`Resized ${(r.scaleFactor * 100).toFixed(0)}% to fit your bed`);
                    } else if (r?.reason && r.reason !== "Already fits bed") {
                      // eslint-disable-next-line no-console
                      console.warn("Remix auto-fit skipped:", r.reason);
                    }
                  }, 30);
                }
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
        if (remixFit) {
          setTimeout(() => {
            const r = resizeSceneToBed();
            if (r?.ok) toast.success(`Resized ${(r.scaleFactor * 100).toFixed(0)}% to fit your bed`);
          }, 30);
        }
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
          let worldMinZ = Infinity;
          const newObjs = st.objects.filter((x) => newIds.includes(x.id));
          for (const o of newObjs) {
            try {
              const bb = computeRotatedBBox(o);
              const wz = (o.position?.[2] ?? 0) + bb.min.z;
              if (wz < worldMinZ) worldMinZ = wz;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn("drop-to-bed: bbox failed for", o.id, err);
            }
          }
          if (isFinite(worldMinZ) && Math.abs(worldMinZ) > 1e-3) {
            const dz = -worldMinZ;
            useScene.setState((s) => ({
              objects: s.objects.map((o) =>
                newIds.includes(o.id)
                  ? { ...o, position: [o.position[0], o.position[1], o.position[2] + dz] }
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
        message: payload.kind === "design"
          ? `Added design "${payload.name}" to scene${added > 0 ? ` — ${added} object${added === 1 ? "" : "s"}` : ""}.`
          : `Added "${payload.name}" (${payload.modifier || "positive"}) to scene${added > 0 ? ` — ${added} object${added === 1 ? "" : "s"}` : ""}.`,
      });
      setTimeout(() => setImportBanner(null), 4500);
      setSearchParams({}, { replace: true });
    } catch (e) {
      setImportBanner({ kind: "err", message: `Could not add component: ${e.message || e}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addComponentParam]);

  // Launch a curated template — entry point used by the Landing-page
  // "Project Templates" cards. The card stashes its template_id + params
  // dict in sessionStorage and navigates to /workspace?template=<id>.
  // We pop the payload, call expandTemplate to get a step list, then
  // run it through the standard executePlan. Steps emit "add" / "boolean"
  // operations which mutate the scene like any other voice plan.
  useEffect(() => {
    if (!templateParam) return;
    let cancelled = false;
    (async () => {
      let payload = null;
      try {
        const raw = sessionStorage.getItem("forgeslicer.launchTemplate");
        if (raw) {
          sessionStorage.removeItem("forgeslicer.launchTemplate");
          payload = JSON.parse(raw);
        }
      } catch (_) { /* no-op */ }
      // No payload (deep-link without preceding card click) — silently
      // ignore. We can't synthesise sensible defaults for every template
      // ID without knowing which one the user wanted.
      if (!payload?.template_id) {
        setSearchParams({}, { replace: true });
        return;
      }
      try {
        setImportBanner({ kind: "info", message: `Loading "${payload.name || payload.template_id}"…` });
        const data = await expandTemplate(payload.template_id, payload.params || {});
        if (cancelled) return;
        if (!data?.steps?.length) {
          setImportBanner({ kind: "err", message: `Template "${payload.template_id}" returned no steps` });
          setTimeout(() => setImportBanner(null), 4500);
          setSearchParams({}, { replace: true });
          return;
        }
        const result = await executePlan(data.steps);
        if (cancelled) return;
        setProjectName(payload.name || "Template");
        setImportBanner({
          kind: result.ok ? "ok" : "err",
          message: result.ok
            ? `Loaded "${payload.name || payload.template_id}" — ${result.executed} step${result.executed === 1 ? "" : "s"}.`
            : `Template partially loaded (${result.executed}/${result.total} steps)`,
        });
        setTimeout(() => setImportBanner(null), 4500);
      } catch (err) {
        if (cancelled) return;
        setImportBanner({ kind: "err", message: `Could not load template: ${err.message || err}` });
        setTimeout(() => setImportBanner(null), 5000);
      } finally {
        if (!cancelled) setSearchParams({}, { replace: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateParam]);

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
      <TopToolbar onShare={() => setShareOpen(true)} onSendToOrca={handleSendTo} onSaveComponent={() => setSaveComponentOpen(true)} onOpenHelp={() => setHelpOpen(true)} onOpenProjectExplorer={() => setProjectExplorerOpen(true)} projectMetas={projectMetas} />
      <div className="flex-1 flex overflow-hidden">
        <LeftPanel />
        <main className="flex-1 relative overflow-hidden bg-slate-800" data-testid="viewport-main">
          <Viewport />
          <CutHUD />
          <SketchOverlay />
        </main>
        <RightPanel onSavePrinter={() => setSavePrinterOpen(true)} />
      </div>
      <StatusBar />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      <OrcaDialog open={orcaOpen} onClose={() => setOrcaOpen(false)} targetSlicer={targetSlicer} />
      <SavePrinterDialog open={savePrinterOpen} onClose={() => setSavePrinterOpen(false)} />
      <SaveComponentDialog open={saveComponentOpen} onClose={() => setSaveComponentOpen(false)} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} onTryVoice={handleTryVoice} />
      <SettingsDialog
        open={settingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsInitialTab("appearance");
        }}
      />
      <ProjectExplorerDialog open={projectExplorerOpen} onClose={() => setProjectExplorerOpen(false)} />
      <WorkspaceDropZone />
      <LithoInboxWatcher />
      <SubdivideDialog
        open={subdivideTargetId !== null}
        objectId={subdivideTargetId}
        onClose={() => setSubdivideTargetId(null)}
      />
      <PlanPreviewDialog />
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
      {/* Iter-92 — Sticky attribution chip for cross-app handoffs.
          Sits below the TopToolbar (which is ~h-12), centred. Closeable
          by the user once they no longer need the back-link. */}
      {importSource && (
        <div
          data-testid="import-source-chip"
          className="fixed top-14 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 backdrop-blur border border-orange-500/40 shadow-lg shadow-orange-900/20 text-[11px]"
        >
          <span className="text-slate-400">Imported from</span>
          {importSource.sourceUrl ? (
            <a
              data-testid="import-source-link"
              href={importSource.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-300 hover:text-orange-200 font-semibold underline decoration-dotted"
            >
              {importSource.sourceLabel}
            </a>
          ) : (
            <span className="text-orange-300 font-semibold">{importSource.sourceLabel}</span>
          )}
          <span className="text-slate-500">·</span>
          <span className="text-slate-300 font-mono truncate max-w-[24ch]">{importSource.filename}</span>
          <button
            data-testid="import-source-dismiss"
            onClick={() => setImportSource(null)}
            className="ml-1 text-slate-500 hover:text-white"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {/* Iter-96 — Heavy-mesh warning chip. Sits just below the
          import-source chip (or where it would be) so the two stack
          naturally for handoff imports. Yellow accent to distinguish
          from the orange attribution chip. Persists until dismissed. */}
      {heavyMeshWarning && (
        <div
          data-testid="heavy-mesh-warning-chip"
          className={`fixed left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 backdrop-blur border border-yellow-500/40 shadow-lg shadow-yellow-900/20 text-[11px] ${importSource ? "top-24" : "top-14"}`}
        >
          <span className="text-yellow-300 font-semibold">Heavy mesh</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300 font-mono">
            {heavyMeshWarning.triangleCount.toLocaleString()} triangles
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">slicing & boolean ops will be slow</span>
          <button
            data-testid="heavy-mesh-warning-dismiss"
            onClick={() => setHeavyMeshWarning(null)}
            className="ml-1 text-slate-500 hover:text-white"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
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


// Iter-85: Workspace drag-and-drop file importer.
//
// Adds a transparent overlay that wakes up the moment the user drags
// files over the workspace, and routes the dropped files to the same
// importers the toolbar Import button uses:
//
//   .stl / .obj / .3mf / .glb / .gltf  →  silent worker importer
//                                         → store.addImportedMesh
//   .svg                                →  forgeslicer:import-svg event
//   .zip                                →  forgeslicer:import-zip event
//   anything else                       →  toast.warning, file ignored
//
// The component renders nothing while idle (no z-index cost, no
// pointer-events interference). When the user drags ANY file onto
// the page it pops a dashed-border overlay so the drop target is
// obvious — modeled after the GitHub / Notion drag-overlay pattern.

import React, { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { importAnyMeshFile, import3MFFileMulti, countMeshTriangles, HEAVY_MESH_TRIANGLE_THRESHOLD } from "../lib/exporters";
import { useScene } from "../lib/store";

const MESH_EXTS = new Set(["stl", "obj", "3mf", "glb", "gltf"]);

function extOf(name) {
  return (name.split(".").pop() || "").toLowerCase();
}

export default function WorkspaceDropZone() {
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const setPristineImport = useScene((s) => s.setPristineImport);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  // Counter pattern — dragenter/leave fire on EVERY child element so
  // we count nests instead of toggling, otherwise the overlay flickers
  // off any time the cursor crosses an interior border.
  const dragDepth = useRef(0);

  useEffect(() => {
    const isFileDrag = (e) =>
      e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

    const onDragEnter = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setActive(true);
    };
    const onDragOver = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      // Show the "+ Add" cursor while over the drop zone.
      e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e) => {
      if (!isFileDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setActive(false);
    };
    const onDrop = async (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length === 0) return;
      await handleDroppedFiles(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDroppedFiles = async (files) => {
    setBusy(true);
    try {
      let importedMeshes = 0;
      // Iter-96 — accumulate triangle counts across every imported
      // mesh in the drop so we can surface a single warning toast at
      // the end rather than one per file (a 5-tone lithophane would
      // otherwise spam the user with 5 toasts).
      let totalTriangles = 0;
      const unsupported = [];
      for (const file of files) {
        const ext = extOf(file.name);
        if (ext === "svg") {
          // SVG → existing extrude editor.
          const text = await file.text();
          window.dispatchEvent(new CustomEvent("forgeslicer:import-svg", { detail: { text, name: file.name } }));
          continue;
        }
        if (ext === "zip") {
          // ZIP → existing ZIP picker dialog.
          window.dispatchEvent(new CustomEvent("forgeslicer:import-zip", { detail: { file } }));
          continue;
        }
        if (MESH_EXTS.has(ext)) {
          try {
            if (ext === "3mf") {
              // Iter-94 Phase 2 — preserve per-object color via the
              // multi-object importer. Each <object> in the 3MF gets
              // its own row in the Outliner with the correct
              // displaycolor; the original bytes also go into the
              // pristine slot so Send-to-OrcaSlicer can round-trip
              // the full multi-material metadata.
              const buf = await file.arrayBuffer();
              setPristineImport(new Uint8Array(buf), file.name);
              const multi = await import3MFFileMulti(file);
              multi.objects.forEach((o) => {
                addImportedMesh(o.name, o.vertices, o.indices, o.originalBbox, {
                  customColor: o.displaycolor || undefined,
                  materialName: o.materialName || undefined,
                });
                totalTriangles += countMeshTriangles(o.vertices, o.indices);
              });
              importedMeshes += multi.objects.length;
            } else {
              const mesh = await importAnyMeshFile(file);
              addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
              totalTriangles += countMeshTriangles(mesh.vertices, mesh.indices);
              importedMeshes++;
            }
          } catch (err) {
            toast.error(`Couldn't import ${file.name}: ${err.message || err}`);
          }
          continue;
        }
        unsupported.push(file.name);
      }
      if (importedMeshes > 0) {
        toast.success(
          `Dropped ${importedMeshes} ${importedMeshes === 1 ? "mesh" : "meshes"} onto the build plate.`,
        );
      }
      // Iter-96 — heavy-mesh warning. Persistent until dismissed
      // because subsequent slicing/boolean ops will visibly stall and
      // a 4s success toast would have evaporated by then.
      if (totalTriangles > HEAVY_MESH_TRIANGLE_THRESHOLD) {
        toast.warning("Heavy mesh", {
          description: `${totalTriangles.toLocaleString()} triangles total — slicing and boolean ops will be slow. Consider decimating the mesh before importing.`,
          duration: 12000,
        });
      }
      if (unsupported.length > 0) {
        toast.warning(
          `Ignored ${unsupported.length} unsupported file${unsupported.length === 1 ? "" : "s"}`,
          {
            description: `Supports STL · OBJ · 3MF · GLB · SVG · ZIP. Skipped: ${
              unsupported.slice(0, 3).join(", ")
            }${unsupported.length > 3 ? ` +${unsupported.length - 3} more` : ""}`,
          },
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (!active && !busy) return null;

  return (
    <div
      className="fixed inset-0 z-[150] pointer-events-none flex items-center justify-center"
      data-testid="workspace-drop-overlay"
    >
      <div
        className={`m-6 flex-1 h-[calc(100%-3rem)] rounded-2xl border-4 border-dashed flex items-center justify-center transition-colors ${
          busy
            ? "border-cyan-400/80 bg-cyan-500/10"
            : "border-orange-400/80 bg-orange-500/10 backdrop-blur-sm"
        }`}
      >
        <div className="text-center px-6">
          <Upload size={56} className={`mx-auto mb-3 ${busy ? "text-cyan-300 animate-pulse" : "text-orange-300"}`} />
          <div className="text-xl font-semibold text-white tracking-wide mb-1">
            {busy ? "Importing…" : "Drop to import"}
          </div>
          <div className="text-xs text-slate-300/90">
            STL · OBJ · 3MF · GLB · SVG · ZIP
          </div>
        </div>
      </div>
    </div>
  );
}

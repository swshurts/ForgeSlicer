// Project-level action handlers extracted from TopToolbar.jsx.
//
// Each function receives the dependencies it needs (store actions,
// busy-state setter) as arguments — that keeps them framework-free
// and unit-testable. The toolbar binds them inside the component body
// via a single `useProjectActions` hook that returns the bundle.
//
// Why pull these out:
//   • TopToolbar.jsx was 684 lines; the handlers were duplicating each
//     other's try/finally/setBusyMsg shape.
//   • A future "command palette" feature can re-use these handlers
//     without depending on the toolbar component.

import {
  saveProjectJSON, openFileDialog,
  importSTLFile, importOBJFile, import3MFFile, readFileAsText,
  downloadBlob,
} from "../../lib/exporters";
import { combineTwoAsync, exportSTLBytesAsync, export3MFBytesAsync } from "../../lib/workerClient";

export function makeProjectActions({ store, setBusyMsg }) {
  // `store` is the zustand HOOK (`useScene`). We want a non-hook
  // accessor for use inside event handlers — calling the hook directly
  // (e.g. `useScene()` from a click handler) invokes Zustand's
  // useSyncExternalStore + useCallback machinery outside a render
  // context, which React 19 production rejects with the cryptic
  // "Minified React error #321" (invalid hook call). Always go through
  // `.getState()` instead. The fallback path handles tests / other
  // callers that pass a plain object or a custom getter.
  const get = (() => {
    if (typeof store === "function" && typeof store.getState === "function") {
      return () => store.getState();
    }
    if (typeof store === "function") return store;
    return () => store;
  })();

  return {
    // ---- Boolean (union / subtract / intersect of last two or selected) ----
    doBool: async (op) => {
      const s = get();
      const { objects, selectedId, replaceObjects } = s;
      if (objects.length < 2) {
        // Browser confirm() is intentional — the toolbar isn't the place
        // to introduce a dedicated alert dialog component just for this.
        // Falls back to console if no DOM (e.g. jest jsdom).
        if (typeof window !== "undefined" && window.alert) {
          window.alert("Select at least two objects (we use the last two added).");
        }
        return;
      }
      const a = selectedId ? objects.find((o) => o.id === selectedId) : objects[objects.length - 2];
      const b = objects[objects.length - 1] === a ? objects[objects.length - 2] : objects[objects.length - 1];
      setBusyMsg("Computing...");
      try {
        const merged = await combineTwoAsync(a, b, op);
        replaceObjects([a.id, b.id], [{
          name: `${a.name} ${op === "union" ? "∪" : op === "subtract" ? "∖" : "∩"} ${b.name}`,
          type: "imported",
          modifier: "positive",
          visible: true,
          locked: false,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          dims: {},
          geometry: merged,
          // Skip auto-drop: the merged geometry is already in world
          // space; we do NOT want to translate it back to the bed
          // (that would offset all the carved features).
          __skipAutoDrop: true,
        }]);
      } catch (e) {
        if (typeof window !== "undefined" && window.alert) {
          window.alert("Boolean failed: " + (e.message || e));
        }
      } finally {
        setBusyMsg("");
      }
    },

    // ---- Import STL / OBJ / 3MF / SVG / ZIP ----
    // SVG opens the dedicated dialog (extrude + sizing controls);
    // ZIP opens the per-entry picker (iter-84); mesh formats route
    // through the worker importers.
    handleImport: async () => {
      try {
        const file = await openFileDialog(".stl,.obj,.3mf,.svg,.zip");
        const ext = file.name.split(".").pop().toLowerCase();
        if (ext === "svg") {
          const text = await file.text();
          window.dispatchEvent(new CustomEvent("forgeslicer:import-svg", { detail: { text, name: file.name } }));
          return;
        }
        if (ext === "zip") {
          // Hand off to the ZIP-import dialog (auto-detects mesh
          // bundle vs. OrcaSlicer config bundle and shows the
          // appropriate picker). The dialog calls back per file
          // via the same `addImportedMesh` action used for direct
          // STL/OBJ/3MF imports.
          window.dispatchEvent(new CustomEvent("forgeslicer:import-zip", { detail: { file } }));
          return;
        }
        setBusyMsg("Importing...");
        // Iter-94 — if it's a 3MF, capture the original bytes BEFORE
        // dispatching to the parser. The parser flattens to a single
        // mesh of triangles and drops every material / color attribute,
        // so we can't reconstruct them later. OrcaDialog uses these
        // bytes to round-trip color info to OrcaSlicer's desktop app.
        if (ext === "3mf") {
          try {
            const buf = await file.arrayBuffer();
            get().setPristineImport(new Uint8Array(buf), file.name);
          } catch (err) {
            // Non-fatal — if the slice fails the user just loses the
            // color round-trip, the geometry still imports below.
            // eslint-disable-next-line no-console
            console.warn("Couldn't stash pristine 3MF bytes:", err);
          }
        }
        const mesh =
          ext === "obj" ? await importOBJFile(file)
          : ext === "3mf" ? await import3MFFile(file)
          : await importSTLFile(file);
        get().addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
      } catch (e) {
        if (e.message !== "No file selected" && typeof window !== "undefined" && window.alert) {
          window.alert("Import failed: " + e.message);
        }
      } finally { setBusyMsg(""); }
    },

    handleOpenProject: async () => {
      try {
        const file = await openFileDialog(".forge.json,.json");
        const text = await readFileAsText(file);
        const data = JSON.parse(text);
        // Rebuild typed-array geometry buffers — JSON serialization
        // drops the Float32Array / Uint32Array typing, so we must
        // re-wrap them or the renderer rejects the geometry.
        const objs = (data.objects || []).map((o) => {
          if (o.geometry && o.geometry.vertices) {
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
        get().loadProject({ ...data, objects: objs });
      } catch (e) {
        if (e.message !== "No file selected" && typeof window !== "undefined" && window.alert) {
          window.alert("Open failed: " + e.message);
        }
      }
    },

    handleSaveProject: () => {
      const s = get();
      const data = s.serialize();
      const safe = (s.projectName || "project").replace(/[^a-z0-9-_]/gi, "_");
      saveProjectJSON(data, `${safe}.forge.json`);
    },

    handleExportSTL: async () => {
      setBusyMsg("Exporting STL...");
      try {
        const s = get();
        const safe = (s.projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
        const { bytes } = await exportSTLBytesAsync(s.objects);
        downloadBlob(new Blob([bytes], { type: "model/stl" }), `${safe}.stl`);
      } catch (e) {
        // Log the full stack so a future failure isn't just an opaque
        // alert message — saved us hours on the React #321 bug.
        // eslint-disable-next-line no-console
        console.error("[export-stl] failed:", e);
        if (typeof window !== "undefined" && window.alert) window.alert(e.message);
      } finally { setBusyMsg(""); }
    },

    handleExport3MF: async () => {
      setBusyMsg("Exporting 3MF...");
      try {
        const s = get();
        const safe = (s.projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
        const { bytes, multicolor, parts } = await export3MFBytesAsync(s.objects);
        downloadBlob(new Blob([bytes], { type: "model/3mf" }), `${safe}.3mf`);
        if (multicolor && parts > 1) {
          setBusyMsg(`Exported ${parts}-part 3MF`);
          setTimeout(() => setBusyMsg(""), 2500);
        } else {
          setBusyMsg("");
        }
      } catch (e) {
        setBusyMsg("");
        if (typeof window !== "undefined" && window.alert) window.alert(e.message);
      }
    },
  };
}

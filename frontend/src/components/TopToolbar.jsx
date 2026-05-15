import React, { useState } from "react";
import { useScene } from "../lib/store";
import {
  Move3D, RotateCw, Scale3D, Grid3x3, Magnet, Combine, PlusSquare, MinusSquare,
  FileUp, FileDown, Save, Upload, Layers, Globe, Printer, Hexagon, FilePlus2,
  Undo2, Redo2, Ruler,
} from "lucide-react";
import {
  exportSceneToSTL, exportSceneTo3MF, saveProjectJSON, openFileDialog,
  importSTLFile, importOBJFile, readFileAsText, exportSceneToSTLBytes, bytesToBase64,
} from "../lib/exporters";
import { combineTwo } from "../lib/csg";
import { galleryApi } from "../lib/api";
import { Link } from "react-router-dom";

function IconBtn({ active, onClick, title, testid, children, danger, success }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      title={title}
      className={`h-8 w-8 rounded flex items-center justify-center transition-colors ${
        active
          ? "bg-orange-500/20 text-orange-300 border border-orange-500/60"
          : danger
            ? "text-slate-400 hover:text-red-400 hover:bg-slate-800"
            : success
              ? "text-green-400 hover:bg-slate-800"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-6 w-px bg-slate-800 mx-1" />;
}

export default function TopToolbar({ onShare, onSendToOrca }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const setProjectName = useScene((s) => s.setProjectName);
  const transformMode = useScene((s) => s.transformMode);
  const setTransformMode = useScene((s) => s.setTransformMode);
  const snapEnabled = useScene((s) => s.snapEnabled);
  const setSnapEnabled = useScene((s) => s.setSnapEnabled);
  const gridVisible = useScene((s) => s.gridVisible);
  const setGridVisible = useScene((s) => s.setGridVisible);
  const selectedId = useScene((s) => s.selectedId);
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const loadProject = useScene((s) => s.loadProject);
  const clearScene = useScene((s) => s.clearScene);
  const serialize = useScene((s) => s.serialize);
  const addRawObject = useScene((s) => s.addRawObject);
  const removeObject = useScene((s) => s.removeObject);
  const undo = useScene((s) => s.undo);
  const redo = useScene((s) => s.redo);
  const historyLen = useScene((s) => s.history.length);
  const redoLen = useScene((s) => s.redoStack.length);
  const measureMode = useScene((s) => s.measureMode);
  const setMeasureMode = useScene((s) => s.setMeasureMode);

  const [busyMsg, setBusyMsg] = useState("");

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if ((meta && e.key.toLowerCase() === "y") || (meta && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        redo();
      } else if (e.key.toLowerCase() === "m") {
        setMeasureMode(!measureMode);
      } else if (e.key.toLowerCase() === "g") {
        setTransformMode("translate");
      } else if (e.key.toLowerCase() === "r") {
        setTransformMode("rotate");
      } else if (e.key.toLowerCase() === "s") {
        setTransformMode("scale");
      } else if (e.key === "Escape") {
        if (measureMode) setMeasureMode(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, measureMode, setMeasureMode, setTransformMode]);

  const doBool = (op) => {
    // Take last 2 objects: prefer selected as base, last added as other.
    if (objects.length < 2) {
      alert("Select at least two objects (we use the last two added).");
      return;
    }
    const a = selectedId ? objects.find((o) => o.id === selectedId) : objects[objects.length - 2];
    const b = objects[objects.length - 1] === a ? objects[objects.length - 2] : objects[objects.length - 1];
    try {
      const merged = combineTwo(a, b, op);
      // remove both
      removeObject(a.id);
      removeObject(b.id);
      addRawObject({
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
      });
    } catch (e) {
      alert("Boolean failed: " + (e.message || e));
    }
  };

  const handleImport = async () => {
    try {
      const file = await openFileDialog(".stl,.obj");
      setBusyMsg("Importing...");
      const ext = file.name.split(".").pop().toLowerCase();
      const mesh = ext === "obj" ? await importOBJFile(file) : await importSTLFile(file);
      addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
    } catch (e) {
      if (e.message !== "No file selected") alert("Import failed: " + e.message);
    } finally { setBusyMsg(""); }
  };

  const handleOpenProject = async () => {
    try {
      const file = await openFileDialog(".forge.json,.json");
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      // rebuild Float32Array geometry buffers if present
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
      loadProject({ ...data, objects: objs });
    } catch (e) {
      if (e.message !== "No file selected") alert("Open failed: " + e.message);
    }
  };

  const handleSaveProject = () => {
    const data = serialize();
    const safe = (projectName || "project").replace(/[^a-z0-9-_]/gi, "_");
    saveProjectJSON(data, `${safe}.forge.json`);
  };

  const handleExportSTL = () => {
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      exportSceneToSTL(objects, `${safe}.stl`);
    } catch (e) { alert(e.message); }
  };

  const handleExport3MF = async () => {
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      await exportSceneTo3MF(objects, `${safe}.3mf`);
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="h-12 border-b border-slate-800 bg-slate-900 flex items-center px-3 gap-1" data-testid="top-toolbar">
      <Link to="/" className="flex items-center gap-2 px-2 mr-1 select-none" data-testid="brand">
        <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow">
          <Hexagon size={16} className="text-white" strokeWidth={2.4} />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-bold text-white tracking-tight">ForgeSlicer</div>
          <div className="text-[9px] uppercase tracking-widest text-orange-400 -mt-0.5">CAD + Slice</div>
        </div>
      </Link>

      <Divider />

      <IconBtn testid="file-new-btn" onClick={() => { if (confirm("Start a new project? Unsaved changes will be lost.")) clearScene(); }} title="New Project">
        <FilePlus2 size={16} />
      </IconBtn>
      <IconBtn testid="file-open-btn" onClick={handleOpenProject} title="Open Project (.forge.json)">
        <FileUp size={16} />
      </IconBtn>
      <IconBtn testid="file-save-btn" onClick={handleSaveProject} title="Save Project to Local">
        <Save size={16} />
      </IconBtn>
      <IconBtn testid="file-import-btn" onClick={handleImport} title="Import STL / OBJ">
        <Upload size={16} />
      </IconBtn>

      <Divider />

      <IconBtn testid="export-stl-btn" onClick={handleExportSTL} title="Export STL">
        <FileDown size={16} />
        <span className="text-[9px] font-bold ml-0.5">STL</span>
      </IconBtn>
      <IconBtn testid="export-3mf-btn" onClick={handleExport3MF} title="Export 3MF">
        <Layers size={16} />
      </IconBtn>

      <Divider />

      <IconBtn testid="bool-union-btn" onClick={() => doBool("union")} title="Union (merge 2 objects)">
        <PlusSquare size={16} className="text-orange-400" />
      </IconBtn>
      <IconBtn testid="bool-subtract-btn" onClick={() => doBool("subtract")} title="Subtract (A - B of last two)">
        <MinusSquare size={16} className="text-cyan-400" />
      </IconBtn>
      <IconBtn testid="bool-intersect-btn" onClick={() => doBool("intersect")} title="Intersect (last two)">
        <Combine size={16} />
      </IconBtn>

      <Divider />

      <IconBtn active={transformMode === "translate"} testid="mode-translate-btn" onClick={() => setTransformMode("translate")} title="Translate (G)">
        <Move3D size={16} />
      </IconBtn>
      <IconBtn active={transformMode === "rotate"} testid="mode-rotate-btn" onClick={() => setTransformMode("rotate")} title="Rotate (R)">
        <RotateCw size={16} />
      </IconBtn>
      <IconBtn active={transformMode === "scale"} testid="mode-scale-btn" onClick={() => setTransformMode("scale")} title="Scale (S)">
        <Scale3D size={16} />
      </IconBtn>
      <IconBtn active={snapEnabled} testid="toggle-snap-btn" onClick={() => setSnapEnabled(!snapEnabled)} title="Toggle snapping">
        <Magnet size={16} />
      </IconBtn>
      <IconBtn active={gridVisible} testid="toggle-grid-btn" onClick={() => setGridVisible(!gridVisible)} title="Toggle grid">
        <Grid3x3 size={16} />
      </IconBtn>

      <Divider />

      <IconBtn
        testid="undo-btn"
        onClick={undo}
        title="Undo (Ctrl+Z)"
        active={false}
      >
        <Undo2 size={16} className={historyLen === 0 ? "opacity-30" : ""} />
      </IconBtn>
      <IconBtn
        testid="redo-btn"
        onClick={redo}
        title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        active={false}
      >
        <Redo2 size={16} className={redoLen === 0 ? "opacity-30" : ""} />
      </IconBtn>
      <IconBtn
        active={measureMode}
        testid="measure-mode-btn"
        onClick={() => setMeasureMode(!measureMode)}
        title="Measure (M) — click two points to measure distance"
      >
        <Ruler size={16} />
      </IconBtn>

      <div className="flex-1" />

      <input
        data-testid="project-name-input"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        className="h-8 w-48 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none font-mono"
        placeholder="project name"
      />

      <Link
        to="/gallery"
        data-testid="open-gallery-btn"
        className="h-8 px-3 ml-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700"
      >
        <Globe size={14} /> Gallery
      </Link>
      <button
        data-testid="share-design-btn"
        onClick={onShare}
        className="h-8 px-3 ml-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700"
      >
        <Globe size={14} /> Share
      </button>
      <button
        data-testid="send-to-orcaslicer-btn"
        onClick={onSendToOrca}
        className="h-8 px-3 ml-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5 shadow"
      >
        <Printer size={14} /> Send to OrcaSlicer
      </button>
      {busyMsg && (
        <span className="ml-2 text-xs text-orange-400 font-mono">{busyMsg}</span>
      )}
    </div>
  );
}

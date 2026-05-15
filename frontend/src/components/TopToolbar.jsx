import React, { useState, useRef } from "react";
import { useScene } from "../lib/store";
import {
  Move3D, RotateCw, Scale3D, Grid3x3, Magnet, Combine, PlusSquare, MinusSquare,
  FileUp, FileDown, Save, Upload, Layers, Globe, Printer, Hexagon, FilePlus2,
  Undo2, Redo2, Ruler, MapPin, Maximize, Sliders,
} from "lucide-react";
import {
  saveProjectJSON, openFileDialog,
  importSTLFile, importOBJFile, import3MFFile, readFileAsText, exportSceneToSTLBytes, bytesToBase64,
  downloadBlob,
} from "../lib/exporters";
import { combineTwoAsync, exportSTLBytesAsync, export3MFBytesAsync } from "../lib/workerClient";
import { galleryApi } from "../lib/api";
import { getSlicersForPrinter } from "../lib/presets";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { PositionPopover, RotationPopover, ScalePopover, SlicerPopover } from "./ActionPopovers";

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
  const printerId = useScene((s) => s.printerId);
  const slicers = getSlicersForPrinter(printerId);
  const primarySlicer = slicers[0] || { id: "orca", name: "OrcaSlicer" };
  const alternateSlicers = slicers.slice(1);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);

  const [busyMsg, setBusyMsg] = useState("");
  const [openPopover, setOpenPopover] = useState(null); // 'position' | 'rotation' | 'scale' | 'slicer' | null
  const posBtnRef = useRef(null);
  const rotBtnRef = useRef(null);
  const sclBtnRef = useRef(null);
  const slcBtnRef = useRef(null);
  const togglePopover = (name) => setOpenPopover((cur) => (cur === name ? null : name));

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

  const doBool = async (op) => {
    // Take last 2 objects: prefer selected as base, last added as other.
    if (objects.length < 2) {
      alert("Select at least two objects (we use the last two added).");
      return;
    }
    const a = selectedId ? objects.find((o) => o.id === selectedId) : objects[objects.length - 2];
    const b = objects[objects.length - 1] === a ? objects[objects.length - 2] : objects[objects.length - 1];
    setBusyMsg("Computing...");
    try {
      const merged = await combineTwoAsync(a, b, op);
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
    } finally {
      setBusyMsg("");
    }
  };

  const handleImport = async () => {
    try {
      const file = await openFileDialog(".stl,.obj,.3mf");
      setBusyMsg("Importing...");
      const ext = file.name.split(".").pop().toLowerCase();
      const mesh =
        ext === "obj" ? await importOBJFile(file)
        : ext === "3mf" ? await import3MFFile(file)
        : await importSTLFile(file);
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

  const handleExportSTL = async () => {
    setBusyMsg("Exporting STL...");
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      const { bytes } = await exportSTLBytesAsync(objects);
      downloadBlob(new Blob([bytes], { type: "model/stl" }), `${safe}.stl`);
    } catch (e) { alert(e.message); }
    finally { setBusyMsg(""); }
  };

  const handleExport3MF = async () => {
    setBusyMsg("Exporting 3MF...");
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      const { bytes, multicolor, parts } = await export3MFBytesAsync(objects);
      downloadBlob(new Blob([bytes], { type: "model/3mf" }), `${safe}.3mf`);
      if (multicolor && parts > 1) {
        setBusyMsg(`Exported ${parts}-part 3MF`);
        setTimeout(() => setBusyMsg(""), 2500);
      } else {
        setBusyMsg("");
      }
    } catch (e) {
      setBusyMsg("");
      alert(e.message);
    }
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
      <IconBtn testid="file-import-btn" onClick={handleImport} title="Import STL / OBJ / 3MF">
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

      <Divider />

      {/* Quick-access popover buttons for the most-edited transforms + slicer
          settings — replaces the need to scroll the right panel. */}
      <button
        ref={posBtnRef}
        data-testid="menu-position-btn"
        onClick={() => togglePopover("position")}
        disabled={!selectedId}
        title="Position (X / Y / Z mm)"
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          openPopover === "position"
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <MapPin size={12} /> Position
      </button>
      <button
        ref={rotBtnRef}
        data-testid="menu-rotation-btn"
        onClick={() => togglePopover("rotation")}
        disabled={!selectedId}
        title="Rotation (degrees)"
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          openPopover === "rotation"
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <RotateCw size={12} /> Rotation
      </button>
      <button
        ref={sclBtnRef}
        data-testid="menu-scale-btn"
        onClick={() => togglePopover("scale")}
        disabled={!selectedId}
        title="Scale & Real Size (percent or mm) with aspect lock"
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          openPopover === "scale"
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <Maximize size={12} /> Size
      </button>
      <button
        ref={slcBtnRef}
        data-testid="menu-slicer-btn"
        onClick={() => togglePopover("slicer")}
        title="Slicer settings & Export GCODE"
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          openPopover === "slicer"
            ? "bg-green-500/20 border-green-500/60 text-green-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <Sliders size={12} /> Slicer
      </button>

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
        onClick={() => onSendToOrca(primarySlicer)}
        className="h-8 px-3 ml-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-l flex items-center gap-1.5 shadow"
        title={`Send to ${primarySlicer.name} (recommended for your printer)`}
      >
        <Printer size={14} /> Send to {primarySlicer.name}
      </button>
      {alternateSlicers.length > 0 && (
        <div className="relative">
          <button
            data-testid="send-slicer-menu-btn"
            onClick={() => setSendMenuOpen((v) => !v)}
            onBlur={() => setTimeout(() => setSendMenuOpen(false), 150)}
            className="h-8 px-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-r border-l border-orange-700 flex items-center shadow"
            title="Choose a different slicer"
          >
            <ChevronDown size={14} />
          </button>
          {sendMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded shadow-xl z-50 min-w-[180px]" data-testid="send-slicer-menu">
              {alternateSlicers.map((s) => (
                <button
                  key={s.id}
                  data-testid={`send-slicer-option-${s.id}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSendMenuOpen(false);
                    onSendToOrca(s);
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2"
                >
                  <Printer size={12} className="text-orange-400" /> {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {busyMsg && (
        <span className="ml-2 text-xs text-orange-400 font-mono">{busyMsg}</span>
      )}
      {openPopover === "position" && (
        <PositionPopover anchor={posBtnRef.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "rotation" && (
        <RotationPopover anchor={rotBtnRef.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "scale" && (
        <ScalePopover anchor={sclBtnRef.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "slicer" && (
        <SlicerPopover anchor={slcBtnRef.current} onClose={() => setOpenPopover(null)} />
      )}
    </div>
  );
}

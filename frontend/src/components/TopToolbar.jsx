import React, { useState, useRef } from "react";
import { useScene } from "../lib/store";
import {
  Move3D, RotateCw, Scale3D, Grid3x3, Magnet, Combine, PlusSquare, MinusSquare,
  FileUp, FileDown, Save, Upload, Layers, Globe, Printer, Hexagon, FilePlus2,
  Undo2, Redo2, Ruler, MapPin, Maximize, Sliders, Copy, FlipHorizontal2, Scissors,
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
import { PositionPopover, RotationPopover, ScalePopover, SlicerPopover, DuplicatePopover, MirrorPopover } from "./ActionPopovers";
import STLPreviewDialog from "./STLPreviewDialog";
import VoiceButton from "./VoiceButton";
import UserMenu from "./UserMenu";
import { Eye, Library, CircleHelp, Sparkles, Box, Circle, Cylinder, Cone, Triangle, Hexagon as HexIcon, Square, Plus } from "lucide-react";

// Inline Add-Primitive dropdown that drops new objects into the scene
// from the toolbar without forcing the user to open the left panel. The
// most-used primitives surface here; advanced ones (Slot composite, 2D
// wafers, etc.) still live in the left panel.
function AddPrimitiveButton() {
  const [open, setOpen] = useState(false);
  const addPrimitive = useScene((s) => s.addPrimitive);
  const PRIMITIVES = [
    { type: "cube",      label: "Cube",      Icon: Box },
    { type: "sphere",    label: "Sphere",    Icon: Circle },
    { type: "cylinder",  label: "Cylinder",  Icon: Cylinder },
    { type: "cone",      label: "Cone",      Icon: Cone },
    { type: "torus",     label: "Torus",     Icon: HexIcon },
    { type: "circle",    label: "2D Circle (extrude later)", Icon: Circle },
    { type: "square2d",  label: "2D Square (extrude later)", Icon: Square },
    { type: "triangle",  label: "2D Triangle (extrude later)", Icon: Triangle },
  ];
  return (
    <div className="relative">
      <button
        data-testid="add-primitive-btn"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title="Add a primitive shape"
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          open
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <Plus size={12} /> Add <ChevronDown size={10} />
      </button>
      {open && (
        <div
          data-testid="add-primitive-menu"
          className="absolute left-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded shadow-xl z-50 min-w-[220px] py-1"
        >
          {PRIMITIVES.map(({ type, label, Icon }) => (
            <button
              key={type}
              data-testid={`add-primitive-${type}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                addPrimitive(type);
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
            >
              <Icon size={13} className="text-orange-400 flex-shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

export default function TopToolbar({ onShare, onSendToOrca, onSaveComponent, onOpenHelp }) {
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
  const replaceObjects = useScene((s) => s.replaceObjects);
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
  const [openPopover, setOpenPopover] = useState(null); // 'position' | 'rotation' | 'scale' | 'slicer' | 'duplicate' | 'mirror' | null
  const posBtnRef = useRef(null);
  const rotBtnRef = useRef(null);
  const sclBtnRef = useRef(null);
  const slcBtnRef = useRef(null);
  const dupBtnRef = useRef(null);
  const mirBtnRef = useRef(null);
  const cutBtnRef = useRef(null);
  const togglePopover = (name) => {
    setOpenPopover((cur) => (cur === name ? null : name));
    // Keep the 3D gizmo in sync with the popover the user is editing — most
    // people expect clicking POSITION to set the gizmo to translate (etc.)
    // rather than only opening a numeric popup.
    if (name === "position") setTransformMode("translate");
    else if (name === "rotation") setTransformMode("rotate");
    else if (name === "scale") setTransformMode("scale");
  };
  const selectedIds = useScene((s) => s.selectedIds);
  const selectionCount = selectedIds && selectedIds.length ? selectedIds.length : (selectedId ? 1 : 0);
  const cutMode = useScene((s) => s.cutMode);
  const setCutMode = useScene((s) => s.setCutMode);
  const removeSelected = useScene((s) => s.removeSelected);
  const duplicateSelected = useScene((s) => s.duplicateSelected);
  const clearSelection = useScene((s) => s.clearSelection);
  const [stlPreviewOpen, setStlPreviewOpen] = useState(false);

  // Keyboard shortcuts. We deliberately read store state INSIDE the
  // handler via useScene.getState() so the effect only mounts/unmounts
  // once (no stale closure issues + only one listener on window). The
  // alternative — listing every store action as a dependency — generated a
  // 9-deps lint warning AND caused the effect to re-attach on every render.
  React.useEffect(() => {
    const handler = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const meta = e.ctrlKey || e.metaKey;
      const s = useScene.getState();
      const count = (s.selectedIds && s.selectedIds.length) ? s.selectedIds.length : (s.selectedId ? 1 : 0);
      if (meta && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.undo();
      } else if ((meta && e.key.toLowerCase() === "y") || (meta && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        s.redo();
      } else if (meta && e.key.toLowerCase() === "d") {
        if (count > 0) {
          e.preventDefault();
          s.duplicateSelected({});
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (count > 0) {
          e.preventDefault();
          s.removeSelected();
        }
      } else if (e.key.toLowerCase() === "m") {
        s.setMeasureMode(!s.measureMode);
      } else if (e.key.toLowerCase() === "g") {
        s.setTransformMode("translate");
      } else if (e.key.toLowerCase() === "r") {
        s.setTransformMode("rotate");
      } else if (e.key.toLowerCase() === "s") {
        s.setTransformMode("scale");
      } else if (e.key === "Escape") {
        if (s.measureMode) s.setMeasureMode(false);
        else s.clearSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
      // Atomic remove-A + remove-B + add-merged in a single history step so
      // Ctrl-Z restores the scene exactly as it was before the boolean.
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
        // Skip auto-drop: the merged geometry is already in world space; we
        // do NOT want to translate it back to the bed (that would offset all
        // the carved features).
        __skipAutoDrop: true,
      }]);
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
    <div className="border-b border-slate-800 bg-slate-900" data-testid="top-toolbar">
      {/* ROW 1 — System / global actions: brand, file I/O, share, slicer
          send, project name, voice mic, what's new, help, user menu. */}
      <div className="h-12 flex items-center px-3 gap-1" data-testid="top-toolbar-row-system">
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
      <IconBtn testid="stl-preview-btn" onClick={() => setStlPreviewOpen(true)} title="Preview the export in 3D (verify carves before slicing)">
        <Eye size={16} />
      </IconBtn>

      <div className="flex-1" />

      <VoiceButton />

      <input
        data-testid="project-name-input"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        className="h-8 w-48 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none font-mono ml-1"
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
        data-testid="save-component-btn"
        onClick={onSaveComponent}
        disabled={objects.length === 0}
        className="h-8 px-3 ml-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
        title="Save current scene as a reusable component to the public library"
      >
        <Library size={14} /> Component
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
      <button
        data-testid="whats-new-btn"
        onClick={() => window.dispatchEvent(new CustomEvent("forgeslicer:show-splash"))}
        title="What's new"
        className="h-8 w-8 ml-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 flex items-center justify-center"
      >
        <Sparkles size={16} />
      </button>
      <button
        data-testid="help-btn"
        onClick={onOpenHelp}
        title="Help & User Manual (?)"
        className="h-8 w-8 ml-1 rounded text-slate-400 hover:text-orange-300 hover:bg-slate-800 flex items-center justify-center"
      >
        <CircleHelp size={16} />
      </button>
      <UserMenu returnPath="/workspace" />
      </div>
      {/* ROW 2 — Object / scene editing: booleans, transform gizmo,
          history, measure, plus the object-control popovers (position,
          rotation, size, duplicate, mirror, cut) and slicer settings. */}
      <div className="h-11 flex items-center px-3 gap-1 border-t border-slate-800/60 bg-slate-900/60" data-testid="top-toolbar-row-edit">
      <AddPrimitiveButton />

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

      {/* Object-edit popovers: Position / Rotation / Size / Duplicate /
          Mirror / Cut / Slicer — these were the items the user kept
          getting clipped off the original single-row toolbar. */}
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
        ref={dupBtnRef}
        data-testid="menu-duplicate-btn"
        onClick={() => togglePopover("duplicate")}
        disabled={selectionCount === 0}
        title={selectionCount > 1 ? `Duplicate ${selectionCount} selected components (with optional mirror)` : "Duplicate selected component (with optional mirror)"}
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          openPopover === "duplicate"
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <Copy size={12} />
        {selectionCount > 1
          ? <>Duplicate <span className="ml-0.5 text-[10px] text-orange-300">({selectionCount})</span></>
          : "Duplicate"}
      </button>
      <button
        ref={mirBtnRef}
        data-testid="menu-mirror-btn"
        onClick={() => togglePopover("mirror")}
        disabled={selectionCount === 0}
        title="Mirror in-place on X / Y / Z (flips the selected object without duplicating)"
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          openPopover === "mirror"
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <FlipHorizontal2 size={12} /> Mirror
      </button>
      <button
        ref={cutBtnRef}
        data-testid="menu-cut-btn"
        onClick={() => setCutMode(!cutMode)}
        disabled={selectionCount === 0}
        title="Cut the selected object(s) with an adjustable plane (split into pieces)"
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          cutMode
            ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <Scissors size={12} /> Cut
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
      </div>

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
      {openPopover === "duplicate" && (
        <DuplicatePopover anchor={dupBtnRef.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "mirror" && (
        <MirrorPopover anchor={mirBtnRef.current} onClose={() => setOpenPopover(null)} />
      )}
      <STLPreviewDialog open={stlPreviewOpen} onClose={() => setStlPreviewOpen(false)} />
    </div>
  );
}

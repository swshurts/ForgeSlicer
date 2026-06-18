// Top toolbar — edit row.
//
// Second row of the toolbar: AddPrimitive + Sketch toggles, booleans,
// transform mode (translate/rotate/scale), snap/grid toggles, undo/redo,
// measure mode, then the seven popover triggers
// (Position / Rotation / Size / Duplicate / Mirror / Cut / Slicer).
//
// The seven popover buttons used to be 7 nearly-identical 18-line
// blocks; they're now driven from a single `popoverDefs` array fed
// through `TabPillButton`. Same DOM, same behaviour.
import React from "react";
import {
  PlusSquare, MinusSquare, Combine, Move3D, RotateCw, Scale3D,
  Magnet, Grid3x3, Undo2, Redo2, Ruler, Anchor,
  MapPin, Maximize, Copy, FlipHorizontal2, Scissors, Sliders,
  Settings2,
} from "lucide-react";
import { useScene } from "../../lib/store";
import { IconBtn, Divider, TabPillButton } from "./ToolbarUI";
import AddPrimitiveButton from "./AddPrimitiveButton";
import SketchButton from "./SketchButton";

export default function EditRow({
  doBool,
  openPopover, togglePopover,
  popoverRefs,
  selectedId, selectionCount,
  cutMode, setCutMode,
}) {
  const transformMode = useScene((s) => s.transformMode);
  const setTransformMode = useScene((s) => s.setTransformMode);
  // When the user clicks Position / Rotation / Size in the popover row
  // we ALSO switch the on-bed gizmo to the matching transform mode so
  // the two stay in lockstep — users were getting confused seeing
  // translate-arrows on the bed while editing rotation values. Cut /
  // Slicer / Duplicate / Mirror don't have a corresponding gizmo mode
  // so they leave the gizmo alone.
  const POPOVER_TO_GIZMO = { position: "translate", rotation: "rotate", scale: "scale" };
  const handlePopoverClick = (id) => {
    const mode = POPOVER_TO_GIZMO[id];
    if (mode) setTransformMode(mode);
    togglePopover(id);
  };
  const snapEnabled = useScene((s) => s.snapEnabled);
  const setSnapEnabled = useScene((s) => s.setSnapEnabled);
  const gridVisible = useScene((s) => s.gridVisible);
  const setGridVisible = useScene((s) => s.setGridVisible);
  const undo = useScene((s) => s.undo);
  const redo = useScene((s) => s.redo);
  const historyLen = useScene((s) => s.history.length);
  const redoLen = useScene((s) => s.redoStack.length);
  const measureMode = useScene((s) => s.measureMode);
  const setMeasureMode = useScene((s) => s.setMeasureMode);
  const rulerMode = useScene((s) => s.rulerMode);
  const setRulerMode = useScene((s) => s.setRulerMode);
  const clearRulerAnchor = useScene((s) => s.clearRulerAnchor);

  // Single source of truth for the seven popover buttons. Adding a new
  // popover means adding one entry here + a render case in TopToolbar.
  const popoverDefs = [
    { id: "position",  refKey: "pos", testid: "menu-position-btn",  icon: MapPin,           label: "Position",  title: "Position (X / Y / Z mm)",                              disabled: !selectedId },
    { id: "rotation",  refKey: "rot", testid: "menu-rotation-btn",  icon: RotateCw,         label: "Rotation",  title: "Rotation (degrees)",                                    disabled: !selectedId },
    { id: "scale",     refKey: "scl", testid: "menu-scale-btn",     icon: Maximize,         label: "Size",      title: "Scale & Real Size (percent or mm) with aspect lock",   disabled: !selectedId },
    {
      id: "duplicate", refKey: "dup", testid: "menu-duplicate-btn", icon: Copy,
      label: "Duplicate",
      badge: selectionCount > 1 ? selectionCount : null,
      title: selectionCount > 1
        ? `Duplicate ${selectionCount} selected components (with optional mirror)`
        : "Duplicate selected component (with optional mirror)",
      disabled: selectionCount === 0,
    },
    { id: "mirror",    refKey: "mir", testid: "menu-mirror-btn",    icon: FlipHorizontal2,  label: "Mirror",    title: "Mirror in-place on X / Y / Z (flips the selected object without duplicating)", disabled: selectionCount === 0 },
  ];

  return (
    <div
      className="min-h-11 flex flex-wrap items-center px-3 gap-y-1 gap-x-1 py-1 border-t border-slate-800/60 bg-slate-900/60"
      data-testid="top-toolbar-row-edit"
    >
      <AddPrimitiveButton />
      <SketchButton />

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
      {/* Iter-103 — Settings cog next to snap/grid. Opens the
          Snap & Design-plate popover (configurable snap step values
          and the user-defined oversized modelling envelope). */}
      <button
        ref={popoverRefs.snp}
        data-testid="snap-plate-settings-btn"
        onClick={() => togglePopover("snap")}
        title="Snap step & design plate settings"
        className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${
          openPopover === "snap"
            ? "bg-slate-800 text-orange-300"
            : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
        }`}
      >
        <Settings2 size={13} />
      </button>

      <Divider />

      <IconBtn testid="undo-btn" onClick={undo} title="Undo (Ctrl+Z)">
        <Undo2 size={16} className={historyLen === 0 ? "opacity-30" : ""} />
      </IconBtn>
      <IconBtn testid="redo-btn" onClick={redo} title="Redo (Ctrl+Y / Ctrl+Shift+Z)">
        <Redo2 size={16} className={redoLen === 0 ? "opacity-30" : ""} />
      </IconBtn>
      <IconBtn active={measureMode} testid="measure-mode-btn" onClick={() => setMeasureMode(!measureMode)} title="Measure (M) — click two points to measure distance">
        <Ruler size={16} />
      </IconBtn>
      <IconBtn
        active={rulerMode}
        testid="ruler-anchor-mode-btn"
        onClick={() => {
          // Mode ON -> OFF: also drop any stale anchor so re-toggling
          // doesn't resurrect the old one. Verified by iter-30 testing
          // agent (T8) — without this, rulerAnchor stayed populated.
          if (rulerMode) clearRulerAnchor();
          setRulerMode(!rulerMode);
        }}
        title="Anchor Ruler — click an object to drop a 0-point on the bed, then read offsets to other parts"
      >
        <Anchor size={16} />
      </IconBtn>

      <Divider />

      {/* Object-edit popovers driven from popoverDefs. */}
      {popoverDefs.map((p) => (
        <TabPillButton
          key={p.id}
          ref={popoverRefs[p.refKey]}
          testid={p.testid}
          icon={p.icon}
          label={p.label}
          badge={p.badge}
          title={p.title}
          disabled={p.disabled}
          active={openPopover === p.id}
          onClick={() => handlePopoverClick(p.id)}
        />
      ))}

      {/* Cut — uses cut mode (amber) rather than the popover state. */}
      <TabPillButton
        ref={popoverRefs.cut}
        testid="menu-cut-btn"
        icon={Scissors}
        label="Cut"
        title="Cut the selected object(s) with an adjustable plane (split into pieces)"
        disabled={selectionCount === 0}
        active={cutMode}
        variant="amber"
        onClick={() => setCutMode(!cutMode)}
      />

      {/* Slicer — green variant marks it as the primary CTA. */}
      <TabPillButton
        ref={popoverRefs.slc}
        testid="menu-slicer-btn"
        icon={Sliders}
        label="Slicer"
        title="Slicer settings & Export GCODE"
        active={openPopover === "slicer"}
        variant="green"
        onClick={() => togglePopover("slicer")}
      />
    </div>
  );
}

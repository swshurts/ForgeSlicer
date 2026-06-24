// TopToolbar — thin composition shell for the workspace's two header rows.
//
// History:
//   Before 1.13 this file was 684 lines of inline JSX + handlers. The
//   1.13 refactor split it into:
//     • toolbar/ToolbarUI.jsx           shared IconBtn / Divider / TabPillButton
//     • toolbar/projectActions.js       file I/O + boolean handlers
//     • toolbar/useToolbarShortcuts.js  keyboard shortcuts
//     • toolbar/SystemRow.jsx           row 1 (brand, file, exports, share, slicer-send)
//     • toolbar/EditRow.jsx             row 2 (primitives, booleans, transforms, popovers)
//     • toolbar/SketchButton.jsx        sketch-mode toggle
//     • toolbar/AddPrimitiveButton.jsx  inline add-primitive dropdown
//   This file now only:
//     1. Owns the popover state + refs (so a click outside any popover
//        closes it, and the popover anchors to the right button).
//     2. Mounts the popover components conditionally.
//     3. Threads handlers + dialog callbacks down to the rows.
//   Zero behaviour change — visual diff against pre-refactor is empty.

import React, { useState, useRef } from "react";
import { useScene } from "../lib/store";
import {
  PositionPopover, RotationPopover, ScalePopover,
  SlicerPopover, DuplicatePopover, MirrorPopover, AlignPopover, SnapAndPlatePopover,
} from "./popovers";
import STLPreviewDialog from "./STLPreviewDialog";
import SystemRow from "./toolbar/SystemRow";
import EditRow from "./toolbar/EditRow";
import ProjectBreadcrumb from "./ProjectBreadcrumb";
import { makeProjectActions } from "./toolbar/projectActions";
import { useToolbarShortcuts } from "./toolbar/useToolbarShortcuts";

export default function TopToolbar({ onShare, onSendToOrca, onSaveComponent, onOpenHelp, onOpenProjectExplorer, projectMetas }) {
  // Cross-row UI state — only the things both rows need lived at this
  // level pre-refactor. Now those same items live here while everything
  // self-contained moved into the child rows.
  const [busyMsg, setBusyMsg] = useState("");
  const [openPopover, setOpenPopover] = useState(null);
  const [stlPreviewOpen, setStlPreviewOpen] = useState(false);
  // Cut mode lives in the global store so the CutHUD overlay and the
  // CutPlaneGizmo in the viewport (both Workspace-level children, not
  // children of this toolbar) can observe it. Wiring it here as local
  // useState would silently break the Cut tool — clicking the toolbar
  // pill would highlight amber but never show the plane or HUD.
  const cutMode = useScene((s) => s.cutMode);
  const setCutMode = useScene((s) => s.setCutMode);

  // Selection state used by both rows.
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds || []);
  const selectionCount = selectedIds.length > 0 ? selectedIds.length : (selectedId ? 1 : 0);

  // Popover anchor refs. Each row gets the same bundle so we can move
  // a popover trigger to either row without rewiring.
  const popoverRefs = {
    pos: useRef(null),
    rot: useRef(null),
    scl: useRef(null),
    dup: useRef(null),
    mir: useRef(null),
    aln: useRef(null),
    cut: useRef(null),
    slc: useRef(null),
    snp: useRef(null),
  };

  const togglePopover = (id) => setOpenPopover((cur) => (cur === id ? null : id));

  // Project-level actions (import, save, export, boolean) live in a
  // factory so the same bundle can be reused by a future command-palette
  // / voice flow without depending on this component tree.
  const actions = makeProjectActions({ store: useScene, setBusyMsg });
  useToolbarShortcuts();

  return (
    <div
      className="bg-slate-900 border-b border-slate-800 flex-shrink-0"
      data-testid="top-toolbar"
    >
      <SystemRow
        busyMsg={busyMsg}
        actions={actions}
        onShare={onShare}
        onSaveComponent={onSaveComponent}
        onSendToOrca={onSendToOrca}
        onOpenHelp={onOpenHelp}
        onPreviewExport={() => setStlPreviewOpen(true)}
        onOpenProjectExplorer={onOpenProjectExplorer}
      />
      {/* Hierarchical breadcrumb — only visible when the scene is
          linked to a project (post-Open / post-Save-here). Click any
          ancestor segment to jump to that project's scene. */}
      <ProjectBreadcrumb projectMetas={projectMetas} />
      <EditRow
        doBool={actions.doBool}
        openPopover={openPopover}
        togglePopover={togglePopover}
        popoverRefs={popoverRefs}
        selectedId={selectedId}
        selectionCount={selectionCount}
        cutMode={cutMode}
        setCutMode={setCutMode}
      />

      {openPopover === "position" && (
        <PositionPopover anchor={popoverRefs.pos.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "rotation" && (
        <RotationPopover anchor={popoverRefs.rot.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "scale" && (
        <ScalePopover anchor={popoverRefs.scl.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "slicer" && (
        <SlicerPopover anchor={popoverRefs.slc.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "duplicate" && (
        <DuplicatePopover anchor={popoverRefs.dup.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "mirror" && (
        <MirrorPopover anchor={popoverRefs.mir.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "align" && (
        <AlignPopover anchor={popoverRefs.aln.current} onClose={() => setOpenPopover(null)} />
      )}
      {openPopover === "snap" && (
        <SnapAndPlatePopover anchor={popoverRefs.snp.current} onClose={() => setOpenPopover(null)} />
      )}
      <STLPreviewDialog open={stlPreviewOpen} onClose={() => setStlPreviewOpen(false)} />
    </div>
  );
}

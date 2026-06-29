// Global keyboard shortcuts for the toolbar.
//
// Extracted to a hook so TopToolbar.jsx doesn't carry the 40-line
// useEffect inline. The handler reads store state fresh on every
// keypress via `useScene.getState()` so the effect only mounts once
// and never goes stale on store updates — the old inline version
// relied on the same pattern.
//
// Active shortcuts:
//   Ctrl/Cmd+Z          undo
//   Ctrl/Cmd+Y          redo
//   Ctrl/Cmd+Shift+Z    redo (mac convention)
//   Ctrl/Cmd+D          duplicate selection
//   Delete / Backspace  remove selection
//   M                   toggle measure mode
//   G                   set gizmo to translate
//   R                   set gizmo to rotate
//   S                   set gizmo to scale
//
// Inputs / textareas / selects are skipped so typing in form fields
// never triggers a shortcut by accident.
import { useEffect } from "react";
import { useScene } from "../../lib/store";

export function useToolbarShortcuts() {
  useEffect(() => {
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
      } else if (e.key === "Escape") {
        // Cleanup keyboard escape: dismiss anchor first, then pending
        // dimension pick, then snap-to-face mode, then drop selection.
        // We bail out of only ONE layer per Esc press so the user can
        // step back through.
        if (s.rulerAnchor) { s.clearRulerAnchor(); }
        else if (s.pendingDimensionFromId) { s.clearPendingComponentDimension(); }
        else if (s.placeOnFaceMode) { s.setPlaceOnFaceMode(false); }
        else if (s.measureMode) { s.setMeasureMode(false); }
      } else if (e.key.toLowerCase() === "g") {
        s.setTransformMode("translate");
      } else if (e.key.toLowerCase() === "r") {
        s.setTransformMode("rotate");
      } else if (e.key.toLowerCase() === "s") {
        s.setTransformMode("scale");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

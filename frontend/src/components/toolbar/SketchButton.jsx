// Sketch-mode toggle button.
//
// Flips the global `sketchMode` flag — the actual 2D drawing surface
// lives in `SketchOverlay.jsx`. Active state shows as solid orange to
// match the rest of the workspace's "I'm in a different mode" cue.
import React from "react";
import { Pencil } from "lucide-react";
import { useScene } from "../../lib/store";

export default function SketchButton() {
  const sketchMode = useScene((s) => s.sketchMode);
  const setSketchMode = useScene((s) => s.setSketchMode);
  return (
    <button
      data-testid="sketch-toggle-btn"
      onClick={() => setSketchMode(!sketchMode)}
      title="Sketch mode — draw a 2D shape on the build plate to extrude into 3D"
      className={`h-8 px-2 ml-0.5 rounded text-xs font-semibold flex items-center gap-1 ${
        sketchMode ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
      }`}
    >
      <Pencil size={12} /> SKETCH
    </button>
  );
}

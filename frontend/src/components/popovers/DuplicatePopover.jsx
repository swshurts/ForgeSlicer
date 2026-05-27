// Duplicate popover — clones the selected component(s), optionally
// mirroring each copy on a chosen axis. The mirror buttons live in the
// same popover (rather than a separate "duplicate-and-mirror" menu) so
// the single common workflow — "I want a left-and-right pair" — is one
// click.
import React from "react";
import { Copy, FlipHorizontal, FlipVertical, FlipHorizontal2 } from "lucide-react";
import { useScene } from "../../lib/store";
import { PopoverShell, EmptyMsg } from "./PopoverShell";

export function DuplicatePopover({ anchor, onClose }) {
  const selectedIds = useScene((s) => s.selectedIds);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const duplicateSelected = useScene((s) => s.duplicateSelected);
  const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
  const count = ids.length;
  const names = ids.map((id) => (objects.find((o) => o.id === id) || {}).name).filter(Boolean);

  const run = (mirrorAxis) => {
    duplicateSelected({ mirrorAxis });
    onClose();
  };

  return (
    <PopoverShell title={`Duplicate${count > 1 ? ` (${count})` : ""}`} icon={Copy} onClose={onClose} anchor={anchor} testid="duplicate-popover" width={320}>
      {count === 0 ? (
        <EmptyMsg>
          Select at least one object first. <span className="text-slate-400">Tip:</span> hold
          <kbd className="mx-1 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-200">Ctrl</kbd>
          or
          <kbd className="mx-1 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-200">Shift</kbd>
          and click to add components to your selection.
        </EmptyMsg>
      ) : (
        <>
          <div className="text-[10px] text-slate-400 font-mono bg-slate-950/50 border border-slate-800 rounded p-2 max-h-20 overflow-y-auto" data-testid="duplicate-selection-list">
            {count} selected: <span className="text-orange-300">{names.join(", ")}</span>
          </div>
          <button
            data-testid="duplicate-plain-btn"
            onClick={() => run(null)}
            className="h-9 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center justify-center gap-2 uppercase tracking-wide"
          >
            <Copy size={13} /> Duplicate {count > 1 ? "all" : ""}
          </button>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium pt-1">
            …or duplicate & mirror about
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              data-testid="duplicate-mirror-x-btn"
              onClick={() => run("x")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Mirror across the X axis (left ↔ right)"
            >
              <FlipHorizontal size={13} /> X axis
            </button>
            <button
              data-testid="duplicate-mirror-y-btn"
              onClick={() => run("y")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Mirror across the Y axis (up ↔ down)"
            >
              <FlipVertical size={13} /> Y axis
            </button>
            <button
              data-testid="duplicate-mirror-z-btn"
              onClick={() => run("z")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Mirror across the Z axis (front ↔ back)"
            >
              <FlipHorizontal2 size={13} /> Z axis
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-snug">
            Mirroring flips each copy's geometry on the chosen axis and reflects its position. Booleans, color, and modifier flags are preserved.
          </p>
        </>
      )}
    </PopoverShell>
  );
}

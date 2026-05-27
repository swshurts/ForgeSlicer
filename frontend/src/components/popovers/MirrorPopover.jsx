// Mirror popover — flips the selected component(s) in place on the
// chosen axis WITHOUT duplicating. Useful for AI-generated meshes where
// the model came out backwards. Implemented by negating scale on the
// chosen axis (the part stays anchored at its current position).
import React from "react";
import { FlipHorizontal, FlipVertical, FlipHorizontal2 } from "lucide-react";
import { useScene } from "../../lib/store";
import { PopoverShell, EmptyMsg } from "./PopoverShell";

export function MirrorPopover({ anchor, onClose }) {
  const selectedIds = useScene((s) => s.selectedIds);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const mirrorSelectedInPlace = useScene((s) => s.mirrorSelectedInPlace);
  const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
  const count = ids.length;
  const names = ids.map((id) => (objects.find((o) => o.id === id) || {}).name).filter(Boolean);

  const run = (axis) => {
    mirrorSelectedInPlace(axis);
    onClose();
  };

  return (
    <PopoverShell title={`Mirror in-place${count > 1 ? ` (${count})` : ""}`} icon={FlipHorizontal2} onClose={onClose} anchor={anchor} testid="mirror-popover" width={320}>
      {count === 0 ? (
        <EmptyMsg>Select at least one object first.</EmptyMsg>
      ) : (
        <>
          <div className="text-[10px] text-slate-400 font-mono bg-slate-950/50 border border-slate-800 rounded p-2 max-h-20 overflow-y-auto">
            {count} selected: <span className="text-orange-300">{names.join(", ")}</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium pt-1">
            Mirror axis
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              data-testid="mirror-inplace-x-btn"
              onClick={() => run("x")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Flip on X (left ↔ right)"
            >
              <FlipHorizontal size={13} /> X axis
            </button>
            <button
              data-testid="mirror-inplace-y-btn"
              onClick={() => run("y")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Flip on Y (top ↔ bottom)"
            >
              <FlipVertical size={13} /> Y axis
            </button>
            <button
              data-testid="mirror-inplace-z-btn"
              onClick={() => run("z")}
              className="h-9 bg-slate-900 hover:bg-orange-500/20 hover:border-orange-500 border border-slate-700 text-slate-200 text-xs font-mono rounded flex items-center justify-center gap-1.5"
              title="Flip on Z (front ↔ back)"
            >
              <FlipHorizontal2 size={13} /> Z axis
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-snug">
            Flips the geometry in place by negating scale on the chosen axis. The part stays where it is — useful for fixing asymmetric AI meshes. Undo with <kbd className="px-1 bg-slate-800 rounded">Ctrl+Z</kbd>.
          </p>
        </>
      )}
    </PopoverShell>
  );
}

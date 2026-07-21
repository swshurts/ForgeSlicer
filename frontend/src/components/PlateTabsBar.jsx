/**
 * PlateTabsBar — Multi-Plate MVP (iter-151.6).
 *
 * Renders horizontal plate tabs at the top of the workspace viewport.
 * Click a tab to switch plates. Objects on other plates disappear from
 * the outliner + scene but are preserved in state (see `useScene`).
 *
 * Purely LOCAL / in-memory state — nothing is persisted or synced
 * across users. Server + cooperative editing land in a later iter.
 */
import React from "react";
import { Plus, X, Send } from "lucide-react";
import { useScene } from "../lib/store";
import PlateThumbnail from "./PlateThumbnail";

export default function PlateTabsBar() {
  const plates = useScene((s) => s.plates || []);
  const activePlateId = useScene((s) => s.activePlateId);
  const addPlate = useScene((s) => s.addPlate);
  const removePlate = useScene((s) => s.removePlate);
  const renamePlate = useScene((s) => s.renamePlate);
  const setActivePlate = useScene((s) => s.setActivePlate);
  const moveObjectsToPlate = useScene((s) => s.moveObjectsToPlate);
  const selectedIds = useScene((s) => s.selectedIds || []);
  const [showMoveMenu, setShowMoveMenu] = React.useState(false);

  if (plates.length === 0) return null;

  const handleRename = (plate) => {
    const next = window.prompt(`Rename "${plate.name}" to:`, plate.name);
    if (next && next.trim()) renamePlate(plate.id, next);
  };
  const handleRemove = (plate) => {
    if (plates.length === 1) {
      window.alert("You need at least one plate. Can't remove the last one.");
      return;
    }
    if (!window.confirm(`Delete "${plate.name}"? Objects on it will move to another plate — nothing is lost.`)) return;
    removePlate(plate.id);
  };

  return (
    <div
      className="absolute top-2 left-3 z-20 flex items-center gap-1 bg-slate-900/85 border border-slate-700 rounded px-1.5 py-1"
      data-testid="plate-tabs-bar"
      onContextMenu={(e) => e.preventDefault()}
    >
      {plates.map((p) => {
        const active = p.id === activePlateId;
        return (
          <div key={p.id} className="flex items-center">
            <button
              data-testid={`plate-tab-${p.id}`}
              onClick={() => setActivePlate(p.id)}
              onDoubleClick={() => handleRename(p)}
              className={`flex items-center gap-1.5 h-10 pl-1 pr-2 rounded border ${
                active
                  ? "bg-sky-600 border-sky-500 text-white"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:border-sky-500/70 hover:text-sky-300"
              }`}
              title="Click to activate, double-click to rename"
            >
              <PlateThumbnail plateId={p.id} active={active} />
              <span className="text-[10px] uppercase tracking-wider font-semibold">{p.name}</span>
            </button>
            {plates.length > 1 && (
              <button
                data-testid={`plate-remove-${p.id}`}
                onClick={() => handleRemove(p)}
                className="w-4 h-10 text-slate-500 hover:text-rose-400 text-[10px] flex items-center justify-center"
                title={`Delete ${p.name}`}
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
      <button
        data-testid="plate-add"
        onClick={addPlate}
        className="ml-1 w-8 h-10 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:border-sky-500 hover:text-sky-300 flex items-center justify-center"
        title="Add a new plate"
      >
        <Plus size={12} />
      </button>
      {selectedIds.length > 0 && plates.length > 1 && (
        <div className="relative ml-2 border-l border-slate-700 pl-2">
          <button
            data-testid="plate-move-selected"
            onClick={() => setShowMoveMenu((v) => !v)}
            className="h-10 px-2 text-[10px] uppercase tracking-wider font-semibold rounded bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1"
            title={`Move ${selectedIds.length} selected part(s) to another plate`}
          >
            <Send size={10} /> Move ({selectedIds.length})
          </button>
          {showMoveMenu && (
            <div
              className="absolute top-full left-0 mt-1 min-w-[140px] bg-slate-900 border border-slate-700 rounded shadow-xl overflow-hidden"
              data-testid="plate-move-menu"
            >
              {plates
                .filter((p) => p.id !== activePlateId)
                .map((p) => (
                  <button
                    key={p.id}
                    data-testid={`plate-move-target-${p.id}`}
                    onClick={() => {
                      moveObjectsToPlate(selectedIds, p.id);
                      setShowMoveMenu(false);
                    }}
                    className="block w-full text-left px-2.5 py-1.5 text-[10px] text-slate-200 hover:bg-sky-600 hover:text-white"
                  >
                    → {p.name}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Rotation popover — per-axis (X/Y/Z) Euler angle entry in degrees.
// Includes a "Drop to Bed" shortcut because rotation often leaves the
// part floating above (or sinking into) the build plate.
//
// If `autoDropOnRotate` is enabled in the scene store, every edit
// schedules a `dropToBed` on the affected component(s) on the next tick
// so the user doesn't have to click the button after each tweak.
import React from "react";
import { RotateCw, ArrowDownToLine } from "lucide-react";
import { useScene } from "../../lib/store";
import { PopoverShell, NumberField, EmptyMsg } from "./PopoverShell";

export function RotationPopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const rotateSelected = useScene((s) => s.rotateSelected);
  const dropToBed = useScene((s) => s.dropToBed);
  const dropSelectionToBed = useScene((s) => s.dropSelectionToBed);
  const autoDropOnRotate = useScene((s) => s.autoDropOnRotate);
  const obj = objects.find((o) => o.id === selectedId);
  const multi = selectedIds && selectedIds.length > 1;
  const setRot = (i, v) => {
    if (!obj) return;
    if (multi) {
      const delta = [0, 0, 0]; delta[i] = v - obj.rotation[i];
      rotateSelected(delta);
      // Auto-drop the whole assembly as a unit (single dy translation
      // that lands the lowest world-Y point on the bed). The old code
      // looped `dropToBed(id)` per-member which independently snapped
      // each piece to Y=0, ruining the rigid-body relative offsets of
      // any assembly.
      if (autoDropOnRotate) setTimeout(() => dropSelectionToBed(false), 0);
    } else {
      const r = [...obj.rotation]; r[i] = v;
      setTransformWithHistory(obj.id, "rotation", r);
      if (autoDropOnRotate) setTimeout(() => dropToBed(obj.id, false), 0);
    }
  };
  return (
    <PopoverShell title={obj ? `Rotation — ${obj.name}${multi ? ` +${selectedIds.length - 1}` : ""}` : "Rotation"} icon={RotateCw} onClose={onClose} anchor={anchor} testid="rotation-popover">
      {!obj ? (
        <EmptyMsg>Select an object first.</EmptyMsg>
      ) : (
        <>
          {multi && (
            <div className="text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 leading-snug">
              Rotating the whole selection ({selectedIds.length}). Edits apply the delta to every selected component.
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <NumberField testid="popover-rot-x" label="X" hint="pitch" value={obj.rotation[0]} onChange={(v) => setRot(0, v)} step={5} suffix="°" />
            <NumberField testid="popover-rot-y" label="Y" hint="roll" value={obj.rotation[1]} onChange={(v) => setRot(1, v)} step={5} suffix="°" />
            <NumberField testid="popover-rot-z" label="Z" hint="yaw" value={obj.rotation[2]} onChange={(v) => setRot(2, v)} step={5} suffix="°" />
          </div>
          <button
            data-testid="popover-drop-to-bed"
            onClick={() => (multi ? dropSelectionToBed() : dropToBed(obj.id))}
            className="h-8 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-slate-700"
          >
            <ArrowDownToLine size={13} /> Drop {multi ? "all" : ""} to Bed
          </button>
        </>
      )}
    </PopoverShell>
  );
}

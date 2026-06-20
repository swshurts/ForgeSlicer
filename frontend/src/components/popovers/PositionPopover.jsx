// Position popover — per-axis (X/Y/Z) numeric entry for the selected
// component's position in millimetres. In multi-select mode, the values
// shown are the leader's; editing one shifts the whole selection by the
// delta so group transforms stay intact.
import React from "react";
import { Move3D } from "lucide-react";
import { useScene } from "../../lib/store";
import { PopoverShell, NumberField, EmptyMsg } from "./PopoverShell";

export function PositionPopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const translateSelected = useScene((s) => s.translateSelected);
  const obj = objects.find((o) => o.id === selectedId);
  const multi = selectedIds && selectedIds.length > 1;

  const setPos = (i, v) => {
    if (!obj) return;
    if (multi) {
      // In multi-select mode, the displayed value is the primary's position
      // and editing it shifts the whole assembly by the delta. This keeps
      // group transforms intact while still letting the user type absolute
      // coordinates for the leader.
      const delta = [0, 0, 0]; delta[i] = v - obj.position[i];
      translateSelected(delta);
    } else {
      const p = [...obj.position]; p[i] = v;
      setTransformWithHistory(obj.id, "position", p);
    }
  };
  return (
    <PopoverShell
      title={obj ? `Position — ${obj.name}${multi ? ` +${selectedIds.length - 1}` : ""}` : "Position"}
      icon={Move3D} onClose={onClose} anchor={anchor} testid="position-popover"
    >
      {!obj ? (
        <EmptyMsg>Select an object first.</EmptyMsg>
      ) : (
        <>
          {multi && (
            <div className="text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 leading-snug">
              Moving the whole selection ({selectedIds.length}). Values shown are the leader; edits shift every selected component by the delta.
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <NumberField testid="popover-pos-x" label="X" hint="right" value={obj.position[0]} onChange={(v) => setPos(0, v)} step={0.5} suffix="mm" />
            <NumberField testid="popover-pos-y" label="Y" hint="forward" value={obj.position[1]} onChange={(v) => setPos(1, v)} step={0.5} suffix="mm" />
            <NumberField testid="popover-pos-z" label="Z" hint="up" value={obj.position[2]} onChange={(v) => setPos(2, v)} step={0.5} suffix="mm" />
          </div>
        </>
      )}
    </PopoverShell>
  );
}

// Align popover — selection-relative axis alignment.
//
// 3x3 grid of buttons: one row per world axis (X / Y / Z), three modes
// per row (Min edge / Centre / Max edge). Acts on whatever is currently
// selected (≥ 2 objects required, else the buttons stay disabled and
// the help line nudges the user). Single undo step via
// `useScene.alignSelection`.
//
// The compass deliberately picks **selection-relative** alignment
// (not "to active") because that's what users expect from CAD/2D
// tools — leftmost selection determines the left edge, etc.

import React from "react";
import {
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  ChevronsDown, AlignCenterVertical, ChevronsUp, AlignCenter,
} from "lucide-react";
import { useScene } from "../../lib/store";
import { PopoverShell, EmptyMsg } from "./PopoverShell";

const ROWS = [
  {
    axis: "x",
    label: "X · left ↔ right",
    cells: [
      { mode: "min",    title: "Align left edges (−X)",   Icon: AlignHorizontalJustifyStart },
      { mode: "center", title: "Centre on X",             Icon: AlignHorizontalJustifyCenter },
      { mode: "max",    title: "Align right edges (+X)",  Icon: AlignHorizontalJustifyEnd },
    ],
  },
  {
    axis: "y",
    label: "Y · front ↔ back",
    cells: [
      { mode: "min",    title: "Align front edges (−Y)",  Icon: AlignVerticalJustifyEnd },
      { mode: "center", title: "Centre on Y",             Icon: AlignVerticalJustifyCenter },
      { mode: "max",    title: "Align back edges (+Y)",   Icon: AlignVerticalJustifyStart },
    ],
  },
  {
    axis: "z",
    label: "Z · bottom ↔ top",
    cells: [
      { mode: "min",    title: "Align bottom faces (bed)", Icon: ChevronsDown },
      { mode: "center", title: "Centre on Z",              Icon: AlignCenterVertical },
      { mode: "max",    title: "Align top faces",          Icon: ChevronsUp },
    ],
  },
];

export function AlignPopover({ anchor, onClose }) {
  const alignSelection = useScene((s) => s.alignSelection);
  const selectedIds = useScene((s) => s.selectedIds);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
  const count = ids.length;
  const names = ids.map((id) => (objects.find((o) => o.id === id) || {}).name).filter(Boolean);

  return (
    <PopoverShell
      title={`Align${count >= 2 ? ` (${count})` : ""}`}
      icon={AlignCenter}
      onClose={onClose}
      anchor={anchor}
      testid="align-popover"
      width={300}
    >
      {count < 2 ? (
        <EmptyMsg>Select at least two objects to align them.</EmptyMsg>
      ) : (
        <>
          <div className="text-[10px] text-slate-400 font-mono bg-slate-950/50 border border-slate-800 rounded p-2 max-h-20 overflow-y-auto">
            {count} selected: <span className="text-orange-300">{names.join(", ")}</span>
          </div>

          {ROWS.map((row) => (
            <div key={row.axis} className="space-y-1 pt-1">
              <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
                {row.label}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {row.cells.map(({ mode, title, Icon }) => (
                  <button
                    key={mode}
                    data-testid={`align-${row.axis}-${mode}`}
                    onClick={() => alignSelection(row.axis, mode)}
                    title={title}
                    className="h-9 rounded border border-slate-700 hover:border-orange-400 hover:bg-orange-500/15 text-slate-300 hover:text-orange-300 flex items-center justify-center transition-colors"
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
            </div>
          ))}

          <p className="text-[10px] text-slate-500 leading-snug pt-2">
            Aligns to the selection&apos;s combined bbox: leftmost wins for −X, topmost wins for +Z, etc. Each axis is independent — apply X-min then Z-max if you want diagonal corner alignment.
          </p>
        </>
      )}
    </PopoverShell>
  );
}

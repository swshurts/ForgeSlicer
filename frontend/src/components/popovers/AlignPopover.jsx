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
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, StretchVertical,
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
  const distributeSelection = useScene((s) => s.distributeSelection);
  const selectedIds = useScene((s) => s.selectedIds);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
  const count = ids.length;
  const names = ids.map((id) => (objects.find((o) => o.id === id) || {}).name).filter(Boolean);

  const DISTRIBUTE_CELLS = [
    { axis: "x", title: "Distribute centres evenly along X (left ↔ right)", Icon: AlignHorizontalDistributeCenter },
    { axis: "y", title: "Distribute centres evenly along Y (front ↔ back)", Icon: AlignVerticalDistributeCenter },
    { axis: "z", title: "Distribute centres evenly along Z (bottom ↔ top)", Icon: StretchVertical },
  ];

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
          <div className="text-[10px] text-slate-400 font-mono bg-slate-950/50 border border-slate-800 rounded p-2 space-y-0.5">
            <div>
              <span className="text-emerald-400 uppercase tracking-wider text-[9px] font-sans font-semibold mr-1">Anchor:</span>
              <span className="text-emerald-300">{names[0] || ids[0]}</span>
              <span className="text-slate-500 ml-1">(stays put)</span>
            </div>
            {names.length > 1 && (
              <div>
                <span className="text-orange-300/80 uppercase tracking-wider text-[9px] font-sans font-semibold mr-1">Move:</span>
                <span className="text-orange-300">{names.slice(1).join(", ")}</span>
              </div>
            )}
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

          {/* Distribute — equalise spacing along an axis. Needs ≥ 3
              objects to be useful; below that we keep the buttons
              visible but disabled, with a help tooltip. */}
          <div className="space-y-1 pt-3 border-t border-slate-800">
            <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
              Distribute — evenly space {count >= 3 ? `(${count})` : "(≥ 3)"}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {DISTRIBUTE_CELLS.map(({ axis, title, Icon }) => (
                <button
                  key={axis}
                  data-testid={`distribute-${axis}`}
                  onClick={() => distributeSelection(axis)}
                  disabled={count < 3}
                  title={count < 3 ? "Select 3 or more objects to distribute" : title}
                  className="h-9 rounded border border-slate-700 hover:border-orange-400 hover:bg-orange-500/15 text-slate-300 hover:text-orange-300 flex items-center justify-center transition-colors disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:bg-transparent disabled:hover:text-slate-300 disabled:cursor-not-allowed"
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-slate-500 leading-snug pt-2">
            Aligns to the <strong className="text-emerald-300">first selected object</strong>: its edge or centre becomes the target, every later-selected object moves to match. Pick the reference part first, then shift-click the parts you want to align to it.
            <span className="block mt-1 text-slate-600">Distribute keeps the outermost two objects on the chosen axis put and equalises the spacing between centres of the rest.</span>
          </p>
        </>
      )}
    </PopoverShell>
  );
}

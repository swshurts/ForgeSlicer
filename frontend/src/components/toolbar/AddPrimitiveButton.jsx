// Inline Add-Primitive dropdown.
//
// Same primitive list and behaviour as the inline version that used
// to live in TopToolbar.jsx. Extracted so the toolbar shell can stay
// composition-only and a future "command palette" feature can drop
// the same menu from a different entry point.
import React, { useState } from "react";
import { Box, Circle, Cylinder, Cone, Hexagon as HexIcon, Square, Triangle, Plus, ChevronDown, Tornado, CircleDashed, TriangleRight } from "lucide-react";
import { useScene } from "../../lib/store";

const PRIMITIVES = [
  { type: "cube",      label: "Cube",      Icon: Box },
  { type: "sphere",    label: "Sphere",    Icon: Circle },
  { type: "cylinder",  label: "Cylinder",  Icon: Cylinder },
  { type: "cone",      label: "Cone",      Icon: Cone },
  { type: "torus",     label: "Torus",     Icon: HexIcon },
  // ---- Curve primitives (1.12) — keep in sync with LeftPanel.PRIMS_3D ----
  { type: "helix",     label: "Helix",     Icon: Tornado },
  { type: "pipe",      label: "Pipe",      Icon: CircleDashed },
  { type: "wedge",     label: "Wedge",     Icon: TriangleRight },
  { type: "circle",    label: "2D Circle (extrude later)", Icon: Circle },
  { type: "square2d",  label: "2D Square (extrude later)", Icon: Square },
  { type: "triangle",  label: "2D Triangle (extrude later)", Icon: Triangle },
];

export default function AddPrimitiveButton() {
  const [open, setOpen] = useState(false);
  const addPrimitive = useScene((s) => s.addPrimitive);
  return (
    <div className="relative">
      <button
        data-testid="add-primitive-btn"
        onClick={() => setOpen((v) => !v)}
        // 150ms grace lets the option's mousedown fire before the menu
        // tears down on blur.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title="Add a primitive shape"
        className={`h-8 px-2.5 text-[11px] font-semibold uppercase tracking-wider rounded flex items-center gap-1.5 border transition-colors ${
          open
            ? "bg-orange-500/20 border-orange-500/60 text-orange-300"
            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <Plus size={12} /> Add <ChevronDown size={10} />
      </button>
      {open && (
        <div
          data-testid="add-primitive-menu"
          className="absolute left-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded shadow-xl z-50 min-w-[220px] py-1"
        >
          {PRIMITIVES.map(({ type, label, Icon }) => (
            <button
              key={type}
              data-testid={`add-primitive-${type}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                addPrimitive(type);
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
            >
              <Icon size={13} className="text-orange-400 flex-shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

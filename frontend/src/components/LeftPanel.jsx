import React from "react";
import { useScene } from "../lib/store";
import {
  Box, Circle, Cylinder, Cone, Donut, Eye, EyeOff, Lock, Unlock,
  Trash2, Copy, PlusSquare, MinusSquare, ChevronRight,
  Square as SquareIcon, Triangle as TriangleIcon, Hexagon as HexagonIcon,
} from "lucide-react";

const PRIMS_3D = [
  { type: "cube", label: "Cube", icon: Box },
  { type: "sphere", label: "Sphere", icon: Circle },
  { type: "cylinder", label: "Cylinder", icon: Cylinder },
  { type: "cone", label: "Cone", icon: Cone },
  { type: "torus", label: "Torus", icon: Donut },
];

// 2D primitives — render as thin wafers; the user extrudes via the
// inspector when the sketch is ready.
const PRIMS_2D = [
  { type: "circle", label: "Circle", icon: Circle },
  { type: "square2d", label: "Square", icon: SquareIcon },
  { type: "triangle", label: "Triangle", icon: TriangleIcon },
  { type: "polygon", label: "Polygon", icon: HexagonIcon },
];

function PrimitiveButton({ p, modifier, compact = false }) {
  const Icon = p.icon;
  const addPrimitive = useScene((s) => s.addPrimitive);
  const isNeg = modifier === "negative";
  return (
    <button
      data-testid={`add-${p.type}-${modifier}-btn`}
      onClick={() => addPrimitive(p.type, modifier)}
      className={`group flex flex-col items-center justify-center gap-1 ${compact ? "h-12" : "h-16"} rounded-md border transition-all ${
        isNeg
          ? "border-cyan-500/30 hover:border-cyan-500 hover:bg-cyan-500/10 text-cyan-400"
          : "border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400"
      }`}
      title={`Add ${isNeg ? "Negative" : "Positive"} ${p.label}`}
    >
      <Icon size={compact ? 14 : 18} strokeWidth={1.8} />
      <span className={`${compact ? "text-[8.5px]" : "text-[10px]"} uppercase tracking-wide font-medium text-slate-300`}>{p.label}</span>
    </button>
  );
}

function SceneTreeItem({ obj }) {
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const select = useScene((s) => s.selectObject);
  const toggleVisible = useScene((s) => s.toggleVisible);
  const toggleLocked = useScene((s) => s.toggleLocked);
  const remove = useScene((s) => s.removeObject);
  const duplicate = useScene((s) => s.duplicateObject);
  const flipModifier = useScene((s) => s.flipModifier);
  const inSelection = (selectedIds && selectedIds.length) ? selectedIds.includes(obj.id) : obj.id === selectedId;
  const isPrimary = obj.id === selectedId;
  const isNeg = obj.modifier === "negative";

  return (
    <div
      data-testid={`scene-tree-item-${obj.id}`}
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded text-xs cursor-pointer border-l-2 ${
        isPrimary
          ? "bg-slate-800 border-orange-500 text-white"
          : inSelection
            ? "bg-slate-800/60 border-orange-500/60 text-white"
            : "border-transparent hover:bg-slate-800/60 text-slate-300"
      }`}
      onClick={(e) => {
        const mode = e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "add" : null;
        select(obj.id, mode);
      }}
    >
      <button
        data-testid={`tree-flip-${obj.id}`}
        onClick={(e) => { e.stopPropagation(); flipModifier(obj.id); }}
        className={`w-4 h-4 rounded-sm flex-shrink-0 ${isNeg ? "bg-cyan-500/80" : "bg-orange-500/80"}`}
        title={isNeg ? "Negative (subtractive). Click to flip" : "Positive (additive). Click to flip"}
      />
      <span className="flex-1 truncate font-mono">{obj.name}</span>
      <button
        data-testid={`tree-vis-${obj.id}`}
        onClick={(e) => { e.stopPropagation(); toggleVisible(obj.id); }}
        className="opacity-60 hover:opacity-100"
      >
        {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
      <button
        data-testid={`tree-lock-${obj.id}`}
        onClick={(e) => { e.stopPropagation(); toggleLocked(obj.id); }}
        className="opacity-60 hover:opacity-100"
      >
        {obj.locked ? <Lock size={12} /> : <Unlock size={12} />}
      </button>
      <button
        data-testid={`tree-dup-${obj.id}`}
        onClick={(e) => { e.stopPropagation(); duplicate(obj.id); }}
        className="opacity-60 hover:opacity-100"
      >
        <Copy size={12} />
      </button>
      <button
        data-testid={`tree-del-${obj.id}`}
        onClick={(e) => { e.stopPropagation(); remove(obj.id); }}
        className="opacity-60 hover:opacity-100 hover:text-red-400"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

export default function LeftPanel() {
  const objects = useScene((s) => s.objects);
  return (
    <aside className="w-64 flex-shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col h-full overflow-hidden">
      <div className="overflow-y-auto flex-shrink-0" style={{ maxHeight: "62%" }}>
        <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
          <PlusSquare size={14} className="text-orange-500" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Add Positive
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 p-3">
          {PRIMS_3D.map((p) => (
            <PrimitiveButton key={`pos-${p.type}`} p={p} modifier="positive" />
          ))}
        </div>

        <div className="px-3 py-2 border-y border-slate-800 flex items-center gap-2">
          <MinusSquare size={14} className="text-cyan-500" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Add Negative
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 p-3">
          {PRIMS_3D.map((p) => (
            <PrimitiveButton key={`neg-${p.type}`} p={p} modifier="negative" />
          ))}
        </div>

        <div className="px-3 py-2 border-y border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SquareIcon size={14} className="text-purple-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              2D Shapes
            </span>
          </div>
          <span className="text-[9px] uppercase tracking-wider text-slate-500" title="Add as positive or negative, then Extrude in the Inspector to give it depth">
            extrude →
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 p-3">
          {PRIMS_2D.map((p) => (
            <PrimitiveButton key={`pos-${p.type}`} p={p} modifier="positive" compact />
          ))}
          {PRIMS_2D.map((p) => (
            <PrimitiveButton key={`neg-${p.type}`} p={p} modifier="negative" compact />
          ))}
        </div>
      </div>

      <div className="px-3 py-2 border-y border-slate-800 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
          <ChevronRight size={12} />Outliner
        </span>
        <span className="text-[10px] font-mono text-slate-500" data-testid="scene-count">
          {objects.length} objs
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-1" data-testid="scene-tree">
        {objects.length === 0 ? (
          <div className="px-3 py-6 text-xs text-slate-500 italic">
            No components yet. Add a primitive above.
          </div>
        ) : (
          objects.map((o) => <SceneTreeItem key={o.id} obj={o} />)
        )}
      </div>
    </aside>
  );
}

import React, { useState } from "react";
import { useScene } from "../lib/store";
import {
  Box, Circle, Cylinder, Cone, Donut, Eye, EyeOff, Lock, Unlock,
  Trash2, Copy, PlusSquare, MinusSquare, ChevronRight, ChevronDown, Layers,
  Square as SquareIcon, Triangle as TriangleIcon, Hexagon as HexagonIcon, Pill,
  Sparkles,
} from "lucide-react";
import ContextMenu from "./ContextMenu";
import AIGenerateDialog from "./AIGenerateDialog";

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

// Single-click "Slot" composite — drops a 6×10×6.5 mm racetrack hole built
// from 1 cube + 2 cylinders, already grouped so it moves as one unit. Default
// modifier is negative (rack screw holes). The positive variant is useful as
// a pill/key-shaped stud or button.
function SlotButton({ modifier }) {
  const addSlot = useScene((s) => s.addSlot);
  const isNeg = modifier === "negative";
  return (
    <button
      data-testid={`add-slot-${modifier}-btn`}
      onClick={() => addSlot(modifier)}
      className={`group flex flex-col items-center justify-center gap-1 h-16 rounded-md border transition-all ${
        isNeg
          ? "border-cyan-500/30 hover:border-cyan-500 hover:bg-cyan-500/10 text-cyan-400"
          : "border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400"
      }`}
      title={`Add ${isNeg ? "Negative" : "Positive"} Slot — 6×10×6.5 mm racetrack (rack-screw style). Each part stays editable.`}
    >
      <Pill size={18} strokeWidth={1.8} />
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">
        {isNeg ? "Slot ⌀" : "Slot"}
      </span>
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
  const setObjectName = useScene((s) => s.setObjectName);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(obj.name);
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
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const inSel = (typeof selectedIds !== "undefined" && selectedIds.includes(obj.id)) || obj.id === selectedId;
        if (!inSel) select(obj.id);
        // bubble up to outliner-level context handler via a CustomEvent so we
        // don't need separate state per row.
        window.dispatchEvent(new CustomEvent("forgeslicer:outliner-ctx", { detail: { x: e.clientX, y: e.clientY } }));
      }}
    >
      <button
        data-testid={`tree-flip-${obj.id}`}
        onClick={(e) => { e.stopPropagation(); flipModifier(obj.id); }}
        className={`w-4 h-4 rounded-sm flex-shrink-0 ${isNeg ? "bg-cyan-500/80" : "bg-orange-500/80"}`}
        title={isNeg ? "Negative (subtractive). Click to flip" : "Positive (additive). Click to flip"}
      />
      <span
        className="flex-1 truncate font-mono"
        data-testid={`tree-name-${obj.id}`}
        onDoubleClick={(e) => {
          // Double-click to inline-rename. Single-click already drives the
          // selection logic above; we stop propagation here so the rename
          // mode doesn't immediately re-select-and-deselect underneath.
          e.stopPropagation();
          setDraftName(obj.name);
          setEditing(true);
        }}
        title="Double-click to rename"
      >
        {editing ? (
          <input
            data-testid={`tree-rename-input-${obj.id}`}
            autoFocus
            value={draftName}
            onChange={(ev) => setDraftName(ev.target.value)}
            onClick={(ev) => ev.stopPropagation()}
            onBlur={() => {
              const n = (draftName || "").trim();
              if (n && n !== obj.name) setObjectName(obj.id, n);
              setEditing(false);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") { ev.currentTarget.blur(); }
              else if (ev.key === "Escape") { setDraftName(obj.name); setEditing(false); }
            }}
            className="bg-slate-950 border border-orange-500/60 rounded px-1 py-px text-xs text-white font-mono w-full focus:outline-none"
          />
        ) : obj.name}
      </span>
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
  const [outlinerCtx, setOutlinerCtx] = useState(null);
  React.useEffect(() => {
    const handler = (e) => setOutlinerCtx({ x: e.detail.x, y: e.detail.y });
    window.addEventListener("forgeslicer:outliner-ctx", handler);
    return () => window.removeEventListener("forgeslicer:outliner-ctx", handler);
  }, []);
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

        <div className="px-3 py-2 border-y border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Pill size={14} className="text-amber-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Composites
            </span>
          </div>
          <span className="text-[9px] uppercase tracking-wider text-slate-500" title="Pre-built assemblies of multiple primitives, dropped as one group">
            grouped
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          <SlotButton modifier="negative" />
          <SlotButton modifier="positive" />
        </div>

        <AISection />
      </div>

      <div className="px-3 py-2 border-y border-slate-800 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
          <ChevronRight size={12} />Outliner
        </span>
        <span className="text-[10px] font-mono text-slate-500" data-testid="scene-count">
          {objects.length} objs
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-1" data-testid="scene-tree" onContextMenu={(e) => { e.preventDefault(); setOutlinerCtx({ x: e.clientX, y: e.clientY }); }}>
        {objects.length === 0 ? (
          <div className="px-3 py-6 text-xs text-slate-500 italic">
            No components yet. Add a primitive above.
          </div>
        ) : (
          renderGroupedOutliner(objects)
        )}
      </div>
      {outlinerCtx && <ContextMenu position={outlinerCtx} onClose={() => setOutlinerCtx(null)} />}
    </aside>
  );
}

// Render objects grouping members with the same `groupId` together under a
// collapsible header. Ungrouped items appear at top level.
function renderGroupedOutliner(objects) {
  const rendered = [];
  const seenGroups = new Set();
  for (const o of objects) {
    if (o.groupId) {
      if (seenGroups.has(o.groupId)) continue;
      seenGroups.add(o.groupId);
      const members = objects.filter((x) => x.groupId === o.groupId);
      rendered.push(
        <GroupHeader key={`group-${o.groupId}`} groupId={o.groupId} name={o.groupName || "Group"} members={members} />
      );
    } else {
      rendered.push(<SceneTreeItem key={o.id} obj={o} />);
    }
  }
  return rendered;
}

// ---- AI generation entry point ----
function AISection() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="px-3 py-2 border-y border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-fuchsia-400" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            AI Generate
          </span>
        </div>
        <span className="text-[9px] uppercase tracking-wider text-fuchsia-400/80 border border-fuchsia-500/40 rounded px-1.5 py-0.5">
          beta
        </span>
      </div>
      <div className="p-3">
        <button
          data-testid="ai-generate-btn"
          onClick={() => setOpen(true)}
          className="w-full h-12 rounded-md border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-orange-500/10 hover:border-fuchsia-500 hover:from-fuchsia-500/20 transition-all flex items-center justify-center gap-2 text-fuchsia-300 text-xs font-semibold tracking-wide"
          title="Generate a 3D model from text or an image"
        >
          <Sparkles size={14} />
          Generate from Text · Image
        </button>
        <p className="mt-2 text-[10px] text-slate-500 leading-snug">
          Describe a shape or upload a picture — get a printable mesh you can carve & slice.
        </p>
      </div>
      <AIGenerateDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}


function GroupHeader({ groupId, name, members }) {
  const [expanded, setExpanded] = useState(true);
  const selectObject = useScene((s) => s.selectObject);
  const selectedIds = useScene((s) => s.selectedIds);
  const groupSelected = members.every((m) => selectedIds.includes(m.id));
  return (
    <div className="mb-1" data-testid={`group-${groupId}`}>
      <div
        onClick={() => {
          // Select all members; expand-toggle via the chevron only.
          selectObject(members[0].id);
        }}
        className={`group flex items-center gap-1 px-1.5 py-1.5 rounded cursor-pointer text-[11px] uppercase tracking-wider font-semibold border-l-2 ${
          groupSelected
            ? "bg-orange-500/15 border-orange-500 text-orange-300"
            : "border-purple-500/60 text-slate-300 hover:bg-slate-800/60"
        }`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
          className="text-slate-400 hover:text-white"
          data-testid={`group-toggle-${groupId}`}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <Layers size={12} className="text-purple-400" />
        <span className="flex-1 truncate">{name}</span>
        <span className="text-[9px] font-mono text-slate-500">{members.length}</span>
      </div>
      {expanded && (
        <div className="pl-3 border-l border-slate-800 ml-2">
          {members.map((m) => <SceneTreeItem key={m.id} obj={m} />)}
        </div>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { useScene } from "../lib/store";
import {
  Box, Circle, Cylinder, Cone, Donut, Eye, EyeOff, Lock, Unlock,
  Trash2, Copy, PlusSquare, MinusSquare, ChevronRight, ChevronDown, Layers,
  Square as SquareIcon, Triangle as TriangleIcon, Hexagon as HexagonIcon, Pill,
  Sparkles, Tornado, CircleDashed, TriangleRight, Save, Bolt, Nut, Cog, Waves, Grid3X3,
} from "lucide-react";
import ContextMenu from "./ContextMenu";
import AIGenerateDialog from "./AIGenerateDialog";
import HardwareLibraryDialog from "./dialogs/HardwareLibraryDialog";
import TextureLibraryDialog from "./dialogs/TextureLibraryDialog";

const PRIMS_3D = [
  { type: "cube", label: "Cube", icon: Box },
  { type: "sphere", label: "Sphere", icon: Circle },
  { type: "cylinder", label: "Cylinder", icon: Cylinder },
  { type: "cone", label: "Cone", icon: Cone },
  { type: "torus", label: "Torus", icon: Donut },
  // ---- Curve / extrude primitives (1.12) ----
  { type: "helix", label: "Helix", icon: Tornado },
  { type: "pipe", label: "Pipe", icon: CircleDashed },
  { type: "wedge", label: "Wedge", icon: TriangleRight },
  // ---- Threaded fasteners (1.15) — keep in sync with AddPrimitiveButton.PRIMITIVES ----
  { type: "bolt", label: "Bolt", icon: Bolt },
  { type: "nut", label: "Nut", icon: Nut },
  // ---- Mechanical interfaces (1.16) ----
  { type: "spline", label: "Spline", icon: Cog },
  // ---- Sweep (1.18) — profile-along-path extrusion ----
  { type: "sweep", label: "Sweep", icon: Waves },
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

// Fastener Pair macro — drops a Bolt + Nut + 2 negative bore cylinders
// (through-bore + head counterbore) all sharing a groupId so the user
// can move/rotate the whole fastener as one unit and ungroup later
// for fine-tuning. Always positive; the bore parts are stamped as
// negative inside the macro so this button doesn't need a modifier.
function FastenerPairButton() {
  const addFastenerPair = useScene((s) => s.addFastenerPair);
  return (
    <button
      data-testid="add-fastener-pair-btn"
      onClick={() => addFastenerPair()}
      className="group flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400 transition-all"
      title="Add Fastener Pair — Bolt + Nut + Bore + Counterbore, pre-grouped as a single drop-in fastener."
    >
      <div className="flex items-center gap-1">
        <Bolt size={16} strokeWidth={1.8} />
        <span className="text-slate-500 text-xs">+</span>
        <Nut size={16} strokeWidth={1.8} />
      </div>
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">Fastener Pair</span>
    </button>
  );
}

// Hardware Library — opens a dialog that lets the user pick a standard
// ISO metric grade (M3-M12) + length, then drops the matching Fastener
// Pair onto the build plate. Same group/ungroup semantics as the bare
// Fastener Pair button. Uses an external `onOpenHardwareLib` callback
// (passed down from Workspace) so dialog state stays at the page level.
function HardwareLibraryButton({ onOpenHardwareLib }) {
  return (
    <button
      data-testid="open-hardware-library-btn"
      onClick={onOpenHardwareLib}
      className="group flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400 transition-all"
      title="Hardware Library — pick a standard ISO metric size (M3-M12 × common lengths) and drop the matching fastener pair."
    >
      <Bolt size={18} strokeWidth={1.8} />
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">Hardware</span>
    </button>
  );
}

// Texture Library — opens a dialog where the user picks a geometric
// printable texture (knurl, hex grid, bumps, ridges) + dims, then
// drops a single positive/negative texture primitive onto the plate.
// Same lifecycle as any other primitive — moveable, rotatable,
// boolean-able. Geometric (not visual-only) so it survives STL export.
function TextureLibraryButton({ onOpenTextureLib }) {
  return (
    <button
      data-testid="open-texture-library-btn"
      onClick={onOpenTextureLib}
      className="group flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400 transition-all"
      title="Texture Library — geometric printable textures (knurl, hex, bumps, ridges). Union or subtract onto a surface."
    >
      <Grid3X3 size={18} strokeWidth={1.8} />
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">Textures</span>
    </button>
  );
}

// Countersink macro — drops a pre-grouped negative bore + negative
// chamfered cup so subtracting from a host produces a flush-head
// fastener hole in one click.
function CountersinkButton() {
  const addCountersink = useScene((s) => s.addCountersink);
  return (
    <button
      data-testid="add-countersink-btn"
      onClick={() => addCountersink()}
      className="group flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-cyan-500/30 hover:border-cyan-500 hover:bg-cyan-500/10 text-cyan-400 transition-all"
      title="Add Countersink — negative bore + chamfered cup (for flush flat-head fasteners). Pre-grouped."
    >
      <CircleDashed size={18} strokeWidth={1.8} />
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">Countersink ⌀</span>
    </button>
  );
}

// Hex pocket — drops a negative hexagonal cylinder (single primitive)
// so subtracting from a host yields a hex socket — useful for hex-key
// drives or aligned bolt heads.
function HexPocketButton() {
  const addHexPocket = useScene((s) => s.addHexPocket);
  return (
    <button
      data-testid="add-hex-pocket-btn"
      onClick={() => addHexPocket()}
      className="group flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-cyan-500/30 hover:border-cyan-500 hover:bg-cyan-500/10 text-cyan-400 transition-all"
      title="Add Hex Pocket — negative hex socket. Drop on a host, boolean-subtract."
    >
      <HexagonIcon size={18} strokeWidth={1.8} />
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">Hex Pocket ⌀</span>
    </button>
  );
}

// Gusset — drops a triangular positive reinforcement bracket the
// user can rotate into the corner between two perpendicular faces.
function GussetButton() {
  const addGusset = useScene((s) => s.addGusset);
  return (
    <button
      data-testid="add-gusset-btn"
      onClick={() => addGusset()}
      className="group flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400 transition-all"
      title="Add Gusset — triangular reinforcement bracket for the inside-corner of two perpendicular faces."
    >
      <TriangleIcon size={18} strokeWidth={1.8} />
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">Gusset</span>
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
  const [aiOpen, setAiOpen] = useState(false);
  // Hardware library dialog state lives here (instead of being lifted
  // to Workspace) because nothing outside LeftPanel needs to coordinate
  // with it — it just overlays the viewport when open, and the only
  // trigger is the Hardware button on the Composites tab.
  const [hardwareLibOpen, setHardwareLibOpen] = useState(false);
  // Texture Library dialog state lives on the global store so the
  // right-click "Apply texture to face..." menu item can request it
  // to open even though the context menu unmounts on click. Local
  // setter just dispatches into the store; readers (the dialog) pull
  // open + targetId off the same source of truth.
  const textureLibraryOpen = useScene((s) => s.textureLibraryOpen);
  const textureLibraryTargetId = useScene((s) => s.textureLibraryTargetId);
  const openTextureLibrary = useScene((s) => s.openTextureLibrary);
  const closeTextureLibrary = useScene((s) => s.closeTextureLibrary);
  // Tab persistence: remember the last picked palette so users coming back
  // to a project don't have to re-find their workflow.
  const [tab, setTab] = useState(() => {
    try {
      return window.localStorage.getItem("forge.leftpanel.tab") || "3d";
    } catch { return "3d"; }
  });
  const pickTab = (t) => {
    setTab(t);
    try { window.localStorage.setItem("forge.leftpanel.tab", t); } catch { /* noop */ }
  };
  React.useEffect(() => {
    const handler = (e) => setOutlinerCtx({ x: e.detail.x, y: e.detail.y });
    window.addEventListener("forgeslicer:outliner-ctx", handler);
    return () => window.removeEventListener("forgeslicer:outliner-ctx", handler);
  }, []);

  const TABS = [
    { id: "3d",         label: "3D",    icon: Box,       title: "3D primitives — cube, sphere, cylinder, cone, torus" },
    { id: "2d",         label: "2D",    icon: SquareIcon, title: "2D shapes — extrude in the inspector to give them depth" },
    { id: "composites", label: "Combo", icon: Pill,      title: "Pre-built composite assemblies (slots etc.)" },
    { id: "ai",         label: "AI",    icon: Sparkles,  title: "AI generation — text or image to 3D mesh" },
  ];

  return (
    <aside className="w-64 flex-shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col h-full overflow-hidden">
      {/* ---- Palette tab strip ---- */}
      <div className="flex-shrink-0 flex border-b border-slate-800 bg-slate-950/40" data-testid="leftpanel-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              data-testid={`leftpanel-tab-${t.id}`}
              onClick={() => pickTab(t.id)}
              title={t.title}
              className={`flex-1 h-10 text-[10px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                active
                  ? `${t.id === "ai" ? "border-fuchsia-500 text-fuchsia-300 bg-fuchsia-500/10" : "border-orange-500 text-orange-300 bg-orange-500/5"}`
                  : "border-transparent text-slate-400 hover:text-white hover:bg-slate-800/40"
              }`}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ---- Active palette body ---- */}
      <div className="overflow-y-auto flex-shrink-0" style={{ maxHeight: "55%" }}>
        {tab === "3d" && <Tab3D />}
        {tab === "2d" && <Tab2D />}
        {tab === "composites" && <TabComposites onOpenHardwareLib={() => setHardwareLibOpen(true)} onOpenTextureLib={() => openTextureLibrary(null)} />}
        {tab === "ai" && <TabAI onOpenAi={() => setAiOpen(true)} />}
      </div>

      {/* ---- Outliner (unchanged) ---- */}
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
            No components yet. Pick a palette tab above to add one.
          </div>
        ) : (
          renderGroupedOutliner(objects)
        )}
      </div>
      {outlinerCtx && <ContextMenu position={outlinerCtx} onClose={() => setOutlinerCtx(null)} />}
      <AIGenerateDialog open={aiOpen} onClose={() => setAiOpen(false)} />
      <HardwareLibraryDialog open={hardwareLibOpen} onClose={() => setHardwareLibOpen(false)} />
      <TextureLibraryDialog
        open={textureLibraryOpen}
        targetObjectId={textureLibraryTargetId}
        onClose={closeTextureLibrary}
      />
    </aside>
  );
}

// ---------- Palette tab bodies ----------
function SectionHeader({ icon: Icon, accent, label, right }) {
  return (
    <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Icon size={14} className={accent} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
      </div>
      {right}
    </div>
  );
}

function Tab3D() {
  return (
    <>
      <SectionHeader icon={PlusSquare} accent="text-orange-500" label="Add Positive" />
      <div className="grid grid-cols-3 gap-2 p-3">
        {PRIMS_3D.map((p) => (
          <PrimitiveButton key={`pos-${p.type}`} p={p} modifier="positive" />
        ))}
      </div>
      <SectionHeader icon={MinusSquare} accent="text-cyan-500" label="Add Negative" />
      <div className="grid grid-cols-3 gap-2 p-3">
        {PRIMS_3D.map((p) => (
          <PrimitiveButton key={`neg-${p.type}`} p={p} modifier="negative" />
        ))}
      </div>
    </>
  );
}

function Tab2D() {
  return (
    <>
      <SectionHeader
        icon={SquareIcon}
        accent="text-purple-400"
        label="2D Shapes"
        right={<span className="text-[9px] uppercase tracking-wider text-slate-500" title="Add as positive or negative, then Extrude in the Inspector to give it depth">extrude →</span>}
      />
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-orange-300/80 font-semibold">Positive</div>
      <div className="grid grid-cols-4 gap-1.5 px-3 pb-2">
        {PRIMS_2D.map((p) => (
          <PrimitiveButton key={`pos-${p.type}`} p={p} modifier="positive" compact />
        ))}
      </div>
      <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-cyan-300/80 font-semibold">Negative</div>
      <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
        {PRIMS_2D.map((p) => (
          <PrimitiveButton key={`neg-${p.type}`} p={p} modifier="negative" compact />
        ))}
      </div>
    </>
  );
}

function TabComposites({ onOpenHardwareLib, onOpenTextureLib }) {
  return (
    <>
      <SectionHeader
        icon={Pill}
        accent="text-amber-400"
        label="Composites"
        right={<span className="text-[9px] uppercase tracking-wider text-slate-500" title="Pre-built assemblies of multiple primitives, dropped as one group">grouped</span>}
      />
      <div className="grid grid-cols-2 gap-2 p-3">
        <SlotButton modifier="negative" />
        <SlotButton modifier="positive" />
        <FastenerPairButton />
        <HardwareLibraryButton onOpenHardwareLib={onOpenHardwareLib} />
        <TextureLibraryButton onOpenTextureLib={onOpenTextureLib} />
        <CountersinkButton />
        <HexPocketButton />
        <GussetButton />
      </div>
      <p className="px-3 pb-3 text-[10px] text-slate-500 leading-snug">
        Tip — composites are pre-grouped assemblies. Ungroup any of them to fine-tune individual members.
      </p>
    </>
  );
}

function TabAI({ onOpenAi }) {
  return (
    <>
      <SectionHeader
        icon={Sparkles}
        accent="text-fuchsia-400"
        label="AI Generate"
        right={<span className="text-[9px] uppercase tracking-wider text-fuchsia-400/80 border border-fuchsia-500/40 rounded px-1.5 py-0.5">beta</span>}
      />
      <div className="p-3">
        <button
          data-testid="ai-generate-btn"
          onClick={onOpenAi}
          className="w-full h-12 rounded-md border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-orange-500/10 hover:border-fuchsia-500 hover:from-fuchsia-500/20 transition-all flex items-center justify-center gap-2 text-fuchsia-300 text-xs font-semibold tracking-wide"
          title="Generate a 3D model from text or an image"
        >
          <Sparkles size={14} />
          Generate from Text · Image
        </button>
        <p className="mt-2 text-[10px] text-slate-500 leading-snug">
          Describe a shape or upload a picture — get a printable mesh you can carve &amp; slice.
        </p>
      </div>
    </>
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

// ---- (legacy AISection removed — tabbed UI lives in TabAI above) ----


function GroupHeader({ groupId, name, members }) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const selectObject = useScene((s) => s.selectObject);
  const selectedIds = useScene((s) => s.selectedIds);
  const renameGroup = useScene((s) => s.renameGroup);
  const groupSelected = members.every((m) => selectedIds.includes(m.id));
  // Keep `draft` in sync if the name changes externally (e.g. undo)
  // while not editing. Once the user is typing we trust the local draft.
  React.useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== name) renameGroup(groupId, next);
    else setDraft(name);
  };
  const cancel = () => { setEditing(false); setDraft(name); };
  // Save the assembly as a reusable component. Selects every member of
  // this group, switches the project name to the group's name (which
  // the SaveComponentDialog uses as its default save name), then
  // dispatches the existing global "open-dialog" event the Workspace
  // already listens for. The dialog auto-detects the multi-selection
  // and defaults to "save selection only" so the user just confirms +
  // adds tags.
  const saveAsComponent = (e) => {
    e.stopPropagation();
    const ids = members.map((m) => m.id);
    if (ids.length === 0) return;
    const st = useScene.getState();
    // Replace the selection with exactly this group's members.
    useScene.setState({ selectedIds: ids, selectedId: ids[ids.length - 1] });
    // Seed the SaveComponentDialog's default name with the group name.
    if (typeof st.setProjectName === "function") {
      st.setProjectName(name);
    }
    window.dispatchEvent(new CustomEvent("forgeslicer:open-dialog", { detail: { name: "save_component" } }));
  };
  return (
    <div className="mb-1" data-testid={`group-${groupId}`}>
      <div
        onClick={() => {
          if (editing) return;  // don't reselect while renaming
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
        {editing ? (
          <input
            data-testid={`group-name-input-${groupId}`}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
            className="flex-1 min-w-0 bg-slate-950 border border-purple-500 rounded px-1 py-0.5 text-[11px] uppercase tracking-wider font-semibold text-white outline-none"
            maxLength={64}
          />
        ) : (
          <span
            data-testid={`group-name-${groupId}`}
            className="flex-1 truncate cursor-text"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
            title="Double-click to rename this assembly"
          >
            {name}
          </span>
        )}
        <button
          data-testid={`group-save-${groupId}`}
          onClick={saveAsComponent}
          title="Save this assembly to your Component Library"
          className="text-slate-500 hover:text-purple-300 transition-colors p-0.5 rounded hover:bg-slate-700/60"
        >
          <Save size={11} />
        </button>
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

import React, { useState } from "react";
import { toast } from "sonner";
import { useScene } from "../lib/store";
import {
  Box, Circle, Cylinder, Cone, Donut, Eye, EyeOff, Lock, Unlock,
  Trash2, Copy, PlusSquare, MinusSquare, ChevronRight, ChevronDown, Layers,
  Square as SquareIcon, Triangle as TriangleIcon, Hexagon as HexagonIcon, Pill,
  Sparkles, Tornado, CircleDashed, TriangleRight, Save, Bolt, Nut, Cog, Waves, Grid3X3, Type, Box as BoxIcon, ImageDown,
  Boxes,
} from "lucide-react";
import ContextMenu from "./ContextMenu";
import AIGenerateDialog from "./AIGenerateDialog";
import PhotoToPlaneDialog from "./dialogs/PhotoToPlaneDialog";
import HardwareLibraryDialog from "./dialogs/HardwareLibraryDialog";
import TextureLibraryDialog from "./dialogs/TextureLibraryDialog";
import DesignChatDialog from "./dialogs/DesignChatDialog";
import HoleDialog from "./dialogs/HoleDialog";
import { MessageCircle } from "lucide-react";
import { COMPONENTS, COMPONENT_CATEGORIES } from "../lib/componentLibrary";

const PRIMS_3D = [
  { type: "cube", label: "Rect. Solid", icon: Box, title: "Rectangular Solid — width × depth × height. Set each axis independently in the Inspector (a cube is just the special case where W=D=H)." },
  { type: "sphere", label: "Sphere", icon: Circle },
  { type: "cylinder", label: "Cylinder", icon: Cylinder },
  { type: "cone", label: "Cone", icon: Cone },
  { type: "torus", label: "Torus", icon: Donut },
  // ---- Curve / extrude primitives (1.12) ----
  { type: "helix", label: "Helix", icon: Tornado },
  { type: "pipe", label: "Pipe", icon: CircleDashed },
  { type: "wedge", label: "Wedge", icon: TriangleRight },
  // ---- Pyramid & N-gon Prism (iter-149, Release A) ----
  //   pyramid    → n-sided base + single apex (default n=4 → square pyramid).
  //   ngon_prism → n-sided base extruded to `h` mm (default n=6 → hex prism).
  // Both surface via PrimitiveButton like any other 3D shape.
  { type: "pyramid", label: "Pyramid", icon: TriangleIcon, title: "Pyramid — n-sided base + apex. Choose base sides (3–24) and height in the Inspector." },
  { type: "ngon_prism", label: "Prism", icon: HexagonIcon, title: "N-gon Prism — n-sided polygon extruded. Choose sides (3–24) and height in the Inspector." },
  // ---- Threaded fasteners (1.15) — keep in sync with AddPrimitiveButton.PRIMITIVES ----
  { type: "bolt", label: "Bolt", icon: Bolt },
  { type: "nut", label: "Nut", icon: Nut },
  // ---- Mechanical interfaces (1.16) ----
  { type: "spline", label: "Spline", icon: Cog },
  // ---- Sweep (1.18) — profile-along-path extrusion ----
  { type: "sweep", label: "Sweep", icon: Waves },
  // ---- Text (1.22) — extruded glyphs ----
  // Behaves like any other primitive: positive embosses, negative
  // engraves (via the standard CSG subtract path). The Inspector
  // exposes string / font / size / depth / bevel.
  { type: "text", label: "Text", icon: Type },
];

// 2D primitives — render as thin wafers; the user extrudes via the
// inspector when the sketch is ready.
const PRIMS_2D = [
  { type: "circle", label: "Circle", icon: Circle },
  // iter-149 — user PDF §2c: "Square" is technically a rectangle
  // (independent X/Y in `dims.side` isn't even fixed square). Renamed
  // to "Rectangle"; the internal type stays `square2d` so persisted
  // scenes + gallery entries still load. Tooltip clarifies.
  { type: "square2d", label: "Rectangle", icon: SquareIcon, title: "Rectangle — set width/depth independently in the Inspector; a square is just the special case where W = D." },
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
      title={p.title ? p.title : `Add ${isNeg ? "Negative" : "Positive"} ${p.label}`}
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
  // iter-105.7 — short-circuit the open if no eligible target is
  // selected. The dialog itself can no longer "drop a flat tile on
  // the bed" (that workflow was removed in iter-105.5) so opening it
  // without a target would just show a "pick a model first" banner
  // and waste a click. Surface a toast instead and bail.
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const handleClick = React.useCallback(() => {
    const target = selectedId ? objects.find((o) => o.id === selectedId) : null;
    if (!target || !["sphere", "cube", "cylinder", "cone"].includes(target.type)) {
      toast.warning(
        target
          ? `${target.name} (${target.type}) can't be wrapped — surface wrap supports sphere, cube, cylinder, cone.`
          : "Select an object first — pick a sphere, cube, cylinder or cone to wrap a texture onto.",
        { duration: 3000, id: "texture-no-target" },
      );
      return;
    }
    onOpenTextureLib();
  }, [selectedId, objects, onOpenTextureLib]);
  return (
    <button
      data-testid="open-texture-library-btn"
      onClick={handleClick}
      className="group flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400 transition-all"
      title="Texture Library — wrap a printable heightmap onto a selected sphere / cube / cylinder / cone."
    >
      <Grid3X3 size={18} strokeWidth={1.8} />
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">Textures</span>
    </button>
  );
}

// Countersink macro — drops a pre-grouped negative bore + negative
// chamfered cup so subtracting from a host produces a flush-head
// fastener hole in one click. The legacy 1-click drop stays for power
// users; the iter-111 HoleButton opens a richer preset dialog.
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

// iter-111 — opens the rich Hole/Countersink dialog (M3 / M4 / … presets,
// metric + imperial, with/without countersink, custom override).
function HoleButton({ onOpen }) {
  return (
    <button
      data-testid="add-hole-dialog-btn"
      onClick={onOpen}
      className="group flex flex-col items-center justify-center gap-1 h-16 rounded-md border border-cyan-500/30 hover:border-cyan-500 hover:bg-cyan-500/10 text-cyan-400 transition-all"
      title="Hole / Countersink dialog — pick a thread size (M3 / M4 / M5 / M6 / M8 or #4-#10) and get the right clearance + head dims baked in."
    >
      <CircleDashed size={18} strokeWidth={1.8} className="text-cyan-300" />
      <span className="text-[10px] uppercase tracking-wide font-medium text-slate-300">Hole / CS ⌀</span>
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
  const [photoPlaneOpen, setPhotoPlaneOpen] = useState(false);
  const [designChatOpen, setDesignChatOpen] = useState(false);
  const [holeDialogOpen, setHoleDialogOpen] = useState(false);
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
    { id: "3d",         label: "3D",    icon: Box,       title: "3D primitives — rectangular solid, sphere, cylinder, cone, pyramid, prism, torus, etc." },
    { id: "2d",         label: "2D",    icon: SquareIcon, title: "2D shapes — extrude in the inspector to give them depth" },
    { id: "composites", label: "Combo", icon: Pill,      title: "Pre-built composite assemblies (slots etc.)" },
    { id: "library",    label: "Lib",   icon: Boxes,     title: "Component Library — reusable parts (standoffs, brackets, hinges, gears)" },
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
        {tab === "composites" && <TabComposites onOpenHardwareLib={() => setHardwareLibOpen(true)} onOpenTextureLib={() => openTextureLibrary(null)} onOpenHoleDialog={() => setHoleDialogOpen(true)} />}
        {tab === "library" && <TabLibrary />}
        {tab === "ai" && <TabAI onOpenAi={() => setAiOpen(true)} onOpenPhotoPlane={() => setPhotoPlaneOpen(true)} onOpenDesignChat={() => setDesignChatOpen(true)} />}
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
      <PhotoToPlaneDialog open={photoPlaneOpen} onClose={() => setPhotoPlaneOpen(false)} />
      <HardwareLibraryDialog open={hardwareLibOpen} onClose={() => setHardwareLibOpen(false)} />
      <DesignChatDialog open={designChatOpen} onClose={() => setDesignChatOpen(false)} />
      <HoleDialog open={holeDialogOpen} onClose={() => setHoleDialogOpen(false)} />
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

function TabComposites({ onOpenHardwareLib, onOpenTextureLib, onOpenHoleDialog }) {
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
        <HoleButton onOpen={onOpenHoleDialog} />
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

// ---- iter-110 — Component Library tab ----
// Drops curated parametric components (standoffs, brackets, hinges,
// gears, …) into the scene as a single grouped assembly. Each recipe
// lives in `lib/componentLibrary.js`; this tab just renders the
// registry. Click a card → recipe builds 1-N primitives, all sharing
// a fresh groupId so the user moves them as one and can ungroup any
// time to fine-tune individual members.
function ComponentCard({ component }) {
  const Icon = component.icon || Boxes;
  const onAdd = () => {
    try {
      const objs = component.build();
      if (!objs || objs.length === 0) {
        toast.warning(`"${component.name}" returned no parts.`);
        return;
      }
      // Splice as one atomic op so a single undo removes the entire
      // assembly. `pushHistory` + `set` mirrors what addPrimitive does
      // internally; we can't reuse addPrimitive directly because it
      // builds the descriptor itself — our recipes hand us finished
      // descriptors already.
      useScene.getState().pushHistory();
      useScene.setState((st) => ({
        objects: [...st.objects, ...objs],
        selectedId: objs[0].id,
        selectedIds: objs.map((o) => o.id),
      }));
      toast.success(`Dropped "${component.name}" — ${objs.length} part${objs.length === 1 ? "" : "s"}, grouped.`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ComponentLibrary] build failed", e);
      toast.error(`Couldn't build ${component.name}: ${e.message || e}`);
    }
  };
  return (
    <button
      data-testid={`add-component-${component.id}`}
      onClick={onAdd}
      title={component.blurb}
      className="group flex items-start gap-2 p-2.5 rounded-md border border-slate-700 hover:border-emerald-400 hover:bg-emerald-500/5 text-left transition-colors"
    >
      <div className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0 bg-slate-800 group-hover:bg-emerald-500/15 text-emerald-400">
        <Icon size={17} strokeWidth={1.6} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-slate-200 truncate">{component.name}</div>
        <div className="text-[10px] text-slate-500 leading-snug line-clamp-2">{component.blurb}</div>
      </div>
    </button>
  );
}

function TabLibrary() {
  const [selectedCat, setSelectedCat] = useState("all");
  const filtered = selectedCat === "all"
    ? COMPONENTS
    : COMPONENTS.filter((c) => c.category === selectedCat);
  const cats = [{ id: "all", label: "All" }, ...COMPONENT_CATEGORIES];

  return (
    <>
      <SectionHeader
        icon={Boxes}
        accent="text-emerald-400"
        label="Component Library"
        right={<span className="text-[9px] uppercase tracking-wider text-slate-500" title="Click to drop into the scene. Each component is parametric — edit any dimension in the Inspector after.">parametric</span>}
      />
      {/* Category filter */}
      <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1" data-testid="library-cat-filter">
        {cats.map((c) => (
          <button
            key={c.id}
            data-testid={`library-cat-${c.id}`}
            onClick={() => setSelectedCat(c.id)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              selectedCat === c.id
                ? "bg-emerald-500/20 border-emerald-400/60 text-emerald-200"
                : "bg-slate-800/40 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-1.5 p-3" data-testid="library-grid">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic p-2">No components in this category yet.</p>
        ) : (
          filtered.map((c) => <ComponentCard key={c.id} component={c} />)
        )}
      </div>
      <p className="px-3 pb-3 text-[10px] text-slate-500 leading-snug">
        Tip — every dimension stays editable after the drop. Resize, recolour, ungroup, mix &amp; match into custom assemblies.
      </p>
    </>
  );
}

function TabAI({ onOpenAi, onOpenPhotoPlane, onOpenDesignChat }) {
  return (
    <>
      <SectionHeader
        icon={Sparkles}
        accent="text-orange-400"
        label="AI Generate"
        right={<span className="text-[9px] uppercase tracking-wider text-orange-400/90 border border-orange-500/40 rounded px-1.5 py-0.5">beta</span>}
      />
      <div className="p-3 space-y-2">
        <button
          data-testid="design-chat-open-btn"
          onClick={onOpenDesignChat}
          className="w-full h-12 rounded-md bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white shadow-lg shadow-orange-900/30 flex items-center justify-center gap-2 text-xs font-semibold tracking-wide transition-all"
          title="Chat with the model — describe what to build and it edits the scene live"
        >
          <MessageCircle size={14} />
          Design Chat
          <span className="text-[8px] uppercase tracking-widest bg-white/15 border border-white/20 rounded px-1.5 py-0.5">new</span>
        </button>
        <p className="text-[10px] text-slate-500 leading-snug">
          Describe a part or modification — the AI builds it on the bed, reads your selection, and stays grounded in CAD Z-up coordinates.
        </p>
        <div className="pt-2 border-t border-slate-800/80">
          <button
            data-testid="ai-generate-btn"
            onClick={onOpenAi}
            className="w-full h-11 rounded-md border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20 hover:border-orange-500 text-orange-300 flex items-center justify-center gap-2 text-xs font-semibold tracking-wide transition-colors"
            title="Generate a real 3D mesh from text or an image — Meshy.ai (third-party AI, 13 free gens/month)"
          >
            <Sparkles size={13} />
            AI 3D Mesh <span className="opacity-60 font-normal">— Meshy.ai</span>
          </button>
          <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
            Real 3D mesh (closed volume) from text or image via Meshy.ai. Best for organic shapes &amp; figurines; Design Chat is better for mechanical / parametric.
          </p>
        </div>
        <div className="pt-2 border-t border-slate-800/80">
          {/* Iter-149 Release B (PDF §3) — "Lithophane / 2.5D Relief"
              used to open the small PhotoToPlaneDialog, which the user
              flagged as *not* the LithoForge.net-equivalent flow they
              expect. The primary button now launches the full
              LithoStudio (/litho — hue-optimised multi-filament with
              3MF export, matches LithoForge.net feature parity). A
              smaller secondary link keeps the tiny 1-click photo→plate
              tool available for users who don't need the full studio. */}
          <button
            data-testid="lithophane-studio-btn"
            onClick={() => {
              // Open in a new tab so the workspace scene isn't lost —
              // LithoStudio has its own save state / palette workflow.
              window.open("/litho", "_blank", "noopener,noreferrer");
            }}
            className="w-full h-11 rounded-md border border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20 hover:border-teal-500 text-teal-300 flex items-center justify-center gap-2 text-xs font-semibold tracking-wide transition-colors"
            title="Open Lithophane Studio — full multi-filament optimiser with 3MF export, palette suggestions, and lightbox geometry. Opens in a new tab."
          >
            <ImageDown size={13} />
            Lithophane Studio
            <span className="text-[9px] font-normal text-teal-400/70 ml-0.5">↗</span>
          </button>
          <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
            Full lithophane / hue-forge flow with palette suggestions, layer preview &amp; multi-filament 3MF export. Opens in a new tab.
          </p>
          <button
            data-testid="photo-to-plane-btn"
            onClick={onOpenPhotoPlane}
            className="mt-2 w-full h-8 rounded-md border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 hover:border-slate-500 text-slate-300 flex items-center justify-center gap-1.5 text-[11px] font-medium transition-colors"
            title="Quick single-filament 2.5D relief — photo or text stays on this workspace as a mesh."
          >
            <ImageDown size={11} />
            Quick 2.5D Relief <span className="text-[10px] font-normal text-slate-500">— single filament</span>
          </button>
          <p className="mt-1 text-[9.5px] text-slate-500 leading-snug">
            One-shot photo →&nbsp;heightmap plate. Bright pixels tall, dark thin. Lives on the current workspace.
          </p>
        </div>
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

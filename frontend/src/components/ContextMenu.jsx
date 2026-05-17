import React, { useEffect, useRef } from "react";
import { Layers, Square as SquareIcon, GitMerge, Copy, Trash2, FlipHorizontal, FlipVertical, FlipHorizontal2 } from "lucide-react";
import { useScene } from "../lib/store";
import { evaluateSceneStatsAsync, exportSTLBytesAsync } from "../lib/workerClient";
import { evaluateScene } from "../lib/csg";

// A small right-click context menu shown for the viewport AND outliner.
// Positioned at the page coordinates passed via `position`, auto-closes on
// outside click / Esc / window blur. Items are dynamically enabled based on
// the current selection so users get the right affordances at a glance.
export default function ContextMenu({ position, onClose }) {
  const ref = useRef(null);
  const selectedIds = useScene((s) => s.selectedIds);
  const selectedId = useScene((s) => s.selectedId);
  const objects = useScene((s) => s.objects);
  const groupSelected = useScene((s) => s.groupSelected);
  const ungroupSelected = useScene((s) => s.ungroupSelected);
  const removeSelected = useScene((s) => s.removeSelected);
  const duplicateSelected = useScene((s) => s.duplicateSelected);
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
  const count = ids.length;
  const selectedObjs = ids.map((id) => objects.find((o) => o.id === id)).filter(Boolean);
  const someGrouped = selectedObjs.some((o) => o.groupId);
  const allInSameGroup = selectedObjs.length > 0 &&
    selectedObjs.every((o) => o.groupId === selectedObjs[0].groupId && o.groupId);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); clearTimeout(t); };
  }, [onClose]);

  const doFlatten = async () => {
    if (count === 0) return;
    try {
      // Run CSG on JUST the selection — same logic the export pipeline uses,
      // but scoped to selected objects. Returns one BufferGeometry that bakes
      // any positive/negative interactions inside the selection.
      const subset = selectedObjs;
      const r = evaluateScene(subset);
      if (r.empty || !r.geometry.attributes || !r.geometry.attributes.position) {
        alert("Could not flatten: the merged selection is empty.");
        return;
      }
      const pos = r.geometry.attributes.position.array;
      const verts = pos instanceof Float32Array ? pos.slice() : new Float32Array(pos);
      const idx = r.geometry.index ? new Uint32Array(r.geometry.index.array) : null;
      // Capture bbox so the resulting imported mesh has correct base size.
      const bb = r.geometry.boundingBox || (() => { r.geometry.computeBoundingBox(); return r.geometry.boundingBox; })();
      // Snapshot a representative name + modifier from the selection.
      const name = selectedObjs[0].groupName || (selectedObjs[0].name + " (flattened)");
      const newId = addImportedMesh(name, verts, idx, {
        x: bb.max.x - bb.min.x,
        y: bb.max.y - bb.min.y,
        z: bb.max.z - bb.min.z,
      });
      // Remove originals (after addImportedMesh so its history push wins).
      const ridsToRemove = selectedObjs.map((o) => o.id);
      useScene.setState((s) => ({
        objects: s.objects.filter((o) => !ridsToRemove.includes(o.id)),
        selectedId: newId,
        selectedIds: [newId],
      }));
    } catch (e) {
      alert("Flatten failed: " + (e.message || e));
    }
    onClose();
  };

  const Item = ({ icon: Icon, label, hint, onClick, disabled, danger, testid }) => (
    <button
      data-testid={testid}
      onClick={() => { if (!disabled) onClick(); }}
      disabled={disabled}
      className={`w-full px-3 h-8 text-left text-xs flex items-center gap-2 ${
        disabled ? "opacity-30 cursor-not-allowed text-slate-500"
        : danger ? "text-red-300 hover:bg-red-500/15"
        : "text-slate-200 hover:bg-slate-800"
      }`}
    >
      {Icon && <Icon size={13} className={danger ? "text-red-400" : "text-orange-400"} />}
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-slate-500 font-mono">{hint}</span>}
    </button>
  );

  const x = Math.min(position.x, window.innerWidth - 220);
  const y = Math.min(position.y, window.innerHeight - 250);

  return (
    <div
      ref={ref}
      data-testid="context-menu"
      className="fixed z-[300] w-56 bg-slate-900 border border-slate-700 rounded-md shadow-2xl py-1"
      style={{ left: x, top: y }}
    >
      <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-800 mb-1">
        {count === 0 ? "Nothing selected" : count === 1 ? selectedObjs[0]?.name || "Selection" : `${count} selected`}
      </div>
      <Item
        icon={Layers}
        label={allInSameGroup ? "Already in a group" : "Group selected"}
        testid="ctx-group-btn"
        disabled={count < 2 || allInSameGroup}
        onClick={() => { groupSelected("Assembly"); onClose(); }}
      />
      <Item
        icon={SquareIcon}
        label="Ungroup"
        testid="ctx-ungroup-btn"
        disabled={!someGrouped}
        onClick={() => { ungroupSelected(); onClose(); }}
      />
      <Item
        icon={GitMerge}
        label="Flatten to single mesh"
        hint="bake"
        testid="ctx-flatten-btn"
        disabled={count === 0}
        onClick={doFlatten}
      />
      <div className="h-px bg-slate-800 my-1" />
      <Item
        icon={Copy}
        label="Duplicate"
        testid="ctx-duplicate-btn"
        disabled={count === 0}
        onClick={() => { duplicateSelected({}); onClose(); }}
      />
      <Item
        icon={FlipHorizontal}
        label="Duplicate + Mirror X"
        testid="ctx-mirror-x-btn"
        disabled={count === 0}
        onClick={() => { duplicateSelected({ mirrorAxis: "x" }); onClose(); }}
      />
      <Item
        icon={FlipVertical}
        label="Duplicate + Mirror Y"
        testid="ctx-mirror-y-btn"
        disabled={count === 0}
        onClick={() => { duplicateSelected({ mirrorAxis: "y" }); onClose(); }}
      />
      <Item
        icon={FlipHorizontal2}
        label="Duplicate + Mirror Z"
        testid="ctx-mirror-z-btn"
        disabled={count === 0}
        onClick={() => { duplicateSelected({ mirrorAxis: "z" }); onClose(); }}
      />
      <div className="h-px bg-slate-800 my-1" />
      <Item
        icon={Trash2}
        label="Delete"
        hint="Del"
        testid="ctx-delete-btn"
        disabled={count === 0}
        danger
        onClick={() => { removeSelected(); onClose(); }}
      />
    </div>
  );
}

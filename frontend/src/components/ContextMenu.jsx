import React, { useEffect, useRef, useState } from "react";
import { Layers, Square as SquareIcon, GitMerge, Copy, Trash2, FlipHorizontal, FlipVertical, FlipHorizontal2, ArrowDownToLine, Library } from "lucide-react";
import { useScene } from "../lib/store";
import { evaluateScene } from "../lib/csg";
import { computeRotatedBBox } from "../lib/geometry";

// A small right-click context menu shown for the viewport AND outliner.
// Positioned at the page coordinates passed via `position`, auto-closes on
// outside click / Esc / window blur. Items are dynamically enabled based on
// the current selection so users get the right affordances at a glance.
export default function ContextMenu({ position, onClose }) {
  const ref = useRef(null);
  const groupSelected = useScene((s) => s.groupSelected);
  const ungroupSelected = useScene((s) => s.ungroupSelected);
  const removeSelected = useScene((s) => s.removeSelected);
  const duplicateSelected = useScene((s) => s.duplicateSelected);
  const dropToBed = useScene((s) => s.dropToBed);

  // Drop every part in the snapshot to the bed AS A UNIT — i.e. translate
  // the whole batch by the same dy so any spatial relationships between
  // members are preserved (a grouped assembly stays together).
  const doDropToBed = () => {
    restoreSelection();
    const ids = snapshot.ids;
    if (ids.length === 0) { onClose(); return; }
    if (ids.length === 1) {
      // Single part — use the existing dedicated action which also pushes
      // history and respects the user's snap settings.
      dropToBed(ids[0], true);
      onClose();
      return;
    }
    // Multi-part: compute world-min-Y across all selected and translate
    // every member down by that amount.
    try {
      const st = useScene.getState();
      let worldMinY = Infinity;
      for (const id of ids) {
        const o = st.objects.find((x) => x.id === id);
        if (!o) continue;
        try {
          const bb = computeRotatedBBox(o);
          const wy = (o.position?.[1] ?? 0) + bb.min.y;
          if (wy < worldMinY) worldMinY = wy;
        } catch (_) { /* skip non-bbox-able parts */ }
      }
      if (isFinite(worldMinY) && Math.abs(worldMinY) > 1e-3) {
        st.pushHistory();
        const dy = -worldMinY;
        useScene.setState((s) => ({
          objects: s.objects.map((o) =>
            ids.includes(o.id)
              ? { ...o, position: [o.position[0], o.position[1] + dy, o.position[2]] }
              : o
          ),
        }));
      }
    } catch (_) { /* non-fatal */ }
    onClose();
  };

  // ---- Snapshot selection at mount ---------------------------------------
  // We DO NOT subscribe to the store's selectedIds here. The menu represents
  // a frozen moment in time (the right-click). Any transient external
  // selection change (e.g. an onPointerMissed event from the canvas right
  // before the menu opens) MUST NOT toggle the menu items to disabled —
  // that was the source of the "Group selected does nothing" bug.
  const [snapshot] = useState(() => {
    const s = useScene.getState();
    const ids = (s.selectedIds && s.selectedIds.length)
      ? s.selectedIds.slice()
      : (s.selectedId ? [s.selectedId] : []);
    const objs = ids.map((id) => s.objects.find((o) => o.id === id)).filter(Boolean);
    return { ids, primary: s.selectedId, objs };
  });
  const count = snapshot.ids.length;
  const selectedObjs = snapshot.objs;
  const someGrouped = selectedObjs.some((o) => o.groupId);
  const allInSameGroup = selectedObjs.length > 0 &&
    selectedObjs.every((o) => o.groupId === selectedObjs[0].groupId && o.groupId);

  // Re-assert the captured selection into the store immediately before any
  // mutating action runs, so reducers reading get().selectedIds see the
  // intended set even after a transient clear.
  const restoreSelection = () => {
    if (snapshot.ids.length === 0) return;
    useScene.setState({
      selectedIds: snapshot.ids.slice(),
      selectedId: snapshot.primary || snapshot.ids[snapshot.ids.length - 1],
    });
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); clearTimeout(t); };
  }, [onClose]);

  const doFlatten = async () => {
    restoreSelection();
    const targetIds = snapshot.ids;
    if (targetIds.length === 0) { onClose(); return; }
    try {
      // Resolve fresh objects from current store (post restore).
      const subset = targetIds
        .map((id) => useScene.getState().objects.find((o) => o.id === id))
        .filter(Boolean);
      if (subset.length === 0) { onClose(); return; }
      const r = evaluateScene(subset);
      if (r.empty || !r.geometry.attributes || !r.geometry.attributes.position) {
        alert("Could not flatten: the merged selection is empty.");
        onClose();
        return;
      }
      const pos = r.geometry.attributes.position.array;
      const verts = pos instanceof Float32Array ? pos.slice() : new Float32Array(pos);
      const idx = r.geometry.index ? new Uint32Array(r.geometry.index.array) : null;
      const bb = r.geometry.boundingBox || (() => { r.geometry.computeBoundingBox(); return r.geometry.boundingBox; })();
      const name = subset[0].groupName || (subset[0].name + " (flattened)");
      // Build the new imported mesh object inline (mirrors store.addImportedMesh)
      // so we can do EVERYTHING in a single atomic setState — no race between
      // an add + filter pair.
      const baked = {
        id: `mesh-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        name,
        type: "imported",
        modifier: "positive",
        visible: true,
        locked: false,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        dims: {},
        colorIndex: 0,
        originalBbox: { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z },
        geometry: { vertices: verts, indices: idx },
      };
      // Push history BEFORE mutating so undo restores both the originals and
      // wipes the baked mesh.
      useScene.getState().pushHistory();
      useScene.setState((s) => ({
        objects: [...s.objects.filter((o) => !targetIds.includes(o.id)), baked],
        selectedId: baked.id,
        selectedIds: [baked.id],
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

  // Provisional position — clamps the click coords so the menu can't open
  // entirely off-screen. After the menu mounts we measure its actual size
  // and re-clamp precisely (effect below) so a very tall menu (lots of
  // group/ungroup/mirror options at once) doesn't get cut off the bottom
  // and become unreachable. Without this, scrolling the page can't bring
  // it back into view because the menu is `position: fixed`.
  const [pos, setPos] = useState({
    left: Math.min(Math.max(0, position.x), window.innerWidth - 240),
    top: Math.min(Math.max(0, position.y), window.innerHeight - 100),
  });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let left = position.x;
    let top = position.y;
    // If the menu would overflow the right edge, anchor it to the LEFT of
    // the cursor instead. Same for the bottom.
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ left, top });
  }, [position.x, position.y]);

  return (
    <div
      ref={ref}
      data-testid="context-menu"
      className="fixed z-[300] w-56 bg-slate-900 border border-slate-700 rounded-md shadow-2xl py-1 max-h-[85vh] overflow-y-auto"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-800 mb-1">
        {count === 0 ? "Nothing selected" : count === 1 ? selectedObjs[0]?.name || "Selection" : `${count} selected`}
      </div>
      <Item
        icon={ArrowDownToLine}
        label={count > 1 ? "Drop to bed (as unit)" : "Drop to bed"}
        hint="↓"
        testid="ctx-drop-bed-btn"
        disabled={count === 0}
        onClick={doDropToBed}
      />
      <Item
        icon={Library}
        label={count > 1 ? "Save selection as Component…" : "Save as Component…"}
        testid="ctx-save-component-btn"
        disabled={count === 0}
        onClick={() => {
          restoreSelection();
          // Open the SaveComponentDialog. It will detect the active sub-
          // selection (snapshot.ids ⊊ all objects) and default the
          // "Save selection only" checkbox to ON automatically.
          window.dispatchEvent(new CustomEvent("forgeslicer:open-dialog", { detail: { name: "save_component" } }));
          onClose();
        }}
      />
      <div className="h-px bg-slate-800 my-1" />
      <Item
        icon={Layers}
        label={allInSameGroup ? "Already in a group" : "Group selected"}
        testid="ctx-group-btn"
        disabled={count < 2 || allInSameGroup}
        onClick={() => { restoreSelection(); groupSelected("Assembly"); onClose(); }}
      />
      <Item
        icon={SquareIcon}
        label="Ungroup"
        testid="ctx-ungroup-btn"
        disabled={!someGrouped}
        onClick={() => { restoreSelection(); ungroupSelected(); onClose(); }}
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
        onClick={() => { restoreSelection(); duplicateSelected({}); onClose(); }}
      />
      <Item
        icon={FlipHorizontal}
        label="Duplicate + Mirror X"
        testid="ctx-mirror-x-btn"
        disabled={count === 0}
        onClick={() => { restoreSelection(); duplicateSelected({ mirrorAxis: "x" }); onClose(); }}
      />
      <Item
        icon={FlipVertical}
        label="Duplicate + Mirror Y"
        testid="ctx-mirror-y-btn"
        disabled={count === 0}
        onClick={() => { restoreSelection(); duplicateSelected({ mirrorAxis: "y" }); onClose(); }}
      />
      <Item
        icon={FlipHorizontal2}
        label="Duplicate + Mirror Z"
        testid="ctx-mirror-z-btn"
        disabled={count === 0}
        onClick={() => { restoreSelection(); duplicateSelected({ mirrorAxis: "z" }); onClose(); }}
      />
      <div className="h-px bg-slate-800 my-1" />
      <Item
        icon={Trash2}
        label="Delete"
        hint="Del"
        testid="ctx-delete-btn"
        disabled={count === 0}
        danger
        onClick={() => { restoreSelection(); removeSelected(); onClose(); }}
      />
    </div>
  );
}

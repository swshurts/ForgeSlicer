import React, { useEffect, useRef, useState } from "react";
import { Layers, Square as SquareIcon, GitMerge, Copy, Trash2, FlipHorizontal, FlipVertical, FlipHorizontal2, ArrowDownToLine, Library, Crosshair, Grid3X3, Waves, Spline, Ruler, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useScene } from "../lib/store";
import { flattenObjectsAsync } from "../lib/workerClient";
import { computeRotatedBBox } from "../lib/geometry";
import { suggestTutorialFor } from "../lib/tutorialSuggestions";

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

  // Center the selection on the build plate's origin (X=0, Z=0). Y is
  // preserved — users have a dedicated Drop-to-bed action for the
  // vertical case, and conflating them would make "Center" land an
  // assembly inside the build plate. Multi-part selections center as a
  // RIGID UNIT: we compute the combined world-AABB on the XZ plane,
  // then translate every selected member by the same dx/dz so internal
  // relationships are preserved (a grouped Pitman Arm stays together).
  //
  // Why combined-bbox center and not centroid-of-positions? Because
  // when one part is much larger than the others, the visual centre
  // of the assembly sits closer to the big part — using the bbox
  // center matches the eye's expectation. Using mean-of-positions
  // would skew the assembly toward whichever side has more parts.
  const doCenterOnBed = () => {
    restoreSelection();
    const ids = snapshot.ids;
    if (ids.length === 0) { onClose(); return; }
    try {
      const st = useScene.getState();
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const id of ids) {
        const o = st.objects.find((x) => x.id === id);
        if (!o) continue;
        try {
          const bb = computeRotatedBBox(o);
          const wx0 = (o.position?.[0] ?? 0) + bb.min.x;
          const wx1 = (o.position?.[0] ?? 0) + bb.max.x;
          const wz0 = (o.position?.[2] ?? 0) + bb.min.z;
          const wz1 = (o.position?.[2] ?? 0) + bb.max.z;
          if (wx0 < minX) minX = wx0;
          if (wx1 > maxX) maxX = wx1;
          if (wz0 < minZ) minZ = wz0;
          if (wz1 > maxZ) maxZ = wz1;
        } catch (_) {
          // Defensive: an exotic primitive without a computable bbox
          // falls back to its raw position so we still center
          // *something* rather than crash.
          const px = o.position?.[0] ?? 0;
          const pz = o.position?.[2] ?? 0;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (pz < minZ) minZ = pz;
          if (pz > maxZ) maxZ = pz;
        }
      }
      if (!isFinite(minX) || !isFinite(minZ)) { onClose(); return; }
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      // Short-circuit if already centered within 0.5mm — no point
      // pushing a no-op history entry that wastes an undo slot.
      if (Math.abs(cx) < 0.5 && Math.abs(cz) < 0.5) { onClose(); return; }
      st.pushHistory();
      useScene.setState((s) => ({
        objects: s.objects.map((o) =>
          ids.includes(o.id)
            ? { ...o, position: [o.position[0] - cx, o.position[1], o.position[2] - cz] }
            : o
        ),
      }));
    } catch (_) { /* non-fatal */ }
    onClose();
  };

  // "Park on bed" — combines Center-on-bed + Drop-to-bed in a single
  // history-pushable action. The most common pre-print operation:
  // land the assembly flat on the plate AND center it. Without this
  // the user has to invoke two menu items separately (and burn two
  // undo slots). Math is identical to the individual actions; we
  // just compute both translations from the same world-AABB pass so
  // we only iterate the scene once. Rigid-body invariant preserved
  // because every selected member translates by the same (dx, dy, dz).
  const doParkOnBed = () => {
    restoreSelection();
    const ids = snapshot.ids;
    if (ids.length === 0) { onClose(); return; }
    try {
      const st = useScene.getState();
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const id of ids) {
        const o = st.objects.find((x) => x.id === id);
        if (!o) continue;
        try {
          const bb = computeRotatedBBox(o);
          const px = o.position?.[0] ?? 0;
          const py = o.position?.[1] ?? 0;
          const pz = o.position?.[2] ?? 0;
          const wx0 = px + bb.min.x;
          const wx1 = px + bb.max.x;
          const wy0 = py + bb.min.y;
          const wz0 = pz + bb.min.z;
          const wz1 = pz + bb.max.z;
          if (wx0 < minX) minX = wx0;
          if (wx1 > maxX) maxX = wx1;
          if (wy0 < minY) minY = wy0;
          if (wz0 < minZ) minZ = wz0;
          if (wz1 > maxZ) maxZ = wz1;
        } catch (_) {
          const px = o.position?.[0] ?? 0;
          const py = o.position?.[1] ?? 0;
          const pz = o.position?.[2] ?? 0;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (pz < minZ) minZ = pz;
          if (pz > maxZ) maxZ = pz;
        }
      }
      if (!isFinite(minX) || !isFinite(minZ) || !isFinite(minY)) { onClose(); return; }
      const dx = -(minX + maxX) / 2;
      const dy = -minY;
      const dz = -(minZ + maxZ) / 2;
      // Short-circuit if already parked within 0.5mm on every axis —
      // don't burn an undo slot on a no-op.
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(dz) < 0.5) {
        onClose(); return;
      }
      st.pushHistory();
      useScene.setState((s) => ({
        objects: s.objects.map((o) =>
          ids.includes(o.id)
            ? { ...o, position: [o.position[0] + dx, o.position[1] + dy, o.position[2] + dz] }
            : o
        ),
      }));
    } catch (_) { /* non-fatal */ }
    onClose();
  };
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
  // Texture-library dialog open trigger lives on the store so the
  // dialog can outlive the context menu (the menu unmounts on click;
  // the dialog is rendered once at Workspace level).
  const openTextureLibrary = useScene((s) => s.openTextureLibrary);
  const addSweepFromSketch = useScene((s) => s.addSweepFromSketch);

  // ---- Component-pair dimension wiring ----
  // Pending source id lives on the store so the workflow is "click target
  // first → right-click → 'Measure to...' → right-click DIFFERENT object →
  // 'Add dimension here'". Reading it here lets us swap the menu label
  // dynamically depending on whether we're starting or finishing a pair.
  const pendingDimensionFromId = useScene((s) => s.pendingDimensionFromId);
  const beginComponentDimension = useScene((s) => s.beginComponentDimension);
  const commitComponentDimension = useScene((s) => s.commitComponentDimension);
  const clearPendingComponentDimension = useScene((s) => s.clearPendingComponentDimension);
  const pendingDimensionFromObj = pendingDimensionFromId
    ? useScene.getState().objects.find((o) => o.id === pendingDimensionFromId)
    : null;
  // Tutorial suggestion. Single-object selection is the common case, but
  // when the user right-clicks a child of a composite group the workspace
  // auto-selects ALL group members (e.g. Bolt + Nut for a Fastener Pair).
  // We still want to surface the Hardware tutorial in that case, so the
  // gate is "single object OR every selected object shares the same groupId".
  // suggestTutorialFor() itself returns null when nothing applies, so the
  // render branch ({tutorialSuggestion && …}) below collapses to nothing
  // when irrelevant — no need for a stricter gate here.
  const probeObj = (() => {
    if (count === 1) return selectedObjs[0];
    if (count > 1 && allInSameGroup) return selectedObjs[0];
    return null;
  })();
  const tutorialSuggestion = probeObj ? suggestTutorialFor(probeObj) : null;

  // True when exactly one sketch primitive is selected — drives the
  // visibility of the "Use sketch as Sweep profile / path" items.
  const singleSketch = selectedObjs.length === 1 && selectedObjs[0]?.type === "sketch";

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
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    window.addEventListener("keydown", onKey);
    // 350ms grace so the long-press touch that OPENED the menu (and any
    // synthesized mouse events from it) can't immediately close it.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("touchstart", onDown, { passive: true });
    }, 350);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      clearTimeout(t);
    };
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
      const r = await flattenObjectsAsync(subset);
      if (!r || !r.vertices || r.vertices.length === 0) {
        alert("Could not flatten: the merged selection is empty.");
        onClose();
        return;
      }
      const verts = r.vertices;
      const idx = r.indices;
      const bb = r.bbox;
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
        originalBbox: bb ? { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z } : { x: 0, y: 0, z: 0 },
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
        icon={Layers}
        label={count > 1 ? "Lay flat (as unit)" : "Lay flat"}
        hint="⇲"
        testid="ctx-lay-flat-btn"
        disabled={count === 0}
        onClick={() => {
          restoreSelection();
          try { useScene.getState().layFlatSelection(true); }
          catch (e) { toast.error(`Lay flat failed: ${e?.message || e}`); }
          onClose();
        }}
      />
      <Item
        icon={ArrowDownToLine}
        label={count > 1 ? "Drop to bed (as unit)" : "Drop to bed"}
        hint="↓"
        testid="ctx-drop-bed-btn"
        disabled={count === 0}
        onClick={doDropToBed}
      />
      <Item
        icon={Crosshair}
        label={count > 1 ? "Center on bed (as unit)" : "Center on bed"}
        hint="⊕"
        testid="ctx-center-bed-btn"
        disabled={count === 0}
        onClick={doCenterOnBed}
      />
      <Item
        icon={ArrowDownToLine}
        label={count > 1 ? "Park on bed (as unit)" : "Park on bed"}
        hint="↧"
        testid="ctx-park-bed-btn"
        disabled={count === 0}
        onClick={doParkOnBed}
      />
      <Item
        icon={Grid3X3}
        label="Apply texture to face…"
        testid="ctx-apply-texture-btn"
        disabled={count !== 1}
        onClick={() => {
          restoreSelection();
          // Single-object only: a texture on a multi-selection is
          // ambiguous (which face? whose bounds?). Disable above
          // ensures count===1; we still guard here defensively.
          const targetId = snapshot.primary || snapshot.ids[0];
          if (targetId) openTextureLibrary(targetId);
          onClose();
        }}
      />
      {singleSketch && (
        <>
          <Item
            icon={Waves}
            label="Use sketch as Sweep profile"
            testid="ctx-sketch-as-sweep-profile-btn"
            onClick={() => {
              restoreSelection();
              const id = addSweepFromSketch(snapshot.ids[0], "profile");
              if (id) toast.success("Sweep created — edit path in Inspector");
              else toast.error("Need at least 3 sketch points to build a profile");
              onClose();
            }}
          />
          <Item
            icon={Spline}
            label="Use sketch as Sweep path (3D)"
            testid="ctx-sketch-as-sweep-path-btn"
            onClick={() => {
              restoreSelection();
              const id = addSweepFromSketch(snapshot.ids[0], "path");
              if (id) toast.success("Sweep created — set rise in Inspector to lift Y");
              else toast.error("Need at least 3 sketch points to build a path");
              onClose();
            }}
          />
        </>
      )}
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
      {/* ---- Component-pair dimension (Blender-style "Item" offsets) ---- */}
      {(() => {
        const targetId = snapshot.primary || snapshot.ids[0];
        if (count !== 1 || !targetId) {
          return (
            <Item
              icon={Ruler}
              label="Measure to…"
              testid="ctx-measure-to-btn"
              disabled
              onClick={() => {}}
            />
          );
        }
        const pending = pendingDimensionFromId;
        if (!pending) {
          // Phase 1: start a pair from THIS object.
          return (
            <Item
              icon={Ruler}
              label="Measure to…"
              hint="pick 2nd"
              testid="ctx-measure-to-btn"
              onClick={() => {
                restoreSelection();
                beginComponentDimension(targetId);
                toast.message(`Now right-click the second part to dimension to "${selectedObjs[0]?.name || "it"}"`);
                onClose();
              }}
            />
          );
        }
        if (pending === targetId) {
          // Phase 1.5: same object right-clicked again → cancel.
          return (
            <Item
              icon={Ruler}
              label="Cancel pending measure"
              hint="esc"
              testid="ctx-measure-cancel-btn"
              onClick={() => { clearPendingComponentDimension(); onClose(); }}
            />
          );
        }
        // Phase 2: commit the pair.
        const fromName = pendingDimensionFromObj?.name || "part";
        return (
          <Item
            icon={Ruler}
            label={`Add dimension: ${fromName} ↔ here`}
            testid="ctx-measure-commit-btn"
            onClick={() => {
              restoreSelection();
              const id = commitComponentDimension(targetId);
              if (id) toast.success("Dimension added — drag either part to see it update");
              else toast.error("Could not add dimension (same object?)");
              onClose();
            }}
          />
        );
      })()}
      {/* ---- Smart tutorial deep-link ---- */}
      {tutorialSuggestion && (
        <Item
          icon={BookOpen}
          label={`Tutorial: ${tutorialSuggestion.title}`}
          hint="pdf"
          testid="ctx-tutorial-link-btn"
          onClick={() => {
            window.open(`/docs/${tutorialSuggestion.file}`, "_blank", "noopener,noreferrer");
            onClose();
          }}
        />
      )}
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

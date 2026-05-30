// Hierarchical Project Explorer dialog.
//
// Renders the user's nested project tree (Project → Subproject → Sub-
// subproject → …) and lets them:
//   • Create a new project (root or under any node)
//   • Rename a project (inline)
//   • Delete a project — cascades to descendants on the backend
//   • Re-parent a project ("Move into…" picker)
//   • Open a project — loads its saved scene into the workspace
//   • Save the current scene into the selected project (overwrites
//     that node's forge_json blob)
//
// The dialog fetches a flat list of meta nodes (no forge_json blobs)
// from /api/projects and builds the tree client-side. Tree state lives
// in this component only — when the user clicks Open / Save, we round-
// trip through the store's serialize / loadProject methods.
//
// All endpoints under /api/projects require auth, so we show a sign-in
// nudge when the user is anonymous.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  X, Folder, FolderOpen, FolderPlus, Plus, Trash2, Edit2, Check,
  ChevronRight, ChevronDown, Save, Download, Move, LogIn, Loader2,
  AlertTriangle,
} from "lucide-react";
import { projectsApi } from "../../lib/api";
import { useScene } from "../../lib/store";
import { useAuth } from "../../contexts/AuthContext";
import { apiErrorMessage } from "../../lib/api";

// Build a tree from a flat list of meta records.
// Returns an array of root nodes; each node has `meta` + `children` (array).
function buildTree(metaList) {
  const byId = new Map();
  for (const m of metaList) byId.set(m.project_id, { meta: m, children: [] });
  const roots = [];
  for (const node of byId.values()) {
    const pid = node.meta.parent_id;
    if (pid && byId.has(pid)) byId.get(pid).children.push(node);
    else roots.push(node);
  }
  // Stable alphabetical-then-created sort at each level.
  const sortLevel = (arr) => {
    arr.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
    for (const c of arr) sortLevel(c.children);
  };
  sortLevel(roots);
  return roots;
}

// Walk a subtree and return every project_id within it (including the root)
// — used to gray-out candidate parents in the "Move into…" picker so users
// can't try to re-parent under their own descendant.
function collectDescendantIds(node, out = new Set()) {
  out.add(node.meta.project_id);
  for (const c of node.children) collectDescendantIds(c, out);
  return out;
}

export default function ProjectExplorerDialog({ open, onClose }) {
  const { user } = useAuth();
  const serialize = useScene((s) => s.serialize);
  const loadProject = useScene((s) => s.loadProject);
  const setCurrentProject = useScene((s) => s.setCurrentProject);
  const projectName = useScene((s) => s.projectName);

  const [loading, setLoading] = useState(false);
  const [metas, setMetas] = useState([]);                 // flat list from API
  const [expanded, setExpanded] = useState(new Set());    // project_ids
  const [selectedId, setSelectedId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingUnder, setCreatingUnder] = useState(null);  // parent_id or "__ROOT__"
  const [createValue, setCreateValue] = useState("");
  const [busyId, setBusyId] = useState(null);             // shows spinner inline
  const [movingId, setMovingId] = useState(null);         // shows the "Move into…" picker
  const [confirmDelete, setConfirmDelete] = useState(null); // node pending confirm
  // ---- DnD state ----
  // `draggingId` is the pid currently being dragged. Cleared on dragend
  // regardless of drop outcome. `dragOverId` is the pid currently under
  // the cursor — used to render the orange ring on the drop target.
  // `dragOverRoot` is the boolean version of dragOverId for the explicit
  // top-level drop zone. Hovering a node that is the dragged node ITSELF
  // or one of its descendants is rejected client-side (we still rely on
  // the backend's cycle-detector for safety).
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);

  const tree = useMemo(() => buildTree(metas), [metas]);

  // For each project, the set of its descendant project_ids (INCLUSIVE
  // of itself). Used by DnD to instantly tell whether a hovered row is
  // a valid drop target for the dragged node (you can't drop a node
  // onto itself or any of its descendants — that would create a cycle).
  const descendantMap = useMemo(() => {
    const map = new Map();
    const fill = (n) => {
      const set = new Set();
      set.add(n.meta.project_id);
      for (const c of n.children) {
        fill(c);
        for (const id of map.get(c.meta.project_id)) set.add(id);
      }
      map.set(n.meta.project_id, set);
    };
    for (const r of tree) fill(r);
    return map;
  }, [tree]);

  // Returns true when `targetId` is a legal drop target for the currently
  // dragged node. Null target = "top level" zone (always legal if the
  // dragged node isn't already a root).
  const isLegalDrop = useCallback((targetId) => {
    if (!draggingId) return false;
    if (targetId === null) {
      const dragged = metas.find((m) => m.project_id === draggingId);
      return !!dragged && dragged.parent_id !== null; // already root → no-op
    }
    if (targetId === draggingId) return false;
    const draggedDescendants = descendantMap.get(draggingId);
    if (draggedDescendants && draggedDescendants.has(targetId)) return false;
    // Skip drops that wouldn't change anything (target is already the parent).
    const dragged = metas.find((m) => m.project_id === draggingId);
    if (dragged && dragged.parent_id === targetId) return false;
    return true;
  }, [draggingId, descendantMap, metas]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await projectsApi.list();
      setMetas(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (open && user) refresh();
  }, [open, user, refresh]);

  // Auto-expand every root when projects first load so the user can see
  // their whole tree without clicking — they almost always want this view.
  useEffect(() => {
    if (metas.length && expanded.size === 0) {
      setExpanded(new Set(metas.filter((m) => !m.parent_id).map((m) => m.project_id)));
    }
  }, [metas, expanded.size]);

  if (!open) return null;

  const toggleExpand = (pid) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };

  const handleCreate = async (parent_id) => {
    const name = (createValue || "").trim();
    if (!name) { toast.error("Project name is required"); return; }
    setBusyId(parent_id || "__ROOT__");
    try {
      await projectsApi.create({ name, parent_id });
      setCreateValue("");
      setCreatingUnder(null);
      await refresh();
      toast.success(`Created “${name}”`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = async (pid) => {
    const name = (renameValue || "").trim();
    if (!name) { toast.error("Name is required"); return; }
    setBusyId(pid);
    try {
      await projectsApi.update(pid, { name });
      setRenamingId(null);
      setRenameValue("");
      await refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (node) => {
    setBusyId(node.meta.project_id);
    try {
      const r = await projectsApi.remove(node.meta.project_id);
      const n = r?.deleted ?? 1;
      await refresh();
      toast.success(`Deleted ${n} project${n === 1 ? "" : "s"}`);
      setConfirmDelete(null);
      if (selectedId === node.meta.project_id) setSelectedId(null);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (pid, newParentId) => {
    setBusyId(pid);
    try {
      // Sentinel "__ROOT__" tells the backend to detach (parent_id=null).
      await projectsApi.update(pid, { parent_id: newParentId || "__ROOT__" });
      setMovingId(null);
      await refresh();
      toast.success("Moved");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  // DnD drop handler — shared by both the per-row drop and the top-level
  // drop zone. `targetParentId` is the new parent (null = root). Kept as
  // a plain const because the JSX-only usages don't need referential
  // stability, and hoisting it above the early-return guard would
  // require duplicating handleMove or restructuring everything.
  const handleDrop = async (targetParentId) => {
    const draggedId = draggingId;
    setDraggingId(null);
    setDragOverId(null);
    setDragOverRoot(false);
    if (!draggedId) return;
    if (!isLegalDrop(targetParentId)) return;
    await handleMove(draggedId, targetParentId);
  };

  const handleSaveSceneInto = async (pid, nodeName) => {
    if (!window.confirm(`Save the current scene into “${nodeName}”? This replaces any geometry already on that project.`)) return;
    setBusyId(pid);
    try {
      const forge_json = serialize();
      await projectsApi.update(pid, { forge_json });
      // Link the scene to this project so the breadcrumb (and future
      // ctrl-S autosaves) target the right node automatically.
      setCurrentProject(pid, nodeName);
      await refresh();
      toast.success(`Saved scene into “${nodeName}”`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleOpen = async (pid, nodeName) => {
    setBusyId(pid);
    try {
      const detail = await projectsApi.get(pid);
      const fj = detail?.forge_json || {};
      if (!fj.objects || fj.objects.length === 0) {
        // Empty project — let the user start fresh under this node's name.
        const ok = window.confirm(`“${nodeName}” has no saved geometry yet. Clear the current scene and start fresh on this project?`);
        if (!ok) { setBusyId(null); return; }
        loadProject({ ...fj, projectName: nodeName, objects: [] });
      } else {
        loadProject({ ...fj, projectName: fj.projectName || nodeName });
      }
      // Set the linkage AFTER loadProject so the breadcrumb knows which
      // node to anchor on. loadProject doesn't touch currentProjectId
      // unless the incoming payload explicitly carries one.
      setCurrentProject(pid, nodeName);
      toast.success(`Opened “${nodeName}”`);
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="project-explorer-dialog"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white">Projects</h2>
            <span className="text-[10px] text-slate-500 font-mono">
              {user ? `${metas.length} total` : "sign in required"}
            </span>
          </div>
          <button
            data-testid="project-explorer-close"
            onClick={onClose}
            className="h-7 w-7 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 min-h-[200px]">
          {!user ? (
            <div className="flex flex-col items-center justify-center text-center py-10 px-4">
              <Folder size={32} className="text-slate-600 mb-3" />
              <div className="text-sm text-slate-300 mb-1">Sign in to organize projects</div>
              <p className="text-xs text-slate-500 max-w-xs mb-4">
                Group related parts hierarchically — Rocket → Engine → Fuel Pump.
                Each node can hold its own saved scene.
              </p>
              <Link
                to={`/signin?return=${encodeURIComponent("/workspace")}`}
                onClick={onClose}
                data-testid="project-explorer-signin-link"
                className="h-8 px-3 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5"
              >
                <LogIn size={13} /> Sign in
              </Link>
            </div>
          ) : loading && metas.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-slate-500 text-xs gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading projects…
            </div>
          ) : (
            <>
              {/* Root-level "+ New project" row — also acts as the
                  drop zone for "move to top level". When a node is being
                  dragged AND it's not already root, the box gets an
                  orange dashed ring to invite the drop. */}
              <div
                className={`flex items-center gap-2 mb-2 rounded transition-colors ${
                  draggingId && isLegalDrop(null)
                    ? (dragOverRoot ? "ring-2 ring-orange-500 bg-orange-500/10 p-1" : "ring-1 ring-dashed ring-slate-600 p-1")
                    : ""
                }`}
                data-testid="project-drop-root"
                onDragOver={(e) => {
                  if (draggingId && isLegalDrop(null)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverRoot(true);
                  }
                }}
                onDragLeave={() => setDragOverRoot(false)}
                onDrop={(e) => { e.preventDefault(); handleDrop(null); }}
              >
                {creatingUnder === "__ROOT__" ? (
                  <CreateRow
                    value={createValue}
                    onChange={setCreateValue}
                    onCommit={() => handleCreate(null)}
                    onCancel={() => { setCreatingUnder(null); setCreateValue(""); }}
                    busy={busyId === "__ROOT__"}
                    testid="project-create-root-input"
                  />
                ) : (
                  <button
                    data-testid="project-create-root-btn"
                    onClick={() => { setCreatingUnder("__ROOT__"); setCreateValue(""); }}
                    className="h-7 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-orange-500/60 text-xs text-slate-200 rounded flex items-center gap-1.5"
                  >
                    <FolderPlus size={12} className="text-orange-400" /> New top-level project
                  </button>
                )}
                {draggingId && isLegalDrop(null) && (
                  <span className="text-[10px] text-orange-300 font-mono">drop here to move to top level</span>
                )}
              </div>

              {tree.length === 0 && creatingUnder !== "__ROOT__" && (
                <div className="text-center py-8 text-xs text-slate-500">
                  No projects yet. Create one to start grouping designs.
                </div>
              )}

              <ul className="space-y-0.5">
                {tree.map((n) => (
                  <ProjectNode
                    key={n.meta.project_id}
                    node={n}
                    depth={0}
                    expanded={expanded}
                    toggleExpand={toggleExpand}
                    selectedId={selectedId}
                    setSelectedId={setSelectedId}
                    renamingId={renamingId}
                    setRenamingId={setRenamingId}
                    renameValue={renameValue}
                    setRenameValue={setRenameValue}
                    creatingUnder={creatingUnder}
                    setCreatingUnder={setCreatingUnder}
                    createValue={createValue}
                    setCreateValue={setCreateValue}
                    busyId={busyId}
                    movingId={movingId}
                    setMovingId={setMovingId}
                    metas={metas}
                    onCreate={handleCreate}
                    onRename={handleRename}
                    onDelete={(node) => setConfirmDelete(node)}
                    onMove={handleMove}
                    onSaveSceneInto={handleSaveSceneInto}
                    onOpen={handleOpen}
                    draggingId={draggingId}
                    setDraggingId={setDraggingId}
                    dragOverId={dragOverId}
                    setDragOverId={setDragOverId}
                    isLegalDrop={isLegalDrop}
                    handleDrop={handleDrop}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-500 leading-snug">
          Click <strong className="text-slate-300">Open</strong> to load a project · <strong className="text-slate-300">Save here</strong> to store the current scene ·{" "}
          <strong className="text-slate-300">drag</strong> a row onto another project to re-parent (or onto the top-level row).
          Current scene: <span className="text-orange-300 font-mono">{projectName}</span>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4" data-testid="project-delete-confirm">
          <div className="bg-slate-900 border border-red-500/60 rounded-lg shadow-2xl p-4 max-w-md w-full">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle size={18} className="text-red-400 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-white">Delete “{confirmDelete.meta.name}”?</div>
                <div className="text-xs text-slate-400 mt-1">
                  {confirmDelete.children.length > 0
                    ? `This will permanently delete this project AND all ${countAll(confirmDelete) - 1} nested item${countAll(confirmDelete) - 1 === 1 ? "" : "s"} below it. This can't be undone.`
                    : "This will permanently delete this project. This can't be undone."}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                data-testid="project-delete-cancel"
                onClick={() => setConfirmDelete(null)}
                className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded border border-slate-700"
              >
                Cancel
              </button>
              <button
                data-testid="project-delete-confirm-btn"
                onClick={() => handleDelete(confirmDelete)}
                disabled={busyId === confirmDelete.meta.project_id}
                className="h-7 px-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-xs text-white font-semibold rounded flex items-center gap-1.5"
              >
                {busyId === confirmDelete.meta.project_id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Count every project_id inside a subtree (including the root). Used to
// show "delete N items" in the confirmation dialog.
function countAll(node) {
  let n = 1;
  for (const c of node.children) n += countAll(c);
  return n;
}

// Inline "type a new project name" row — reused for root and per-node
// nested creates. Submits on Enter / cancels on Esc / blur (unless busy).
function CreateRow({ value, onChange, onCommit, onCancel, busy, testid }) {
  return (
    <div className="flex items-center gap-1.5 flex-1">
      <input
        autoFocus
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          else if (e.key === "Escape") onCancel();
        }}
        placeholder="Project name"
        className="h-7 flex-1 bg-slate-950 border border-orange-500/60 rounded text-xs text-white px-2 focus:border-orange-400 outline-none"
      />
      <button
        onClick={onCommit}
        disabled={busy}
        className="h-7 px-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-semibold rounded flex items-center"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button
        onClick={onCancel}
        className="h-7 px-2 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded border border-slate-700"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// Recursive tree row + nested children. Click row → select.
// Buttons appear on hover for less visual noise.
function ProjectNode({
  node, depth,
  expanded, toggleExpand,
  selectedId, setSelectedId,
  renamingId, setRenamingId, renameValue, setRenameValue,
  creatingUnder, setCreatingUnder, createValue, setCreateValue,
  busyId, movingId, setMovingId, metas,
  onCreate, onRename, onDelete, onMove, onSaveSceneInto, onOpen,
  draggingId, setDraggingId, dragOverId, setDragOverId,
  isLegalDrop, handleDrop,
}) {
  const pid = node.meta.project_id;
  const isExpanded = expanded.has(pid);
  const isSelected = selectedId === pid;
  const isRenaming = renamingId === pid;
  const isMoving = movingId === pid;
  const hasChildren = node.children.length > 0;
  const isBusy = busyId === pid;
  const isBeingDragged = draggingId === pid;
  // Is this row currently a legal drop target hovered by a drag?
  const isDropTarget = dragOverId === pid && isLegalDrop && isLegalDrop(pid);

  // Build the list of valid move-target candidates: every project EXCEPT
  // this node and its descendants (cycle check) and except its current parent.
  const descendantIds = useMemo(() => collectDescendantIds(node), [node]);
  const moveCandidates = useMemo(() => {
    if (!isMoving) return [];
    return metas.filter((m) =>
      !descendantIds.has(m.project_id) &&
      m.project_id !== node.meta.parent_id
    );
  }, [isMoving, metas, descendantIds, node.meta.parent_id]);

  return (
    <li>
      <div
        data-testid={`project-row-${pid}`}
        draggable={!isRenaming}
        onDragStart={(e) => {
          if (isRenaming) return;
          setDraggingId(pid);
          e.dataTransfer.effectAllowed = "move";
          // Setting any data makes the browser actually fire dragstart
          // events in Firefox/Safari. The value isn't used (we use the
          // dialog-scoped state) but it MUST be non-empty.
          try { e.dataTransfer.setData("text/plain", pid); } catch { /* ignore */ }
        }}
        onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
        onDragOver={(e) => {
          if (draggingId && isLegalDrop(pid)) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (dragOverId !== pid) setDragOverId(pid);
          }
        }}
        onDragLeave={() => { if (dragOverId === pid) setDragOverId(null); }}
        onDrop={(e) => {
          if (!draggingId || !isLegalDrop(pid)) return;
          e.preventDefault();
          e.stopPropagation();
          handleDrop(pid);
        }}
        onClick={() => setSelectedId(pid)}
        className={`group flex items-center gap-1 px-1.5 py-1 rounded text-xs cursor-grab active:cursor-grabbing transition-colors ${
          isDropTarget
            ? "bg-orange-500/20 ring-2 ring-orange-500 border border-transparent"
            : isSelected
              ? "bg-orange-500/15 border border-orange-500/40"
              : "hover:bg-slate-800 border border-transparent"
        } ${isBeingDragged ? "opacity-40" : ""}`}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            data-testid={`project-toggle-${pid}`}
            onClick={(e) => { e.stopPropagation(); toggleExpand(pid); }}
            className="h-4 w-4 flex items-center justify-center text-slate-500 hover:text-orange-400"
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="h-4 w-4 inline-block" />
        )}
        {isExpanded ? (
          <FolderOpen size={12} className="text-orange-400 flex-shrink-0" />
        ) : (
          <Folder size={12} className="text-slate-400 flex-shrink-0" />
        )}
        {isRenaming ? (
          <input
            autoFocus
            data-testid={`project-rename-input-${pid}`}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename(pid);
              else if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
            }}
            onBlur={() => { if (!isBusy) onRename(pid); }}
            className="h-6 flex-1 bg-slate-950 border border-orange-500/60 rounded text-xs text-white px-1.5 outline-none"
          />
        ) : (
          <span className="text-slate-100 truncate flex-1" title={node.meta.description || node.meta.name}>
            {node.meta.name}
          </span>
        )}
        {node.meta.object_count > 0 && !isRenaming && (
          <span className="text-[9px] text-slate-500 font-mono ml-1" title={`${node.meta.object_count} object${node.meta.object_count === 1 ? "" : "s"} saved`}>
            {node.meta.object_count} obj
          </span>
        )}
        {/* Inline actions — visible on hover OR when row is selected */}
        <div className={`flex items-center gap-0.5 ml-1 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
          <IconAction
            testid={`project-open-${pid}`}
            title="Open this project into the workspace"
            onClick={(e) => { e.stopPropagation(); onOpen(pid, node.meta.name); }}
            disabled={isBusy}
          >
            <Download size={11} />
          </IconAction>
          <IconAction
            testid={`project-save-here-${pid}`}
            title="Save the current scene into this project"
            onClick={(e) => { e.stopPropagation(); onSaveSceneInto(pid, node.meta.name); }}
            disabled={isBusy}
          >
            <Save size={11} />
          </IconAction>
          <IconAction
            testid={`project-add-child-${pid}`}
            title="Add a child project under this one"
            onClick={(e) => {
              e.stopPropagation();
              setCreatingUnder(pid);
              setCreateValue("");
              if (!isExpanded) toggleExpand(pid);
            }}
          >
            <Plus size={11} />
          </IconAction>
          <IconAction
            testid={`project-rename-${pid}`}
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              setRenamingId(pid);
              setRenameValue(node.meta.name);
            }}
          >
            <Edit2 size={11} />
          </IconAction>
          <IconAction
            testid={`project-move-${pid}`}
            title="Move into another project"
            onClick={(e) => { e.stopPropagation(); setMovingId(isMoving ? null : pid); }}
          >
            <Move size={11} />
          </IconAction>
          <IconAction
            testid={`project-delete-${pid}`}
            title="Delete (cascades to children)"
            onClick={(e) => { e.stopPropagation(); onDelete(node); }}
            danger
          >
            <Trash2 size={11} />
          </IconAction>
        </div>
        {isBusy && <Loader2 size={11} className="animate-spin text-orange-400 ml-1" />}
      </div>

      {/* Move-into picker — appears directly below the row */}
      {isMoving && (
        <div
          data-testid={`project-move-picker-${pid}`}
          className="ml-7 mt-1 mb-1 p-2 bg-slate-950/60 border border-slate-700 rounded"
        >
          <div className="text-[10px] text-slate-400 mb-1.5">Move “{node.meta.name}” into:</div>
          <div className="flex flex-wrap gap-1">
            <button
              data-testid={`project-move-to-root-${pid}`}
              onClick={() => onMove(pid, null)}
              className="h-6 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-200 rounded"
            >
              ↑ Top level
            </button>
            {moveCandidates.length === 0 ? (
              <span className="text-[10px] text-slate-500 italic px-1">No valid targets</span>
            ) : (
              moveCandidates.map((m) => (
                <button
                  key={m.project_id}
                  data-testid={`project-move-target-${m.project_id}`}
                  onClick={() => onMove(pid, m.project_id)}
                  className="h-6 px-2 bg-slate-800 hover:bg-orange-500/20 hover:border-orange-500/60 border border-slate-700 text-[10px] text-slate-200 rounded flex items-center gap-1"
                >
                  <Folder size={9} className="text-orange-400" /> {m.name}
                </button>
              ))
            )}
            <button
              onClick={() => setMovingId(null)}
              className="h-6 px-2 text-[10px] text-slate-500 hover:text-slate-300"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {/* Inline create-child row */}
      {creatingUnder === pid && (
        <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: `${6 + (depth + 1) * 14 + 4}px` }}>
          <FolderPlus size={11} className="text-orange-400" />
          <CreateRow
            value={createValue}
            onChange={setCreateValue}
            onCommit={() => onCreate(pid)}
            onCancel={() => { setCreatingUnder(null); setCreateValue(""); }}
            busy={busyId === pid}
            testid={`project-create-child-input-${pid}`}
          />
        </div>
      )}

      {hasChildren && isExpanded && (
        <ul className="space-y-0.5">
          {node.children.map((c) => (
            <ProjectNode
              key={c.meta.project_id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggleExpand={toggleExpand}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              creatingUnder={creatingUnder}
              setCreatingUnder={setCreatingUnder}
              createValue={createValue}
              setCreateValue={setCreateValue}
              busyId={busyId}
              movingId={movingId}
              setMovingId={setMovingId}
              metas={metas}
              onCreate={onCreate}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
              onSaveSceneInto={onSaveSceneInto}
              onOpen={onOpen}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              dragOverId={dragOverId}
              setDragOverId={setDragOverId}
              isLegalDrop={isLegalDrop}
              handleDrop={handleDrop}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function IconAction({ children, testid, title, onClick, disabled, danger }) {
  return (
    <button
      data-testid={testid}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`h-5 w-5 rounded flex items-center justify-center transition-colors ${
        danger
          ? "text-slate-400 hover:text-red-300 hover:bg-red-500/15"
          : "text-slate-400 hover:text-orange-300 hover:bg-slate-800"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

// Hierarchical project breadcrumb — shown at the top of the workspace
// when the current scene is linked to a project in the user's tree
// (loaded via "Open" in ProjectExplorerDialog, or after a "Save here").
//
// Example: `Rocket  ›  Engine  ›  Fuel Pump  ·  Untitled scene`
//
// Each ancestor segment is clickable; clicking instantly loads that
// project's saved scene into the workspace (uses the same code path
// as the dialog's Open action — fetches forge_json then calls
// store.loadProject). The leaf segment (the project the scene is
// currently in) is shown but NOT clickable; the very last token
// (after the bullet) is the live scene name from the store.
//
// Hidden entirely when there's no currentProjectId (anonymous user,
// fresh scene, or imported file) — keeps the toolbar uncluttered for
// the simple-flat-flow use case.
import React, { useState, useEffect } from "react";
import { ChevronRight, FolderOpen, Loader2, CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { useScene } from "../lib/store";
import { projectsApi, apiErrorMessage } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { getSaveBehavior, subscribeSaveBehavior } from "../lib/savePref";

// Walk up the parent chain from `pid` using the flat meta list, returning
// the path from root to leaf (inclusive). Stops if a parent reference
// points at a deleted project or if a cycle is somehow present
// (defensive — the backend cycle-detector should prevent this).
function buildAncestry(pid, metas) {
  if (!pid || !metas?.length) return [];
  const byId = new Map(metas.map((m) => [m.project_id, m]));
  const seen = new Set();
  const chain = [];
  let cur = byId.get(pid);
  while (cur && !seen.has(cur.project_id)) {
    seen.add(cur.project_id);
    chain.unshift({ id: cur.project_id, name: cur.name });
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return chain;
}

export default function ProjectBreadcrumb({ projectMetas }) {
  const currentProjectId = useScene((s) => s.currentProjectId);
  const projectName = useScene((s) => s.projectName);
  const loadProject = useScene((s) => s.loadProject);
  const setCurrentProject = useScene((s) => s.setCurrentProject);
  const serialize = useScene((s) => s.serialize);
  const { user } = useAuth();
  const [loadingId, setLoadingId] = useState(null);
  const [savingCloud, setSavingCloud] = useState(false);
  // Mirror the Ctrl+S preference into local state so we can show a
  // small hint in the breadcrumb ("Ctrl+S → cloud", etc.) without the
  // component bypassing React's render path.
  const [saveBehavior, setSaveBehaviorLocal] = useState(() => getSaveBehavior());
  useEffect(() => subscribeSaveBehavior(setSaveBehaviorLocal), []);

  // Bail out silently when no linkage exists — keep the toolbar lean.
  if (!currentProjectId) return null;
  const ancestry = buildAncestry(currentProjectId, projectMetas);
  if (ancestry.length === 0) return null;

  const handleJump = async (target) => {
    // The leaf (current) is rendered without an onClick, so target is
    // always a strictly-ancestral node here.
    setLoadingId(target.id);
    try {
      const detail = await projectsApi.get(target.id);
      const fj = detail?.forge_json || {};
      if (!fj.objects || fj.objects.length === 0) {
        const ok = window.confirm(`“${target.name}” has no saved geometry yet. Switch to it with an empty scene?`);
        if (!ok) { setLoadingId(null); return; }
        loadProject({ ...fj, projectName: target.name, objects: [] });
      } else {
        loadProject({ ...fj, projectName: fj.projectName || target.name });
      }
      setCurrentProject(target.id, target.name);
      toast.success(`Switched to “${target.name}”`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLoadingId(null);
    }
  };

  // One-click save the current scene back into the linked project.
  // This is the visible counterpart to the Ctrl+S preference — even
  // users on "local" mode can still save to the cloud whenever they
  // want via this button (so the keyboard shortcut never feels like
  // the only path).
  const handleCloudSave = async () => {
    if (!user) {
      toast.error("Sign in to save to the cloud");
      return;
    }
    setSavingCloud(true);
    try {
      const payload = serialize();
      const lastSegment = ancestry[ancestry.length - 1];
      await projectsApi.update(currentProjectId, { forge_json: payload });
      toast.success(`Saved into “${lastSegment?.name || "project"}”`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSavingCloud(false);
    }
  };

  return (
    <div
      data-testid="project-breadcrumb"
      className="flex items-center gap-1 px-4 py-1 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400 overflow-x-auto"
    >
      <FolderOpen size={11} className="text-orange-400 flex-shrink-0" />
      {ancestry.map((node, i) => {
        const isLeaf = i === ancestry.length - 1;
        const isLoading = loadingId === node.id;
        return (
          <React.Fragment key={node.id}>
            {i > 0 && <ChevronRight size={10} className="text-slate-600 flex-shrink-0" />}
            {isLeaf ? (
              <span
                className="font-semibold text-slate-200 truncate"
                data-testid={`breadcrumb-current-${node.id}`}
                title={`Current project: ${node.name}`}
              >
                {node.name}
              </span>
            ) : (
              <button
                data-testid={`breadcrumb-jump-${node.id}`}
                onClick={() => handleJump(node)}
                disabled={isLoading}
                title={`Open “${node.name}”`}
                className="hover:text-orange-300 hover:underline disabled:opacity-50 disabled:cursor-wait truncate inline-flex items-center gap-1"
              >
                {isLoading && <Loader2 size={9} className="animate-spin" />}
                {node.name}
              </button>
            )}
          </React.Fragment>
        );
      })}
      <span className="text-slate-600">·</span>
      <span
        className="text-orange-300 font-mono text-[10px] truncate"
        title="Current scene name (editable in the top bar)"
        data-testid="breadcrumb-scene-name"
      >
        {projectName || "Untitled"}
      </span>

      {/* Right-aligned actions: small cloud-save button + Ctrl+S hint.
          The save button is ALWAYS available when a project is linked,
          regardless of the user's Ctrl+S preference — so a "local
          mode" user can still cloud-save with a single click. */}
      <div className="flex-1" />
      <button
        data-testid="breadcrumb-cloud-save-btn"
        onClick={handleCloudSave}
        disabled={savingCloud}
        title="Save the current scene into this project (Cmd/Ctrl+S can be configured to do this — see Settings → Saving)"
        className="h-6 px-2 rounded text-[10px] font-semibold flex items-center gap-1 bg-slate-800 hover:bg-orange-500/20 hover:text-orange-300 text-slate-300 border border-slate-700 disabled:opacity-50 disabled:cursor-wait flex-shrink-0"
      >
        {savingCloud ? <Loader2 size={10} className="animate-spin" /> : <CloudUpload size={10} />}
        Save to project
      </button>
      <span
        className="text-[9px] font-mono text-slate-600 flex-shrink-0"
        title="Configure in Settings → Saving"
        data-testid="breadcrumb-save-hint"
      >
        ⌘S → {saveBehavior}
      </span>
    </div>
  );
}

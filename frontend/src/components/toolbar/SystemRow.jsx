// Top toolbar — system row.
//
// First row of the toolbar: brand, file I/O (new/open/save/import),
// export (STL / 3MF / preview), spacer, voice mic, project name,
// gallery link, Share / Save Component / Send to Slicer buttons,
// release-notes / help / user menu.
//
// Self-contained except for the busy indicator and Send-to-Slicer
// handler — both forwarded from `TopToolbar` so the parent owns the
// dialog flow and the cross-row "Exporting…" message.
import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  FilePlus2, FileUp, FileDown, Save, Upload, Layers, Eye,
  Hexagon, Globe, Library, Printer, ChevronDown, Sparkles, Settings as SettingsIcon,
  FolderTree,
} from "lucide-react";
import { useScene } from "../../lib/store";
import { getSlicersForPrinter } from "../../lib/presets";
import { getPreferredSlicer, getAllSlicers } from "../../lib/customSlicers";
import { IconBtn, Divider } from "./ToolbarUI";
import VoiceButton from "../VoiceButton";
import HelpMegaMenu from "./HelpMegaMenu";
import VoiceCommandPalette from "../VoiceCommandPalette";
import UserMenu from "../UserMenu";
import ThemeSwitcher from "./ThemeSwitcher";

export default function SystemRow({
  busyMsg,
  actions,
  onShare, onSaveComponent, onSendToOrca, onOpenHelp,
  onPreviewExport, onOpenProjectExplorer,
}) {
  const projectName = useScene((s) => s.projectName);
  const setProjectName = useScene((s) => s.setProjectName);
  const objects = useScene((s) => s.objects);
  const clearScene = useScene((s) => s.clearScene);
  const printerId = useScene((s) => s.printerId);
  const printerRecommended = getSlicersForPrinter(printerId);
  // Iter-82: if the user has starred a preferred slicer in
  // OrcaDialog, honour it as the toolbar's primary one-click target.
  // Otherwise fall back to the printer-recommended slicer (the
  // existing behaviour). The dropdown still shows every option —
  // built-in + recommended + user-custom — so the user can override
  // per-print without changing their default.
  const preferred = getPreferredSlicer();
  const userSlicers = getAllSlicers();
  // Build the merged option list, de-duping by id. Order:
  //   1. Preferred slicer (if any) — first so the primary button hits it
  //   2. Printer-recommended slicers
  //   3. Any user-custom slicers not already in the list
  const slicers = [];
  const pushedIds = new Set();
  const pushSlicer = (s) => {
    if (!s || !s.id || pushedIds.has(s.id)) return;
    slicers.push(s);
    pushedIds.add(s.id);
  };
  if (preferred) pushSlicer(preferred);
  for (const s of printerRecommended) pushSlicer(s);
  for (const s of userSlicers) pushSlicer(s);
  const primarySlicer = slicers[0] || { id: "orca", name: "OrcaSlicer" };
  const alternateSlicers = slicers.slice(1);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);

  return (
    <div
      className="min-h-12 flex flex-wrap items-center px-3 gap-y-1 gap-x-1 py-1"
      data-testid="top-toolbar-row-system"
    >
      <Link to="/" className="flex items-center gap-2 px-2 mr-1 select-none" data-testid="brand">
        <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow">
          <Hexagon size={16} className="text-white" strokeWidth={2.4} />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-bold text-white tracking-tight">ForgeSlicer</div>
          <div className="text-[9px] uppercase tracking-widest text-orange-400 -mt-0.5">CAD + Slice</div>
        </div>
      </Link>

      <Divider />

      <IconBtn
        testid="file-new-btn"
        onClick={() => { if (window.confirm("Start a new project? Unsaved changes will be lost.")) clearScene(); }}
        title="New Project"
      >
        <FilePlus2 size={16} />
      </IconBtn>
      <IconBtn testid="file-open-btn" onClick={actions.handleOpenProject} title="Open Project (.forge.json)">
        <FileUp size={16} />
      </IconBtn>
      <IconBtn testid="file-save-btn" onClick={actions.handleSaveProject} title="Save Project to Local">
        <Save size={16} />
      </IconBtn>
      <IconBtn testid="file-import-btn" onClick={actions.handleImport} title="Import STL / OBJ / 3MF / SVG">
        <Upload size={16} />
      </IconBtn>
      <IconBtn
        testid="open-project-explorer-btn"
        onClick={onOpenProjectExplorer}
        title="Projects — nest designs hierarchically (Rocket → Engine → Fuel Pump)"
      >
        <FolderTree size={16} />
      </IconBtn>

      <Divider />

      <IconBtn testid="export-stl-btn" onClick={actions.handleExportSTL} title="Export STL">
        <FileDown size={16} />
        <span className="text-[9px] font-bold ml-0.5">STL</span>
      </IconBtn>
      <IconBtn testid="export-3mf-btn" onClick={actions.handleExport3MF} title="Export 3MF">
        <Layers size={16} />
      </IconBtn>
      <IconBtn testid="stl-preview-btn" onClick={onPreviewExport} title="Preview the export in 3D (verify carves before slicing)">
        <Eye size={16} />
      </IconBtn>

      <div className="flex-1" />

      <VoiceButton />
      <VoiceCommandPalette />

      <input
        data-testid="project-name-input"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        className="h-8 w-40 md:w-48 min-w-[120px] bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none font-mono ml-1"
        placeholder="project name"
      />

      <Link
        to="/gallery"
        data-testid="open-gallery-btn"
        className="h-8 px-3 ml-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700"
      >
        <Globe size={14} /> Gallery
      </Link>
      <button
        data-testid="share-design-btn"
        onClick={onShare}
        className="h-8 px-3 ml-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700"
      >
        <Globe size={14} /> Share
      </button>
      <button
        data-testid="save-component-btn"
        onClick={onSaveComponent}
        disabled={objects.length === 0}
        className="h-8 px-3 ml-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
        title="Save current scene as a reusable component to the public library"
      >
        <Library size={14} /> Component
      </button>

      {/* Primary Send-to-Slicer + optional dropdown for alternates */}
      <button
        data-testid="send-to-orcaslicer-btn"
        onClick={() => onSendToOrca(primarySlicer)}
        className="h-8 px-3 ml-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-l flex items-center gap-1.5 shadow"
        title={
          primarySlicer.isPreferred
            ? `Send to ${primarySlicer.name} (your preferred slicer)`
            : `Send to ${primarySlicer.name} (recommended for your printer)`
        }
      >
        <Printer size={14} />
        {primarySlicer.isPreferred && <span className="text-amber-200">★</span>}
        Send to {primarySlicer.name}
      </button>
      {alternateSlicers.length > 0 && (
        <div className="relative">
          <button
            data-testid="send-slicer-menu-btn"
            onClick={() => setSendMenuOpen((v) => !v)}
            // 150ms grace so the picked option's mousedown fires before
            // we tear down the menu — otherwise clicking an alternate
            // does nothing.
            onBlur={() => setTimeout(() => setSendMenuOpen(false), 150)}
            className="h-8 px-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-r border-l border-orange-700 flex items-center shadow"
            title="Choose a different slicer"
          >
            <ChevronDown size={14} />
          </button>
          {sendMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded shadow-xl z-50 min-w-[180px]"
              data-testid="send-slicer-menu"
            >
              {alternateSlicers.map((s) => (
                <button
                  key={s.id}
                  data-testid={`send-slicer-option-${s.id}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSendMenuOpen(false);
                    onSendToOrca(s);
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 flex items-center gap-2"
                >
                  <Printer size={12} className="text-orange-400" /> {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {busyMsg && (
        <span className="ml-2 text-xs text-orange-400 font-mono">{busyMsg}</span>
      )}

      <button
        data-testid="whats-new-btn"
        onClick={() => window.dispatchEvent(new CustomEvent("forgeslicer:show-release-notes"))}
        title="Release notes — see what's new"
        className="h-8 w-8 ml-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 flex items-center justify-center"
      >
        <Sparkles size={16} />
      </button>
      <HelpMegaMenu onOpenInApp={onOpenHelp} />
      <button
        data-testid="settings-btn"
        onClick={() => window.dispatchEvent(new CustomEvent("forgeslicer:open-dialog", { detail: { name: "settings" } }))}
        title="Settings — Appearance & Engine"
        className="h-8 w-8 ml-1 rounded text-slate-400 hover:text-orange-300 hover:bg-slate-800 flex items-center justify-center"
      >
        <SettingsIcon size={16} />
      </button>
      <ThemeSwitcher />
      <UserMenu returnPath="/workspace" />
    </div>
  );
}

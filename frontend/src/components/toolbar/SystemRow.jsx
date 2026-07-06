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
  FilePlus2, FileUp, FileDown, Save, Upload, Layers, Eye, ShieldCheck,
  Hexagon, Globe, Library, Printer, ChevronDown, Sparkles, Settings as SettingsIcon,
  FolderTree, ShoppingBag,
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
  onPreviewExport, onOpenProjectExplorer, onOpenPrintability,
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
      {/* iter-126 — Print-Readiness. Runs the analyzer on the current
          scene and slides in the docked report panel. High-visibility
          orange badge because it's the tent-pole feature for the
          AI-mesh-to-printable-file positioning. */}
      <IconBtn
        testid="printability-open-btn"
        onClick={onOpenPrintability}
        title="Print-Readiness — score this scene and see fixable issues"
      >
        <ShieldCheck size={16} className="text-orange-400" />
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

      {/* iter-130: Marketplace hover-menu — combines ForgeSlicer's
          public model gallery with the new Lithophane marketplace
          (Phase 2 of the LithoForge merge). Single access point in
          the toolbar keeps the header uncluttered. */}
      <MarketplaceMenu />
      {/* iter-128: Lithophane Studio — LithoForge merged in-tree as
          the /litho route. This is the *creation* tool (photo → CMYKW),
          distinct from the marketplace above (browse/buy other
          people's lithophanes). Two separate CTAs on purpose. */}
      <Link
        to="/litho"
        data-testid="open-lithoforge-btn"
        title="Lithophane Studio — photo → CMYKW multi-color lithophane → 3MF ready to slice"
        className="h-8 px-3 ml-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded hidden lg:flex items-center gap-1.5 border border-slate-700"
      >
        <Sparkles size={13} className="text-orange-400" /> Lithophane
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


// iter-130 — Marketplace hover-menu. Two-item dropdown: Models (the
// public gallery ForgeSlicer already had) + Lithophanes (the merged
// LithoForge marketplace at /litho/marketplace). Uses pure CSS
// hover/focus so we don't pull in a full popover primitive for a
// two-line list. Delay-open + delay-close on group-hover makes the
// hit target forgiving.
function MarketplaceMenu() {
  return (
    <div
      className="relative group ml-2"
      data-testid="marketplace-menu"
    >
      <button
        type="button"
        data-testid="marketplace-menu-btn"
        className="h-8 px-3 bg-slate-800 hover:bg-slate-700 group-hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700"
        title="Browse the community marketplace"
      >
        <ShoppingBag size={13} /> Marketplace
        <ChevronDown size={11} className="text-slate-400 group-hover:text-slate-200 transition" />
      </button>
      <div
        className="absolute top-full right-0 mt-1 w-64 bg-slate-950 border border-slate-800 rounded shadow-2xl overflow-hidden opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity z-50"
        role="menu"
      >
        <Link
          to="/gallery"
          data-testid="marketplace-menu-models"
          className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-900 border-b border-slate-800"
          role="menuitem"
        >
          <div className="w-8 h-8 rounded bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
            <Globe size={15} className="text-slate-300" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white">Models</div>
            <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
              STL / 3MF designs — remix, download, publish.
            </div>
          </div>
        </Link>
        <Link
          to="/litho/marketplace"
          data-testid="marketplace-menu-lithophanes"
          className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-900"
          role="menuitem"
        >
          <div className="w-8 h-8 rounded bg-orange-500/10 border border-orange-500/40 flex items-center justify-center flex-shrink-0">
            <Sparkles size={15} className="text-orange-400" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white">Lithophanes</div>
            <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
              Multi-color CMYKW lithophanes — buy print-ready 3MFs from creators.
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
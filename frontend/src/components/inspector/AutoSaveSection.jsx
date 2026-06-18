// AutoSaveSection — sidebar widget for the File System Access API
// powered project auto-save.
//
// Extracted from RightPanel.jsx during the iter-103.3 refactor pass.
// Pure code-move, no behaviour change. The dynamic `import('../lib/
// autoSave')` calls inside the handlers keep the autoSave module
// off the critical-path JS bundle — kept exactly as they were so
// the inspector still mounts instantly even if autoSave hasn't been
// chunk-fetched yet.
import React, { useState } from "react";
import { useScene } from "../../lib/store";

function AutoSaveSection() {
  const [enabled, setEnabled] = React.useState(false);
  const [filename, setFilename] = React.useState(null);
  const [supportsFS, setSupportsFS] = React.useState(false);
  const [savedAgo, setSavedAgo] = React.useState(null);
  const projectName = useScene((s) => s.projectName);

  React.useEffect(() => {
    let dead = false;
    (async () => {
      const m = await import("../../lib/autoSave");
      if (dead) return;
      setSupportsFS(m.isFileSystemAccessSupported());
      setFilename(m.getActiveAutoSaveLabel());
      setEnabled(!!m.getActiveAutoSaveLabel());
    })();
    // Tick "saved x seconds ago" every 5s for the UI.
    const t = setInterval(async () => {
      const m = await import("../../lib/autoSave");
      const ts = m.getLastSavedAt();
      if (!ts) { setSavedAgo(null); return; }
      const s = Math.floor((Date.now() - ts) / 1000);
      setSavedAgo(s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`);
    }, 5000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  const onEnable = async () => {
    const m = await import("../../lib/autoSave");
    const ok = await m.pickAutoSaveDestination(projectName);
    if (ok) {
      setEnabled(true);
      setFilename(m.getActiveAutoSaveLabel());
      // Trigger first save immediately.
      window.dispatchEvent(new CustomEvent("forgeslicer:auto-save-now"));
    }
  };
  const onDisable = async () => {
    const m = await import("../../lib/autoSave");
    m.clearAutoSaveDestination();
    setEnabled(false);
    setFilename(null);
    setSavedAgo(null);
  };

  return (
    <div className="pt-2 border-t border-slate-800 mt-2 space-y-1.5" data-testid="autosave-section">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Auto-Save Project</div>
      {!enabled ? (
        <>
          <button
            data-testid="autosave-enable-btn"
            onClick={onEnable}
            className="w-full h-8 bg-slate-800 hover:bg-orange-500/20 hover:border-orange-500/50 border border-slate-700 text-slate-200 text-[11px] font-semibold rounded flex items-center justify-center gap-1.5"
          >
            Pick auto-save file…
          </button>
          <p className="text-[10px] text-slate-500 leading-snug">
            {supportsFS
              ? "Saves the editable project JSON to a file you choose, automatically while you work."
              : "Your browser doesn't support direct file writes, so auto-save will dump to your Downloads folder (each save creates a new file with a numbered suffix)."}
          </p>
        </>
      ) : (
        <>
          <div className="text-[10px] font-mono text-orange-300 truncate" title={filename || ""}>
            {supportsFS ? "📂 " : "⬇ "}{filename}
          </div>
          <div className="text-[10px] text-slate-500">
            {savedAgo ? `Last saved ${savedAgo}` : "Will save on next change"}
          </div>
          <button
            data-testid="autosave-disable-btn"
            onClick={onDisable}
            className="w-full h-7 bg-slate-900 hover:bg-red-500/10 hover:border-red-500/30 border border-slate-800 text-slate-400 hover:text-red-300 text-[10px] rounded"
          >
            Turn off auto-save
          </button>
        </>
      )}
    </div>
  );
}

export default AutoSaveSection;

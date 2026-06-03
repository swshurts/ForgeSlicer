// Iter-84: ZipImportDialog — preview + pick UI for ZIP archives
// imported into ForgeSlicer.
//
// Two flavours are auto-detected from the archive contents (see
// `inspectZipFile` in lib/exporters.js):
//
//   1. Mesh bundle  — the ZIP contains one or more .stl / .obj /
//      .3mf / .glb / .svg files. The user picks which to import
//      via checkboxes; selected files are imported in sequence
//      through the existing per-format importers. (The "Thingiverse
//      multi-part download" case.)
//
//   2. OrcaSlicer config bundle — the ZIP contains printer.json /
//      process.json / filament.json. We surface them as a single
//      "Import as printer profile" action that pipes through the
//      existing `parseOrcaPrinterJson` helper. (Bulk profile upload
//      flow the user requested.)
//
//   3. Mixed — show both sections so the user can do whatever they
//      came for.

import { useEffect, useState } from "react";
import { X, Loader2, FileBox, Package, CheckSquare, Square as SquareIcon, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { inspectZipFile, meshEntryToFile } from "../../lib/exporters";

export default function ZipImportDialog({ open, file, onClose, onImportMesh, onImportOrcaConfig }) {
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meshPicks, setMeshPicks] = useState({});         // path → bool
  const [busyAction, setBusyAction] = useState(null);     // null | "meshes" | "orca"

  // Inspect when dialog opens. Manifest stays in state until close.
  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    inspectZipFile(file)
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        // Default: every mesh selected. Most users want everything
        // — opting OUT individual files is the less common case.
        const defaults = {};
        for (const f of m.meshFiles) defaults[f.path] = true;
        setMeshPicks(defaults);
      })
      .catch((e) => { if (!cancelled) setError(e.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, file]);

  if (!open) return null;

  const allMeshesPicked = manifest && manifest.meshFiles.length > 0
    && manifest.meshFiles.every((f) => meshPicks[f.path]);
  const toggleAll = () => {
    if (!manifest) return;
    const next = {};
    for (const f of manifest.meshFiles) next[f.path] = !allMeshesPicked;
    setMeshPicks(next);
  };

  const handleImportSelectedMeshes = async () => {
    if (!manifest) return;
    const selected = manifest.meshFiles.filter((f) => meshPicks[f.path]);
    if (selected.length === 0) {
      toast.warning("Pick at least one file to import.");
      return;
    }
    setBusyAction("meshes");
    try {
      let success = 0;
      for (const entry of selected) {
        try {
          await onImportMesh(meshEntryToFile(entry));
          success++;
        } catch (err) {
          toast.error(`Couldn't import ${entry.name}: ${err.message || err}`);
        }
      }
      if (success > 0) {
        toast.success(`Imported ${success} of ${selected.length} file${selected.length === 1 ? "" : "s"} from ZIP.`);
        onClose();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportOrcaConfigs = async () => {
    if (!manifest) return;
    setBusyAction("orca");
    try {
      const result = await onImportOrcaConfig(manifest.orcaConfigs);
      if (result?.imported) {
        toast.success(`Imported "${result.name || "printer profile"}" from ZIP bundle.`);
        onClose();
      }
    } catch (err) {
      toast.error(`Couldn't import config bundle: ${err.message || err}`);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="zip-import-dialog"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[88vh] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-cyan-400" />
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Import from ZIP</h2>
              <div className="text-[10px] text-slate-500 leading-tight truncate max-w-[26ch]">{file?.name}</div>
            </div>
          </div>
          <button onClick={onClose} data-testid="zip-import-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-400 text-xs gap-2">
              <Loader2 size={16} className="animate-spin" /> Inspecting archive…
            </div>
          )}
          {error && !loading && (
            <div className="bg-rose-500/10 border border-rose-500/40 rounded p-3 text-xs text-rose-200 flex items-start gap-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {manifest && !loading && (
            <>
              {/* Empty / unrecognised archive */}
              {manifest.meshFiles.length === 0 && manifest.orcaConfigs.length === 0 && (
                <div className="bg-amber-500/10 border border-amber-500/40 rounded p-3 text-xs text-amber-200 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={13} />
                    <span>
                      This ZIP has no recognised meshes (STL / OBJ / 3MF / GLB / SVG)
                      and no OrcaSlicer config JSONs. We don't know how to import it.
                    </span>
                  </div>
                  <div className="text-[10px] text-amber-300/70 pl-5">
                    Found {manifest.totalEntries} file{manifest.totalEntries === 1 ? "" : "s"} —
                    none in a supported format.
                  </div>
                </div>
              )}

              {/* Mesh bundle section */}
              {manifest.meshFiles.length > 0 && (
                <section className="space-y-2" data-testid="zip-import-mesh-section">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileBox size={13} className="text-orange-400" />
                      <h3 className="text-[11px] uppercase tracking-wider text-slate-300 font-semibold">
                        Mesh files ({manifest.meshFiles.length})
                      </h3>
                    </div>
                    <button
                      data-testid="zip-import-toggle-all"
                      onClick={toggleAll}
                      className="text-[10px] text-cyan-300 hover:text-cyan-100"
                    >
                      {allMeshesPicked ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto bg-slate-950 border border-slate-800 rounded p-1.5">
                    {manifest.meshFiles.map((f) => {
                      const picked = !!meshPicks[f.path];
                      return (
                        <label
                          key={f.path}
                          data-testid={`zip-import-mesh-row-${f.name}`}
                          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800/60 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => setMeshPicks({ ...meshPicks, [f.path]: !picked })}
                            className="hidden"
                          />
                          {picked
                            ? <CheckSquare size={13} className="text-orange-400" />
                            : <SquareIcon size={13} className="text-slate-500" />}
                          <span className="flex-1 text-[11px] text-slate-200 truncate font-mono">{f.name}</span>
                          <span className="text-[9px] uppercase font-mono text-slate-500">{f.ext}</span>
                          <span className="text-[9px] text-slate-500 tabular-nums w-12 text-right">
                            {f.size < 1024
                              ? `${f.size} B`
                              : f.size < 1024 * 1024
                              ? `${(f.size / 1024).toFixed(0)} KB`
                              : `${(f.size / 1024 / 1024).toFixed(1)} MB`}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    data-testid="zip-import-mesh-go-btn"
                    onClick={handleImportSelectedMeshes}
                    disabled={busyAction !== null}
                    className="w-full h-9 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white text-sm font-semibold rounded flex items-center justify-center gap-2"
                  >
                    {busyAction === "meshes"
                      ? <><Loader2 size={13} className="animate-spin" /> Importing…</>
                      : `Import ${Object.values(meshPicks).filter(Boolean).length} selected mesh${
                          Object.values(meshPicks).filter(Boolean).length === 1 ? "" : "es"
                        }`}
                  </button>
                </section>
              )}

              {/* Orca config bundle section */}
              {manifest.orcaConfigs.length > 0 && (
                <section className="space-y-2 border-t border-slate-800 pt-3" data-testid="zip-import-orca-section">
                  <div className="flex items-center gap-2">
                    <Package size={13} className="text-purple-400" />
                    <h3 className="text-[11px] uppercase tracking-wider text-slate-300 font-semibold">
                      OrcaSlicer config bundle
                    </h3>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
                    {manifest.orcaConfigs.map((c) => (
                      <div key={c.name} className="flex items-center gap-2 text-[11px]" data-testid={`zip-import-orca-${c.role}`}>
                        <span className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded ${
                          c.role === "printer" ? "bg-orange-500/20 text-orange-300"
                          : c.role === "process" ? "bg-blue-500/20 text-blue-300"
                          : "bg-green-500/20 text-green-300"
                        }`}>
                          {c.role}
                        </span>
                        <span className="font-mono text-slate-300 truncate">{c.name}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    data-testid="zip-import-orca-go-btn"
                    onClick={handleImportOrcaConfigs}
                    disabled={busyAction !== null
                      || !manifest.orcaConfigs.some((c) => c.role === "printer")}
                    className="w-full h-9 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded flex items-center justify-center gap-2"
                    title={manifest.orcaConfigs.some((c) => c.role === "printer")
                      ? "Import the printer.json as a new printer profile"
                      : "A printer.json is required to import as a printer profile"}
                  >
                    {busyAction === "orca"
                      ? <><Loader2 size={13} className="animate-spin" /> Importing…</>
                      : "Import printer profile from bundle"}
                  </button>
                </section>
              )}

              {/* Reported but ignored. Mostly README.md, thumbnails. */}
              {manifest.other.length > 0 && (
                <details className="text-[10px] text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-300">
                    {manifest.other.length} other file{manifest.other.length === 1 ? "" : "s"} in archive (ignored)
                  </summary>
                  <ul className="mt-1 pl-3 font-mono space-y-0.5 max-h-32 overflow-y-auto">
                    {manifest.other.slice(0, 25).map((f) => (
                      <li key={f.name} className="truncate">{f.name}</li>
                    ))}
                    {manifest.other.length > 25 && (
                      <li className="text-slate-600">…and {manifest.other.length - 25} more</li>
                    )}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

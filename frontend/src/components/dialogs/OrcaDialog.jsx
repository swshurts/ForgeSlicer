import React, { useState } from "react";
import { useScene } from "../../lib/store";
import { downloadBlob } from "../../lib/exporters";
import { export3MFBytesAsync } from "../../lib/workerClient";
import { X, Loader2, Printer, Download } from "lucide-react";

export function OrcaDialog({ open, onClose, targetSlicer }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  React.useEffect(() => {
    if (open) {
      const dismissed = (() => { try { return localStorage.getItem("forgeslicer.hideSlicerHelp") === "1"; } catch { return false; } })();
      setShowHelp(!dismissed && false); // default collapsed; user opens manually
      setDownloaded(false);
    }
  }, [open]);

  if (!open) return null;

  const slicer = targetSlicer || { name: "OrcaSlicer", url: "https://github.com/SoftFever/OrcaSlicer/releases" };

  // Try to launch the slicer via custom URL protocol after download.
  // Browsers can't tell us if the slicer is installed, so this fails
  // silently if the protocol isn't registered.
  const PROTOCOLS = {
    "OrcaSlicer": "orcaslicer://",
    "Orca-Flashforge": "orcaslicer://",
    "Bambu Studio": "bambustudioopen://",
    "PrusaSlicer": "prusaslicer://",
    "SuperSlicer": "superslicer://",
    "Flash Studio Desktop": "flashforge://",
  };
  const attemptProtocolLaunch = () => {
    const proto = PROTOCOLS[slicer.name];
    if (!proto) return;
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = proto;
      document.body.appendChild(iframe);
      setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 2000);
    } catch (_) { /* nope */ }
  };

  const handleDownload = async () => {
    setBusy(true);
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      const { bytes } = await export3MFBytesAsync(objects);
      downloadBlob(new Blob([bytes], { type: "model/3mf" }), `${safe}.3mf`);
      setDownloaded(true);
      // After the file lands, try to launch the slicer optimistically.
      attemptProtocolLaunch();
      // Auto-close so the user doesn't have to hunt for the X. Leaves ~1.5s
      // for the OS save-as / protocol prompt to take focus first.
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      alert(e.message);
    } finally { setBusy(false); }
  };

  const dontShowAgain = () => {
    try { localStorage.setItem("forgeslicer.hideSlicerHelp", "1"); } catch {}
    setShowHelp(false);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="orca-dialog">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Send to {slicer.name}</h2>
          </div>
          <button onClick={onClose} data-testid="orca-close-btn" className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <p className="text-sm text-slate-300">
            Downloads a print-ready <span className="font-mono text-orange-400">.3mf</span> for{" "}
            <span className="font-semibold text-orange-400">{slicer.name}</span>. Double-click the file
            and your slicer will open it.
          </p>
          <button
            data-testid="orca-download-btn"
            onClick={handleDownload}
            disabled={busy || objects.length === 0}
            className="h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-semibold rounded flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {downloaded ? "Download again" : `Download 3MF for ${slicer.name}`}
          </button>

          {!showHelp ? (
            <button
              data-testid="orca-show-help-btn"
              onClick={() => setShowHelp(true)}
              className="text-[11px] text-slate-400 hover:text-orange-400 underline self-start"
            >
              Don't have {slicer.name} yet? Show install instructions
            </button>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] text-slate-300 leading-relaxed" data-testid="orca-help-block">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">How to open in {slicer.name}</span>
                <button
                  onClick={dontShowAgain}
                  data-testid="orca-hide-help-btn"
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                >
                  Don't show again
                </button>
              </div>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Install <a href={slicer.url} target="_blank" rel="noreferrer" className="text-orange-400 underline">{slicer.name}</a> on your computer.
                </li>
                <li>Double-click the downloaded <span className="font-mono text-orange-400">.3mf</span> file — {slicer.name} will open it.</li>
                <li>Or inside {slicer.name}: <span className="font-mono">File → Import / Open → 3MF</span>.</li>
                <li>Slice with {slicer.name}'s full feature set (infill, supports, multi-material).</li>
              </ol>
            </div>
          )}
          <p className="text-[10px] text-slate-500">
            We assume {slicer.name} is already installed (browsers can't detect it directly).
            A <span className="font-mono">forgeslicer://</span> companion is on the roadmap for true one-click hand-off.
          </p>
        </div>
      </div>
    </div>
  );
}

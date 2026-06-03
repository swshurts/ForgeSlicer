import React, { useState, useEffect } from "react";
import { useScene } from "../../lib/store";
import { downloadBlob } from "../../lib/exporters";
import { export3MFBytesAsync } from "../../lib/workerClient";
import {
  getAllSlicers, getPreferredSlicer, setPreferredSlicerId,
  launchSlicer,
} from "../../lib/customSlicers";
import { X, Loader2, Printer, Download, Star, Settings, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";
import CustomSlicersDialog from "./CustomSlicersDialog";

// Iter-82: completely rewritten send-to-slicer dialog.
//   • Slicer registry merges BUILTIN_SLICERS + user-defined customs
//     (Bambu Studio forks, full-spectrum-colour OrcaSlicer, etc.).
//   • Reliable launching via window.location.href (formerly iframe).
//   • "Star" toggle marks the user's preferred slicer for one-click
//     hand-off from the toolbar. Persisted in localStorage because
//     URL-protocol handlers are OS-registered, i.e. per-device.
//   • Detects whether the launch likely succeeded by listening for
//     a window blur within 2 s (the OS protocol-handler dialog
//     stealing focus); shows a "Did it open?" follow-up otherwise.
export function OrcaDialog({ open, onClose, targetSlicer }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [launchState, setLaunchState] = useState(null);   // null | "trying" | "likely" | "uncertain"
  const [allSlicers, setAllSlicers] = useState(() => getAllSlicers());
  const [lastFilename, setLastFilename] = useState("");
  const [selectedId, setSelectedId] = useState(() => {
    if (targetSlicer?.id) return targetSlicer.id;
    const prefer = getPreferredSlicer();
    return prefer?.id || "orcaslicer";
  });
  const [manageOpen, setManageOpen] = useState(false);

  // When the dialog opens, refresh the slicer list (the user may have
  // added a custom one since the last open) and reset transient state.
  useEffect(() => {
    if (open) {
      setAllSlicers(getAllSlicers());
      setLaunchState(null);
      setDownloaded(false);
      // If a target was forced from the toolbar, honour it; otherwise
      // fall back to preferred / first.
      if (targetSlicer?.id) {
        setSelectedId(targetSlicer.id);
      } else {
        const prefer = getPreferredSlicer();
        if (prefer) setSelectedId(prefer.id);
      }
    }
  }, [open, targetSlicer]);

  if (!open) return null;

  const slicer = allSlicers.find((s) => s.id === selectedId) || allSlicers[0];

  const handleDownload = async () => {
    setBusy(true);
    setLaunchState(null);
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      setLastFilename(`${safe}.3mf`);
      const { bytes } = await export3MFBytesAsync(objects);
      downloadBlob(new Blob([bytes], { type: "model/3mf" }), `${safe}.3mf`);
      setDownloaded(true);
      setLaunchState("trying");
      // Give the browser ~500 ms to finish the download attachment
      // before stealing focus with the OS protocol dialog. Without
      // this delay some browsers cancel the download in favour of
      // the protocol launch.
      await new Promise((r) => setTimeout(r, 500));
      const result = await launchSlicer(slicer.protocol);
      setLaunchState(result.launched ? "likely" : "uncertain");
    } catch (e) {
      toast.error(e.message || "Download failed");
    } finally { setBusy(false); }
  };

  const handleTogglePreferred = () => {
    if (slicer.isPreferred) {
      setPreferredSlicerId(null);
      toast.info(`${slicer.name} is no longer your preferred slicer.`);
    } else {
      setPreferredSlicerId(slicer.id);
      toast.success(`${slicer.name} is now your preferred slicer — toolbar one-click hand-off targets it.`);
    }
    setAllSlicers(getAllSlicers());
  };

  return (
    <>
    <div
      className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="orca-dialog"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Send to Slicer</h2>
          </div>
          <button onClick={onClose} data-testid="orca-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          {/* Slicer chooser with star + manage controls. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Slicer</span>
              <button
                data-testid="orca-manage-slicers-btn"
                onClick={() => setManageOpen(true)}
                className="text-[10px] text-purple-300 hover:text-purple-200 flex items-center gap-1"
              >
                <Settings size={10} /> Manage my slicers
              </button>
            </div>
            <div className="flex gap-1.5">
              <select
                data-testid="orca-slicer-select"
                value={slicer?.id || ""}
                onChange={(e) => { setSelectedId(e.target.value); setLaunchState(null); setDownloaded(false); }}
                className="flex-1 h-9 bg-slate-800 border border-slate-700 rounded px-2 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
              >
                <optgroup label="Built-in">
                  {allSlicers.filter((s) => !s.isUserCustom).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.isPreferred ? "★ " : ""}{s.name}
                    </option>
                  ))}
                </optgroup>
                {allSlicers.some((s) => s.isUserCustom) && (
                  <optgroup label="My custom slicers">
                    {allSlicers.filter((s) => s.isUserCustom).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.isPreferred ? "★ " : ""}{s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                data-testid="orca-toggle-preferred-btn"
                onClick={handleTogglePreferred}
                title={slicer?.isPreferred ? "Remove as preferred" : "Mark as preferred (one-click hand-off target)"}
                className={`h-9 w-9 rounded border flex items-center justify-center transition-colors ${
                  slicer?.isPreferred
                    ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:text-amber-300"
                }`}
              >
                <Star size={14} fill={slicer?.isPreferred ? "currentColor" : "none"} />
              </button>
            </div>
          </div>

          <p className="text-sm text-slate-300">
            Downloads a print-ready <span className="font-mono text-orange-400">.3mf</span> for{" "}
            <span className="font-semibold text-orange-400">{slicer?.name}</span> and tries to launch it
            via its <span className="font-mono">{slicer?.protocol}</span> handler.
          </p>
          <button
            data-testid="orca-download-btn"
            onClick={handleDownload}
            disabled={busy || objects.length === 0 || !slicer}
            className="h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-semibold rounded flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {downloaded ? "Download & launch again" : `Download 3MF and launch ${slicer?.name || "slicer"}`}
          </button>

          {/* Post-launch feedback strip. */}
          {launchState === "likely" && (
            <div className="bg-emerald-500/10 border border-emerald-500/40 rounded p-2 text-[11px] text-emerald-200 flex items-start gap-2" data-testid="orca-launch-likely">
              <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" />
              <span>Looks like {slicer?.name} took focus — check your taskbar / dock for it.</span>
            </div>
          )}
          {launchState === "uncertain" && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded p-2 text-[11px] text-amber-200 space-y-1.5" data-testid="orca-launch-uncertain">
              <div className="flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                <span>
                  Couldn't confirm {slicer?.name} opened. Either it's not installed,
                  the protocol handler isn't registered, or your browser blocked the launch.
                  The <span className="font-mono">.3mf</span> downloaded successfully — open it manually.
                </span>
              </div>
              {/* Iter-82+: filename clipboard helper. We can't read
                  the OS download path (browser sandbox), but the
                  user always knows where their default Downloads
                  folder is, and copying the exact filename eliminates
                  the "is it called sketch (3).3mf or sketch (4).3mf?"
                  hunt. Includes a platform-aware locate command in
                  the tooltip. */}
              {lastFilename && (
                <div className="flex items-center gap-1.5 pl-5">
                  <code
                    data-testid="orca-launch-filename"
                    className="flex-1 text-[10px] font-mono bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-amber-100 truncate"
                  >
                    {lastFilename}
                  </code>
                  <button
                    data-testid="orca-launch-copy-filename-btn"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(lastFilename)
                        .then(() => toast.success(`Copied "${lastFilename}" to clipboard.`))
                        .catch(() => toast.error("Copy failed — your browser blocked clipboard access."));
                    }}
                    className="h-6 px-2 text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 rounded border border-amber-500/40 flex items-center gap-1"
                    title={`Copy "${lastFilename}" — paste it into your file manager's search to locate the download`}
                  >
                    <Copy size={10} /> Copy filename
                  </button>
                </div>
              )}
              {slicer?.installUrl && (
                <a
                  href={slicer.installUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[10px] text-amber-300 hover:text-amber-100 underline pl-5"
                  data-testid="orca-launch-install-link"
                >
                  Install {slicer.name} →
                </a>
              )}
            </div>
          )}

          <p className="text-[10px] text-slate-500">
            URL-protocol launches are per-device — make sure {slicer?.name} is installed on this computer.
            For one-click hand-off from anywhere, star a slicer above and use the toolbar's quick-send button.
          </p>
        </div>
      </div>
    </div>
    {manageOpen && (
      <CustomSlicersDialog
        open={manageOpen}
        onClose={() => { setManageOpen(false); setAllSlicers(getAllSlicers()); }}
      />
    )}
    </>
  );
}

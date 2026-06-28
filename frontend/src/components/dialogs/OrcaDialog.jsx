import React, { useState, useEffect } from "react";
import { useScene } from "../../lib/store";
import { usePrintability } from "../../lib/printabilityStore";
import { downloadBlob } from "../../lib/exporters";
import { export3MFBytesAsync } from "../../lib/workerClient";
import {
  getAllSlicers, getPreferredSlicer, setPreferredSlicerId,
  launchSlicer, stageHandoff,
} from "../../lib/customSlicers";
import { X, Loader2, Printer, Download, Star, Settings, CheckCircle2, AlertCircle, Copy, ShieldAlert } from "lucide-react";
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
  // Iter-94 — preserved-color round-trip. When the user imported a 3MF
  // (typically from LithoForge's "Send to ForgeSlicer"), these are the
  // ORIGINAL bytes with all the per-object / per-material color info
  // intact. The in-memory mesh derived from them loses color during
  // triangulation, so re-baking via export3MFBytesAsync(objects)
  // produces a colorless 3MF. Forwarding pristine bytes is the only
  // way to preserve multi-material info through to OrcaSlicer.
  const pristine3MFBytes = useScene((s) => s.pristine3MFBytes);
  const pristine3MFFilename = useScene((s) => s.pristine3MFFilename);
  const [preserveColors, setPreserveColors] = useState(true);
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

  // Iter-108 — pre-flight printability gate. When the dialog opens we
  // re-run the checks against the current scene + buildVolume so the
  // "Will fail" banner reflects what the user is ACTUALLY about to
  // ship to the slicer (not whatever was cached from the last
  // PrintabilityPanel render). `proceedAnyway` is one-shot — re-opening
  // the dialog re-arms the gate.
  const buildVolume = useScene((s) => s.buildVolume);
  const recheckPrintability = usePrintability((s) => s.recheck);
  const setPrintabilityPanelOpen = usePrintability((s) => s.setPanelOpen);
  const printabilityFindings = usePrintability((s) => s.findings);
  const willFailFindings = printabilityFindings.filter((f) => f.severity === "will-fail");
  const [proceedAnyway, setProceedAnyway] = useState(false);

  useEffect(() => {
    if (!open) return;
    recheckPrintability({ objects, buildVolume });
    setProceedAnyway(false);
  }, [open, objects, buildVolume, recheckPrintability]);

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
      let bytes;
      let outFilename;
      // Iter-94 — pristine-bytes pass-through. When the user imported
      // a colored 3MF and hasn't ticked the "lose colors" override, we
      // hand the ORIGINAL bytes to the slicer. This preserves every
      // bit of multi-material / filament-slot data the source file
      // carried (LithoForge's per-tone color assignments, Bambu's
      // AMS slot tags, etc.). Re-baking via export3MFBytesAsync
      // would flatten the colored mesh back to a single uncolored
      // body — that's why STL/colorless-3MF was the old default.
      if (pristine3MFBytes && preserveColors) {
        bytes = pristine3MFBytes;
        // Preserve original filename when sensible (keeps the user's
        // mental model of "this is the LithoForge file"); fall back
        // to the safe-project-name path otherwise.
        outFilename = pristine3MFFilename || `${safe}.3mf`;
      } else {
        const r = await export3MFBytesAsync(objects);
        bytes = r.bytes;
        outFilename = `${safe}.3mf`;
      }
      setLastFilename(outFilename);
      // Always download a local copy so the user has a backup if the
      // protocol launch fails (Cura-derivatives, missing OS handler,
      // browser blocks the protocol etc.).
      downloadBlob(new Blob([bytes], { type: "model/3mf" }), outFilename);
      setDownloaded(true);

      // Iter-105.24 — short-circuit for slicers WITHOUT an OS URL-
      // protocol handler (Cura, Flash Studio, anything user-flagged
      // `noProtocolLauncher: true`). For those there's nothing the
      // browser can do beyond the local download we just triggered.
      // Be honest about it via the launch state + a toast so the
      // user isn't left wondering why nothing opened.
      if (slicer.noProtocolLauncher) {
        setLaunchState("manual_only");
        toast.info(
          `${slicer.name} doesn't support browser auto-open — your file is in your Downloads folder. Open ${slicer.name} and drag the file in, or use File → Open. Tip: set ${slicer.name} as the default app for .3mf files to make this a one-click double-click.`,
          { duration: 12000 },
        );
        setBusy(false);
        return;
      }

      setLaunchState("trying");
      // Iter-105.23 — slicer handoff with file argument.
      // Stage the bytes on the backend so the desktop slicer can
      // fetch them via `<protocol>open/?file=<URL>` and auto-open
      // without the manual "Open Project" step. We fire this in
      // parallel with the local download so the user gets both
      // paths (auto-open in slicer + local copy in Downloads).
      // If staging fails (network blip, backend unavailable), we
      // fall back to the bare protocol launch — same as before,
      // user can still drag the local copy in.
      let fileUrl = null;
      try {
        const handoff = await stageHandoff(bytes, outFilename);
        fileUrl = handoff.url;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Handoff staging failed; falling back to bare protocol launch:", e);
        toast.warning(
          "Could not stage the file for auto-open — the slicer will launch with an empty workspace. Drag the downloaded file in from your Downloads folder.",
          { duration: 6000 },
        );
      }
      // Give the browser ~500 ms to finish the download attachment
      // before stealing focus with the OS protocol dialog. Without
      // this delay some browsers cancel the download in favour of
      // the protocol launch.
      await new Promise((r) => setTimeout(r, 500));
      const result = await launchSlicer(slicer.protocol, { fileUrl });
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
            {slicer?.noProtocolLauncher ? (
              <>
                Downloads a print-ready <span className="font-mono text-orange-400">.3mf</span> for{" "}
                <span className="font-semibold text-orange-400">{slicer?.name}</span>.{" "}
                <span className="text-amber-300">
                  {slicer?.name} doesn&apos;t support browser auto-launch — you&apos;ll open the file manually
                  (drag into the window or <span className="font-mono">File → Open</span>).
                </span>
              </>
            ) : (
              <>
                Downloads a print-ready <span className="font-mono text-orange-400">.3mf</span> for{" "}
                <span className="font-semibold text-orange-400">{slicer?.name}</span> and tries to launch it
                via its <span className="font-mono">{slicer?.protocol}</span> handler.
              </>
            )}
          </p>

          {/* Iter-94 — preserve-color toggle. Only surfaces when a
              pristine 3MF (typically from a LithoForge handoff or a
              user-imported multi-material 3MF) is in the store. When
              ticked, OrcaSlicer receives the original bytes with all
              per-object color/material assignments intact; when off,
              we re-bake from the in-memory mesh (drops colors but
              picks up any edits the user made in the workspace). */}
          {pristine3MFBytes && (
            <label
              data-testid="orca-preserve-colors-row"
              className="flex items-start gap-2.5 px-3 py-2 bg-cyan-500/5 border border-cyan-500/30 rounded text-[11px] cursor-pointer"
            >
              <input
                data-testid="orca-preserve-colors-checkbox"
                type="checkbox"
                checked={preserveColors}
                onChange={(e) => setPreserveColors(e.target.checked)}
                className="mt-0.5 accent-cyan-400"
              />
              <span className="flex-1 leading-relaxed text-cyan-100">
                <span className="font-semibold">Preserve colors from import</span>
                <span className="block text-[10px] text-cyan-300/80 mt-0.5">
                  Sends the original{" "}
                  <span className="font-mono">{pristine3MFFilename || "imported"}</span>{" "}
                  file unchanged — keeps per-object color / multi-material info.
                  Untick to re-bake from current scene (colors will be stripped, but edits in ForgeSlicer apply).
                </span>
              </span>
            </label>
          )}

          <button
            data-testid="orca-download-btn"
            onClick={handleDownload}
            disabled={busy || objects.length === 0 || !slicer || (willFailFindings.length > 0 && !proceedAnyway)}
            className="h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-semibold rounded flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {downloaded ? "Download & launch again" : `Download 3MF and launch ${slicer?.name || "slicer"}`}
          </button>

          {/* Iter-108 — pre-flight printability gate. Blocks the send
              when one or more checks flagged "Will fail" findings, so
              users don't ship a doomed file to the slicer. The user
              can still override with "Send anyway" once they've read
              the warning. Clicking "Review issues" opens the
              right-rail panel so they can see exactly which parts
              are unprintable. */}
          {willFailFindings.length > 0 && !proceedAnyway && (
            <div
              data-testid="orca-printability-block"
              className="bg-red-500/10 border border-red-500/40 rounded p-3 text-[12px] text-red-100 space-y-2"
            >
              <div className="flex items-start gap-2">
                <ShieldAlert size={14} className="mt-0.5 flex-shrink-0 text-red-300" />
                <div className="flex-1">
                  <p className="font-semibold text-red-200">
                    {willFailFindings.length} blocking issue{willFailFindings.length === 1 ? "" : "s"} — this print is likely to fail.
                  </p>
                  <p className="mt-1 text-[11px] text-red-100/90 leading-snug">
                    {willFailFindings[0].title}
                    {willFailFindings.length > 1 && (
                      <span className="text-red-300/80"> · plus {willFailFindings.length - 1} more</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  data-testid="orca-printability-review-btn"
                  onClick={() => { setPrintabilityPanelOpen(true); onClose(); }}
                  className="flex-1 h-8 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-100 text-[11px] font-semibold rounded"
                >
                  Review issues
                </button>
                <button
                  data-testid="orca-printability-override-btn"
                  onClick={() => setProceedAnyway(true)}
                  className="h-8 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] rounded"
                  title="I know what I'm doing — send to the slicer anyway"
                >
                  Send anyway
                </button>
              </div>
            </div>
          )}

          {/* Post-launch feedback strip. */}
          {launchState === "likely" && (
            <div className="bg-emerald-500/10 border border-emerald-500/40 rounded p-2 text-[11px] text-emerald-200 flex items-start gap-2" data-testid="orca-launch-likely">
              <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" />
              <span>Looks like {slicer?.name} took focus — check your taskbar / dock for it.</span>
            </div>
          )}
          {launchState === "manual_only" && (
            <div className="bg-sky-500/10 border border-sky-500/40 rounded p-2 text-[11px] text-sky-200 space-y-1.5" data-testid="orca-launch-manual-only">
              <div className="flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                <span>
                  <span className="font-semibold">{slicer?.name}</span> doesn&apos;t register a browser URL handler,
                  so we can&apos;t auto-launch it. Your <span className="font-mono">.3mf</span> downloaded
                  successfully — open {slicer?.name} and drag the file into its window, or use
                  <span className="font-mono"> File → Open</span>.
                </span>
              </div>
              {lastFilename && (
                <div className="flex items-center gap-1.5 pl-5">
                  <code
                    data-testid="orca-launch-filename-manual"
                    className="flex-1 text-[10px] font-mono bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-sky-100 truncate"
                  >
                    {lastFilename}
                  </code>
                  <button
                    data-testid="orca-launch-copy-filename-manual-btn"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(lastFilename)
                        .then(() => toast.success(`Copied "${lastFilename}" to clipboard.`))
                        .catch(() => toast.error("Copy failed — your browser blocked clipboard access."));
                    }}
                    className="h-6 px-2 text-[10px] bg-sky-500/20 hover:bg-sky-500/30 text-sky-100 rounded border border-sky-500/40 flex items-center gap-1"
                    title={`Copy "${lastFilename}" — paste it into your file manager's search to locate the download`}
                  >
                    <Copy size={10} /> Copy filename
                  </button>
                </div>
              )}
              <p className="pl-5 text-[10px] text-sky-300/80">
                Tip: set {slicer?.name} as the default app for <span className="font-mono">.3mf</span> files
                in your OS settings — then double-clicking the download opens it directly.
              </p>
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

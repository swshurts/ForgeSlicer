import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API } from "../lib/api";
import { useScene } from "../lib/store";
import { importAnyMeshFile } from "../lib/exporters";
import { X, Sparkles, Loader2, Image as ImageIcon, Type, AlertCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";

// Poll interval for /ai/jobs/{id}. Meshy's docs warn against aggressive
// polling; 4 s strikes a balance between responsiveness and rate-limit safety.
const POLL_MS = 4000;
// Stop polling after this many minutes — generations should normally take
// 30-90 seconds; if we're still waiting after 5 min something's wrong.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Sizing controls — shown both BEFORE generation (so users know what scale
// they'll get) and AFTER (so they can adjust before importing). The
// "successStyle" variant just changes the border color to match the green
// success card it lives inside.
function SizingControls({ autoFit, setAutoFit, targetMaxMm, setTargetMaxMm, buildVolume, successStyle }) {
  const bedMin = Math.min(buildVolume?.x || 220, buildVolume?.y || 220, buildVolume?.z || 250);
  const autoFitTarget = (bedMin * 0.8).toFixed(0);
  const border = successStyle ? "border-emerald-500/30" : "border-fuchsia-500/30";
  return (
    <div className={`bg-slate-950/60 border ${border} rounded p-2.5 space-y-2`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Import size</span>
        <span className="text-[10px] text-slate-500 font-mono">
          {autoFit
            ? `auto: ~${autoFitTarget} mm max`
            : `manual: ${targetMaxMm} mm max`}
        </span>
      </div>
      <div className="flex gap-1">
        <button
          data-testid="ai-size-mode-auto"
          onClick={() => setAutoFit(true)}
          className={`flex-1 h-7 rounded text-[10px] font-semibold border ${autoFit ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" : "bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600"}`}
        >Auto-fit to bed</button>
        <button
          data-testid="ai-size-mode-manual"
          onClick={() => setAutoFit(false)}
          className={`flex-1 h-7 rounded text-[10px] font-semibold border ${!autoFit ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" : "bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600"}`}
        >Specify size</button>
      </div>
      {autoFit ? (
        <p className="text-[10px] text-slate-500 leading-snug">
          Longest dimension will be scaled to <strong className="text-slate-300">~{autoFitTarget} mm</strong> (80% of your printer's shortest axis: {bedMin} mm).
        </p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px]">
            <label className="text-slate-400">Max dimension</label>
            <input
              data-testid="ai-target-size-input"
              type="number"
              min={1}
              max={1000}
              value={targetMaxMm}
              onChange={(e) => setTargetMaxMm(parseFloat(e.target.value) || 0)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono focus:border-emerald-500 outline-none"
            />
            <span className="text-slate-500">mm</span>
          </div>
          <p className="text-[10px] text-slate-500">The mesh's longest axis will be set to this size; other axes scale proportionally.</p>
        </div>
      )}
    </div>
  );
}

// LocalStorage key for "I have an in-flight Meshy job" recovery. Stores
// the active job_id + kind so users can resume polling even if the dialog
// closes unexpectedly (browser tab navigated away, accidental Close click
// dismissed by the safety prompt, etc.).
const INFLIGHT_KEY = "forge.ai.inflight";

export default function AIGenerateDialog({ open, onClose }) {
  const [tab, setTab] = useState("text");      // "text" | "image"
  const [prompt, setPrompt] = useState("");
  const [artStyle, setArtStyle] = useState("realistic");
  const [imageB64, setImageB64] = useState(null);
  const [imageMime, setImageMime] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [usage, setUsage] = useState(null);
  const [job, setJob] = useState(null);        // { job_id, status, progress, model_url, error }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Import sizing. Default: auto-fit to ~80% of the printer's shortest
  // build-volume axis so AI meshes don't land at silly sizes like the
  // 1996mm test-fixture we saw during development.
  const [autoFit, setAutoFit] = useState(true);
  const [targetMaxMm, setTargetMaxMm] = useState(60);
  const pollTimer = useRef(null);
  const pollDeadline = useRef(0);
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const buildVolume = useScene((s) => s.buildVolume);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
      setJob(null); setBusy(false); setError("");
      setPrompt(""); setImageB64(null); setImageMime(null);
      setImagePreviewUrl(null);
    } else {
      // Load usage when opening
      axios.get(`${API}/ai/usage`, { withCredentials: true })
        .then((r) => setUsage(r.data))
        .catch(() => setUsage(null));
      // Recover an in-flight job if the dialog was closed mid-generation.
      try {
        const raw = window.localStorage.getItem(INFLIGHT_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved?.job_id) {
            setJob({ job_id: saved.job_id, status: "PENDING", progress: 0, kind: saved.kind });
            pollDeadline.current = (saved.deadline || (Date.now() + POLL_TIMEOUT_MS));
            pollOnce(saved.job_id);
          }
        }
      } catch (err) {
        // Recovery is best-effort; never block the user.
        // eslint-disable-next-line no-console
        console.warn("AI job recovery failed:", err);
      }
    }
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Persist in-flight job state so it survives an accidental close. We
  // clear the marker as soon as the job hits a terminal SUCCEEDED/FAILED.
  useEffect(() => {
    if (!job) {
      try { window.localStorage.removeItem(INFLIGHT_KEY); } catch (err) { /* noop */ void err; }
      return;
    }
    if (job.status === "SUCCEEDED" || job.status === "FAILED") {
      try { window.localStorage.removeItem(INFLIGHT_KEY); } catch (err) { /* noop */ void err; }
      return;
    }
    try {
      window.localStorage.setItem(INFLIGHT_KEY, JSON.stringify({
        job_id: job.job_id,
        kind: job.kind,
        deadline: pollDeadline.current,
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("AI job persist failed:", err);
    }
  }, [job]);

  const refreshUsage = () => {
    axios.get(`${API}/ai/usage`, { withCredentials: true })
      .then((r) => setUsage(r.data))
      .catch(() => { /* non-fatal */ });
  };

  const pollOnce = async (jobId) => {
    try {
      const { data } = await axios.get(`${API}/ai/jobs/${jobId}`, { withCredentials: true });
      setJob(data);
      if (data.status === "SUCCEEDED" || data.status === "FAILED") return;
      if (Date.now() > pollDeadline.current) {
        setError("Generation timed out. Try again or simplify your prompt/image.");
        return;
      }
      pollTimer.current = setTimeout(() => pollOnce(jobId), POLL_MS);
    } catch (e) {
      // Transient upstream/network hiccups (5xx, no-response) are common
      // during long Meshy generations. Keep polling rather than dumping
      // the user's already-paid job, until the deadline expires.
      const status = e?.response?.status;
      const isTransient = !status || status >= 500;
      if (isTransient && Date.now() < pollDeadline.current) {
        // eslint-disable-next-line no-console
        console.warn("AI poll transient error — retrying:", e?.message || e);
        pollTimer.current = setTimeout(() => pollOnce(jobId), POLL_MS);
        return;
      }
      setError(e?.response?.data?.detail || e.message || "Polling failed");
    }
  };

  const handleSubmitText = async () => {
    if (!prompt.trim() || prompt.trim().length < 3) {
      setError("Prompt must be at least 3 characters."); return;
    }
    setBusy(true); setError(""); setJob(null);
    try {
      const { data } = await axios.post(`${API}/ai/generate/text`,
        { prompt: prompt.trim(), art_style: artStyle },
        { withCredentials: true });
      setJob({ job_id: data.job_id, status: "PENDING", progress: 0 });
      pollDeadline.current = Date.now() + POLL_TIMEOUT_MS;
      pollOnce(data.job_id);
      refreshUsage();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitImage = async () => {
    if (!imageB64) { setError("Pick an image first."); return; }
    setBusy(true); setError(""); setJob(null);
    try {
      const { data } = await axios.post(`${API}/ai/generate/image`,
        { image_b64: imageB64, mime_type: imageMime },
        { withCredentials: true });
      setJob({ job_id: data.job_id, status: "PENDING", progress: 0 });
      pollDeadline.current = Date.now() + POLL_TIMEOUT_MS;
      pollOnce(data.job_id);
      refreshUsage();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const handleImagePick = (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("Image too large (max 8 MB)."); return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      // dataUrl = "data:image/png;base64,..." — split off the base64 portion.
      const commaIdx = dataUrl.indexOf(",");
      setImageB64(dataUrl.slice(commaIdx + 1));
      setImageMime(file.type || "image/png");
      setImagePreviewUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleImport = async () => {
    if (!job?.job_id || job.status !== "SUCCEEDED") return;
    setBusy(true); setError("");
    try {
      // Pull the mesh bytes via our backend (handles auth + Meshy CDN proxying)
      const resp = await axios.get(`${API}/ai/jobs/${job.job_id}/mesh`, {
        withCredentials: true,
        responseType: "blob",
      });
      // Wrap the Blob in a File so it flows through the existing import pipeline.
      // The Meshy CDN URL looks like ".../model.stl?Expires=..." so we strip
      // the query string before checking the extension.
      const urlPath = (job.model_url || "").split("?")[0].toLowerCase();
      let ext = "glb";
      if (urlPath.endsWith(".stl")) ext = "stl";
      else if (urlPath.endsWith(".obj")) ext = "obj";
      const filename = `ai-${(job.kind || "gen")}-${job.job_id.slice(0, 8)}.${ext}`;
      const file = new File([resp.data], filename, { type: resp.data.type || "application/octet-stream" });
      const mesh = await importAnyMeshFile(file);
      // Determine target max-dimension. Auto-fit uses 80% of the shortest
      // build-volume axis so the part always fits the print bed; manual
      // override uses whatever the user typed.
      const bbox = mesh.originalBbox || { x: 0, y: 0, z: 0 };
      const currentMax = Math.max(bbox.x, bbox.y, bbox.z) || 1;
      let scale = 1;
      if (autoFit) {
        const bedMin = Math.min(buildVolume?.x || 220, buildVolume?.y || 220, buildVolume?.z || 250);
        scale = (bedMin * 0.8) / currentMax;
      } else if (targetMaxMm > 0) {
        scale = targetMaxMm / currentMax;
      }
      if (scale > 0 && Math.abs(scale - 1) > 0.001) {
        // Scale vertices in-place. The bbox returned by importAnyMeshFile
        // is in mesh-local space (post-translation to bed); scaling the
        // vertex buffer keeps that property.
        const v = new Float32Array(mesh.vertices.length);
        for (let i = 0; i < mesh.vertices.length; i++) v[i] = mesh.vertices[i] * scale;
        mesh.vertices = v;
        mesh.originalBbox = {
          x: bbox.x * scale,
          y: bbox.y * scale,
          z: bbox.z * scale,
        };
      }
      addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
      const finalMax = Math.max(mesh.originalBbox.x, mesh.originalBbox.y, mesh.originalBbox.z);
      toast.success(`Imported: ${mesh.name}`, {
        description: `Max dimension: ${finalMax.toFixed(1)} mm. Drop, scale, or carve as normal.`,
      });
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail || e.message;
      setError(`Import failed: ${detail}`);
    } finally {
      setBusy(false);
    }
  };

  // Block Esc from closing during an in-flight job.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const inFlight = job && job.status !== "SUCCEEDED" && job.status !== "FAILED";
      if (inFlight) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Stop the global '?' handler in Workspace from also catching this.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, job, onClose]);

  if (!open) return null;
  const done = job?.status === "SUCCEEDED";
  const failed = job?.status === "FAILED";
  const inProgress = job && !done && !failed;

  // While a generation is in flight, refuse to close the dialog — the user
  // already paid a credit for this job and losing the window means losing
  // the result. The Close button is hidden during this state so the only
  // way out is to wait, or to use the small "Run in background" link below.
  const safeClose = () => {
    if (inProgress) return;
    onClose();
  };

  // Block backdrop click + Esc from closing during an in-flight job.
  const backdropClick = (e) => {
    // Only close if the click landed on the backdrop itself (not bubbled from
    // the inner content) AND there's no in-flight job.
    if (e.target !== e.currentTarget) return;
    safeClose();
  };

  return (
    <div
      data-testid="ai-generate-dialog"
      className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={backdropClick}
    >
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 border-b border-slate-800 flex items-center px-4 gap-2 bg-gradient-to-r from-fuchsia-500/15 via-purple-500/10 to-orange-500/10">
          <Sparkles size={16} className="text-fuchsia-400" />
          <div className="flex-1 text-sm font-semibold text-white">AI Generate · 3D Mesh</div>
          {usage && (
            <span className="text-[10px] font-mono text-fuchsia-300 border border-fuchsia-500/40 rounded px-2 py-0.5">
              {usage.remaining}/{usage.cap} left this month
            </span>
          )}
          {!inProgress && (
            <button data-testid="ai-close-btn" onClick={safeClose} className="ml-1 h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="p-5 space-y-3">
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-950 border border-slate-800 rounded p-1">
            <button
              data-testid="ai-tab-text"
              onClick={() => setTab("text")}
              className={`flex-1 h-8 rounded text-xs font-semibold flex items-center justify-center gap-1.5 ${tab === "text" ? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/50" : "text-slate-400 hover:text-white"}`}
            >
              <Type size={13} /> From Text
            </button>
            <button
              data-testid="ai-tab-image"
              onClick={() => setTab("image")}
              className={`flex-1 h-8 rounded text-xs font-semibold flex items-center justify-center gap-1.5 ${tab === "image" ? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/50" : "text-slate-400 hover:text-white"}`}
            >
              <ImageIcon size={13} /> From Image
            </button>
          </div>

          {/* Form body */}
          {!job && (
            <SizingControls
              autoFit={autoFit}
              setAutoFit={setAutoFit}
              targetMaxMm={targetMaxMm}
              setTargetMaxMm={setTargetMaxMm}
              buildVolume={buildVolume}
            />
          )}

          {!job && tab === "text" && (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Prompt</label>
                <textarea
                  data-testid="ai-prompt-input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. A small articulated dragon figurine for FDM 3D printing"
                  rows={4}
                  maxLength={600}
                  className="w-full bg-slate-950 border border-slate-700 rounded text-sm text-white p-2 focus:border-fuchsia-500 outline-none resize-none"
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                  <span>Describe what you want — shape, scale, style</span>
                  <span>{prompt.length}/600</span>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Style</label>
                <div className="grid grid-cols-2 gap-1">
                  {["realistic", "sculpture"].map((s) => (
                    <button
                      key={s}
                      data-testid={`ai-style-${s}`}
                      onClick={() => setArtStyle(s)}
                      className={`h-7 rounded text-[10px] font-semibold capitalize border ${artStyle === s ? "bg-fuchsia-500/20 border-fuchsia-500 text-fuchsia-300" : "bg-slate-900 border-slate-700 text-slate-400"}`}
                    >{s}</button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1 leading-snug">Low-poly look? Most slicers can decimate the mesh on import — pick that there.</p>
              </div>
            </div>
          )}

          {!job && tab === "image" && (
            <div className="space-y-3">
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Reference Image</label>
              <input
                data-testid="ai-image-input"
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={(e) => handleImagePick(e.target.files?.[0])}
                className="block w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-fuchsia-500/20 file:text-fuchsia-300 file:font-semibold hover:file:bg-fuchsia-500/30"
              />
              {imagePreviewUrl && (
                <div className="rounded border border-slate-800 overflow-hidden bg-slate-950">
                  <img src={imagePreviewUrl} alt="preview" className="w-full max-h-56 object-contain" />
                </div>
              )}
              <p className="text-[10px] text-slate-500 leading-snug">
                JPG, PNG, or WebP up to 8 MB. Best results come from a single subject on a plain background.
              </p>
            </div>
          )}

          {/* Job state */}
          {job && inProgress && (
            <div data-testid="ai-job-progress" className="bg-slate-950 border border-fuchsia-500/30 rounded p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-fuchsia-300">
                <Loader2 size={16} className="animate-spin" /> Generating… ({job.progress || 0}%)
              </div>
              <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
                <div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${job.progress || 5}%` }} />
              </div>
              <p className="text-[11px] text-amber-300/90 leading-snug">
                <strong>Please keep this window open</strong> until the mesh arrives. Closing it (or clicking outside) before completion still uses your credit but you'll lose the result.
              </p>
              <p className="text-[10px] text-slate-500 leading-snug">
                Typical generation time: 30–90 s. Your job has been saved — if the window does close, just reopen AI Generate and it will resume automatically.
              </p>
            </div>
          )}

          {job && done && (
            <div data-testid="ai-job-done" className="bg-emerald-500/5 border border-emerald-500/40 rounded p-3 space-y-3">
              <div className="text-sm text-emerald-300 font-semibold flex items-center gap-2">
                <Sparkles size={14} /> Mesh ready!
              </div>
              {job.model_url && (
                <a
                  href={job.model_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-emerald-400 hover:underline break-all block"
                >
                  Download raw from Meshy ↗
                </a>
              )}
              <SizingControls
                autoFit={autoFit}
                setAutoFit={setAutoFit}
                targetMaxMm={targetMaxMm}
                setTargetMaxMm={setTargetMaxMm}
                buildVolume={buildVolume}
                successStyle
              />
              <p className="text-[10px] text-slate-400">Click "Add to scene" to drop it onto the build plate. You can then carve, fillet, scale, slice — all the usual tools.</p>
            </div>
          )}

          {job && failed && (
            <div className="bg-red-500/5 border border-red-500/40 rounded p-3 text-xs text-red-300">
              <div className="font-semibold flex items-center gap-2 mb-1"><AlertCircle size={14} /> Generation failed</div>
              <div className="text-[11px] opacity-80">{job.error || "Unknown error from upstream."}</div>
            </div>
          )}

          {error && (
            <div data-testid="ai-error" className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 rounded p-2 flex items-start gap-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-800 p-3 flex items-center justify-between gap-2 bg-slate-950/40">
          {inProgress ? (
            <div className="text-[10px] text-amber-300 font-semibold flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Working — please wait
            </div>
          ) : (
            <button
              data-testid="ai-cancel-btn"
              onClick={safeClose}
              className="h-9 px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 rounded border border-slate-700"
            >
              Close
            </button>
          )}
          <div className="flex gap-2">
            {job && (failed || done) && (
              <button
                data-testid="ai-restart-btn"
                onClick={() => { setJob(null); setError(""); }}
                className="h-9 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded border border-slate-700 flex items-center gap-1.5"
              >
                <RotateCw size={12} /> Try another
              </button>
            )}
            {!job && tab === "text" && (
              <button
                data-testid="ai-submit-text-btn"
                onClick={handleSubmitText}
                disabled={busy || !prompt.trim() || (usage && usage.remaining <= 0)}
                className="h-9 px-4 text-xs font-bold bg-fuchsia-500 hover:bg-fuchsia-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Generate
              </button>
            )}
            {!job && tab === "image" && (
              <button
                data-testid="ai-submit-image-btn"
                onClick={handleSubmitImage}
                disabled={busy || !imageB64 || (usage && usage.remaining <= 0)}
                className="h-9 px-4 text-xs font-bold bg-fuchsia-500 hover:bg-fuchsia-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Generate
              </button>
            )}
            {done && (
              <button
                data-testid="ai-import-btn"
                onClick={handleImport}
                disabled={busy}
                className="h-9 px-4 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                Add to scene →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API } from "../lib/api";
import { useScene } from "../lib/store";
import { importAnyMeshFile } from "../lib/exporters";
import { X, Sparkles, Loader2, Image as ImageIcon, Type, AlertCircle, RotateCw, Images, Plus } from "lucide-react";
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

export default function AIGenerateDialog({ open: openProp, onClose }) {
  const [internalOpen, setInternalOpen] = useState(false);
  // Hybrid open state: parent can control via the `open` prop OR voice
  // can fire `forgeslicer:open-ai-generate` from anywhere in the app and
  // we'll open ourselves. Either trigger shows the dialog; close is
  // unified through `closeDialog` below.
  const open = openProp || internalOpen;
  const closeDialog = () => {
    setInternalOpen(false);
    if (onClose) onClose();
  };
  // Pending auto-submit signal — set when voice command says auto=true.
  // We can't call handleSubmitText immediately on open because the
  // setPrompt hasn't flushed yet; instead the submit effect below picks
  // it up after the prompt is populated.
  const [pendingAutoSubmit, setPendingAutoSubmit] = useState(false);

  const [tab, setTab] = useState("text");      // "text" | "image" | "multi"
  const [prompt, setPrompt] = useState("");
  const [artStyle, setArtStyle] = useState("realistic");
  const [imageB64, setImageB64] = useState(null);
  const [imageMime, setImageMime] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  // iter-105.14 — multi-image (3-photos → STL) state. Each slot is
  // either null or { b64, mime, previewUrl, label }. We pre-label the
  // first three slots Top / Front / Side because that's the canonical
  // orthographic-view triplet Meshy's multi-image model expects (a
  // 4th "extra" slot is also exposed for additional angles).
  const _MULTI_LABELS = ["Front", "Side", "Top", "Extra"];
  const [multiSlots, setMultiSlots] = useState([null, null, null, null]);
  const [usage, setUsage] = useState(null);
  const [job, setJob] = useState(null);        // { job_id, status, progress, model_url, error }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Import sizing. Default: auto-fit to ~80% of the printer's shortest
  // build-volume axis so AI meshes don't land at silly sizes like the
  // 1996mm test-fixture we saw during development.
  const [autoFit, setAutoFit] = useState(true);
  const [targetMaxMm, setTargetMaxMm] = useState(60);
  // Iter-132.2 — Preview-then-commit UX (text mode, fal.ai only).
  //   previewUrls        : string[]  — 4 CDN URLs from Flux Schnell
  //   previewBusy        : bool      — request in flight
  //   selectedPreviewIdx : int | null — user's chosen preview
  // When `previewUrls` is populated the primary CTA switches from
  // "Generate 3D" (direct text-to-3D) to "Preview images", and a
  // grid renders below the prompt for the user to pick from.
  const [previewUrls, setPreviewUrls] = useState([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [selectedPreviewIdx, setSelectedPreviewIdx] = useState(null);
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
      setMultiSlots([null, null, null, null]);
      setPendingAutoSubmit(false);
      // Iter-132.2 — Also reset preview state so stale thumbnails
      // don't reappear the next time the dialog opens.
      setPreviewUrls([]); setSelectedPreviewIdx(null); setPreviewBusy(false);
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

  // Voice / global trigger: any component (today: the voice-command
  // executor; tomorrow: a keyboard shortcut, a hint card, etc.) can
  // dispatch `forgeslicer:open-ai-generate` with optional detail
  // `{ prompt: string, auto: bool }` to pop us open, pre-fill the prompt
  // field, and optionally auto-submit. We force the Text tab — voice
  // can't sensibly attach an image.
  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail || {};
      const incomingPrompt = (detail.prompt || "").trim();
      setInternalOpen(true);
      setTab("text");
      if (incomingPrompt) setPrompt(incomingPrompt);
      // Only request auto-submit when we actually have a non-empty prompt;
      // an empty auto-submit is just a normal "open the dialog" intent.
      setPendingAutoSubmit(!!detail.auto && incomingPrompt.length >= 3);
    };
    window.addEventListener("forgeslicer:open-ai-generate", handler);
    return () => window.removeEventListener("forgeslicer:open-ai-generate", handler);
  }, []);

  // Auto-submit after a voice-triggered open. We need the dialog mounted +
  // prompt populated + no in-flight job + sufficient quota before firing.
  useEffect(() => {
    if (!pendingAutoSubmit) return;
    if (!open || tab !== "text") return;
    if (!prompt || prompt.trim().length < 3) return;
    if (job || busy) return;
    if (usage && usage.remaining !== undefined && usage.remaining <= 0) {
      setPendingAutoSubmit(false);
      return;
    }
    setPendingAutoSubmit(false);
    handleSubmitText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSubmit, open, tab, prompt, job, busy, usage]);

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

  // Iter-132.2 — Ask fal.ai for 4 cheap Flux-Schnell reference images
  // (~$0.001 each) so the user can pick the best one before spending
  // the ~$0.16 on the full Hunyuan3D generation. Called via the new
  // "Preview images" CTA in text mode when active_provider==='fal'.
  const handlePreviewImages = async () => {
    if (!prompt.trim() || prompt.trim().length < 3) {
      setError("Prompt must be at least 3 characters."); return;
    }
    setPreviewBusy(true); setError(""); setSelectedPreviewIdx(null);
    try {
      const { data } = await axios.post(`${API}/ai/preview/images`,
        { prompt: prompt.trim(), art_style: artStyle, count: 4 },
        { withCredentials: true });
      setPreviewUrls(Array.isArray(data.urls) ? data.urls : []);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Preview generation failed");
    } finally {
      setPreviewBusy(false);
    }
  };

  // Iter-132.2 — Commit the selected preview to a full 3D generation.
  // Uses the existing /ai/generate/image endpoint (which now accepts
  // an image_url alongside the original image_b64 field) so no new
  // client-side plumbing was needed for polling / import.
  const handleCommitPreview = async () => {
    if (selectedPreviewIdx == null || !previewUrls[selectedPreviewIdx]) {
      setError("Pick a preview first."); return;
    }
    setBusy(true); setError(""); setJob(null);
    try {
      const { data } = await axios.post(`${API}/ai/generate/image`,
        { image_url: previewUrls[selectedPreviewIdx] },
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

  // Clear the preview strip — used when the user edits the prompt so
  // stale thumbnails don't imply they still reflect the new prompt.
  const clearPreviews = () => {
    setPreviewUrls([]);
    setSelectedPreviewIdx(null);
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

  // iter-105.14 — multi-image (3-photos → STL) handlers.
  const handleMultiSlotPick = (slotIdx, file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError(`Slot ${slotIdx + 1}: image too large (max 8 MB).`); return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const commaIdx = dataUrl.indexOf(",");
      setMultiSlots((prev) => {
        const next = [...prev];
        next[slotIdx] = {
          b64: dataUrl.slice(commaIdx + 1),
          mime: file.type || "image/png",
          previewUrl: dataUrl,
        };
        return next;
      });
    };
    reader.readAsDataURL(file);
  };

  const handleMultiSlotClear = (slotIdx) => {
    setMultiSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = null;
      return next;
    });
  };

  const handleSubmitMulti = async () => {
    const filled = multiSlots.filter(Boolean);
    if (filled.length < 2) {
      setError("Add at least 2 reference photos (Top / Front / Side recommended)."); return;
    }
    setBusy(true); setError(""); setJob(null);
    try {
      const { data } = await axios.post(`${API}/ai/generate/multi-image`,
        { images: filled.map((s) => ({ image_b64: s.b64, mime_type: s.mime })) },
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
      closeDialog();
      // iter-126.2 — Auto-open the Printability Report after an AI import
      // so users see the score immediately. AI meshes typically land
      // 30-55/100 (over-tesselated + non-watertight + no flat base) so
      // the panel becomes the natural next-step affordance. Dispatched
      // as a custom window event to avoid threading a prop through the
      // dialog — Workspace already listens on `forgeslicer:open-dialog`.
      // Small delay so the mesh finishes committing to the scene store
      // before the analyzer runs against it.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("forgeslicer:open-dialog", {
          detail: { name: "printability" },
        }));
      }, 400);
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
      closeDialog();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, job]);  // eslint-disable-line react-hooks/exhaustive-deps

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
    closeDialog();
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
        <div className="border-b border-slate-800 px-4 py-2.5 bg-gradient-to-r from-fuchsia-500/15 via-purple-500/10 to-orange-500/10">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-fuchsia-400" />
            <div className="flex-1 text-sm font-semibold text-white">AI Generate · 3D Mesh</div>
            {usage && (
              usage.has_personal_key ? (
                <span
                  data-testid="ai-usage-unlimited-badge"
                  className="text-[10px] font-mono text-emerald-300 border border-emerald-500/40 rounded px-2 py-0.5"
                  title="Using your own Meshy key — no ForgeSlicer cap"
                >
                  Unlimited · Your key
                </span>
              ) : (
                <span className="text-[10px] font-mono text-fuchsia-300 border border-fuchsia-500/40 rounded px-2 py-0.5">
                  {usage.remaining}/{usage.cap} left this month
                </span>
              )
            )}
            {!inProgress && (
              <button data-testid="ai-close-btn" onClick={safeClose} className="ml-1 h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center">
                <X size={16} />
              </button>
            )}
          </div>
          {/* Iter-132 — Provider attribution reflects the ACTIVE provider
              on `/api/ai/usage.active_provider`. Default: fal.ai (Hunyuan3D
              v2 Pro). BYO Meshy key holders see the Meshy attribution
              instead. Kept the label small (10px) so it doesn't crowd
              the primary dialog title, and both provider links get a
              proper rel="noopener noreferrer" for security. */}
          {(() => {
            const provider = usage?.active_provider || "fal";
            if (provider === "meshy") {
              return (
                <div
                  className="mt-0.5 text-[10px] text-slate-400 flex items-center gap-1 pl-6"
                  data-testid="ai-generate-provider-attribution"
                >
                  Powered by{" "}
                  <a
                    href="https://www.meshy.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-fuchsia-300 hover:text-fuchsia-200 underline underline-offset-2"
                  >
                    Meshy.ai
                  </a>
                  <span className="text-slate-500">·</span>
                  <span>using your personal API key</span>
                </div>
              );
            }
            return (
              <div
                className="mt-0.5 text-[10px] text-slate-400 flex items-center gap-1 pl-6"
                data-testid="ai-generate-provider-attribution"
              >
                Powered by{" "}
                <a
                  href="https://fal.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                >
                  fal.ai · Hunyuan3D v2
                </a>
                <span className="text-slate-500">·</span>
                <span>3D generation integrated into ForgeSlicer</span>
              </div>
            );
          })()}
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
            <button
              data-testid="ai-tab-multi"
              onClick={() => setTab("multi")}
              className={`flex-1 h-8 rounded text-xs font-semibold flex items-center justify-center gap-1.5 ${tab === "multi" ? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/50" : "text-slate-400 hover:text-white"}`}
            >
              <Images size={13} /> Multi-Image
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
                  onChange={(e) => { setPrompt(e.target.value); if (previewUrls.length) clearPreviews(); }}
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
              {/* Iter-132.2 — Preview grid. Only shown for fal.ai users
                  (Meshy has no Flux step). The grid appears once
                  `previewUrls` is populated by handlePreviewImages,
                  and stays visible until the user edits the prompt
                  (which clears it). Selecting a thumbnail rings it
                  in cyan and enables the "Generate 3D from preview"
                  CTA below. */}
              {(usage?.active_provider === "fal") && (
                <div className="pt-1" data-testid="ai-preview-panel">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                      Preview images {previewUrls.length ? `· pick one` : "· optional"}
                    </label>
                    {previewUrls.length > 0 && (
                      <button
                        type="button"
                        data-testid="ai-preview-clear"
                        onClick={clearPreviews}
                        className="text-[10px] text-slate-500 hover:text-slate-300 underline underline-offset-2"
                      >Clear</button>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 mb-2 leading-snug">
                    Generate 4 cheap Flux Schnell previews (~$0.004 total) so you can pick the best reference before spending on the full 3D generation.
                  </p>
                  {previewUrls.length === 0 && (
                    <button
                      type="button"
                      data-testid="ai-preview-generate-btn"
                      onClick={handlePreviewImages}
                      disabled={previewBusy || busy || !prompt.trim() || prompt.trim().length < 3}
                      className="w-full h-8 rounded text-xs font-semibold border border-cyan-500/60 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {previewBusy ? "Generating previews…" : "Preview images first"}
                    </button>
                  )}
                  {previewUrls.length > 0 && (
                    <>
                      <div className="grid grid-cols-2 gap-2" data-testid="ai-preview-grid">
                        {previewUrls.map((url, idx) => {
                          const selected = idx === selectedPreviewIdx;
                          return (
                            <button
                              key={url}
                              type="button"
                              data-testid={`ai-preview-thumb-${idx}`}
                              onClick={() => setSelectedPreviewIdx(idx)}
                              className={
                                "relative aspect-square rounded overflow-hidden border-2 transition-all " +
                                (selected
                                  ? "border-cyan-400 ring-2 ring-cyan-400/40"
                                  : "border-slate-700 hover:border-slate-500")
                              }
                            >
                              <img
                                src={url}
                                alt={`Preview ${idx + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                              {selected && (
                                <div className="absolute top-1 right-1 bg-cyan-500 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-sm">
                                  SELECTED
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        data-testid="ai-preview-regenerate-btn"
                        onClick={handlePreviewImages}
                        disabled={previewBusy || busy}
                        className="w-full mt-2 h-7 rounded text-[11px] font-medium border border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800 disabled:opacity-50"
                      >
                        {previewBusy ? "Regenerating…" : "Regenerate previews"}
                      </button>
                    </>
                  )}
                </div>
              )}
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

          {!job && tab === "multi" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium">Reference Photos · {multiSlots.filter(Boolean).length}/4</label>
                <span className="text-[10px] text-slate-500 font-mono">{multiSlots.filter(Boolean).length < 2 ? "need ≥2" : "ready"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {_MULTI_LABELS.map((label, idx) => {
                  const slot = multiSlots[idx];
                  const required = idx < 3;
                  return (
                    <div
                      key={label}
                      data-testid={`ai-multi-slot-${idx}`}
                      className={`relative aspect-square rounded border ${slot ? "border-fuchsia-500/50" : "border-dashed border-slate-700 hover:border-slate-600"} bg-slate-950 overflow-hidden group`}
                    >
                      {slot ? (
                        <>
                          <img src={slot.previewUrl} alt={label} className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 py-1 flex items-center justify-between">
                            <span className="text-[10px] font-semibold text-fuchsia-200 uppercase tracking-wider">{label}</span>
                            <button
                              data-testid={`ai-multi-clear-${idx}`}
                              onClick={() => handleMultiSlotClear(idx)}
                              className="h-5 w-5 rounded bg-slate-900/80 text-slate-300 hover:text-white hover:bg-red-500/60 flex items-center justify-center"
                              title="Remove"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer text-slate-500 hover:text-slate-300 transition-colors">
                          <Plus size={20} className="mb-1 opacity-70" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
                          <span className="text-[9px] text-slate-600 mt-0.5">{required ? "recommended" : "optional"}</span>
                          <input
                            data-testid={`ai-multi-input-${idx}`}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp"
                            onChange={(e) => handleMultiSlotPick(idx, e.target.files?.[0])}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500 leading-snug">
                Upload <strong className="text-slate-300">2–4 orthographic photos</strong> of the same object — Front, Side, and Top views give the best reconstruction. Use plain backgrounds and consistent lighting. JPG/PNG/WebP, 8 MB each.
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
              // Iter-132.2 — When the user has picked a preview thumbnail,
              // the primary CTA switches to "Generate 3D from preview"
              // which submits the picked URL through /ai/generate/image
              // (skipping the Flux step inside create_text_to_3d — saves
              // ~$0.001 + ~1.5s that were already paid at preview time).
              selectedPreviewIdx != null && previewUrls.length > 0 ? (
                <button
                  data-testid="ai-submit-preview-btn"
                  onClick={handleCommitPreview}
                  disabled={busy || (usage && usage.remaining <= 0)}
                  className="h-9 px-4 text-xs font-bold bg-cyan-500 hover:bg-cyan-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  Generate 3D from preview
                </button>
              ) : (
                <button
                  data-testid="ai-submit-text-btn"
                  onClick={handleSubmitText}
                  disabled={busy || !prompt.trim() || (usage && usage.remaining <= 0)}
                  className="h-9 px-4 text-xs font-bold bg-fuchsia-500 hover:bg-fuchsia-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  Generate
                </button>
              )
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
            {!job && tab === "multi" && (
              <button
                data-testid="ai-submit-multi-btn"
                onClick={handleSubmitMulti}
                disabled={busy || multiSlots.filter(Boolean).length < 2 || (usage && usage.remaining <= 0)}
                className="h-9 px-4 text-xs font-bold bg-fuchsia-500 hover:bg-fuchsia-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Fuse views
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

import React, { useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";
import { Header } from "./components/Header";
import { Viewport } from "./components/Viewport";
import { ConfigPanel } from "./components/ConfigPanel";
import { StatsPanel } from "./components/StatsPanel";
import { LayerTimeline } from "./components/LayerTimeline";
import { MobileShell } from "./components/MobileShell";
import {
  DEFAULT_EDITS,
  editsAreActive,
  renderEditedImage,
} from "./components/ImageEditPanel";
import {
  getDefaultFilaments,
  optimize,
  suggestPalette,
  uploadImage,
  API as LITHO_API,
} from "./lib/api";
import {
  saveStudioState,
  loadStudioState,
  clearStudioState,
} from "./lib/studioStorage";

const DEFAULT_CONFIG = {
  width_mm: 100,
  height_mm: 100,
  thickness_mm: 2.2,
  border_mm: 2,
  layer_height_mm: 0.08,
  max_swaps: 5,
  geometry: "flat",
  curve_radius_mm: 80,
  dome_mm: 0,
  render_mode: "painting",
  relief: 0.5,
  smoothing: 0,
  // Matboard frame width (mm) — painting mode only, 0 = off.
  frame_mm: 0,
  printer_id: "generic_orca",
  // Nozzle diameter (mm) — constrains the layer-height window (25–80%
  // of Ø) and is written into the exported 3MF metadata.
  nozzle_mm: 0.4,
  // Minimum base-filament floor (layers) — fills any zero-thickness
  // voids in the heightmap so the 3MF has no holes. Range 1..5; the
  // backend defaults to 2 if the query param is omitted.
  base_min_layers: 2,
  // Lightbox (box geometry) defaults. Ignored unless geometry === "box".
  box_shape: "rect",
  box_outer_w_mm: 110,
  box_outer_h_mm: 110,
  box_depth_mm: 35,
  box_wall_mm: 3,
  box_led_mount: "both",
  box_puck_diameter_mm: 65,
  box_diffuser: true,
  box_cable_notch: true,
  // Iter-151.27 — Bas-Relief mode defaults (matches AI dialog's
  // BasReliefTab.jsx). Live under the same config dict so the whole
  // render-mode switcher is a single state atom.
  bas_diameter_mm: 220,
  bas_relief_mm: 12,
  bas_base_mm: 3,
  bas_smooth: 1.0,
  bas_dark_is_high: false,
  bas_ring_enabled: false,
  bas_ring_width_mm: 10,
  bas_ring_height_mm: 5,
};

export default function LithoStudio() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [filaments, setFilaments] = useState([]);
  const [autoOrder, setAutoOrder] = useState(true);
  const [imageId, setImageId] = useState(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [vibrancy, setVibrancy] = useState(0.5);
  const [edits, setEdits] = useState({ ...DEFAULT_EDITS });
  // The original uploaded HTMLImageElement (kept so we can re-render edits).
  const originalImgRef = useRef(null);
  const [originalImg, setOriginalImg] = useState(null);
  // Track which edits the current `imageId` was uploaded under so we know
  // when we need to re-upload the canvas-rendered version.
  const [uploadedEdits, setUploadedEdits] = useState({ ...DEFAULT_EDITS });

  useEffect(() => {
    // Skip if we're about to hydrate a saved session — the hydration
    // effect below will restore the user's palette. Fetching defaults
    // here would race and clobber whichever resolved last (typically
    // the network-slower default filaments call).
    const saved = loadStudioState();
    if (saved && saved.filaments?.length) return;
    getDefaultFilaments()
      .then(setFilaments)
      .catch(() => toast.error("Failed to load default filaments"));
  }, []);

  // iter-133 — Studio state restoration. If the user closed the tab
  // mid-workflow, hydrate imageId + config + palette + edits from
  // localStorage and re-fetch the source PNG from the backend spill.
  useEffect(() => {
    const saved = loadStudioState();
    if (!saved) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${LITHO_API}/upload/${saved.imageId}/source.png`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`expired (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setSourceUrl(url);
        setImageId(saved.imageId);
        const htmlImg = new window.Image();
        htmlImg.onload = () => {
          if (cancelled) return;
          originalImgRef.current = htmlImg;
          setOriginalImg(htmlImg);
        };
        htmlImg.src = url;
        if (saved.config) setConfig((c) => ({ ...c, ...saved.config }));
        if (saved.filaments?.length) setFilaments(saved.filaments);
        if (saved.edits) setEdits(saved.edits);
        if (saved.uploadedEdits) setUploadedEdits(saved.uploadedEdits);
        if (typeof saved.vibrancy === "number") setVibrancy(saved.vibrancy);
        if (typeof saved.autoOrder === "boolean") setAutoOrder(saved.autoOrder);
        toast.success("Restored your last session", {
          description: "Photo, palette, and settings are back.",
          duration: 3500,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[litho] restore failed, clearing snapshot:", err?.message || err);
        clearStudioState();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // iter-133 — Persist the tunable studio state on every meaningful
  // change. The helper debounces internally so a slider drag doesn't
  // hammer localStorage on every frame. We only ship the "user-tuned"
  // slice (no `result`, no HTMLImageElement, no blobs) so the payload
  // stays well under localStorage's 5 MB cap.
  useEffect(() => {
    saveStudioState({
      imageId,
      config,
      filaments,
      edits,
      uploadedEdits,
      vibrancy,
      autoOrder,
    });
  }, [imageId, config, filaments, edits, uploadedEdits, vibrancy, autoOrder]);

  // Voice → Meshy.ai → upload pipeline. Subscribe to `voice-prompt`
  // events from VoiceCommand.jsx. On each prompt:
  //   1. POST it to our Meshy text-to-image proxy
  //   2. Poll the task every 2 s (up to 90 s)
  //   3. On success, fetch the image as a Blob, wrap it as a File,
  //      and hand it to the existing handleFile pipeline so the
  //      result flows through upload → edits → optimize like any
  //      user-supplied photo.
  useEffect(() => {
    const onVoicePrompt = async (e) => {
      const prompt = e.detail?.prompt?.trim();
      if (!prompt) return;
      const { API } = await import("./lib/api");
      const toastId = toast.loading(`Generating with Meshy AI…`, {
        description: prompt.slice(0, 60) + (prompt.length > 60 ? "…" : ""),
      });
      try {
        const createRes = await fetch(`${API}/meshy/text-to-image`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        if (!createRes.ok) {
          const body = await createRes.json().catch(() => ({}));
          throw new Error(body.detail || `Meshy submit failed (${createRes.status}).`);
        }
        const { task_id } = await createRes.json();

        // Poll up to 90×2s = 180s — Meshy nano-banana usually finishes
        // in 30-60s but can queue up to 2-3 minutes at peak load.
        let imageUrl = null;
        for (let i = 0; i < 90; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const statusRes = await fetch(
            `${API}/meshy/text-to-image/${task_id}`,
            { credentials: "include" },
          );
          if (!statusRes.ok) continue;
          const s = await statusRes.json();
          if (s.image_url) {
            imageUrl = s.image_url;
            break;
          }
          if (s.status === "FAILED" || s.status === "EXPIRED") {
            throw new Error(`Meshy task ${s.status.toLowerCase()}.`);
          }
        }
        if (!imageUrl) throw new Error("Meshy generation timed out after 3 minutes.");

        // Fetch the finished image and run it through handleFile so it
        // lands in the editor exactly like a manual upload.
        const blob = await (await fetch(imageUrl)).blob();
        const file = new File([blob], `meshy-${Date.now()}.png`, {
          type: blob.type || "image/png",
        });
        toast.success("Meshy image ready — loading into editor", { id: toastId });
        await handleFile(file);
      } catch (err) {
        toast.error("Meshy generation failed", {
          id: toastId,
          description: err.message,
        });
      }
    };
    window.addEventListener("voice-prompt", onVoicePrompt);
    return () => window.removeEventListener("voice-prompt", onVoicePrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxActive = config.max_swaps + 1;

  const handleFile = async (file) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    setUploading(true);
    setResult(null);
    setEdits({ ...DEFAULT_EDITS });
    try {
      const url = URL.createObjectURL(file);
      setSourceUrl(url);
      // Pre-load the original image element so we can re-render with edits.
      // NOTE: blob: URLs are same-origin; do NOT set crossOrigin — Safari
      // iOS rejects blob URLs with a crossOrigin attribute, leaving the
      // image element permanently in a broken state.
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        originalImgRef.current = img;
        setOriginalImg(img);
      };
      img.onerror = () => {
        // Fall back to drawing directly from the blob via the viewport's
        // <img> tag — we'll re-create the canvas-source when needed.
        // eslint-disable-next-line no-console
        console.warn("Hidden image element failed to load — edits will use viewport <img> instead");
      };
      img.src = url;
      const data = await uploadImage(file);
      setImageId(data.image_id);
      setUploadedEdits({ ...DEFAULT_EDITS });
      toast.success(`Loaded ${data.width}×${data.height} image`);
    } catch (e) {
      toast.error("Upload failed");
      setSourceUrl(null);
    } finally {
      setUploading(false);
    }
  };

  /**
   * Replace the source photo *without* discarding the current edits,
   * palette, or geometry. The user keeps everything they've tuned and
   * just swaps in a new image — useful when comparing two photos with
   * the same filament set / crop box. The previous result preview is
   * cleared because it's no longer in sync with the source image.
   */
  const handleReplaceFile = async (file) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const url = URL.createObjectURL(file);
      setSourceUrl(url);
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        originalImgRef.current = img;
        setOriginalImg(img);
      };
      img.onerror = () => {
        // eslint-disable-next-line no-console
        console.warn("Hidden image element failed to load on replace");
      };
      img.src = url;
      const data = await uploadImage(file);
      setImageId(data.image_id);
      // Mark uploadedEdits as DEFAULT so ensureCurrentImageId triggers
      // a re-upload with edits applied when the user generates next.
      setUploadedEdits({ ...DEFAULT_EDITS });
      toast.success(`Replaced with ${data.width}×${data.height} image · edits preserved`);
    } catch (e) {
      toast.error("Replace failed");
    } finally {
      setUploading(false);
    }
  };

  // Make sure the backend's `imageId` reflects the *currently edited* version
  // of the source photo. If edits changed since last upload, re-render the
  // canvas, upload the resulting blob, and return the new image_id.
  const ensureCurrentImageId = async () => {
    if (!imageId) return null;
    if (!editsAreActive(edits)) return imageId;
    // Compare against the edits used at the previous upload.
    const sameAsUploaded =
      JSON.stringify(edits) === JSON.stringify(uploadedEdits);
    if (sameAsUploaded) return imageId;

    // Load (or re-load) the original from sourceUrl on demand so we never
    // fall through to the "upload as-is" branch just because of a race
    // between Image.decode and the upload network round-trip (common on
    // Safari iOS with large photos).
    let img = originalImgRef.current;
    if (!img && sourceUrl) {
      try {
        img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error("decode failed"));
          i.src = sourceUrl;
        });
        originalImgRef.current = img;
        setOriginalImg(img);
      } catch {
        img = null;
      }
    }
    if (!img) {
      toast.warning("Could not load original to apply edits — using upload as-is");
      return imageId;
    }
    const blob = await renderEditedImage(img, edits);
    const file = new File([blob], "edited.png", { type: blob.type });
    const data = await uploadImage(file);
    setImageId(data.image_id);
    setUploadedEdits({ ...edits });
    return data.image_id;
  };

  const handleGenerate = async () => {
    if (!imageId) {
      toast.error("Upload an image first");
      return;
    }
    // Iter-151.27 — Bas-Relief mode short-circuits into the AI
    // service's local sculpt endpoint (no multi-filament palette
    // pipeline). Returns STL bytes (or a ZIP with medallion + ring
    // when the frame ring is enabled). We download directly rather
    // than routing through the Litho job-history persistence layer,
    // which is palette-specific and would drop the STLs on the
    // floor.
    if (config.render_mode === "bas_relief") {
      if (!sourceUrl) {
        toast.error("Upload an image first");
        return;
      }
      setLoading(true);
      setProgressLabel("Sculpting bas-relief…");
      try {
        // Convert the current source URL back to a base64 payload.
        // Using the raw blob (not the palette-remapped one) so the
        // sculpt is driven by TRUE image luminance rather than
        // whichever filament palette happens to be loaded.
        const blob = await (await fetch(sourceUrl)).blob();
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",", 2)[1] || "");
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        const axios = (await import("axios")).default;
        // Use the top-level ForgeSlicer API base (not the /litho/studio
        // scoped one) since bas-relief lives at /api/ai/generate/*.
        const forgeApi = `${process.env.REACT_APP_BACKEND_URL}/api`;
        const resp = await axios.post(`${forgeApi}/ai/generate/bas-relief`, {
          image_b64: b64,
          mime_type: blob.type || "image/png",
          diameter_mm: Number(config.bas_diameter_mm ?? 220),
          max_relief_mm: Number(config.bas_relief_mm ?? 12),
          base_thickness_mm: Number(config.bas_base_mm ?? 3),
          dark_is_high: !!config.bas_dark_is_high,
          smooth_sigma: Number(config.bas_smooth ?? 1.0),
          grid_size: 512,
          ring_enabled: !!config.bas_ring_enabled,
          ring_width_mm: Number(config.bas_ring_width_mm ?? 10),
          ring_height_mm: Number(config.bas_ring_height_mm ?? 5),
        }, { withCredentials: true, responseType: "blob" });
        // Trigger a browser download of the raw payload — content
        // type + filename come from the server's headers so a bundle
        // with the ring shows up as .zip and a single-part shows up
        // as .stl automatically.
        const cd = resp.headers?.["content-disposition"] || "";
        const filenameMatch = /filename="?([^";]+)"?/i.exec(cd);
        const filename = filenameMatch
          ? filenameMatch[1]
          : (config.bas_ring_enabled ? "bas_relief_parts.zip" : "bas_relief_disk.stl");
        const url = URL.createObjectURL(resp.data);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`Bas-relief ready · downloaded ${filename}`);
      } catch (e) {
        let detail = e?.response?.data?.detail || e.message || "Bas-relief generation failed";
        if (e?.response?.data instanceof Blob) {
          try { detail = JSON.parse(await e.response.data.text()).detail || detail; } catch { /* keep default */ }
        }
        toast.error(detail);
      } finally {
        setLoading(false);
        setProgressLabel("");
      }
      return;
    }
    setLoading(true);
    setProgressLabel(editsAreActive(edits) ? "Applying edits…" : "Building LUT…");
    try {
      let currentId = await ensureCurrentImageId();
      const buildPayload = (id) => ({
        image_id: id,
        ...config,
        filaments: filaments.slice(0, maxActive),
        auto_order: autoOrder,
      });
      setProgressLabel("Matching pixels…");
      let data;
      try {
        data = await optimize(buildPayload(currentId));
      } catch (firstErr) {
        // Same resilience story as handleSuggestPalette — the backend
        // may have restarted and lost the in-memory upload. Re-upload
        // from the browser blob and retry once before giving up.
        if (firstErr?.response?.status === 404 && sourceUrl) {
          setProgressLabel("Re-uploading source…");
          const blobRes = await fetch(sourceUrl);
          const blob = await blobRes.blob();
          const file = new File([blob], "reupload.png", { type: blob.type || "image/png" });
          const up = await uploadImage(file);
          currentId = up.image_id;
          setImageId(up.image_id);
          setUploadedEdits({ ...DEFAULT_EDITS });
          setProgressLabel("Matching pixels…");
          data = await optimize(buildPayload(currentId));
        } else {
          throw firstErr;
        }
      }
      setResult(data);
      // Tell JobHistory to refresh so the newly-saved job appears.
      window.dispatchEvent(new Event("lithoforge:job-finished"));
      toast.success(`Optimized · ΔE ${data.delta_e_mean.toFixed(2)}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Optimization failed");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSourceUrl(null);
    setImageId(null);
    setResult(null);
    setOriginalImg(null);
    originalImgRef.current = null;
    setEdits({ ...DEFAULT_EDITS });
    setUploadedEdits({ ...DEFAULT_EDITS });
    // iter-133 — wipe the persistence snapshot too so a hydrate on next
    // load doesn't drag the just-cleared image back in.
    clearStudioState();
  };

  // Keep max_swaps consistent with the actual palette length: at most
  // (length-1) so a 5-filament palette caps at 4 swaps, etc.
  const handlePaletteSizeChange = (newSize) => {
    setConfig((c) => {
      const cap = Math.max(1, newSize - 1);
      if (c.max_swaps > cap) return { ...c, max_swaps: cap };
      return c;
    });
  };

  const handleSuggestPalette = async () => {
    if (!imageId) {
      toast.error("Upload an image first");
      return;
    }
    setSuggesting(true);
    try {
      const currentId = await ensureCurrentImageId();
      const suggested = await suggestPalette(currentId, maxActive, vibrancy);
      setFilaments(suggested);
      setAutoOrder(true);
      toast.success(
        `Suggested ${suggested.length} filaments: ${suggested
          .map((f) => f.name)
          .join(" · ")}`
      );
    } catch (e) {
      // If the backend lost the upload (hot-reload, LRU eviction, or
      // stale link), re-upload the source blob from the browser and
      // retry once — the user experiences a subtle 1s delay instead of
      // an infuriating "Suggestion failed" that they have to work
      // around manually.
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 404 && sourceUrl) {
        try {
          const blobRes = await fetch(sourceUrl);
          const blob = await blobRes.blob();
          const file = new File([blob], "reupload.png", { type: blob.type || "image/png" });
          const data = await uploadImage(file);
          setImageId(data.image_id);
          setUploadedEdits({ ...DEFAULT_EDITS });
          const suggested = await suggestPalette(data.image_id, maxActive, vibrancy);
          setFilaments(suggested);
          setAutoOrder(true);
          toast.success(
            `Re-uploaded + suggested ${suggested.length} filaments: ${suggested
              .map((f) => f.name)
              .join(" · ")}`
          );
          return;
        } catch (retryErr) {
          // fall through to the generic error toast below
        }
      }
      toast.error(detail || (status ? `Suggestion failed (${status})` : "Suggestion failed"));
    } finally {
      setSuggesting(false);
    }
  };

  /**
   * Restore a job from the user's cloud history. Hydrates the visible
   * preview + downloads + config + palette without needing a re-upload.
   */
  const handleRestoreJob = (job) => {
    const req = job.request || {};
    setConfig((c) => ({
      ...c,
      width_mm: req.width_mm ?? c.width_mm,
      height_mm: req.height_mm ?? c.height_mm,
      thickness_mm: req.thickness_mm ?? c.thickness_mm,
      border_mm: req.border_mm ?? c.border_mm,
      layer_height_mm: req.layer_height_mm ?? c.layer_height_mm,
      max_swaps: req.max_swaps ?? c.max_swaps,
      geometry: req.geometry ?? c.geometry,
      curve_radius_mm: req.curve_radius_mm ?? c.curve_radius_mm,
      render_mode: req.render_mode ?? c.render_mode,
      relief: req.relief ?? c.relief,
      frame_mm: req.frame_mm ?? c.frame_mm,
      printer_id: req.printer_id ?? c.printer_id,
      nozzle_mm: req.nozzle_mm ?? c.nozzle_mm,
    }));
    if (job.filaments?.length) {
      setFilaments(job.filaments);
    }
    // Surface the stored preview + downloads in the viewport. The job_id
    // matches the existing in-memory hydrated job server-side so exports
    // work the moment the user clicks Download.
    setResult({
      job_id: job.job_id,
      preview_png_base64: job.preview_png_base64,
      heightmap_png_base64: job.heightmap_png_base64,
      delta_e_mean: job.delta_e_mean,
      delta_e_p95: job.delta_e_p95,
      total_layers: job.total_layers,
      layer_allocation: job.allocation,
      filaments: job.filaments,
      swap_heights_mm: job.swap_heights_mm,
      timeline: job.timeline,
      // Restored jobs don't carry void counts; default to 0 so the
      // badge stays hidden.
      void_pixels: job.void_pixels ?? 0,
      in_domain_pixels: job.in_domain_pixels ?? 0,
    });
    // Reset source-image state so the viewport shows the restored render
    // (not a stale upload from the current session).
    setSourceUrl(null);
    setImageId(null);
    setOriginalImg(null);
    originalImgRef.current = null;
  };

  const canGenerate = useMemo(
    () => !!imageId && filaments.length > 0 && !uploading,
    [imageId, filaments, uploading]
  );

  // JS-driven responsive switch so panels only mount once. Tailwind's
  // `hidden lg:grid` would render both trees, doubling state and effects
  // (two histograms, two file inputs, etc.). Breakpoint set at 1280 so
  // iPad landscape (1024) gets the comfortable touch layout too.
  const [isDesktop, setIsDesktop] = React.useState(
    typeof window !== "undefined" ? window.innerWidth >= 1280 : true
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const update = (e) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update); // Safari < 14 fallback
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);

  const configPanelEl = (
    <ConfigPanel
      config={config}
      setConfig={setConfig}
      disabled={loading}
      paletteLength={filaments.length}
      edits={edits}
      setEdits={setEdits}
      hasImage={!!imageId}
      originalImg={originalImg}
      filaments={filaments}
      setFilaments={setFilaments}
      vibrancy={vibrancy}
      setVibrancy={setVibrancy}
    />
  );

  const viewportEl = (
    <Viewport
      onFile={handleFile}
      onReplace={handleReplaceFile}
      sourceUrl={sourceUrl}
      result={result}
      loading={loading || uploading}
      progressLabel={uploading ? "Uploading…" : progressLabel}
      onReset={handleReset}
      renderMode={config.render_mode}
      edits={edits}
      setEdits={setEdits}
      filaments={filaments}
    />
  );

  const statsPanelEl = (
    <StatsPanel
      result={result}
      filaments={filaments}
      setFilaments={setFilaments}
      maxActive={maxActive}
      autoOrder={autoOrder}
      setAutoOrder={setAutoOrder}
      onSuggestPalette={handleSuggestPalette}
      suggesting={suggesting}
      canSuggest={!!imageId && !loading}
      vibrancy={vibrancy}
      setVibrancy={setVibrancy}
      onPaletteSizeChange={handlePaletteSizeChange}
      onRestoreJob={handleRestoreJob}
      baseMinLayers={config.base_min_layers}
      geometry={config.geometry}
      boxDiffuser={config.box_diffuser ?? true}
    />
  );

  return (
    <div className="App h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header
        onGenerate={handleGenerate}
        canGenerate={canGenerate}
        generating={loading}
        jobId={result?.job_id}
        baseMinLayers={config.base_min_layers}
      />

      {/* Desktop ≥ lg: 3-column control room */}
      {isDesktop ? (
        <div
          className="grid flex-1 overflow-hidden"
          style={{ gridTemplateColumns: "300px 1fr 340px" }}
          data-testid="desktop-layout"
        >
          <aside className="border-r border-zinc-800 overflow-hidden">
            {configPanelEl}
          </aside>
          <main className="overflow-hidden relative">{viewportEl}</main>
          <aside className="border-l border-zinc-800 overflow-hidden">
            {statsPanelEl}
          </aside>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden" data-testid="mobile-layout">
          <MobileShell
            viewport={viewportEl}
            configPanel={configPanelEl}
            statsPanel={statsPanelEl}
          />
        </div>
      )}

      <LayerTimeline
        timeline={result?.timeline}
        totalLayers={result?.total_layers || 0}
      />

    </div>
  );
}

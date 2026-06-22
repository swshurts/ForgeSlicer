// iter-105.5 — Texture Library dialog. Heightmap-first redesign.
//
// One pipeline: every texture (built-in pattern OR user-uploaded
// image) becomes a grayscale heightmap, which the wrap engine
// displaces against the target's surface. No more pattern-specific
// 3D mesh rasterisers; no more "drop a flat tile on the bed and
// hand-position it" workflow.
//
// What changed vs iter-105.4:
//   • "Built-in" tab — same patterns, but rendered via canvas (so
//     they finally produce dense, accurate heightmaps).
//   • "My Textures" tab — drag-and-drop / pick-a-file PNG / JPG.
//     Saved server-side, available across reloads.
//   • Tile vs Stretch toggle — controls how the heightmap maps to
//     the target's surface (one image once, vs repeating tiles).
//   • Removed the "Drop on plate" / "Single-face flat tile" paths.
//     A texture without a target is useless; we now require one.

import React, { useState, useEffect, useCallback } from "react";
import { Layers, X, BookOpen, Upload, Image as ImageIcon, Trash2 } from "lucide-react";
import { useScene } from "../../lib/store";
import {
  TEXTURE_PATTERNS,
  wrapTextureForTarget,
  targetSupportsSurfaceWrap,
  CUBE_FACES,
  MESH_DETAIL_LEVELS,
} from "../../lib/textureGeometry";
import {
  buildPatternHeightmap,
  imageToHeightmap,
  patternPreviewDataUrl,
} from "../../lib/textureHeightmap";
import {
  listCustomTextures,
  uploadCustomTexture,
  deleteCustomTexture,
  NotAuthenticatedError,
} from "../../lib/customTexturesApi";

export default function TextureLibraryDialog({ open, onClose, targetObjectId = null }) {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const replaceObjects = useScene((s) => s.replaceObjects);
  // Fall back to the user's current selection if no explicit target was
  // passed — covers the case where the user pops the dialog from the
  // composites tab with a primitive already highlighted.
  const effectiveTargetId = targetObjectId || selectedId;
  const target = effectiveTargetId ? objects.find((o) => o.id === effectiveTargetId) : null;
  const supportsWrap = targetSupportsSurfaceWrap(target);

  // ---- Source selection (which texture to apply) ----
  const [sourceKind, setSourceKind] = useState("builtin"); // "builtin" | "custom"
  const [pattern, setPattern] = useState(TEXTURE_PATTERNS[0].id);
  const selectedPattern = TEXTURE_PATTERNS.find((p) => p.id === pattern) || TEXTURE_PATTERNS[0];
  const [customTextures, setCustomTextures] = useState([]);
  const [customsAuthOk, setCustomsAuthOk] = useState(true);
  const [selectedCustomId, setSelectedCustomId] = useState(null);
  const selectedCustom = customTextures.find((t) => t.texture_id === selectedCustomId) || null;
  // ---- Tuning ----
  const [tileSize, setTileSize] = useState(TEXTURE_PATTERNS[0].defaults.tileSize);
  const [height, setHeight] = useState(TEXTURE_PATTERNS[0].defaults.height);
  const [modifier, setModifier] = useState("positive");        // positive | negative
  const [fitMode, setFitMode] = useState("tile");              // tile | stretch
  const [invert, setInvert] = useState(false);                 // custom-image only
  const [faceMask, setFaceMask] = useState("all");             // all | +x | -x | +y | -y | +z | -z (cube only)
  const [meshDetail, setMeshDetail] = useState("high");        // draft | standard | high
  const [wrapMode, setWrapMode] = useState("whole");           // whole | single | perface (cube only)
  // iter-105.13 — per-face source picks. Each entry is either null
  // (face stays flat) or { kind: "builtin"|"custom", id: string }.
  const [perFaceSources, setPerFaceSources] = useState({
    "+x": null, "-x": null, "+y": null, "-y": null, "+z": null, "-z": null,
  });
  // Which face slot is currently being edited (drives the small
  // per-face picker popover at the bottom of the perface panel).
  const [editingFace, setEditingFace] = useState(null);
  const [busy, setBusy] = useState(false);
  // Upload UI
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadSrc, setUploadSrc] = useState(null);            // data URL
  const [uploadErr, setUploadErr] = useState("");
  const fileInputRef = React.useRef(null);

  // ---- Pattern thumbnails (cached once per pattern id) ----
  const [patternThumbs, setPatternThumbs] = useState({});
  useEffect(() => {
    if (!open) return;
    if (Object.keys(patternThumbs).length === TEXTURE_PATTERNS.length) return;
    const out = {};
    for (const p of TEXTURE_PATTERNS) {
      try { out[p.id] = patternPreviewDataUrl(p.id); } catch (_e) { /* skip */ }
    }
    setPatternThumbs(out);
  }, [open, patternThumbs]);

  // ---- Pull custom textures when dialog opens ----
  const refreshCustoms = useCallback(async () => {
    try {
      const list = await listCustomTextures();
      if (list && list.__unauthenticated) {
        setCustomsAuthOk(false);
        setCustomTextures([]);
      } else {
        setCustomsAuthOk(true);
        setCustomTextures(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Failed to load custom textures:", e);
      setCustomTextures([]);
    }
  }, []);
  useEffect(() => { if (open) refreshCustoms(); }, [open, refreshCustoms]);

  const handlePatternChange = (id) => {
    const p = TEXTURE_PATTERNS.find((x) => x.id === id) || TEXTURE_PATTERNS[0];
    setPattern(id);
    setTileSize(p.defaults.tileSize);
    setHeight(p.defaults.height);
  };

  const handleCustomChange = (tex) => {
    setSelectedCustomId(tex.texture_id);
    setTileSize(tex.tile_size_mm);
    setHeight(tex.default_height_mm);
    setInvert(!!tex.default_invert);
    setFitMode(tex.default_fit || "tile");
  };

  // ---- Build the heightmap from the current source selection ----
  const buildHeightmap = async () => {
    if (sourceKind === "builtin") {
      return buildPatternHeightmap(pattern, tileSize, height);
    }
    if (!selectedCustom) return null;
    return imageToHeightmap(selectedCustom.image_b64, {
      heightMM: height,
      tileSizeMM: tileSize,
      invert,
      fitMode,
    });
  };

  // iter-105.13 — build a heightmap for ONE face slot in per-face
  // mode. Slots can hold either a built-in pattern id or a custom
  // texture id; null entries return null (face left flat).
  const buildHeightmapForSlot = async (slot) => {
    if (!slot) return null;
    if (slot.kind === "builtin") {
      return buildPatternHeightmap(slot.id, tileSize, height);
    }
    const tex = customTextures.find((t) => t.texture_id === slot.id);
    if (!tex) return null;
    return imageToHeightmap(tex.image_b64, {
      heightMM: height,
      tileSizeMM: tileSize,
      invert,
      fitMode,
    });
  };

  // ---- Apply texture: wrap the target's entire surface ----
  const handleApply = async () => {
    if (busy || !target || !supportsWrap) return;
    setBusy(true);
    try {
      const isPerFace = target.type === "cube" && wrapMode === "perface";
      let wrapped = null;
      if (isPerFace) {
        // Build all six heightmaps in parallel (each may be null for
        // a "leave flat" face).
        const faceIds = ["+x", "-x", "+y", "-y", "+z", "-z"];
        const built = await Promise.all(
          faceIds.map((f) => buildHeightmapForSlot(perFaceSources[f])),
        );
        const perFaceHeightmaps = {};
        let anyHm = false;
        faceIds.forEach((f, i) => {
          perFaceHeightmaps[f] = built[i];
          if (built[i] && built[i].hmap) anyHm = true;
        });
        if (!anyHm) throw new Error("Pick at least one face's texture before wrapping.");
        wrapped = wrapTextureForTarget(target, {
          perFaceHeightmaps, modifier, fitMode, tileSize,
          faceMask: "all",
          meshDetail,
        });
      } else {
        const heightmap = await buildHeightmap();
        if (!heightmap) throw new Error("Could not build heightmap (no texture selected?)");
        wrapped = wrapTextureForTarget(target, {
          heightmap, modifier, fitMode, tileSize,
          faceMask: target.type === "cube" && wrapMode === "single" ? faceMask : "all",
          meshDetail,
        });
      }
      if (!wrapped) throw new Error("Surface wrap not available for this target type");
      const vertices = new Float32Array(wrapped.attributes.position.array);
      const indices = wrapped.index ? new Uint32Array(wrapped.index.array) : null;
      wrapped.computeBoundingBox();
      const bb = wrapped.boundingBox;
      const originalBbox = bb
        ? { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z }
        : null;
      // Drop the new mesh so its bottom sits on z=0 (the original
      // primitive's auto-drop intent is preserved through the wrap).
      const tp = target.position || [0, 0, 0];
      const newZ = bb ? -bb.min.z : tp[2];
      wrapped.dispose();
      const labelTail = isPerFace
        ? "Per-face textures"
        : (sourceKind === "builtin"
            ? selectedPattern.label
            : (selectedCustom?.name || "Custom image"));
      replaceObjects([target.id], [{
        name: `${target.name} · ${labelTail}`,
        type: "imported",
        modifier: target.modifier || "positive",
        visible: true,
        locked: false,
        position: [tp[0], tp[1], newZ],
        rotation: [...target.rotation],
        scale: [1, 1, 1],
        dims: {},
        geometry: { vertices, indices },
        originalBbox,
        __skipAutoDrop: true,
      }]);
      onClose();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Texture wrap failed:", e);
      if (typeof window !== "undefined" && window.alert) {
        window.alert("Texture wrap failed: " + (e.message || e));
      }
    } finally {
      setBusy(false);
    }
  };

  // ---- Upload flow ----
  const handleFilePicked = (file) => {
    setUploadErr("");
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
      setUploadErr("Pick a PNG, JPG, GIF, or WebP image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // Re-encode to a clean 512x512 grayscale PNG so the wire size
      // stays small AND we keep enough detail for portraits / line
      // art to read crisply on the print (the heightmap pipeline
      // uses RES=512 internally — uploading at lower resolution
      // would force a blurry upscale).
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 512; c.height = 512;
        const cx = c.getContext("2d");
        cx.fillStyle = "#000";
        cx.fillRect(0, 0, 512, 512);
        // Letterbox-fit so non-square uploads keep their aspect.
        const ar = img.width / img.height;
        let dw = 512, dh = 512;
        if (ar > 1) dh = 512 / ar; else dw = 512 * ar;
        cx.drawImage(img, (512 - dw) / 2, (512 - dh) / 2, dw, dh);
        // Grayscale pass
        const id = cx.getImageData(0, 0, 512, 512);
        for (let i = 0; i < id.data.length; i += 4) {
          const g = 0.299 * id.data[i] + 0.587 * id.data[i + 1] + 0.114 * id.data[i + 2];
          id.data[i] = id.data[i + 1] = id.data[i + 2] = g;
        }
        cx.putImageData(id, 0, 0);
        const pngFull = c.toDataURL("image/png");
        // Thumbnail
        const t = document.createElement("canvas");
        t.width = 64; t.height = 64;
        t.getContext("2d").drawImage(c, 0, 0, 64, 64);
        const pngThumb = t.toDataURL("image/png");
        setUploadSrc({ full: pngFull, thumb: pngThumb });
        if (!uploadName) {
          setUploadName(file.name.replace(/\.[^.]+$/, "").slice(0, 60));
        }
      };
      img.onerror = () => setUploadErr("Could not read image data.");
      img.src = reader.result;
    };
    reader.onerror = () => setUploadErr("Could not read file.");
    reader.readAsDataURL(file);
  };

  const handleUploadSave = async () => {
    if (!uploadSrc || !uploadName.trim()) return;
    setBusy(true);
    try {
      const tex = await uploadCustomTexture({
        name: uploadName.trim().slice(0, 60),
        image_b64: uploadSrc.full,
        thumb_b64: uploadSrc.thumb,
        tile_size_mm: tileSize,
        default_height_mm: height,
        default_invert: invert,
        default_fit: fitMode,
      });
      await refreshCustoms();
      setSourceKind("custom");
      setSelectedCustomId(tex.texture_id);
      setUploadOpen(false);
      setUploadSrc(null);
      setUploadName("");
    } catch (e) {
      if (e instanceof NotAuthenticatedError) {
        setCustomsAuthOk(false);
        setUploadErr("You're not signed in on this domain. Sign in (top-right menu) and try again — your image is still here.");
      } else {
        setUploadErr(e.message || String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (tid) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this saved texture?")) return;
    try {
      await deleteCustomTexture(tid);
      if (selectedCustomId === tid) setSelectedCustomId(null);
      await refreshCustoms();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Delete failed:", e);
    }
  };

  // iter-105.10 — Lithophane preset. Pre-configures the wrap for the
  // classic back-lit lithophane look: a user image is stretched ONCE
  // across the surface, brightness is inverted (so dark photo areas
  // become tall — blocking more light — and bright areas stay thin),
  // height tall enough (3mm) that the contrast reads when back-lit,
  // positive modifier. Switches the source tab to "custom" because a
  // built-in pattern as a lithophane doesn't really make sense.
  // Pairs naturally with LithoForge.net workflow.
  const applyLithophanePreset = () => {
    setSourceKind("custom");
    setFitMode("stretch");
    setInvert(true);
    setHeight(3.0);
    setModifier("positive");
  };

  // ---- Drag-and-drop in the My Textures area ----
  const handleDrop = (e) => {
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    setUploadOpen(true);
    handleFilePicked(e.dataTransfer.files[0]);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="texture-library-dialog"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[96vw] max-h-[92vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 sticky top-0 bg-slate-900 z-10">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-slate-100">Texture Library</h2>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">surface-wrap (printable)</span>
          </div>
          <button data-testid="texture-library-close-btn" onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Target required banner */}
          {!target && (
            <div
              data-testid="texture-no-target-banner"
              className="rounded border border-amber-700 bg-amber-900/30 px-3 py-2 text-[11px] text-amber-300"
            >
              <b className="text-amber-200">Pick a model first.</b> Select a sphere, cube, cylinder, or cone in the
              scene — textures wrap onto the chosen model&apos;s surface (the old &quot;drop a flat tile on the bed&quot;
              workflow has been removed).
            </div>
          )}
          {target && !supportsWrap && (
            <div className="rounded border border-amber-700 bg-amber-900/30 px-3 py-2 text-[11px] text-amber-300">
              <b className="text-amber-200">&quot;{target.name}&quot; can&apos;t be wrapped yet.</b> Surface wrap supports sphere,
              cube, cylinder, and cone. Imported meshes / torus / sweep are on the v2 backlog.
            </div>
          )}
          {target && supportsWrap && (
            <div className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-300">
              Wrapping onto <span className="text-orange-300 font-medium">{target.name}</span> ({target.type}).
            </div>
          )}

          {/* Source tabs */}
          <div className="flex items-end gap-1.5 border-b border-slate-800">
            <button
              data-testid="texture-source-builtin"
              onClick={() => setSourceKind("builtin")}
              className={`px-3 h-8 text-[11px] uppercase tracking-wider font-semibold border-b-2 transition-colors ${
                sourceKind === "builtin"
                  ? "border-orange-500 text-orange-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Built-in patterns
            </button>
            <button
              data-testid="texture-source-custom"
              onClick={() => setSourceKind("custom")}
              className={`px-3 h-8 text-[11px] uppercase tracking-wider font-semibold border-b-2 transition-colors ${
                sourceKind === "custom"
                  ? "border-orange-500 text-orange-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              My textures
              {customTextures.length > 0 && (
                <span className="ml-1.5 text-[10px] text-slate-500">({customTextures.length})</span>
              )}
            </button>
            <div className="flex-1" />
            <button
              data-testid="texture-preset-lithophane"
              onClick={applyLithophanePreset}
              title="Lithophane preset — switches to My Textures, sets Stretch fit + Invert + 3mm height + Positive. Pair with a photo upload for back-lit prints."
              className="mb-1 px-2.5 h-7 rounded border border-amber-600/40 bg-amber-500/10 text-amber-300 text-[10px] uppercase tracking-wider font-semibold hover:border-amber-500 hover:bg-amber-500/20 transition-colors"
            >
              ✨ Lithophane preset
            </button>
          </div>

          {/* Built-in pattern grid */}
          {sourceKind === "builtin" && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-wider text-slate-400">Pattern</label>
                <a
                  data-testid="texture-tutorial-pdf-link"
                  href="/docs/ForgeSlicer-Texture-Tutorial.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] uppercase tracking-wider text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
                >
                  <BookOpen size={11} /> Tutorial PDF
                </a>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {TEXTURE_PATTERNS.map((p) => (
                  <button
                    key={p.id}
                    data-testid={`texture-pattern-${p.id}`}
                    onClick={() => handlePatternChange(p.id)}
                    className={`text-left rounded border overflow-hidden transition-all ${
                      pattern === p.id
                        ? "border-orange-500"
                        : "border-slate-700 hover:border-slate-500"
                    }`}
                  >
                    <div className="aspect-square bg-slate-950 flex items-center justify-center overflow-hidden">
                      {patternThumbs[p.id]
                        ? <img src={patternThumbs[p.id]} alt={p.label} className="w-full h-full object-cover" />
                        : <div className="text-[9px] text-slate-600">no preview</div>}
                    </div>
                    <div className={`px-2 py-1.5 ${pattern === p.id ? "bg-orange-500/15" : "bg-slate-950"}`}>
                      <div className={`text-[11px] font-medium ${pattern === p.id ? "text-orange-300" : "text-slate-200"}`}>
                        {p.label}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5 leading-tight truncate">{p.hint}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom textures grid */}
          {sourceKind === "custom" && (
            <div onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-wider text-slate-400">My textures</label>
                <button
                  data-testid="texture-upload-open-btn"
                  onClick={() => { setUploadOpen(true); setUploadErr(""); }}
                  className="text-[10px] uppercase tracking-wider text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
                >
                  <Upload size={11} /> Upload image
                </button>
              </div>
              {!customsAuthOk && (
                <div
                  data-testid="texture-custom-signed-out"
                  className="rounded border border-amber-700 bg-amber-900/30 px-3 py-2 text-[11px] text-amber-300 mb-2"
                >
                  <b className="text-amber-200">Sign in to use custom textures.</b> Built-in patterns work without
                  signing in, but custom uploads are stored per-account so they follow you across reloads. Use the
                  user menu in the top-right of the workspace to sign in.
                </div>
              )}
              {customTextures.length === 0 && !uploadOpen && (
                <div
                  data-testid="texture-custom-empty"
                  className="rounded border border-dashed border-slate-700 bg-slate-950/60 p-6 text-center"
                >
                  <ImageIcon size={28} className="mx-auto text-slate-600 mb-2" />
                  <div className="text-[12px] text-slate-300">Drop an image here, or click <b>Upload image</b> above</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Anything works — a photo of daisies, an airplane silhouette, a logo, a brick wall.
                    Brighter = taller relief.
                  </div>
                </div>
              )}
              {customTextures.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5">
                  {customTextures.map((t) => (
                    <div
                      key={t.texture_id}
                      data-testid={`texture-custom-${t.texture_id}`}
                      className={`relative rounded border overflow-hidden transition-all ${
                        selectedCustomId === t.texture_id
                          ? "border-orange-500"
                          : "border-slate-700 hover:border-slate-500"
                      }`}
                    >
                      <button
                        onClick={() => handleCustomChange(t)}
                        className="block w-full text-left"
                      >
                        <div className="aspect-square bg-slate-950">
                          <img src={t.thumb_b64} alt={t.name} className="w-full h-full object-cover" />
                        </div>
                        <div className={`px-2 py-1.5 ${selectedCustomId === t.texture_id ? "bg-orange-500/15" : "bg-slate-950"}`}>
                          <div className={`text-[11px] font-medium truncate ${selectedCustomId === t.texture_id ? "text-orange-300" : "text-slate-200"}`}>
                            {t.name}
                          </div>
                          <div className="text-[9px] text-slate-500 mt-0.5">tile {t.tile_size_mm}mm · {t.default_fit}</div>
                        </div>
                      </button>
                      <button
                        data-testid={`texture-custom-delete-${t.texture_id}`}
                        onClick={() => handleDelete(t.texture_id)}
                        className="absolute top-1 right-1 p-1 rounded bg-slate-950/80 text-slate-500 hover:text-rose-400"
                        title="Delete saved texture"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Upload mini-form */}
              {uploadOpen && (
                <div data-testid="texture-upload-panel" className="mt-3 rounded border border-slate-700 bg-slate-950 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wider text-orange-300">Upload image</div>
                    <button onClick={() => { setUploadOpen(false); setUploadSrc(null); }} className="text-slate-500 hover:text-slate-200">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <button
                      data-testid="texture-upload-pick-file"
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                      className="flex-shrink-0 w-24 h-24 rounded border-2 border-dashed border-slate-700 bg-slate-900 flex items-center justify-center text-slate-500 hover:border-orange-500 hover:text-orange-400 overflow-hidden"
                    >
                      {uploadSrc
                        ? <img src={uploadSrc.thumb} alt="preview" className="w-full h-full object-cover" />
                        : <ImageIcon size={28} />}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      style={{ display: "none" }}
                      onChange={(e) => handleFilePicked(e.target.files && e.target.files[0])}
                    />
                    <div className="flex-1 space-y-1.5">
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-slate-500">Name</span>
                        <input
                          data-testid="texture-upload-name"
                          type="text"
                          value={uploadName}
                          maxLength={60}
                          onChange={(e) => setUploadName(e.target.value)}
                          placeholder="e.g. Daisy field"
                          className="w-full h-7 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-slate-200"
                        />
                      </div>
                      <button
                        data-testid="texture-upload-save"
                        onClick={handleUploadSave}
                        disabled={busy || !uploadSrc || !uploadName.trim()}
                        className="w-full h-7 rounded bg-orange-500 hover:bg-orange-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-950 text-[11px] font-semibold"
                      >
                        {busy ? "Saving…" : "Save to My Textures"}
                      </button>
                    </div>
                  </div>
                  {uploadErr && <div className="text-[10px] text-rose-400">{uploadErr}</div>}
                  <div className="text-[10px] text-slate-500 leading-tight">
                    Image gets converted to a 256×256 grayscale heightmap. Brighter = taller relief.
                    Anything works: photos, logos, line art, drawings.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Modifier */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Apply as</label>
            <div className="flex gap-1.5">
              {[
                { id: "positive", label: "Raised (relief grows out)", color: "orange" },
                { id: "negative", label: "Engraved (relief dips in)", color: "cyan" },
              ].map((m) => (
                <button
                  key={m.id}
                  data-testid={`texture-modifier-${m.id}`}
                  onClick={() => setModifier(m.id)}
                  className={`flex-1 h-8 rounded border text-[11px] font-medium transition-all ${
                    modifier === m.id
                      ? m.color === "orange"
                        ? "border-orange-500 bg-orange-500/15 text-orange-300"
                        : "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Fit mode */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Fit</label>
            <div className="flex gap-1.5">
              {[
                { id: "tile",    label: "Tile (repeat)",       desc: "Texture repeats across the surface; tile size controls spacing." },
                { id: "stretch", label: "Stretch (fit once)",  desc: "One image wraps around the whole model once." },
              ].map((m) => (
                <button
                  key={m.id}
                  data-testid={`texture-fit-${m.id}`}
                  onClick={() => setFitMode(m.id)}
                  className={`flex-1 h-8 rounded border text-[11px] font-medium transition-all ${
                    fitMode === m.id
                      ? "border-orange-500 bg-orange-500/15 text-orange-300"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                  title={m.desc}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cube wrap mode + face picker — cube only */}
          {target && target.type === "cube" && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">
                Apply
              </label>
              <div className="flex gap-1.5 mb-1.5">
                {[
                  { id: "whole",   label: "All faces (same)" },
                  { id: "single",  label: "Single face" },
                  { id: "perface", label: "Per-face (different image each side)" },
                ].map((m) => (
                  <button
                    key={m.id}
                    data-testid={`texture-wrapmode-${m.id}`}
                    onClick={() => setWrapMode(m.id)}
                    className={`flex-1 h-8 rounded border text-[10px] font-medium leading-tight transition-all ${
                      wrapMode === m.id
                        ? "border-orange-500 bg-orange-500/15 text-orange-300"
                        : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {wrapMode === "single" && (
                <select
                  data-testid="texture-face-mask"
                  value={faceMask === "all" ? "+z" : faceMask}
                  onChange={(e) => setFaceMask(e.target.value)}
                  className="w-full h-8 bg-slate-950 border border-slate-700 rounded px-2 text-[11px] text-slate-200"
                >
                  {CUBE_FACES.filter((f) => f.id !== "all").map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              )}
              {wrapMode === "perface" && (
                <PerFacePicker
                  faceSources={perFaceSources}
                  patternThumbs={patternThumbs}
                  customTextures={customTextures}
                  editingFace={editingFace}
                  onEditFace={setEditingFace}
                  onPickSource={(face, src) => {
                    setPerFaceSources((prev) => ({ ...prev, [face]: src }));
                    setEditingFace(null);
                  }}
                  onClearFace={(face) => setPerFaceSources((prev) => ({ ...prev, [face]: null }))}
                />
              )}
            </div>
          )}

          {/* Mesh detail */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-wider text-slate-400">Mesh detail</label>
              <span className="text-[9px] text-slate-500">controls STL size vs surface fidelity</span>
            </div>
            <div className="flex gap-1.5">
              {MESH_DETAIL_LEVELS.map((m) => (
                <button
                  key={m.id}
                  data-testid={`texture-mesh-${m.id}`}
                  onClick={() => setMeshDetail(m.id)}
                  className={`flex-1 h-9 rounded border text-[11px] font-medium transition-all ${
                    meshDetail === m.id
                      ? "border-orange-500 bg-orange-500/15 text-orange-300"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                  title={m.hint}
                >
                  <div>{m.label}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">{m.hint.split(",")[1]?.trim()}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Tuning */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Tuning</label>
            <div className="grid grid-cols-2 gap-2">
              {fitMode === "tile" && (
                <NumField testid="texture-tilesize" label="tile size (mm)" value={tileSize} onChange={setTileSize} min={0.5} step={0.5} />
              )}
              <NumField testid="texture-height" label="relief height (mm)" value={height} onChange={setHeight} min={0.1} step={0.1} />
            </div>
            {sourceKind === "custom" && (
              <label className="mt-2 flex items-start gap-2 cursor-pointer text-[11px] text-slate-300 select-none">
                <input
                  data-testid="texture-invert-toggle"
                  type="checkbox"
                  checked={invert}
                  onChange={(e) => setInvert(e.target.checked)}
                  className="mt-0.5 accent-orange-500"
                />
                <span>
                  <span className="font-medium text-slate-200">Invert (bright = low)</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5 leading-tight">
                    Useful when the subject of your image is dark on a light background — flips so the subject
                    becomes the raised relief.
                  </span>
                </span>
              </label>
            )}
          </div>

          {/* Apply button */}
          <button
            data-testid="texture-apply-btn"
            onClick={handleApply}
            disabled={busy || !target || !supportsWrap || (sourceKind === "custom" && !selectedCustom)}
            className="w-full h-9 rounded bg-orange-500 hover:bg-orange-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-950 text-sm font-semibold transition-colors"
          >
            {busy
              ? "Wrapping…"
              : !target
                ? "Select a model first"
                : !supportsWrap
                  ? "Target type not supported"
                  : sourceKind === "custom" && !selectedCustom
                    ? "Pick or upload a texture"
                    : `Wrap ${target.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({ testid, label, value, onChange, min = 0, step = 1 }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
      <input
        data-testid={testid}
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n >= min) onChange(n);
        }}
        className="h-7 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-slate-200"
      />
    </div>
  );
}

// iter-105.13 — Per-face picker. 6 face tiles laid out in a cube-net
// shape (cross / unfolded) so the user gets a spatial sense of which
// slot is which face. Each tile shows the picked texture's thumbnail
// or a "+" placeholder. Click a tile to open a small inline source
// browser (built-in patterns + custom textures + "leave flat") and
// pick what to put there.
const _PERFACE_LAYOUT = [
  // grid (col, row) positions for the cube-net cross — 4 wide, 3 tall
  // .  .  +z .       ← top
  // -x -y +x +y      ← side ring
  // .  .  -z .       ← bottom
  { id: "+z", col: 2, row: 0, label: "Top" },
  { id: "-x", col: 0, row: 1, label: "Left" },
  { id: "-y", col: 1, row: 1, label: "Front" },
  { id: "+x", col: 2, row: 1, label: "Right" },
  { id: "+y", col: 3, row: 1, label: "Back" },
  { id: "-z", col: 2, row: 2, label: "Bottom" },
];

function PerFacePicker({
  faceSources, patternThumbs, customTextures,
  editingFace, onEditFace, onPickSource, onClearFace,
}) {
  return (
    <div className="rounded border border-slate-700 bg-slate-950 p-2.5 space-y-2.5">
      <div className="text-[10px] text-slate-500 leading-tight">
        Click any face to pick its texture. Empty faces stay flat. Image-source &amp; relief settings
        (height, fit, invert) are shared across all faces — pick them in the panels below.
      </div>
      <div className="grid grid-cols-4 grid-rows-3 gap-1.5 mx-auto" style={{ width: 280 }}>
        {_PERFACE_LAYOUT.map((f) => {
          const src = faceSources[f.id];
          const isEditing = editingFace === f.id;
          let thumb = null, label = "Empty";
          if (src) {
            if (src.kind === "builtin") {
              thumb = patternThumbs[src.id] || null;
              label = src.id;
            } else {
              const tex = customTextures.find((t) => t.texture_id === src.id);
              if (tex) { thumb = tex.thumb_b64; label = tex.name; }
            }
          }
          return (
            <button
              key={f.id}
              data-testid={`texture-perface-slot-${f.id}`}
              onClick={() => onEditFace(isEditing ? null : f.id)}
              style={{ gridColumn: f.col + 1, gridRow: f.row + 1 }}
              className={`relative aspect-square rounded border transition-all overflow-hidden ${
                isEditing
                  ? "border-orange-500 ring-2 ring-orange-500/40"
                  : src
                    ? "border-orange-500/50"
                    : "border-dashed border-slate-700 hover:border-slate-500"
              }`}
              title={`${f.label} (${f.id}) — ${src ? label : "click to pick"}`}
            >
              {thumb ? (
                <img src={thumb} alt={label} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-xl">+</div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-slate-950/85 text-[9px] uppercase tracking-wider text-slate-300 text-center py-0.5">
                {f.id}
              </div>
              {src && (
                <span
                  data-testid={`texture-perface-clear-${f.id}`}
                  onClick={(e) => { e.stopPropagation(); onClearFace(f.id); }}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded bg-slate-950/80 text-slate-400 hover:text-rose-400 flex items-center justify-center text-[10px]"
                >×</span>
              )}
            </button>
          );
        })}
      </div>
      {editingFace && (
        <PerFaceSourceBrowser
          face={editingFace}
          patternThumbs={patternThumbs}
          customTextures={customTextures}
          onPick={(src) => onPickSource(editingFace, src)}
          onClose={() => onEditFace(null)}
        />
      )}
    </div>
  );
}

function PerFaceSourceBrowser({ face, patternThumbs, customTextures, onPick, onClose }) {
  const faceLabel = _PERFACE_LAYOUT.find((f) => f.id === face)?.label || face;
  return (
    <div className="mt-1 rounded border border-orange-500/40 bg-slate-900 p-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-orange-300 font-semibold">
          Pick texture for {faceLabel} face ({face})
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 text-[11px]">close</button>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Built-in patterns</div>
        <div className="grid grid-cols-5 gap-1">
          {Object.keys(patternThumbs).slice(0, 10).map((pid) => (
            <button
              key={pid}
              data-testid={`texture-perface-pick-builtin-${face}-${pid}`}
              onClick={() => onPick({ kind: "builtin", id: pid })}
              className="aspect-square rounded border border-slate-700 hover:border-orange-500 overflow-hidden"
              title={pid}
            >
              <img src={patternThumbs[pid]} alt={pid} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      </div>
      {customTextures.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">My textures</div>
          <div className="grid grid-cols-5 gap-1">
            {customTextures.map((t) => (
              <button
                key={t.texture_id}
                data-testid={`texture-perface-pick-custom-${face}-${t.texture_id}`}
                onClick={() => onPick({ kind: "custom", id: t.texture_id })}
                className="aspect-square rounded border border-slate-700 hover:border-orange-500 overflow-hidden"
                title={t.name}
              >
                <img src={t.thumb_b64} alt={t.name} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

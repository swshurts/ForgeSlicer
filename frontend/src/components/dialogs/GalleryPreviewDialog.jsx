// iter-100.3 — Gallery STL preview modal.
//
// Click any gallery card image (or its Remix button) and this dialog
// opens a lightweight three.js viewer over the gallery. Mirrors the
// design-mode viewport's look (slate background, orange material,
// orbit controls, build-plate grid) without dragging in the full
// scene store / selection / measure / cut-plane machinery — wrong
// abstraction for a read-only preview.
//
// Footer presents the two import paths so the user picks at IMPORT
// TIME (not at click-time):
//   1. "Replace plate" — current behaviour (`/workspace?remix=<id>`).
//   2. "Add to current plate" — NEW. Reuses the existing
//      `forgeslicer.addComponent` sessionStorage handoff that already
//      merges multi-object project JSON into the active scene. We
//      tag the payload with `kind: "design"` so the workspace import
//      banner reads naturally ("Added design X — 12 objects" rather
//      than "Added design X (positive)").
//
// react/no-unknown-property is the standard noise on every r3f file —
// `castShadow`, `intensity`, etc. are three.js scene-graph props that
// r3f maps onto JSX, not HTML attributes. The Viewport.jsx file
// passes lint via project-level config when scanned as part of the
// dir, but standalone single-file lint runs trip this rule.
/* eslint-disable react/no-unknown-property */

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  X, GitFork, Layers, Loader2, AlertTriangle, Ruler,
} from "lucide-react";
import { galleryApi } from "../../lib/api";

// Match the design viewport's positive-body colour (#F97316) so the
// preview reads as "this is what you'd see in the workspace". Bed
// grid / background also pulled from the viewport's slate palette.
const POSITIVE_COLOR = "#F97316";
const BG_COLOR = "#0F172A"; // slate-900-ish, matches viewport
const GRID_COLOR_MAJOR = "#475569";
const GRID_COLOR_MINOR = "#334155";

function PreviewMesh({ geometry }) {
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={POSITIVE_COLOR}
        metalness={0.15}
        roughness={0.55}
        flatShading={false}
      />
    </mesh>
  );
}

// Parse STL bytes into a Three.js geometry centred on its footprint,
// dropped to Y=0, and rotated Z-up→Y-up to match the viewport.
function buildGeometryFromSTLBuffer(buf) {
  const loader = new STLLoader();
  const geom = loader.parse(buf);
  // STL is always Z-up; rotate -90° around X to match three.js Y-up.
  geom.rotateX(-Math.PI / 2);
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  // Centre on the footprint (X/Z) and rest the lowest point on Y=0.
  geom.translate(
    -(bb.min.x + bb.max.x) / 2,
    -bb.min.y,
    -(bb.min.z + bb.max.z) / 2,
  );
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}

export default function GalleryPreviewDialog({ item, open, onClose }) {
  const navigate = useNavigate();
  const [geometry, setGeometry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Bbox after centring/dropping — drives the camera framing and the
  // dimensions chip in the footer.
  const [bbox, setBbox] = useState(null);
  // Stash the full record once we've fetched it; both import buttons
  // pull from this so we don't double-fetch.
  const fullRecRef = useRef(null);

  // Reset state every time a new item is opened. Without this, opening
  // a SECOND item flashes the first item's mesh for one frame.
  useEffect(() => {
    if (!open || !item) {
      setGeometry(null);
      setError("");
      fullRecRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setGeometry(null);
    (async () => {
      try {
        // Fire metadata + STL bytes in parallel — neither depends on
        // the other for the preview render. Metadata gives us the
        // project JSON for the "Add to current plate" path; STL is
        // what the canvas actually displays.
        const [rec, stlRes] = await Promise.all([
          galleryApi.get(item.id),
          fetch(galleryApi.downloadUrl(item.id)),
        ]);
        if (cancelled) return;
        if (!stlRes.ok) throw new Error(`STL fetch failed (${stlRes.status})`);
        const buf = await stlRes.arrayBuffer();
        if (cancelled) return;
        const geom = buildGeometryFromSTLBuffer(buf);
        fullRecRef.current = rec;
        const bb = geom.boundingBox;
        setBbox({
          x: +(bb.max.x - bb.min.x).toFixed(1),
          y: +(bb.max.y - bb.min.y).toFixed(1),
          z: +(bb.max.z - bb.min.z).toFixed(1),
        });
        setGeometry(geom);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, item]);

  // ESC closes — small ergonomic touch users expect from any modal.
  // iter-100.4 also wires up R = Replace plate, A = Add to current
  // plate. Letters are intentionally non-modifier so they feel like
  // "press to choose"; we suppress them while the dialog is loading
  // or in error state because the visual CTAs are disabled in those
  // states too — keystrokes shouldn't bypass that gate.
  useEffect(() => {
    if (!open || !item) return undefined;
    const onKey = (e) => {
      // Ignore shortcuts when the user is typing somewhere (defence
      // in depth — the dialog has no inputs today, but it's cheap
      // to be correct in case one's added later).
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { onClose(); return; }
      if (loading || error) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); handleReplace(); }
      else if (e.key === "a" || e.key === "A") { e.preventDefault(); handleAddToPlate(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, item, onClose, loading, error]);

  if (!open || !item) return null;

  const handleReplace = () => {
    // Existing behaviour — Workspace handles the wipe + load itself.
    onClose();
    navigate(`/workspace?remix=${item.id}`);
  };

  const handleAddToPlate = async () => {
    // Reuse the addComponent handoff. The workspace consumer already
    // handles multi-object project JSON, group remapping, drop-to-
    // bed, and STL fallback. We mark `kind: "design"` so the import
    // banner can read "Added design …" instead of "Added component
    // (positive)".
    try {
      // We may already have the full record from the preview load.
      const rec = fullRecRef.current || (await galleryApi.get(item.id));
      const payload = {
        kind: "design",
        name: rec.name || item.name || "Design",
        project_json: typeof rec.data === "string"
          ? rec.data
          : (rec.data ? JSON.stringify(rec.data) : null),
        stl_base64: null, // unused — workspace will refetch if needed
      };
      // If we have no project JSON, fall through to base64-encoded STL
      // so the workspace can still merge SOMETHING into the scene.
      if (!payload.project_json) {
        const stlRes = await fetch(galleryApi.downloadUrl(item.id));
        const buf = await stlRes.arrayBuffer();
        // Convert to base64 — chunked to avoid call-stack blowups on
        // large meshes (apply() argument length ceilings).
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        let bin = "";
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        payload.stl_base64 = btoa(bin);
      }
      sessionStorage.setItem("forgeslicer.addComponent", JSON.stringify(payload));
      onClose();
      navigate("/workspace?addComponent=1");
    } catch (e) {
      setError(`Couldn't prepare for import: ${e.message || e}`);
    }
  };

  return (
    <div
      data-testid="gallery-preview-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="min-w-0">
            <h2
              className="text-base font-bold text-white truncate"
              title={item.name}
              data-testid="gallery-preview-name"
            >
              {item.name}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              by {item.author} · {item.triangle_count?.toLocaleString()} △
            </p>
          </div>
          <button
            data-testid="gallery-preview-close"
            onClick={onClose}
            className="h-8 w-8 rounded hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Canvas */}
        <div
          className="relative bg-slate-950 h-[440px]"
          data-testid="gallery-preview-canvas-wrap"
        >
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm gap-2 z-10" data-testid="gallery-preview-loading">
              <Loader2 size={14} className="animate-spin" /> Loading preview…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-red-300 text-xs gap-2 z-10 px-6 text-center" data-testid="gallery-preview-error">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {/*
            Camera: orthographic feels OrcaSlicer-ish but most users
            recognise perspective from the design viewport, so we
            keep perspective + a generous initial framing distance
            derived from the bbox once it's known.
          */}
          <Canvas
            shadows
            camera={{ position: [120, 100, 140], fov: 38, near: 0.1, far: 2000 }}
            style={{ background: BG_COLOR }}
            dpr={[1, 1.75]}
          >
            <ambientLight intensity={0.55} />
            <directionalLight
              position={[80, 140, 60]}
              intensity={0.85}
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
            />
            <directionalLight position={[-60, 50, -80]} intensity={0.25} />
            {/* Build-plate grid — mimics the design viewport's plate
                so users orient instantly. 250 mm × 250 mm reads as
                a generic bed; the actual print-fit chip on the card
                already tells them whether THEIR bed fits this item. */}
            <Grid
              args={[250, 250]}
              cellSize={10}
              cellThickness={0.5}
              cellColor={GRID_COLOR_MINOR}
              sectionSize={50}
              sectionThickness={1}
              sectionColor={GRID_COLOR_MAJOR}
              fadeDistance={400}
              fadeStrength={1.2}
              infiniteGrid={false}
              position={[0, 0, 0]}
            />
            <PreviewMesh geometry={geometry} />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              minDistance={20}
              maxDistance={800}
              target={[0, geometry?.boundingBox ? (geometry.boundingBox.max.y / 2) : 20, 0]}
            />
          </Canvas>
        </div>

        {/* Footer — meta chips + the two import CTAs */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 bg-slate-900/80 flex-wrap">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {bbox && (
              <span
                data-testid="gallery-preview-bbox"
                className="inline-flex items-center gap-1 font-mono"
                title="Bounding box (mm)"
              >
                <Ruler size={11} className="text-slate-500" />
                {bbox.x} × {bbox.y} × {bbox.z} mm
              </span>
            )}
            {item.material && item.material !== "any" && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">
                <Layers size={11} /> {item.material}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="gallery-preview-add-to-plate"
              onClick={handleAddToPlate}
              disabled={loading || !!error}
              title="Add this design to your existing build plate without losing your current work (A)"
              className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded inline-flex items-center gap-1.5 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Layers size={13} /> Add to current plate
              <kbd className="ml-1 px-1 py-px text-[9px] font-mono rounded border border-slate-600 bg-slate-900/80 text-slate-400" aria-hidden="true">A</kbd>
            </button>
            <button
              data-testid="gallery-preview-replace-plate"
              onClick={handleReplace}
              disabled={loading || !!error}
              title="Wipe the current build plate and load this design (R)"
              className="h-9 px-3 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <GitFork size={13} /> Customize in ForgeSlicer
              <kbd className="ml-1 px-1 py-px text-[9px] font-mono rounded border border-orange-300/40 bg-orange-600/70 text-orange-50" aria-hidden="true">R</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Three is imported for side-effect typing — keep the reference alive
// for tree-shaking so PreviewMesh's geometry type is preserved.
void THREE;

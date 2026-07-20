/**
 * BoxDesignerDialog — parametric box designer (PDF §4b).
 *
 * Left column: form knobs (Width/Depth/Height, wall/floor, corner
 * radius, lid mode, compartments, label recess, side handles,
 * stackable lip, clearance).
 *
 * Right column: live 3D preview of the assembled box + lid. Rebuilds
 * on parameter change with a small debounce so slider drags don't
 * saturate manifold-3d.
 *
 * Footer: 4 export actions (Add to workspace / Download Box / Download
 * Lid / Download ZIP). ZIP bundles both STLs + a `README.txt` with the
 * chosen parameters so the user can reproduce the build later.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import JSZip from "jszip";
import { toast } from "sonner";
import { X, Download, Loader2, Package, Plus, Archive } from "lucide-react";
import { buildBoxAssembly } from "../../lib/boxGenerator";
import { geometryToSTLBinary } from "../../lib/exporters";
import { useScene } from "../../lib/store";
import { downloadBlob } from "../../lib/exporters";

const DEFAULTS = {
  width: 60, depth: 40, height: 30,
  wall: 2, floor: 2, corner: 3,
  lid: "drop",
  lidThickness: 2,
  compartmentsX: 1, compartmentsY: 1,
  clearance: 0.25,
  stackable: false, sideHandles: false, labelRecess: false,
  labelDepth: 1.2,
};

const LID_MODES = [
  { id: "none",     label: "Open (no lid)" },
  { id: "drop",     label: "Drop-on lid" },
  { id: "sliding",  label: "Sliding lid" },
  { id: "hinged",   label: "Hinged lid" },
  { id: "friction", label: "Friction fit" },
];

// ---- Small labelled numeric input ----
function NumField({ label, value, onChange, step = 1, min, max, suffix = "mm", testid, hint }) {
  return (
    <label className="flex flex-col gap-0.5" data-testid={testid}>
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-7 flex-1 min-w-0 px-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
        />
        <span className="text-[10px] text-slate-500 w-6">{suffix}</span>
      </div>
      {hint && <span className="text-[9px] text-slate-500 leading-tight">{hint}</span>}
    </label>
  );
}

function CheckField({ label, value, onChange, testid, hint }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" data-testid={testid}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-3.5 h-3.5 accent-sky-500"
      />
      <span className="flex-1">
        <span className="text-[11px] text-slate-200 block">{label}</span>
        {hint && <span className="text-[9.5px] text-slate-500 leading-tight block">{hint}</span>}
      </span>
    </label>
  );
}

// ---- Preview scene ----
function PreviewMesh({ parts, showLid }) {
  return (
    <>
      {parts.map((p) => {
        if (!showLid && p.id === "lid") return null;
        // Offset the lid up in the preview so users see the two parts
        // separated (matches how the printed pieces fit together).
        const offset = p.id === "lid" && showLid ? 5 : 0;
        return (
          <mesh
            key={p.id}
            geometry={p.geometry}
            position={[0, 0, offset]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={p.color}
              roughness={0.55}
              metalness={0.08}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </>
  );
}

export default function BoxDesignerDialog({ open, onClose }) {
  const [params, setParams] = useState(DEFAULTS);
  const [parts, setParts] = useState([]);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [showLidInPreview, setShowLidInPreview] = useState(true);
  const [downloading, setDownloading] = useState(null);   // "box" | "lid" | "zip" | null
  const debounceRef = useRef(null);
  const buildTokenRef = useRef(0);
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const projectName = useScene((s) => s.projectName);

  const update = (k, v) => setParams((p) => ({ ...p, [k]: v }));

  // Build parts whenever `params` changes (debounced 220ms). Uses a
  // token so a rapid slider drag doesn't apply a stale build.
  const scheduleBuild = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const token = ++buildTokenRef.current;
      setBuilding(true);
      setBuildError("");
      try {
        const { parts: builtParts } = await buildBoxAssembly(params);
        if (token !== buildTokenRef.current) return;   // stale build
        setParts(builtParts);
      } catch (e) {
        if (token !== buildTokenRef.current) return;
        setBuildError(e.message || String(e));
        console.warn("[BoxDesigner] build failed:", e);
      } finally {
        if (token === buildTokenRef.current) setBuilding(false);
      }
    }, 220);
  }, [params]);

  useEffect(() => {
    if (!open) return;
    scheduleBuild();
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, scheduleBuild]);

  // ---- Export handlers ----

  const safeName = useMemo(() => {
    const base = (projectName || "box").replace(/[^a-z0-9-_]/gi, "_").slice(0, 40);
    return base || "box";
  }, [projectName]);

  const _download = (part, filename) => {
    const dv = geometryToSTLBinary(part.geometry);
    const blob = new Blob([dv], { type: "model/stl" });
    downloadBlob(blob, filename);
  };

  const handleDownloadPart = async (partId) => {
    const part = parts.find((p) => p.id === partId);
    if (!part) return;
    setDownloading(partId);
    try {
      _download(part, `${safeName}_${partId}.stl`);
      toast.success(`Downloaded ${part.label} (${part.bbox.x}×${part.bbox.y}×${part.bbox.z} mm)`);
    } catch (e) {
      toast.error(`Download failed: ${e.message || e}`);
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadZip = async () => {
    if (!parts.length) return;
    setDownloading("zip");
    try {
      const zip = new JSZip();
      for (const part of parts) {
        const dv = geometryToSTLBinary(part.geometry);
        // JSZip needs ArrayBuffer / Uint8Array / Blob — DataView is not
        // a supported input type and causes generateAsync to hang.
        const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        zip.file(`${safeName}_${part.id}.stl`, bytes);
      }
      // README with the params so the user can rebuild identically.
      const paramLines = Object.entries(params)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      zip.file("README.txt",
        `ForgeSlicer — Box Designer bundle\n` +
        `Generated: ${new Date().toISOString()}\n\n` +
        `Parameters used:\n${paramLines}\n\n` +
        `Parts:\n${parts.map((p) => `  - ${p.id}.stl — ${p.label} (${p.bbox.x}×${p.bbox.y}×${p.bbox.z} mm)`).join("\n")}\n`);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${safeName}_bundle.zip`);
      toast.success(`Downloaded ${parts.length}-part bundle`);
    } catch (e) {
      toast.error(`ZIP export failed: ${e.message || e}`);
    } finally {
      setDownloading(null);
    }
  };

  const handleAddToWorkspace = () => {
    if (!parts.length) return;
    let added = 0;
    for (const part of parts) {
      const pos = part.geometry.attributes.position.array;
      const idx = part.geometry.index?.array;
      const bb = part.geometry.boundingBox;
      const originalBbox = bb ? {
        x: bb.max.x - bb.min.x,
        y: bb.max.y - bb.min.y,
        z: bb.max.z - bb.min.z,
      } : null;
      addImportedMesh(
        `${part.label}`,
        pos instanceof Float32Array ? pos : new Float32Array(pos),
        idx ? (idx instanceof Uint32Array ? idx : new Uint32Array(idx)) : null,
        originalBbox,
      );
      added++;
    }
    toast.success(`Added ${added} part${added === 1 ? "" : "s"} to workspace`);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="box-designer-dialog">
      <div className="w-[min(1200px,96vw)] h-[min(760px,92vh)] bg-slate-950 border border-sky-500/40 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-12 px-4 flex items-center justify-between bg-slate-900 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-sky-400" />
            <span className="text-sky-400 font-bold tracking-wider uppercase text-xs">Box Designer</span>
            <span className="text-[10px] text-slate-500 font-mono">parametric assembly · live preview</span>
          </div>
          <button
            data-testid="box-designer-close"
            onClick={onClose}
            className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body: knobs + preview */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT — form */}
          <div className="w-80 flex-shrink-0 border-r border-slate-800 bg-slate-900/40 overflow-y-auto p-3 space-y-4">
            <section data-testid="box-designer-dims">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Outside dimensions</div>
              <div className="grid grid-cols-3 gap-2">
                <NumField testid="box-w" label="Width"  value={params.width}  onChange={(v) => update("width", v)}  step={1} min={20} />
                <NumField testid="box-d" label="Depth"  value={params.depth}  onChange={(v) => update("depth", v)}  step={1} min={20} />
                <NumField testid="box-h" label="Height" value={params.height} onChange={(v) => update("height", v)} step={1} min={15} />
              </div>
            </section>

            <section data-testid="box-designer-walls">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Wall + floor</div>
              <div className="grid grid-cols-3 gap-2">
                <NumField testid="box-wall"   label="Wall"   value={params.wall}   onChange={(v) => update("wall", v)}   step={0.2} min={0.8} />
                <NumField testid="box-floor"  label="Floor"  value={params.floor}  onChange={(v) => update("floor", v)}  step={0.2} min={0.8} />
                <NumField testid="box-corner" label="Corner" value={params.corner} onChange={(v) => update("corner", v)} step={0.5} min={0} />
              </div>
            </section>

            <section data-testid="box-designer-lid">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Lid</div>
              <select
                data-testid="box-lid-mode"
                value={params.lid}
                onChange={(e) => update("lid", e.target.value)}
                className="w-full h-7 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 px-1.5 focus:outline-none focus:border-sky-500"
              >
                {LID_MODES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              {params.lid !== "none" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <NumField testid="box-lid-thick" label="Lid thickness" value={params.lidThickness} onChange={(v) => update("lidThickness", v)} step={0.2} min={1} />
                  <NumField testid="box-clearance" label="Clearance" value={params.clearance} onChange={(v) => update("clearance", v)} step={0.05} min={0.1} max={0.6} suffix="mm" hint="Slip fit gap between parts" />
                </div>
              )}
            </section>

            <section data-testid="box-designer-compartments">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Compartments</div>
              <div className="grid grid-cols-2 gap-2">
                <NumField testid="box-cols" label="Columns" value={params.compartmentsX} onChange={(v) => update("compartmentsX", Math.round(v))} step={1} min={1} max={8} suffix="cells" />
                <NumField testid="box-rows" label="Rows"    value={params.compartmentsY} onChange={(v) => update("compartmentsY", Math.round(v))} step={1} min={1} max={8} suffix="cells" />
              </div>
              <p className="text-[9.5px] text-slate-500 mt-1 leading-tight">
                Internal dividers split the cavity into a grid. Leave at 1×1 for a single space.
              </p>
            </section>

            <section data-testid="box-designer-extras" className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Extras</div>
              <CheckField
                testid="box-stackable"
                label="Stackable lip"
                value={params.stackable}
                onChange={(v) => update("stackable", v)}
                hint="Nesting foot on lid — boxes stack cleanly"
              />
              <CheckField
                testid="box-side-handles"
                label="Side handles"
                value={params.sideHandles}
                onChange={(v) => update("sideHandles", v)}
                hint="Scoop into left + right walls for grip"
              />
              <CheckField
                testid="box-label-recess"
                label="Label recess (front face)"
                value={params.labelRecess}
                onChange={(v) => update("labelRecess", v)}
                hint="Sink a rectangular pad for a printed label"
              />
              {params.labelRecess && (
                <NumField testid="box-label-depth" label="Label depth" value={params.labelDepth} onChange={(v) => update("labelDepth", v)} step={0.2} min={0.4} max={3} />
              )}
            </section>
          </div>

          {/* RIGHT — preview */}
          <div className="flex-1 relative bg-slate-950">
            {building && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-[10px] text-sky-300 bg-slate-900/80 border border-sky-500/40 rounded px-2 py-1" data-testid="box-designer-busy">
                <Loader2 size={11} className="animate-spin" /> Rebuilding…
              </div>
            )}
            {buildError && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-md bg-red-500/10 border border-red-500/50 text-red-300 rounded-md px-3 py-2 text-[11px] leading-snug" data-testid="box-designer-error">
                <span className="font-semibold uppercase tracking-wider text-red-200">Build error</span> · {buildError}
              </div>
            )}
            {parts.length > 0 && parts.find((p) => p.id === "lid") && (
              <label className="absolute top-3 left-3 z-10 flex items-center gap-1.5 text-[10px] text-slate-300 bg-slate-900/80 border border-slate-700 rounded px-2 py-1 cursor-pointer" data-testid="box-designer-showlid">
                <input
                  type="checkbox"
                  checked={showLidInPreview}
                  onChange={(e) => setShowLidInPreview(e.target.checked)}
                  className="w-3 h-3 accent-cyan-500"
                />
                Show lid
              </label>
            )}
            <Canvas
              shadows
              // Z-up to match the workspace + STL preview.
              camera={{ position: [90, -120, 70], up: [0, 0, 1], fov: 45, near: 1, far: 1000 }}
              onCreated={({ camera }) => {
                camera.up.set(0, 0, 1);
                camera.lookAt(0, 0, params.height / 2);
                camera.updateProjectionMatrix();
              }}
              dpr={[1, 1.5]}
              style={{ background: "#0F172A" }}
            >
              <ambientLight intensity={0.55} />
              <directionalLight position={[80, -50, 120]} intensity={0.7} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
              <directionalLight position={[-80, 60, 50]} intensity={0.22} />
              <Grid
                rotation={[Math.PI / 2, 0, 0]}
                args={[220, 220]}
                cellSize={10}
                cellThickness={0.5}
                cellColor="#334155"
                sectionSize={50}
                sectionThickness={1}
                sectionColor="#0EA5E9"
                fadeDistance={400}
                infiniteGrid
              />
              {parts.length > 0 && <PreviewMesh parts={parts} showLid={showLidInPreview} />}
              <OrbitControls makeDefault enablePan enableZoom enableRotate target={[0, 0, params.height / 2]} />
              <GizmoHelper alignment="bottom-right" margin={[68, 68]}>
                <GizmoViewport axisColors={["#F97316", "#10B981", "#06B6D4"]} labelColor="white" />
              </GizmoHelper>
            </Canvas>
          </div>
        </div>

        {/* Footer — bbox chips + export actions */}
        <div className="h-16 border-t border-slate-800 bg-slate-900/60 px-4 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400 flex-wrap" data-testid="box-designer-bboxes">
            {parts.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
                <span className="text-slate-300 font-semibold">{p.label}</span>
                <span>{p.bbox.x}×{p.bbox.y}×{p.bbox.z} mm</span>
              </span>
            ))}
            {parts.length === 0 && !building && <span className="italic">No parts yet.</span>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              data-testid="box-designer-add-workspace"
              onClick={handleAddToWorkspace}
              disabled={parts.length === 0 || building}
              className="h-9 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              title="Import all parts into the current workspace as editable meshes"
            >
              <Plus size={12} /> Add to workspace
            </button>
            <button
              data-testid="box-designer-download-box"
              onClick={() => handleDownloadPart("box")}
              disabled={parts.length === 0 || building || downloading === "box"}
              className="h-9 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 flex items-center gap-1.5"
            >
              {downloading === "box" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Box
            </button>
            <button
              data-testid="box-designer-download-lid"
              onClick={() => handleDownloadPart("lid")}
              disabled={!parts.find((p) => p.id === "lid") || building || downloading === "lid"}
              className="h-9 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 flex items-center gap-1.5"
            >
              {downloading === "lid" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Lid
            </button>
            <button
              data-testid="box-designer-download-zip"
              onClick={handleDownloadZip}
              disabled={parts.length === 0 || building || downloading === "zip"}
              className="h-9 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-sky-500 hover:bg-sky-400 text-slate-950 disabled:opacity-40 flex items-center gap-1.5"
            >
              {downloading === "zip" ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />} ZIP bundle
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

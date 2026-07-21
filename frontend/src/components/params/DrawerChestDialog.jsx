/**
 * DrawerChestDialog — parametric chest-of-drawers designer (PDF §4c).
 *
 * Same architectural pattern as BoxDesignerDialog: left column is the
 * form, right column is a live 3D preview of the ASSEMBLED chest (frame +
 * drawers inside + optional cap on top). Debounced builds so slider
 * drags don't saturate manifold-3d.
 *
 * Footer: Add-to-workspace / individual STL downloads / ZIP bundle.
 * The ZIP contains the frame, every drawer, the cap (if enabled), and
 * a README with the exact parameter set.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import JSZip from "jszip";
import { toast } from "sonner";
import { X, Download, Loader2, Layers, Plus, Archive } from "lucide-react";
import { generateDrawerChest } from "../../lib/drawerChestGenerator";
import { geometryToSTLBinary, downloadBlob } from "../../lib/exporters";
import { useScene } from "../../lib/store";

const DEFAULTS = {
  width: 80, depth: 60, height: 100,
  wall: 3,
  rows: 3,
  drawerWall: 2,
  clearance: 0.4,
  handleStyle: "square-knob",
  handleSize: 15,
  feet: true,
  footHeight: 8,
  footInset: 4,
  topCap: true,
  capThickness: 4,
  capOverhang: 3,
  glideNubs: true,
  biscuitJoints: false,
  cornerR: 1.5,
  // iter-151.2 — per-drawer heights + hinged-lid top compartment.
  customHeights: false,        // toggle: use per-slot heights vs equal split
  drawerHeights: [],           // mm, length ≤ rows; LAST slot auto-fills leftover
  topHingedBox: false,         // top row is chest-style hinged-lid box
  gridfinityLocators: false,   // + crosses on each drawer floor at 42 mm grid (Gridfinity-compatible)
  gridfinityBaseplate: false,  // full Gridfinity pocket profile carved into each drawer floor
  subdivider: "none",          // "none" | "1x2" | "2x1" | "2x2" | "1x3" | "3x1" | "2x3" | "3x2" | "3x3"
};

// Preset chests — starter configs the user can pick + then tweak.
// The first entry is the "no preset / defaults" sentinel.
const PRESETS = [
  { id: "default", label: "Default (start here)", params: DEFAULTS },
  {
    id: "small-tray",
    label: "Small tool tray (2 shallow drawers)",
    params: {
      ...DEFAULTS, width: 120, depth: 80, height: 60, rows: 2,
      handleStyle: "square-knob", handleSize: 12, feet: false, topCap: false,
    },
  },
  {
    id: "desk-organizer",
    label: "Desk organizer (3 rows, arched pulls)",
    params: {
      ...DEFAULTS, width: 180, depth: 120, height: 120, rows: 3,
      handleStyle: "arched-pull", handleSize: 18, biscuitJoints: true,
    },
  },
  {
    id: "jewelry-chest",
    label: "Jewelry chest (hinged top + 3 shallow drawers)",
    params: {
      ...DEFAULTS, width: 200, depth: 140, height: 160, rows: 4,
      handleStyle: "square-knob", handleSize: 12,
      topHingedBox: true, topCap: false,
      customHeights: true, drawerHeights: [0, 22, 22, 30],   // bottom auto, then 22, 22, top hinged 30
    },
  },
  {
    id: "gridfinity-6u",
    label: "Gridfinity 3×2 (2 drawers, locators on)",
    params: {
      ...DEFAULTS, width: 140, depth: 100, height: 80, rows: 2,
      handleStyle: "arched-pull", handleSize: 16,
      gridfinityLocators: true, feet: false, topCap: false,
    },
  },
  {
    id: "workshop",
    label: "Workshop chest (5 rows, biscuit joints)",
    params: {
      ...DEFAULTS, width: 260, depth: 180, height: 240, rows: 5,
      handleStyle: "square-pull", handleSize: 20,
      biscuitJoints: true, footHeight: 12, capOverhang: 5,
    },
  },
  {
    id: "bookcase-insert",
    label: "Bookcase insert (flat bottom, 4 rows)",
    params: {
      ...DEFAULTS, width: 300, depth: 200, height: 200, rows: 4,
      handleStyle: "square-pull", handleSize: 20,
      feet: false, footHeight: 0, topCap: false, biscuitJoints: true,
    },
  },
];

const HANDLE_STYLES = [
  { id: "square-knob",  label: "Square knob"  },
  { id: "arched-pull",  label: "Arched pull"  },
  { id: "square-pull",  label: "Square pull"  },
  { id: "none",         label: "None"         },
];

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

// ---- Assembled preview ----
function PreviewMesh({ parts, showDrawers, drawerOpen, chestDepth }) {
  return (
    <>
      {parts.map((p) => {
        if (!showDrawers && p.id.startsWith("drawer-")) return null;
        const [ax, ay, az] = p.assembledPos || [0, 0, 0];
        const isLid = p.id === "hinged-lid";
        // Drawers: pull out by 8 mm when "open" toggled.
        const yOffset = p.id.startsWith("drawer-") && drawerOpen ? 8 : 0;
        // Hinged lid: rotate around back-edge pivot for the "open" view.
        if (isLid && drawerOpen && chestDepth != null) {
          const hingeY = ay + chestDepth / 2;
          return (
            <group key={p.id} position={[ax, hingeY, az]} rotation={[-0.9, 0, 0]}>
              <mesh
                geometry={p.geometry}
                position={[0, -chestDepth / 2, 0]}
                castShadow
                receiveShadow
              >
                <meshStandardMaterial color={p.color} roughness={0.55} metalness={0.08} side={THREE.DoubleSide} />
              </mesh>
            </group>
          );
        }
        return (
          <mesh
            key={p.id}
            geometry={p.geometry}
            position={[ax, ay + yOffset, az]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={p.color} roughness={0.55} metalness={0.08} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </>
  );
}

export default function DrawerChestDialog({ open, onClose }) {
  const [params, setParams] = useState(DEFAULTS);
  const [preset, setPreset] = useState("default");
  const applyPreset = (id) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p) setParams({ ...DEFAULTS, ...p.params });
  };
  const [parts, setParts] = useState([]);
  const [buildInfo, setBuildInfo] = useState(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [showDrawers, setShowDrawers] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const debounceRef = useRef(null);
  const buildTokenRef = useRef(0);
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const projectName = useScene((s) => s.projectName);

  const update = (k, v) => setParams((p) => ({ ...p, [k]: v }));

  const scheduleBuild = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const token = ++buildTokenRef.current;
      setBuilding(true);
      setBuildError("");
      try {
        const { parts: builtParts, info } = await generateDrawerChest({
          ...params,
          // Only pass drawerHeights when customHeights is on; otherwise
          // send undefined so the generator falls back to equal split.
          drawerHeights: params.customHeights ? params.drawerHeights : undefined,
        });
        if (token !== buildTokenRef.current) return;
        setParts(builtParts);
        setBuildInfo(info);
      } catch (e) {
        if (token !== buildTokenRef.current) return;
        setBuildError(e.message || String(e));
        console.warn("[DrawerChest] build failed:", e);
      } finally {
        if (token === buildTokenRef.current) setBuilding(false);
      }
    }, 260);
  }, [params]);

  useEffect(() => {
    if (!open) return;
    scheduleBuild();
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, scheduleBuild]);

  const safeName = useMemo(() => {
    const base = (projectName || "chest").replace(/[^a-z0-9-_]/gi, "_").slice(0, 40);
    return base || "chest";
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
        const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        zip.file(`${safeName}_${part.id}.stl`, bytes);
      }
      const paramLines = Object.entries(params).map(([k, v]) => `${k}: ${v}`).join("\n");
      zip.file("README.txt",
        `ForgeSlicer — Drawer Chest bundle\n` +
        `Generated: ${new Date().toISOString()}\n\n` +
        `Parameters:\n${paramLines}\n\n` +
        `Parts:\n${parts.map((p) => `  - ${p.id}.stl — ${p.label} (${p.bbox.x}×${p.bbox.y}×${p.bbox.z} mm)`).join("\n")}\n\n` +
        `Assembly tips:\n` +
        `  1. Print the frame with the open front facing UP for best bridging.\n` +
        `  2. Each drawer prints flat with the front face DOWN — no supports needed.\n` +
        `  3. If drawers bind, sand the sides lightly or bump 'Clearance' 0.1 mm in the designer and reprint.\n` +
        `  4. The cap slots on top of the frame — no glue needed.\n`);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${safeName}_chest_bundle.zip`);
      toast.success(`Downloaded ${parts.length}-part chest bundle`);
    } catch (e) {
      toast.error(`ZIP export failed: ${e.message || e}`);
    } finally {
      setDownloading(null);
    }
  };

  const handleAddToWorkspace = () => {
    if (!parts.length) return;
    let added = 0;
    // Same overlap-avoiding pattern as BoxDesigner (iter-150.6): lay
    // parts out along +X with a fixed padding so any subsequent
    // export-path union doesn't try to fuse interlocking geometry.
    let cursorX = 0;
    const padding = 10;
    const firstBox = parts[0]?.geometry?.boundingBox;
    if (firstBox) cursorX = -(firstBox.max.x + firstBox.min.x) / 2;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const pos = part.geometry.attributes.position.array;
      const idx = part.geometry.index?.array;
      const bb = part.geometry.boundingBox;
      const originalBbox = bb ? {
        x: bb.max.x - bb.min.x,
        y: bb.max.y - bb.min.y,
        z: bb.max.z - bb.min.z,
      } : null;
      const id = addImportedMesh(
        `${part.label}`,
        pos instanceof Float32Array ? pos : new Float32Array(pos),
        idx ? (idx instanceof Uint32Array ? idx : new Uint32Array(idx)) : null,
        originalBbox,
      );
      if (bb && id) {
        const partW = bb.max.x - bb.min.x;
        const partCentreX = (bb.max.x + bb.min.x) / 2;
        const targetCentreX = cursorX + partW / 2;
        useScene.setState((s) => ({
          objects: s.objects.map((o) =>
            o.id === id
              ? { ...o, position: [o.position[0] + (targetCentreX - partCentreX), o.position[1], o.position[2]] }
              : o
          ),
        }));
        cursorX += partW + padding;
      }
      added++;
    }
    toast.success(`Added ${added} part${added === 1 ? "" : "s"} to workspace`);
    onClose();
  };

  if (!open) return null;

  const hasCap = !!parts.find((p) => p.id === "cap");
  const hasHingedLid = !!parts.find((p) => p.id === "hinged-lid");
  const drawerCount = parts.filter((p) => p.id.startsWith("drawer-")).length;

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="drawer-chest-dialog">
      <div className="w-[min(1200px,96vw)] h-[min(760px,92vh)] bg-slate-950 border border-sky-500/40 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between bg-slate-900 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-sky-400" />
            <span className="text-sky-400 font-bold tracking-wider uppercase text-xs">Drawer Chest</span>
            <span className="text-[10px] text-slate-500 font-mono">parametric assembly · live preview</span>
          </div>
          <button
            data-testid="drawer-chest-close"
            onClick={onClose}
            className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* LEFT — form */}
          <div className="w-80 flex-shrink-0 border-r border-slate-800 bg-slate-900/40 overflow-y-auto p-3 space-y-4">
            <section data-testid="chest-preset">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Preset</div>
              <select
                data-testid="chest-preset-select"
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
                className="w-full h-8 px-2 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <div className="text-[9.5px] text-slate-500 leading-tight mt-1">
                Load a starter and tweak from there — every setting stays editable.
              </div>
            </section>

            <section data-testid="chest-dims">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Outside dimensions</div>
              <div className="grid grid-cols-3 gap-2">
                <NumField testid="chest-w" label="Width"  value={params.width}  onChange={(v) => update("width", v)}  step={1} min={30} />
                <NumField testid="chest-d" label="Depth"  value={params.depth}  onChange={(v) => update("depth", v)}  step={1} min={30} />
                <NumField testid="chest-h" label="Height" value={params.height} onChange={(v) => update("height", v)} step={1} min={40} />
              </div>
            </section>

            <section data-testid="chest-frame">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Frame</div>
              <div className="grid grid-cols-2 gap-2">
                <NumField testid="chest-wall"    label="Wall"       value={params.wall}     onChange={(v) => update("wall", v)}     step={0.5} min={1.5} max={8} />
                <NumField testid="chest-corner"  label="Corner R"   value={params.cornerR}  onChange={(v) => update("cornerR", v)}  step={0.5} min={0} max={8} />
              </div>
            </section>

            <section data-testid="chest-drawers">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Drawers</div>
              <div className="grid grid-cols-3 gap-2">
                <NumField testid="chest-rows"        label="Rows"       value={params.rows}       onChange={(v) => update("rows", Math.max(1, Math.min(10, Math.round(v))))} step={1} min={1} max={10} suffix="" />
                <NumField testid="chest-drawerwall" label="Drawer wall" value={params.drawerWall} onChange={(v) => update("drawerWall", v)} step={0.2} min={1.2} max={5} />
                <NumField testid="chest-clearance"  label="Clearance"  value={params.clearance}  onChange={(v) => update("clearance", v)}  step={0.05} min={0.2} max={1.2} />
              </div>
              <div className="mt-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium block mb-1">Handle</span>
                <div className="flex gap-1">
                  {HANDLE_STYLES.map((h) => (
                    <button
                      key={h.id}
                      data-testid={`chest-handle-${h.id}`}
                      onClick={() => update("handleStyle", h.id)}
                      className={`flex-1 h-7 rounded text-[10px] font-medium border ${
                        params.handleStyle === h.id
                          ? "border-sky-500 text-sky-300 bg-sky-500/10"
                          : "border-slate-700 text-slate-400 hover:border-sky-500/70 hover:text-sky-300"
                      }`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
                {params.handleStyle !== "none" && (
                  <div className="mt-2">
                    <NumField testid="chest-handlesize" label="Handle size" value={params.handleSize} onChange={(v) => update("handleSize", v)} step={1} min={6} max={40} />
                  </div>
                )}
              </div>
              <div className="mt-2">
                <CheckField
                  testid="chest-glidenubs"
                  label="Glide nubs on drawer bottom"
                  value={params.glideNubs}
                  onChange={(v) => update("glideNubs", v)}
                  hint="Four low-profile hemispheres on the drawer's underside so it slides on 4 points instead of a full face"
                />
              </div>
              <div className="mt-2">
                <CheckField
                  testid="chest-gridfinity"
                  label="Gridfinity locators (42 mm)"
                  value={params.gridfinityLocators && !params.gridfinityBaseplate}
                  onChange={(v) => {
                    update("gridfinityLocators", v);
                    if (v) update("gridfinityBaseplate", false);
                  }}
                  hint={<>Adds small + crosses on each drawer floor at the standard 42 mm intersections so Gridfinity bins snap into place. Grid is centred on X and aligned to the drawer front on Y. <a href="https://gridfinity.xyz" target="_blank" rel="noreferrer" className="text-sky-400 underline">Gridfinity by Zack Freedman</a> is CC-BY-SA 4.0.</>}
                />
              </div>
              <div className="mt-2">
                <CheckField
                  testid="chest-gridfinity-baseplate"
                  label="Gridfinity FULL baseplate profile"
                  value={params.gridfinityBaseplate}
                  onChange={(v) => {
                    update("gridfinityBaseplate", v);
                    if (v) update("gridfinityLocators", false);
                  }}
                  hint="Carves the exact Gridfinity pocket profile (top-rim, chamfer, bottom pocket, 3.75 mm deep) into each drawer floor for a snug bin fit. Drawer floor auto-thickens to 5 mm when enabled."
                />
              </div>
              <div className="mt-2">
                <label className="block" data-testid="chest-subdivider">
                  <span className="text-[11px] text-slate-200 block">Drawer sub-divider</span>
                  <select
                    data-testid="chest-subdivider-select"
                    value={params.subdivider}
                    onChange={(e) => update("subdivider", e.target.value)}
                    className="mt-1 w-full h-7 px-2 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                  >
                    <option value="none">None</option>
                    <option value="1x2">1 × 2 (front-to-back split)</option>
                    <option value="2x1">2 × 1 (side-to-side split)</option>
                    <option value="2x2">2 × 2 cubbies</option>
                    <option value="1x3">1 × 3 rows</option>
                    <option value="3x1">3 × 1 columns</option>
                    <option value="2x3">2 × 3 cubbies</option>
                    <option value="3x2">3 × 2 cubbies</option>
                    <option value="3x3">3 × 3 cubbies</option>
                  </select>
                  <span className="text-[9.5px] text-slate-500 leading-tight block mt-1">
                    Adds interior walls to split each drawer into a grid of smaller cubbies. Combines with Gridfinity.
                  </span>
                </label>
              </div>
              <div className="mt-2">
                <CheckField
                  testid="chest-hingedtop"
                  label="Top compartment is a hinged-lid box"
                  value={params.topHingedBox}
                  onChange={(v) => update("topHingedBox", v)}
                  hint="Topmost row becomes a chest-style top-opening compartment with a hinged lid (replaces the detachable cap)"
                />
              </div>
              <div className="mt-2">
                <CheckField
                  testid="chest-customheights"
                  label="Custom drawer heights"
                  value={params.customHeights}
                  onChange={(v) => update("customHeights", v)}
                  hint="Set each row's height individually — the bottom row auto-fills any leftover space"
                />
              </div>
              {params.customHeights && (
                <div className="pl-6 mt-2 space-y-1.5" data-testid="chest-heights-list">
                  <div className="text-[9.5px] text-slate-500 leading-tight">
                    Heights top → bottom. The <span className="text-sky-300 font-semibold">bottom row</span> auto-fills whatever&apos;s left.
                  </div>
                  {Array.from({ length: params.rows }).map((_, i) => {
                    const isLast = i === params.rows - 1;
                    const isHingedTop = params.topHingedBox && i === 0;
                    // UI order: top drawer first (idx 0 → topmost slot); generator uses bottom-first, so we index in reverse.
                    const generatorIndex = params.rows - 1 - i;
                    const val = params.drawerHeights[generatorIndex] ?? "";
                    const label = isHingedTop
                      ? `Top (hinged box)`
                      : isLast
                        ? `Bottom (auto)`
                        : `Row ${i + 1}`;
                    return (
                      <div key={i} className="flex items-center gap-2" data-testid={`chest-height-row-${i}`}>
                        <span className="text-[10px] text-slate-400 w-24 flex-shrink-0">{label}</span>
                        <input
                          type="number"
                          value={isLast ? "" : val}
                          disabled={isLast}
                          step={0.5}
                          min={10}
                          placeholder={isLast ? (buildInfo ? String((+buildInfo.slotHeights[0]).toFixed(1)) : "auto") : ""}
                          onChange={(e) => {
                            const heights = [...(params.drawerHeights || [])];
                            const parsed = parseFloat(e.target.value);
                            heights[generatorIndex] = Number.isFinite(parsed) ? parsed : 0;
                            update("drawerHeights", heights);
                          }}
                          className="h-7 w-20 px-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:outline-none focus:border-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          data-testid={`chest-height-input-${i}`}
                        />
                        <span className="text-[10px] text-slate-500">mm</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section data-testid="chest-extras">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Feet & cap</div>
              <CheckField
                testid="chest-feet"
                label="Integral feet"
                value={params.feet}
                onChange={(v) => update("feet", v)}
                hint="Four corner posts that lift the chest off the surface"
              />
              {params.feet && (
                <div className="pl-6 grid grid-cols-2 gap-2 mt-1.5">
                  <NumField testid="chest-footh" label="Feet height" value={params.footHeight} onChange={(v) => update("footHeight", v)} step={1} min={0} max={30} hint="Set to 0 to disable feet (flat bottom)" />
                  <NumField testid="chest-footinset" label="Foot inset" value={params.footInset} onChange={(v) => update("footInset", v)} step={0.5} min={0} max={12} />
                </div>
              )}
              <div className="mt-2">
                <CheckField
                  testid="chest-topcap"
                  label="Detachable top cap"
                  value={params.topCap && !params.topHingedBox}
                  onChange={(v) => update("topCap", v)}
                  hint={params.topHingedBox
                    ? "Disabled — the hinged lid replaces the cap on top compartment mode."
                    : "Overhanging slab that sits on top of the frame — print it in a contrasting colour"}
                />
              </div>
              {params.topCap && !params.topHingedBox && (
                <div className="pl-6 grid grid-cols-2 gap-2 mt-1.5">
                  <NumField testid="chest-capth" label="Cap thickness" value={params.capThickness} onChange={(v) => update("capThickness", v)} step={0.5} min={1.5} max={12} />
                  <NumField testid="chest-capover" label="Overhang" value={params.capOverhang} onChange={(v) => update("capOverhang", v)} step={0.5} min={0} max={15} />
                </div>
              )}
            </section>

            <section data-testid="chest-joinery">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">Joinery detail</div>
              <CheckField
                testid="chest-biscuits"
                label="Biscuit-joint pockets"
                value={params.biscuitJoints}
                onChange={(v) => update("biscuitJoints", v)}
                hint="Decorative half-elliptical pockets on the two front stiles suggesting mortise-and-biscuit joinery"
              />
            </section>
          </div>

          {/* RIGHT — preview */}
          <div className="flex-1 relative bg-slate-950">
            {building && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-[10px] text-sky-300 bg-slate-900/80 border border-sky-500/50 rounded px-2 py-1" data-testid="chest-building">
                <Loader2 size={11} className="animate-spin" /> Rebuilding…
              </div>
            )}
            {buildError && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-md bg-red-500/10 border border-red-500/50 text-red-300 rounded-md px-3 py-2 text-[11px] leading-snug" data-testid="chest-error">
                <span className="font-semibold uppercase tracking-wider text-red-200">Build error</span> · {buildError}
              </div>
            )}
            {parts.length > 0 && drawerCount > 0 && (
              <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 bg-slate-900/80 border border-slate-700 rounded px-2 py-1.5">
                <label className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer" data-testid="chest-showdrawers">
                  <input type="checkbox" checked={showDrawers} onChange={(e) => setShowDrawers(e.target.checked)} className="w-3 h-3 accent-cyan-500" />
                  Show drawers
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer" data-testid="chest-openview">
                  <input type="checkbox" checked={drawerOpen} onChange={(e) => setDrawerOpen(e.target.checked)} className="w-3 h-3 accent-cyan-500" />
                  Explode drawers 8 mm
                </label>
              </div>
            )}
            <Canvas
              shadows
              camera={{ position: [140, -180, 130], up: [0, 0, 1], fov: 45, near: 1, far: 1500 }}
              onCreated={({ camera }) => {
                camera.up.set(0, 0, 1);
                camera.lookAt(0, 0, params.height / 2);
                camera.updateProjectionMatrix();
              }}
              dpr={[1, 1.5]}
              style={{ background: "#0F172A" }}
            >
              <ambientLight intensity={0.55} />
              <directionalLight position={[120, -80, 200]} intensity={0.7} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
              <directionalLight position={[-120, 80, 80]} intensity={0.22} />
              <Grid
                rotation={[Math.PI / 2, 0, 0]}
                args={[320, 320]}
                cellSize={10}
                cellThickness={0.5}
                cellColor="#334155"
                sectionSize={50}
                sectionThickness={1}
                sectionColor="#0EA5E9"
                fadeDistance={520}
                infiniteGrid
              />
              {parts.length > 0 && <PreviewMesh parts={parts} showDrawers={showDrawers} drawerOpen={drawerOpen} chestDepth={params.depth} />}
              <OrbitControls makeDefault enablePan enableZoom enableRotate target={[0, 0, params.height / 2]} />
              <GizmoHelper alignment="bottom-right" margin={[68, 68]}>
                <GizmoViewport axisColors={["#F97316", "#10B981", "#06B6D4"]} labelColor="white" />
              </GizmoHelper>
            </Canvas>
          </div>
        </div>

        <div className="min-h-16 py-2 border-t border-slate-800 bg-slate-900/60 px-4 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400 flex-wrap" data-testid="chest-bboxes">
              {parts.map((p) => (
                <span key={p.id} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
                  <span className="text-slate-300 font-semibold">{p.label}</span>
                  <span>{p.bbox.x}×{p.bbox.y}×{p.bbox.z} mm</span>
                </span>
              ))}
              {parts.length === 0 && !building && <span className="italic">No parts yet.</span>}
            </div>
            {buildInfo && buildInfo.totalVolumeMm3 > 0 && (
              <div className="flex items-center gap-3 text-[10px] text-slate-400" data-testid="chest-estimate">
                {(() => {
                  // PLA density = 1.24 g/cm³ = 0.00124 g/mm³. Assume 15 % infill + shells → ~28 % effective material.
                  const solidCm3 = buildInfo.totalVolumeMm3 / 1000;
                  const gramsAt15 = (buildInfo.totalVolumeMm3 * 0.28 * 0.00124);
                  const gramsSolid = (buildInfo.totalVolumeMm3 * 0.00124);
                  // Print time: ~4.5 mm³/s effective throughput (moderate quality).
                  const materialMm3At15 = buildInfo.totalVolumeMm3 * 0.28;
                  const hoursAt15 = materialMm3At15 / 4.5 / 3600;
                  return (
                    <>
                      <span className="text-slate-500">Filament est.</span>
                      <span className="text-emerald-300 font-mono font-semibold">{gramsAt15.toFixed(0)} g</span>
                      <span className="text-slate-500 text-[9.5px]">/ {gramsSolid.toFixed(0)} g at 100 %</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-500">Print time est.</span>
                      <span className="text-emerald-300 font-mono font-semibold">{hoursAt15 >= 24 ? `${(hoursAt15/24).toFixed(1)} d` : `${hoursAt15.toFixed(1)} h`}</span>
                      <span className="text-slate-500 text-[9.5px]">at 15 % infill / 0.2 mm / PLA</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-500">Solid vol. {solidCm3.toFixed(1)} cm³</span>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              data-testid="chest-add-workspace"
              onClick={handleAddToWorkspace}
              disabled={parts.length === 0 || building}
              className="h-9 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 flex items-center gap-1.5"
              title="Import all chest parts into the workspace as editable meshes"
            >
              <Plus size={12} /> Add to workspace
            </button>
            <button
              data-testid="chest-download-frame"
              onClick={() => handleDownloadPart("frame")}
              disabled={parts.length === 0 || building || downloading === "frame"}
              className="h-9 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 flex items-center gap-1.5"
            >
              {downloading === "frame" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Frame
            </button>
            {hasCap && (
              <button
                data-testid="chest-download-cap"
                onClick={() => handleDownloadPart("cap")}
                disabled={building || downloading === "cap"}
                className="h-9 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {downloading === "cap" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Cap
              </button>
            )}
            {hasHingedLid && (
              <button
                data-testid="chest-download-hinged-lid"
                onClick={() => handleDownloadPart("hinged-lid")}
                disabled={building || downloading === "hinged-lid"}
                className="h-9 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {downloading === "hinged-lid" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Lid
              </button>
            )}
            <button
              data-testid="chest-download-zip"
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

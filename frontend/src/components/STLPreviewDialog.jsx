import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import { X, RefreshCw, Download } from "lucide-react";
import { exportSTLBytesAsync } from "../lib/workerClient";
import { downloadBlob } from "../lib/exporters";
import { useScene } from "../lib/store";

// Parse a binary STL into a BufferGeometry without going through file I/O —
// keeps the preview fast even for very large parts.
function parseBinarySTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = dv.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    const nx = dv.getFloat32(offset, true);
    const ny = dv.getFloat32(offset + 4, true);
    const nz = dv.getFloat32(offset + 8, true);
    offset += 12;
    const base = i * 9;
    for (let v = 0; v < 3; v++) {
      positions[base + v * 3]     = dv.getFloat32(offset, true);
      positions[base + v * 3 + 1] = dv.getFloat32(offset + 4, true);
      positions[base + v * 3 + 2] = dv.getFloat32(offset + 8, true);
      normals[base + v * 3]       = nx;
      normals[base + v * 3 + 1]   = ny;
      normals[base + v * 3 + 2]   = nz;
      offset += 12;
    }
    offset += 2; // attribute byte count
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.computeBoundingBox();
  return { geometry: g, triCount };
}

function PreviewMesh({ geometry }) {
  // Center the part above the bed so the viewer can spin freely around it.
  const centered = useMemo(() => {
    if (!geometry) return null;
    const g = geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    g.translate(-cx, -bb.min.y, -cz);
    return g;
  }, [geometry]);
  if (!centered) return null;
  return (
    <mesh geometry={centered} castShadow receiveShadow>
      <meshStandardMaterial color="#F97316" roughness={0.6} metalness={0.1} side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function STLPreviewDialog({ open, onClose }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const buildVolume = useScene((s) => s.buildVolume);
  const [bytes, setBytes] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dropped, setDropped] = useState([]);

  // Re-run the export pipeline whenever the dialog opens. This guarantees
  // what the user sees is *exactly* what will land in the slicer.
  const run = async () => {
    setErr(""); setBusy(true); setDropped([]);
    try {
      const res = await exportSTLBytesAsync(objects);
      setBytes(res.bytes);
      setParsed(parseBinarySTL(res.bytes));
      if (res.droppedNegatives && res.droppedNegatives.length > 0) {
        setDropped(res.droppedNegatives);
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) { setBytes(null); setParsed(null); setErr(""); setDropped([]); return; }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const bb = parsed?.geometry?.boundingBox;
  const size = bb ? {
    x: (bb.max.x - bb.min.x).toFixed(1),
    y: (bb.max.y - bb.min.y).toFixed(1),
    z: (bb.max.z - bb.min.z).toFixed(1),
  } : null;

  const handleDownload = () => {
    if (!bytes) return;
    const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
    downloadBlob(new Blob([bytes], { type: "model/stl" }), `${safe}.stl`);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="stl-preview-dialog">
      <div className="w-[min(1100px,95vw)] h-[min(720px,90vh)] bg-slate-950 border border-orange-500/40 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-orange-400 font-bold tracking-wider uppercase text-xs">STL Preview</span>
            <span className="text-[10px] text-slate-500 font-mono">{projectName || "Untitled"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="stl-preview-refresh-btn"
              onClick={run}
              disabled={busy}
              className="h-8 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 disabled:opacity-50"
              title="Re-export and refresh preview"
            >
              <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              data-testid="stl-preview-download-btn"
              onClick={handleDownload}
              disabled={!bytes}
              className="h-8 px-3 text-[11px] uppercase tracking-wider font-semibold rounded bg-orange-500 hover:bg-orange-600 text-white flex items-center gap-1.5 disabled:opacity-50"
              title="Download this STL"
            >
              <Download size={12} /> Download STL
            </button>
            <button
              data-testid="stl-preview-close-btn"
              onClick={onClose}
              className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 relative">
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 text-slate-300 text-sm" data-testid="stl-preview-busy">
              Rendering preview…
            </div>
          )}
          {err && (
            <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center" data-testid="stl-preview-error">
              <div className="max-w-md bg-red-500/10 border border-red-500/50 text-red-300 rounded-md p-4 text-xs leading-relaxed">
                <div className="font-semibold uppercase tracking-wider mb-1">Could not render preview</div>
                <div className="font-mono">{err}</div>
              </div>
            </div>
          )}
          {!err && dropped.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[520px] bg-amber-500/15 border border-amber-500/60 text-amber-200 rounded-md px-3 py-2 text-[11px] leading-snug shadow-lg" data-testid="stl-preview-dropped-warning">
              <div className="font-semibold uppercase tracking-wider text-amber-100 mb-0.5">
                {dropped.length === 1 ? "1 Boolean cut was dropped" : `${dropped.length} Boolean cuts were dropped`}
              </div>
              <div>
                The host mesh is non-manifold (open edges / self-intersections), so the boolean engine could not safely carve: <span className="font-mono text-amber-100">{dropped.join(", ")}</span>. Select the host in the Outliner and click the green <strong>Repair Mesh</strong> button at the top of its Inspector, then Refresh this preview.
              </div>
            </div>
          )}
          <Canvas
            shadows
            camera={{ position: [120, 90, 120], fov: 50, near: 1, far: 2000 }}
            dpr={[1, 1.5]}
            style={{ background: "#0F172A" }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[120, 200, 80]} intensity={0.7} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
            <directionalLight position={[-120, 60, -80]} intensity={0.25} />
            <Grid
              args={[300, 300]}
              cellSize={10}
              cellThickness={0.5}
              cellColor="#475569"
              sectionSize={50}
              sectionThickness={1}
              sectionColor="#F97316"
              fadeDistance={500}
              infiniteGrid
            />
            {parsed && <PreviewMesh geometry={parsed.geometry} />}
            <OrbitControls makeDefault enablePan enableZoom enableRotate target={[0, 20, 0]} />
            <GizmoHelper alignment="bottom-right" margin={[68, 68]}>
              <GizmoViewport axisColors={["#F97316", "#10B981", "#06B6D4"]} labelColor="white" />
            </GizmoHelper>
          </Canvas>

          {/* Stats overlay */}
          {parsed && (
            <StlPreviewStats parsed={parsed} bytes={bytes} size={size} buildVolume={buildVolume} />
          )}
          <div className="absolute top-3 left-3 text-[10px] text-slate-500 bg-slate-900/80 border border-slate-700 rounded px-2 py-1 select-none">
            drag to orbit · scroll to zoom · right-click to pan
          </div>
        </div>
      </div>
    </div>
  );
}

// Stats overlay — extracted so we can add the bed-clearance evaluation
// without making the main render unreadable. Surfaces:
//   • tri count + bbox + KB (the always-on debug-ish info)
//   • a "fits / TOO BIG" pill computed against the current printer's
//     build volume. Mapping note: the store's `buildVolume.y` is the
//     plate-Z axis (depth), and `buildVolume.z` is the height (Y up
//     in three.js coords). Mirrors the same mapping used in Gallery's
//     bed-clearance chip so behaviour is consistent across the app.
function StlPreviewStats({ parsed, bytes, size, buildVolume }) {
  const fits = size && buildVolume
    ? (parseFloat(size.x) <= buildVolume.x
        && parseFloat(size.z) <= buildVolume.y
        && parseFloat(size.y) <= buildVolume.z)
    : null;
  return (
    <div data-testid="stl-preview-stats" className="absolute bottom-3 left-3 bg-slate-900/95 border border-slate-700 rounded px-3 py-2 text-[10px] font-mono text-slate-200 space-y-0.5">
      <div><span className="text-slate-500">tris</span> <span className="text-orange-400">{parsed.triCount.toLocaleString()}</span></div>
      {size && (
        <div><span className="text-slate-500">bbox</span> <span className="text-orange-400">{size.x} × {size.y} × {size.z} mm</span></div>
      )}
      {bytes && <div><span className="text-slate-500">size</span> <span className="text-orange-400">{(bytes.byteLength / 1024).toFixed(1)} KB</span></div>}
      {buildVolume && (
        <div>
          <span className="text-slate-500">bed</span>{" "}
          <span className="text-slate-300">{buildVolume.x}×{buildVolume.y}×{buildVolume.z}</span>
          {fits === true && (
            <span data-testid="stl-preview-fits" className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">fits ✓</span>
          )}
          {fits === false && (
            <span data-testid="stl-preview-too-big" className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">too big</span>
          )}
        </div>
      )}
    </div>
  );
}

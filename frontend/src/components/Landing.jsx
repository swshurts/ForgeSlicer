import React, { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Hexagon, Box, ChevronRight, Globe, Printer, Combine, Layers, Move3D, Upload, AlertCircle } from "lucide-react";
import { setPendingImport } from "../lib/pendingImport";
import UserMenu from "./UserMenu";

function Feature({ icon: Icon, title, desc, accent }) {
  return (
    <div className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-orange-500/40 transition-colors">
      <div className={`w-10 h-10 rounded ${accent} flex items-center justify-center mb-3`}>
        <Icon size={18} className="text-white" />
      </div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{desc}</p>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [importError, setImportError] = useState("");

  const handlePickFile = () => {
    setImportError("");
    fileInputRef.current && fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    // reset input so picking the same file twice still triggers onChange
    e.target.value = "";
    if (!f) return;
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!["stl", "obj", "3mf"].includes(ext)) {
      setImportError(`Unsupported file type .${ext}. Please pick an STL, OBJ, or 3MF file.`);
      return;
    }
    setPendingImport(f);
    navigate("/workspace");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white" data-testid="landing-page" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {/* Header */}
      <header className="h-14 border-b border-slate-800 bg-slate-950/70 backdrop-blur flex items-center px-6 sticky top-0 z-10">
        <Link to="/" className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <Hexagon size={16} className="text-white" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-bold tracking-tight">ForgeSlicer</div>
            <div className="text-[9px] uppercase tracking-widest text-orange-400 -mt-0.5">CAD + Slice</div>
          </div>
        </Link>
        <div className="flex-1" />
        <Link to="/gallery" data-testid="landing-gallery-link" className="h-8 px-3 text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
          <Globe size={14} /> Public Gallery
        </Link>
        <Link to="/workspace" data-testid="landing-launch-btn" className="h-8 px-4 ml-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5">
          Launch Workspace <ChevronRight size={14} />
        </Link>
        <UserMenu returnPath="/workspace" />
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-16 pb-24">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded-full text-[10px] uppercase tracking-widest text-orange-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Browser CAD + Slicer
            </div>
            <h1 className="mt-5 text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
              Model. Carve.<br />
              <span
                data-testid="hero-slice-tooltip"
                className="relative group/slice inline-block cursor-help"
              >
                <span className="text-orange-400 underline decoration-dotted decoration-orange-500/60 underline-offset-[6px]">
                  Slice (sort of...).
                </span>
                {/* Tooltip — hover-revealed via Tailwind's group-hover/slice variant.
                    Explains that ForgeSlicer's GCODE output is a perimeter-only shell
                    preview, not a production-ready slice. Positioned below the word so
                    it doesn't clip the header above. */}
                <span
                  role="tooltip"
                  data-testid="hero-slice-tooltip-body"
                  className="invisible opacity-0 group-hover/slice:visible group-hover/slice:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 top-full mt-3 w-[320px] bg-slate-900 border border-orange-500/40 rounded-lg p-3 text-xs leading-relaxed text-slate-200 shadow-2xl z-20 normal-case tracking-normal font-normal"
                >
                  <span className="block text-orange-300 font-semibold mb-1 text-[10px] uppercase tracking-wider">
                    What "sort of" means
                  </span>
                  ForgeSlicer's built-in GCODE output is an <span className="text-orange-300">outer-shell preview</span> — perimeter contours only, no solid infill, no support generation. Great for design verification on your printer; for a production print, hand it off to OrcaSlicer or another full slicer in one click.
                </span>
              </span>{" "}
              Print.
            </h1>
            <p className="mt-5 text-slate-300 text-base leading-relaxed max-w-xl">
              CAD for people who wish they could do CAD, but don't know how... 3D modeler with positive &amp; negative parts, real boolean operations, and a built-in GCODE slicer — all in one browser tab. Shared components and models for updating and improving your designs. Export STL, 3MF, or hand off to OrcaSlicer in a click.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/workspace" data-testid="hero-cta-workspace" className="h-11 px-5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded flex items-center gap-2">
                <Box size={16} /> Start Modeling
              </Link>
              <button
                type="button"
                data-testid="hero-cta-import"
                onClick={handlePickFile}
                className="h-11 px-5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded flex items-center gap-2 border border-orange-500/40 hover:border-orange-500/70 transition-colors"
              >
                <Upload size={16} className="text-orange-400" /> Import STL · 3MF · OBJ
              </button>
              <Link to="/gallery" data-testid="hero-cta-gallery" className="h-11 px-5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded flex items-center gap-2 border border-slate-700">
                <Globe size={16} /> Browse Gallery
              </Link>
              <input
                ref={fileInputRef}
                type="file"
                accept=".stl,.obj,.3mf"
                onChange={handleFileChange}
                className="hidden"
                data-testid="hero-import-file-input"
              />
            </div>
            <p className="mt-3 text-[11px] text-slate-500 max-w-xl">
              Already started a project elsewhere? Drop in an existing STL, 3MF, or OBJ and pick up right where you left off — measurements, booleans, and slicing all work on imports.
            </p>
            {importError && (
              <div data-testid="hero-import-error" className="mt-3 flex items-start gap-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/40 text-red-300 text-xs max-w-xl">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}
            <div className="mt-8 grid grid-cols-3 gap-4 max-w-md">
              <div>
                <div className="text-2xl font-bold text-orange-400 font-mono">5</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Primitive Types</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-cyan-400 font-mono">3</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Boolean Ops</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-400 font-mono">3</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Export Formats</div>
              </div>
            </div>
          </div>

          <div className="relative aspect-square rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 overflow-hidden">
            <div className="absolute inset-0 opacity-20" style={{
              backgroundImage: "linear-gradient(rgba(249,115,22,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(249,115,22,0.18) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }} />
            <img
              src="https://images.unsplash.com/photo-1709626011485-6fe000ea2dbc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHw0fHxnZW9tZXRyaWMlMjBhYnN0cmFjdCUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc3ODgyNDI2Nnww&ixlib=rb-4.1.0&q=85"
              className="absolute inset-0 w-full h-full object-cover mix-blend-screen opacity-60"
              alt=""
            />
            <div className="absolute bottom-4 left-4 right-4 bg-slate-950/80 backdrop-blur border border-slate-800 rounded px-3 py-2 font-mono text-[10px] text-slate-400 flex justify-between">
              <span>LAYER: 247/420</span><span className="text-orange-400">FILAMENT: 4.21 m</span>
            </div>
          </div>
        </div>

        <div className="mt-24 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Feature icon={Box} title="Primitive Library" desc="Cubes, spheres, cylinders, cones, tori — drop them in and edit dimensions numerically or with gizmos." accent="bg-orange-500" />
          <Feature icon={Combine} title="True Boolean Ops" desc="Union, subtract, intersect with three-bvh-csg. Positive & negative parts compose into a clean watertight mesh." accent="bg-cyan-500" />
          <Feature icon={Move3D} title="Precise Transforms" desc="Per-axis numeric position, rotation, scale. Snap-to-grid in mm or degrees. Build-plate bounds checking." accent="bg-emerald-500" />
          <Feature icon={Layers} title="STL · 3MF · GCODE" desc="Export print-ready files locally, then open in OrcaSlicer for production-quality slicing." accent="bg-amber-500" />
        </div>
      </main>

      <footer className="border-t border-slate-800 py-6 px-6 text-center text-xs text-slate-500">
        ForgeSlicer · A unified 3D-modeling + slicing playground. Mesh by your fingertips.
      </footer>
    </div>
  );
}

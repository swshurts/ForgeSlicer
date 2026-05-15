import React from "react";
import { Link } from "react-router-dom";
import { Hexagon, Box, ChevronRight, Globe, Printer, Combine, Layers, Move3D } from "lucide-react";

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
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-16 pb-24">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded-full text-[10px] uppercase tracking-widest text-orange-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Browser CAD + Slicer
            </div>
            <h1 className="mt-5 text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
              Model. Carve.<br />
              <span className="text-orange-400">Slice.</span> Print.
            </h1>
            <p className="mt-5 text-slate-300 text-base leading-relaxed max-w-xl">
              A TinkerCAD-style 3D modeler with positive & negative parts, real boolean operations, and a built-in GCODE slicer — all in one browser tab. Export STL, 3MF, or hand off to OrcaSlicer in a click.
            </p>
            <div className="mt-7 flex gap-3">
              <Link to="/workspace" data-testid="hero-cta-workspace" className="h-11 px-5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded flex items-center gap-2">
                <Box size={16} /> Start Modeling
              </Link>
              <Link to="/gallery" data-testid="hero-cta-gallery" className="h-11 px-5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded flex items-center gap-2 border border-slate-700">
                <Globe size={16} /> Browse Gallery
              </Link>
            </div>
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

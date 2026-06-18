import React, { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Box, ChevronRight, Globe, Printer, Combine, Layers, Move3D, Upload, AlertCircle, Sparkles } from "lucide-react";
import { setPendingImport } from "../lib/pendingImport";
import { openInPeer } from "../lib/ssoHandoff";
import { ITER_LABEL, RECENT_ITERATIONS } from "../lib/iterLabel";
import { useAuth } from "../contexts/AuthContext";
import UserMenu from "./UserMenu";
import ThemeSwitcher from "./toolbar/ThemeSwitcher";

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

// Iter-103 — Clickable iteration tag.
//
// Renders the muted "iter-X.Y" pill next to the wordmark and, when
// clicked, drops a small popover with the last 3 iterations sourced
// from /lib/iterLabel.js. Pure presentation — no fetch, no network —
// so it works on the static Landing page without an auth round trip.
function IterPopoverTrigger() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative ml-2" ref={ref}>
      <button
        data-testid="landing-iter-id"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] font-mono text-slate-500 hover:text-orange-400 tracking-tight select-text transition-colors"
        title="What's new — click for recent iterations"
      >
        {ITER_LABEL}
      </button>
      {open && (
        <div
          data-testid="landing-iter-popover"
          className="absolute left-0 top-full mt-2 w-[340px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-20 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">Recent iterations</span>
            <span className="text-[10px] font-mono text-orange-400">{ITER_LABEL}</span>
          </div>
          <ul className="divide-y divide-slate-800">
            {RECENT_ITERATIONS.map((it) => (
              <li key={it.id} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-semibold text-white">{it.title}</span>
                  <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">{it.id} · {it.date}</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug mt-1">{it.summary}</p>
              </li>
            ))}
          </ul>
          <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-950/60">
            <span className="text-[10px] text-slate-500">Open the workspace and press <kbd className="px-1 rounded bg-slate-800 text-slate-300 font-mono">?</kbd> for the full release notes.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Iter-103 — SSO Bridge banner.
//
// Surfaces the cross-app SSO flow that was previously hidden inside the
// "LithoForge" header link. Modern third-party cookie partitioning
// killed the auto-bridge for visitors who type either domain into the
// address bar directly, so the only way most users discover the linked
// account is through an explicit affordance. This banner is that
// affordance — dismissible (localStorage flag) and only shown on the
// Landing page so it never competes with workspace tooling.
function SsoBridgeBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = React.useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage?.getItem("forge.sso.banner.dismissed") === "1";
  });
  if (dismissed) return null;

  const handleOpenLitho = (e) => {
    e.preventDefault();
    if (user) openInPeer("https://lithoforge.net", "/");
    else window.open("https://lithoforge.net", "_blank", "noopener");
  };
  const dismiss = () => {
    try { window.localStorage?.setItem("forge.sso.banner.dismissed", "1"); } catch (_) { /* noop */ }
    setDismissed(true);
  };

  return (
    <div
      data-testid="sso-bridge-banner"
      className="mb-10 border border-orange-500/30 bg-gradient-to-r from-orange-500/10 via-orange-500/5 to-transparent rounded-lg px-4 py-3 flex items-center gap-3"
    >
      <div className="w-8 h-8 rounded bg-orange-500/15 border border-orange-500/40 flex items-center justify-center flex-shrink-0">
        <Sparkles size={14} className="text-orange-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-white">
          {user
            ? "Already signed in here — bridge over to LithoForge with one click"
            : "Use ForgeSlicer + LithoForge together"}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
          {user
            ? "Browser-level privacy now blocks our auto-bridge, but clicking through transfers your sign-in via a one-time secure handoff. Same account, no second password."
            : "One account, both apps. Sign in here, and you'll land on LithoForge already signed in (and vice-versa) — even though browsers have started partitioning cross-site cookies."}
        </div>
      </div>
      <a
        href="https://lithoforge.net"
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleOpenLitho}
        data-testid="sso-bridge-cta"
        className="flex-shrink-0 h-8 px-3 text-[11px] font-semibold text-orange-200 hover:text-white bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/50 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap"
      >
        Open LithoForge <ChevronRight size={12} />
      </a>
      <button
        onClick={dismiss}
        data-testid="sso-bridge-dismiss"
        title="Hide this banner"
        className="flex-shrink-0 h-7 w-7 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 flex items-center justify-center text-lg leading-none"
      >
        ×
      </button>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [importError, setImportError] = useState("");
  const { user } = useAuth();

  // Iter-99.2 — When the visitor is signed into ForgeSlicer, route the
  // LithoForge link through `openInPeer` so they land on LithoForge
  // already signed in (first-party cookie set by LithoForge after the
  // /auth/sso-accept exchange). Anonymous visitors get the plain
  // external link — no JWT to mint, no SSO benefit, just a fresh tab.
  const openLithoForge = (e) => {
    e.preventDefault();
    if (user) {
      openInPeer("https://lithoforge.net", "/");
    } else {
      window.open("https://lithoforge.net", "_blank", "noopener");
    }
  };

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
          {/* iter-89: switch the placeholder hexagon for the
              Celtic-knot anvil logo. The logo is decorative — kept
              small (28px) so it doesn't dominate the header. */}
          <img
            src="/forgeslicer-logo.webp"
            alt="ForgeSlicer"
            width={28}
            height={28}
            className="rounded shadow-lg shadow-orange-900/30"
          />
          <div className="leading-tight">
            <div className="text-[14px] font-bold tracking-tight">ForgeSlicer</div>
            <div className="text-[9px] uppercase tracking-widest text-orange-400 -mt-0.5">CAD + Slice</div>
          </div>
        </Link>
        {/* Iter-103 — Clickable build/iter tag.
            Outside the <Link> wrapper so clicking it doesn't fire the
            home-nav. Opens a small popover summarising the last 3
            iterations from /lib/iterLabel.js. Power users get a quick
            "what changed since I last loaded" without diving into the
            full Release Notes dialog. */}
        <IterPopoverTrigger />
        <div className="flex-1" />
        {/* iter-89: cross-link to the sister tool. The user owns
            both domains and is positioning them as a "Forge Suite".
            External link → opens in a new tab so users keep their
            ForgeSlicer session intact. */}
        <a
          href="https://lithoforge.net"
          target="_blank"
          rel="noopener noreferrer"
          onClick={openLithoForge}
          data-testid="landing-lithoforge-link"
          className="h-8 px-3 text-xs text-slate-400 hover:text-orange-300 hidden sm:flex items-center gap-1.5 transition-colors"
          title={user ? "Open LithoForge (auto sign-in)" : "Open LithoForge — our sister tool for lithophanes & multi-color prints"}
        >
          <Sparkles size={13} className="text-orange-400" /> LithoForge
        </a>
        <Link to="/gallery" data-testid="landing-gallery-link" className="h-8 px-3 text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
          <Globe size={14} /> Public Gallery
        </Link>
        <Link to="/workspace" data-testid="landing-launch-btn" className="h-8 px-4 ml-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5">
          Launch Workspace <ChevronRight size={14} />
        </Link>
        <ThemeSwitcher />
        <UserMenu returnPath="/workspace" />
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-16 pb-24">
        <SsoBridgeBanner />
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded-full text-[10px] uppercase tracking-widest text-orange-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Browser CAD + Slicer
            </div>
            <h1 className="mt-5 text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
              Model. Carve.<br />
              <span className="text-orange-400">
                Slice.
              </span>{" "}
              Print.
            </h1>
            <p className="mt-5 text-slate-300 text-base leading-relaxed max-w-xl">
              CAD for people who wish they could do CAD, but don&apos;t know how — 3D modeler with positive &amp; negative parts, real boolean operations, and integrated production slicing. Hand off to OrcaSlicer, Bambu Studio, PrusaSlicer or your own with a single click — or export STL / 3MF directly. All in your browser tab.
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
                accept=".stl,.obj,.3mf,.glb,.gltf,.svg,.zip"
                onChange={handleFileChange}
                className="hidden"
                data-testid="hero-import-file-input"
              />
            </div>
            <p className="mt-3 text-[11px] text-slate-500 max-w-xl">
              Already started a project elsewhere? Drop in an existing STL, 3MF, OBJ, GLB, SVG, or ZIP bundle and pick up right where you left off — measurements, booleans, and slicing all work on imports.
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
            {/* Subtle blueprint-grid background — references CAD without
                competing with the brand mark. */}
            <div className="absolute inset-0 opacity-20" style={{
              backgroundImage: "linear-gradient(rgba(249,115,22,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(249,115,22,0.18) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }} />
            {/* Warm forge-glow halo behind the mark — picks up the
                orange embers in the logo and ties into the
                'CAD + Slice' accent colour. */}
            <div
              className="absolute inset-0"
              style={{
                background: "radial-gradient(circle at 50% 52%, rgba(249,115,22,0.28) 0%, rgba(249,115,22,0.06) 38%, transparent 65%)",
              }}
            />
            {/* iter-89.2: brand mark fills the whole plate. The
                synthetic LAYER/FILAMENT HUD chip was removed per user
                feedback — it wasn't real data anyway, and the logo
                stands on its own now that everything else on the page
                explains what ForgeSlicer does. */}
            <img
              src="/forgeslicer-logo.webp"
              alt="ForgeSlicer mark"
              data-testid="landing-hero-logo"
              className="absolute inset-0 w-full h-full object-contain p-2 drop-shadow-[0_0_60px_rgba(249,115,22,0.45)]"
            />
          </div>
        </div>

        <div className="mt-24 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Feature icon={Box} title="Primitive Library" desc="Cubes, spheres, cylinders, cones, tori — drop them in and edit dimensions numerically or with gizmos." accent="bg-orange-500" />
          <Feature icon={Combine} title="True Boolean Ops" desc="Union, subtract, intersect with three-bvh-csg. Positive & negative parts compose into a clean watertight mesh." accent="bg-cyan-500" />
          <Feature icon={Move3D} title="Precise Transforms" desc="Per-axis numeric position, rotation, scale. Snap-to-grid in mm or degrees. Build-plate bounds checking." accent="bg-emerald-500" />
          <Feature icon={Layers} title="STL · 3MF · GCODE" desc="Hand off to OrcaSlicer, Bambu Studio, PrusaSlicer or your own — one click, real production slicing." accent="bg-amber-500" />
        </div>
      </main>

      <footer className="border-t border-slate-800 py-6 px-6 text-center text-xs text-slate-500 space-y-1.5">
        <div>ForgeSlicer · A unified 3D-modeling + slicing playground. Mesh by your fingertips.</div>
        <div className="text-[10px] text-slate-600">
          Part of the Forge Suite ·{" "}
          <a href="https://lithoforge.net" target="_blank" rel="noopener noreferrer" onClick={openLithoForge} className="text-orange-400/80 hover:text-orange-300">
            LithoForge
          </a>{" "}for lithophanes &amp; multi-color prints
        </div>
      </footer>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { Box, ChevronRight, Globe, Printer, Combine, Layers, Move3D, Upload, AlertCircle, Sparkles, Mic, Wand2, MessageSquare, Wrench, GraduationCap, Store, Rocket } from "lucide-react";
import { setPendingImport } from "../lib/pendingImport";
import { openInPeer } from "../lib/ssoHandoff";
import { ITER_LABEL, RECENT_ITERATIONS } from "../lib/iterLabel";
import { useAuth } from "../contexts/AuthContext";
import UserMenu from "./UserMenu";
import ThemeSwitcher from "./toolbar/ThemeSwitcher";
import LandingTemplates from "./LandingTemplates";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

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
// from /lib/iterLabel.js.
//
// Iter-105.25 — the label string is now LIVE-FETCHED from
// `GET /api/release/current`, which parses CHANGELOG.md server-side
// for the newest `## Iteration X.Y` heading. The ITER_LABEL constant
// is the FALLBACK only (used when the backend is unreachable or
// during the brief moment before the fetch resolves). This kills
// the recurring "iter label is stale" bug at the root — bumping the
// changelog now bumps the display with no code edit required.
function IterPopoverTrigger() {
  const [open, setOpen] = React.useState(false);
  const [liveLabel, setLiveLabel] = React.useState(ITER_LABEL);
  const ref = React.useRef(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/release/current`, { timeout: 5000 });
        if (!cancelled && data?.label) setLiveLabel(data.label);
      } catch {
        // Backend unreachable — keep the constant fallback so the
        // page still renders something sensible. This is the
        // designed-for failure mode.
      }
    })();
    return () => { cancelled = true; };
  }, []);
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
        {liveLabel}
      </button>
      {open && (
        <div
          data-testid="landing-iter-popover"
          className="absolute left-0 top-full mt-2 w-[340px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-20 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">Recent iterations</span>
            <span className="text-[10px] font-mono text-orange-400">{liveLabel}</span>
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
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded-full text-[10px] uppercase tracking-widest text-orange-400 font-semibold" data-testid="landing-eyebrow-pill">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Beginner-friendly CAD · AI · Voice
            </div>
            <h1 className="mt-5 text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]" data-testid="landing-hero-headline">
              Design. <span className="text-orange-400">Speak.</span><br />
              Slice. Print.
            </h1>
            <p className="mt-5 text-slate-300 text-base leading-relaxed max-w-xl" data-testid="landing-hero-subheadline">
              Design 3D-printable objects with{" "}
              <span className="text-white font-semibold">simple CAD tools</span>,{" "}
              <span className="text-white font-semibold">AI assistance via Meshy.ai</span>, and{" "}
              <span className="text-white font-semibold">voice commands</span>. Say{" "}
              <em className="text-orange-200 not-italic">&ldquo;make this cylinder 20&nbsp;mm taller&rdquo;</em>{" "}
              or generate a starter model from a text prompt — no CAD experience required. Then hand off to OrcaSlicer, Bambu Studio, or PrusaSlicer in a single click.
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
              Already started a project elsewhere? Drop in an existing STL, 3MF, OBJ, GLB, SVG, or ZIP bundle and pick up right where you left off — measurements, booleans, voice editing, and slicing all work on imports.
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
                <div className="text-2xl font-bold text-cyan-400 font-mono">AI</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Starter Models</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-400 font-mono">🎙</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Voice Editing</div>
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

        {/* ─── Design-by-conversation section ──────────────────────
            AI + voice are the headline value-prop, so they get a
            dedicated panel between the hero and the classic-feature
            grid. The three example cards are LITERAL phrases users
            can speak / type into the workspace today — beginner-
            friendly framing on purpose ("just say it" beats "open
            the Extrude dialog"). */}
        <section className="mt-20" data-testid="landing-ai-voice-section">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">
              <Mic size={11} /> Design by Conversation
            </div>
            <h2 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">
              You don&apos;t need to learn CAD.<br />
              <span className="text-orange-400">Just say what you want.</span>
            </h2>
            <p className="mt-3 text-slate-400 text-sm max-w-2xl mx-auto leading-relaxed">
              ForgeSlicer interprets natural language and turns it into real geometry edits. Speak, type, or describe — the model updates the same way a CAD veteran would do it, just without the menus.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4" data-testid="landing-conversation-examples">
            {/* Voice editing card — concrete edit-this-mesh example */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-emerald-500/40 transition-colors"
              data-testid="example-card-voice-edit"
            >
              <div className="w-10 h-10 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mb-3">
                <Mic size={18} className="text-emerald-300" />
              </div>
              <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Voice editing</div>
              <div className="mt-2 text-[15px] font-semibold text-white leading-snug">
                &ldquo;Make this cylinder 20&nbsp;mm taller.&rdquo;
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Click the mic, say the change, watch it happen. Resize, rotate, move, and align with plain English — no dialog hunting.
              </p>
            </div>

            {/* Boolean-by-voice card — shows complex ops are accessible */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-cyan-500/40 transition-colors"
              data-testid="example-card-voice-boolean"
            >
              <div className="w-10 h-10 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center mb-3">
                <MessageSquare size={18} className="text-cyan-300" />
              </div>
              <div className="text-[10px] uppercase tracking-widest text-cyan-300 font-semibold">Voice booleans</div>
              <div className="mt-2 text-[15px] font-semibold text-white leading-snug">
                &ldquo;Cut a hole through the centre.&rdquo;
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                The same boolean subtract a CAD pro would set up — but spoken in one sentence. Holes, slots, embossed text, and unions all respond to natural prompts.
              </p>
            </div>

            {/* AI generation card — kicks off a fresh model from prompt */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-orange-500/40 transition-colors"
              data-testid="example-card-ai-prompt"
            >
              <div className="w-10 h-10 rounded bg-orange-500/20 border border-orange-500/40 flex items-center justify-center mb-3">
                <Wand2 size={18} className="text-orange-300" />
              </div>
              <div className="text-[10px] uppercase tracking-widest text-orange-300 font-semibold">AI starter models · Meshy.ai</div>
              <div className="mt-2 text-[15px] font-semibold text-white leading-snug">
                &ldquo;Generate a low-poly fox keychain.&rdquo;
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Type or speak a prompt; Meshy.ai returns a printable starter model in seconds. Refine it with primitives, booleans, or another voice command — your AI co-designer never gets tired of revisions.
              </p>
            </div>
          </div>

          <div className="mt-6 text-center text-[11px] text-slate-500">
            <span className="text-slate-400">No CAD background required.</span>{" "}
            ForgeSlicer&apos;s voice + AI features are built for hobbyists, students, and makers — bring an idea, leave with a print-ready file.
          </div>
        </section>

        {/* ─── Who is ForgeSlicer for? ──────────────────────────────
            5 audience-segment cards. The personas come straight from
            the user's brief — each card pairs a concrete user with a
            benefit they actually care about, NOT a feature list.
            Goal: a visitor sees themselves on the page within 5
            seconds. Grid is 1 / 2 / 3 / 5 columns responsive — the
            5-across only kicks in at xl+ so the cards stay readable
            on laptops. */}
        <section className="mt-24" data-testid="landing-audience-section">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-[10px] uppercase tracking-widest text-cyan-300 font-semibold">
              <Sparkles size={11} /> Who ForgeSlicer is for
            </div>
            <h2 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">
              Built for makers,{" "}
              <span className="text-orange-400">not just engineers.</span>
            </h2>
            <p className="mt-3 text-slate-400 text-sm max-w-2xl mx-auto leading-relaxed">
              Design printable objects without learning Fusion 360, FreeCAD, or Blender. If you can describe what you want — out loud or in writing — ForgeSlicer can build it.
            </p>
          </div>

          <div
            className="grid sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4"
            data-testid="landing-audience-grid"
          >
            {/* 1. 3D printer owners — design instead of just printing */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-orange-500/40 transition-colors"
              data-testid="audience-card-printer-owners"
            >
              <div className="w-10 h-10 rounded bg-orange-500/20 border border-orange-500/40 flex items-center justify-center mb-3">
                <Printer size={18} className="text-orange-300" />
              </div>
              <div className="text-[15px] font-bold text-white leading-snug">
                3D Printer Owners
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Stop hunting Thingiverse for the right STL. Design exactly what you need — a phone stand sized to your desk, a replacement clip matched to your callipers — then print it.
              </p>
            </div>

            {/* 2. Remix hobbyists — modifying downloaded STLs */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-emerald-500/40 transition-colors"
              data-testid="audience-card-stl-remixers"
            >
              <div className="w-10 h-10 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mb-3">
                <Wrench size={18} className="text-emerald-300" />
              </div>
              <div className="text-[15px] font-bold text-white leading-snug">
                STL Remixers
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Found a great model with the wrong-size screw holes? Drop it in and say &ldquo;make these holes 4 mm bigger.&rdquo; Remix any STL without remembering which CAD package created it.
              </p>
            </div>

            {/* 3. Teachers — classroom CAD without installs */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-sky-500/40 transition-colors"
              data-testid="audience-card-teachers"
            >
              <div className="w-10 h-10 rounded bg-sky-500/20 border border-sky-500/40 flex items-center justify-center mb-3">
                <GraduationCap size={18} className="text-sky-300" />
              </div>
              <div className="text-[15px] font-bold text-white leading-snug">
                Teachers &amp; Classrooms
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Skip the install tickets and licence chases. Students open ForgeSlicer in any browser, describe what they want in plain English, and watch real geometry appear — perfect introduction to CAD.
              </p>
            </div>

            {/* 4. Etsy / maker sellers — custom-per-order products */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-amber-500/40 transition-colors"
              data-testid="audience-card-makers-sellers"
            >
              <div className="w-10 h-10 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-3">
                <Store size={18} className="text-amber-300" />
              </div>
              <div className="text-[15px] font-bold text-white leading-snug">
                Etsy &amp; Maker Sellers
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Custom-name keychains, made-to-measure phone cases, wedding favours. Build a base design once, tweak it per order with a voice command, and re-export print-ready STLs in seconds.
              </p>
            </div>

            {/* 5. TinkerCAD graduates — bridge to real CAD power */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-purple-500/40 transition-colors"
              data-testid="audience-card-tinkercad-graduates"
            >
              <div className="w-10 h-10 rounded bg-purple-500/20 border border-purple-500/40 flex items-center justify-center mb-3">
                <Rocket size={18} className="text-purple-300" />
              </div>
              <div className="text-[15px] font-bold text-white leading-snug">
                Beyond Tinkercad
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Outgrew Tinkercad&apos;s primitives but Fusion 360 feels like a 747 cockpit? ForgeSlicer is the middle floor — real booleans, precise transforms, and slicer handoff, wrapped in a &ldquo;just describe it&rdquo; interface.
              </p>
            </div>
          </div>

          <div className="mt-8 text-center">
            <Link
              to="/workspace"
              data-testid="audience-cta-workspace"
              className="inline-flex items-center gap-2 h-10 px-5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded transition-colors"
            >
              Find yourself in there? Open the workspace <ChevronRight size={15} />
            </Link>
          </div>
        </section>


        <div className="mt-24 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Feature icon={Box} title="Primitive Library" desc="Cubes, spheres, cylinders, cones, tori — drop them in and edit dimensions numerically or with gizmos." accent="bg-orange-500" />
          <Feature icon={Combine} title="True Boolean Ops" desc="Union, subtract, intersect with three-bvh-csg. Positive & negative parts compose into a clean watertight mesh." accent="bg-cyan-500" />
          <Feature icon={Move3D} title="Precise Transforms" desc="Per-axis numeric position, rotation, scale. Snap-to-grid in mm or degrees. Build-plate bounds checking." accent="bg-emerald-500" />
          <Feature icon={Layers} title="STL · 3MF · GCODE" desc="Hand off to OrcaSlicer, Bambu Studio, PrusaSlicer or your own — one click, real production slicing." accent="bg-amber-500" />
        </div>

        <LandingTemplates />
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

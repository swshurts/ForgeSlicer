import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { Box, ChevronRight, Globe, Printer, Combine, Layers, Move3D, Upload, AlertCircle, Sparkles, Mic, Wand2, MessageSquare, Wrench, GraduationCap, Store, Rocket, Cpu, HardDrive, Download, Pencil, Ruler, Slice, BookOpen, Shield, LayoutGrid, Lock } from "lucide-react";
import { setPendingImport } from "../lib/pendingImport";
import { openInPeer } from "../lib/ssoHandoff";
import { ITER_LABEL, RECENT_ITERATIONS } from "../lib/iterLabel";
import { useAuth } from "../contexts/AuthContext";
import UserMenu from "./UserMenu";
import ThemeSwitcher from "./toolbar/ThemeSwitcher";
import LandingTemplates from "./LandingTemplates";
import BeginnerStarters from "./BeginnerStarters";
import LandingCommunityStrip from "./LandingCommunityStrip";
import { PRIVACY_FACTS } from "../lib/trustContent";

// ─── Landing tab navigation ──────────────────────────────────────
// The landing page used to be one long scroll. iter-108 chunks the
// content into 5 curated tabs (Start · Templates · Gallery · Learn ·
// Trust) so a visitor lands on the hero + first tab and can swap
// surfaces with one click instead of scrolling past sections they
// don't care about. Hero stays pinned above the tab bar; header and
// footer are unchanged. State is client-side only (the user
// explicitly opted out of URL-deep-linking) so refresh resets to
// "start" — the right default for a marketing page.
const LANDING_TABS = [
  { id: "home", label: "Home", icon: Box },
  { id: "start", label: "Start", icon: Rocket },
  { id: "templates", label: "Templates", icon: LayoutGrid },
  { id: "gallery", label: "Gallery", icon: Globe },
  { id: "learn", label: "Learn", icon: GraduationCap },
  { id: "trust", label: "Trust", icon: Shield },
];

function LandingTabBar({ activeTab, onChange }) {
  return (
    <nav
      data-testid="landing-tabbar"
      role="tablist"
      aria-label="Landing sections"
      className="mt-12 mb-10 flex items-center gap-1 sm:gap-2 border-b border-slate-800 overflow-x-auto scrollbar-none"
    >
      {LANDING_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            data-testid={`landing-tab-${tab.id}`}
            role="tab"
            aria-selected={active}
            aria-controls={`landing-tabpanel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`relative flex-shrink-0 inline-flex items-center gap-2 px-4 sm:px-5 h-11 text-[13px] font-semibold whitespace-nowrap transition-colors ${
              active
                ? "text-orange-300"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            <Icon size={15} className={active ? "text-orange-400" : ""} />
            {tab.label}
            <span
              aria-hidden="true"
              className={`absolute left-2 right-2 -bottom-px h-[2px] rounded-full transition-colors ${
                active ? "bg-orange-500" : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </nav>
  );
}

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
  // iter-108 — Tabbed landing layout. Default to "home" on each load
  // (the user opted out of URL-based deep links). Home tab contains
  // the hero block; the other tabs hold the marketing surfaces.
  const [activeTab, setActiveTab] = useState("home");
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
        <Link to="/learn" data-testid="landing-learn-link" className="h-8 px-3 text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
          <GraduationCap size={14} /> Learn
        </Link>
        <Link to="/workspace" data-testid="landing-launch-btn" className="h-8 px-4 ml-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5">
          Launch Workspace <ChevronRight size={14} />
        </Link>
        <ThemeSwitcher />
        <UserMenu returnPath="/workspace" />
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-10 pb-24">
        <LandingTabBar activeTab={activeTab} onChange={setActiveTab} />

        <div
          role="tabpanel"
          id={`landing-tabpanel-${activeTab}`}
          aria-labelledby={`landing-tab-${activeTab}`}
          data-testid={`landing-tabpanel-${activeTab}`}
        >
        {activeTab === "home" && (<>
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
              <span className="text-white font-semibold">voice commands</span>, and{" "}
              <span className="text-white font-semibold">Meshy.ai</span> &mdash; a{" "}
              <span className="text-fuchsia-300">third-party AI design tool integrated into the ForgeSlicer workflow</span>. Say{" "}
              <em className="text-orange-200 not-italic">&ldquo;create a simple phone stand&rdquo;</em>,{" "}
              <em className="text-orange-200 not-italic">&ldquo;add a 5&nbsp;mm keyring hole&rdquo;</em>, or{" "}
              <em className="text-orange-200 not-italic">&ldquo;make this box hollow with 2&nbsp;mm walls&rdquo;</em> &mdash; no CAD experience required. Slice in your browser, on our server&apos;s OrcaSlicer engine, or export STL / 3MF to your desktop slicer.
            </p>
            <div className="mt-7 flex flex-wrap gap-3" data-testid="hero-cta-row">
              {/* ─── Primary CTA ─────────────────────────────────────
                  "Start Designing Free" beats "Start Modeling" for
                  beginners — "modeling" still sounds like a learned
                  skill, "designing" sounds like something they
                  already do. The "Free" tag is intentional and
                  honest: the workspace doesn't gate anything behind
                  a paywall today. */}
              <Link
                to="/workspace"
                data-testid="hero-cta-workspace"
                className="h-11 px-5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded flex items-center gap-2 shadow-lg shadow-orange-900/30"
              >
                <Box size={16} /> Start Designing Free
              </Link>

              {/* ─── Secondary CTA ───────────────────────────────────
                  "Try an Example Project" sounds inviting for a
                  curious-but-intimidated visitor. Scrolls to the
                  LandingTemplates grid below so the user picks
                  WHICH example they want — landing them straight
                  on the workspace with no context would be jarring. */}
              <button
                type="button"
                data-testid="hero-cta-example-project"
                onClick={() => {
                  // Prefer the beginner-starter gallery — it's the
                  // first thing first-timers should see. Fall back to
                  // the intermediate templates if for some reason the
                  // starters block isn't mounted (defensive).
                  const el =
                    document.querySelector('[data-testid="landing-beginner-starters"]') ||
                    document.querySelector('[data-testid="landing-templates"]');
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="h-11 px-5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded flex items-center gap-2 border border-orange-500/40 hover:border-orange-500/70 transition-colors"
              >
                <Sparkles size={16} className="text-orange-400" /> Try an Example Project
              </button>

              {/* ─── Tertiary CTA ────────────────────────────────────
                  "Import an STL" — kept short; the long
                  "STL · 3MF · OBJ" detail is now in the hint copy
                  below so the button itself stays scannable. */}
              <button
                type="button"
                data-testid="hero-cta-import"
                onClick={handlePickFile}
                className="h-11 px-5 bg-slate-900/60 hover:bg-slate-800 text-slate-200 font-semibold rounded flex items-center gap-2 border border-slate-700 transition-colors"
              >
                <Upload size={16} /> Import an STL
              </button>

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
              Already started a project elsewhere? Drop in an existing STL, 3MF, OBJ, GLB, SVG, or ZIP bundle and pick up right where you left off — measurements, booleans, voice editing, and slicing all work on imports. The Public Gallery in the header has hundreds of community designs to remix too.
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

        </>)}

        {activeTab === "start" && (<>

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
            {/* Explicit third-party attribution row. Sits just under
                the section sub-headline so a visitor reading top-to-
                bottom learns the relationship before they hit the
                example cards. Meshy.ai is one of three plain-prompt
                surfaces — voice editing + voice booleans run on
                ForgeSlicer's own engine, but the "starter mesh from
                a text prompt" generator is provided by Meshy.ai. */}
            <p
              className="mt-2 text-[11px] text-slate-500 max-w-2xl mx-auto leading-relaxed"
              data-testid="landing-meshy-attribution"
            >
              Generative model creation is powered by{" "}
              <a
                href="https://www.meshy.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-fuchsia-300 hover:text-fuchsia-200 underline underline-offset-2"
                data-testid="landing-meshy-link"
              >
                Meshy.ai
              </a>
              {" "}— an independent third-party AI design tool integrated into the ForgeSlicer workflow, not a ForgeSlicer-owned product. Voice edits and boolean ops run on ForgeSlicer&apos;s own engine.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4" data-testid="landing-conversation-examples">
            {/* Voice editing card — concrete edit-this-mesh example. The
                prompt was chosen from the user's brief: a verb beginners
                already know ("make ... hollow") applied to a familiar
                primitive ("this box"). */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-emerald-500/40 transition-colors"
              data-testid="example-card-voice-edit"
            >
              <div className="w-10 h-10 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mb-3">
                <Mic size={18} className="text-emerald-300" />
              </div>
              <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Voice editing · ForgeSlicer engine</div>
              <div className="mt-2 text-[15px] font-semibold text-white leading-snug">
                &ldquo;Make this box hollow with 2&nbsp;mm walls.&rdquo;
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Refine and modify what&apos;s already on the plate — shell, hollow, resize, rotate, align. Plain English maps to the same operations a CAD pro would set up by hand.
              </p>
            </div>

            {/* Boolean-by-voice card — the user's "add a 5mm keyring
                hole" example fits perfectly here: a single sentence
                produces a parametric subtract + drop on the host. */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-cyan-500/40 transition-colors"
              data-testid="example-card-voice-boolean"
            >
              <div className="w-10 h-10 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center mb-3">
                <MessageSquare size={18} className="text-cyan-300" />
              </div>
              <div className="text-[10px] uppercase tracking-widest text-cyan-300 font-semibold">Voice booleans · ForgeSlicer engine</div>
              <div className="mt-2 text-[15px] font-semibold text-white leading-snug">
                &ldquo;Add a 5&nbsp;mm keyring hole.&rdquo;
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Holes, slots, embossed text, unions and intersections — all spoken in one sentence. The geometry-edit half of conversational design runs entirely on the ForgeSlicer engine; nothing leaves your tab.
              </p>
            </div>

            {/* AI generation card — Meshy.ai surface. Strengthens the
                third-party attribution one more time so a visitor who
                scans only this card still learns the relationship. */}
            <div
              className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-fuchsia-500/40 transition-colors"
              data-testid="example-card-ai-prompt"
            >
              <div className="w-10 h-10 rounded bg-fuchsia-500/20 border border-fuchsia-500/40 flex items-center justify-center mb-3">
                <Wand2 size={18} className="text-fuchsia-300" />
              </div>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-fuchsia-300 font-semibold">
                <span>Starter models</span>
                <span className="text-slate-500">·</span>
                <span>Meshy.ai (third-party)</span>
              </div>
              <div className="mt-2 text-[15px] font-semibold text-white leading-snug">
                &ldquo;Create a simple phone stand.&rdquo;
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                A plain-language prompt returns a printable starter mesh from{" "}
                <a
                  href="https://www.meshy.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fuchsia-300 hover:text-fuchsia-200 underline underline-offset-2"
                >
                  Meshy.ai
                </a>
                {" "}in seconds. Once the mesh lands on the plate, ForgeSlicer&apos;s own tools refine and modify it — every voice edit, boolean, and slice happens locally.
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
                Outgrew Tinkercad&apos;s primitives but Fusion 360 feels like a 747 cockpit? ForgeSlicer is the middle floor — real booleans, precise transforms, in-browser slicing, and an export to your favourite slicer, all wrapped in a &ldquo;just describe it&rdquo; interface.
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
          <Feature icon={Layers} title="Three Ways to Slice" desc="Slice in-browser for an instant preview, on our server's bundled OrcaSlicer engine for production G-code, or export STL / 3MF and open in your desktop slicer." accent="bg-amber-500" />
        </div>

        {/* ─── From design to print ──────────────────────────────────
            Honesty section. Earlier copy mixed "hand off to slicers"
            with "integrated production slicing" — visitors couldn't
            tell whether ForgeSlicer slices itself or just exports.
            Truth: it does BOTH, plus a third desktop hand-off path.
            This block lays out the 5 user-visible steps so a curious
            visitor can see exactly where each capability lives. The
            in-browser slicer and the server-side OrcaSlicer engine
            both produce real G-code; the third branch is the export
            path for users who prefer their existing desktop slicer
            (which keeps OrcaSlicer / Bambu Studio / PrusaSlicer
            workflows intact). */}
        <section
          data-testid="landing-design-to-print"
          className="mt-24"
          aria-labelledby="design-to-print-heading"
        >
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full text-[10px] uppercase tracking-widest text-amber-300 font-semibold">
              <Layers size={11} /> From design to print
            </div>
            <h2
              id="design-to-print-heading"
              className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight"
            >
              The five-step path,{" "}
              <span className="text-amber-400">no surprises.</span>
            </h2>
            <p className="mt-3 text-slate-400 text-sm max-w-2xl mx-auto leading-relaxed">
              ForgeSlicer covers everything from blank canvas to printer SD card. Here&apos;s every step in plain English, and exactly which tools live where.
            </p>
          </div>

          <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-5" data-testid="design-to-print-flow">
            {[
              { n: 1, icon: Pencil, title: "Design or import", desc: "Build with primitives + booleans, generate from a text/voice prompt, or import STL / OBJ / 3MF / SVG / ZIP." },
              { n: 2, icon: Ruler, title: "Check fit", desc: "Live build-plate bounds, mm dimensions, printer profiles for Bambu / Prusa / Creality / Voron and more." },
              { n: 3, icon: Download, title: "Export STL / 3MF", desc: "Watertight mesh repair (pymeshfix) runs on export. Multi-object 3MF preserves positives, negatives, and group hierarchy." },
              { n: 4, icon: Slice, title: "Slice", desc: "Three options — full detail below." },
              { n: 5, icon: Printer, title: "Print", desc: "Save the G-code to SD / USB / network, or your slicer pushes it to the printer directly." },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <li
                  key={s.n}
                  data-testid={`design-to-print-step-${s.n}`}
                  className="relative rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center">
                      {s.n}
                    </span>
                    <Icon size={15} className="text-slate-300" />
                    <div className="text-[13px] font-semibold text-white">{s.title}</div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{s.desc}</p>
                </li>
              );
            })}
          </ol>

          {/* ─── Three slicing paths, explicit ────────────────────────
              Below the linear 5-step ribbon, the slice step (step 4)
              fans out into the three actual routes. Each card calls
              out exactly what runs WHERE, so a visitor can plan
              their workflow before signing up. */}
          <div className="mt-6 grid md:grid-cols-3 gap-3" data-testid="design-to-print-slicing-paths">
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Cpu size={16} className="text-cyan-300" />
                <div className="text-[13px] font-semibold text-white">In-browser slicer</div>
                <span className="ml-auto text-[9px] uppercase tracking-widest text-cyan-300 font-semibold">default</span>
              </div>
              <p className="text-[11px] text-slate-300/90 leading-relaxed">
                A built-in JavaScript engine runs entirely in your tab. Walls, infill, supports, layer preview — no upload, no waiting, no account required.
              </p>
            </div>
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/[0.04] p-4">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive size={16} className="text-orange-300" />
                <div className="text-[13px] font-semibold text-white">Server-side OrcaSlicer</div>
                <span className="ml-auto text-[9px] uppercase tracking-widest text-orange-300 font-semibold">opt-in</span>
              </div>
              <p className="text-[11px] text-slate-300/90 leading-relaxed">
                Production-grade G-code from the real OrcaSlicer CLI on our server. AMS profiles, tree supports, ironing, calibrated retraction — picked from the Engine selector inside the workspace.
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Download size={16} className="text-emerald-300" />
                <div className="text-[13px] font-semibold text-white">Open in your desktop slicer</div>
                <span className="ml-auto text-[9px] uppercase tracking-widest text-emerald-300 font-semibold">export</span>
              </div>
              <p className="text-[11px] text-slate-300/90 leading-relaxed">
                Export STL or 3MF and open in OrcaSlicer, Bambu Studio, PrusaSlicer, Cura — anywhere you already work. Custom-slicer deep-links (e.g.{" "}
                <span className="font-mono text-emerald-200">orcaslicer://</span>) are supported too.
              </p>
            </div>
          </div>

          <p className="mt-5 text-center text-[11px] text-slate-500 max-w-2xl mx-auto leading-relaxed">
            All three paths share the same modelling workspace, the same printer profiles, and the same compatibility checks — pick whichever fits your hardware. You can switch engines per project without re-modelling.
          </p>
        </section>

        <BeginnerStarters />

        </>)}

        {activeTab === "learn" && (<>

        {/* ─── Learn promo strip ──────────────────────────────────
            Teaches the visitor that we have a beginner-friendly
            documentation surface BEFORE they go hunting in /help.
            Sits between the Starters (which are doing) and the
            community gallery (which is browsing) so the journey
            reads: "do → learn → browse → build". */}
        <section
          data-testid="landing-learn-promo"
          className="mt-4"
          aria-labelledby="landing-learn-heading"
        >
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] via-slate-950/30 to-emerald-500/[0.03] p-7 sm:p-10">
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-[10px] uppercase tracking-widest text-emerald-300 font-semibold mb-4">
                  <GraduationCap size={11} /> Learn
                </div>
                <h2
                  id="landing-learn-heading"
                  className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight"
                >
                  New to 3D design?{" "}
                  <span className="text-emerald-300">Eight short lessons</span>{" "}
                  get you printing.
                </h2>
                <p className="mt-4 text-slate-300 text-sm leading-relaxed">
                  Beginner-friendly explainers covering CAD basics, STL vs 3MF, boolean operations, wall thickness, tolerances, designing for FDM, common first-print mistakes, and exporting to OrcaSlicer / Bambu Studio / PrusaSlicer.
                </p>
                <p className="mt-2 text-slate-400 text-xs leading-relaxed">
                  Practical numbers (≥&nbsp;1.6&nbsp;mm walls, 0.15&nbsp;mm push-fit clearance, 45° overhang rule), no jargon, every lesson under 6&nbsp;minutes.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    to="/learn"
                    data-testid="landing-learn-cta"
                    className="inline-flex items-center gap-1.5 h-10 px-5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-full transition"
                  >
                    <BookOpen size={15} /> Open the Learn section
                  </Link>
                  <Link
                    to="/learn/common-mistakes"
                    data-testid="landing-learn-mistakes-shortcut"
                    className="inline-flex items-center gap-1.5 h-10 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-full transition"
                  >
                    Top-10 beginner mistakes <ChevronRight size={13} />
                  </Link>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { slug: "cad-basics", title: "CAD basics", min: 4 },
                  { slug: "file-types", title: "STL · 3MF · G-code", min: 5 },
                  { slug: "wall-thickness", title: "Wall thickness", min: 3 },
                  { slug: "tolerances", title: "Tolerances & fit", min: 4 },
                  { slug: "boolean-operations", title: "Booleans", min: 4 },
                  { slug: "exporting-to-slicers", title: "Slicer hand-off", min: 5 },
                ].map((l) => (
                  <Link
                    key={l.slug}
                    to={`/learn/${l.slug}`}
                    data-testid={`landing-learn-card-${l.slug}`}
                    className="rounded-lg border border-slate-800 bg-slate-950/70 hover:border-emerald-500/40 p-3 transition flex flex-col gap-1"
                  >
                    <div className="text-[12px] font-semibold text-white truncate">{l.title}</div>
                    <div className="text-[10px] text-slate-400">{l.min} min read</div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        </>)}

        {activeTab === "templates" && <LandingTemplates />}

        {activeTab === "gallery" && <LandingCommunityStrip />}

        {activeTab === "trust" && (
          <section
            data-testid="landing-trust-tab"
            className="mt-4"
            aria-labelledby="landing-trust-heading"
          >
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-sky-500/10 border border-sky-500/30 rounded-full text-[10px] uppercase tracking-widest text-sky-300 font-semibold">
                <Shield size={11} /> Trust &amp; Transparency
              </div>
              <h2
                id="landing-trust-heading"
                className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight"
              >
                Private by default.{" "}
                <span className="text-sky-300">Public only when you say so.</span>
              </h2>
              <p className="mt-3 text-slate-400 text-sm max-w-2xl mx-auto leading-relaxed">
                Every design starts private and stays local until you sign in and explicitly publish. You own your exports — STL, 3MF, OBJ, G-code — without watermarks or invisible identifiers.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {PRIVACY_FACTS.slice(0, 4).map((fact, i) => (
                <div
                  key={fact.title}
                  data-testid={`landing-trust-fact-${i}`}
                  className="border border-slate-800 bg-slate-900/60 rounded-lg p-5 hover:border-sky-500/40 transition-colors"
                >
                  <div className="w-9 h-9 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 flex items-center justify-center mb-3">
                    <Lock size={15} />
                  </div>
                  <h3 className="text-[13px] font-bold text-white leading-snug">{fact.title}</h3>
                  <p className="mt-2 text-xs text-slate-400 leading-relaxed">{fact.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Link
                to="/trust"
                data-testid="landing-trust-cta-full"
                className="inline-flex items-center gap-1.5 h-10 px-5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold rounded-full transition"
              >
                <Shield size={15} /> Read the full Trust hub
              </Link>
              <Link
                to="/privacy"
                data-testid="landing-trust-cta-privacy"
                className="inline-flex items-center gap-1.5 h-10 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-full transition"
              >
                Privacy details <ChevronRight size={13} />
              </Link>
              <Link
                to="/changelog"
                data-testid="landing-trust-cta-changelog"
                className="inline-flex items-center gap-1.5 h-10 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-full transition"
              >
                Changelog <ChevronRight size={13} />
              </Link>
            </div>
          </section>
        )}

        </div>
      </main>

      <footer className="border-t border-slate-800 py-10 px-6" data-testid="landing-footer">
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-8 text-[12px]">
          {/* Product column — keep ForgeSlicer's tagline first so the
              footer leads with brand, not links. */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-2">
              <img src="/forgeslicer-logo.webp" alt="" width={20} height={20} className="rounded" />
              <div className="text-[13px] font-bold text-white">ForgeSlicer</div>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Browser CAD + slicer for 3D printing. Free for the core toolkit. Private by default.
            </p>
            <div className="mt-3 text-[10px] text-slate-600">
              Part of the Forge Suite ·{" "}
              <a href="https://lithoforge.net" target="_blank" rel="noopener noreferrer" onClick={openLithoForge} className="text-orange-400/80 hover:text-orange-300">
                LithoForge
              </a>{" "}for lithophanes &amp; multi-color prints
            </div>
          </div>

          {/* Product column */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">Product</div>
            <ul className="space-y-1.5 text-slate-300">
              <li><Link to="/workspace" className="hover:text-white">Workspace</Link></li>
              <li><Link to="/gallery" className="hover:text-white">Public Gallery</Link></li>
              <li><Link to="/learn" className="hover:text-white">Learn (8 lessons)</Link></li>
              <li><Link to="/browser-cad" className="hover:text-white">Browser CAD</Link></li>
              <li><Link to="/ai-3d-design" className="hover:text-white">AI 3D Design</Link></li>
            </ul>
          </div>

          {/* Workflows column — surfaces the slicer-specific SEO
              landings so the footer doubles as discovery. */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">Workflows</div>
            <ul className="space-y-1.5 text-slate-300">
              <li><Link to="/orcaslicer-workflow" className="hover:text-white">OrcaSlicer</Link></li>
              <li><Link to="/bambu-studio-workflow" className="hover:text-white">Bambu Studio</Link></li>
              <li><Link to="/prusaslicer-workflow" className="hover:text-white">PrusaSlicer</Link></li>
              <li><Link to="/edit-stl-online" className="hover:text-white">Edit STL Online</Link></li>
              <li><Link to="/tinkercad-alternative" className="hover:text-white">TinkerCAD Alternative</Link></li>
            </ul>
          </div>

          {/* Trust & transparency column — the credibility surface.
              Six high-trust links arranged in priority order so the
              first item a visitor sees is privacy, not contact. */}
          <div data-testid="landing-footer-trust-column">
            <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold mb-2 flex items-center gap-1">
              <Shield size={11} /> Trust &amp; transparency
            </div>
            <ul className="space-y-1.5 text-slate-300">
              <li><Link to="/privacy" data-testid="footer-trust-privacy" className="hover:text-white">Privacy &amp; data handling</Link></li>
              <li><Link to="/roadmap" data-testid="footer-trust-roadmap" className="hover:text-white">Roadmap</Link></li>
              <li><Link to="/changelog" data-testid="footer-trust-changelog" className="hover:text-white">Changelog</Link></li>
              <li><Link to="/browser-support" data-testid="footer-trust-browser-support" className="hover:text-white">Browser support</Link></li>
              <li><Link to="/trust#limits" data-testid="footer-trust-limits" className="hover:text-white">File size &amp; limits</Link></li>
              <li>
                <a href="mailto:support@forgeslicer.com" data-testid="footer-trust-contact" className="hover:text-white inline-flex items-center gap-1">
                  Contact support
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-4 border-t border-slate-900 max-w-6xl mx-auto text-center text-[10px] text-slate-600">
          © 2026 ForgeSlicer · Private by default. You own your exports.
        </div>
      </footer>
    </div>
  );
}

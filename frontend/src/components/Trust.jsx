// Trust — credibility & product-status hub.
//
// One file, five routes:
//   /trust            → hub with teasers for all sections (default)
//   /privacy          → privacy & data-handling
//   /changelog        → release notes
//   /roadmap          → forward-looking plans
//   /browser-support  → browser matrix + technical requirements
//
// Why a single component:
//   - All five share the same header / footer / layout.
//   - Hub teasers + dedicated pages render from the same source of
//     truth (lib/trustContent.js) — a fact changes in one place.
//   - Routing remains trivial (one `<Trust view="…">` per route).
//
// Tone:
//   - Plain English. The point of these pages is to feel reliable,
//     not legal. Privacy facts read like a friendly FAQ; the
//     roadmap is honest about what's planned vs. shipped.
//   - "Last updated" stamps on every page so visitors can see the
//     site is alive.

import React from "react";
import { Link } from "react-router-dom";
import {
    ChevronRight, Rocket, GraduationCap, Mail, Shield, FileText, Map,
    Globe, AlertTriangle, HardDrive, GitFork, CheckCircle2, Clock,
} from "lucide-react";
import {
    ROADMAP_ITEMS, CHANGELOG_ENTRIES, BROWSER_SUPPORT, BROWSER_REQUIREMENTS,
    FILE_LIMITS, KNOWN_LIMITATIONS, PRIVACY_FACTS, DESIGN_OWNERSHIP, SUPPORT_CONTACT,
} from "../lib/trustContent";
import { useDocumentMeta } from "../lib/useDocumentMeta";

// ─── Shared chrome ────────────────────────────────────────────────
function TrustHeader() {
    return (
        <header className="h-14 border-b border-slate-800 bg-slate-950/70 backdrop-blur flex items-center px-6 sticky top-0 z-10">
            <Link to="/" className="flex items-center gap-2 select-none">
                <img src="/forgeslicer-logo.webp" alt="ForgeSlicer" width={28} height={28} className="rounded shadow-lg shadow-orange-900/30" />
                <div className="leading-tight">
                    <div className="text-[14px] font-bold tracking-tight">ForgeSlicer</div>
                    <div className="text-[9px] uppercase tracking-widest text-orange-400 -mt-0.5">CAD + Slice</div>
                </div>
            </Link>
            <div className="flex-1" />
            <Link to="/trust" className="h-8 px-3 text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
                <Shield size={14} /> Trust
            </Link>
            <Link to="/learn" className="h-8 px-3 text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
                <GraduationCap size={14} /> Learn
            </Link>
            <Link to="/gallery" className="h-8 px-3 text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
                Public Gallery
            </Link>
            <Link to="/workspace" className="h-8 px-4 ml-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5">
                Launch Workspace <ChevronRight size={14} />
            </Link>
        </header>
    );
}

function PageShell({ children, view }) {
    return (
        <div className="min-h-screen bg-slate-950 text-white" data-testid={`trust-page-${view}`} style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
            <TrustHeader />
            <main className="max-w-4xl mx-auto px-6 pt-12 pb-20">{children}</main>
            <footer className="mt-16 border-t border-slate-800 py-6 px-6 max-w-4xl mx-auto text-center text-[11px] text-slate-500">
                Last updated 27 June 2026 ·{" "}
                <Link to="/trust" className="hover:text-white">Trust hub</Link>{" · "}
                <Link to="/" className="hover:text-white">Back to ForgeSlicer</Link>
            </footer>
        </div>
    );
}

function PageHero({ icon: Icon, eyebrow, title, intro, accent = "text-orange-300" }) {
    return (
        <div className="mb-10">
            <div className={`inline-flex items-center gap-1.5 px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded-full text-[10px] uppercase tracking-widest ${accent} font-semibold`}>
                <Icon size={11} /> {eyebrow}
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl font-bold tracking-tight leading-tight">{title}</h1>
            {intro && <p className="mt-4 text-slate-300 text-base leading-relaxed max-w-3xl">{intro}</p>}
        </div>
    );
}

// ─── /trust — hub ──────────────────────────────────────────────────
function TrustHub() {
    useDocumentMeta({
        title: "Trust & Transparency — ForgeSlicer",
        description: "ForgeSlicer's trust hub — roadmap, changelog, browser support, known limitations, file size limits, privacy & data handling, design ownership, and how to contact support.",
        keywords: "ForgeSlicer trust, privacy, roadmap, changelog, browser support, design ownership, ForgeSlicer support",
    });

    const cards = [
        { to: "/privacy", icon: Shield, accent: "text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.06]", title: "Privacy & data handling", body: "Private by default. We don't make uploads public, ever. You own what you export." },
        { to: "/changelog", icon: FileText, accent: "text-cyan-300 border-cyan-500/30 bg-cyan-500/[0.06]", title: "Changelog", body: "Every release, in plain English. Newest at the top." },
        { to: "/roadmap", icon: Map, accent: "text-amber-300 border-amber-500/30 bg-amber-500/[0.06]", title: "Roadmap", body: "What's in progress, what's planned, what's on the backlog. Honest priorities." },
        { to: "/browser-support", icon: Globe, accent: "text-violet-300 border-violet-500/30 bg-violet-500/[0.06]", title: "Browser support", body: "Chrome 110+, Firefox 115+, Safari 16+, Edge 110+. Mobile is view-only." },
        { to: "/trust#limits", icon: HardDrive, accent: "text-orange-300 border-orange-500/30 bg-orange-500/[0.06]", title: "File size & limits", body: "STL ≤ 100 MB, OBJ ≤ 50 MB, 3MF ≤ 80 MB. Up to 200 primitives per scene." },
        { to: "/trust#limitations", icon: AlertTriangle, accent: "text-rose-300 border-rose-500/30 bg-rose-500/[0.06]", title: "Known limitations", body: "What we don't ship yet — curved-surface text, multi-user editing, mobile editing." },
        { to: "/trust#ownership", icon: GitFork, accent: "text-orange-300 border-orange-500/30 bg-orange-500/[0.06]", title: "Design ownership", body: "Your exports are yours. Published designs use the license you pick." },
        { to: "/trust#contact", icon: Mail, accent: "text-slate-300 border-slate-700 bg-slate-900/60", title: "Support & contact", body: SUPPORT_CONTACT.primaryEmail },
    ];

    return (
        <PageShell view="hub">
            <PageHero icon={Shield} eyebrow="Trust" title="What we ship, and how we treat your work." intro="Eight short sections covering the product status, the technical limits, and the privacy decisions. No legalese." />

            <div className="grid sm:grid-cols-2 gap-3" data-testid="trust-hub-cards">
                {cards.map((c) => (
                    <Link
                        key={c.to + c.title}
                        to={c.to}
                        data-testid={`trust-hub-card-${c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`}
                        className={`rounded-xl border p-4 hover:border-orange-500/40 transition flex items-start gap-3 ${c.accent}`}
                    >
                        <c.icon size={18} className="mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <div className="text-[13px] font-semibold text-white">{c.title}</div>
                            <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">{c.body}</p>
                        </div>
                        <ChevronRight size={14} className="mt-0.5 text-slate-400" />
                    </Link>
                ))}
            </div>

            {/* Anchored sections — File limits, Limitations, Ownership,
                Contact. Each scrolls into view when the hub cards
                link to /trust#<id>. Privacy + Changelog + Roadmap +
                Browser-support get their own dedicated routes so the
                hub teasers don't duplicate full content. */}
            <Section id="limits" title="File size & import limits" icon={HardDrive}>
                <ul className="space-y-2 text-[13px] text-slate-300">
                    {FILE_LIMITS.map((f) => (
                        <li key={f.kind} className="flex items-start gap-3 border-t border-slate-800 pt-2">
                            <span className="font-semibold text-white w-44 flex-shrink-0">{f.kind}</span>
                            <span className="font-mono text-orange-300 w-28 flex-shrink-0">{f.limit}</span>
                            <span className="text-slate-400 leading-relaxed">{f.note}</span>
                        </li>
                    ))}
                </ul>
            </Section>

            <Section id="limitations" title="Known limitations" icon={AlertTriangle}>
                <div className="grid sm:grid-cols-2 gap-3">
                    {KNOWN_LIMITATIONS.map((l) => (
                        <div key={l.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                            <div className="text-[13px] font-semibold text-white">{l.title}</div>
                            <p className="mt-1 text-[12px] text-slate-400 leading-relaxed">{l.body}</p>
                        </div>
                    ))}
                </div>
            </Section>

            <Section id="ownership" title="Design ownership" icon={GitFork}>
                <ul className="space-y-3">
                    {DESIGN_OWNERSHIP.map((o) => (
                        <li key={o.title}>
                            <div className="text-[13px] font-semibold text-white">{o.title}</div>
                            <p className="mt-0.5 text-[12px] text-slate-300 leading-relaxed">{o.body}</p>
                        </li>
                    ))}
                </ul>
            </Section>

            <Section id="contact" title="Support & contact" icon={Mail}>
                <div className="rounded-xl border border-orange-500/30 bg-orange-500/[0.06] p-5 flex items-start gap-3" data-testid="trust-contact-block">
                    <Mail size={18} className="text-orange-300 mt-0.5 flex-shrink-0" />
                    <div>
                        <div className="text-[13px] font-semibold text-white">Email support</div>
                        <p className="mt-1 text-[12px] text-slate-300 leading-relaxed">
                            <a href={`mailto:${SUPPORT_CONTACT.primaryEmail}`} className="text-orange-300 hover:text-orange-200 underline underline-offset-2 font-mono" data-testid="trust-contact-email">
                                {SUPPORT_CONTACT.primaryEmail}
                            </a>
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">{SUPPORT_CONTACT.responseTimeSla}</p>
                    </div>
                </div>
            </Section>
        </PageShell>
    );
}

function Section({ id, title, icon: Icon, children }) {
    return (
        <section id={id} className="mt-14 scroll-mt-20" data-testid={`trust-hub-section-${id}`}>
            <div className="flex items-center gap-2 mb-4">
                <Icon size={15} className="text-orange-300" />
                <h2 className="text-xl font-semibold text-white">{title}</h2>
            </div>
            {children}
        </section>
    );
}

// ─── /privacy ──────────────────────────────────────────────────────
function PrivacyPage() {
    useDocumentMeta({
        title: "Privacy & Data Handling — ForgeSlicer",
        description: "ForgeSlicer privacy facts in plain English. Private by default. Uploaded files are not made public. You own what you export. Account, voice, and AI data handling explained.",
        keywords: "ForgeSlicer privacy, 3D design privacy, private by default, design ownership, data handling, no upload to public",
    });
    return (
        <PageShell view="privacy">
            <PageHero
                icon={Shield}
                eyebrow="Privacy"
                title="Private by default."
                intro="Plain-English answers to the privacy questions makers actually ask. No legalese, no dark patterns. Last reviewed June 2026."
                accent="text-emerald-300"
            />
            {/* The headline three guarantees on a high-contrast card */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-6 mb-10" data-testid="privacy-headline-guarantees">
                <div className="grid sm:grid-cols-3 gap-4">
                    <Guarantee icon={Shield} title="Private by default" body="Every design starts private. Nothing publishes itself." />
                    <Guarantee icon={GitFork} title="You own your exports" body="STL, 3MF, OBJ — all yours. We claim no rights." />
                    <Guarantee icon={CheckCircle2} title="No silent uploads" body="Files you import are not made public unless you explicitly publish them." />
                </div>
            </div>

            <ol className="space-y-6" data-testid="privacy-facts">
                {PRIVACY_FACTS.map((p, i) => (
                    <li key={p.title} className="border-l-2 border-emerald-500/40 pl-4">
                        <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-mono text-emerald-300">{String(i + 1).padStart(2, "0")}</span>
                            <h2 className="text-[15px] font-semibold text-white">{p.title}</h2>
                        </div>
                        <p className="mt-1 text-[13px] text-slate-300 leading-relaxed">{p.body}</p>
                    </li>
                ))}
            </ol>

            <div className="mt-12 rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex items-center gap-3" data-testid="privacy-contact-cta">
                <Mail size={16} className="text-slate-300" />
                <div className="text-[12px] text-slate-300 flex-1">
                    Questions or a data-deletion request?{" "}
                    <a href={`mailto:${SUPPORT_CONTACT.primaryEmail}`} className="text-orange-300 hover:text-orange-200 underline underline-offset-2 font-mono">
                        {SUPPORT_CONTACT.primaryEmail}
                    </a>
                </div>
            </div>
        </PageShell>
    );
}

function Guarantee({ icon: Icon, title, body }) {
    return (
        <div>
            <Icon size={18} className="text-emerald-300 mb-2" />
            <div className="text-[13px] font-semibold text-white">{title}</div>
            <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">{body}</p>
        </div>
    );
}

// ─── /changelog ────────────────────────────────────────────────────
function ChangelogPage() {
    useDocumentMeta({
        title: "Changelog — ForgeSlicer",
        description: "Every ForgeSlicer release in plain English. Newest first. See what shipped, what's been improved, and what's coming next.",
        keywords: "ForgeSlicer changelog, release notes, ForgeSlicer updates, what's new",
    });
    return (
        <PageShell view="changelog">
            <PageHero
                icon={FileText}
                eyebrow="Changelog"
                title="What shipped, and when."
                intro="Each entry is short — 5 minutes from start to bottom. Newest releases on top. For the unreleased plan, see the Roadmap."
                accent="text-cyan-300"
            />
            <ol className="space-y-7" data-testid="changelog-entries">
                {CHANGELOG_ENTRIES.map((e) => (
                    <li key={e.version} className="border-l-2 border-cyan-500/40 pl-4">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono text-cyan-300">{e.date}</span>
                            <span className="text-[10px] text-slate-500">·</span>
                            <span className="text-[12px] font-semibold text-white">v{e.version}</span>
                        </div>
                        <ul className="space-y-1 list-disc list-inside text-[12px] text-slate-300 leading-relaxed">
                            {e.highlights.map((h, i) => <li key={i}>{h}</li>)}
                        </ul>
                    </li>
                ))}
            </ol>

            <div className="mt-10 flex flex-wrap gap-2">
                <Link to="/roadmap" className="inline-flex items-center gap-1.5 h-9 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-full transition">
                    <Map size={13} /> What&apos;s next on the roadmap
                </Link>
                <Link to="/workspace" className="inline-flex items-center gap-1.5 h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-full transition">
                    <Rocket size={13} /> Try the latest
                </Link>
            </div>
        </PageShell>
    );
}

// ─── /roadmap ──────────────────────────────────────────────────────
const PRIORITY_STYLE = {
    "P0": { label: "P0 · Now", color: "text-orange-300 bg-orange-500/15 border-orange-500/40" },
    "P1": { label: "P1 · Next", color: "text-amber-300 bg-amber-500/15 border-amber-500/40" },
    "P2": { label: "P2 · Later", color: "text-slate-300 bg-slate-800 border-slate-700" },
};
function RoadmapPage() {
    useDocumentMeta({
        title: "Roadmap — ForgeSlicer",
        description: "What's in progress, planned, and on the backlog at ForgeSlicer. Honest priorities and timelines. Updated as features ship.",
        keywords: "ForgeSlicer roadmap, what's coming, upcoming features, ForgeSlicer plans",
    });
    return (
        <PageShell view="roadmap">
            <PageHero
                icon={Map}
                eyebrow="Roadmap"
                title="What's coming next."
                intro="In-progress work first, then planned, then backlog. Updated as items ship — see the Changelog for what's already done."
                accent="text-amber-300"
            />
            <ul className="space-y-3" data-testid="roadmap-items">
                {ROADMAP_ITEMS.map((r) => {
                    const ps = PRIORITY_STYLE[r.priority] || PRIORITY_STYLE.P2;
                    return (
                        <li key={r.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${ps.color}`}>{ps.label}</span>
                                <span className="text-[10px] text-slate-500">·</span>
                                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold inline-flex items-center gap-1">
                                    <Clock size={9} /> {r.status}
                                </span>
                            </div>
                            <div className="text-[14px] font-semibold text-white">{r.title}</div>
                            <p className="mt-1 text-[12px] text-slate-400 leading-relaxed">{r.body}</p>
                        </li>
                    );
                })}
            </ul>
            <p className="mt-8 text-[11px] text-slate-500">
                Want something added or prioritised?{" "}
                <a href={`mailto:${SUPPORT_CONTACT.primaryEmail}`} className="text-orange-300 hover:text-orange-200 underline underline-offset-2 font-mono">
                    {SUPPORT_CONTACT.primaryEmail}
                </a>
            </p>
        </PageShell>
    );
}

// ─── /browser-support ──────────────────────────────────────────────
function BrowserSupportPage() {
    useDocumentMeta({
        title: "Browser Support — ForgeSlicer",
        description: "ForgeSlicer browser support matrix. Chrome 110+, Firefox 115+, Safari 16+, Edge 110+. WebGL 2 + WebAssembly required. Mobile is view-only.",
        keywords: "ForgeSlicer browser support, Chrome 3D CAD, Firefox WebGL CAD, Safari CAD, Edge CAD, browser requirements",
    });
    return (
        <PageShell view="browser-support">
            <PageHero
                icon={Globe}
                eyebrow="Browser support"
                title="Which browsers we support, and why."
                intro="ForgeSlicer relies on WebGL 2 + WebAssembly + Web Speech for the full experience. Here's the exact matrix."
                accent="text-violet-300"
            />

            <div className="rounded-xl border border-slate-800 overflow-hidden" data-testid="browser-support-table">
                <table className="w-full text-[12px]">
                    <thead className="bg-slate-900">
                        <tr>
                            <th className="text-left text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-4 py-2">Browser</th>
                            <th className="text-left text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-4 py-2">Minimum version</th>
                            <th className="text-left text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-4 py-2">Status</th>
                            <th className="text-left text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-4 py-2">Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {BROWSER_SUPPORT.map((b, i) => (
                            <tr key={b.name} className={i % 2 ? "bg-slate-950/50" : "bg-slate-900/30"}>
                                <td className="px-4 py-2 text-white font-semibold">{b.name}</td>
                                <td className="px-4 py-2 font-mono text-slate-300">{b.minVersion}</td>
                                <td className="px-4 py-2"><StatusPill status={b.status} /></td>
                                <td className="px-4 py-2 text-slate-400 leading-relaxed">{b.note}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <h2 className="mt-10 text-lg font-semibold text-white mb-3">Technical requirements</h2>
            <ul className="space-y-2 text-[13px] text-slate-300" data-testid="browser-tech-reqs">
                {BROWSER_REQUIREMENTS.map((r) => (
                    <li key={r.label} className="flex items-start gap-3 border-t border-slate-800 pt-2">
                        <span className="font-semibold text-white w-44 flex-shrink-0">{r.label}</span>
                        <span className="text-slate-400 leading-relaxed">{r.req}</span>
                    </li>
                ))}
            </ul>
        </PageShell>
    );
}

function StatusPill({ status }) {
    const styles = {
        "fully-supported": "text-emerald-300 bg-emerald-500/15 border-emerald-500/40",
        "view-only":       "text-amber-300 bg-amber-500/15 border-amber-500/40",
        "not-supported":   "text-rose-300 bg-rose-500/15 border-rose-500/40",
    };
    const label = {
        "fully-supported": "Fully supported",
        "view-only":       "View only",
        "not-supported":   "Not supported",
    };
    return (
        <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${styles[status]}`}>
            {label[status]}
        </span>
    );
}

// ─── Route entrypoint ─────────────────────────────────────────────
export default function Trust({ view = "hub" }) {
    switch (view) {
        case "privacy":         return <PrivacyPage />;
        case "changelog":       return <ChangelogPage />;
        case "roadmap":         return <RoadmapPage />;
        case "browser-support": return <BrowserSupportPage />;
        default:                return <TrustHub />;
    }
}

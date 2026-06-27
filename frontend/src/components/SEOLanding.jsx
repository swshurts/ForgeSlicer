// SEOLanding — single component rendering every dedicated SEO route.
//
// One component, eight data-driven pages. Each route at /{slug}
// reads its content from SEO_LANDINGS[slug] in seo/landings.js, so
// adding a new SEO surface is one entry in the data file + one
// Route in App.js (which loops the slug list to register them).
//
// Why a unified component vs. eight bespoke pages:
//   - SEO pages share the same shape (hero, intro, 4 feature cards,
//     3-step ribbon, optional comparison table, dual-CTA footer).
//     Eight copies of the same JSX is a maintenance trap.
//   - A consistent look across SEO pages reads as a real product
//     line, not a marketing afterthought \u2014 returning visitors who
//     hit a different landing page recognise the chrome immediately.
//   - Per-page meta (title, description, keywords, canonical, OG)
//     is handled by the useDocumentMeta hook driven from the same
//     data, so the SEO metadata can never drift from the on-page
//     content the way it can with hand-written tags.
//
// Visual tone:
//   - Each page picks its own accent colour via eyebrowAccent/Bg so
//     the surfaces feel distinct on a return-visit.
//   - Layout is intentionally narrow (max-w-4xl) so the keyword-rich
//     copy reads like an article \u2014 ranks better than dense
//     marketing splash pages.
//   - The chrome (header + footer) matches the main site so the
//     visitor doesn't feel like they landed on a satellite domain.

import React from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import {
    ChevronRight, Rocket, GitFork, GraduationCap, Check, X as XIcon,
    Sparkles, BookOpen,
} from "lucide-react";
import { SEO_LANDINGS } from "../seo/landings";
import { useDocumentMeta } from "../lib/useDocumentMeta";

function SEOHeader() {
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

function SEOFooter() {
    return (
        <footer className="mt-24 border-t border-slate-800 py-7 px-6 max-w-5xl mx-auto text-center" data-testid="seo-footer">
            <p className="text-xs text-slate-400 leading-relaxed">
                ForgeSlicer is a browser-based CAD &amp; 3D printing tool. Free for the core toolkit. Slice in browser, on our OrcaSlicer engine, or export STL / 3MF to your desktop slicer.
            </p>
            <div className="mt-3 flex items-center justify-center gap-3 flex-wrap text-[11px] text-slate-500">
                <Link to="/" className="hover:text-white">Home</Link>
                <span>·</span>
                <Link to="/learn" className="hover:text-white">Learn</Link>
                <span>·</span>
                <Link to="/gallery" className="hover:text-white">Gallery</Link>
                <span>·</span>
                <Link to="/workspace" className="hover:text-white">Workspace</Link>
            </div>
        </footer>
    );
}

export default function SEOLanding({ routeSlug }) {
    // The route registers explicit paths (e.g. `/tinkercad-alternative`)
    // so useParams() returns nothing. Each Route passes its slug
    // as a prop instead — keeps the routing table the source of
    // truth and the component agnostic of the URL shape.
    const { slug: paramSlug } = useParams();
    const slug = routeSlug || paramSlug;
    const data = SEO_LANDINGS[slug];

    // Apply per-route meta. Hook must be called before any early
    // return so it's invoked on every render (React rule).
    useDocumentMeta({
        title: data?.title,
        description: data?.description,
        keywords: data?.keywords,
    });

    if (!data) return <Navigate to="/" replace />;

    return (
        <div className="min-h-screen bg-slate-950 text-white" data-testid={`seo-landing-${slug}`} style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
            <SEOHeader />
            <main className="max-w-4xl mx-auto px-6 pt-14 pb-16">
                {/* Hero */}
                <div className={`inline-flex items-center gap-1.5 px-2 py-1 ${data.eyebrowBg} border rounded-full text-[10px] uppercase tracking-widest ${data.eyebrowAccent} font-semibold`}>
                    {data.eyebrow}
                </div>
                <h1
                    className="mt-5 text-4xl sm:text-5xl font-bold tracking-tight leading-tight"
                    data-testid={`seo-landing-headline-${slug}`}
                >
                    {data.headline}{" "}
                    <span className={data.eyebrowAccent}>{data.headlineAccent}</span>
                </h1>
                <p className="mt-5 text-slate-300 text-base leading-relaxed max-w-3xl">
                    {data.intro}
                </p>

                {/* Primary CTAs */}
                <div className="mt-6 flex flex-wrap gap-2.5">
                    <Link
                        to="/workspace"
                        data-testid={`seo-landing-cta-primary-${slug}`}
                        className="inline-flex items-center gap-1.5 h-11 px-6 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-full transition"
                    >
                        <Rocket size={15} /> Launch the workspace
                    </Link>
                    <Link
                        to="/gallery"
                        data-testid={`seo-landing-cta-secondary-${slug}`}
                        className="inline-flex items-center gap-1.5 h-11 px-5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white text-sm font-semibold rounded-full transition"
                    >
                        <GitFork size={14} /> See community designs
                    </Link>
                </div>

                {/* Feature cards */}
                <section className="mt-16">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3">What you actually get</div>
                    <div className="grid sm:grid-cols-2 gap-3" data-testid={`seo-landing-features-${slug}`}>
                        {data.features.map((f, i) => (
                            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                                <div className="text-[13px] font-semibold text-white mb-1.5">{f.title}</div>
                                <p className="text-[12px] text-slate-300 leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* 3-step ribbon */}
                <section className="mt-12">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3">How it works</div>
                    <ol className="grid sm:grid-cols-3 gap-2.5" data-testid={`seo-landing-howsteps-${slug}`}>
                        {data.howSteps.map((s, i) => (
                            <li key={i} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col gap-1.5">
                                <div className="flex items-center gap-2">
                                    <span className={`w-6 h-6 rounded-full ${data.eyebrowBg} border text-[11px] font-bold flex items-center justify-center ${data.eyebrowAccent}`}>
                                        {i + 1}
                                    </span>
                                    <div className="text-[13px] font-semibold text-white">{s.title}</div>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-relaxed">{s.desc}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                {/* Optional comparison table — only renders when the
                    landing data ships one (currently TinkerCAD only). */}
                {Array.isArray(data.comparisonRows) && data.comparisonRows.length > 0 && (
                    <section className="mt-12" data-testid={`seo-landing-comparison-${slug}`}>
                        <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3">At a glance</div>
                        <div className="rounded-xl border border-slate-800 overflow-hidden">
                            <table className="w-full text-[12px]">
                                <thead className="bg-slate-900">
                                    <tr>
                                        <th className="text-left text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-4 py-2">Feature</th>
                                        <th className="text-center text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-4 py-2">TinkerCAD</th>
                                        <th className={`text-center text-[10px] uppercase tracking-widest font-semibold px-4 py-2 ${data.eyebrowAccent}`}>ForgeSlicer</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.comparisonRows.map((row, i) => (
                                        <tr key={i} className={i % 2 ? "bg-slate-950/50" : "bg-slate-900/30"}>
                                            <td className="px-4 py-2 text-slate-300">{row.feature}</td>
                                            <td className="px-4 py-2 text-center">
                                                {row.a ? <Check size={14} className="text-emerald-400 inline" /> : <XIcon size={14} className="text-slate-600 inline" />}
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                                {row.b ? <Check size={14} className="text-orange-400 inline" /> : <XIcon size={14} className="text-slate-600 inline" />}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* Trust + dual CTA footer */}
                <section className="mt-14 rounded-2xl border border-orange-500/30 bg-orange-500/[0.06] p-6 flex flex-col sm:flex-row items-start gap-4">
                    <Sparkles size={20} className="text-orange-300 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <div className="text-[14px] font-semibold text-white">Ready to design something?</div>
                        <p className="mt-1 text-[12px] text-slate-300 leading-relaxed">
                            The workspace is free, runs in your browser, and ships with 12 beginner starter templates so you don&apos;t face a blank canvas.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Link
                                to="/workspace"
                                data-testid={`seo-landing-tail-cta-${slug}`}
                                className="inline-flex items-center gap-1.5 h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-full transition"
                            >
                                Launch workspace <ChevronRight size={13} />
                            </Link>
                            <Link
                                to="/learn"
                                className="inline-flex items-center gap-1.5 h-9 px-4 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white text-xs font-semibold rounded-full transition"
                            >
                                <BookOpen size={13} /> Read beginner lessons
                            </Link>
                        </div>
                    </div>
                </section>
            </main>
            <SEOFooter />
        </div>
    );
}

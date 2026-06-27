// Learn — the beginner education surface.
//
// Two responsibilities in a single component (driven by the URL):
//   1. /learn        → the index: a card grid + a 3-step "start here"
//                      ribbon for absolute first-time visitors.
//   2. /learn/<slug> → the lesson page: title, summary, sections
//                      rendered from the LESSONS data, a recap line,
//                      and a "next lesson" / CTA strip.
//
// Why one component:
//   - Routes are simple and share the same chrome (header sits in
//     this component, not in the App router).
//   - Lessons + index always render from the same source of truth so
//     a content writer changes lessons.js and both surfaces update.
//   - The visitor's mental model is "I'm in the Learn section"; a
//     unified component keeps the back / forward navigation clean.
//
// Tone choices baked into the rendering:
//   - The reading-minutes pill is a promise: each lesson is short.
//     Surface it on every card AND on the detail page so the
//     promise is visible everywhere.
//   - The recap line is rendered as a distinct callout because
//     skim-readers WILL skip the body — the recap has to land on its
//     own.
//   - The CTA at the end of each lesson is always an action ("Open
//     the workspace", "Try a starter") — never another lesson link
//     unless the action genuinely IS reading more. We want the user
//     to leave Learn and start designing.

import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
    ArrowLeft, ChevronRight, Clock, GraduationCap, Sparkles,
    Box, FileText, Combine, Layers, Ruler, Compass, AlertTriangle, Download,
    BookOpen, Rocket,
} from "lucide-react";
import { LESSONS, LESSONS_BY_SLUG } from "../learn/lessons";

// Maps the lesson `icon` string to the actual lucide icon component.
// Centralised so a writer references icons by name in lessons.js.
const ICONS = {
    Box, FileText, Combine, Layers, Ruler, Compass, AlertTriangle, Download,
};

// Inline-formatter — turns **bold** spans inside lesson bodies into
// real <strong>. Avoids pulling in a full markdown engine for one
// formatting hint. Pure render — safe for any string lesson author
// might write.
function formatInline(text) {
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
    return parts.map((seg, i) => {
        if (/^\*\*[^*]+\*\*$/.test(seg)) {
            return (
                <strong key={i} className="text-white font-semibold">
                    {seg.slice(2, -2)}
                </strong>
            );
        }
        // Render *italic* too for the rare em-phasis we use.
        const ital = seg.split(/(\*[^*]+\*)/g);
        return ital.map((s, j) => {
            if (/^\*[^*]+\*$/.test(s)) {
                return <em key={`${i}-${j}`} className="text-slate-200">{s.slice(1, -1)}</em>;
            }
            return <React.Fragment key={`${i}-${j}`}>{s}</React.Fragment>;
        });
    });
}

// ─── Shared chrome ────────────────────────────────────────────────
function LearnHeader() {
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
            <Link to="/learn" data-testid="learn-header-home" className="h-8 px-3 text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
                <GraduationCap size={14} /> Learn
            </Link>
            <Link to="/gallery" className="h-8 px-3 text-xs text-slate-300 hover:text-white flex items-center gap-1.5">
                Public Gallery
            </Link>
            <Link to="/workspace" data-testid="learn-launch-workspace" className="h-8 px-4 ml-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center gap-1.5">
                Launch Workspace <ChevronRight size={14} />
            </Link>
        </header>
    );
}

// ─── /learn — Index page ──────────────────────────────────────────
function LearnIndex() {
    return (
        <div className="min-h-screen bg-slate-950 text-white" data-testid="learn-index" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
            <LearnHeader />
            <main className="max-w-5xl mx-auto px-6 pt-12 pb-24">
                {/* Hero */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">
                        <GraduationCap size={11} /> Learn
                    </div>
                    <h1 className="mt-5 text-4xl sm:text-5xl font-bold tracking-tight leading-tight" data-testid="learn-heading">
                        From zero to <span className="text-orange-400">first successful print</span>.
                    </h1>
                    <p className="mt-4 text-slate-400 text-base max-w-2xl mx-auto leading-relaxed">
                        Eight short lessons covering the CAD basics, file formats, design rules, and slicer hand-off you actually need to ship your first design. Beginner-friendly, practical, opinionated where it helps.
                    </p>
                </div>

                {/* Start-here ribbon — three pragmatic next steps so the
                    visitor never wonders where to click first. */}
                <div className="grid sm:grid-cols-3 gap-3 mb-12" data-testid="learn-start-here-ribbon">
                    <StartHereCard
                        num={1}
                        title="Read 3 lessons"
                        body="CAD basics, wall thickness, and the top-10 mistakes — the floor of what avoids a failed print."
                    />
                    <StartHereCard
                        num={2}
                        title="Customize a Starter"
                        body="Pick a Beginner Starter on the homepage. Each one drops a real, printable design into the workspace."
                    />
                    <StartHereCard
                        num={3}
                        title="Hand off to your slicer"
                        body="Export 3MF, open in OrcaSlicer / Bambu Studio / PrusaSlicer, and print. The exporting lesson covers each."
                    />
                </div>

                {/* Lesson cards */}
                <div className="mb-3 flex items-center gap-2">
                    <BookOpen size={14} className="text-slate-400" />
                    <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Lessons</span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="learn-lesson-grid">
                    {LESSONS.map((l) => (
                        <LessonCard key={l.slug} lesson={l} />
                    ))}
                </div>

                {/* Tail CTA */}
                <div className="mt-12 text-center">
                    <Link
                        to="/workspace"
                        data-testid="learn-tail-cta"
                        className="inline-flex items-center gap-1.5 h-11 px-6 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-full transition"
                    >
                        <Rocket size={16} /> Start your first design
                    </Link>
                    <p className="mt-3 text-xs text-slate-500">
                        You can come back to any lesson with the <span className="font-semibold text-slate-300">Learn</span> link in the header.
                    </p>
                </div>
            </main>
        </div>
    );
}

function StartHereCard({ num, title, body }) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center justify-center">
                    {num}
                </span>
                <div className="text-[13px] font-semibold text-white">{title}</div>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{body}</p>
        </div>
    );
}

function LessonCard({ lesson }) {
    const Icon = ICONS[lesson.icon] || Box;
    return (
        <Link
            to={`/learn/${lesson.slug}`}
            data-testid={`learn-lesson-card-${lesson.slug}`}
            className="group rounded-xl overflow-hidden border border-slate-800 bg-slate-900/60 hover:border-orange-500/40 transition-colors flex flex-col"
        >
            <div className={`p-5 bg-gradient-to-br ${lesson.accent} border-b border-slate-800`}>
                <Icon size={22} className={lesson.accentColor} />
            </div>
            <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <h3 className="text-[14px] font-semibold text-white leading-tight flex-1">{lesson.title}</h3>
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 font-mono whitespace-nowrap" aria-label={`${lesson.minutes} minute read`}>
                        <Clock size={10} /> {lesson.minutes} min
                    </span>
                </div>
                <p className="text-[12px] text-slate-400 leading-relaxed">{lesson.summary}</p>
                <div className="mt-auto pt-2 text-[11px] text-orange-300 font-semibold group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5">
                    Read lesson <ChevronRight size={12} />
                </div>
            </div>
        </Link>
    );
}

// ─── /learn/:slug — Detail page ───────────────────────────────────
function LearnLesson({ slug }) {
    const navigate = useNavigate();
    const lesson = LESSONS_BY_SLUG[slug];

    // Unknown slug — fall through to the index with a soft toast-ish
    // notice. We don't 404 hard because the index is the right
    // destination for a curious visitor who mistyped a URL.
    if (!lesson) {
        return (
            <div className="min-h-screen bg-slate-950 text-white" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
                <LearnHeader />
                <main className="max-w-3xl mx-auto px-6 pt-20 pb-24 text-center">
                    <div className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold mb-2">Lesson not found</div>
                    <h1 className="text-3xl font-bold tracking-tight">That lesson doesn&apos;t exist (yet).</h1>
                    <p className="mt-3 text-slate-400">Pick one from the Learn index — or jump straight to the workspace.</p>
                    <div className="mt-6 flex items-center justify-center gap-2">
                        <Link to="/learn" className="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded inline-flex items-center gap-1.5">
                            <ArrowLeft size={14} /> Learn index
                        </Link>
                        <Link to="/workspace" className="h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded inline-flex items-center gap-1.5">
                            Launch workspace <ChevronRight size={14} />
                        </Link>
                    </div>
                </main>
            </div>
        );
    }

    const Icon = ICONS[lesson.icon] || Box;

    // Compute "next lesson" for the bottom strip — the LESSONS array
    // is ordered pedagogically so "next" is literally next in array.
    const idx = LESSONS.findIndex((l) => l.slug === slug);
    const next = idx >= 0 && idx < LESSONS.length - 1 ? LESSONS[idx + 1] : null;

    return (
        <div className="min-h-screen bg-slate-950 text-white" data-testid={`learn-lesson-${slug}`} style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
            <LearnHeader />
            <main className="max-w-3xl mx-auto px-6 pt-10 pb-24">
                {/* Back to index */}
                <button
                    type="button"
                    onClick={() => navigate("/learn")}
                    className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 mb-6"
                    data-testid="learn-back-to-index"
                >
                    <ArrowLeft size={13} /> All lessons
                </button>

                {/* Lesson hero */}
                <div className="flex items-start gap-4 mb-2">
                    <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${lesson.accent} border border-slate-800 flex items-center justify-center flex-shrink-0`}>
                        <Icon size={26} className={lesson.accentColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">Lesson</span>
                            <span className="text-[10px] text-slate-500">·</span>
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 font-mono">
                                <Clock size={10} /> {lesson.minutes} min
                            </span>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">{lesson.title}</h1>
                    </div>
                </div>
                <p className="mt-3 text-slate-300 text-base leading-relaxed">{lesson.summary}</p>

                {/* Body sections */}
                <div className="mt-10 space-y-8" data-testid="learn-lesson-body">
                    {lesson.sections.map((sec, i) => (
                        <section key={i}>
                            <h2 className="text-lg font-semibold text-white mb-3 leading-snug">{sec.heading}</h2>
                            <div className="space-y-3">
                                {sec.body.map((p, j) => (
                                    <p key={j} className="text-[14px] text-slate-300 leading-relaxed">
                                        {formatInline(p)}
                                    </p>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                {/* Recap callout — the "if you remember nothing else"
                    sentence. Distinct styling so a skimming reader
                    catches it even if they bounced through the body. */}
                {lesson.recap && (
                    <div className="mt-10 rounded-xl border border-orange-500/30 bg-orange-500/[0.06] p-4 flex items-start gap-3" data-testid="learn-lesson-recap">
                        <Sparkles size={16} className="text-orange-300 mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="text-[10px] uppercase tracking-widest text-orange-300 font-semibold mb-1">Remember this</div>
                            <p className="text-[13px] text-slate-200 leading-relaxed">{lesson.recap}</p>
                        </div>
                    </div>
                )}

                {/* CTA + Next lesson strip */}
                <div className="mt-8 grid sm:grid-cols-2 gap-3" data-testid="learn-lesson-cta-strip">
                    {lesson.cta && (
                        <Link
                            to={lesson.cta.href}
                            data-testid="learn-lesson-cta"
                            className="rounded-xl border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/15 p-4 flex items-center gap-3 transition"
                        >
                            <Rocket size={16} className="text-orange-300 flex-shrink-0" />
                            <div className="flex-1">
                                <div className="text-[10px] uppercase tracking-widest text-orange-300 font-semibold">Try it now</div>
                                <div className="text-[13px] text-white font-semibold">{lesson.cta.label}</div>
                            </div>
                            <ChevronRight size={14} className="text-orange-300" />
                        </Link>
                    )}
                    {next ? (
                        <Link
                            to={`/learn/${next.slug}`}
                            data-testid="learn-lesson-next"
                            className="rounded-xl border border-slate-700 bg-slate-900/70 hover:border-slate-500 p-4 flex items-center gap-3 transition"
                        >
                            <BookOpen size={16} className="text-slate-300 flex-shrink-0" />
                            <div className="flex-1">
                                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Up next</div>
                                <div className="text-[13px] text-white font-semibold">{next.title}</div>
                            </div>
                            <ChevronRight size={14} className="text-slate-400" />
                        </Link>
                    ) : (
                        <Link
                            to="/learn"
                            className="rounded-xl border border-slate-700 bg-slate-900/70 hover:border-slate-500 p-4 flex items-center gap-3 transition"
                        >
                            <GraduationCap size={16} className="text-slate-300 flex-shrink-0" />
                            <div className="flex-1">
                                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">You finished</div>
                                <div className="text-[13px] text-white font-semibold">Back to the Learn index</div>
                            </div>
                            <ChevronRight size={14} className="text-slate-400" />
                        </Link>
                    )}
                </div>
            </main>
        </div>
    );
}

// ─── Route entrypoint — picks index vs detail by params ──────────
export default function Learn() {
    const { slug } = useParams();
    if (!slug) return <LearnIndex />;
    return <LearnLesson slug={slug} />;
}

// LandingCommunityStrip — lazy-loaded preview of the public gallery.
//
// Why this lives on the landing page: a maker who lands on /
// without an account can otherwise only judge ForgeSlicer by the
// feature list. Showing real designs from real users is the single
// most effective trust signal we can deliver before the sign-up
// fork. The strip also makes the four community verbs (browse,
// customize, publish, keep private) tangible — each card has
// "Customize in ForgeSlicer" inline so visitors see exactly what
// happens when they click.
//
// Why a separate component instead of inline in Landing.jsx:
// Landing.jsx is already past 700 lines. Splitting the marketing
// block also lets us A/B the layout without disturbing the rest of
// the landing.
//
// What's intentionally minimal:
//   - We fetch only 8 latest public items; the user goes to /gallery
//     for the full list.
//   - We don't render the FeaturedCreators strip here — it lives at
//     the top of /gallery where users are already in browse mode.
//   - The 4-verb explainer is text-only (no icons) on small screens
//     so it doesn't push the actual gallery preview below the fold.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Globe, Lock, GitFork, Share2, ChevronRight, Compass } from "lucide-react";
import { galleryApi } from "../lib/api";

export default function LandingCommunityStrip() {
    const [items, setItems] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await galleryApi.list({ limit: 8 });
                if (!cancelled) setItems(Array.isArray(data) ? data.slice(0, 8) : []);
            } catch (_) {
                if (!cancelled) setItems([]);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Hide entirely if the gallery is empty on a fresh deploy — a
    // headline reading "Community gallery" above zero cards looks
    // worse than the section simply not being there.
    if (items !== null && items.length === 0) return null;

    return (
        <section
            data-testid="landing-community-strip"
            className="mt-24"
            aria-labelledby="landing-community-heading"
        >
            <div className="text-center mb-8">
                <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-[10px] uppercase tracking-widest text-cyan-300 font-semibold">
                    <Globe size={11} /> Community Gallery
                </div>
                <h2
                    id="landing-community-heading"
                    className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight"
                >
                    Hundreds of designs you can{" "}
                    <span className="text-orange-400">customize</span>,{" "}
                    not just download.
                </h2>
                <p className="mt-3 text-slate-400 text-sm max-w-2xl mx-auto leading-relaxed">
                    Every public design ships with its editable parts. Click <span className="text-orange-300 font-semibold">Customize in ForgeSlicer</span> on any card to open the model in the workspace, tweak the dimensions, swap parts, then print.
                </p>
            </div>

            {/* The four community verbs — explicit, color-coded, no jargon. */}
            <div
                data-testid="landing-community-verbs"
                className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-7 max-w-4xl mx-auto"
            >
                <VerbCard
                    icon={Compass}
                    title="Browse"
                    desc="Filter by category — Household, Tools, Toys, Cosplay, Education…"
                    accent="text-cyan-300"
                    border="border-cyan-500/30"
                />
                <VerbCard
                    icon={GitFork}
                    title="Customize"
                    desc="Open any community design's editable parts — not just the STL."
                    accent="text-orange-300"
                    border="border-orange-500/30"
                />
                <VerbCard
                    icon={Share2}
                    title="Publish"
                    desc="Save your own work to the gallery with a license + category."
                    accent="text-emerald-300"
                    border="border-emerald-500/30"
                />
                <VerbCard
                    icon={Lock}
                    title="Keep private"
                    desc="Tick the Private toggle to save it to your library only."
                    accent="text-violet-300"
                    border="border-violet-500/30"
                />
            </div>

            {/* Card strip — 4 items on lg, 2 on sm. Each opens the
                preview which is the same dialog used inside /gallery
                (so the visitor lands in a familiar place after they
                sign in). */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="landing-community-cards">
                {items === null ? (
                    [0, 1, 2, 3].map((i) => (
                        <div key={i} className="aspect-square rounded-xl bg-slate-900 border border-slate-800 animate-pulse" />
                    ))
                ) : (
                    items.slice(0, 4).map((it) => <CommunityCard key={it.id} item={it} />)
                )}
            </div>

            <div className="mt-6 text-center">
                <Link
                    to="/gallery"
                    data-testid="landing-community-browse-all"
                    className="inline-flex items-center gap-1.5 h-10 px-5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-full transition"
                >
                    Browse the community gallery <ChevronRight size={15} />
                </Link>
            </div>
        </section>
    );
}

function VerbCard({ icon: Icon, title, desc, accent, border }) {
    return (
        <div className={`rounded-xl border ${border} bg-slate-950/70 p-3 flex flex-col items-start gap-1.5`}>
            <Icon size={15} className={accent} />
            <div className="text-[13px] font-semibold text-white">{title}</div>
            <p className="text-[10px] text-slate-400 leading-relaxed">{desc}</p>
        </div>
    );
}

function CommunityCard({ item }) {
    return (
        <Link
            to={`/gallery?preview=${item.id}`}
            data-testid={`landing-community-card-${item.id}`}
            className="group rounded-xl overflow-hidden border border-slate-800 hover:border-orange-500/50 bg-slate-900/70 flex flex-col transition"
        >
            <div className="aspect-square bg-slate-950 flex items-center justify-center overflow-hidden">
                {item.thumbnail_base64 ? (
                    <img
                        src={`data:image/png;base64,${item.thumbnail_base64}`}
                        alt={item.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                ) : (
                    <Globe size={32} className="text-slate-700" />
                )}
            </div>
            <div className="p-2.5 flex-1 flex flex-col gap-1">
                <div className="text-[12px] font-semibold text-white truncate" title={item.name}>
                    {item.name || "Untitled"}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                    by {item.author || "Anonymous"}
                </div>
                <div className="flex items-center justify-between mt-1">
                    {item.category && item.category !== "misc" ? (
                        <span className="text-[9px] uppercase tracking-widest text-orange-300 font-semibold">
                            {item.category.replace(/_/g, " ")}
                        </span>
                    ) : <span />}
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-orange-300 font-semibold">
                        <GitFork size={10} /> Customize
                    </span>
                </div>
            </div>
        </Link>
    );
}

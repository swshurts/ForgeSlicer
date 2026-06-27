// FeaturedCreators — horizontal card strip of community spotlight.
//
// Why this lives as a standalone component: it's used in two places —
// at the top of the Gallery page and above the footer on the Landing
// page. Sharing the component means a UI tweak (e.g. an avatar style
// change) lands in both surfaces at once. The card row is tuned for
// a 6-creator default (matches the backend's default `limit=6`); it
// gracefully renders fewer when the database is small.
//
// Why we render *nothing* when the API returns an empty list:
// a `Featured Creators` heading sitting above zero rows looks broken
// and signals "no community yet" to visitors. Better to surface the
// strip only when there's real social proof to show.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, ChevronRight, GitFork } from "lucide-react";
import { galleryApi } from "../lib/api";

export default function FeaturedCreators({ limit = 6, variant = "gallery" }) {
    const [creators, setCreators] = useState(null);   // null = loading, [] = empty, [...] = ready
    const [err, setErr] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await galleryApi.featuredCreators({ limit });
                if (!cancelled) setCreators(Array.isArray(data) ? data : []);
            } catch (e) {
                if (!cancelled) {
                    setErr(e);
                    setCreators([]);  // fail-closed: hide the strip rather than show a broken UI
                }
            }
        })();
        return () => { cancelled = true; };
    }, [limit]);

    // Loading skeleton — three ghost cards. Lightweight so it doesn't
    // dominate the page while the network hop completes.
    if (creators === null) {
        return (
            <section
                data-testid="featured-creators-loading"
                className="w-full"
                aria-label="Loading featured creators"
            >
                <div className="flex items-center gap-2 mb-3">
                    <Sparkles size={14} className="text-amber-300" />
                    <h3 className="text-sm font-semibold text-white">Featured Creators</h3>
                </div>
                <div className="flex gap-3 overflow-hidden">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="flex-shrink-0 w-44 h-20 rounded-xl bg-slate-900 border border-slate-800 animate-pulse" />
                    ))}
                </div>
            </section>
        );
    }

    // Nothing to show — hide the section entirely (see comment above).
    if (!creators.length) return null;

    const headingAccent = variant === "landing" ? "text-amber-300" : "text-amber-400";
    const cardBg = variant === "landing"
        ? "bg-slate-950/70 border-slate-800 hover:border-amber-500/50"
        : "bg-slate-900/70 border-slate-700 hover:border-amber-500/50";

    return (
        <section
            data-testid="featured-creators"
            className="w-full"
            aria-labelledby="featured-creators-heading"
        >
            <div className="flex items-center gap-2 mb-3">
                <Sparkles size={14} className={headingAccent} />
                <h3 id="featured-creators-heading" className="text-sm font-semibold text-white">
                    Featured Creators
                </h3>
                <span className="text-[10px] uppercase tracking-widest text-slate-500 ml-1">
                    {err ? "(temporary list)" : "this month"}
                </span>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
                {creators.map((c) => (
                    <Link
                        key={c.user_id}
                        to={`/profile/${c.user_id}`}
                        data-testid={`featured-creator-${c.user_id}`}
                        className={`flex-shrink-0 w-44 rounded-xl border p-3 transition ${cardBg}`}
                    >
                        <div className="flex items-center gap-2 mb-1.5">
                            {/* Tiny thumbnail of one of their designs as the avatar */}
                            {c.featured_thumb_b64 ? (
                                <img
                                    src={`data:image/png;base64,${c.featured_thumb_b64}`}
                                    alt=""
                                    className="w-9 h-9 rounded-lg object-cover bg-slate-800"
                                />
                            ) : (
                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500/30 to-amber-500/20 flex items-center justify-center text-[11px] font-bold text-orange-300">
                                    {(c.name || "M").slice(0, 1).toUpperCase()}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-semibold text-white truncate">
                                    {c.name || "Maker"}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                    {c.design_count} {c.design_count === 1 ? "design" : "designs"}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="inline-flex items-center gap-1">
                                <GitFork size={10} className="text-cyan-300" />
                                {c.remix_count} remix{c.remix_count === 1 ? "" : "es"}
                            </span>
                            <span className="inline-flex items-center text-amber-300 font-semibold">
                                View <ChevronRight size={11} />
                            </span>
                        </div>
                        {c.source === "editorial" && (
                            <div className="mt-1.5 text-[9px] uppercase tracking-widest text-amber-300/80 font-semibold">
                                ★ Editor&apos;s pick
                            </div>
                        )}
                    </Link>
                ))}
            </div>
        </section>
    );
}

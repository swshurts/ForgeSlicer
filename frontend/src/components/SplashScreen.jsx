import React, { useEffect, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { X, Sparkles } from "lucide-react";

const STORAGE_KEY = "forge.splash.seen";   // stores last-seen version string
const SPLASH_URL = "/splash.html";

// Routes the announcement banner is allowed to surface on. The
// landing page (`/`), the dedicated SEO landings, the Learn lessons,
// and the Trust pages are EXCLUDED so a first-time visitor sees the
// core value proposition + CTAs + product visuals before any update
// messaging. The banner only nudges users who've already engaged
// with the product (workspace / gallery / authed flows).
const ALLOWED_PATH_PREFIXES = ["/workspace", "/gallery", "/profile"];

function isAllowedRoute(pathname) {
    if (!pathname) return false;
    return ALLOWED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
}

/**
 * Optional announcement banner — iter-105.38 refactor.
 *
 * Why a banner (not a fullscreen modal):
 *   The previous implementation popped a centred modal over the whole
 *   page, including the marketing landing — first-time visitors were
 *   interrupted before they could read the headline or click a CTA.
 *   Per the trust-signal review, the banner now:
 *     • Skips the landing + SEO + Learn + Trust routes entirely.
 *     • Renders as a small, dismissible bottom-right card on the
 *       routes where it IS allowed (workspace, gallery, profiles).
 *     • Links to /changelog for the full notes — no inline long-form
 *       content in the banner.
 *     • Persists dismissal in localStorage keyed on the
 *       splash-version meta, identical to the prior behaviour.
 *
 * Fetches /splash.html on mount, looking for:
 *   - <meta name="splash-version" content="..."> for change tracking
 *   - <div data-splash> with a short summary (1-2 lines max — this
 *     is a banner, full release notes live at /changelog)
 *
 * Same `forgeslicer:show-splash` window event still re-opens the
 * banner on demand from the topbar "What's new" pin.
 */
export default function SplashScreen() {
    const [data, setData] = useState(null);    // { version, html, forced }
    const [closing, setClosing] = useState(false);
    const location = useLocation();

    // Shared fetch+parse routine. `respectSeen` controls whether we
    // bail when the user already dismissed this version (true on
    // auto-mount, false on manual "show me again" trigger).
    const loadSplash = async (respectSeen) => {
        try {
            const r = await fetch(SPLASH_URL, { cache: "no-store" });
            if (!r.ok) return;
            const html = (await r.text()).trim();
            if (!html) return;
            const doc = new DOMParser().parseFromString(html, "text/html");
            const versionMeta = doc.querySelector('meta[name="splash-version"]');
            const version = versionMeta ? versionMeta.getAttribute("content") || "" : "";
            const block = doc.querySelector("[data-splash]");
            if (!block || !block.innerHTML.trim()) return;
            if (respectSeen) {
                let seen = "";
                try { seen = window.localStorage.getItem(STORAGE_KEY) || ""; } catch (err) { void err; }
                if (version && seen === version) return;
            }
            setData({ version, html: block.innerHTML, forced: !respectSeen });
        } catch (err) {
            // Missing /splash.html is the normal "no announcement" path.
            void err;
        }
    };

    useEffect(() => {
        // Auto-fetch only on the allowed routes so brand-new visitors
        // hitting the landing page see the marketing copy first.
        if (isAllowedRoute(location.pathname)) {
            loadSplash(true);
        }
        // Manual re-open is always honoured — the topbar pin works
        // even on the landing page if a user really wants to see it.
        const onShow = () => { void loadSplash(false); };
        window.addEventListener("forgeslicer:show-splash", onShow);
        return () => {
            window.removeEventListener("forgeslicer:show-splash", onShow);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    const handleClose = () => {
        if (!data) return;
        setClosing(true);
        try {
            if (data.version) window.localStorage.setItem(STORAGE_KEY, data.version);
        } catch (err) { void err; }
        // Allow the fade-out animation to play before unmounting.
        setTimeout(() => setData(null), 250);
    };

    // Hide the banner if we're not on an allowed route. The banner
    // can never appear on the landing page even if the data state
    // was populated by a previous route — covers the case where a
    // user navigates from /workspace → /.
    if (!data) return null;
    if (!data.forced && !isAllowedRoute(location.pathname)) return null;

    return (
        <div
            data-testid="splash-screen"
            className={`fixed bottom-4 right-4 z-[200] max-w-sm w-[calc(100vw-2rem)] sm:w-96 transition-all duration-200 ${closing ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"}`}
            role="status"
            aria-live="polite"
        >
            <div className="bg-slate-900 border border-orange-500/40 rounded-xl shadow-2xl overflow-hidden">
                <div className="h-10 px-3 flex items-center gap-2 border-b border-slate-800 bg-orange-500/10">
                    <Sparkles size={14} className="text-orange-400 flex-shrink-0" />
                    <div className="flex-1 text-[11px] font-semibold uppercase tracking-widest text-orange-300 truncate">
                        What&apos;s new
                    </div>
                    <button
                        data-testid="splash-close-btn"
                        onClick={handleClose}
                        className="h-7 w-7 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
                        title="Dismiss"
                        aria-label="Dismiss announcement"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div
                    className="px-4 py-3 splash-body text-[12px] text-slate-200 leading-relaxed"
                    // Same-origin static file we control — no XSS surface.
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: data.html }}
                />
                <div className="px-4 py-2.5 border-t border-slate-800 flex items-center justify-between gap-2 bg-slate-950/40">
                    <Link
                        to="/changelog"
                        data-testid="splash-changelog-link"
                        onClick={handleClose}
                        className="text-[11px] text-orange-300 hover:text-orange-200 font-semibold inline-flex items-center gap-0.5"
                    >
                        Read full changelog &rarr;
                    </Link>
                    <button
                        data-testid="splash-ok-btn"
                        onClick={handleClose}
                        className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold rounded"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}

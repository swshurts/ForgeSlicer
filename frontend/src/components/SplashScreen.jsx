import React, { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";

const STORAGE_KEY = "forge.splash.seen";   // stores last-seen version string
const AUTO_DISMISS_MS = 30_000;
const SPLASH_URL = "/splash.html";

/**
 * Optional announcement splash.
 *
 * Fetches /splash.html on mount. The HTML is expected to contain:
 *  - <meta name="splash-version" content="..."> for change tracking
 *  - <div data-splash> with arbitrary marked-up content
 *  - Optional <link rel="stylesheet"> tags work — we inject the body markup
 *    raw into the dialog, so any CSS reachable via <link> still applies.
 *
 * If the file is missing, empty, or its version matches what the user has
 * already dismissed, the splash renders nothing. New visitors and version
 * bumps re-show it.
 */
export default function SplashScreen() {
  const [data, setData] = useState(null);    // { version, html }
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch(SPLASH_URL, { cache: "no-store" });
        if (!r.ok) return;
        const html = (await r.text()).trim();
        if (!html) return;
        // Parse out the version + the [data-splash] block.
        const doc = new DOMParser().parseFromString(html, "text/html");
        const versionMeta = doc.querySelector('meta[name="splash-version"]');
        const version = versionMeta ? versionMeta.getAttribute("content") || "" : "";
        const block = doc.querySelector("[data-splash]");
        if (!block || !block.innerHTML.trim()) return;
        // Check whether the user has already dismissed THIS version.
        let seen = "";
        try { seen = window.localStorage.getItem(STORAGE_KEY) || ""; } catch (err) { void err; }
        if (version && seen === version) return;
        if (cancelled) return;
        setData({ version, html: block.innerHTML });
      } catch (err) {
        // Missing /splash.html is the normal "no announcement" path; we
        // never want to surface a console error for it.
        void err;
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!data) return undefined;
    const t = setTimeout(() => handleClose(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleClose = () => {
    if (!data) return;
    setClosing(true);
    try {
      if (data.version) window.localStorage.setItem(STORAGE_KEY, data.version);
    } catch (err) { void err; }
    // Allow the fade-out animation to play before unmounting.
    setTimeout(() => setData(null), 250);
  };

  if (!data) return null;

  return (
    <div
      data-testid="splash-screen"
      className={`fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 transition-opacity duration-200 ${closing ? "opacity-0" : "opacity-100"}`}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-orange-500/30 rounded-xl shadow-2xl overflow-hidden splash-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-4 flex items-center gap-2 border-b border-slate-800 bg-orange-500/5">
          <Sparkles size={16} className="text-orange-400" />
          <div className="flex-1 text-xs font-semibold uppercase tracking-wider text-orange-300">
            ForgeSlicer Announcement
          </div>
          <button
            data-testid="splash-close-btn"
            onClick={handleClose}
            className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
            title="Close (or wait 30s)"
          >
            <X size={16} />
          </button>
        </div>
        <div
          className="p-6 splash-body"
          // The HTML originates from a same-origin static file we control,
          // not user input — XSS surface is zero. dangerouslySetInnerHTML
          // is the cleanest way to render arbitrary marked-up announcements.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: data.html }}
        />
        <div className="px-6 pb-5 pt-2 flex items-center justify-between text-xs">
          <span className="text-slate-500">Auto-closes in 30s</span>
          <button
            data-testid="splash-ok-btn"
            onClick={handleClose}
            className="h-9 px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm rounded shadow-lg shadow-orange-500/20"
          >
            OK, got it
          </button>
        </div>
      </div>
    </div>
  );
}

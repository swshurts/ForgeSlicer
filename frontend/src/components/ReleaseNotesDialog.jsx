import React, { useEffect, useState } from "react";
import { X, Sparkles, Plus, Wrench, Bug } from "lucide-react";
import { RELEASE_NOTES, latestReleaseVersion } from "../lib/releaseNotes";

const STORAGE_KEY = "forge.releaseNotes.seen";

/**
 * Release notes / changelog dialog.
 *
 * Opens via:
 *   - the topbar "What's new" sparkle button (dispatches `forgeslicer:show-release-notes`)
 *   - automatically once per release version on first load of a returning
 *     user (tracked via localStorage["forge.releaseNotes.seen"])
 *
 * Renders the RELEASE_NOTES array with the newest entry at the top, each
 * change tagged with a colored chip (Feature / Improvement / Fix). The
 * body is scrollable so a long history doesn't blow up the dialog.
 *
 * Brand-new visitors do NOT see this on first load — they hit the
 * Landing page anyway. We only auto-open when a returning user shows up
 * with a stale `seen` version, so the dialog reads as "you've been gone
 * a while, here's what changed".
 */
export default function ReleaseNotesDialog() {
  const [open, setOpen] = useState(false);

  // Auto-show if the user has seen a previous version (= returning user
  // who's been gone since the latest release).
  useEffect(() => {
    try {
      const latest = latestReleaseVersion();
      const seen = window.localStorage.getItem(STORAGE_KEY) || "";
      if (seen && latest && seen !== latest) {
        setOpen(true);
      }
    } catch (err) { void err; }
    const onShow = () => setOpen(true);
    window.addEventListener("forgeslicer:show-release-notes", onShow);
    return () => window.removeEventListener("forgeslicer:show-release-notes", onShow);
  }, []);

  const handleClose = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, latestReleaseVersion());
    } catch (err) { void err; }
  };

  if (!open) return null;

  return (
    <div
      data-testid="release-notes-dialog"
      className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-orange-500/30 rounded-xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-4 flex items-center gap-2 border-b border-slate-800 bg-orange-500/5 flex-shrink-0">
          <Sparkles size={16} className="text-orange-400" />
          <div className="flex-1 text-xs font-semibold uppercase tracking-wider text-orange-300">
            Release notes
          </div>
          <button
            data-testid="release-notes-close-btn"
            onClick={handleClose}
            className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-6" data-testid="release-notes-body">
          {RELEASE_NOTES.map((entry) => (
            <ReleaseEntry key={entry.version} entry={entry} />
          ))}
          <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-500 italic text-center">
            That's the lot — more on the way.
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] text-slate-500">
            Showing {RELEASE_NOTES.length} release{RELEASE_NOTES.length === 1 ? "" : "s"} — newest first
          </span>
          <button
            data-testid="release-notes-ok-btn"
            onClick={handleClose}
            className="h-9 px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm rounded shadow-lg shadow-orange-500/20"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function ReleaseEntry({ entry }) {
  const dateLabel = formatDate(entry.date);
  return (
    <article data-testid={`release-entry-${entry.version}`} className="flex flex-col gap-2">
      <header className="flex items-baseline gap-3 flex-wrap">
        <span className="text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/40">
          v{entry.version}
        </span>
        <h3 className="text-base font-semibold text-white">{entry.title}</h3>
        <time className="text-[11px] text-slate-500 font-mono ml-auto" dateTime={entry.date}>
          {dateLabel}
        </time>
      </header>
      <ul className="flex flex-col gap-1.5 pl-1">
        {entry.changes.map((c, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13px] text-slate-200 leading-snug">
            <ChangeChip type={c.type} />
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

const CHIP_META = {
  feature:     { Icon: Plus,   label: "New",     cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
  improvement: { Icon: Wrench, label: "Tweak",   cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40" },
  fix:         { Icon: Bug,    label: "Fix",     cls: "bg-rose-500/15 text-rose-300 border-rose-500/40" },
};

function ChangeChip({ type }) {
  const meta = CHIP_META[type] || CHIP_META.improvement;
  const { Icon, label, cls } = meta;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border flex-shrink-0 mt-0.5 ${cls}`}>
      <Icon size={9} />
      {label}
    </span>
  );
}

// Format `2026-02-24` → `Feb 24, 2026`. Uses the user's locale Intl
// formatter so non-US visitors see their conventional date order.
//
// We anchor the parse to noon UTC (not midnight) on purpose: midnight UTC
// rolls back to the previous calendar day in any negative UTC offset
// (US/Americas), which surfaces as "the latest release shows yesterday"
// for the majority of our users. Noon UTC keeps the date on the intended
// day for every timezone between UTC-11 and UTC+11.
function formatDate(iso) {
  try {
    const d = new Date(iso + "T12:00:00Z");
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      });
    }
  } catch (err) { void err; }
  return iso;
}

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Library, Sparkles } from "lucide-react";
import { matchPalette, listPrivateFilaments } from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * Library compatibility scorer.
 *
 * Given a palette (array of {name, hex, td}), POSTs to
 * /api/filament-library/match-palette and renders a ΔE-coded row per
 * filament so the user knows whether their (or a buyer's) private
 * library can reproduce each color:
 *
 *   ΔE ≤ 5   → "ok"    (green) — imperceptible to acceptable
 *   ΔE ≤ 12  → "close" (yellow) — buyer will see a small shift
 *   ΔE > 12  → "far"   (red)   — recommend swapping the SKU
 *
 * Two modes:
 *
 *  - scope="mine"          (default, requires sign-in): match the
 *    palette against the *viewing* user's private library. If the
 *    user is anonymous OR has no private library yet, we fall back
 *    to a soft prompt with a link to the library dialog.
 *
 *  - scope="manufacturer"  : match against the global catalog. Used
 *    primarily to show creators the manufacturer SKUs closest to
 *    each of their picks (so they can update the palette to use a
 *    real, buyable filament).
 */
export const LibraryMatchPanel = ({
  palette,
  scope = "mine",
  algo = "de2000",
  title,
  testIdSuffix = "",
  emptyHint,
  badThresholdHint = true,
}) => {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [librarySize, setLibrarySize] = useState(null);

  // For scope=mine we need to know whether the user has any private
  // filaments at all; if they don't we skip the API call and show a
  // helpful empty state instead of "ΔE 99" for every row.
  useEffect(() => {
    let cancelled = false;
    if (scope !== "mine" || !user) {
      setLibrarySize(null);
      return undefined;
    }
    listPrivateFilaments()
      .then((items) => { if (!cancelled) setLibrarySize(items.length); })
      .catch(() => { if (!cancelled) setLibrarySize(0); });
    return () => { cancelled = true; };
  }, [scope, user]);

  const shouldFetch = useMemo(() => {
    if (!palette || palette.length === 0) return false;
    if (scope === "mine") {
      if (!user) return false;
      if (librarySize === null) return false;
      if (librarySize === 0) return false;
    }
    return true;
  }, [palette, scope, user, librarySize]);

  useEffect(() => {
    if (!shouldFetch) {
      setData(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    matchPalette(palette, { scope, algo })
      .then((body) => { if (!cancelled) setData(body); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shouldFetch, JSON.stringify(palette || []), scope, algo]);

  // ----- empty / locked states ------------------------------------------
  if (!palette || palette.length === 0) return null;

  if (scope === "mine" && !user) {
    return (
      <div
        className="border border-zinc-800 p-3 space-y-1"
        data-testid={`library-match-signed-out${testIdSuffix}`}
      >
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300">
          <Library className="w-3 h-3" /> Library compatibility
        </div>
        <div className="font-mono text-[10px] text-zinc-500 leading-relaxed">
          {emptyHint || (
            <>
              Sign in to score this palette against the filaments you
              actually own.
            </>
          )}
        </div>
      </div>
    );
  }

  if (scope === "mine" && librarySize === 0) {
    return (
      <div
        className="border border-zinc-800 p-3 space-y-1"
        data-testid={`library-match-empty${testIdSuffix}`}
      >
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300">
          <Library className="w-3 h-3" /> Library compatibility
        </div>
        <div className="font-mono text-[10px] text-zinc-500 leading-relaxed">
          Your private library is empty. Add the filaments you own from
          any swatch's pencil menu → "Match from manufacturer" → "My
          library" tab — we'll then score every palette against what
          you can actually print.
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div
        className="border border-zinc-800 p-3 font-mono text-[10px] text-zinc-500"
        data-testid={`library-match-loading${testIdSuffix}`}
      >
        Scoring palette…
      </div>
    );
  }

  if (!data) return null;

  const matches = data.matches || [];
  const farCount = matches.filter((m) => m.severity === "far").length;
  const closeCount = matches.filter((m) => m.severity === "close").length;
  const okCount = matches.filter((m) => m.severity === "ok").length;
  const banner = farCount > 0 ? "warn" : closeCount > 0 ? "info" : "good";

  return (
    <div
      className="border border-zinc-800 p-3 space-y-2"
      data-testid={`library-match-panel${testIdSuffix}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300">
          <Library className="w-3 h-3" />
          {title || (scope === "mine" ? "Library compatibility" : "Closest manufacturer SKUs")}
        </div>
        <div className="font-mono text-[9px] text-zinc-600 tabular-nums">
          Δ{algo === "de76" ? "E76" : "E2000"} · pool {data.pool_size}
        </div>
      </div>

      {/* Headline banner */}
      <div
        className={`flex items-start gap-2 px-2.5 py-1.5 border font-mono text-[10px] leading-snug ${
          banner === "warn"
            ? "border-red-800/60 bg-red-950/30 text-red-200"
            : banner === "info"
              ? "border-yellow-800/60 bg-yellow-950/30 text-yellow-200"
              : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"
        }`}
        data-testid={`library-match-banner${testIdSuffix}`}
        data-severity={banner}
      >
        {banner === "warn" ? (
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px" />
        ) : banner === "info" ? (
          <Sparkles className="w-3 h-3 flex-shrink-0 mt-px" />
        ) : (
          <CheckCircle2 className="w-3 h-3 flex-shrink-0 mt-px" />
        )}
        <div className="flex-1">
          {banner === "warn" && (
            <>
              <strong>{farCount}</strong> of {matches.length} filament
              {matches.length === 1 ? "" : "s"} can't be reproduced
              closely
              {scope === "mine"
                ? " from your library."
                : " from the manufacturer catalog."}{" "}
              {scope === "mine"
                ? "Add the missing brand under My library, or swap the palette to a closer SKU."
                : "Consider swapping to one of the closer SKUs below."}
            </>
          )}
          {banner === "info" && (
            <>
              {okCount} exact · {closeCount} slight shift · {farCount} far.
              Buyers will see a small shift on the close matches — the
              palette is still printable.
            </>
          )}
          {banner === "good" && (
            <>
              All {matches.length} filament{matches.length === 1 ? "" : "s"} are
              within ΔE 5 of {scope === "mine" ? "your library" : "a real SKU"}.
            </>
          )}
        </div>
      </div>

      {/* Per-row table */}
      <div className="space-y-1">
        {matches.map((m, i) => (
          <div
            key={`${m.input_hex}-${i}`}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 font-mono text-[10px]"
            data-testid={`library-match-row-${i}${testIdSuffix}`}
            data-severity={m.severity}
          >
            <div
              className="w-4 h-4 border border-zinc-700"
              style={{ background: m.input_hex }}
              title={m.input_hex}
            />
            <div className="text-zinc-300 truncate">
              {m.input_name || m.input_hex}
              {m.best && (
                <span className="text-zinc-600">
                  {" → "}
                  <span
                    className="inline-block w-2.5 h-2.5 align-middle border border-zinc-700 mr-1"
                    style={{ background: m.best.hex }}
                  />
                  <span className="text-zinc-400">{m.best.brand}</span>{" "}
                  <span className="text-zinc-500">{m.best.name}</span>
                </span>
              )}
              {!m.best && m.severity === "invalid" && (
                <span className="text-red-400"> · invalid hex</span>
              )}
            </div>
            <div
              className={`tabular-nums text-right w-12 ${
                m.severity === "ok"
                  ? "text-emerald-300"
                  : m.severity === "close"
                    ? "text-yellow-300"
                    : m.severity === "far"
                      ? "text-red-400"
                      : "text-zinc-600"
              }`}
            >
              {m.delta_e == null ? "—" : `ΔE ${m.delta_e.toFixed(1)}`}
            </div>
            <div className="text-zinc-700 uppercase text-[8px] tracking-wider text-right w-12">
              {m.best?.source === "private" ? "MINE" : (m.best?.source === "manufacturer" ? "MFR" : "")}
            </div>
          </div>
        ))}
      </div>

      {badThresholdHint && farCount > 0 && (
        <div className="font-mono text-[9px] text-zinc-600 leading-relaxed pt-1">
          ΔE &gt; 12 is the rough threshold where most viewers can tell
          two reds apart side-by-side. Below 5 looks identical even to
          calibrated eyes.
        </div>
      )}
    </div>
  );
};

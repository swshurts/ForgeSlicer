/**
 * PresetsFeedPage — browseable /presets gallery of community-shared
 * print-shop presets (iter-151.13).
 *
 * Public feed of the newest public presets. Anyone can browse.
 * Clicking a preset navigates to its `/presets/:slug` landing page,
 * which enforces the sign-in-to-import rule.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Package, Loader2, Search, TrendingUp } from "lucide-react";
import { printPresetsApi } from "../lib/api";

export default function PresetsFeedPage() {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await printPresetsApi.listPublic(120);
        if (!cancelled) setPresets(list || []);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("public presets failed:", err);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = presets;
    if (term) {
      out = out.filter((p) =>
        (p.name || "").toLowerCase().includes(term)
        || (p.description || "").toLowerCase().includes(term)
        || (p.author_name || "").toLowerCase().includes(term)
        || (p.printer_id || "").toLowerCase().includes(term)
        || (p.filament_id || "").toLowerCase().includes(term)
      );
    }
    if (sort === "top") {
      out = [...out].sort((a, b) => (b.uses || 0) - (a.uses || 0));
    } // newest is already the default order from the API
    return out;
  }, [presets, q, sort]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 py-10 px-4">
      <div className="max-w-5xl mx-auto" data-testid="presets-feed-page">
        <div className="flex items-center gap-2 mb-2">
          <Package size={22} className="text-purple-400" />
          <h1 className="text-3xl font-bold text-white">Community Print-Shop Presets</h1>
        </div>
        <p className="text-sm text-slate-400 mb-6">
          Battle-tested slicer + material bundles shared by the ForgeSlicer community. Sign in to apply any of them to your workspace with one click.
        </p>

        <div className="flex gap-2 mb-6">
          <div className="flex-1 relative">
            <Search size={14} className="absolute top-2.5 left-2.5 text-slate-500 pointer-events-none" />
            <input
              data-testid="presets-search-input"
              type="text"
              placeholder="Search by name, author, printer, filament…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full h-9 pl-8 pr-2 bg-slate-900 border border-slate-800 rounded text-sm focus:border-purple-500 outline-none"
            />
          </div>
          <select
            data-testid="presets-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-9 px-2 bg-slate-900 border border-slate-800 rounded text-sm focus:border-purple-500 outline-none"
          >
            <option value="newest">Newest</option>
            <option value="top">Most applied</option>
          </select>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-slate-400"><Loader2 className="animate-spin" size={14} /> Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-slate-500 italic text-sm">No presets match your search.</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="presets-feed-grid">
          {filtered.map((p) => (
            <Link
              key={p.slug}
              to={`/presets/${p.slug}`}
              data-testid={`presets-feed-card-${p.slug}`}
              className="block bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/40 rounded-lg p-3 transition-colors"
            >
              <div className="flex items-start justify-between gap-1 mb-1">
                <span className="text-sm font-semibold text-slate-100 truncate">{p.name}</span>
                {(p.uses || 0) > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-300 font-mono flex-shrink-0" title="Times applied">
                    <TrendingUp size={10} /> {p.uses}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 mb-2 line-clamp-2 leading-snug min-h-[2rem]">
                {p.description || <span className="italic text-slate-500">No description</span>}
              </div>
              <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between">
                <span className="truncate">{p.author_name}</span>
                <span className="text-purple-400">{p.printer_id}</span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">
                {p.filament_id} · L={p.slice_settings?.layerHeight ?? "?"}mm · {p.slice_settings?.infillPercent ?? "?"}% infill
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

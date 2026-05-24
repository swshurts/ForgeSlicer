import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { galleryApi, componentsApi, apiErrorMessage } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import UserMenu from "./UserMenu";
import {
  Download, Hexagon, ArrowLeft, Trash2, RefreshCw, GitFork, Repeat,
  PlusSquare, MinusSquare, Star, Search, Plus, BadgeCheck, Tag, Scale, Layers,
  Lock, Globe, Share2, ShieldCheck,
} from "lucide-react";
import { getLicense } from "../lib/licenses";
import { MATERIALS, getMaterial } from "../lib/materials";

const PLACEHOLDERS = [
  "https://images.unsplash.com/photo-1622547748225-3fc4abd2cca0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwyfHxnZW9tZXRyaWMlMjBhYnN0cmFjdCUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc3ODgyNDI2Nnww&ixlib=rb-4.1.0&q=85",
  "https://images.unsplash.com/photo-1709626011485-6fe000ea2dbc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHw0fHxnZW9tZXRyaWMlMjBhYnN0cmFjdCUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc3ODgyNDI2Nnww&ixlib=rb-4.1.0&q=85",
  "https://images.unsplash.com/photo-1622737133809-d95047b9e673?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwxfHxnZW9tZXRyaWMlMjBhYnN0cmFjdCUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc3ODgyNDI2Nnww&ixlib=rb-4.1.0&q=85",
  "https://images.unsplash.com/photo-1702863361902-93c51bfbd923?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNzl8MHwxfHNlYXJjaHwzfHwzZCUyMHByaW50ZWQlMjBvYmplY3R8ZW58MHx8fHwxNzc4ODI0MjYyfDA&ixlib=rb-4.1.0&q=85",
];

const COMPONENT_CATEGORIES = [
  { key: "all", label: "All categories" },
  { key: "mechanical", label: "Mechanical" },
  { key: "rack", label: "Rack / Enclosure" },
  { key: "mounting", label: "Mounting" },
  { key: "fasteners", label: "Fasteners" },
  { key: "electronics", label: "Electronics" },
  { key: "brackets", label: "Brackets" },
  { key: "hinges", label: "Hinges" },
  { key: "gears", label: "Gears" },
  { key: "decorative", label: "Decorative" },
  { key: "organizers", label: "Organizers" },
  { key: "miniatures", label: "Miniatures" },
  { key: "structural", label: "Structural" },
  { key: "toys", label: "Toys" },
  { key: "misc", label: "Misc" },
];

function timeAgo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Segmented control letting signed-in users flip between the public listing
// and their own library (which includes private items). Lives at the top of
// each gallery tab so users can find a component they saved as private —
// otherwise it never shows up here because /gallery and /components hide
// private items by default.
function SourceFilter({ value, onChange, testid }) {
  const opts = [
    { key: "public", label: "Public", Icon: Globe },
    { key: "mine",   label: "Mine",   Icon: Lock  },
  ];
  return (
    <div className="inline-flex bg-slate-900 border border-slate-700 rounded p-0.5" data-testid={testid}>
      {opts.map(({ key, label, Icon }) => (
        <button
          key={key}
          data-testid={`${testid}-${key}`}
          onClick={() => onChange(key)}
          className={`h-7 px-2.5 text-[11px] font-semibold rounded flex items-center gap-1 ${
            value === key
              ? "bg-orange-500/20 text-orange-300"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Icon size={11} /> {label}
        </button>
      ))}
    </div>
  );
}

// Small license chip used on both gallery and component cards. Renders the
// short license name as a clickable link to the canonical text when one is
// available; falls back to a plain pill otherwise. Tints vary by category so
// users can scan card grids and spot copyleft (emerald) vs commercial-friendly
// (cyan) vs non-commercial (amber) licenses at a glance.
function LicenseBadge({ license, testid, className = "" }) {
  const meta = getLicense(license);
  if (!meta) return null;
  const tintMap = {
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25",
    cyan:    "bg-cyan-500/15 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/25",
    amber:   "bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25",
    slate:   "bg-slate-700/40 text-slate-300 border-slate-600 hover:bg-slate-700/60",
  };
  const tint = tintMap[meta.tint] || tintMap.slate;
  const content = (
    <>
      <Scale size={9} /> {meta.short}
    </>
  );
  const common = `inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${tint} ${className}`;
  if (meta.url) {
    return (
      <a
        href={meta.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
        title={meta.name + " — " + meta.summary}
        className={common}
      >
        {content}
      </a>
    );
  }
  return (
    <span data-testid={testid} title={meta.name + " — " + meta.summary} className={common}>
      {content}
    </span>
  );
}

function GalleryCard({ item, idx, onDelete }) {
  const thumb = item.thumbnail_base64
    ? `data:image/png;base64,${item.thumbnail_base64}`
    : PLACEHOLDERS[idx % PLACEHOLDERS.length];
  return (
    <div className="group bg-slate-900 border border-slate-800 rounded-lg overflow-hidden hover:border-orange-500/60 transition-all" data-testid={`gallery-card-${item.id}`}>
      <div className="aspect-square bg-slate-950 overflow-hidden relative">
        <img src={thumb} alt={item.name} className="w-full h-full object-cover" />
        <div className="absolute top-2 right-2 bg-black/70 backdrop-blur text-[10px] font-mono text-orange-400 px-1.5 py-0.5 rounded">
          {item.triangle_count.toLocaleString()} △
        </div>
        {item.remix_of && (
          <div className="absolute top-2 left-2 bg-black/70 backdrop-blur text-[10px] font-mono text-cyan-300 px-1.5 py-0.5 rounded flex items-center gap-1">
            <Repeat size={10} /> remix
          </div>
        )}
        {item.remix_count > 0 && (
          <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur text-[10px] font-mono text-orange-300 px-1.5 py-0.5 rounded flex items-center gap-1">
            <GitFork size={10} /> {item.remix_count}
          </div>
        )}
        {item.private && (
          <div
            data-testid={`gallery-private-${item.id}`}
            className="absolute bottom-2 right-2 backdrop-blur text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 bg-slate-900/80 text-slate-200 border border-slate-600"
            title="Private — only visible to you"
          >
            <Lock size={10} /> private
          </div>
        )}
        {item.manifold_verified && !item.private && (
          <div
            data-testid={`gallery-manifold-${item.id}`}
            className="absolute bottom-2 right-2 backdrop-blur text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
            title="Manifold ✓ — exported through manifold-3d, watertight & guaranteed to slice cleanly"
          >
            <ShieldCheck size={10} /> manifold
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate" title={item.name}>{item.name}</h3>
        <div className="flex items-center justify-between mt-0.5">
          {item.user_id ? (
            <Link
              to={`/u/${item.user_id}`}
              onClick={(e) => e.stopPropagation()}
              data-testid={`gallery-author-link-${item.id}`}
              className="text-[11px] text-slate-400 hover:text-orange-400 truncate"
              title={`See ${item.author}'s profile`}
            >by {item.author}</Link>
          ) : (
            <span className="text-[11px] text-slate-400">by {item.author}</span>
          )}
          <span className="text-[10px] text-slate-500 font-mono">{timeAgo(item.created_at)}</span>
        </div>
        <LicenseBadge license={item.license} testid={`gallery-license-${item.id}`} className="mt-1.5" />
        {item.material && (() => {
          const m = getMaterial(item.material);
          if (m.id === "any") return null;
          const tintMap = {
            emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
            cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
            amber: "bg-amber-500/15 text-amber-300 border-amber-500/40",
            rose: "bg-rose-500/15 text-rose-300 border-rose-500/40",
            violet: "bg-violet-500/15 text-violet-300 border-violet-500/40",
            slate: "bg-slate-700/40 text-slate-300 border-slate-600",
          };
          return (
            <span
              data-testid={`gallery-material-${item.id}`}
              title={m.description || `Suggested material: ${m.label}`}
              className={`ml-1.5 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${tintMap[m.tint] || tintMap.slate}`}
            >
              <Layers size={9} /> {m.label}
            </span>
          );
        })()}
        {item.description && (
          <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{item.description}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Link
            to={`/workspace?remix=${item.id}`}
            data-testid={`gallery-remix-${item.id}`}
            className="flex-1 h-8 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center justify-center gap-1"
          >
            <GitFork size={12} /> Remix
          </Link>
          <a
            data-testid={`gallery-download-${item.id}`}
            href={galleryApi.downloadUrl(item.id)}
            className="h-8 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center justify-center gap-1 border border-slate-700"
            title="Download STL"
          >
            <Download size={12} /> STL
          </a>
          <button
            data-testid={`gallery-share-link-${item.id}`}
            onClick={async (e) => {
              e.stopPropagation();
              // Copy a public share link that opens straight to the remix
              // workspace. Pulled from current origin so links work on
              // forgeslicer.com AND any preview deployment.
              const url = `${window.location.origin}/workspace?remix=${item.id}`;
              try {
                await navigator.clipboard.writeText(url);
                alert(`Share link copied!\n\n${url}`);
              } catch {
                prompt("Copy this share link:", url);
              }
            }}
            title="Copy a sharable link that opens straight to this design"
            className="h-8 w-8 bg-slate-800 hover:bg-slate-700 hover:text-orange-300 text-slate-400 rounded flex items-center justify-center border border-slate-700"
          >
            <Share2 size={12} />
          </button>
          <button
            data-testid={`gallery-delete-${item.id}`}
            onClick={() => onDelete(item.id)}
            title="Remove from gallery"
            className="h-8 w-8 bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded flex items-center justify-center border border-slate-700"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ComponentCard({ item, idx, onAdd, onUpvote, onDelete, onTagClick }) {
  const isNeg = item.modifier === "negative";
  const thumb = item.thumbnail_base64
    ? `data:image/png;base64,${item.thumbnail_base64}`
    : PLACEHOLDERS[idx % PLACEHOLDERS.length];
  // Tags rendered as clickable pills. We split on commas and trim so a stored
  // "screw, M3, 10mm" reads as three distinct chips. Empty strings filtered out.
  const tagList = (item.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
  return (
    <div className="group bg-slate-900 border border-slate-800 rounded-lg overflow-hidden hover:border-orange-500/60 transition-all" data-testid={`component-card-${item.id}`}>
      <div className="aspect-square bg-slate-950 overflow-hidden relative">
        <img src={thumb} alt={item.name} className="w-full h-full object-cover" />
        <div className="absolute top-2 right-2 bg-black/70 backdrop-blur text-[10px] font-mono text-orange-400 px-1.5 py-0.5 rounded">
          {item.triangle_count.toLocaleString()} △
        </div>
        <div className={`absolute top-2 left-2 backdrop-blur text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 ${
          isNeg ? "bg-cyan-500/30 text-cyan-200 border border-cyan-500/40"
                : "bg-orange-500/30 text-orange-200 border border-orange-500/40"
        }`}>
          {isNeg ? <><MinusSquare size={10} /> negative</> : <><PlusSquare size={10} /> positive</>}
        </div>
        {item.verified && (
          <div
            data-testid={`component-verified-${item.id}`}
            className="absolute top-9 left-2 backdrop-blur text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 bg-emerald-500/30 text-emerald-200 border border-emerald-500/40"
            title="Verified by ForgeSlicer — known to slice cleanly"
          >
            <BadgeCheck size={10} /> verified
          </div>
        )}
        {item.private && (
          <div
            data-testid={`component-private-${item.id}`}
            className="absolute bottom-2 right-2 backdrop-blur text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 bg-slate-900/80 text-slate-200 border border-slate-600"
            title="Private — only visible to you"
          >
            <Lock size={10} /> private
          </div>
        )}
        <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur text-[10px] uppercase tracking-wider text-slate-300 px-1.5 py-0.5 rounded">
          {item.category}
        </div>
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate" title={item.name}>{item.name}</h3>
        <div className="flex items-center justify-between mt-0.5">
          {item.user_id ? (
            <Link
              to={`/u/${item.user_id}`}
              onClick={(e) => e.stopPropagation()}
              data-testid={`component-author-link-${item.id}`}
              className="text-[11px] text-slate-400 hover:text-orange-400 truncate"
              title={`See ${item.author}'s profile`}
            >by {item.author}</Link>
          ) : (
            <span className="text-[11px] text-slate-400">by {item.author}</span>
          )}
          <span className="text-[10px] text-slate-500 font-mono">{timeAgo(item.created_at)}</span>
        </div>
        <LicenseBadge license={item.license} testid={`component-license-${item.id}`} className="mt-1.5" />
        {tagList.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1" data-testid={`component-tags-${item.id}`}>
            {tagList.map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`component-tag-pill-${item.id}-${t}`}
                onClick={() => onTagClick && onTagClick(t)}
                title={`Filter by "${t}"`}
                className="text-[9px] uppercase tracking-wider bg-slate-800 hover:bg-orange-500/20 text-slate-300 hover:text-orange-300 px-1.5 py-0.5 rounded border border-slate-700 hover:border-orange-500/50 flex items-center gap-1"
              >
                <Tag size={8} /> {t}
              </button>
            ))}
          </div>
        )}
        {item.description && (
          <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{item.description}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            data-testid={`component-add-${item.id}`}
            onClick={() => onAdd(item)}
            className={`flex-1 h-8 text-white text-xs font-semibold rounded flex items-center justify-center gap-1 ${
              isNeg ? "bg-cyan-500 hover:bg-cyan-600" : "bg-orange-500 hover:bg-orange-600"
            }`}
            title="Add this component to your current workspace"
          >
            <Plus size={12} /> Add to Scene
          </button>
          <button
            data-testid={`component-upvote-${item.id}`}
            onClick={() => onUpvote(item.id)}
            className="h-8 px-2 bg-slate-800 hover:bg-amber-500/20 hover:text-amber-300 text-slate-300 text-xs font-mono rounded flex items-center gap-1 border border-slate-700"
            title="Upvote"
          >
            <Star size={11} /> {item.votes || 0}
          </button>
          <button
            data-testid={`component-delete-${item.id}`}
            onClick={() => onDelete(item.id)}
            title="Remove component"
            className="h-8 w-8 bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded flex items-center justify-center border border-slate-700"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DesignsTab() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [material, setMaterial] = useState("all");
  const [source, setSource] = useState("public"); // "public" | "mine"

  // If the user signs out, force back to public so we don't show a stale
  // empty state with a hidden "Mine" filter the user can't see.
  useEffect(() => {
    if (!user && source === "mine") setSource("public");
  }, [user, source]);

  const load = async (matOverride) => {
    setLoading(true); setError("");
    try {
      const mat = matOverride !== undefined ? matOverride : material;
      setItems(await galleryApi.list({ material: mat, mine: source === "mine" }));
    } catch (e) { setError(apiErrorMessage(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [material, source]);

  const handleDelete = async (id) => {
    if (!confirm("Remove this design from the public gallery?")) return;
    try { await galleryApi.delete(id); setItems((p) => p.filter((i) => i.id !== id)); }
    catch (e) { alert(e.message); }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <p className="text-sm text-slate-400">{source === "mine"
          ? "Your designs (including private ones) — drop any into the workspace."
          : "Community-shared models, free to download as STL."}</p>
        <div className="flex items-center gap-2">
          {user && <SourceFilter value={source} onChange={setSource} testid="gallery-source-filter" />}
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400" data-testid="gallery-material-filter-field">
            <Layers size={12} className="text-orange-400" /> Material
            <select
              data-testid="gallery-material-filter"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              className="h-8 bg-slate-900 border border-slate-700 rounded text-xs text-white px-2 focus:border-orange-500 outline-none"
            >
              <option value="all">All</option>
              {MATERIALS.filter((m) => m.id !== "any").map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <button data-testid="gallery-refresh-btn" onClick={() => load()} className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>
      {loading && <div className="text-slate-400" data-testid="gallery-loading">Loading designs…</div>}
      {!loading && error && (
        <div className="border border-red-500/40 bg-red-500/5 rounded-lg p-5 text-center" data-testid="gallery-error">
          <p className="text-sm text-red-300 mb-1 font-semibold">Couldn't load the gallery</p>
          <p className="text-xs text-slate-400 mb-3">{error}</p>
          <button
            data-testid="gallery-retry-btn"
            onClick={load}
            className="h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded inline-flex items-center gap-1.5"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="border border-dashed border-slate-700 rounded-lg p-12 text-center" data-testid="gallery-empty">
          <p className="text-slate-400 mb-1">No designs in the gallery yet.</p>
          <p className="text-xs text-slate-500 mb-4">Be the first to share a creation from the workspace.</p>
          <Link to="/workspace" className="inline-block h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded leading-9">
            Open Workspace
          </Link>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="gallery-grid">
        {items.map((it, i) => (<GalleryCard key={it.id} item={it} idx={i} onDelete={handleDelete} />))}
      </div>
    </>
  );
}

function ComponentsTab() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modifier, setModifier] = useState("all"); // all|positive|negative
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("public"); // "public" | "mine"

  // Reset to public if the user signs out mid-session.
  useEffect(() => {
    if (!user && source === "mine") setSource("public");
  }, [user, source]);

  // Accept an explicit override so tag-click can pass in the new query
  // without waiting for React's state batch to flush.
  const load = async (overrideQ) => {
    setLoading(true); setError("");
    try {
      setItems(await componentsApi.list({
        modifier: modifier === "all" ? undefined : modifier,
        category: category === "all" ? undefined : category,
        q: (overrideQ !== undefined ? overrideQ : q) || undefined,
        mine: source === "mine",
      }));
    } catch (e) { setError(apiErrorMessage(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [modifier, category, source]);

  // Clicking a tag pill on a card replaces the search with that tag and
  // re-queries immediately. Hands users a discovery loop ("show me everything
  // tagged M3") without needing to type.
  const handleTagClick = (tag) => {
    setQ(tag);
    load(tag);
  };

  const handleAdd = async (it) => {
    try {
      const proj = await componentsApi.getProject(it.id);
      // Stash for the workspace to consume on mount via /workspace?addComponent=<id>
      sessionStorage.setItem("forgeslicer.addComponent", JSON.stringify({
        name: proj.name, modifier: proj.modifier,
        project_json: proj.project_json,
        stl_base64: proj.stl_base64,
      }));
      navigate("/workspace?addComponent=1");
    } catch (e) { alert(e.message); }
  };

  const handleUpvote = async (id) => {
    try {
      const { votes } = await componentsApi.upvote(id);
      setItems((p) => p.map((x) => x.id === id ? { ...x, votes } : x));
    } catch (e) { alert(e.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Remove this component from the shared library?")) return;
    try { await componentsApi.delete(id); setItems((p) => p.filter((i) => i.id !== id)); }
    catch (e) { alert(e.message); }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <p className="text-sm text-slate-400 flex-1">
          {source === "mine"
            ? "Your saved components (including private ones)."
            : "Drop-in parts (positives and negatives) you can add to any project."}
        </p>
        {user && <SourceFilter value={source} onChange={setSource} testid="components-source-filter" />}
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            data-testid="components-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search name, tag, author..."
            className="h-9 w-56 bg-slate-900 border border-slate-700 rounded text-xs text-white pl-7 pr-2 focus:border-orange-500 outline-none"
          />
        </div>
        <select
          data-testid="components-filter-modifier"
          value={modifier}
          onChange={(e) => setModifier(e.target.value)}
          className="h-9 bg-slate-900 border border-slate-700 rounded text-xs text-white px-2 focus:border-orange-500"
        >
          <option value="all">All types</option>
          <option value="positive">Positives only</option>
          <option value="negative">Negatives only</option>
        </select>
        <select
          data-testid="components-filter-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 bg-slate-900 border border-slate-700 rounded text-xs text-white px-2 focus:border-orange-500"
        >
          {COMPONENT_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <button data-testid="components-refresh-btn" onClick={load} className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {loading && <div className="text-slate-400" data-testid="components-loading">Loading components…</div>}
      {!loading && error && (
        <div className="border border-red-500/40 bg-red-500/5 rounded-lg p-5 text-center" data-testid="components-error">
          <p className="text-sm text-red-300 mb-1 font-semibold">Couldn't load components</p>
          <p className="text-xs text-slate-400 mb-3">{error}</p>
          <button
            data-testid="components-retry-btn"
            onClick={() => load()}
            className="h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded inline-flex items-center gap-1.5"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="border border-dashed border-slate-700 rounded-lg p-12 text-center" data-testid="components-empty">
          <p className="text-slate-400 mb-1">No components match these filters.</p>
          <p className="text-xs text-slate-500 mb-4">Build a part in the workspace, then click <span className="text-orange-300">Save as Component</span> in the toolbar.</p>
          <Link to="/workspace" className="inline-block h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded leading-9">
            Open Workspace
          </Link>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="components-grid">
        {items.map((it, i) => (
          <ComponentCard
            key={it.id}
            item={it}
            idx={i}
            onAdd={handleAdd}
            onUpvote={handleUpvote}
            onDelete={handleDelete}
            onTagClick={handleTagClick}
          />
        ))}
      </div>
    </>
  );
}

export default function Gallery() {
  const [tab, setTab] = useState("designs"); // designs | components

  return (
    <div className="min-h-screen bg-slate-950 text-white" data-testid="gallery-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4 sticky top-0 z-10">
        <Link to="/workspace" data-testid="gallery-back-btn" className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Back to Workspace</span>
        </Link>
        <div className="flex-1" />
        <Link to="/" className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <Hexagon size={16} className="text-white" strokeWidth={2.4} />
          </div>
          <span className="text-sm font-bold tracking-tight">ForgeSlicer</span>
        </Link>
        <UserMenu returnPath="/gallery" />
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
            Public Library
          </h1>
        </div>
        <div className="flex items-center gap-1 mb-6 border-b border-slate-800">
          {[
            { key: "designs", label: "Designs", count: "" },
            { key: "components", label: "Components", count: "" },
          ].map((t) => (
            <button
              key={t.key}
              data-testid={`gallery-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`h-10 px-5 text-sm font-semibold uppercase tracking-wider border-b-2 -mb-px ${
                tab === t.key
                  ? "border-orange-500 text-orange-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "designs" ? <DesignsTab /> : <ComponentsTab />}
      </main>
    </div>
  );
}

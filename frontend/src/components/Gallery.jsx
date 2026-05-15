import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { galleryApi } from "../lib/api";
import { Download, Hexagon, ArrowLeft, Trash2, RefreshCw, GitFork, Repeat } from "lucide-react";

const PLACEHOLDERS = [
  "https://images.unsplash.com/photo-1622547748225-3fc4abd2cca0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwyfHxnZW9tZXRyaWMlMjBhYnN0cmFjdCUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc3ODgyNDI2Nnww&ixlib=rb-4.1.0&q=85",
  "https://images.unsplash.com/photo-1709626011485-6fe000ea2dbc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHw0fHxnZW9tZXRyaWMlMjBhYnN0cmFjdCUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc3ODgyNDI2Nnww&ixlib=rb-4.1.0&q=85",
  "https://images.unsplash.com/photo-1622737133809-d95047b9e673?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwxfHxnZW9tZXRyaWMlMjBhYnN0cmFjdCUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc3ODgyNDI2Nnww&ixlib=rb-4.1.0&q=85",
  "https://images.unsplash.com/photo-1702863361902-93c51bfbd923?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNzl8MHwxfHNlYXJjaHwzfHwzZCUyMHByaW50ZWQlMjBvYmplY3R8ZW58MHx8fHwxNzc4ODI0MjYyfDA&ixlib=rb-4.1.0&q=85",
];

function timeAgo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
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
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate" title={item.name}>{item.name}</h3>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[11px] text-slate-400">by {item.author}</span>
          <span className="text-[10px] text-slate-500 font-mono">{timeAgo(item.created_at)}</span>
        </div>
        {item.description && (
          <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2">{item.description}</p>
        )}
        <div className="flex gap-1 mt-2">
          <Link
            data-testid={`gallery-remix-${item.id}`}
            to={`/workspace?remix=${item.id}`}
            className="flex-1 h-8 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded flex items-center justify-center gap-1.5"
            title="Open in workspace as remix"
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

export default function Gallery() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const data = await galleryApi.list();
      setItems(data);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!confirm("Remove this design from the public gallery?")) return;
    try {
      await galleryApi.delete(id);
      setItems((p) => p.filter((i) => i.id !== id));
    } catch (e) { alert(e.message); }
  };

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
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Public Gallery
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Community-shared models, all free to download as STL and slice yourself.
            </p>
          </div>
          <button
            data-testid="gallery-refresh-btn"
            onClick={load}
            className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {loading && <div className="text-slate-400">Loading designs...</div>}
        {error && <div className="text-red-400 text-sm">{error}</div>}
        {!loading && items.length === 0 && (
          <div className="border border-dashed border-slate-700 rounded-lg p-12 text-center" data-testid="gallery-empty">
            <p className="text-slate-400 mb-1">No designs in the gallery yet.</p>
            <p className="text-xs text-slate-500 mb-4">Be the first to share a creation from the workspace.</p>
            <Link to="/workspace" className="inline-block h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded leading-9">
              Open Workspace
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="gallery-grid">
          {items.map((it, i) => (
            <GalleryCard key={it.id} item={it} idx={i} onDelete={handleDelete} />
          ))}
        </div>
      </main>
    </div>
  );
}

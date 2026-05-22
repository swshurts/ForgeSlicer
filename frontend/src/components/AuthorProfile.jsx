import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
import { API } from "../lib/api";
import {
  Hexagon, ArrowLeft, Loader2, GitFork, Download, MapPin, Link as LinkIcon,
  Award, UserCircle, Library, AlertCircle,
} from "lucide-react";
import UserMenu from "./UserMenu";

const PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 150'>
    <rect width='200' height='150' fill='%230f172a'/>
    <text x='50%' y='50%' fill='%23475569' font-family='monospace' font-size='12' text-anchor='middle' dominant-baseline='middle'>no thumb</text>
  </svg>`
);

function ContactHost(link) {
  // Strip the scheme + path so the displayed text is just the hostname —
  // less noisy than a full URL on cards. Falls back to the raw string if
  // it's not a parseable URL (e.g. user typed "@me on mastodon").
  try {
    const u = new URL(link.startsWith("http") ? link : `https://${link}`);
    return u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname : "");
  } catch {
    return link;
  }
}

function DesignCard({ item }) {
  const navigate = useNavigate();
  const thumb = item.thumbnail_base64 ? `data:image/png;base64,${item.thumbnail_base64}` : PLACEHOLDER;
  return (
    <div
      data-testid={`author-design-${item.id}`}
      className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden hover:border-orange-500/50 transition-colors cursor-pointer group"
      onClick={() => navigate(`/workspace?remix=${item.id}`)}
    >
      <div className="aspect-[4/3] bg-slate-950 relative">
        <img src={thumb} alt={item.name} className="w-full h-full object-cover" />
        {item.remix_count > 0 && (
          <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur text-[10px] font-mono text-orange-300 px-1.5 py-0.5 rounded flex items-center gap-1">
            <GitFork size={10} /> {item.remix_count}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-sm font-semibold text-white truncate">{item.name}</div>
        <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
          <Download size={10} /> {item.download_count || 0}
          <span className="text-slate-700">·</span>
          <span className="truncate">{item.material || ""}</span>
        </div>
      </div>
    </div>
  );
}

function ComponentCard({ item }) {
  return (
    <div
      data-testid={`author-component-${item.id}`}
      className="rounded-lg border border-slate-800 bg-slate-900 p-3 hover:border-orange-500/50 transition-colors"
    >
      <div className="text-sm font-semibold text-white truncate">{item.name}</div>
      <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2">
        <span className={item.modifier === "negative" ? "text-red-400" : "text-emerald-400"}>
          {item.modifier === "negative" ? "negative" : "positive"}
        </span>
        {item.category && <><span className="text-slate-700">·</span> <span>{item.category}</span></>}
      </div>
    </div>
  );
}

export default function AuthorProfile() {
  const { userId } = useParams();
  const [profile, setProfile] = useState(null);
  const [designs, setDesigns] = useState([]);
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("designs");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        // Run all three fetches in parallel; if the user doesn't exist
        // the profile endpoint 404s and we render the not-found state.
        const [profRes, designRes, compRes] = await Promise.all([
          axios.get(`${API}/users/${userId}/profile`),
          axios.get(`${API}/users/${userId}/designs`),
          axios.get(`${API}/users/${userId}/components`),
        ]);
        if (cancelled) return;
        setProfile(profRes.data);
        setDesigns(designRes.data || []);
        setComponents(compRes.data || []);
      } catch (e) {
        if (cancelled) return;
        const status = e?.response?.status;
        setError(status === 404 ? "Maker not found." : (e?.response?.data?.detail || e.message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <div className="min-h-screen bg-slate-950 text-white" data-testid="author-profile-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4">
        <Link to="/gallery" className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Gallery</span>
        </Link>
        <div className="flex-1" />
        <Link to="/" className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <Hexagon size={16} className="text-white" strokeWidth={2.4} />
          </div>
          <span className="text-sm font-bold tracking-tight">ForgeSlicer</span>
        </Link>
        <UserMenu returnPath={`/u/${userId}`} />
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading && (
          <div className="flex items-center justify-center py-20" data-testid="author-loading">
            <Loader2 size={28} className="text-orange-400 animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-lg p-8 text-center" data-testid="author-error">
            <AlertCircle size={28} className="text-red-400 mx-auto mb-3" />
            <h2 className="text-lg font-semibold">{error}</h2>
            <Link to="/gallery" className="inline-block mt-4 h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded leading-9">
              Back to gallery
            </Link>
          </div>
        )}

        {profile && !loading && (
          <>
            {/* Header card with avatar / name / sharable details */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 mb-6 flex flex-col sm:flex-row gap-5" data-testid="author-header">
              <div className="flex-shrink-0">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.name}
                    data-testid="author-avatar"
                    className="w-20 h-20 rounded-full object-cover border-2 border-orange-500/50"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center" data-testid="author-avatar-placeholder">
                    <UserCircle size={36} className="text-slate-500" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold tracking-tight" data-testid="author-name">{profile.name}</h1>
                  {profile.contributor_lifetime && (
                    <span
                      data-testid="author-contributor-badge"
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-semibold uppercase tracking-wider"
                      title="Contributor for Life — earned by sharing ≥100 components and ≥20 designs"
                    >
                      <Award size={10} /> Contributor for Life
                    </span>
                  )}
                </div>
                <div className="flex items-center flex-wrap gap-x-5 gap-y-1.5 mt-2 text-xs text-slate-400">
                  {profile.location && (
                    <span className="flex items-center gap-1" data-testid="author-location">
                      <MapPin size={12} className="text-orange-400" /> {profile.location}
                    </span>
                  )}
                  {profile.contact_link && (
                    <a
                      href={profile.contact_link.startsWith("http") ? profile.contact_link : `https://${profile.contact_link}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="author-contact"
                      className="flex items-center gap-1 hover:text-orange-400"
                    >
                      <LinkIcon size={12} className="text-orange-400" /> {ContactHost(profile.contact_link)}
                    </a>
                  )}
                  <span className="flex items-center gap-1" title="Public designs">
                    <GitFork size={12} className="text-orange-400" /> {profile.public_design_count} {profile.public_design_count === 1 ? "design" : "designs"}
                  </span>
                  <span className="flex items-center gap-1" title="Public components">
                    <Library size={12} className="text-orange-400" /> {profile.public_component_count} {profile.public_component_count === 1 ? "component" : "components"}
                  </span>
                </div>
              </div>
            </div>

            {/* Tab strip */}
            <div className="inline-flex bg-slate-900 border border-slate-800 rounded p-0.5 mb-5" data-testid="author-tabs">
              {[
                { key: "designs", label: `Designs (${designs.length})` },
                { key: "components", label: `Components (${components.length})` },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  data-testid={`author-tab-${key}`}
                  onClick={() => setTab(key)}
                  className={`h-8 px-3 text-xs font-semibold rounded ${
                    tab === key ? "bg-orange-500/20 text-orange-300" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "designs" && (
              designs.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm" data-testid="author-designs-empty">
                  No public designs yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="author-designs-grid">
                  {designs.map((item) => <DesignCard key={item.id} item={item} />)}
                </div>
              )
            )}

            {tab === "components" && (
              components.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm" data-testid="author-components-empty">
                  No public components yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="author-components-grid">
                  {components.map((item) => <ComponentCard key={item.id} item={item} />)}
                </div>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}

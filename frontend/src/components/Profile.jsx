import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { meApi, authApi } from "../lib/auth";
import { galleryApi, componentsApi } from "../lib/api";
import { toast } from "sonner";
import ThemeSwitcher from "./toolbar/ThemeSwitcher";
import {
  ArrowLeft, Hexagon, GitFork, Download, Trash2, RefreshCw,
  PlusSquare, MinusSquare, Lock, Plus, Star, Award,
  Globe, Save, Loader2, AlertCircle, MapPin, Link as LinkIcon, ImageIcon,
} from "lucide-react";

const PLACEHOLDER = "https://images.unsplash.com/photo-1702863361902-93c51bfbd923?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNzl8MHwxfHNlYXJjaHwzfHwzZCUyMHByaW50ZWQlMjBvYmplY3R8ZW58MHx8fHwxNzc4ODI0MjYyfDA&ixlib=rb-4.1.0&q=85";

function StatTile({ label, value, accent = "text-orange-400" }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className={`text-2xl font-bold font-mono ${accent}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">{label}</div>
    </div>
  );
}

// ---- Contributor Lifetime tier progress card ----
// Counts open-source published designs & components and surfaces the
// threshold the user needs to cross for free-forever access. The flag is
// granted server-side the moment thresholds are met; this card mirrors the
// state so it's visible.
function ContributorCard({ status }) {
  if (!status) return null;
  const { components_count, designs_count, components_threshold, designs_threshold, contributor_lifetime } = status;
  const compPct = Math.min(100, Math.round((components_count / components_threshold) * 100));
  const desPct = Math.min(100, Math.round((designs_count / designs_threshold) * 100));
  return (
    <div
      data-testid="contributor-card"
      className={`rounded-lg p-5 mb-8 border ${
        contributor_lifetime
          ? "border-emerald-500/50 bg-emerald-500/5"
          : "border-slate-800 bg-slate-900"
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`h-12 w-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
            contributor_lifetime ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"
          }`}
        >
          <Award size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">Contributor Lifetime Tier</h3>
            {contributor_lifetime && (
              <span data-testid="contributor-badge" className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                ✓ Earned
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
            Publish {components_threshold} open-source components and {designs_threshold} open-source designs of original work to unlock <strong className="text-emerald-300">free-forever</strong> access — even after paid tiers launch.
          </p>
          <div className="mt-4 space-y-2">
            <ProgressRow label="Components" value={components_count} max={components_threshold} pct={compPct} testid="contributor-components" />
            <ProgressRow label="Designs"    value={designs_count}    max={designs_threshold}    pct={desPct}  testid="contributor-designs" />
          </div>
          <p className="text-[10px] text-slate-500 mt-3 leading-snug">
            Eligible licenses: CC0, CC-BY, CC-BY-SA, MIT, Apache 2.0, GPL/LGPL/AGPL.
            Non-commercial (NC), No-derivatives (ND), and Standard Digital don't count.
            Duplicate names dedup to one item.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProgressRow({ label, value, max, pct, testid }) {
  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-300 font-medium">{label}</span>
        <span className="font-mono text-slate-400">{value} / {max}</span>
      </div>
      <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
        <div
          className={`h-full transition-all ${pct >= 100 ? "bg-emerald-400" : "bg-orange-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---- Profile editor (optional fields with per-field public/private toggle) ----
// Each field can be filled in or left empty. The "share" checkbox right next
// to each optional field controls whether other users see it on the public
// author profile. Name + email are always shown to the owner; only `name`
// is shown publicly (it's already how designs are attributed).
function ShareableField({ label, icon: Icon, value, onChange, share, onToggleShare, testid, placeholder, multiline = false }) {
  const Input = multiline ? "textarea" : "input";
  return (
    <div data-testid={`${testid}-field`}>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] uppercase tracking-wider text-slate-400 font-medium flex items-center gap-1">
          {Icon && <Icon size={11} className="text-orange-400" />} {label}
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer select-none">
          <input
            data-testid={`${testid}-share`}
            type="checkbox"
            checked={!!share}
            onChange={(e) => onToggleShare(e.target.checked)}
            className="accent-orange-500"
          />
          {share ? <span className="text-emerald-400 inline-flex items-center gap-1"><Globe size={10} /> Public</span> : <span className="inline-flex items-center gap-1"><Lock size={10} /> Private</span>}
        </label>
      </div>
      <Input
        data-testid={testid}
        type={multiline ? undefined : "text"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={multiline ? 2 : undefined}
        className={`w-full ${multiline ? "p-2" : "h-9 px-3"} bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-orange-500 outline-none ${multiline ? "resize-none" : ""}`}
      />
    </div>
  );
}

function ProfileEditor({ user, onSaved }) {
  // Local form state initialized from props; never mutate the auth context
  // user object directly. We only POST diffs on Save.
  const [form, setForm] = useState(() => ({
    name: user.name || "",
    avatar_url: user.avatar_url || "",
    contact_link: user.contact_link || "",
    city: user.city || "",
    state: user.state || "",
    country: user.country || "",
    share_avatar: !!user.share_avatar,
    share_contact: !!user.share_contact,
    share_location: !!user.share_location,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const dirty = (
    form.name !== (user.name || "") ||
    form.avatar_url !== (user.avatar_url || "") ||
    form.contact_link !== (user.contact_link || "") ||
    form.city !== (user.city || "") ||
    form.state !== (user.state || "") ||
    form.country !== (user.country || "") ||
    form.share_avatar !== !!user.share_avatar ||
    form.share_contact !== !!user.share_contact ||
    form.share_location !== !!user.share_location
  );

  const save = async () => {
    setBusy(true); setError("");
    try {
      const updated = await authApi.updateProfile(form);
      toast.success("Profile updated.");
      onSaved(updated);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || "Couldn't update profile.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="profile-editor"
      className="rounded-lg border border-slate-800 bg-slate-900 mb-6 overflow-hidden"
    >
      <button
        data-testid="profile-editor-toggle"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition-colors"
      >
        <div>
          <h3 className="text-sm font-semibold text-white">Profile details</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Add optional details. Each field has a <span className="text-emerald-400">Public</span> / <span className="text-slate-300">Private</span> toggle.</p>
        </div>
        <span className="text-xs text-slate-500">{open ? "Hide" : "Edit"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-800 p-5 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Display name <span className="text-slate-500 normal-case">(always public — credits your designs)</span></label>
            <input
              data-testid="profile-name-input"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full h-9 px-3 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-orange-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Email <span className="text-slate-500 normal-case">(never shown publicly)</span></label>
            <input
              data-testid="profile-email-display"
              type="email"
              disabled
              value={user.email}
              className="w-full h-9 px-3 bg-slate-950/50 border border-slate-800 rounded text-sm text-slate-400 cursor-not-allowed"
            />
          </div>
          <ShareableField
            label="Avatar URL"
            icon={ImageIcon}
            testid="profile-avatar"
            value={form.avatar_url}
            placeholder="https://…/me.jpg"
            share={form.share_avatar}
            onChange={(v) => setForm({ ...form, avatar_url: v })}
            onToggleShare={(v) => setForm({ ...form, share_avatar: v })}
          />
          <ShareableField
            label="Preferred contact link"
            icon={LinkIcon}
            testid="profile-contact"
            value={form.contact_link}
            placeholder="Personal site, Mastodon, X, Discord, GitHub — whatever you prefer"
            share={form.share_contact}
            onChange={(v) => setForm({ ...form, contact_link: v })}
            onToggleShare={(v) => setForm({ ...form, share_contact: v })}
          />
          <div data-testid="profile-location-fields">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] uppercase tracking-wider text-slate-400 font-medium flex items-center gap-1">
                <MapPin size={11} className="text-orange-400" /> Location
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer select-none">
                <input
                  data-testid="profile-location-share"
                  type="checkbox"
                  checked={form.share_location}
                  onChange={(e) => setForm({ ...form, share_location: e.target.checked })}
                  className="accent-orange-500"
                />
                {form.share_location ? <span className="text-emerald-400 inline-flex items-center gap-1"><Globe size={10} /> Public</span> : <span className="inline-flex items-center gap-1"><Lock size={10} /> Private</span>}
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input data-testid="profile-city-input" type="text" placeholder="City"
                value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="h-9 px-3 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-orange-500 outline-none" />
              <input data-testid="profile-state-input" type="text" placeholder="State / Region"
                value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="h-9 px-3 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-orange-500 outline-none" />
              <input data-testid="profile-country-input" type="text" placeholder="Country"
                value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="h-9 px-3 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:border-orange-500 outline-none" />
            </div>
          </div>
          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-300 p-2" data-testid="profile-editor-error">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{typeof error === "string" ? error : "Couldn't update profile."}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              data-testid="profile-editor-save"
              onClick={save}
              disabled={busy || !dirty}
              className="h-9 px-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded flex items-center gap-1.5"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DesignTile({ item, onDelete }) {
  const thumb = item.thumbnail_base64 ? `data:image/png;base64,${item.thumbnail_base64}` : PLACEHOLDER;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden hover:border-orange-500/60 transition-all" data-testid={`my-design-card-${item.id}`}>
      <div className="aspect-square bg-slate-950 relative">
        <img src={thumb} alt={item.name} className="w-full h-full object-cover" />
        {item.private && (
          <div className="absolute top-2 left-2 bg-slate-950/80 backdrop-blur text-[10px] font-mono text-cyan-300 px-1.5 py-0.5 rounded flex items-center gap-1 border border-cyan-500/40">
            <Lock size={10} /> private
          </div>
        )}
        <div className="absolute top-2 right-2 bg-black/70 backdrop-blur text-[10px] font-mono text-orange-400 px-1.5 py-0.5 rounded">
          {item.triangle_count?.toLocaleString() || 0} △
        </div>
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate" title={item.name}>{item.name}</h3>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {item.remix_count > 0 ? `${item.remix_count} remixes · ` : ""}
          {item.downloads || 0} downloads
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Link
            to={`/workspace?remix=${item.id}`}
            data-testid={`my-design-open-${item.id}`}
            className="flex-1 h-8 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded flex items-center justify-center gap-1"
          >
            <GitFork size={12} /> Open
          </Link>
          <a
            data-testid={`my-design-download-${item.id}`}
            href={galleryApi.downloadUrl(item.id)}
            className="h-8 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded flex items-center gap-1 border border-slate-700"
          >
            <Download size={12} /> STL
          </a>
          <button
            data-testid={`my-design-delete-${item.id}`}
            onClick={() => onDelete(item.id)}
            className="h-8 w-8 bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded flex items-center justify-center border border-slate-700"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ComponentTile({ item, onDelete, onAdd }) {
  const isNeg = item.modifier === "negative";
  const thumb = item.thumbnail_base64 ? `data:image/png;base64,${item.thumbnail_base64}` : PLACEHOLDER;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden hover:border-orange-500/60 transition-all" data-testid={`my-component-card-${item.id}`}>
      <div className="aspect-square bg-slate-950 relative">
        <img src={thumb} alt={item.name} className="w-full h-full object-cover" />
        <div className={`absolute top-2 left-2 backdrop-blur text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 ${
          isNeg ? "bg-cyan-500/30 text-cyan-200 border border-cyan-500/40"
                : "bg-orange-500/30 text-orange-200 border border-orange-500/40"
        }`}>
          {isNeg ? <><MinusSquare size={10} /> negative</> : <><PlusSquare size={10} /> positive</>}
        </div>
        {item.private && (
          <div className="absolute top-2 right-2 bg-slate-950/80 backdrop-blur text-[10px] font-mono text-cyan-300 px-1.5 py-0.5 rounded flex items-center gap-1 border border-cyan-500/40">
            <Lock size={10} /> private
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate" title={item.name}>{item.name}</h3>
        <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
          <span>{item.category}</span>
          <span className="text-amber-400 flex items-center gap-0.5"><Star size={9} /> {item.votes || 0}</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            data-testid={`my-component-add-${item.id}`}
            onClick={() => onAdd(item)}
            className={`flex-1 h-8 text-white text-xs font-semibold rounded flex items-center justify-center gap-1 ${
              isNeg ? "bg-cyan-500 hover:bg-cyan-600" : "bg-orange-500 hover:bg-orange-600"
            }`}
          >
            <Plus size={12} /> Add to Scene
          </button>
          <button
            data-testid={`my-component-delete-${item.id}`}
            onClick={() => onDelete(item.id)}
            className="h-8 w-8 bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded flex items-center justify-center border border-slate-700"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, loading, refresh, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "designs";
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const navigate = useNavigate();
  const [designs, setDesigns] = useState([]);
  const [components, setComponents] = useState([]);
  const [contributor, setContributor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!user) return;
    setBusy(true); setError("");
    try {
      const [d, c, contrib] = await Promise.all([
        meApi.designs(),
        meApi.components(),
        // Contributor status is best-effort — if the endpoint hiccups we
        // still want the rest of the profile to render.
        meApi.contributorStatus().catch(() => null),
      ]);
      setDesigns(d); setComponents(c); setContributor(contrib);
      // If the backend just flipped contributor_lifetime to true (because
      // this fetch crossed the threshold), refresh the auth context so the
      // celebration toast (driven by AuthContext.maybeCelebrate) fires.
      if (contrib && contrib.contributor_lifetime && !user?.contributor_lifetime) {
        refresh().catch(() => { /* non-fatal */ });
      }
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center" data-testid="profile-loading">
        <div className="text-slate-400 text-sm">Loading profile…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center" data-testid="profile-anonymous">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
          <h2 className="text-lg font-semibold">Sign in to view your profile</h2>
          <p className="text-xs text-slate-400 mt-1">Designs and components you save will land here.</p>
          <Link
            data-testid="profile-signin-btn"
            to="/signin?return=%2Fprofile"
            className="mt-5 inline-block h-10 px-5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded leading-10"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const handleDeleteDesign = async (id) => {
    if (!confirm("Remove this design from your library?")) return;
    try { await galleryApi.delete(id); setDesigns((p) => p.filter((x) => x.id !== id)); }
    catch (e) { alert(e.message); }
  };
  const handleDeleteComponent = async (id) => {
    if (!confirm("Remove this component from your library?")) return;
    try { await componentsApi.delete(id); setComponents((p) => p.filter((x) => x.id !== id)); }
    catch (e) { alert(e.message); }
  };
  const handleAddComponent = async (it) => {
    try {
      const proj = await componentsApi.getProject(it.id);
      sessionStorage.setItem("forgeslicer.addComponent", JSON.stringify({
        name: proj.name, modifier: proj.modifier,
        project_json: proj.project_json, stl_base64: proj.stl_base64,
      }));
      navigate("/workspace?addComponent=1");
    } catch (e) { alert(e.message); }
  };

  const totalRemixes = designs.reduce((s, d) => s + (d.remix_count || 0), 0);
  const totalDownloads = designs.reduce((s, d) => s + (d.downloads || 0), 0);
  const totalUpvotes = components.reduce((s, c) => s + (c.votes || 0), 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white" data-testid="profile-page">
      <header className="h-14 border-b border-slate-800 bg-slate-900 flex items-center px-4 sticky top-0 z-10">
        <Link to="/workspace" data-testid="profile-back-btn" className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> <span className="text-sm">Back to Workspace</span>
        </Link>
        <div className="flex-1" />
        <Link to="/" className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <Hexagon size={16} className="text-white" strokeWidth={2.4} />
          </div>
          <span className="text-sm font-bold tracking-tight">ForgeSlicer</span>
        </Link>
        <ThemeSwitcher />
      </header>
      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center gap-5 mb-8">
          {user.picture ? (
            <img src={user.picture} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full object-cover border border-slate-700" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-orange-500/20 text-orange-300 text-xl font-bold flex items-center justify-center border border-slate-700">
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
            <p className="text-xs text-slate-400">{user.email}</p>
          </div>
          <button
            data-testid="profile-refresh-btn"
            onClick={load}
            className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 border border-slate-700"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatTile label="My Designs" value={designs.length} />
          <StatTile label="My Components" value={components.length} accent="text-cyan-400" />
          <StatTile label="Total Remixes" value={totalRemixes} accent="text-amber-400" />
          <StatTile label="Component Upvotes" value={totalUpvotes} accent="text-emerald-400" />
        </div>

        <ContributorCard status={contributor} />

        <ProfileEditor user={user} onSaved={(u) => setUser(u)} />

        <div className="flex items-center gap-1 mb-6 border-b border-slate-800">
          {[
            { key: "designs", label: `Designs (${designs.length})` },
            { key: "components", label: `Components (${components.length})` },
          ].map((t) => (
            <button
              key={t.key}
              data-testid={`profile-tab-${t.key}`}
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
          {totalDownloads > 0 && (
            <span className="ml-auto text-[11px] text-slate-500 self-center">{totalDownloads} total downloads</span>
          )}
        </div>

        {error && <div className="text-red-400 text-sm mb-3" data-testid="profile-error">{error}</div>}
        {busy && <div className="text-slate-400 text-sm mb-3">Loading…</div>}

        {tab === "designs" && (
          <>
            {!busy && designs.length === 0 && (
              <div className="border border-dashed border-slate-700 rounded-lg p-12 text-center" data-testid="profile-empty-designs">
                <p className="text-slate-400 mb-1">You haven't saved any designs yet.</p>
                <p className="text-xs text-slate-500 mb-4">Save a design from the workspace and toggle it to <span className="text-cyan-300">Private</span> to keep it just for you.</p>
                <Link to="/workspace" className="inline-block h-9 px-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded leading-9">
                  Open Workspace
                </Link>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="my-designs-grid">
              {designs.map((it) => (
                <DesignTile key={it.id} item={it} onDelete={handleDeleteDesign} />
              ))}
            </div>
          </>
        )}

        {tab === "components" && (
          <>
            {!busy && components.length === 0 && (
              <div className="border border-dashed border-slate-700 rounded-lg p-12 text-center" data-testid="profile-empty-components">
                <p className="text-slate-400 mb-1">No components saved yet.</p>
                <p className="text-xs text-slate-500 mb-4">Build a part, then <span className="text-orange-300">Save as Component</span> from the workspace to keep it in your library.</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="my-components-grid">
              {components.map((it) => (
                <ComponentTile key={it.id} item={it} onDelete={handleDeleteComponent} onAdd={handleAddComponent} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

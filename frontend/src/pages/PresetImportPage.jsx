/**
 * PresetImportPage — landing page for `/presets/:slug` share links
 * (iter-151.9). Anyone can view the preset details (public preview);
 * clicking "Apply to workspace" REQUIRES sign-in, per the product
 * decision to track adoption / attribution.
 */
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Package, LogIn, Loader2, ArrowRight, ThumbsUp } from "lucide-react";
import { printPresetsApi } from "../lib/api";
import { useScene, useSliceSettings } from "../lib/store";
import { useAuth } from "../contexts/AuthContext";

export default function PresetImportPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [preset, setPreset] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const { user } = useAuth();
  const setPrinter = useScene((s) => s.setPrinter);
  const setFilament = useScene((s) => s.setFilament);
  const applySettings = useSliceSettings((s) => s.set);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await printPresetsApi.get(slug);
        if (!cancelled) setPreset(p);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.detail || "Preset not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const apply = async () => {
    setApplying(true);
    try {
      // apply endpoint requires auth — surfaces 401 if user is
      // signed out, redirects them to /signin?next=/presets/:slug.
      const applied = await printPresetsApi.apply(slug);
      if (applied.printer_id) setPrinter(applied.printer_id);
      if (applied.filament_id) setFilament(applied.filament_id);
      if (applied.slice_settings) applySettings(applied.slice_settings);
      toast.success(`Applied "${applied.name}" · heading to workspace`);
      setTimeout(() => navigate("/workspace"), 400);
    } catch (err) {
      if (err?.response?.status === 401) {
        toast.error("Sign in to import this preset");
        navigate(`/signin?next=${encodeURIComponent(`/presets/${slug}`)}`);
      } else {
        toast.error(`Apply failed: ${err?.response?.data?.detail || err.message}`);
      }
    } finally {
      setApplying(false);
    }
  };

  const toggleVote = async () => {
    if (!user) {
      toast.error("Sign in to vote on presets");
      return;
    }
    try {
      const updated = preset.voted
        ? await printPresetsApi.unvote(slug)
        : await printPresetsApi.vote(slug);
      setPreset(updated);
    } catch (err) {
      toast.error(`${err?.response?.data?.detail || err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }
  if (error || !preset) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center gap-3">
        <div className="text-2xl font-semibold text-red-400">Preset not found</div>
        <div className="text-sm text-slate-400">{error}</div>
        <Link to="/" className="text-purple-400 hover:text-purple-300 underline">← Home</Link>
      </div>
    );
  }

  const settings = preset.slice_settings || {};
  const rows = [
    ["Layer height", settings.layerHeight, "mm"],
    ["Nozzle Ø", settings.nozzleDiameter, "mm"],
    ["Perimeters", settings.perimeters, ""],
    ["Infill", settings.infillPercent, "%"],
    ["Infill pattern", settings.infillPattern, ""],
    ["Nozzle temp", settings.nozzleTemp, "°C"],
    ["Bed temp", settings.bedTemp, "°C"],
    ["Print speed", settings.printSpeed, "mm/s"],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-slate-200 py-16 px-4">
      <div className="max-w-2xl mx-auto" data-testid="preset-import-page">
        <div className="flex items-center gap-2 text-purple-400 mb-2">
          <Package size={16} /> <span className="uppercase tracking-widest text-xs">Print-Shop Preset</span>
        </div>
        <h1 className="text-4xl font-bold text-white mb-2" data-testid="preset-name">{preset.name}</h1>
        <div className="text-sm text-slate-400 mb-6 flex items-center gap-3 flex-wrap">
          <span>by <span className="text-slate-200 font-semibold">{preset.author_name}</span></span>
          <span>·</span>
          <span><span className="font-mono">{preset.uses}</span> apply{preset.uses === 1 ? "" : "s"}</span>
          {(preset.upvotes || 0) > 0 && (
            <>
              <span>·</span>
              <span className="text-purple-300 font-mono" data-testid="preset-detail-upvotes"><ThumbsUp size={11} className="inline mr-1" />{preset.upvotes}</span>
            </>
          )}
          <button
            type="button"
            data-testid="preset-detail-vote-btn"
            onClick={toggleVote}
            disabled={!user}
            className={`ml-auto flex items-center gap-1.5 text-xs font-semibold rounded px-2.5 py-1 transition-colors ${
              preset.voted
                ? "bg-purple-500/20 text-purple-300"
                : "bg-slate-800 text-slate-300 hover:bg-purple-500/20 hover:text-purple-300 disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
            title={!user ? "Sign in to vote" : preset.voted ? "Remove your upvote" : "Upvote this preset"}
          >
            <ThumbsUp size={12} className={preset.voted ? "fill-purple-300" : ""} />
            {preset.voted ? "Voted" : "Upvote"}
          </button>
        </div>
        {preset.description && (
          <p className="text-slate-300 mb-6 leading-relaxed" data-testid="preset-description">{preset.description}</p>
        )}
        <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-2">Included Settings</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-400">Printer</span>
            <span className="text-slate-200 font-mono text-right">{preset.printer_id}</span>
            <span className="text-slate-400">Filament</span>
            <span className="text-slate-200 font-mono text-right">{preset.filament_id}</span>
            {rows.map(([label, value, unit]) => (
              <React.Fragment key={label}>
                <span className="text-slate-400">{label}</span>
                <span className="text-slate-200 font-mono text-right">{value}{unit && ` ${unit}`}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            data-testid="apply-preset-btn"
            onClick={apply}
            disabled={applying}
            className="flex-1 h-11 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            {applying ? <Loader2 className="animate-spin" size={16} /> : (user ? <ArrowRight size={16} /> : <LogIn size={16} />)}
            {user ? "Apply to workspace" : "Sign in to apply"}
          </button>
          <Link
            to="/"
            className="h-11 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center"
          >
            Cancel
          </Link>
        </div>
        {!user && (
          <div className="mt-4 text-xs text-slate-500 leading-snug">
            Import requires a free ForgeSlicer account. Sign in and we'll bring you back to this page to apply.
          </div>
        )}
      </div>
    </div>
  );
}

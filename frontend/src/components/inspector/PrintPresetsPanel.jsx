/**
 * PrintPresetsPanel — save & apply slicer + material bundles as
 * shareable Print-Shop Presets (iter-151.9).
 *
 * Two functions in one compact panel:
 *   1. Save current slicer settings + printer + filament as a Preset,
 *      returning a `/presets/:slug` share URL.
 *   2. Browse the user's own presets and apply any of them with one
 *      click — writes back into `useSliceSettings`, `printerId`, and
 *      `filamentId`.
 *
 * Import flow (following a share link) lives in `PresetsImportPage.jsx`
 * — it requires sign-in per product decision.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Share2, Trash2, Package, Loader2 } from "lucide-react";
import { useScene, useSliceSettings } from "../../lib/store";
import { printPresetsApi } from "../../lib/api";

export default function PrintPresetsPanel() {
  const printerId = useScene((s) => s.printerId);
  const filamentId = useScene((s) => s.filamentId);
  const setPrinter = useScene((s) => s.setPrinter);
  const setFilament = useScene((s) => s.setFilament);
  const settings = useSliceSettings();
  const applySettings = useSliceSettings((s) => s.set);

  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  const loadMine = async () => {
    setLoading(true);
    try {
      const list = await printPresetsApi.listMine();
      setMine(list || []);
    } catch (err) {
      // 401 → user isn't signed in; render an empty list rather than
      // shouting at them (public visitors browse the workspace too).
      if (err?.response?.status !== 401) {
        // eslint-disable-next-line no-console
        console.warn("listMine failed:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMine(); }, []);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give your preset a name");
      return;
    }
    setSaving(true);
    try {
      // Snapshot slice settings — omit the setter function itself.
      const snapshot = { ...settings };
      delete snapshot.set;
      const created = await printPresetsApi.create({
        name: name.trim(),
        description: description.trim(),
        is_public: isPublic,
        printer_id: printerId,
        filament_id: filamentId,
        slice_settings: snapshot,
      });
      setMine((prev) => [created, ...prev]);
      const shareUrl = `${window.location.origin}/presets/${created.slug}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Preset saved · share URL copied to clipboard");
      } catch {
        toast.success("Preset saved");
      }
      setName("");
      setDescription("");
    } catch (err) {
      if (err?.response?.status === 401) {
        toast.error("Sign in to save presets");
      } else {
        toast.error(`Save failed: ${err?.response?.data?.detail || err.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const apply = (preset) => {
    if (preset.printer_id) setPrinter(preset.printer_id);
    if (preset.filament_id) setFilament(preset.filament_id);
    if (preset.slice_settings && typeof preset.slice_settings === "object") {
      applySettings(preset.slice_settings);
    }
    toast.success(`Applied "${preset.name}"`);
  };

  const copyShareUrl = async (slug) => {
    const url = `${window.location.origin}/presets/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share URL copied");
    } catch {
      toast.error("Clipboard blocked · URL: " + url);
    }
  };

  const remove = async (preset) => {
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
    try {
      await printPresetsApi.delete(preset.slug);
      setMine((prev) => prev.filter((p) => p.slug !== preset.slug));
      toast.success("Preset deleted");
    } catch (err) {
      toast.error(`Delete failed: ${err?.response?.data?.detail || err.message}`);
    }
  };

  return (
    <div
      data-testid="print-presets-panel"
      className="bg-slate-950/60 border border-slate-800 rounded p-2 flex flex-col gap-2"
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium flex items-center gap-1">
        <Package size={11} className="text-purple-400" /> Print-Shop Presets
      </div>

      {/* Save current settings as a new preset */}
      <div className="flex flex-col gap-1 border-b border-slate-800 pb-2">
        <input
          data-testid="preset-name-input"
          type="text"
          placeholder="Preset name (e.g. PLA 0.2 gyroid)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="h-7 px-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:border-purple-500 outline-none"
        />
        <textarea
          data-testid="preset-description-input"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={2}
          className="px-1.5 py-1 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:border-purple-500 outline-none resize-none"
        />
        <label className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer">
          <input
            data-testid="preset-public-toggle"
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="accent-purple-500"
          />
          Public (shareable by link)
        </label>
        <button
          data-testid="save-preset-btn"
          onClick={save}
          disabled={saving || !name.trim()}
          className="h-7 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-semibold flex items-center justify-center gap-1"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Share2 size={11} />}
          Save as preset
        </button>
      </div>

      {/* My presets */}
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-medium flex items-center justify-between">
        <span>My Presets ({mine.length})</span>
        <button
          onClick={loadMine}
          className="text-purple-400 hover:text-purple-300 normal-case tracking-normal"
          data-testid="refresh-presets-btn"
        >
          Refresh
        </button>
      </div>
      {loading && <div className="text-[10px] text-slate-500 italic">Loading…</div>}
      {!loading && mine.length === 0 && (
        <div className="text-[10px] text-slate-500 italic">
          No saved presets yet · sign in and save one above.
        </div>
      )}
      {mine.map((p) => (
        <div
          key={p.slug}
          data-testid={`preset-row-${p.slug}`}
          className="border border-slate-800 rounded p-1.5 flex flex-col gap-1"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] text-slate-200 font-semibold truncate" title={p.name}>{p.name}</span>
            <span className="text-[9px] text-slate-500 font-mono">{p.uses} uses</span>
          </div>
          {p.description && (
            <div className="text-[9px] text-slate-500 italic leading-snug line-clamp-2">{p.description}</div>
          )}
          <div className="text-[9px] text-slate-500 font-mono">
            {p.printer_id} · {p.filament_id} · {p.is_public ? "Public" : "Private"}
          </div>
          <div className="flex gap-1">
            <button
              data-testid={`apply-preset-${p.slug}`}
              onClick={() => apply(p)}
              className="flex-1 h-6 rounded bg-purple-700 hover:bg-purple-600 text-white text-[10px] font-semibold"
            >
              Apply
            </button>
            <button
              data-testid={`share-preset-${p.slug}`}
              onClick={() => copyShareUrl(p.slug)}
              className="h-6 px-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold flex items-center gap-1"
              title="Copy share URL"
            >
              <Copy size={10} />
            </button>
            <button
              data-testid={`delete-preset-${p.slug}`}
              onClick={() => remove(p)}
              className="h-6 px-1.5 rounded bg-slate-800 hover:bg-red-600 text-slate-400 hover:text-white text-[10px] font-semibold"
              title="Delete preset"
            >
              <Trash2 size={10} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

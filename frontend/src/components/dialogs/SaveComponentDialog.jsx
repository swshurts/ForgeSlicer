import React, { useState } from "react";
import { useScene } from "../../lib/store";
import { bytesToBase64 } from "../../lib/exporters";
import { exportSTLBytesAsync } from "../../lib/workerClient";
import { componentsApi } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { startLogin } from "../../lib/auth";
import { X, CheckCircle2, Loader2, Library, PlusSquare, MinusSquare, Lock, LogIn } from "lucide-react";


const COMPONENT_CATEGORIES = [
  { key: "mechanical", label: "Mechanical" },
  { key: "rack",       label: "Rack / Enclosure" },
  { key: "mounting",   label: "Mounting" },
  { key: "fasteners",  label: "Fasteners" },
  { key: "electronics", label: "Electronics" },
  { key: "brackets",   label: "Brackets" },
  { key: "hinges",     label: "Hinges" },
  { key: "gears",      label: "Gears" },
  { key: "decorative", label: "Decorative" },
  { key: "organizers", label: "Organizers" },
  { key: "miniatures", label: "Miniatures" },
  { key: "structural", label: "Structural" },
  { key: "misc",       label: "Misc" },
];

export function SaveComponentDialog({ open, onClose }) {
  const { user } = useAuth();
  const objects = useScene((s) => s.objects);
  const selectedIds = useScene((s) => s.selectedIds);
  const projectName = useScene((s) => s.projectName);
  const [name, setName] = useState(projectName);
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  // If the user has a multi-selection (typically a freshly-grouped assembly)
  // default the dialog to save just that subset — saves a click and matches
  // the "build a U1 panel, then save it" workflow.
  const hasSelection = selectedIds && selectedIds.length > 0;
  const canScopeSelection = hasSelection && selectedIds.length < objects.length;
  const [saveSelectionOnly, setSaveSelectionOnly] = useState(canScopeSelection);
  // Default the component-modifier flag to whatever the user's scope is
  // mostly made of — saves a click when packaging a "negative screw hole".
  const scopeObjects = React.useMemo(
    () => (saveSelectionOnly ? objects.filter((o) => selectedIds.includes(o.id)) : objects),
    [objects, selectedIds, saveSelectionOnly],
  );
  const defaultModifier = React.useMemo(() => {
    if (!scopeObjects.length) return "positive";
    const neg = scopeObjects.filter((o) => o.modifier === "negative").length;
    return neg > scopeObjects.length / 2 ? "negative" : "positive";
  }, [scopeObjects]);
  const [modifier, setModifier] = useState(defaultModifier);
  // Auto-enable "include opposite modifier" when the scope is intrinsically
  // mixed — e.g. a standoff (positive shell + negative bolt hole) or a
  // bracket with built-in cutouts. The user almost always wants the WHOLE
  // assembly saved, not just one half of it.
  const scopeIsMixed = React.useMemo(() => {
    if (!scopeObjects.length) return false;
    const hasPos = scopeObjects.some((o) => (o.modifier || "positive") === "positive");
    const hasNeg = scopeObjects.some((o) => o.modifier === "negative");
    return hasPos && hasNeg;
  }, [scopeObjects]);
  const [matchModifier, setMatchModifier] = useState(!scopeIsMixed);
  // When the user picks NEGATIVE / POSITIVE we strip the scope down to ONLY
  // those parts so re-adding the component doesn't drag along the host plate
  // or unrelated geometry. The "Include all parts" checkbox below lets them
  // override (e.g. when saving a positive bracket with built-in negative
  // mounting cutouts).
  const effectiveObjects = React.useMemo(() => {
    if (!matchModifier) return scopeObjects;
    return scopeObjects.filter((o) => (o.modifier || "positive") === modifier);
  }, [scopeObjects, matchModifier, modifier]);
  const [category, setCategory] = useState("misc");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (!open) return;
    setName(projectName);
    setModifier(defaultModifier);
    // Re-evaluate "include opposite modifier" on every open — the dialog is
    // long-lived (mounted with open=false) so the initial useState ran when
    // selectedIds was empty and scopeIsMixed=false. Without this, opening
    // the dialog on a standoff (positive shell + negative bolt hole) would
    // skip the negative part.
    setMatchModifier(!scopeIsMixed);
    setSaveSelectionOnly(canScopeSelection);
    setDone(null);
    setError("");
  }, [open, projectName, defaultModifier, scopeIsMixed, canScopeSelection]);

  if (!open) return null;

  const captureThumb = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return "";
    try { return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""); }
    catch { return ""; }
  };

  const handleSave = async () => {
    setError(""); setBusy(true); setDone(null);
    try {
      // CSG evaluator needs at least one POSITIVE shell to produce any STL
      // geometry, so a pure-negative scope (e.g. a rack-mount screw-hole
      // pattern, M3 bolt cutouts, a vent grille) would otherwise fail with
      // "Scene is empty". Detect that case and bake a positives-only copy
      // for the STL/thumbnail preview. The on-disk component JSON keeps
      // each part's original modifier, so when a user drops the component
      // back into a scene it still subtracts properly.
      const allNegative = effectiveObjects.length > 0
        && effectiveObjects.every((o) => o.modifier === "negative");
      const stlScope = allNegative
        ? effectiveObjects.map((o) => ({ ...o, modifier: "positive" }))
        : effectiveObjects;
      const { bytes, triangleCount } = await exportSTLBytesAsync(stlScope);
      const stlB64 = bytesToBase64(bytes);
      // Serialize the editable project JSON so "Add to Scene" can restore
      // primitive types/dims/colorIndex on import. We strip raw geometry
      // buffers (already covered by the STL fallback) to keep the payload
      // size sensible.
      //
      // If the user is saving 2+ parts, stamp them with a fresh shared
      // groupId so the recalled component arrives in the host scene as ONE
      // already-grouped assembly. Otherwise each part would land as an
      // independent item and the user would have to re-marquee + re-group
      // every time they drop the component. The existing per-part groupId
      // (if any) is overridden so a "block within a block" lineage doesn't
      // accidentally re-bind to the source project's old group.
      const componentName = name || "Untitled Component";
      const isAssembly = effectiveObjects.length > 1;
      const sharedGroupId = isAssembly ? `cmp-${Math.random().toString(36).slice(2, 11)}` : null;
      const projectObjects = effectiveObjects.map((o) => {
        const { geometry, ...rest } = o;
        if (sharedGroupId) {
          rest.groupId = sharedGroupId;
          rest.groupName = componentName;
        }
        return rest;
      });
      const projectJson = JSON.stringify({ objects: projectObjects });
      const created = await componentsApi.create({
        name: componentName,
        author: author || "Anonymous",
        description,
        modifier,
        category,
        tags,
        stl_base64: stlB64,
        project_json: projectJson,
        thumbnail_base64: captureThumb(),
        triangle_count: Math.floor(triangleCount),
        object_count: effectiveObjects.length,
        private: user ? isPrivate : false,
      });
      setDone(created);
    } catch (e) {
      // Surface server status + URL so 404 / 413 / 500 mysteries are easy to
      // diagnose (axios hides them behind "Request failed with status code N"
      // by default).
      const resp = e?.response;
      let msg = resp?.data?.detail || resp?.data || e.message || String(e);
      if (resp) {
        const u = resp.config?.url || "";
        msg = `${msg} (HTTP ${resp.status}${u ? " · " + u : ""})`;
      }
      try {
        const approx = (stlB64 ? stlB64.length : 0) + (captureThumb()?.length || 0);
        if (approx > 8 * 1024 * 1024) {
          msg += ` — payload is ~${(approx / (1024 * 1024)).toFixed(1)} MB; try checking 'Save selected only' or reducing mesh complexity.`;
        }
      } catch (_) {}
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="save-component-dialog">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Library size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Save as Component</h2>
          </div>
          <button onClick={onClose} data-testid="save-component-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        {!done ? (
          <div className="p-4 flex flex-col gap-3">
            {canScopeSelection && (
              <label className="flex items-center gap-2 text-[11px] text-slate-200 cursor-pointer select-none bg-purple-500/10 border border-purple-500/40 rounded px-3 py-2">
                <input
                  data-testid="component-scope-selection"
                  type="checkbox"
                  checked={saveSelectionOnly}
                  onChange={(e) => setSaveSelectionOnly(e.target.checked)}
                  className="accent-orange-500"
                />
                <span className="flex-1">
                  Save <span className="text-orange-300 font-semibold">selected {selectedIds.length} components</span> only
                  <span className="text-slate-500"> (otherwise the whole scene is saved)</span>
                </span>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Name</span>
              <input data-testid="component-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. U1 blank panel" className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Author</span>
                {user ? (
                  <div data-testid="component-author-readonly" className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-slate-300 px-3 flex items-center gap-2">
                    {user.picture && <img src={user.picture} alt="" className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" />}
                    <span className="truncate">{user.name}</span>
                  </div>
                ) : (
                  <input data-testid="component-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Anonymous" className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none" />
                )}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Category</span>
                <select data-testid="component-category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none">
                  {COMPONENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            </div>
            {user ? (
              <label className="flex items-center gap-2 px-3 py-2 bg-cyan-500/10 border border-cyan-500/40 rounded text-[11px] text-slate-200 cursor-pointer select-none">
                <input
                  data-testid="component-private-toggle"
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="accent-orange-500"
                />
                <Lock size={12} className="text-cyan-300" />
                <span className="flex-1">
                  <span className="text-cyan-200 font-semibold">Private</span> — only visible to you in <span className="text-orange-300">My Components</span>.
                </span>
              </label>
            ) : (
              <button
                type="button"
                data-testid="component-signin-cta"
                onClick={() => startLogin("/workspace")}
                className="flex items-center gap-2 px-3 py-2 bg-slate-950 border border-orange-500/40 hover:border-orange-500/70 rounded text-[11px] text-slate-300 text-left"
              >
                <LogIn size={12} className="text-orange-400" />
                <span><span className="text-orange-300 font-semibold">Sign in</span> to save private components tied to your profile.</span>
              </button>
            )}
            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 mb-1 block">Type</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="component-modifier-positive"
                  onClick={() => setModifier("positive")}
                  className={`h-10 rounded border text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 ${
                    modifier === "positive"
                      ? "bg-orange-500/20 border-orange-500 text-orange-200"
                      : "bg-slate-900 border-slate-700 text-slate-400"
                  }`}
                >
                  <PlusSquare size={13} /> Positive
                </button>
                <button
                  type="button"
                  data-testid="component-modifier-negative"
                  onClick={() => setModifier("negative")}
                  className={`h-10 rounded border text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 ${
                    modifier === "negative"
                      ? "bg-cyan-500/20 border-cyan-500 text-cyan-200"
                      : "bg-slate-900 border-slate-700 text-slate-400"
                  }`}
                >
                  <MinusSquare size={13} /> Negative
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
                <input
                  data-testid="component-include-all"
                  type="checkbox"
                  checked={!matchModifier}
                  onChange={(e) => setMatchModifier(!e.target.checked)}
                  className="accent-orange-500"
                />
                Include parts of the opposite modifier
                <span className="text-slate-500">(e.g. a positive bracket with built-in negative cutouts)</span>
              </label>
              <div data-testid="component-scope-summary" className="mt-2 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-[11px] font-mono text-slate-400 flex items-center gap-2">
                <Library size={12} className="text-orange-400" />
                <span>Saving</span>
                <span className="text-white font-semibold">{effectiveObjects.length}</span>
                <span>{effectiveObjects.length === 1 ? "part" : "parts"}</span>
                {effectiveObjects.length !== scopeObjects.length && (
                  <span className="text-slate-500">· {scopeObjects.length - effectiveObjects.length} skipped (not {modifier})</span>
                )}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Tags (comma-separated)</span>
              <input data-testid="component-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="screw, M3, 10mm" className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Description</span>
              <textarea data-testid="component-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="bg-slate-950 border border-slate-700 rounded text-sm text-white p-2 focus:border-orange-500 outline-none resize-none" />
            </label>
            {error && <div className="text-xs text-red-400">{error}</div>}
            <button
              data-testid="component-save-btn"
              onClick={handleSave}
              disabled={busy || effectiveObjects.length === 0}
              className="h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-semibold rounded flex items-center justify-center gap-2 uppercase tracking-wider text-xs"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Library size={16} />}
              {busy ? "Saving…" : "Publish to Library"}
            </button>
            <p className="text-[10px] text-slate-500">
              Components are added to a shared library where anyone can drop them into their own scene. Both the STL and the editable project JSON are saved.
            </p>
          </div>
        ) : (
          <div className="p-6 flex flex-col items-center text-center gap-3" data-testid="component-save-success">
            <CheckCircle2 size={42} className="text-green-400" />
            <h3 className="text-base font-semibold text-white">Saved to library!</h3>
            <p className="text-xs text-slate-400">
              <span className="text-orange-300">{done.name}</span> is now in the public component library.
            </p>
            <button onClick={onClose} className="mt-2 h-9 px-4 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

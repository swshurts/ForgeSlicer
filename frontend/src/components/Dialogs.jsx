import React, { useState } from "react";
import { useScene } from "../lib/store";
import { bytesToBase64, downloadBlob } from "../lib/exporters";
import { exportSTLBytesAsync, export3MFBytesAsync } from "../lib/workerClient";
import { galleryApi, printersApi, componentsApi } from "../lib/api";
import { X, Globe, CheckCircle2, Loader2, Printer, Download, Factory, Library, PlusSquare, MinusSquare } from "lucide-react";

export function ShareDialog({ open, onClose }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState(projectName);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // gallery item
  const [error, setError] = useState("");

  React.useEffect(() => { setName(projectName); }, [projectName, open]);

  if (!open) return null;

  const getThumbnail = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return "";
    try {
      const data = canvas.toDataURL("image/png");
      return data.replace(/^data:image\/png;base64,/, "");
    } catch { return ""; }
  };

  const handleShare = async () => {
    setError(""); setBusy(true); setDone(null);
    try {
      const { bytes, triangleCount } = await exportSTLBytesAsync(objects);
      const b64 = bytesToBase64(bytes);
      const thumb = getThumbnail();
      const remixOf = useScene.getState().remixOf;
      // Serialise the full editable project so anyone hitting Remix gets the
      // ORIGINAL primitives — including every negative cylinder — instead of
      // the baked STL (which permanently loses the modifier tag). This is
      // what makes "Remix" actually remixable.
      const projectJson = JSON.stringify(useScene.getState().serialize());
      const created = await galleryApi.create({
        name: name || "Untitled",
        author: author || "Anonymous",
        description,
        stl_base64: b64,
        thumbnail_base64: thumb,
        triangle_count: Math.floor(triangleCount),
        object_count: objects.length,
        remix_of: remixOf || undefined,
        data: projectJson,
      });
      setDone(created);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="share-dialog">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Share to Public Gallery</h2>
          </div>
          <button onClick={onClose} data-testid="share-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        {!done ? (
          <div className="p-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Design name</span>
              <input data-testid="share-name" value={name} onChange={(e) => setName(e.target.value)} className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Author</span>
              <input data-testid="share-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Anonymous" className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Description</span>
              <textarea data-testid="share-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="bg-slate-950 border border-slate-700 rounded text-sm text-white p-2 focus:border-orange-500 outline-none resize-none" />
            </label>
            {error && <div className="text-xs text-red-400">{error}</div>}
            <button
              data-testid="share-confirm-btn"
              onClick={handleShare}
              disabled={busy || objects.length === 0}
              className="h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-semibold rounded flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
              {busy ? "Sharing..." : "Share Publicly"}
            </button>
            <p className="text-[10px] text-slate-500">
              Your design's STL is uploaded to the public gallery. A screenshot of the current viewport is captured as a preview.
            </p>
          </div>
        ) : (
          <div className="p-6 flex flex-col items-center text-center gap-3" data-testid="share-success">
            <CheckCircle2 size={42} className="text-green-400" />
            <h3 className="text-base font-semibold text-white">Shared successfully!</h3>
            <p className="text-xs text-slate-400">Your design is now live in the public gallery.</p>
            <button onClick={onClose} className="mt-2 h-9 px-4 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function OrcaDialog({ open, onClose, targetSlicer }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  React.useEffect(() => {
    if (open) {
      const dismissed = (() => { try { return localStorage.getItem("forgeslicer.hideSlicerHelp") === "1"; } catch { return false; } })();
      setShowHelp(!dismissed && false); // default collapsed; user opens manually
      setDownloaded(false);
    }
  }, [open]);

  if (!open) return null;

  const slicer = targetSlicer || { name: "OrcaSlicer", url: "https://github.com/SoftFever/OrcaSlicer/releases" };

  // Try to launch the slicer via custom URL protocol after download.
  // Browsers can't tell us if the slicer is installed, so this fails
  // silently if the protocol isn't registered.
  const PROTOCOLS = {
    "OrcaSlicer": "orcaslicer://",
    "Orca-Flashforge": "orcaslicer://",
    "Bambu Studio": "bambustudioopen://",
    "PrusaSlicer": "prusaslicer://",
    "SuperSlicer": "superslicer://",
    "Flash Studio Desktop": "flashforge://",
  };
  const attemptProtocolLaunch = () => {
    const proto = PROTOCOLS[slicer.name];
    if (!proto) return;
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = proto;
      document.body.appendChild(iframe);
      setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 2000);
    } catch (_) { /* nope */ }
  };

  const handleDownload = async () => {
    setBusy(true);
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      const { bytes } = await export3MFBytesAsync(objects);
      downloadBlob(new Blob([bytes], { type: "model/3mf" }), `${safe}.3mf`);
      setDownloaded(true);
      // After the file lands, try to launch the slicer optimistically.
      attemptProtocolLaunch();
      // Auto-close so the user doesn't have to hunt for the X. Leaves ~1.5s
      // for the OS save-as / protocol prompt to take focus first.
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      alert(e.message);
    } finally { setBusy(false); }
  };

  const dontShowAgain = () => {
    try { localStorage.setItem("forgeslicer.hideSlicerHelp", "1"); } catch {}
    setShowHelp(false);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="orca-dialog">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Send to {slicer.name}</h2>
          </div>
          <button onClick={onClose} data-testid="orca-close-btn" className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <p className="text-sm text-slate-300">
            Downloads a print-ready <span className="font-mono text-orange-400">.3mf</span> for{" "}
            <span className="font-semibold text-orange-400">{slicer.name}</span>. Double-click the file
            and your slicer will open it.
          </p>
          <button
            data-testid="orca-download-btn"
            onClick={handleDownload}
            disabled={busy || objects.length === 0}
            className="h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-semibold rounded flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {downloaded ? "Download again" : `Download 3MF for ${slicer.name}`}
          </button>

          {!showHelp ? (
            <button
              data-testid="orca-show-help-btn"
              onClick={() => setShowHelp(true)}
              className="text-[11px] text-slate-400 hover:text-orange-400 underline self-start"
            >
              Don't have {slicer.name} yet? Show install instructions
            </button>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] text-slate-300 leading-relaxed" data-testid="orca-help-block">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">How to open in {slicer.name}</span>
                <button
                  onClick={dontShowAgain}
                  data-testid="orca-hide-help-btn"
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                >
                  Don't show again
                </button>
              </div>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Install <a href={slicer.url} target="_blank" rel="noreferrer" className="text-orange-400 underline">{slicer.name}</a> on your computer.
                </li>
                <li>Double-click the downloaded <span className="font-mono text-orange-400">.3mf</span> file — {slicer.name} will open it.</li>
                <li>Or inside {slicer.name}: <span className="font-mono">File → Import / Open → 3MF</span>.</li>
                <li>Slice with {slicer.name}'s full feature set (infill, supports, multi-material).</li>
              </ol>
            </div>
          )}
          <p className="text-[10px] text-slate-500">
            We assume {slicer.name} is already installed (browsers can't detect it directly).
            A <span className="font-mono">forgeslicer://</span> companion is on the roadmap for true one-click hand-off.
          </p>
        </div>
      </div>
    </div>
  );
}


export function SavePrinterDialog({ open, onClose }) {
  const buildVolume = useScene((s) => s.buildVolume);
  const addCommunityPrinter = useScene((s) => s.addCommunityPrinter);
  const setPrinter = useScene((s) => s.setPrinter);

  const [form, setForm] = useState({
    brand: "",
    name: "",
    submitter: "",
    build_x: buildVolume.x,
    build_y: buildVolume.y,
    build_z: buildVolume.z,
    max_nozzle_temp: 260,
    max_bed_temp: 100,
    default_nozzle: 0.4,
    default_print_speed: 120,
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, build_x: buildVolume.x, build_y: buildVolume.y, build_z: buildVolume.z }));
      setDone(null);
      setError("");
    }
    // Only reset when the dialog opens, not when buildVolume changes during use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const numField = (k, label, step = 1, suffix) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      <div className="relative flex items-center">
        <input
          data-testid={`printer-form-${k}`}
          type="number"
          step={step}
          value={form[k]}
          onChange={(e) => set(k, parseFloat(e.target.value || "0"))}
          className="h-9 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 pr-8 focus:border-orange-500 outline-none font-mono"
        />
        {suffix && <span className="absolute right-2 text-[10px] text-slate-500 font-mono">{suffix}</span>}
      </div>
    </label>
  );

  const handleSubmit = async () => {
    setError("");
    if (!form.brand.trim() || !form.name.trim()) {
      setError("Brand and Name are required.");
      return;
    }
    setBusy(true);
    try {
      const created = await printersApi.create({
        brand: form.brand.trim(),
        name: form.name.trim(),
        submitter: form.submitter.trim() || "Anonymous",
        build_x: form.build_x,
        build_y: form.build_y,
        build_z: form.build_z,
        max_nozzle_temp: parseInt(form.max_nozzle_temp, 10),
        max_bed_temp: parseInt(form.max_bed_temp, 10),
        default_nozzle: form.default_nozzle,
        default_print_speed: parseInt(form.default_print_speed, 10),
        notes: form.notes.trim(),
      });
      addCommunityPrinter(created);
      setPrinter(created.id);
      setDone(created);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="save-printer-dialog">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Factory size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Save My Printer to Community</h2>
          </div>
          <button onClick={onClose} data-testid="save-printer-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {!done ? (
          <div className="p-4 flex flex-col gap-3 max-h-[80vh] overflow-y-auto">
            <p className="text-[12px] text-slate-400 leading-snug">
              Share your printer profile so other makers can pick it from the dropdown. We store brand, name, build volume, temps, and a short note — no personal info.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Brand *</span>
                <input
                  data-testid="printer-form-brand"
                  value={form.brand}
                  onChange={(e) => set("brand", e.target.value)}
                  placeholder="e.g. Sovol"
                  className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Name *</span>
                <input
                  data-testid="printer-form-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. SV09 Mod"
                  className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Submitter</span>
              <input
                data-testid="printer-form-submitter"
                value={form.submitter}
                onChange={(e) => set("submitter", e.target.value)}
                placeholder="Anonymous"
                className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {numField("build_x", "Build X", 1, "mm")}
              {numField("build_y", "Build Y", 1, "mm")}
              {numField("build_z", "Build Z", 1, "mm")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {numField("max_nozzle_temp", "Max Hotend", 1, "°C")}
              {numField("max_bed_temp", "Max Bed", 1, "°C")}
              {numField("default_nozzle", "Default Nozzle Ø", 0.05, "mm")}
              {numField("default_print_speed", "Default Speed", 5, "mm/s")}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Notes (optional, 280 chars)</span>
              <textarea
                data-testid="printer-form-notes"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value.slice(0, 280))}
                rows={2}
                placeholder="Direct-drive mod, klipper firmware, tuned for 0.6mm nozzle..."
                className="bg-slate-950 border border-slate-700 rounded text-sm text-white p-2 focus:border-orange-500 outline-none resize-none"
              />
            </label>
            {error && <div className="text-xs text-red-400">{error}</div>}
            <button
              data-testid="printer-form-submit"
              onClick={handleSubmit}
              disabled={busy}
              className="h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-semibold rounded flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Factory size={16} />}
              {busy ? "Saving..." : "Save to Community"}
            </button>
          </div>
        ) : (
          <div className="p-6 flex flex-col items-center text-center gap-3" data-testid="save-printer-success">
            <CheckCircle2 size={42} className="text-green-400" />
            <h3 className="text-base font-semibold text-white">Profile published!</h3>
            <p className="text-xs text-slate-400">
              "{done.brand} {done.name}" is now in the Community group and selected for this project.
            </p>
            <button onClick={onClose} className="mt-2 h-9 px-4 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}


const COMPONENT_CATEGORIES = [
  { key: "mechanical", label: "Mechanical" },
  { key: "rack",       label: "Rack / Enclosure" },
  { key: "mounting",   label: "Mounting" },
  { key: "misc",       label: "Misc" },
];

export function SaveComponentDialog({ open, onClose }) {
  const objects = useScene((s) => s.objects);
  const selectedIds = useScene((s) => s.selectedIds);
  const projectName = useScene((s) => s.projectName);
  const [name, setName] = useState(projectName);
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
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
      const projectObjects = effectiveObjects.map((o) => {
        const { geometry, ...rest } = o;
        return rest;
      });
      const projectJson = JSON.stringify({ objects: projectObjects });
      const created = await componentsApi.create({
        name: name || "Untitled Component",
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
                <input data-testid="component-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Anonymous" className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Category</span>
                <select data-testid="component-category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none">
                  {COMPONENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            </div>
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

import React, { useState } from "react";
import { useScene } from "../lib/store";
import { exportSceneToSTLBytes, bytesToBase64, exportSceneTo3MF } from "../lib/exporters";
import { galleryApi } from "../lib/api";
import { X, Globe, CheckCircle2, Loader2, Printer, Download } from "lucide-react";

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
      const { bytes, triangleCount } = await exportSceneToSTLBytes(objects);
      const b64 = bytesToBase64(bytes);
      const thumb = getThumbnail();
      const created = await galleryApi.create({
        name: name || "Untitled",
        author: author || "Anonymous",
        description,
        stl_base64: b64,
        thumbnail_base64: thumb,
        triangle_count: Math.floor(triangleCount),
        object_count: objects.length,
      });
      setDone(created);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="share-dialog">
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

export function OrcaDialog({ open, onClose }) {
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  if (!open) return null;

  const handleDownload = async () => {
    setBusy(true);
    try {
      const safe = (projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      await exportSceneTo3MF(objects, `${safe}.3mf`);
      setDownloaded(true);
    } catch (e) {
      alert(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="orca-dialog">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-lg shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide uppercase">Send to OrcaSlicer</h2>
          </div>
          <button onClick={onClose} data-testid="orca-close-btn" className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <p className="text-sm text-slate-300">
            ForgeSlicer integrates with OrcaSlicer via the standard <span className="font-mono text-orange-400">.3mf</span> file format.
            Click below to download a print-ready 3MF, then open it in OrcaSlicer.
          </p>
          <button
            data-testid="orca-download-btn"
            onClick={handleDownload}
            disabled={busy || objects.length === 0}
            className="h-10 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 text-white font-semibold rounded flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {downloaded ? "Download again" : "Download 3MF for OrcaSlicer"}
          </button>

          <div className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] text-slate-300 leading-relaxed">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-semibold">How to open in OrcaSlicer</div>
            <ol className="list-decimal list-inside space-y-1">
              <li>Make sure <a href="https://github.com/SoftFever/OrcaSlicer" target="_blank" rel="noreferrer" className="text-orange-400 underline">OrcaSlicer</a> is installed locally.</li>
              <li>Double-click the downloaded <span className="font-mono text-orange-400">.3mf</span> file — OrcaSlicer will open it.</li>
              <li>Or in OrcaSlicer: <span className="font-mono">File → Import → Import 3MF</span>.</li>
              <li>Slice with OrcaSlicer's full feature-set (infill, supports, multi-material).</li>
            </ol>
          </div>
          <p className="text-[10px] text-slate-500">
            A deep-link helper plugin is on the roadmap that will register the <span className="font-mono">forgeslicer://</span> protocol on your OS for one-click hand-off.
          </p>
        </div>
      </div>
    </div>
  );
}

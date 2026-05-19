import React, { useState } from "react";
import { useScene } from "../../lib/store";
import { bytesToBase64 } from "../../lib/exporters";
import { exportSTLBytesAsync } from "../../lib/workerClient";
import { galleryApi } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { startLogin } from "../../lib/auth";
import { LICENSES, DEFAULT_LICENSE_ID, getLicense } from "../../lib/licenses";
import { MATERIALS } from "../../lib/materials";
import { X, Globe, CheckCircle2, Loader2, Lock, LogIn, Scale, Layers } from "lucide-react";

export function ShareDialog({ open, onClose }) {
  const { user } = useAuth();
  const objects = useScene((s) => s.objects);
  const projectName = useScene((s) => s.projectName);
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState(projectName);
  const [isPrivate, setIsPrivate] = useState(false);
  const [licenseId, setLicenseId] = useState(DEFAULT_LICENSE_ID);
  const [materialId, setMaterialId] = useState("pla");
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
        private: user ? isPrivate : false,
        license: licenseId,
        material: materialId,
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
              {user ? (
                <div data-testid="share-author-readonly" className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-slate-300 px-3 flex items-center gap-2 font-medium">
                  {user.picture && <img src={user.picture} alt="" className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" />}
                  <span>{user.name}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-orange-400">signed in</span>
                </div>
              ) : (
                <input data-testid="share-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Anonymous" className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-3 focus:border-orange-500 outline-none" />
              )}
            </label>
            {user ? (
              <label className="flex items-center gap-2 px-3 py-2 bg-cyan-500/10 border border-cyan-500/40 rounded text-[11px] text-slate-200 cursor-pointer select-none">
                <input
                  data-testid="share-private-toggle"
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="accent-orange-500"
                />
                <Lock size={12} className="text-cyan-300" />
                <span className="flex-1">
                  <span className="text-cyan-200 font-semibold">Private</span> — only visible to you in <span className="text-orange-300">My Designs</span>.
                </span>
              </label>
            ) : (
              <button
                type="button"
                data-testid="share-signin-cta"
                onClick={() => startLogin("/workspace")}
                className="flex items-center gap-2 px-3 py-2 bg-slate-950 border border-orange-500/40 hover:border-orange-500/70 rounded text-[11px] text-slate-300 text-left"
              >
                <LogIn size={12} className="text-orange-400" />
                <span><span className="text-orange-300 font-semibold">Sign in</span> to save private designs and tie posts to your profile.</span>
              </button>
            )}
            <label className="flex flex-col gap-1" data-testid="share-material-field">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Layers size={10} className="text-orange-400" /> Recommended material
              </span>
              <select
                data-testid="share-material"
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
                className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
              >
                {MATERIALS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <span className="text-[10px] text-slate-500">Helps other makers pick the right filament; defaults to PLA.</span>
            </label>
            <label className="flex flex-col gap-1" data-testid="share-license-field">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Scale size={10} className="text-orange-400" /> License
              </span>
              <select
                data-testid="share-license"
                value={licenseId}
                onChange={(e) => setLicenseId(e.target.value)}
                className="h-9 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
              >
                {LICENSES.map((l) => (
                  <option key={l.id} value={l.id}>{l.short} — {l.name}</option>
                ))}
              </select>
              {getLicense(licenseId)?.summary && (
                <span className="text-[10px] text-slate-400 leading-snug mt-0.5">
                  {getLicense(licenseId).summary}
                  {getLicense(licenseId).url && (
                    <>
                      {" "}
                      <a
                        href={getLicense(licenseId).url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-400 hover:underline"
                      >
                        full text →
                      </a>
                    </>
                  )}
                </span>
              )}
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

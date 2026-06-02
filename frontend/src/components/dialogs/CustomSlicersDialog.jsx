// Iter-82: CustomSlicersDialog — CRUD UI for the user's custom slicer
// list. Lives in the OrcaDialog ("Manage my slicers" link). Users
// add per-device entries for slicers ForgeSlicer doesn't ship with
// out of the box (Bambu Studio forks bypassing cloud handshake, the
// full-spectrum colour OrcaSlicer modification, in-house company
// builds, etc.).
//
// All state is localStorage-backed via `lib/customSlicers.js` — no
// backend round-trip needed, no auth needed. URL protocols are OS-
// registered (i.e. per-device) so syncing across devices would be
// misleading anyway.

import React, { useEffect, useState } from "react";
import { X, Plus, Trash2, AlertTriangle, Beaker } from "lucide-react";
import { toast } from "sonner";
import {
  loadCustomSlicers, addCustomSlicer, removeCustomSlicer, launchSlicer,
} from "../../lib/customSlicers";

export default function CustomSlicersDialog({ open, onClose }) {
  const [list, setList] = useState([]);
  const [draft, setDraft] = useState({ name: "", protocol: "", installUrl: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setList(loadCustomSlicers());
      setDraft({ name: "", protocol: "", installUrl: "" });
    }
  }, [open]);

  if (!open) return null;

  const handleAdd = (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      addCustomSlicer(draft);
      toast.success(`Added "${draft.name}" — it'll appear in the slicer dropdown.`);
      setList(loadCustomSlicers());
      setDraft({ name: "", protocol: "", installUrl: "" });
    } catch (err) {
      toast.error(err.message || "Couldn't add slicer");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = (id, name) => {
    removeCustomSlicer(id);
    setList(loadCustomSlicers());
    toast.info(`Removed "${name}" from your slicers.`);
  };

  // Test the protocol without downloading anything — useful for
  // verifying you typed it right BEFORE saving and finding out the
  // hard way three downloads later.
  const handleTestProtocol = async (protocol, name) => {
    const r = await launchSlicer(protocol);
    if (r.launched) {
      toast.success(`"${name}" appears to have launched — check your dock/taskbar.`);
    } else {
      toast.warning(
        `Couldn't confirm "${name}" opened. Check that the slicer is installed and registered to handle ${protocol}.`,
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="custom-slicers-dialog"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Beaker size={16} className="text-purple-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide uppercase">My Custom Slicers</h2>
          </div>
          <button onClick={onClose} data-testid="custom-slicers-close-btn" className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Explainer */}
          <div className="text-[11px] text-slate-400 leading-relaxed bg-slate-950 border border-slate-800 rounded p-2.5">
            Add slicers ForgeSlicer doesn't know about — Bambu Studio
            forks, modified OrcaSlicer builds (e.g. full-spectrum colour),
            in-house company builds. We download a <span className="font-mono">.3mf</span> and try to launch
            the slicer via its URL protocol; the slicer must be installed
            on this device and registered as the protocol handler.
          </div>

          {/* Existing entries */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Your slicers ({list.length})
            </div>
            {list.length === 0 && (
              <div className="text-[11px] text-slate-500 italic px-1 py-2">
                No custom slicers yet. Add one below.
              </div>
            )}
            {list.map((s) => (
              <div
                key={s.id}
                data-testid={`custom-slicer-row-${s.id}`}
                className="bg-slate-950 border border-slate-700 rounded p-2 flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-100 truncate">{s.name}</div>
                  <div className="text-[10px] font-mono text-slate-400 truncate">{s.protocol}</div>
                  {s.installUrl && (
                    <a
                      href={s.installUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-purple-300 hover:text-purple-200 underline"
                    >
                      {s.installUrl}
                    </a>
                  )}
                </div>
                <button
                  data-testid={`custom-slicer-test-${s.id}`}
                  onClick={() => handleTestProtocol(s.protocol, s.name)}
                  className="h-7 px-2 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                  title="Try launching to confirm the protocol works"
                >
                  Test
                </button>
                <button
                  data-testid={`custom-slicer-remove-${s.id}`}
                  onClick={() => handleRemove(s.id, s.name)}
                  className="h-7 w-7 bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-200 rounded border border-slate-700 flex items-center justify-center"
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Add-new form */}
          <form onSubmit={handleAdd} className="space-y-2 border-t border-slate-800 pt-3" data-testid="custom-slicer-add-form">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              Add a slicer
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-slate-500">Display name</span>
                <input
                  data-testid="custom-slicer-name-input"
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Bambu Studio Open"
                  className="w-full h-8 bg-slate-950 border border-slate-700 rounded px-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
                  required
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-slate-500">URL protocol</span>
                <input
                  data-testid="custom-slicer-protocol-input"
                  type="text"
                  value={draft.protocol}
                  onChange={(e) => setDraft({ ...draft, protocol: e.target.value })}
                  placeholder="myslicer://"
                  className="w-full h-8 bg-slate-950 border border-slate-700 rounded px-2 font-mono text-sm text-slate-100 focus:outline-none focus:border-purple-500"
                  required
                />
              </label>
            </div>
            <label className="space-y-1 block">
              <span className="text-[10px] text-slate-500">Install URL (optional)</span>
              <input
                data-testid="custom-slicer-install-url-input"
                type="url"
                value={draft.installUrl}
                onChange={(e) => setDraft({ ...draft, installUrl: e.target.value })}
                placeholder="https://example.com/download"
                className="w-full h-8 bg-slate-950 border border-slate-700 rounded px-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
              />
            </label>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2 text-[10px] text-blue-200 leading-tight flex items-start gap-2">
              <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
              <span>
                <b>How to find the protocol:</b> Most slicers register one on install
                (e.g. <span className="font-mono">orcaslicer://</span>, <span className="font-mono">prusaslicer://</span>).
                On Windows, check <span className="font-mono">HKCR\Software\Classes\</span>;
                on macOS, the Info.plist's <span className="font-mono">CFBundleURLSchemes</span> entry;
                on Linux, the .desktop file's <span className="font-mono">x-scheme-handler/</span> MIME.
              </span>
            </div>
            <button
              type="submit"
              data-testid="custom-slicer-add-btn"
              disabled={submitting || !draft.name || !draft.protocol}
              className="w-full h-9 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded flex items-center justify-center gap-2"
            >
              <Plus size={14} /> Add slicer
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

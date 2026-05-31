// UserPrintersDialog — manage the per-user catalogue of custom printers
// that ForgeSlicer feeds straight to OrcaSlicer at slice time. Lets a
// signed-in user register printers OrcaSlicer's bundled preset library
// doesn't ship yet (Sovol SV06 Plus Ace, brand-new 2026 models, custom
// Klipper builds, etc.) and have them appear in the slicer dropdown
// indefinitely.
//
// Two modes, toggled by `editing` state:
//   1. List view — table of saved printers + "+ New printer" CTA.
//   2. Form view — a single editor (Name / build-vol / nozzle /
//      gcode-flavor / speeds / retraction / start+end gcode). Same
//      form is used to create AND edit; populated from the row when
//      editing, empty defaults when creating.
//
// Backend is /api/me/printers/* (auth required). When the user isn't
// signed in we show a polite "sign in to register a printer" stub
// rather than the form — feature gate matches the other /api/me/*
// flows (Save Design, Save Component, etc.).

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { userPrintersApi, apiErrorMessage } from "../../lib/api";

const GCODE_FLAVORS = [
  { id: "marlin2",  label: "Marlin 2.x" },
  { id: "marlin",   label: "Marlin (legacy)" },
  { id: "klipper",  label: "Klipper" },
  { id: "reprap",   label: "RepRap" },
  { id: "smoothie", label: "Smoothie" },
];

function emptyDraft() {
  return {
    name: "",
    printer_model: "",
    nozzle_diameter: 0.4,
    build_x_mm: 250,
    build_y_mm: 250,
    build_z_mm: 250,
    gcode_flavor: "marlin2",
    max_speed_x: 250,
    max_speed_y: 250,
    max_speed_z: 12,
    max_speed_e: 40,
    retraction_length: 0.8,
    retraction_speed: 40,
    start_gcode: "",
    end_gcode: "",
    notes: "",
  };
}

export default function UserPrintersDialog({ open, onClose, onChanged }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);   // { id?, draft } or null
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    userPrintersApi.list()
      .then((items) => setList(items || []))
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [open]);

  const startCreate = () => setEditing({ id: null, draft: emptyDraft() });
  const startEdit = (row) => setEditing({ id: row.printer_id, draft: { ...row } });

  const save = async () => {
    if (!editing) return;
    const { id, draft } = editing;
    if (!draft.name?.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...draft, name: draft.name.trim() };
      const saved = id
        ? await userPrintersApi.update(id, payload)
        : await userPrintersApi.create(payload);
      // Refresh
      const next = await userPrintersApi.list();
      setList(next || []);
      setEditing(null);
      if (onChanged) onChanged(saved);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    setError(null);
    try {
      await userPrintersApi.remove(row.printer_id);
      const next = await userPrintersApi.list();
      setList(next || []);
      if (onChanged) onChanged(null);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="user-printers-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="user-printers-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-800">
          <h2 id="user-printers-title" className="text-base font-bold text-slate-100">
            My Printers
          </h2>
          <button
            data-testid="user-printers-close"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-100 p-1"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div
              data-testid="user-printers-error"
              className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/50 rounded p-2 text-xs text-rose-200"
            >
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!editing ? (
            <>
              <p className="text-xs text-slate-400 leading-relaxed">
                Register a printer once and it appears in the slicer&apos;s
                Printer dropdown — useful for 2026-era hardware OrcaSlicer
                hasn&apos;t bundled a preset for yet.
              </p>
              <div className="flex justify-end">
                <button
                  data-testid="user-printers-new-btn"
                  onClick={startCreate}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-amber-500 text-slate-950 rounded hover:bg-amber-400 transition-colors"
                >
                  <Plus size={12} /> New printer
                </button>
              </div>

              {loading && <div className="text-xs text-slate-400">Loading…</div>}

              {!loading && list.length === 0 && (
                <div
                  data-testid="user-printers-empty"
                  className="text-xs text-slate-400 italic py-6 text-center border border-dashed border-slate-700 rounded"
                >
                  No custom printers yet. Click &ldquo;New printer&rdquo; to register one.
                </div>
              )}

              {list.map((row) => (
                <div
                  key={row.printer_id}
                  data-testid={`user-printer-row-${row.printer_id}`}
                  className="flex items-center gap-3 bg-slate-950 border border-slate-700 rounded p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">{row.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      {row.build_x_mm}×{row.build_y_mm}×{row.build_z_mm} mm · {row.nozzle_diameter} mm nozzle · {row.gcode_flavor}
                    </div>
                  </div>
                  <button
                    data-testid={`user-printer-edit-${row.printer_id}`}
                    onClick={() => startEdit(row)}
                    className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors"
                    aria-label="Edit"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    data-testid={`user-printer-delete-${row.printer_id}`}
                    onClick={() => removeRow(row)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                    aria-label="Delete"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </>
          ) : (
            <PrinterForm
              draft={editing.draft}
              onChange={(d) => setEditing({ ...editing, draft: d })}
            />
          )}
        </div>

        {editing && (
          <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-800">
            <button
              data-testid="user-printers-cancel-edit"
              onClick={() => { setEditing(null); setError(null); }}
              className="px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100"
            >
              Cancel
            </button>
            <button
              data-testid="user-printers-save"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-amber-500 text-slate-950 rounded hover:bg-amber-400 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 size={12} /> {saving ? "Saving…" : "Save"}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, min, max, step = 1, suffix }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-slate-400">{label}</span>
      <div className="flex items-center gap-1 h-8 bg-slate-950 border border-slate-700 rounded px-2 focus-within:border-amber-500">
        <input
          type="number"
          min={min} max={max} step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="flex-1 min-w-0 bg-transparent text-xs text-white outline-none"
        />
        {suffix && <span className="text-[10px] text-slate-500">{suffix}</span>}
      </div>
    </label>
  );
}

function PrinterForm({ draft, onChange }) {
  const set = (k, v) => onChange({ ...draft, [k]: v });
  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-400">Name *</span>
        <input
          data-testid="user-printer-form-name"
          type="text"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Sovol SV06 Plus Ace"
          className="h-8 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white outline-none focus:border-amber-500"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-400">Printer model (optional)</span>
        <input
          type="text"
          value={draft.printer_model || ""}
          onChange={(e) => set("printer_model", e.target.value)}
          placeholder="Sovol SV06 Plus Ace"
          className="h-8 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white outline-none focus:border-amber-500"
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <NumField label="Build X" value={draft.build_x_mm} onChange={(v) => set("build_x_mm", v)} min={10} max={1000} suffix="mm" />
        <NumField label="Build Y" value={draft.build_y_mm} onChange={(v) => set("build_y_mm", v)} min={10} max={1000} suffix="mm" />
        <NumField label="Build Z" value={draft.build_z_mm} onChange={(v) => set("build_z_mm", v)} min={10} max={1000} suffix="mm" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="Nozzle Ø" value={draft.nozzle_diameter} onChange={(v) => set("nozzle_diameter", v)} min={0.1} max={2.0} step={0.1} suffix="mm" />
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-slate-400">G-code flavour</span>
          <select
            data-testid="user-printer-form-flavor"
            value={draft.gcode_flavor}
            onChange={(e) => set("gcode_flavor", e.target.value)}
            className="h-8 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white outline-none focus:border-amber-500"
          >
            {GCODE_FLAVORS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
      </div>

      <details className="border border-slate-700 rounded">
        <summary className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-slate-200">
          Advanced — Max speeds & retraction
        </summary>
        <div className="p-2 pt-3 grid grid-cols-4 gap-2">
          <NumField label="Max X" value={draft.max_speed_x} onChange={(v) => set("max_speed_x", v)} min={1} max={2000} suffix="mm/s" />
          <NumField label="Max Y" value={draft.max_speed_y} onChange={(v) => set("max_speed_y", v)} min={1} max={2000} suffix="mm/s" />
          <NumField label="Max Z" value={draft.max_speed_z} onChange={(v) => set("max_speed_z", v)} min={1} max={500} suffix="mm/s" />
          <NumField label="Max E" value={draft.max_speed_e} onChange={(v) => set("max_speed_e", v)} min={1} max={500} suffix="mm/s" />
          <NumField label="Retract" value={draft.retraction_length} onChange={(v) => set("retraction_length", v)} min={0} max={20} step={0.1} suffix="mm" />
          <NumField label="Retract spd" value={draft.retraction_speed} onChange={(v) => set("retraction_speed", v)} min={1} max={200} suffix="mm/s" />
        </div>
      </details>

      <details className="border border-slate-700 rounded">
        <summary className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 cursor-pointer hover:text-slate-200">
          Advanced — Start / End G-code
        </summary>
        <div className="p-2 pt-3 space-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-400">Start G-code</span>
            <textarea
              rows={4}
              value={draft.start_gcode || ""}
              onChange={(e) => set("start_gcode", e.target.value)}
              placeholder="G28 ; home all axes&#10;G1 Z2 F2400"
              className="bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white font-mono outline-none focus:border-amber-500"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-wider text-slate-400">End G-code</span>
            <textarea
              rows={3}
              value={draft.end_gcode || ""}
              onChange={(e) => set("end_gcode", e.target.value)}
              placeholder="M104 S0&#10;M140 S0&#10;G28 X0"
              className="bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white font-mono outline-none focus:border-amber-500"
            />
          </label>
        </div>
      </details>

      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-400">Notes</span>
        <textarea
          rows={2}
          value={draft.notes || ""}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Anything you want to remember about this printer"
          className="bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white outline-none focus:border-amber-500"
        />
      </label>
    </div>
  );
}

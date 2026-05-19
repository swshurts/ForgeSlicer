import React, { useState } from "react";
import { useScene } from "../../lib/store";
import { printersApi } from "../../lib/api";
import { X, CheckCircle2, Loader2, Factory } from "lucide-react";

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

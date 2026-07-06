import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Beaker, X, Search, Trash2, Plus, Lightbulb } from "lucide-react";
import { Input } from "../../ui/input";
import {
  searchManufacturerByHex,
  getManufacturerBrands,
  listPrivateFilaments,
  addPrivateFilament,
  deletePrivateFilament,
  suggestFilament,
} from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * Filament library + closest-match dialog.
 *
 * Opens from the palette `+` button (mode=add) or each swatch's edit
 * tools (mode=replace, with `swatchIdx`). The user types a target hex
 * or uses the color picker; the backend returns the closest
 * manufacturer SKUs ranked by ΔE76 or ΔE2000. Click a row → it's
 * dropped into the palette with the SKU's hex + TD.
 *
 * Side panels: "My library" (auth users add/remove personal SKUs)
 * and "Suggest a brand" (any user can submit a new SKU for review).
 */
const TAB_SEARCH = "search";
const TAB_MINE = "mine";
const TAB_SUGGEST = "suggest";

const FINISHES = ["gloss", "matte", "silk", "transparent"];
const MATERIALS = ["PLA", "PETG"];

export const FilamentLibraryDialog = ({
  open,
  onClose,
  onPick,         // (libFil) => void
  initialHex = "#ff7a00",
}) => {
  const { user } = useAuth();
  const [tab, setTab] = useState(TAB_SEARCH);
  const [hex, setHex] = useState(initialHex);
  const [algo, setAlgo] = useState("de76");
  const [brandFilter, setBrandFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [brands, setBrands] = useState([]);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Private library state
  const [mine, setMine] = useState([]);
  const [newFil, setNewFil] = useState({
    brand: "", name: "", hex: "#888888", td: 1.5, finish: "gloss", material: "PLA",
  });
  // Suggestion state
  const [suggestion, setSuggestion] = useState({
    brand: "", name: "", hex: "#888888", td: 1.5,
    finish: "gloss", material: "PLA", submitter_email: "", notes: "",
  });
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHex(initialHex);
    setTab(TAB_SEARCH);
    getManufacturerBrands().then(setBrands).catch(() => setBrands([]));
    if (user) listPrivateFilaments().then(setMine).catch(() => setMine([]));
  }, [open, initialHex, user]);

  // Debounced live search whenever hex / algo / brandFilter changes
  useEffect(() => {
    if (!open) return;
    const validHex = /^#?[0-9A-Fa-f]{6}$/.test(hex.replace("#", ""));
    if (!validHex) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const body = await searchManufacturerByHex(hex, {
          algo, limit: 15,
          brand: brandFilter || undefined,
          material: materialFilter || undefined,
          includePrivate: !!user,
        });
        setResults(body.results);
      } catch (e) {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [hex, algo, brandFilter, materialFilter, open, user]);

  const reloadMine = async () => {
    try { setMine(await listPrivateFilaments()); } catch { /* noop */ }
  };

  const submitAddPrivate = async (e) => {
    e?.preventDefault?.();
    if (!newFil.brand.trim() || !newFil.name.trim()) {
      toast.error("Brand and name are required");
      return;
    }
    try {
      await addPrivateFilament({
        ...newFil,
        td: parseFloat(newFil.td) || 1.5,
      });
      toast.success("Saved to your private library");
      setNewFil({ brand: "", name: "", hex: "#888888", td: 1.5, finish: "gloss", material: "PLA" });
      reloadMine();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save filament");
    }
  };

  const removePrivate = async (id) => {
    try {
      await deletePrivateFilament(id);
      reloadMine();
    } catch {
      toast.error("Could not delete filament");
    }
  };

  const submitSuggestion = async (e) => {
    e?.preventDefault?.();
    if (!suggestion.brand.trim() || !suggestion.name.trim()) {
      toast.error("Brand and name are required");
      return;
    }
    setSubmittingSuggestion(true);
    try {
      await suggestFilament({
        ...suggestion,
        td: parseFloat(suggestion.td) || 1.5,
      });
      toast.success("Thanks! Suggestion sent for review.");
      setSuggestion({
        brand: "", name: "", hex: "#888888", td: 1.5,
        finish: "gloss", material: "PLA", submitter_email: "", notes: "",
      });
    } catch (e) {
      toast.error("Could not submit suggestion");
    } finally {
      setSubmittingSuggestion(false);
    }
  };

  const tabs = useMemo(() => {
    const t = [
      { id: TAB_SEARCH, label: "Find by color" },
    ];
    if (user) t.push({ id: TAB_MINE, label: "My library" });
    t.push({ id: TAB_SUGGEST, label: "Suggest" });
    return t;
  }, [user]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-5"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="filament-library-dialog"
    >
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-100">
            <Beaker className="w-3 h-3" />
            Filament library
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid="library-close"
            className="w-7 h-7 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-zinc-800">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={`library-tab-${t.id}`}
              className={`flex-1 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors duration-150 ${
                tab === t.id
                  ? "text-zinc-100 border-b-2 border-zinc-100 -mb-px"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* SEARCH TAB ---------------------------------------------------- */}
        {tab === TAB_SEARCH && (
          <div className="p-5 space-y-4">
            {/* Target color input */}
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                className="w-12 h-10 bg-transparent border border-zinc-800 cursor-pointer p-0"
                data-testid="library-hex-picker"
              />
              <Input
                value={hex.toUpperCase()}
                onChange={(e) => setHex(e.target.value)}
                placeholder="#FF7A00"
                maxLength={7}
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-sm flex-1 uppercase tracking-wider"
                data-testid="library-hex-input"
              />
              <div className="inline-flex border border-zinc-800 font-mono text-[10px]">
                {["de76", "de2000"].map((a) => (
                  <button
                    key={a}
                    onClick={() => setAlgo(a)}
                    data-testid={`library-algo-${a}`}
                    className={`px-2.5 py-1.5 uppercase tracking-wider transition-colors ${
                      algo === a
                        ? "bg-zinc-100 text-zinc-950"
                        : "text-zinc-400 hover:text-zinc-100"
                    }`}
                  >
                    Δ{a.replace("de", "E")}
                  </button>
                ))}
              </div>
            </div>

            {/* Material chips */}
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600 mr-1">
                Material
              </span>
              <button
                onClick={() => setMaterialFilter("")}
                data-testid="library-material-all"
                className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] border transition-colors ${
                  materialFilter === ""
                    ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                    : "border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600"
                }`}
              >
                All
              </button>
              {MATERIALS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMaterialFilter(materialFilter === m ? "" : m)}
                  data-testid={`library-material-${m.toLowerCase()}`}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] border transition-colors ${
                    materialFilter === m
                      ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                      : "border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Brand chips */}
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              <button
                onClick={() => setBrandFilter("")}
                data-testid="library-brand-all"
                className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] border transition-colors ${
                  brandFilter === ""
                    ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                    : "border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600"
                }`}
              >
                All
              </button>
              {brands.map((b) => (
                <button
                  key={b}
                  onClick={() => setBrandFilter(brandFilter === b ? "" : b)}
                  data-testid={`library-brand-${b.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] border transition-colors ${
                    brandFilter === b
                      ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                      : "border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>

            {/* Result list */}
            <div className="space-y-1.5" data-testid="library-results">
              {searching && (
                <div className="font-mono text-[10px] text-zinc-600 py-4 text-center">
                  Searching…
                </div>
              )}
              {!searching && results.length === 0 && (
                <div className="font-mono text-[10px] text-zinc-600 py-4 text-center">
                  Type a valid hex (e.g. #FF7A00) to see closest matches.
                </div>
              )}
              {!searching && results.map((r, i) => (
                <button
                  key={`${r.id || r.name}-${i}`}
                  onClick={() => {
                    onPick({ name: `${r.brand} · ${r.name}`, hex: r.hex, td: r.td });
                    onClose();
                  }}
                  data-testid={`library-result-${i}`}
                  className="w-full flex items-center gap-3 border border-zinc-800 hover:border-zinc-500 hover:bg-zinc-900/60 px-3 py-2 text-left transition-colors duration-100 group"
                >
                  <div
                    className="w-10 h-10 flex-shrink-0 border border-zinc-700"
                    style={{ background: r.hex }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[11px] text-zinc-100 truncate flex items-center gap-1.5">
                      <span className="text-zinc-400">{r.brand}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{r.name}</span>
                      {r.source === "private" && (
                        <span
                          className="ml-1 px-1 py-px font-mono text-[8px] uppercase tracking-[0.12em] bg-zinc-800 text-zinc-300 border border-zinc-700"
                        >
                          MINE
                        </span>
                      )}
                      {r.material === "PETG" && (
                        <span className="ml-1 px-1 py-px font-mono text-[8px] uppercase tracking-[0.12em] bg-sky-950 text-sky-300 border border-sky-800">
                          PETG
                        </span>
                      )}
                      {r.finish && r.finish !== "gloss" && (
                        <span className="ml-1 px-1 py-px font-mono text-[8px] uppercase tracking-[0.12em] border border-zinc-700 text-zinc-400">
                          {r.finish}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[9px] text-zinc-500 tabular-nums">
                      {r.hex} · TD {r.td.toFixed(1)}mm
                    </div>
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-right">
                    <div className={`${r.delta_e <= 5 ? "text-emerald-300" : r.delta_e <= 12 ? "text-yellow-300" : "text-orange-400"}`}>
                      ΔE {r.delta_e.toFixed(1)}
                    </div>
                    <div className="text-zinc-600 text-[9px] uppercase tracking-wider mt-0.5 group-hover:text-zinc-200">
                      Add →
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* MINE TAB ------------------------------------------------------ */}
        {tab === TAB_MINE && (
          <div className="p-5 space-y-4">
            {!user ? (
              <div className="font-mono text-[10px] text-zinc-500">
                Sign in to keep a personal filament library that mixes
                into the search results automatically.
              </div>
            ) : (
              <>
                <form
                  className="border border-zinc-800 p-3 space-y-2"
                  onSubmit={submitAddPrivate}
                  data-testid="library-mine-form"
                >
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 flex items-center gap-1.5">
                    <Plus className="w-3 h-3" /> Add a filament you own
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={newFil.brand}
                      onChange={(e) => setNewFil({ ...newFil, brand: e.target.value })}
                      placeholder="Brand (e.g. Atomic)"
                      maxLength={80}
                      className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8"
                      data-testid="mine-brand-input"
                    />
                    <Input
                      value={newFil.name}
                      onChange={(e) => setNewFil({ ...newFil, name: e.target.value })}
                      placeholder="Name (e.g. Cobalt Blue)"
                      maxLength={120}
                      className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8"
                      data-testid="mine-name-input"
                    />
                  </div>
                  <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2">
                    <input
                      type="color"
                      value={newFil.hex}
                      onChange={(e) => setNewFil({ ...newFil, hex: e.target.value })}
                      className="w-8 h-8 bg-transparent border border-zinc-800 cursor-pointer p-0"
                      data-testid="mine-hex-picker"
                    />
                    <Input
                      value={newFil.hex.toUpperCase()}
                      onChange={(e) => setNewFil({ ...newFil, hex: e.target.value })}
                      maxLength={7}
                      className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8 uppercase"
                      data-testid="mine-hex-input"
                    />
                    <Input
                      type="number"
                      step="0.1"
                      min="0.2"
                      max="10"
                      value={newFil.td}
                      onChange={(e) => setNewFil({ ...newFil, td: e.target.value })}
                      className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8 w-20"
                      placeholder="TD"
                      data-testid="mine-td-input"
                    />
                    <select
                      value={newFil.finish}
                      onChange={(e) => setNewFil({ ...newFil, finish: e.target.value })}
                      className="bg-zinc-950 border border-zinc-800 font-mono text-xs h-8 px-2"
                      data-testid="mine-finish-select"
                    >
                      {FINISHES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <select
                      value={newFil.material}
                      onChange={(e) => setNewFil({ ...newFil, material: e.target.value })}
                      className="bg-zinc-950 border border-zinc-800 font-mono text-xs h-8 px-2"
                      data-testid="mine-material-select"
                    >
                      {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <button
                    type="submit"
                    data-testid="mine-add-btn"
                    className="w-full bg-zinc-100 text-zinc-950 text-[10px] font-bold uppercase tracking-[0.18em] py-2 hover:bg-white"
                  >
                    Save
                  </button>
                </form>

                <div className="space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    Saved ({mine.length})
                  </div>
                  {mine.length === 0 && (
                    <div className="font-mono text-[10px] text-zinc-600 py-2">
                      Nothing here yet. Anything you add will appear inside
                      the "Find by color" results, marked <span className="px-1 bg-zinc-800 text-zinc-300 border border-zinc-700">MINE</span>.
                    </div>
                  )}
                  {mine.map((f) => (
                    <div
                      key={f.id}
                      data-testid={`mine-row-${f.id}`}
                      className="flex items-center gap-2 border border-zinc-800 px-2 py-1.5"
                    >
                      <div
                        className="w-7 h-7 border border-zinc-700 flex-shrink-0"
                        style={{ background: f.hex }}
                      />
                      <div className="flex-1 min-w-0 font-mono text-[10px]">
                        <div className="text-zinc-100 truncate">
                          {f.brand} · {f.name}
                        </div>
                        <div className="text-zinc-600 tabular-nums">
                          {f.hex} · TD {f.td.toFixed(1)} · {f.finish}
                        </div>
                      </div>
                      <button
                        onClick={() => removePrivate(f.id)}
                        aria-label={`Delete ${f.name}`}
                        data-testid={`mine-delete-${f.id}`}
                        className="w-7 h-7 flex items-center justify-center border border-zinc-800 text-zinc-500 hover:text-red-300 hover:border-red-700/50 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* SUGGEST TAB --------------------------------------------------- */}
        {tab === TAB_SUGGEST && (
          <form className="p-5 space-y-3" onSubmit={submitSuggestion} data-testid="library-suggest-form">
            <div className="font-mono text-[10px] text-zinc-500 flex items-center gap-1.5">
              <Lightbulb className="w-3 h-3" />
              Don't see your favorite filament? Suggest it for review.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={suggestion.brand}
                onChange={(e) => setSuggestion({ ...suggestion, brand: e.target.value })}
                placeholder="Brand"
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8"
                data-testid="suggest-brand-input"
              />
              <Input
                value={suggestion.name}
                onChange={(e) => setSuggestion({ ...suggestion, name: e.target.value })}
                placeholder="SKU name"
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8"
                data-testid="suggest-name-input"
              />
            </div>
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2">
              <input
                type="color"
                value={suggestion.hex}
                onChange={(e) => setSuggestion({ ...suggestion, hex: e.target.value })}
                className="w-8 h-8 bg-transparent border border-zinc-800 cursor-pointer p-0"
              />
              <Input
                value={suggestion.hex.toUpperCase()}
                onChange={(e) => setSuggestion({ ...suggestion, hex: e.target.value })}
                maxLength={7}
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8 uppercase"
              />
              <Input
                type="number"
                step="0.1"
                min="0.2"
                max="10"
                value={suggestion.td}
                onChange={(e) => setSuggestion({ ...suggestion, td: e.target.value })}
                className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8 w-20"
                placeholder="TD"
              />
              <select
                value={suggestion.finish}
                onChange={(e) => setSuggestion({ ...suggestion, finish: e.target.value })}
                className="bg-zinc-950 border border-zinc-800 font-mono text-xs h-8 px-2"
              >
                {FINISHES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select
                value={suggestion.material}
                onChange={(e) => setSuggestion({ ...suggestion, material: e.target.value })}
                className="bg-zinc-950 border border-zinc-800 font-mono text-xs h-8 px-2"
                data-testid="suggest-material-select"
              >
                {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <Input
              type="email"
              value={suggestion.submitter_email}
              onChange={(e) => setSuggestion({ ...suggestion, submitter_email: e.target.value })}
              placeholder="Your email (optional, for follow-up)"
              className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-8"
              data-testid="suggest-email-input"
            />
            <textarea
              value={suggestion.notes}
              onChange={(e) => setSuggestion({ ...suggestion, notes: e.target.value })}
              placeholder="Notes (where you bought it, lighting conditions you sampled the hex from, etc.)"
              rows={3}
              maxLength={2000}
              className="w-full bg-zinc-950 border border-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
              data-testid="suggest-notes-input"
            />
            <button
              type="submit"
              disabled={submittingSuggestion}
              data-testid="suggest-submit"
              className="w-full bg-zinc-100 text-zinc-950 text-[10px] font-bold uppercase tracking-[0.18em] py-2 hover:bg-white disabled:opacity-40"
            >
              <Search className="w-3 h-3 inline mr-1" />
              {submittingSuggestion ? "Sending…" : "Submit suggestion"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

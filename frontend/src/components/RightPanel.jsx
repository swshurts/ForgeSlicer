import React, { useState, useMemo, useEffect } from "react";
import { useScene, PRINTERS, FILAMENTS } from "../lib/store";
import { useSliceSettings } from "../lib/store";
import { getPrinter, getFilament } from "../lib/presets";
import { MULTICOLOR_PALETTE } from "../lib/presets";
import { evaluateSceneStatsAsync } from "../lib/workerClient";
import { computeRotatedBBox } from "../lib/geometry";
import { printersApi } from "../lib/api";
import SplineInspectorBlock from "./SplineInspectorBlock";
import SweepInspectorBlock from "./SweepInspectorBlock";
import TextInspectorBlock from "./inspector/TextInspectorBlock";
// Iter-105.20 — EdgeControls (fillet/chamfer UI) removed from Inspector
// at user request. The component file at `./inspector/EdgeControls.jsx`
// is preserved for future use should the slicer pipeline ever honour
// per-edge geometry in the modifier-mesh carve.
import AutoSaveSection from "./inspector/AutoSaveSection";
import MeshImportTools from "./inspector/MeshImportTools";
import { Shape2DControls } from "./inspector/Shape2DControls";
import { recentPrinters, upvotedPrinters } from "../lib/persist";
import { Printer, Sliders, Sigma, AlertTriangle, Factory, Upload, Trash2, ArrowDownToLine, ShieldAlert, Star, BadgeCheck, History, Layers, Plus, Minus, ChevronDown, Check, Loader2, Eye, Send } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import * as edgeFaceMeta from "../lib/edgeFaceMeta";
import * as THREE from "three";
import { toast } from "sonner";
import { repairImportedObject } from "../lib/meshRepairApi";

// iter-100.8 — Alphabetical, accordion-grouped printer picker. Replaces
// the native <select>+<optgroup> with a Popover-driven UI so each brand
// can be expanded/collapsed independently via +/- icons. Brands sort
// A→Z by default, EXCEPT:
//   • "Custom" — always pinned at the very top (it's the user's
//     "I'll paste my own JSON" escape hatch).
//   • "Community" — always pinned at the very bottom (community
//     submissions are best-effort and shouldn't out-rank vetted
//     built-ins like Bambu/Prusa).
// Open state per brand is held LOCALLY on the picker. The brand of the
// currently-selected printer is auto-expanded on every open so users
// see their choice in context without having to click.
function PrinterPicker({ groups, value, onChange, currentLabel, testid = "printer-select" }) {
  const [open, setOpen] = useState(false);
  // Which brands are expanded inside the popover. Default: only the
  // brand of the active printer. Reset every time the popover opens
  // so users don't carry stale "all expanded" state across uses.
  const initialExpanded = () => {
    for (const [brand, items] of Object.entries(groups)) {
      if (items.some((p) => p.id === value)) return { [brand]: true };
    }
    return {};
  };
  const [expanded, setExpanded] = useState(initialExpanded);
  // Re-seed expanded whenever the popover transitions closed→open.
  useEffect(() => { if (open) setExpanded(initialExpanded()); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Brands sorted with Custom-first / Community-last pinning.
  const sortedBrands = useMemo(() => {
    const all = Object.keys(groups);
    const head = all.includes("Custom") ? ["Custom"] : [];
    const tail = all.includes("Community") ? ["Community"] : [];
    const mid = all
      .filter((b) => b !== "Custom" && b !== "Community")
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return [...head, ...mid, ...tail];
  }, [groups]);

  const toggle = (brand) => setExpanded((s) => ({ ...s, [brand]: !s[brand] }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid={testid}
          type="button"
          className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 flex items-center justify-between gap-2 focus:border-orange-500 outline-none hover:border-slate-600"
        >
          <span className="truncate text-left">{currentLabel || "Choose a printer…"}</span>
          <ChevronDown size={14} className="text-slate-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] max-h-[420px] overflow-y-auto p-1 bg-slate-950 border-slate-700"
        data-testid="printer-select-popover"
      >
        {sortedBrands.map((brand) => {
          const items = groups[brand];
          const isOpen = !!expanded[brand];
          const hasSelected = items.some((p) => p.id === value);
          return (
            <div key={brand} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggle(brand)}
                data-testid={`printer-brand-${brand.replace(/\s+/g, "-").toLowerCase()}`}
                className={`w-full flex items-center gap-1.5 px-2 py-1 text-[11px] uppercase tracking-wider rounded hover:bg-slate-800 ${hasSelected ? "text-orange-400" : "text-slate-300"}`}
              >
                {isOpen
                  ? <Minus size={11} className="text-slate-400 shrink-0" />
                  : <Plus size={11} className="text-slate-400 shrink-0" />}
                <span className="font-semibold tracking-wider">{brand}</span>
                <span className="ml-auto text-[10px] text-slate-500 normal-case tracking-normal">
                  {items.length}
                </span>
              </button>
              {isOpen && (
                <div className="pl-5 pr-1 py-0.5 flex flex-col gap-0.5">
                  {items.map((p) => {
                    const selected = p.id === value;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        data-testid={`printer-option-${p.id}`}
                        onClick={() => { onChange(p.id); setOpen(false); }}
                        className={`flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-slate-800 ${selected ? "bg-orange-500/10 text-orange-300" : "text-slate-200"}`}
                      >
                        {selected
                          ? <Check size={11} className="text-orange-400 shrink-0" />
                          : <span className="w-[11px] shrink-0" />}
                        <span className="truncate text-left">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// iter-112 — NumberField gains an optional `inUnit` prop. When set to
// "length" it reads/writes mm via the store internally but
// displays + parses against the user's selected unit system (mm or
// inches). All non-length fields (segments, rotation degrees,
// twist counts, etc.) pass no `inUnit` and stay raw numbers.
function NumberField({ label, hint, value, onChange, step = 1, min, max, testid, suffix, inUnit }) {
  const unitSystem = useScene((s) => s.unitSystem);
  const isLength = inUnit === "length";
  const displayValue = isLength ? (Number.isFinite(value) ? value / (unitSystem === "in" ? 25.4 : 1) : 0) : value;
  // For inches we relax the step so the user can dial in 0.001"
  // (~0.025 mm) precision — finer than the printer can resolve, but
  // expected by US workshops. mm step stays at the caller's default.
  const effectiveStep = isLength && unitSystem === "in" ? Math.max(0.001, step / 25.4) : step;
  const effectiveMin  = isLength && unitSystem === "in" && Number.isFinite(min) ? min / 25.4 : min;
  const effectiveMax  = isLength && unitSystem === "in" && Number.isFinite(max) ? max / 25.4 : max;
  const effectiveSuffix = isLength ? (suffix || unitSystem) : suffix;
  const handleChange = (e) => {
    const n = parseFloat(e.target.value || "0");
    if (!isLength) { onChange(n); return; }
    onChange(unitSystem === "in" ? n * 25.4 : n);
  };
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-[10px] uppercase tracking-wider text-slate-400 font-medium"
        title={hint ? `${label} — ${hint}` : undefined}
      >
        {label}
        {hint && <span className="ml-1 normal-case text-[9px] text-slate-500 tracking-normal">({hint})</span>}
      </span>
      <div className="relative flex items-center">
        <input
          data-testid={testid}
          type="number"
          step={effectiveStep}
          min={effectiveMin}
          max={effectiveMax}
          value={Number.isFinite(displayValue) ? displayValue : 0}
          onChange={handleChange}
          className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 pr-7 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none font-mono"
        />
        {effectiveSuffix && <span className="absolute right-2 text-[10px] text-slate-500 font-mono">{effectiveSuffix}</span>}
      </div>
    </label>
  );
}

function Section({ title, icon: Icon, children, testid, accent = "text-slate-500" }) {
  return (
    <div className="border-b border-slate-800" data-testid={testid}>
      <div className="px-3 py-2 flex items-center gap-2 bg-slate-900/40">
        {Icon && <Icon size={12} className={accent} />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</span>
      </div>
      <div className="p-3 flex flex-col gap-3">{children}</div>
    </div>
  );
}

// iter-111 — Tolerance helper.
//
// A common beginner mistake: design a 3 mm peg + 3 mm hole and wonder
// why the print won't fit together. Every printer has nozzle drag,
// shrinkage, and ringing that adds ~0.1-0.3 mm of slop. The "right"
// hole isn't the nominal dimension — it's the nominal + a clearance
// allowance picked from a named fit class.
//
// This widget surfaces those named fits as a dropdown for any selected
// NEGATIVE cylinder / cone (the bore in a press-fit / running-fit
// assembly). Clicking a fit nudges `dims.r` by HALF the named clearance
// (because radius doubles into diameter) so the resulting bore matches
// the named-fit table. Same logic as the inspector's other numeric
// nudges — wraps `updateDims` so it joins the existing undo stack.
const TOLERANCE_PRESETS = [
  { id: "press",   label: "Press fit",    delta: -0.05, blurb: "Interference fit — needs a hammer / arbor press. For permanent pins, knurled inserts." },
  { id: "tight",   label: "Tight fit",    delta:  0.05, blurb: "Hand-press fit — won't slip, won't rotate. Good for dowel pins, locating pegs." },
  { id: "slip",    label: "Slip fit",     delta:  0.1,  blurb: "Slides by hand, won't rattle. Good for removable pegs, bolt-through holes." },
  { id: "running", label: "Running fit",  delta:  0.2,  blurb: "Free-running — for rotating shafts, sliding rods, hinge pins." },
  { id: "loose",   label: "Loose clear.", delta:  0.4,  blurb: "Lots of slop — for cable pass-throughs, sloppy alignment, paint clearance." },
];

function ToleranceHelper({ obj, updateDims }) {
  const baseR = (obj.dims && obj.dims.r) ?? 0;
  const applyFit = (preset) => {
    const newR = Math.max(0.05, baseR + preset.delta / 2);
    updateDims(obj.id, { r: newR });
  };
  return (
    <div
      data-testid="tolerance-helper"
      className="border border-cyan-500/30 bg-cyan-500/5 rounded-md p-2 space-y-1.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">
          Tolerance · clearance fit
        </span>
        <span className="text-[10px] text-slate-500 font-mono">
          ⌀ {(baseR * 2).toFixed(2)} mm
        </span>
      </div>
      <p className="text-[10px] text-slate-400 leading-snug">
        Pick a fit class — radius nudges by half the named clearance so the bore matches a real-world tolerance table.
      </p>
      <div className="grid grid-cols-1 gap-1">
        {TOLERANCE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            data-testid={`tolerance-${preset.id}`}
            onClick={() => applyFit(preset)}
            title={preset.blurb}
            className="flex items-center justify-between text-[11px] px-2 py-1 rounded border border-slate-700 hover:border-cyan-400 hover:bg-cyan-500/10 text-left transition-colors"
          >
            <span className="text-slate-200 font-medium">{preset.label}</span>
            <span className="text-cyan-300/80 font-mono text-[10px]">
              {preset.delta > 0 ? "+" : ""}{preset.delta.toFixed(2)} mm clr
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}


// Group printers by brand for the select (built-ins + community)
function printerOptions(community) {
  const byBrand = {};
  for (const p of PRINTERS) {
    if (!byBrand[p.brand]) byBrand[p.brand] = [];
    byBrand[p.brand].push({ id: p.id, label: p.name, kind: "builtin" });
  }
  if (community && community.length > 0) {
    byBrand["Community"] = community.map((c) => ({
      id: c.id,
      label: `${c.brand} ${c.name}${c.uses ? ` · ${c.uses}★` : ""}`,
      kind: "community",
    }));
  }
  return byBrand;
}

function findPrinterAny(id, community) {
  return (
    PRINTERS.find((p) => p.id === id) ||
    (() => {
      const c = community.find((x) => x.id === id);
      if (!c) return null;
      return {
        id: c.id,
        brand: c.brand,
        name: c.name,
        buildVolume: { x: c.build_x, y: c.build_y, z: c.build_z },
        maxNozzleTemp: c.max_nozzle_temp,
        maxBedTemp: c.max_bed_temp,
        defaultNozzle: c.default_nozzle,
        defaultPrintSpeed: c.default_print_speed,
        notes: c.notes,
        submitter: c.submitter,
        community: true,
      };
    })()
  );
}

function ProfileSection({ onSavePrinter }) {
  const printerId = useScene((s) => s.printerId);
  const filamentId = useScene((s) => s.filamentId);
  const community = useScene((s) => s.communityPrinters);
  const setCommunity = useScene((s) => s.setCommunityPrinters);
  const setPrinter = useScene((s) => s.setPrinter);
  const setFilament = useScene((s) => s.setFilament);
  const removeCommunityPrinter = useScene((s) => s.removeCommunityPrinter);
  const myPrinterId = useScene((s) => s.myPrinterId);
  const setMyPrinter = useScene((s) => s.setMyPrinter);
  const setS = useSliceSettings((s) => s.set);
  const autoDropOnRotate = useScene((s) => s.autoDropOnRotate);
  const setAutoDropOnRotate = useScene((s) => s.setAutoDropOnRotate);
  const autoDropNew = useScene((s) => s.autoDropNew);
  const setAutoDropNew = useScene((s) => s.setAutoDropNew);
  const [recents, setRecents] = useState(() => recentPrinters.list());
  const [upvoting, setUpvoting] = useState(false);

  const printer = findPrinterAny(printerId, community) || getPrinter("custom");
  const filament = getFilament(filamentId);
  const groups = useMemo(() => printerOptions(community), [community]);
  const isCommunity = !!printer.community;
  const recentEntries = useMemo(
    () =>
      recents
        .map((id) => findPrinterAny(id, community))
        .filter(Boolean)
        .filter((p) => p.id !== printerId)
        .slice(0, 4),
    [recents, community, printerId]
  );

  const handlePrinter = (id) => {
    const p = findPrinterAny(id, community);
    if (!p) return;
    setPrinter(id);
    setRecents(recentPrinters.push(id));
    setS({
      nozzleDiameter: p.defaultNozzle,
      printSpeed: Math.round((p.defaultPrintSpeed || 100) * (filament.printSpeedMultiplier || 1)),
    });
    if (p.community) printersApi.use(id);
  };
  const handleFilament = (id) => {
    const f = getFilament(id);
    setFilament(id);
    setS({
      nozzleTemp: f.nozzleTemp,
      bedTemp: f.bedTemp,
      retraction: f.retraction,
      printSpeed: Math.round((printer.defaultPrintSpeed || 100) * (f.printSpeedMultiplier || 1)),
    });
  };
  const handleRemoveCommunity = async () => {
    if (!isCommunity) return;
    if (!window.confirm(`Remove community printer "${printer.brand} ${printer.name}"?`)) return;
    try {
      await printersApi.delete(printer.id);
      removeCommunityPrinter(printer.id);
      setPrinter("custom");
    } catch (e) {
      window.alert("Delete failed: " + (e.response?.data?.detail || e.message));
    }
  };
  const handleUpvote = async () => {
    if (!isCommunity || upvoting || upvotedPrinters.has(printer.id)) return;
    setUpvoting(true);
    try {
      const res = await printersApi.upvote(printer.id);
      upvotedPrinters.add(printer.id);
      // refresh community list to reflect new vote count
      const list = await printersApi.list();
      setCommunity(list);
    } catch (e) {
      window.alert("Vote failed: " + (e.response?.data?.detail || e.message));
    } finally { setUpvoting(false); }
  };
  const alreadyVoted = isCommunity && upvotedPrinters.has(printer.id);

  return (
    <Section title="Printer & Filament" icon={Factory} testid="profile-section" accent="text-orange-500">
      {recentEntries.length > 0 && (
        <div data-testid="recent-printers">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center gap-1">
            <History size={10} /> Recent
          </div>
          <div className="flex flex-wrap gap-1">
            {recentEntries.map((p) => (
              <button
                key={p.id}
                data-testid={`recent-printer-${p.id}`}
                onClick={() => handlePrinter(p.id)}
                className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-orange-500/20 hover:text-orange-300 text-slate-300 border border-slate-700 truncate max-w-[120px]"
                title={`${p.brand} ${p.name}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium flex items-center justify-between">
          Printer
          <span className="flex items-center gap-2">
            {/* "Set as my default" — persists the currently-selected
                printer to localStorage so the next workspace load
                restores it automatically. Shows a filled star + amber
                tint when this printer IS already the default. */}
            <button
              data-testid="set-default-printer-btn"
              onClick={() => setMyPrinter(myPrinterId === printerId ? null : printerId)}
              title={
                myPrinterId === printerId
                  ? "This is your default printer — click to clear"
                  : "Make this my default printer (auto-load on next session)"
              }
              className={`text-[10px] flex items-center gap-1 normal-case tracking-normal font-semibold ${
                myPrinterId === printerId
                  ? "text-yellow-300 hover:text-yellow-200"
                  : "text-slate-500 hover:text-yellow-300"
              }`}
            >
              <Star size={11} fill={myPrinterId === printerId ? "#FDE047" : "none"} />
              {myPrinterId === printerId ? "Default" : "Set default"}
            </button>
            <button
              data-testid="save-printer-btn"
              onClick={onSavePrinter}
              className="text-[10px] text-orange-400 hover:text-orange-300 flex items-center gap-1 normal-case tracking-normal font-semibold"
            >
              <Upload size={11} /> Save mine
            </button>
          </span>
        </span>
        <PrinterPicker
          groups={groups}
          value={printerId}
          onChange={handlePrinter}
          currentLabel={`${printer.brand} ${printer.name}`}
          testid="printer-select"
        />
      </label>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] font-mono bg-slate-950/60 border border-slate-800 rounded p-2">
        <span className="text-slate-500">Volume</span>
        <span className="col-span-2 text-slate-200 text-right">
          {printer.buildVolume.x}×{printer.buildVolume.y}×{printer.buildVolume.z} mm
        </span>
        <span className="text-slate-500">Max hotend</span>
        <span className="col-span-2 text-slate-200 text-right">{printer.maxNozzleTemp} °C</span>
        <span className="text-slate-500">Max bed</span>
        <span className="col-span-2 text-slate-200 text-right">{printer.maxBedTemp} °C</span>
        {isCommunity && (
          <>
            <span className="text-slate-500">Submitter</span>
            <span className="col-span-2 text-orange-400 text-right flex items-center justify-end gap-1">
              {printer.submitter || "Anonymous"}
              {printer.verified && <BadgeCheck size={11} className="text-green-400" />}
            </span>
            <span className="text-slate-500">Votes</span>
            <span className="col-span-2 text-slate-200 text-right font-bold">
              ★ {printer.votes ?? 0}
            </span>
            {printer.notes && (
              <span className="col-span-3 text-slate-400 italic text-[10px] leading-snug pt-1 normal-case">
                "{printer.notes}"
              </span>
            )}
            <div className="col-span-3 flex gap-1 mt-1">
              <button
                data-testid="upvote-community-printer-btn"
                onClick={handleUpvote}
                disabled={alreadyVoted || upvoting}
                className={`flex-1 h-6 text-[10px] flex items-center justify-center gap-1 rounded border ${
                  alreadyVoted
                    ? "bg-yellow-500/10 border-yellow-500/40 text-yellow-300"
                    : "bg-slate-800 hover:bg-yellow-500/20 hover:text-yellow-300 text-slate-300 border-slate-700"
                }`}
              >
                <Star size={10} fill={alreadyVoted ? "#FACC15" : "none"} />
                {alreadyVoted ? "Voted" : "Upvote"}
              </button>
              <button
                data-testid="delete-community-printer-btn"
                onClick={handleRemoveCommunity}
                className="h-6 px-2 text-[10px] flex items-center justify-center gap-1 bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded border border-slate-700"
              >
                <Trash2 size={10} />
              </button>
            </div>
          </>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Filament</span>
        <select
          data-testid="filament-select"
          value={filamentId}
          onChange={(e) => handleFilament(e.target.value)}
          className="h-8 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
        >
          {FILAMENTS.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <p className="text-[10px] text-slate-400 leading-snug">{filament.notes}</p>

      <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
        <input
          data-testid="auto-drop-new-toggle"
          type="checkbox"
          checked={autoDropNew}
          onChange={(e) => setAutoDropNew(e.target.checked)}
          className="accent-orange-500"
        />
        Drop new parts to bed on add
        <span className="text-slate-500 text-[10px]">(beginner-friendly)</span>
      </label>

      <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
        <input
          data-testid="auto-drop-toggle"
          type="checkbox"
          checked={autoDropOnRotate}
          onChange={(e) => setAutoDropOnRotate(e.target.checked)}
          className="accent-orange-500"
        />
        Auto-drop to bed on rotate
      </label>

      <AutoSaveSection />
    </Section>
  );
}

// ---------- Auto-save section ----------
// Small panel that lets the user pick a local file to continually save the
// editable project JSON to. Uses File System Access API when available
// (Chromium) so writes are silent and in-place; falls back to the Downloads
// folder elsewhere with a warning about the filename suffix behaviour.
// AutoSaveSection moved to inspector/AutoSaveSection.jsx during the
// iter-103.3 refactor pass — see the file there for the implementation.
function ManifoldHealth() {
  const objects = useScene((s) => s.objects);
  const [info, setInfo] = useState({ ok: true, edges: 0, tris: 0 });

  // Debounced recompute when scene changes (runs in a Web Worker so the UI
  // doesn't stutter on heavy models).
  useEffect(() => {
    if (objects.length === 0) {
      setInfo({ ok: true, edges: 0, tris: 0 });
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      evaluateSceneStatsAsync(objects)
        .then((r) => {
          if (cancelled) return;
          setInfo({ ok: r.manifold, edges: r.boundaryEdges, tris: r.triangleCount });
        })
        .catch(() => {
          if (cancelled) return;
          setInfo({ ok: true, edges: 0, tris: 0 });
        });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [objects]);

  if (info.ok || info.tris === 0) return null;
  return (
    <div className="mx-3 mb-3 rounded border border-blue-500/40 bg-blue-500/10 p-2" data-testid="manifold-warning">
      <div className="flex items-center gap-1 text-blue-300 text-[10px] font-semibold uppercase tracking-wider mb-1">
        <ShieldAlert size={11} /> Mesh has {info.edges} open edges
      </div>
      <p className="text-[11px] text-blue-100/90 leading-snug">
        Your Boolean operation produced a near-tangent boundary that the CSG engine
        can't perfectly close. <span className="text-white font-medium">Your print will still slice fine</span> —
        modern slicers (OrcaSlicer, PrusaSlicer, Flash Studio, Bambu Studio) all auto-repair on import.
        For perfect manifold geometry, slightly overlap or fully separate the parts.
      </p>
    </div>
  );
}

function CompatibilityWarning() {
  const objects = useScene((s) => s.objects);
  const buildVolume = useScene((s) => s.buildVolume);
  const printerId = useScene((s) => s.printerId);
  const filamentId = useScene((s) => s.filamentId);
  const settings = useSliceSettings();
  const printer = getPrinter(printerId);
  const filament = getFilament(filamentId);

  const warnings = [];

  // Build-volume check: estimate world bbox from object positions + dims
  // (approximation: use position +/- max extent from dims/scale)
  for (const o of objects) {
    if (!o.visible) continue;
    const half = estimateHalfExtents(o);
    const max = [
      o.position[0] + half[0],
      o.position[1] + half[1] * 2,
      o.position[2] + half[2],
    ];
    const min = [o.position[0] - half[0], 0, o.position[2] - half[2]];
    if (
      max[0] > buildVolume.x / 2 || min[0] < -buildVolume.x / 2 ||
      max[2] > buildVolume.y / 2 || min[2] < -buildVolume.y / 2 ||
      max[1] > buildVolume.z
    ) {
      warnings.push(`"${o.name}" extends beyond ${printer.name} build volume`);
      break; // one is enough
    }
  }

  if (settings.nozzleTemp > printer.maxNozzleTemp) {
    warnings.push(`Hotend ${settings.nozzleTemp}°C exceeds printer max ${printer.maxNozzleTemp}°C`);
  }
  if (settings.bedTemp > printer.maxBedTemp) {
    warnings.push(`Bed ${settings.bedTemp}°C exceeds printer max ${printer.maxBedTemp}°C`);
  }
  if (settings.nozzleTemp < filament.minNozzleTemp || settings.nozzleTemp > filament.maxNozzleTemp) {
    warnings.push(`Hotend ${settings.nozzleTemp}°C outside ${filament.name} range (${filament.minNozzleTemp}–${filament.maxNozzleTemp}°C)`);
  }

  if (warnings.length === 0) return null;
  return (
    <div className="mx-3 mb-3 rounded border border-amber-500/40 bg-amber-500/10 p-2" data-testid="compat-warning">
      <div className="flex items-center gap-1 text-amber-400 text-[10px] font-semibold uppercase tracking-wider mb-1">
        <AlertTriangle size={11} /> Compatibility
      </div>
      <ul className="text-[11px] text-amber-100/90 list-disc list-inside space-y-0.5">
        {warnings.map((w) => <li key={w}>{w}</li>)}
      </ul>
    </div>
  );
}

function estimateHalfExtents(o) {
  // iter-104.x — Z-up CAD convention. Returns [hx, hy, hz] where each
  // element is the half-extent along world X / Y (forward) / Z (up).
  // Dims map 1:1 to world axes for all primitives now.
  const d = o.dims || {};
  const s = o.scale || [1, 1, 1];
  if (o.type === "cube") return [(d.x || 20) / 2 * s[0], (d.y || 20) / 2 * s[1], (d.z || 20) / 2 * s[2]];
  if (o.type === "sphere") return [(d.r || 10) * s[0], (d.r || 10) * s[1], (d.r || 10) * s[2]];
  if (o.type === "cylinder" || o.type === "cone") {
    // Axis = +Z (height). Radial extent on X/Y.
    return [(d.r || 10) * s[0], (d.r || 10) * s[1], (d.h || 20) / 2 * s[2]];
  }
  if (o.type === "torus") {
    // Hole axis = +Z; ring lies in XY. Thickness along Z = tube radius × 2.
    const R = (d.r || 12) + (d.tube || 4);
    return [R * s[0], R * s[1], (d.tube || 4) * s[2]];
  }
  if (o.type === "helix") {
    // Axis = +Z; tube winds around the Z column.
    const R = (d.r || 12) + (d.tube || 2);
    const H = (d.turns || 4) * (d.pitch || 6);
    return [R * s[0], R * s[1], (H / 2) * s[2]];
  }
  if (o.type === "pipe") {
    return [(d.r || 12) * s[0], (d.r || 12) * s[1], (d.h || 30) / 2 * s[2]];
  }
  if (o.type === "wedge") return [(d.x || 24) / 2 * s[0], (d.y || 16) / 2 * s[1], (d.z || 24) / 2 * s[2]];
  // iter-149 — pyramid + n-gon prism have the same radial half-extent
  // conventions as cylinder/cone: circumradius on X/Y, height/2 on Z.
  if (o.type === "pyramid" || o.type === "ngon_prism") {
    return [(d.r || 12) * s[0], (d.r || 12) * s[1], (d.h || 20) / 2 * s[2]];
  }
  if (o.type === "bolt") {
    // Long axis = +Z. Outer radius dominates X/Y.
    const outerR = Math.max(d.r || 5, d.headR || 8);
    const totalH = (d.headH || 4) + (d.h || 20);
    return [outerR * s[0], outerR * s[1], (totalH / 2) * s[2]];
  }
  if (o.type === "nut") {
    const flatR = d.flatR || 8;
    return [flatR * s[0], flatR * s[1], (d.h || 5) / 2 * s[2]];
  }
  if (o.type === "spline") {
    const outerR = (d.r || 6) + (d.toothHeight || 1.2);
    return [outerR * s[0], outerR * s[1], (d.h || 30) / 2 * s[2]];
  }
  if (o.type === "text") {
    // Text bbox is data-dependent (font + glyphs) — approximate
    // from the size value and string length. The accurate bbox is
    // available via computeRotatedBBox once the geometry builds;
    // this heuristic is only used for the selection halo so a
    // slight over-estimate is fine and won't show through.
    const size = d.size || 8;
    const depth = d.depth || 2;
    const length = String(d.text ?? "Hello").length || 1;
    // Average glyph advance ~= 0.6 × size for Latin proportional fonts.
    const halfW = (length * size * 0.6) / 2;
    return [halfW * s[0], (size / 2) * s[1], (depth / 2) * s[2]];
  }
  // sweep: approximate from path/profile. Accurate bbox lives in
  // computeRotatedBBox (geometry.js) — drop-to-bed uses that.
  if (o.type === "sweep") {
    const p = d.path || {};
    const prof = d.profile || {};
    const profR = prof.r ?? Math.max(prof.w || 0, prof.h || 0) / 2 ?? 2;
    if (p.kind === "helix") {
      const ext = (p.r ?? 12) + profR;
      const height = (p.pitch ?? 6) * (p.turns ?? 3) / 2 + profR;
      return [ext * s[0], ext * s[1], height * s[2]];
    }
    if (p.kind === "arc") {
      const ext = (p.r ?? 20) + profR;
      return [ext * s[0], ext * s[1], profR * s[2]];
    }
    return [30 * s[0], 30 * s[1], 30 * s[2]];
  }
  if (o.originalBbox) return [o.originalBbox.x / 2 * s[0], o.originalBbox.y / 2 * s[1], o.originalBbox.z / 2 * s[2]];
  return [10, 10, 10];
}

// Iter-151.6 — Move to Plate control (Multi-Plate MVP).
// Dispatches the current selection (or just the primary selected object
// if nothing else is highlighted) to another plate. Renders a compact
// dropdown so users can quickly move multiple parts of a large
// parametric assembly across plates without leaving the Inspector.
function MoveToPlateControl({ obj, selectedIds, plates, activePlateId, moveObjectsToPlate }) {
  const [open, setOpen] = useState(false);
  // If nothing is multi-selected, act on the primary selected object.
  const targetIds = selectedIds.length > 0 ? selectedIds : [obj.id];
  const others = plates.filter((p) => p.id !== activePlateId);
  if (others.length === 0) return null;
  return (
    <div className="relative">
      <button
        data-testid="inspector-move-to-plate-btn"
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-full bg-amber-600/90 hover:bg-amber-500 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-amber-400/40"
        title={`Move ${targetIds.length} selected part(s) to another plate`}
      >
        <Send size={13} /> Move to Plate ({targetIds.length})
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded shadow-xl overflow-hidden z-30"
          data-testid="inspector-move-to-plate-menu"
        >
          {others.map((p) => (
            <button
              key={p.id}
              data-testid={`inspector-move-to-plate-${p.id}`}
              onClick={() => {
                moveObjectsToPlate(targetIds, p.id);
                setOpen(false);
              }}
              className="block w-full text-left px-2.5 py-1.5 text-xs text-slate-200 hover:bg-amber-600 hover:text-white"
            >
              → {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}



function Inspector() {
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const updateObject = useScene((s) => s.updateObject);
  const updateDims = useScene((s) => s.updateDims);
  const flipModifier = useScene((s) => s.flipModifier);
  const dropToBed = useScene((s) => s.dropToBed);
  const layFlatSelection = useScene((s) => s.layFlatSelection);
  const setColorIndex = useScene((s) => s.setColorIndex);
  // iter-112 — used in dimension section headers ("Dimensions (mm/in)").
  const unitSystem = useScene((s) => s.unitSystem);
  const removeObject = useScene((s) => s.removeObject);
  const selectedIds = useScene((s) => s.selectedIds || []);
  const plates = useScene((s) => s.plates || []);
  const activePlateId = useScene((s) => s.activePlateId);
  const moveObjectsToPlate = useScene((s) => s.moveObjectsToPlate);

  // Reverse-Engineer was removed in iter-111.4 — the RANSAC output
  // wasn't actionable enough to justify the UI. See CHANGELOG iter-111.4.
  const obj = objects.find((o) => o.id === selectedId);
  if (!obj) {
    return (
      <Section title="Inspector" icon={Sliders} testid="inspector-empty">
        <div className="text-xs text-slate-500 italic">Select an object to edit its properties.</div>
      </Section>
    );
  }

  return (
    <Section title={`Inspector — ${obj.type}`} icon={Sliders} testid="inspector">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Name</span>
        <input
          data-testid="inspector-name"
          value={obj.name}
          onChange={(e) => updateObject(obj.id, { name: e.target.value })}
          className="h-8 bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none"
        />
      </label>

      <div className="flex gap-2">
        <button
          data-testid="inspector-mod-positive"
          onClick={() => obj.modifier === "negative" && flipModifier(obj.id)}
          className={`flex-1 h-8 rounded text-xs font-semibold border ${
            obj.modifier !== "negative"
              ? "bg-orange-500/20 border-orange-500 text-orange-300"
              : "bg-slate-900 border-slate-700 text-slate-400 hover:border-orange-500/60"
          }`}
        >
          POSITIVE
        </button>
        <button
          data-testid="inspector-mod-negative"
          onClick={() => obj.modifier !== "negative" && flipModifier(obj.id)}
          className={`flex-1 h-8 rounded text-xs font-semibold border ${
            obj.modifier === "negative"
              ? "bg-cyan-500/20 border-cyan-500 text-cyan-300"
              : "bg-slate-900 border-slate-700 text-slate-400 hover:border-cyan-500/60"
          }`}
        >
          NEGATIVE
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          data-testid="drop-to-bed-btn"
          onClick={() => dropToBed(obj.id)}
          className="h-8 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-slate-700"
          title="Drop object so its lowest point sits on Y=0"
        >
          <ArrowDownToLine size={13} /> Drop
        </button>
        <button
          data-testid="lay-flat-btn"
          onClick={() => layFlatSelection(true)}
          className="h-8 bg-orange-600/90 hover:bg-orange-500 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-orange-400/40"
          title="Rotate selection so its largest face sits on the bed (then drop). One-click prep for slicing thin/tall models."
        >
          <Layers size={13} /> Lay Flat
        </button>
        {/* iPad-friendly delete — same as ⌫ on desktop. */}
        <button
          data-testid="inspector-delete-btn"
          onClick={() => {
            if (obj.groupId) {
              const ok = window.confirm(
                `Delete "${obj.name}" from "${obj.groupName || "group"}"? The rest of the group stays.`,
              );
              if (!ok) return;
            }
            removeObject(obj.id);
          }}
          className="h-8 bg-red-600/90 hover:bg-red-500 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-red-400/40"
          title="Delete this object (iPad-friendly — same as ⌫ on desktop)"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>

      {/* iter-151.6 — Move to Plate. Multi-Plate MVP: dispatch the
          current selection (or just this object if nothing else is
          selected) to another plate. Only rendered when the user has
          more than one plate — otherwise it's noise. */}
      {plates.length > 1 && (
        <MoveToPlateControl
          obj={obj}
          selectedIds={selectedIds}
          plates={plates}
          activePlateId={activePlateId}
          moveObjectsToPlate={moveObjectsToPlate}
        />
      )}

      {/* iter-111.2 — Restore-from-ghost. Surfaces when the object is
          flagged as ghosted (by RANSAC Phase 4's overlay flow) so the
          user can promote it back to a normal interactive mesh.
          Clearing the flag also unlocks it (so clicks register again
          and it stops fading through other geometry). */}
      {obj.ghosted && (
        <button
          data-testid="restore-from-ghost-btn"
          onClick={() => updateObject(obj.id, { ghosted: false, locked: false })}
          className="h-8 w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 border border-emerald-400/40"
          title="Promote this ghosted reference back to a normal opaque mesh"
        >
          <Eye size={13} /> Restore from ghost
        </button>
      )}

      {/* iter-111 — Tolerance helper. Only meaningful for NEGATIVE
          cylinders / cones (the holes / bores that need clearance for
          a press / running / loose fit). Nudges `dims.r` by the named
          delta and surfaces the resulting clearance in the tooltip so
          beginners can pick a fit without knowing the numbers. */}
      {(obj.modifier === "negative" && (obj.type === "cylinder" || obj.type === "cone")) && (
        <ToleranceHelper obj={obj} updateDims={updateDims} />
      )}

      {obj.type === "imported" && obj.geometry && (
        <MeshImportTools obj={obj} />
      )}

      {obj.modifier !== "negative" && (
        <div data-testid="inspector-color-picker">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center justify-between">
            <span>Filament Color</span>
            <span className="text-[9px] normal-case text-slate-500">slot T{obj.colorIndex || 0}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MULTICOLOR_PALETTE.map((c, i) => {
              const active = (obj.colorIndex || 0) === i;
              return (
                <button
                  key={c.hex || c.name || i}
                  data-testid={`color-swatch-${i}`}
                  onClick={() => setColorIndex(obj.id, i)}
                  title={`${c.name} (T${i})`}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    active ? "border-white scale-110 ring-2 ring-orange-500" : "border-slate-700 hover:scale-105"
                  }`}
                  style={{ background: c.hex }}
                />
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center justify-between">
          <span>Transforms</span>
          <span className="text-[9px] normal-case text-slate-500">use top toolbar</span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px] font-mono bg-slate-950/60 border border-slate-800 rounded p-1.5">
          <span className="text-slate-500">Pos</span>
          <span className="col-span-2 text-slate-200 text-right truncate">
            {obj.position[0].toFixed(1)}, {obj.position[1].toFixed(1)}, {obj.position[2].toFixed(1)}
          </span>
          {(() => {
            // Show the bottom-Y of the actual rotated/scaled bbox so the user
            // can see at a glance whether the part is sitting on the bed
            // (bottom=0) or floating. "Pos" is the CENTER which trips up
            // first-time CAD users who think Y means "above the table".
            let bottomZ = null;
            try {
              const bb = computeRotatedBBox(obj);
              if (isFinite(bb.min.z)) bottomZ = (obj.position?.[2] ?? 0) + bb.min.z;
            } catch (_) { /* ignore */ }
            if (bottomZ === null) return null;
            const onBed = Math.abs(bottomZ) < 0.05;
            return (
              <>
                <span className="text-slate-500">Bottom Z</span>
                <span
                  data-testid="bottom-z"
                  className={`col-span-2 text-right truncate ${onBed ? "text-green-400" : "text-orange-300"}`}
                  title={onBed ? "Part is sitting on the bed" : "Part is floating or below the bed"}
                >
                  {bottomZ.toFixed(2)} mm {onBed ? "✓ on bed" : ""}
                </span>
              </>
            );
          })()}
          <span className="text-slate-500">Rot</span>
          <span className="col-span-2 text-slate-200 text-right truncate">
            {obj.rotation[0].toFixed(0)}°, {obj.rotation[1].toFixed(0)}°, {obj.rotation[2].toFixed(0)}°
          </span>
          <span className="text-slate-500">Scale</span>
          <span className="col-span-2 text-slate-200 text-right truncate">
            {obj.scale[0].toFixed(2)} · {obj.scale[1].toFixed(2)} · {obj.scale[2].toFixed(2)}
          </span>
        </div>
      </div>

      {obj.type === "cube" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 flex items-center justify-between">
            <span>Dimensions ({unitSystem})</span>
            <span className="text-[9px] text-slate-500 normal-case font-normal" title="X = right (width), Y = forward (depth), Z = up (height)">
              X · Y · Z
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField inUnit="length" testid="dim-x" label="X" hint="width" value={obj.dims.x} onChange={(v) => updateDims(obj.id, { x: v })} step={1} min={0.1} />
            <NumberField inUnit="length" testid="dim-y" label="Y" hint="depth" value={obj.dims.y} onChange={(v) => updateDims(obj.id, { y: v })} step={1} min={0.1} />
            <NumberField inUnit="length" testid="dim-z" label="Z" hint="height" value={obj.dims.z} onChange={(v) => updateDims(obj.id, { z: v })} step={1} min={0.1} />
          </div>
          {/* Iter-105.20 — Edge fillet/chamfer controls removed at user
              request. Reason: the modifier-mesh 3MF export pipeline
              doesn't carry fine edge geometry through to the slicer's
              modifier-volume carve, so showing the UI was misleading
              (users would dial in a fillet, export, and find the
              slicer rendered the cut with sharp edges anyway). The
              EdgeControls component is preserved at
              `./inspector/EdgeControls.jsx` should the path forward
              ever support it natively in the slicer. */}
        </div>
      )}
      {(obj.type === "sphere" || obj.type === "cylinder" || obj.type === "cone") && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions ({unitSystem})</div>
          {/* Cone with explicit top/bottom radii (e.g. a countersink
              taper) gets a TWO-radius editor so the Inspector matches
              what the geometry actually uses. Falls through to the
              single-radius UI for a regular pointy cone. */}
          {obj.type === "cone" && typeof obj.dims.r1 === "number" && typeof obj.dims.r2 === "number" ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                testid="dim-r1"
                label="Top ⌀"
                hint="r1"
                value={(obj.dims.r1 || 0) * 2}
                onChange={(v) => updateDims(obj.id, { r1: Math.max(0.05, v / 2) })}
                step={0.5}
                min={0.1}
              />
              <NumberField
                testid="dim-r2"
                label="Bottom ⌀"
                hint="r2"
                value={(obj.dims.r2 || 0) * 2}
                onChange={(v) => updateDims(obj.id, { r2: Math.max(0.05, v / 2) })}
                step={0.5}
                min={0.1}
              />
              <NumberField inUnit="length" testid="dim-h" label="Height" value={obj.dims.h} onChange={(v) => updateDims(obj.id, { h: v })} step={0.5} min={0.1} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {/* Display & edit DIAMETER for less ambiguity ("a 3mm bolt needs
                  a 3.2mm hole" = diameter, never radius). The store still
                  holds radius, so we convert at the boundary. */}
              <NumberField
                testid="dim-d"
                label={`Diameter${typeof obj.dims.r === "number" ? `  (r=${(obj.dims.r).toFixed(1)})` : ""}`}
                value={(obj.dims.r || 0) * 2}
                onChange={(v) => updateDims(obj.id, { r: Math.max(0.05, v / 2) })}
                step={0.5}
                min={0.1}
              />
              {obj.type !== "sphere" && (
                <NumberField inUnit="length" testid="dim-h" label="Height" value={obj.dims.h} onChange={(v) => updateDims(obj.id, { h: v })} step={0.5} min={0.1} />
              )}
            </div>
          )}
          {/* Segment count — exposes the polygon resolution. Defaults are
              48/64 (smooth-looking); dropping to e.g. 6 turns a cylinder
              into a hex prism, 4 makes a square pillar, etc. This is how
              users can "define the number of sides in a polygon" without a
              separate primitive. */}
          {(obj.type === "cylinder" || obj.type === "cone") && (
            <div className="mt-2">
              <NumberField
                testid="dim-segments"
                label={`Sides${(obj.dims.segments || 0) <= 12 ? `  (${obj.dims.segments || 64} = polygon)` : ""}`}
                value={obj.dims.segments || 64}
                onChange={(v) => updateDims(obj.id, { segments: Math.max(3, Math.min(256, Math.round(v))) })}
                step={1}
                min={3}
              />
              <div className="text-[10px] text-slate-500 mt-1 font-mono">
                3=triangle · 4=square · 6=hex · 8=octagon · 32+=smooth circle
              </div>
            </div>
          )}
          {obj.type === "sphere" && (
            <div className="mt-2">
              <NumberField
                testid="dim-segments"
                label="Segments"
                value={obj.dims.segments || 48}
                onChange={(v) => updateDims(obj.id, { segments: Math.max(8, Math.min(128, Math.round(v))) })}
                step={4}
                min={8}
              />
            </div>
          )}
          {/* Iter-105.20 — Edge fillet/chamfer controls removed for the
              same reason as the cube path above (misleading because the
              modifier-mesh 3MF carve doesn't honour fine edge geometry
              at slice time). */}
        </div>
      )}
      {obj.type === "torus" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions ({unitSystem})</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              testid="dim-d"
              label={`Diameter${typeof obj.dims.r === "number" ? `  (r=${(obj.dims.r).toFixed(1)})` : ""}`}
              value={(obj.dims.r || 0) * 2}
              onChange={(v) => updateDims(obj.id, { r: Math.max(0.05, v / 2) })}
              step={0.5}
            />
            <NumberField inUnit="length" testid="dim-tube" label="Tube ⌀" value={(obj.dims.tube || 0) * 2} onChange={(v) => updateDims(obj.id, { tube: Math.max(0.05, v / 2) })} step={0.2} />
          </div>
        </div>
      )}

      {/* Helix — coil/spring/thread shape. Total height = turns × pitch.
          User sees four fields (Radius, Tube ⌀, Pitch, Turns); the
          number of segments is left at the safe 96 default. */}
      {obj.type === "helix" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions ({unitSystem})</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField inUnit="length" testid="dim-helix-r" label="Radius" value={obj.dims.r || 12} onChange={(v) => updateDims(obj.id, { r: Math.max(0.5, v) })} step={0.5} />
            <NumberField inUnit="length" testid="dim-helix-tube" label="Tube ⌀" value={(obj.dims.tube || 2) * 2} onChange={(v) => updateDims(obj.id, { tube: Math.max(0.1, v / 2) })} step={0.2} />
            <NumberField inUnit="length" testid="dim-helix-pitch" label="Pitch" value={obj.dims.pitch || 6} onChange={(v) => updateDims(obj.id, { pitch: Math.max(0.5, v) })} step={0.5} suffix="mm/turn" />
            <NumberField testid="dim-helix-turns" label="Turns" value={obj.dims.turns || 4} onChange={(v) => updateDims(obj.id, { turns: Math.max(0.25, v) })} step={0.25} />
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            Height = {((obj.dims.turns || 4) * (obj.dims.pitch || 6)).toFixed(1)} mm ({obj.dims.turns || 4} turns × {obj.dims.pitch || 6} mm/turn).
          </div>
        </div>
      )}

      {/* Pipe — hollow cylinder. Wall thickness is the gap between outer
          R and inner R; clamped so wall < R to keep a real interior. */}
      {obj.type === "pipe" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions ({unitSystem})</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField inUnit="length" testid="dim-pipe-d" label="Outer ⌀" value={(obj.dims.r || 12) * 2} onChange={(v) => updateDims(obj.id, { r: Math.max(0.5, v / 2) })} step={0.5} />
            <NumberField inUnit="length" testid="dim-pipe-wall" label="Wall" value={obj.dims.wall || 2} onChange={(v) => updateDims(obj.id, { wall: Math.max(0.2, Math.min((obj.dims.r || 12) - 0.1, v)) })} step={0.2} />
            <NumberField inUnit="length" testid="dim-pipe-h" label="Height" value={obj.dims.h || 30} onChange={(v) => updateDims(obj.id, { h: Math.max(0.5, v) })} step={1} />
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            Inner ⌀ = {(((obj.dims.r || 12) - (obj.dims.wall || 2)) * 2).toFixed(1)} mm.
          </div>
        </div>
      )}

      {/* Wedge — same XYZ as a cube; the geometry is a ramp. */}
      {obj.type === "wedge" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions ({unitSystem})</div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField inUnit="length" testid="dim-wedge-x" label="Length (X)" value={obj.dims.x || 24} onChange={(v) => updateDims(obj.id, { x: Math.max(0.5, v) })} step={1} />
            <NumberField inUnit="length" testid="dim-wedge-y" label="Height (Y)" value={obj.dims.y || 16} onChange={(v) => updateDims(obj.id, { y: Math.max(0.5, v) })} step={1} />
            <NumberField inUnit="length" testid="dim-wedge-z" label="Depth (Z)" value={obj.dims.z || 24} onChange={(v) => updateDims(obj.id, { z: Math.max(0.5, v) })} step={1} />
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            Ramps from y=0 at +z to y={(obj.dims.y || 16).toFixed(1)} at −z.
          </div>
        </div>
      )}

      {/* Pyramid + N-gon Prism (iter-149, Release A). Same three knobs
          for both — `sides`, base circumradius, height — so the
          controls collapse into one block. */}
      {(obj.type === "pyramid" || obj.type === "ngon_prism") && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">
            Dimensions ({unitSystem})
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              inUnit="length"
              testid={`dim-${obj.type}-r`}
              label="Base radius"
              value={obj.dims.r || 12}
              onChange={(v) => updateDims(obj.id, { r: Math.max(0.5, v) })}
              step={0.5}
            />
            <NumberField
              inUnit="length"
              testid={`dim-${obj.type}-h`}
              label={obj.type === "pyramid" ? "Apex height" : "Height"}
              value={obj.dims.h || 20}
              onChange={(v) => updateDims(obj.id, { h: Math.max(0.5, v) })}
              step={0.5}
            />
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Sides</span>
              <span data-testid={`dim-${obj.type}-sides-readout`} className="text-[10px] font-mono text-orange-400">
                {obj.dims.sides | 0}
              </span>
            </div>
            <input
              data-testid={`dim-${obj.type}-sides-slider`}
              type="range"
              min={3}
              max={24}
              step={1}
              value={(obj.dims.sides | 0) || (obj.type === "pyramid" ? 4 : 6)}
              onChange={(e) => updateDims(obj.id, { sides: parseInt(e.target.value, 10) })}
              className="w-full accent-orange-500"
            />
            <div className="mt-1">
              <NumberField
                testid={`dim-${obj.type}-sides-input`}
                label=""
                value={(obj.dims.sides | 0) || (obj.type === "pyramid" ? 4 : 6)}
                onChange={(v) => updateDims(obj.id, { sides: Math.max(3, Math.min(24, Math.round(v))) })}
                step={1}
                min={3}
                suffix="sides"
              />
            </div>
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {obj.type === "pyramid"
              ? `${(obj.dims.sides | 0) || 4}-sided pyramid — base at Z=0, apex ${(obj.dims.h || 20).toFixed(1)} mm above.`
              : `${(obj.dims.sides | 0) || 6}-sided prism — ${(obj.dims.h || 20).toFixed(1)} mm tall.`}
          </div>
        </div>
      )}

      {/* Bolt — ISO-metric inspired. `r` is the major thread radius
          (peak-to-peak diameter = 2r); pitch is per-turn rise; h is the
          threaded shank length. The head sits BELOW the shaft so the
          bolt sits flat on the bed head-down. */}
      {obj.type === "bolt" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions ({unitSystem})</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField inUnit="length" testid="dim-bolt-r"     label="Thread ⌀ (M)" value={(obj.dims.r || 5) * 2}      onChange={(v) => updateDims(obj.id, { r: Math.max(0.5, v / 2) })}            step={1} />
            <NumberField inUnit="length" testid="dim-bolt-pitch" label="Pitch"        value={obj.dims.pitch || 1.5}      onChange={(v) => updateDims(obj.id, { pitch: Math.max(0.25, v) })}          step={0.25} suffix="mm/turn" />
            <NumberField inUnit="length" testid="dim-bolt-h"     label="Shank"        value={obj.dims.h || 20}           onChange={(v) => updateDims(obj.id, { h: Math.max(1, v) })}                 step={1} />
            <NumberField inUnit="length" testid="dim-bolt-headD" label="Head ⌀"       value={(obj.dims.headR || 8) * 2}  onChange={(v) => updateDims(obj.id, { headR: Math.max(1, v / 2) })}         step={1} />
            <NumberField inUnit="length" testid="dim-bolt-headH" label="Head height"  value={obj.dims.headH || 4}        onChange={(v) => updateDims(obj.id, { headH: Math.max(0.5, v) })}           step={0.5} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer">
              <input
                data-testid="dim-bolt-head-style"
                type="checkbox"
                checked={obj.dims.headStyle === "button"}
                onChange={(e) => updateDims(obj.id, { headStyle: e.target.checked ? "button" : "hex" })}
                className="accent-orange-500"
              />
              Button head (smooth, not hex)
            </label>
            <div className="text-[10px] text-slate-500 self-center">
              ~M{(((obj.dims.r || 5) * 2) | 0)} × {(((obj.dims.headH || 4) + (obj.dims.h || 20))).toFixed(0)} mm
            </div>
          </div>
        </div>
      )}

      {/* Nut — hex prism with inner thread helix. Pitch MUST match the
          mating bolt or a real bolt won't screw in. flatR is the
          across-flats radius (so AF wrench size = 2 × flatR). */}
      {obj.type === "nut" && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1">Dimensions ({unitSystem})</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField inUnit="length" testid="dim-nut-r"     label="Thread ⌀ (M)" value={(obj.dims.r || 5) * 2}     onChange={(v) => updateDims(obj.id, { r: Math.max(0.5, v / 2) })}     step={1} />
            <NumberField inUnit="length" testid="dim-nut-pitch" label="Pitch"        value={obj.dims.pitch || 1.5}     onChange={(v) => updateDims(obj.id, { pitch: Math.max(0.25, v) })}   step={0.25} suffix="mm/turn" />
            <NumberField inUnit="length" testid="dim-nut-h"     label="Height"       value={obj.dims.h || 5}           onChange={(v) => updateDims(obj.id, { h: Math.max(0.5, v) })}        step={0.5} />
            <NumberField inUnit="length" testid="dim-nut-flatR" label="A/F width"    value={(obj.dims.flatR || 8) * 2} onChange={(v) => updateDims(obj.id, { flatR: Math.max(1, v / 2) })}  step={1} suffix="mm" />
          </div>
          <div className="mt-1 text-[10px] text-slate-500 leading-snug">
            Pitch must match the mating bolt. Add a negative cylinder &amp; Boolean-subtract for a real bore.
          </div>
        </div>
      )}

      {/* Spline — splined shaft. The Inspector accepts both `width` (chord
          on outer surface, mm) and `angle` (per-tooth angular span, deg).
          They're two views of the same dimension: width = 2·R·sin(deg/2).
          When a width value can't be accommodated (because N teeth at
          that width would exceed the cylinder's circumference), we
          surface a "nearest fit" dialog so the user can pick a count
          that satisfies the constraint. */}
      {obj.type === "spline" && (
        <SplineInspectorBlock obj={obj} updateDims={updateDims} />
      )}

      {/* Sweep — profile-along-path extrusion. The block surfaces the two
          compound descriptors (profile, path) as switchable sub-panels so
          the user only sees fields that apply to the currently-selected
          kind (helix vs arc vs bezier vs sketched curve). */}
      {obj.type === "sweep" && (
        <SweepInspectorBlock obj={obj} updateDims={updateDims} />
      )}

      {obj.type === "text" && (
        <TextInspectorBlock obj={obj} updateDims={updateDims} />
      )}

      {(obj.type === "circle" || obj.type === "square2d" || obj.type === "triangle" || obj.type === "polygon") && (
        <Shape2DControls obj={obj} updateDims={updateDims} NumberField={NumberField} />
      )}

      {/* Reverse-Engineer was removed in iter-111.4 — see CHANGELOG. */}
    </Section>
  );
}

// ---------- Edge controls: chamfer / fillet for cube + cylinder ----------
// Now supports sub-element selection (Item / Face / Edge / Vertex). The
// "Item" mode is the legacy uniform path that writes to obj.dims
// {edgeStyle, edgeRadius}; the other modes write per-edge entries into
// obj.edgeFillets, consumed by the partial-fillet engine.

// ---------- 2D shape controls + ExtrudePresets ----------
// Extracted to /components/inspector/Shape2DControls.jsx in iter-114 as
// part of the RightPanel breakdown. See that file for the implementation.


function StatsSection() {
  const objects = useScene((s) => s.objects);
  const measurements = useScene((s) => s.measurements);
  const clearMeasurements = useScene((s) => s.clearMeasurements);
  const visibles = objects.filter((o) => o.visible);
  const positives = visibles.filter((o) => o.modifier !== "negative").length;
  const negatives = visibles.filter((o) => o.modifier === "negative").length;
  return (
    <Section title="Scene" icon={Sigma} testid="scene-stats">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-mono">
        <span className="text-slate-500">Components</span>
        <span className="text-slate-200 text-right">{objects.length}</span>
        <span className="text-slate-500">Positive</span>
        <span className="text-orange-400 text-right">{positives}</span>
        <span className="text-slate-500">Negative</span>
        <span className="text-cyan-400 text-right">{negatives}</span>
        <span className="text-slate-500">Measurements</span>
        <span className="text-slate-200 text-right">{measurements.length}</span>
      </div>
      {measurements.length > 0 && (
        <button
          data-testid="clear-measurements-btn"
          onClick={clearMeasurements}
          className="h-7 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
        >
          Clear measurements
        </button>
      )}
    </Section>
  );
}

export default function RightPanel({ onSavePrinter }) {
  const setCommunity = useScene((s) => s.setCommunityPrinters);
  // Tab persistence — same pattern as LeftPanel. Defaults to "inspect"
  // because that's the most-used view (editing whatever is selected).
  const [tab, setTab] = useState(() => {
    try {
      return window.localStorage.getItem("forge.rightpanel.tab") || "inspect";
    } catch { return "inspect"; }
  });
  const pickTab = (t) => {
    setTab(t);
    try { window.localStorage.setItem("forge.rightpanel.tab", t); } catch { /* noop */ }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await printersApi.list();
        if (!cancelled) setCommunity(list);
      } catch (_) { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [setCommunity]);

  // Tab definitions — keep them tiny so adding a new pane is a one-line
  // edit. The Health tab badges turn amber when there's a real issue so
  // the user notices even when they're parked on another tab.
  const TABS = [
    { id: "inspect", label: "Inspect", icon: Sliders,  title: "Selected object editor + scene stats" },
    { id: "print",   label: "Print",   icon: Factory,  title: "Printer & filament profile, build-volume warnings" },
    { id: "health",  label: "Health",  icon: ShieldAlert, title: "Manifold / watertight checks for the current scene" },
  ];

  return (
    <aside className="w-72 flex-shrink-0 border-l border-slate-800 bg-slate-900 flex flex-col h-full overflow-hidden" data-testid="right-panel">
      {/* ---- Tab strip (matches LeftPanel pattern) ---- */}
      <div className="flex-shrink-0 flex border-b border-slate-800 bg-slate-950/40" data-testid="rightpanel-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              data-testid={`rightpanel-tab-${t.id}`}
              onClick={() => pickTab(t.id)}
              title={t.title}
              className={`flex-1 h-10 text-[10px] font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                active
                  ? "border-orange-500 text-orange-300 bg-orange-500/5"
                  : "border-transparent text-slate-400 hover:text-white hover:bg-slate-800/40"
              }`}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ---- Active tab body ---- */}
      <div className="flex-1 overflow-y-auto" data-testid={`rightpanel-body-${tab}`}>
        {tab === "inspect" && (
          <>
            <Inspector />
            <StatsSection />
          </>
        )}
        {tab === "print" && (
          <>
            <ProfileSection onSavePrinter={onSavePrinter} />
            <CompatibilityWarning />
          </>
        )}
        {tab === "health" && (
          <>
            <ManifoldHealth />
            <CompatibilityWarning />
          </>
        )}
      </div>
    </aside>
  );
}

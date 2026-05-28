// Sweep Inspector block.
//
// Surfaces the Sweep primitive's two compound descriptors — PROFILE
// (what's swept) and PATH (the 3D curve) — as separate, switchable
// sub-panels. Each sub-panel renders the right input fields for the
// currently-selected `kind` (helix vs arc vs bezier, etc.) so the
// user never sees fields that don't apply.
//
// Live-editable: every change calls `updateDims(...)` which triggers
// a buildGeometry → triangle rebuild on the next frame. The geometry
// build is fast enough at the default sample count (96) that re-baking
// on every keystroke feels instant — same UX as the Spline block.
//
// `kind: "ref"` lets the sweep ride another object's centerline (e.g.
// drape a rectangular profile around an existing helix). The dropdown
// is populated from the scene's helix + sweep objects (the only types
// whose centerline we know how to extract today). Refs to other types
// fall back to a placeholder cube at geometry build time — they're
// listed so the user knows the option exists, with a small disabled-
// state hint that tells them which types are pickable.
import React from "react";
import { Waves } from "lucide-react";
import { NumberField } from "./popovers/PopoverShell";
import { useScene } from "../lib/store";

const PROFILE_KINDS = [
  { id: "circle",  label: "Circle",     hint: "Smooth round profile (tubes, springs, cables)" },
  { id: "rect",    label: "Rectangle",  hint: "Right-angled profile (belts, rails, gaskets)" },
  { id: "polygon", label: "Polygon",    hint: "N-sided profile (hex bars, screws)" },
  { id: "sketch",  label: "Sketch",     hint: "Use a hand-drawn 2D shape (advanced)" },
];

const PATH_KINDS = [
  { id: "helix",    label: "Helix",      hint: "Coil — radius / pitch / turns" },
  { id: "arc",      label: "Arc",        hint: "Planar arc — radius / sweep angle" },
  { id: "bezier",   label: "Bezier",     hint: "Cubic curve through 4 control points" },
  { id: "sketch3d", label: "Sketch 3D",  hint: "Polyline you provide (advanced)" },
  { id: "ref",      label: "From Object", hint: "Ride an existing helix's centerline" },
];

export default function SweepInspectorBlock({ obj, updateDims }) {
  const d = obj.dims || {};
  const profile = d.profile || { kind: "circle", r: 2, segments: 16 };
  const path = d.path || { kind: "helix", r: 12, pitch: 6, turns: 3 };
  const scene = useScene((s) => s.objects);

  // Update sub-dict helpers — they merge instead of clobber so an
  // edit to one field doesn't drop the others.
  const setProfile = (patch) => updateDims({ profile: { ...profile, ...patch } });
  const setPath = (patch) => updateDims({ path: { ...path, ...patch } });

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
        <Waves size={11} /> Sweep
      </div>

      {/* Common controls — affect every kind */}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          testid="sweep-samples"
          label="Samples"
          value={d.samples ?? 96}
          onChange={(v) => updateDims({ samples: Math.max(8, Math.min(512, Math.round(v))) })}
          min={8}
          max={512}
          step={4}
          title="Path resolution — more samples = smoother curve at higher tri count"
        />
        <NumberField
          testid="sweep-twist"
          label="Twist°"
          value={d.twistDeg ?? 0}
          onChange={(v) => updateDims({ twistDeg: v })}
          step={5}
          title="Total twist of the profile around the path tangent over the sweep"
        />
      </div>

      {/* ----- Profile ----- */}
      <div className="rounded border border-slate-800 bg-slate-950 px-2 py-2">
        <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Profile</label>
        <select
          data-testid="sweep-profile-kind"
          value={profile.kind}
          onChange={(e) => {
            // Switch kind: stamp sensible defaults for the new kind.
            const k = e.target.value;
            if (k === "circle") setProfile({ kind: "circle", r: 2, segments: 16 });
            else if (k === "rect") setProfile({ kind: "rect", w: 6, h: 4 });
            else if (k === "polygon") setProfile({ kind: "polygon", r: 4, sides: 6 });
            else if (k === "sketch") setProfile({ kind: "sketch", points: profile.points || null });
          }}
          className="w-full h-7 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 px-1.5 mb-1.5"
        >
          {PROFILE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <div className="text-[10px] text-slate-500 mb-2 leading-tight" data-testid="sweep-profile-hint">
          {PROFILE_KINDS.find((k) => k.id === profile.kind)?.hint}
        </div>
        {profile.kind === "circle" && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField testid="sweep-prof-r" label="r" value={profile.r ?? 2} onChange={(v) => setProfile({ r: Math.max(0.1, v) })} min={0.1} step={0.5} />
            <NumberField testid="sweep-prof-segs" label="segs" value={profile.segments ?? 16} onChange={(v) => setProfile({ segments: Math.max(6, Math.min(64, Math.round(v))) })} min={6} max={64} step={2} />
          </div>
        )}
        {profile.kind === "rect" && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField testid="sweep-prof-w" label="w" value={profile.w ?? 6} onChange={(v) => setProfile({ w: Math.max(0.1, v) })} min={0.1} step={0.5} />
            <NumberField testid="sweep-prof-h" label="h" value={profile.h ?? 4} onChange={(v) => setProfile({ h: Math.max(0.1, v) })} min={0.1} step={0.5} />
          </div>
        )}
        {profile.kind === "polygon" && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField testid="sweep-prof-r" label="r" value={profile.r ?? 4} onChange={(v) => setProfile({ r: Math.max(0.1, v) })} min={0.1} step={0.5} />
            <NumberField testid="sweep-prof-sides" label="sides" value={profile.sides ?? 6} onChange={(v) => setProfile({ sides: Math.max(3, Math.min(64, Math.round(v))) })} min={3} max={64} step={1} />
          </div>
        )}
        {profile.kind === "sketch" && (
          <div className="text-[10px] text-amber-400" data-testid="sweep-prof-sketch-hint">
            Draw a closed 2D shape in Sketch mode (Tools→Sketch), then choose "Use as sweep profile" from its context menu. (UI hook in next iteration — for now this kind is a no-op.)
          </div>
        )}
      </div>

      {/* ----- Path ----- */}
      <div className="rounded border border-slate-800 bg-slate-950 px-2 py-2">
        <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Path</label>
        <select
          data-testid="sweep-path-kind"
          value={path.kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === "helix") setPath({ kind: "helix", r: 12, pitch: 6, turns: 3 });
            else if (k === "arc") setPath({ kind: "arc", r: 20, angleDeg: 180 });
            else if (k === "bezier") setPath({ kind: "bezier", p0: [-20, 0, 0], c1: [-10, 20, 0], c2: [10, 20, 0], p1: [20, 0, 0] });
            else if (k === "sketch3d") setPath({ kind: "sketch3d", points: path.points || null });
            else if (k === "ref") setPath({ kind: "ref", objectId: null });
          }}
          className="w-full h-7 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 px-1.5 mb-1.5"
        >
          {PATH_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <div className="text-[10px] text-slate-500 mb-2 leading-tight" data-testid="sweep-path-hint">
          {PATH_KINDS.find((k) => k.id === path.kind)?.hint}
        </div>
        {path.kind === "helix" && (
          <div className="grid grid-cols-3 gap-2">
            <NumberField testid="sweep-path-r" label="r" value={path.r ?? 12} onChange={(v) => setPath({ r: Math.max(0.1, v) })} min={0.1} step={1} />
            <NumberField testid="sweep-path-pitch" label="pitch" value={path.pitch ?? 6} onChange={(v) => setPath({ pitch: Math.max(0.1, v) })} min={0.1} step={0.5} />
            <NumberField testid="sweep-path-turns" label="turns" value={path.turns ?? 3} onChange={(v) => setPath({ turns: Math.max(0.1, v) })} min={0.1} step={0.5} />
          </div>
        )}
        {path.kind === "arc" && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField testid="sweep-path-r" label="r" value={path.r ?? 20} onChange={(v) => setPath({ r: Math.max(0.1, v) })} min={0.1} step={1} />
            <NumberField testid="sweep-path-ang" label="angle°" value={path.angleDeg ?? 180} onChange={(v) => setPath({ angleDeg: v })} step={5} />
          </div>
        )}
        {path.kind === "bezier" && (
          <BezierControls path={path} setPath={setPath} />
        )}
        {path.kind === "sketch3d" && (
          <div className="text-[10px] text-amber-400" data-testid="sweep-path-sketch3d-hint">
            Polyline-from-sketch input is coming next iteration. For now: pick a different path kind.
          </div>
        )}
        {path.kind === "ref" && (
          <RefPicker path={path} setPath={setPath} scene={scene} currentId={obj.id} />
        )}
      </div>
    </div>
  );
}

// Bezier control-point editor — surfaces 4 × Vec3 inputs in a compact
// grid. Defensive: clamps to numbers, skips updates on NaN.
function BezierControls({ path, setPath }) {
  const labels = ["p0", "c1", "c2", "p1"];
  const keys = ["p0", "c1", "c2", "p1"];
  const set = (key, axis, val) => {
    if (!Number.isFinite(val)) return;
    const cur = path[key] || [0, 0, 0];
    const next = [...cur];
    next[axis] = val;
    setPath({ [key]: next });
  };
  return (
    <div className="space-y-1.5">
      {keys.map((k, i) => {
        const p = path[k] || [0, 0, 0];
        return (
          <div key={k} className="grid grid-cols-4 gap-1.5 items-center">
            <div className="text-[10px] text-slate-500 font-mono">{labels[i]}</div>
            <NumberField testid={`sweep-bz-${k}-x`} label="" value={p[0]} onChange={(v) => set(k, 0, v)} step={1} />
            <NumberField testid={`sweep-bz-${k}-y`} label="" value={p[1]} onChange={(v) => set(k, 1, v)} step={1} />
            <NumberField testid={`sweep-bz-${k}-z`} label="" value={p[2]} onChange={(v) => set(k, 2, v)} step={1} />
          </div>
        );
      })}
    </div>
  );
}

// Object picker for `kind:"ref"`. Lists every helix and (non-self) sweep
// in the scene; disables itself if there's nothing pickable so the
// user knows why.
function RefPicker({ path, setPath, scene, currentId }) {
  const pickable = (scene || []).filter((o) =>
    (o.type === "helix" || o.type === "sweep") && o.id !== currentId
  );
  if (pickable.length === 0) {
    return (
      <div className="text-[10px] text-amber-400" data-testid="sweep-ref-empty">
        No helix or sweep objects in the scene to ride. Add a Helix (or another Sweep with a helix path) and it'll show up here.
      </div>
    );
  }
  return (
    <select
      data-testid="sweep-ref-pick"
      value={path.objectId || ""}
      onChange={(e) => setPath({ objectId: e.target.value || null })}
      className="w-full h-7 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 px-1.5"
    >
      <option value="">— pick an object —</option>
      {pickable.map((o) => (
        <option key={o.id} value={o.id}>{o.name} ({o.type})</option>
      ))}
    </select>
  );
}

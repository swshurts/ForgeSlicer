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

// Curated SWEEP PRESETS — each card writes a complete `dims` payload
// so one click promotes a generic helical-spring sweep into a finished
// shape. Tuned to be visually distinct, mechanically useful, and to
// showcase what every (profile × path) combination can do.
//
// Format: `apply` is called with `(updateDims)` and must overwrite the
// FULL dims dict (samples + twist + profile + path) so the preset
// isn't contaminated by leftover fields from the previous descriptor.
const SWEEP_PRESETS = [
  {
    id: "helical-spring",
    label: "Helical spring",
    hint: "Circular wire wound 4 turns",
    apply: () => ({
      samples: 128, twistDeg: 0,
      profile: { kind: "circle", r: 1.5, segments: 16 },
      path:    { kind: "helix", r: 12, pitch: 5, turns: 4 },
    }),
  },
  {
    id: "watch-spring",
    label: "Watch spring",
    hint: "Thin flat ribbon wound tight",
    apply: () => ({
      samples: 200, twistDeg: 0,
      profile: { kind: "rect", w: 4, h: 0.4 },
      path:    { kind: "helix", r: 18, pitch: 1.2, turns: 8 },
    }),
  },
  {
    id: "twisted-cable",
    label: "Twisted cable",
    hint: "Square profile twisted 360° along an arc",
    apply: () => ({
      samples: 160, twistDeg: 360,
      profile: { kind: "polygon", r: 2.5, sides: 4 },
      path:    { kind: "arc", r: 30, angleDeg: 270 },
    }),
  },
  {
    id: "corkscrew",
    label: "Corkscrew",
    hint: "Triangular profile, deep pitch, double-twist",
    apply: () => ({
      samples: 192, twistDeg: 720,
      profile: { kind: "polygon", r: 2, sides: 3 },
      path:    { kind: "helix", r: 8, pitch: 10, turns: 3 },
    }),
  },
  {
    id: "rope",
    label: "Rope",
    hint: "Pentagon profile, gentle 180° twist along an S-bezier",
    apply: () => ({
      samples: 160, twistDeg: 180,
      profile: { kind: "polygon", r: 3, sides: 5 },
      path:    { kind: "bezier", p0: [-30, 0, 0], c1: [-10, 25, -10], c2: [10, -25, 10], p1: [30, 0, 0] },
    }),
  },
  {
    id: "hex-bar",
    label: "Hex bar arc",
    hint: "Hex profile bent around a quarter-circle (handle / bracket)",
    apply: () => ({
      samples: 64, twistDeg: 0,
      profile: { kind: "polygon", r: 4, sides: 6 },
      path:    { kind: "arc", r: 25, angleDeg: 90 },
    }),
  },
  {
    id: "spiral-staircase",
    label: "Spiral railing",
    hint: "Square profile spiraling up — for railings / DNA models",
    apply: () => ({
      samples: 224, twistDeg: 0,
      profile: { kind: "rect", w: 1.5, h: 1.5 },
      path:    { kind: "helix", r: 14, pitch: 8, turns: 5 },
    }),
  },
  {
    id: "tornado",
    label: "Tornado funnel",
    hint: "Decorative helix that widens via outer-rim profile",
    apply: () => ({
      samples: 192, twistDeg: 0,
      profile: { kind: "circle", r: 4, segments: 12 },
      path:    { kind: "helix", r: 20, pitch: 12, turns: 2 },
    }),
  },
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

      {/* Preset library — one click rewrites the FULL dims payload to a
          curated combo. The dropdown labels include a one-line "hint" so
          the user can pick by intent ("rope", "watch spring") instead of
          guessing what each profile×path combination does. */}
      <div className="rounded border border-orange-500/30 bg-orange-500/5 px-2 py-2">
        <label className="text-[10px] uppercase tracking-wider text-orange-400 block mb-1">Preset library</label>
        <select
          data-testid="sweep-preset-picker"
          value=""
          onChange={(e) => {
            const preset = SWEEP_PRESETS.find((p) => p.id === e.target.value);
            if (!preset) return;
            // Apply rewrites the whole dims payload. We then reset the
            // <select>'s value so the same preset can be re-picked
            // after the user has tweaked away from it.
            updateDims(preset.apply());
            e.target.value = "";
          }}
          className="w-full h-7 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 px-1.5"
        >
          <option value="">— Apply a preset… —</option>
          {SWEEP_PRESETS.map((p) => (
            <option key={p.id} value={p.id} title={p.hint}>{p.label}</option>
          ))}
        </select>
        <div className="text-[10px] text-slate-500 mt-1 leading-tight">
          Tweak any preset using the controls below — your edits stay.
        </div>
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
          <SketchProfileControls profile={profile} setProfile={setProfile} />
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
          <Sketch3DPathControls path={path} setPath={setPath} />
        )}
        {path.kind === "ref" && (
          <RefPicker path={path} setPath={setPath} scene={scene} currentId={obj.id} />
        )}
      </div>
    </div>
  );
}

// Sketch-profile picker — lets the user pull the points from any
// existing `sketch` object in the scene. The picker is the same UX
// pattern as RefPicker below, but for 2D profiles instead of 3D
// centerlines. Shows a point-count badge once a sketch is wired up
// so the user can confirm the link works.
function SketchProfileControls({ profile, setProfile }) {
  const scene = useScene((s) => s.objects);
  const sketches = (scene || []).filter((o) => o.type === "sketch" && Array.isArray(o.dims?.points) && o.dims.points.length >= 3);
  const pointCount = Array.isArray(profile.points) ? profile.points.length : 0;
  if (sketches.length === 0 && pointCount === 0) {
    return (
      <div className="text-[10px] text-amber-400" data-testid="sweep-prof-sketch-empty">
        Draw a closed 2D shape in Sketch mode (toolbar → Sketch), then either right-click it and choose "Use sketch as Sweep profile", or come back here and pick it from this list.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <select
        data-testid="sweep-prof-sketch-pick"
        value=""
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          const src = sketches.find((o) => o.id === id);
          if (!src) return;
          setProfile({ points: src.dims.points.map(([x, y]) => [x, y]) });
          e.target.value = "";
        }}
        className="w-full h-7 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 px-1.5"
      >
        <option value="">{pointCount > 0 ? `— Re-link to a sketch (${pointCount} pts loaded) —` : "— Pick a sketch —"}</option>
        {sketches.map((o) => (
          <option key={o.id} value={o.id}>{o.name} ({o.dims.points.length} pts)</option>
        ))}
      </select>
      {pointCount > 0 && (
        <div className="text-[10px] text-slate-500" data-testid="sweep-prof-sketch-count">
          Profile: {pointCount} points (centered on its own centroid before sweeping).
        </div>
      )}
    </div>
  );
}

// Sketch3D path controls — pull a 3D polyline from a 2D `sketch` object
// in the scene (Y starts at 0) and let the user redistribute Y across the
// points using a single "Rise" field. Rise applies a linear ramp so the
// first point stays at 0 and the last point ends up at `rise`. This is
// the simplest authoring affordance that still produces interesting 3D
// paths (helical-staircase-like sweeps).
function Sketch3DPathControls({ path, setPath }) {
  const scene = useScene((s) => s.objects);
  const sketches = (scene || []).filter((o) => o.type === "sketch" && Array.isArray(o.dims?.points) && o.dims.points.length >= 2);
  const pointCount = Array.isArray(path.points) ? path.points.length : 0;
  const rise = Number.isFinite(path.rise) ? path.rise : 0;

  const linkSketch = (id) => {
    const src = sketches.find((o) => o.id === id);
    if (!src) return;
    const n = src.dims.points.length;
    const pts3D = src.dims.points.map(([x, z], i) => [
      x,
      n > 1 ? (i / (n - 1)) * rise : 0,
      z,
    ]);
    setPath({ points: pts3D });
  };
  const setRise = (newRise) => {
    const pts = Array.isArray(path.points) ? path.points : [];
    if (pts.length < 2) { setPath({ rise: newRise }); return; }
    const n = pts.length;
    // Preserve XZ — just redistribute Y linearly from 0 → newRise.
    const next = pts.map(([x, _y, z], i) => [x, (i / (n - 1)) * newRise, z]);
    setPath({ points: next, rise: newRise });
  };

  if (sketches.length === 0 && pointCount === 0) {
    return (
      <div className="text-[10px] text-amber-400" data-testid="sweep-path-sketch3d-empty">
        Draw a 2D polyline in Sketch mode (toolbar → Sketch · Pencil), then either right-click it and choose "Use sketch as Sweep path (3D)", or come back here and pick it from this list.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <select
        data-testid="sweep-path-sketch3d-pick"
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          linkSketch(e.target.value);
          e.target.value = "";
        }}
        className="w-full h-7 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 px-1.5"
      >
        <option value="">{pointCount > 0 ? `— Re-link to a sketch (${pointCount} pts loaded) —` : "— Pick a sketch —"}</option>
        {sketches.map((o) => (
          <option key={o.id} value={o.id}>{o.name} ({o.dims.points.length} pts)</option>
        ))}
      </select>
      {pointCount > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              testid="sweep-path-sketch3d-rise"
              label="Rise (mm)"
              value={rise}
              onChange={(v) => setRise(Number.isFinite(v) ? v : 0)}
              step={1}
              title="Linear ramp on the Y axis — first point stays at 0, last point ends at this height. Use 0 for a flat (planar) path."
            />
            <div className="text-[10px] text-slate-500 self-center" data-testid="sweep-path-sketch3d-count">
              {pointCount} polyline points
            </div>
          </div>
        </>
      )}
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

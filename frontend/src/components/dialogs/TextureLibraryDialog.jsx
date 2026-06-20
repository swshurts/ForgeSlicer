// Texture Library dialog — pick a geometric texture pattern + tuning
// params, then drop it onto the build plate as a single positive (or
// negative) primitive. Same lifecycle as any other primitive — the
// user can move/rotate/scale it after, and union/subtract it against
// a target via the standard CSG boolean tools.
//
// V1 patterns:  Knurl (diamond), Hex grid, Bumps, Ridges (linear).
// V2 backlog:   Diamond plate, brick, fabric weave, hex camo, voronoi.
//
// Why a separate dialog instead of a Composites grid card? The
// parameter surface (pattern + 5 numeric dims + apply mode) is too
// dense for inline buttons. A dialog gives us room for the per-
// pattern hint text + a live "preview footprint" callout.
import React, { useState } from "react";
import { Layers, X, BookOpen } from "lucide-react";
import * as THREE from "three";
import { useScene } from "../../lib/store";
import { TEXTURE_PATTERNS, wrapTextureForTarget, targetSupportsSurfaceWrap } from "../../lib/textureGeometry";
import { computeRotatedBBox } from "../../lib/geometry";
import { combineTwoAsync } from "../../lib/manifoldEngine";

// Face → outward unit normal in the target's WORLD frame.
// (Local & world coincide once the target's rotation is applied
// because the target's bbox we read is already rotation-aware.)
const FACE_NORMALS = {
  top:    [0, 0,  1],
  bottom: [0, 0, -1],
  front:  [0, -1, 0],
  back:   [0,  1, 0],
  left:   [-1, 0, 0],
  right:  [ 1, 0, 0],
};

export default function TextureLibraryDialog({ open, onClose, targetObjectId = null }) {
  const addPrimitive = useScene((s) => s.addPrimitive);
  const updateDims = useScene((s) => s.updateDims);
  const updateObject = useScene((s) => s.updateObject);
  const objects = useScene((s) => s.objects);
  const selectedId = useScene((s) => s.selectedId);
  const replaceObjects = useScene((s) => s.replaceObjects);
  const selectObject = useScene((s) => s.selectObject);
  // If no explicit target was passed, fall back to the user's current
  // selection — that's almost always what they mean when they pop the
  // Texture dialog from the AI tab while a part is highlighted.
  const effectiveTargetId = targetObjectId || selectedId;
  const target = effectiveTargetId ? objects.find((o) => o.id === effectiveTargetId) : null;

  // Defaults: pick the first pattern + its tuning defaults.
  const [pattern, setPattern] = useState(TEXTURE_PATTERNS[0].id);
  const [w, setW] = useState(30);
  const [d, setD] = useState(30);
  const [tileSize, setTileSize] = useState(TEXTURE_PATTERNS[0].defaults.tileSize);
  const [height, setHeight] = useState(TEXTURE_PATTERNS[0].defaults.height);
  const [depth, setDepth] = useState(0.8);
  const [modifier, setModifier] = useState("positive");
  const [face, setFace] = useState("top");
  const [wrap, setWrap] = useState("flat");
  const [wrapRadius, setWrapRadius] = useState(0);
  // iter-105.3 — surface-wrap mode. Default to "whole" when the target's
  // type supports a per-vertex displacement wrap (sphere/cylinder/cone/cube).
  // Otherwise fall back to single-face (the only thing that makes sense
  // for an imported mesh / torus / etc. in v1).
  const supportsWrap = targetSupportsSurfaceWrap(target);
  const [applyMode, setApplyMode] = useState(supportsWrap ? "whole" : "face");
  // Auto-merge (default ON when a target is set) — drops the texture
  // pre-aligned on the chosen face AND immediately runs the boolean,
  // so the user gets a knurled / engraved part in a single click.
  const [autoMerge, setAutoMerge] = useState(true);
  const [busy, setBusy] = useState(false);
  const selectedPattern = TEXTURE_PATTERNS.find((p) => p.id === pattern) || TEXTURE_PATTERNS[0];

  // When the user picks a NEW target (or opens the dialog with one),
  // reset the apply-mode default to whichever is sensible for them.
  React.useEffect(() => {
    if (!target) return;
    setApplyMode(targetSupportsSurfaceWrap(target) ? "whole" : "face");
  }, [effectiveTargetId, target?.type]);

  // When the pattern changes, snap the tile/height defaults to ones
  // that look reasonable for the new pattern (each kind has different
  // visual density). The user can always override afterward.
  const handlePatternChange = (id) => {
    const p = TEXTURE_PATTERNS.find((x) => x.id === id) || TEXTURE_PATTERNS[0];
    setPattern(id);
    setTileSize(p.defaults.tileSize);
    setHeight(p.defaults.height);
  };

  // When the user picks "Apply to face of <target>", size the texture
  // footprint to the target's AABB on that face (Z-up CAD frame: world
  // X/Y are the bed plane, Z is up).
  const applyToFace = () => {
    if (!target) return;
    let bb;
    try { bb = computeRotatedBBox(target); } catch (_) { return; }
    const ex = bb.max.x - bb.min.x;
    const ey = bb.max.y - bb.min.y;
    const ez = bb.max.z - bb.min.z;
    if (face === "top" || face === "bottom") { setW(ex); setD(ey); }
    else if (face === "front" || face === "back") { setW(ex); setD(ez); }
    else { setW(ey); setD(ez); }
  };

  React.useEffect(() => {
    if (target) applyToFace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, effectiveTargetId]);

  const handleDrop = async () => {
    if (busy) return;
    // Path A: no target — drop the texture as a standalone primitive
    // on the bed and let the user position it manually.
    if (!target) {
      const id = addPrimitive("texture", modifier);
      updateDims(id, { pattern, w, d, tileSize, height, depth, wrap, wrapRadius });
      onClose();
      return;
    }
    // Path A2: target + whole-surface wrap mode. Generate a displaced
    // mesh that IS the bumpy target and REPLACE the target — no boolean
    // pass needed (the displacement is baked into the mesh directly).
    if (applyMode === "whole" && targetSupportsSurfaceWrap(target)) {
      setBusy(true);
      try {
        const wrapped = wrapTextureForTarget(target, {
          pattern, tileSize, height, depth, modifier,
        });
        if (!wrapped) throw new Error("Surface wrap not available for this target type yet");
        const arr = wrapped.attributes.position.array;
        const vertices = new Float32Array(arr);
        const indices = wrapped.index ? new Uint32Array(wrapped.index.array) : null;
        wrapped.computeBoundingBox();
        const bb = wrapped.boundingBox;
        const originalBbox = bb
          ? { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z }
          : null;
        wrapped.dispose();
        replaceObjects([target.id], [{
          name: `${target.name} · ${selectedPattern.label}`,
          type: "imported",
          modifier: target.modifier || "positive",
          visible: true,
          locked: false,
          position: [...target.position],
          rotation: [...target.rotation],
          scale: [1, 1, 1], // displacement already used the target's scale
          dims: {},
          geometry: { vertices, indices },
          originalBbox,
          __skipAutoDrop: true,
        }]);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Surface-wrap texture failed:", e);
        if (typeof window !== "undefined" && window.alert) {
          window.alert("Surface wrap failed: " + (e.message || e));
        }
      } finally {
        setBusy(false);
        onClose();
      }
      return;
    }
    // Path B: target picked + single-face mode (legacy). Compute a
    // world-space pose that lands the texture flush on the target's
    // chosen face with its relief pointing OUTWARD, then optionally
    // run the boolean.
    let bb;
    try { bb = computeRotatedBBox(target); } catch (e) {
      onClose(); return;
    }
    const tp = target.position;
    const centre = [
      tp[0] + (bb.min.x + bb.max.x) / 2,
      tp[1] + (bb.min.y + bb.max.y) / 2,
      tp[2] + (bb.min.z + bb.max.z) / 2,
    ];
    const halfX = (bb.max.x - bb.min.x) / 2;
    const halfY = (bb.max.y - bb.min.y) / 2;
    const halfZ = (bb.max.z - bb.min.z) / 2;
    const n = FACE_NORMALS[face] || FACE_NORMALS.top;
    const facePoint = [
      centre[0] + n[0] * halfX,
      centre[1] + n[1] * halfY,
      centre[2] + n[2] * halfZ,
    ];
    // For a UNION (raised) we want the texture's BASE plate sitting
    // on the face and the relief popping out (along +n). The texture
    // mesh's local origin is at the base, so we push the position OUT
    // by the relief height/2 so the relief crosses the face plane.
    // For a SUBTRACT (engraved) we sink the texture INTO the part by
    // (relief height) so the engrave reaches that depth.
    const reliefOffset = modifier === "positive" ? depth / 2 : -height + depth / 2;
    const pos = [
      facePoint[0] + n[0] * reliefOffset,
      facePoint[1] + n[1] * reliefOffset,
      facePoint[2] + n[2] * reliefOffset,
    ];
    // Rotation: rotate the texture's +Z (relief direction) to align
    // with the face normal `n`.
    const upZ = new THREE.Vector3(0, 0, 1);
    const target_n = new THREE.Vector3(...n);
    const q = new THREE.Quaternion().setFromUnitVectors(upZ, target_n);
    const e = new THREE.Euler().setFromQuaternion(q);
    const rotDeg = [
      THREE.MathUtils.radToDeg(e.x),
      THREE.MathUtils.radToDeg(e.y),
      THREE.MathUtils.radToDeg(e.z),
    ];

    const id = addPrimitive("texture", modifier);
    updateDims(id, { pattern, w, d, tileSize, height, depth, wrap, wrapRadius });
    updateObject(id, { position: pos, rotation: rotDeg });

    if (!autoMerge) {
      // Leave the texture as a free-floating primitive aligned with
      // the face; the user can refine and run the boolean themselves.
      selectObject(id);
      onClose();
      return;
    }

    // Run the boolean against the target. We let the target retain
    // its identity (combineTwoAsync produces a fresh merged mesh and
    // we replace BOTH the target and the texture with the result —
    // same flow as the toolbar's doBool).
    setBusy(true);
    try {
      const texObj = useScene.getState().objects.find((o) => o.id === id);
      const op = modifier === "positive" ? "union" : "subtract";
      const merged = await combineTwoAsync(target, texObj, op);
      let originalBbox = null;
      const verts = merged?.vertices;
      if (verts && verts.length >= 3) {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < verts.length; i += 3) {
          const x = verts[i], y = verts[i + 1], z = verts[i + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
        if (isFinite(minX)) originalBbox = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
      }
      replaceObjects([target.id, id], [{
        name: `${target.name} · ${selectedPattern.label}`,
        type: "imported",
        modifier: "positive",
        visible: true,
        locked: false,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        dims: {},
        geometry: merged,
        originalBbox,
        __skipAutoDrop: true,
      }]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Texture auto-merge failed:", e);
      // Leave the un-merged texture in place so the user can debug
      // visually rather than losing their config silently.
      if (typeof window !== "undefined" && window.alert) {
        window.alert("Texture merge failed: " + (e.message || e));
      }
    } finally {
      setBusy(false);
      onClose();
    }
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="texture-library-dialog"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-w-[94vw] rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-slate-100">Texture Library</h2>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">geometric / printable</span>
          </div>
          <button data-testid="texture-library-close-btn" onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Pattern picker — grid of cards */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-wider text-slate-400">Pattern</label>
              {/* Link to the in-depth PDF tutorial — opens in a new tab so
                  the user doesn't lose their current dialog state. The
                  PDF is regenerated by scripts/build_texture_tutorial.py
                  and lives in frontend/public/docs (served verbatim by
                  the same host as the app). */}
              <a
                data-testid="texture-tutorial-pdf-link"
                href="/docs/ForgeSlicer-Texture-Tutorial.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] uppercase tracking-wider text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
                title="In-depth texture tutorial (10-page PDF)"
              >
                <BookOpen size={11} /> Tutorial PDF
              </a>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {TEXTURE_PATTERNS.map((p) => (
                <button
                  key={p.id}
                  data-testid={`texture-pattern-${p.id}`}
                  onClick={() => handlePatternChange(p.id)}
                  className={`text-left rounded border px-2.5 py-2 transition-all ${
                    pattern === p.id
                      ? "border-orange-500 bg-orange-500/15"
                      : "border-slate-700 bg-slate-950 hover:border-slate-500"
                  }`}
                >
                  <div className={`text-xs font-medium ${pattern === p.id ? "text-orange-300" : "text-slate-200"}`}>
                    {p.label}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{p.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Apply mode */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Apply as</label>
            <div className="flex gap-1.5">
              {[
                { id: "positive", label: "Raised (union)", color: "orange" },
                { id: "negative", label: "Engraved (subtract)", color: "cyan" },
              ].map((m) => (
                <button
                  key={m.id}
                  data-testid={`texture-modifier-${m.id}`}
                  onClick={() => setModifier(m.id)}
                  className={`flex-1 h-8 rounded border text-xs font-medium transition-all ${
                    modifier === m.id
                      ? m.color === "orange"
                        ? "border-orange-500 bg-orange-500/15 text-orange-300"
                        : "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target — Apply mode picker */}
          {target && (
            <div data-testid="texture-target-section" className="space-y-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">
                  Apply to <span className="text-orange-300">{target.name}</span>
                </label>
                <div className="flex gap-2">
                  <button
                    data-testid="texture-mode-whole"
                    onClick={() => setApplyMode("whole")}
                    disabled={!supportsWrap}
                    title={supportsWrap ? "" : "Whole-surface wrap not supported for this primitive yet — coming in v2."}
                    className={`flex-1 h-9 rounded border text-[11px] font-medium transition-all ${
                      applyMode === "whole"
                        ? "border-orange-500 bg-orange-500/15 text-orange-300"
                        : supportsWrap
                        ? "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                        : "border-slate-800 bg-slate-950 text-slate-600 cursor-not-allowed"
                    }`}
                  >
                    Whole surface{supportsWrap ? "" : " (coming soon)"}
                  </button>
                  <button
                    data-testid="texture-mode-face"
                    onClick={() => setApplyMode("face")}
                    className={`flex-1 h-9 rounded border text-[11px] font-medium transition-all ${
                      applyMode === "face"
                        ? "border-orange-500 bg-orange-500/15 text-orange-300"
                        : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    Single face
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {applyMode === "whole"
                    ? `Bumps wrap the entire ${target.type}'s outer surface. ${target.type === "cylinder" || target.type === "cone" ? "Caps stay flat in v1." : ""}`
                    : "Texture lands on the picked face; the rest of the part stays smooth."}
                </div>
              </div>

              {applyMode === "face" && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Face</div>
                  <div className="flex flex-wrap gap-1.5">
                    {["top", "bottom", "front", "back", "left", "right"].map((f) => (
                      <button
                        key={f}
                        data-testid={`texture-face-${f}`}
                        onClick={() => setFace(f)}
                        className={`h-7 px-2.5 rounded border text-[11px] font-medium transition-all capitalize ${
                          face === f
                            ? "border-orange-500 bg-orange-500/15 text-orange-300"
                            : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <label
                    data-testid="texture-auto-merge"
                    className="mt-2 flex items-start gap-2 cursor-pointer text-[11px] text-slate-300 select-none"
                  >
                    <input
                      type="checkbox"
                      checked={autoMerge}
                      onChange={(e) => setAutoMerge(e.target.checked)}
                      className="mt-0.5 accent-orange-500"
                    />
                    <span>
                      <span className="font-medium text-slate-200">Bake into the part on drop</span>
                      <span className="block text-[10px] text-slate-500 mt-0.5 leading-tight">
                        Auto-runs the {modifier === "positive" ? "union" : "subtract"} so the texture becomes part of <span className="text-orange-300">{target.name}</span>'s mesh.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Numeric controls */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Footprint & relief</label>
            <div className="grid grid-cols-3 gap-2">
              <NumField testid="texture-w" label="W (mm)" value={w} onChange={setW} min={1} />
              <NumField testid="texture-d" label="D (mm)" value={d} onChange={setD} min={1} />
              <NumField testid="texture-tilesize" label="tile (mm)" value={tileSize} onChange={setTileSize} min={0.5} step={0.5} />
              <NumField testid="texture-height" label="height (mm)" value={height} onChange={setHeight} min={0.2} step={0.2} />
              <NumField testid="texture-depth" label="plate (mm)" value={depth} onChange={setDepth} min={0.4} step={0.2} />
            </div>
            <div className="text-[10px] text-slate-500 mt-1.5 leading-tight">
              <b className="text-slate-400">tile</b>: pattern periodicity. <b className="text-slate-400">height</b>: relief depth above the base. <b className="text-slate-400">plate</b>: base-plate thickness — keep at least 0.4mm so subtractive overlap won't leave manifold gaps.
            </div>
          </div>

          {/* Wrap mode — turns a flat tile into a cylindrical wrap for
              real-world grips (knurled flashlight bodies, hex-paneled
              cylinders). Sphere wrap is V2 backlog. */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Wrap to surface</label>
            <div className="flex gap-1.5 mb-1.5">
              {[
                { id: "flat", label: "Flat" },
                { id: "cylinder", label: "Cylinder" },
              ].map((m) => (
                <button
                  key={m.id}
                  data-testid={`texture-wrap-${m.id}`}
                  onClick={() => setWrap(m.id)}
                  className={`flex-1 h-7 rounded border text-[11px] font-medium transition-all ${
                    wrap === m.id
                      ? "border-orange-500 bg-orange-500/15 text-orange-300"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {wrap === "cylinder" && (
              <div>
                <NumField
                  testid="texture-wrap-radius"
                  label="Cylinder radius (mm) · 0 = auto-fit"
                  value={wrapRadius}
                  onChange={setWrapRadius}
                  min={0}
                  step={1}
                />
                <div className="text-[10px] text-slate-500 mt-1 leading-tight">
                  Wraps the X axis around a cylinder of this radius. Auto = w/(2π) so the texture tiles seamlessly once around.
                </div>
              </div>
            )}
          </div>

          {/* Live summary */}
          <div className="rounded border border-slate-800 bg-slate-950 p-2 text-[11px] font-mono text-slate-400" data-testid="texture-preview">
            {selectedPattern.label} · {w}×{d}mm · tile {tileSize}mm · {modifier === "positive" ? `+${height}mm raised` : `-${height}mm engraved`} · base {depth}mm
          </div>

          <button
            data-testid="texture-drop-btn"
            onClick={handleDrop}
            disabled={busy}
            className="w-full h-9 rounded bg-orange-500 hover:bg-orange-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-950 text-sm font-semibold transition-colors"
          >
            {busy ? "Working…" : target
              ? (applyMode === "whole"
                  ? `Wrap whole ${target.type}`
                  : (autoMerge ? `Apply to ${face} face & bake` : `Drop on ${face} face`))
              : "Drop on plate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Small numeric field — clamped, no overflow. Defined inline because
// the popover variant lives in PopoverShell and we don't need its full
// drag-affordance behavior here (the dialog is keyboard-focused).
function NumField({ testid, label, value, onChange, min = 0, step = 1 }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
      <input
        data-testid={testid}
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n >= min) onChange(n);
        }}
        className="h-7 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-slate-200"
      />
    </div>
  );
}

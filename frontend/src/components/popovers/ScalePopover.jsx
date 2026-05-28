// Scale / Real Size popover — two-column editor letting the user pick
// either a percent factor or an absolute mm size per axis. The aspect
// lock checkbox is OFF by default; most users want per-axis editing and
// the lock surprises people by silently updating Y/Z when X changes.
// The lock pref persists to localStorage so an opt-in survives reloads.
import React, { useState } from "react";
import { Scale3D, Lock, Unlock } from "lucide-react";
import { useScene } from "../../lib/store";
import { getBaseSize } from "../../lib/geometry";
import { PopoverShell, NumberField, EmptyMsg } from "./PopoverShell";

const SCALE_LOCK_KEY = "forgeslicer.scaleLockAspect";
function readLockPref() {
  // Default OFF — most users want per-axis editing. The lock surprises
  // people by silently updating Y/Z when X changes (and vice versa). They
  // can opt in via the checkbox; the choice is persisted to localStorage.
  // Note: only a "0"/"1" UI pref — no sensitive data — so the generic
  // "insecure localStorage" lint warning doesn't apply.
  try {
    const v = localStorage.getItem(SCALE_LOCK_KEY);
    return v === "1";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("readLockPref failed:", err);
    return false;
  }
}
function writeLockPref(v) {
  try { localStorage.setItem(SCALE_LOCK_KEY, v ? "1" : "0"); }
  catch (err) {
    // eslint-disable-next-line no-console
    console.warn("writeLockPref failed:", err);
  }
}

export function ScalePopover({ anchor, onClose }) {
  const selectedId = useScene((s) => s.selectedId);
  const selectedIds = useScene((s) => s.selectedIds);
  const objects = useScene((s) => s.objects);
  const setTransformWithHistory = useScene((s) => s.setTransformWithHistory);
  const scaleSelectedMul = useScene((s) => s.scaleSelectedMul);
  const obj = objects.find((o) => o.id === selectedId);
  const multi = selectedIds && selectedIds.length > 1;
  const [locked, setLockedState] = useState(readLockPref);
  const setLocked = (v) => { setLockedState(v); writeLockPref(v); };

  const base = obj ? getBaseSize(obj) : { x: 1, y: 1, z: 1 };
  const baseArr = [base.x || 1, base.y || 1, base.z || 1];

  const applyScale = (newScale) => {
    if (!obj) return;
    if (multi) {
      // Multi-select: convert the absolute new-scale into a multi-
      // plicative factor relative to the primary's current scale, then
      // apply to the whole selection so the assembly grows / shrinks
      // as one rigid unit (members spread/contract around the primary).
      const factor = [
        obj.scale[0] ? newScale[0] / obj.scale[0] : 1,
        obj.scale[1] ? newScale[1] / obj.scale[1] : 1,
        obj.scale[2] ? newScale[2] / obj.scale[2] : 1,
      ];
      scaleSelectedMul(factor);
    } else {
      setTransformWithHistory(obj.id, "scale", newScale);
    }
  };

  const setPercent = (axis, percentValue) => {
    if (!obj) return;
    if (!Number.isFinite(percentValue) || percentValue <= 0) return;
    const newFactor = percentValue / 100;
    if (locked) {
      // Use the base (scale-=-1) size as the anchor so the lock keeps
      // working even if some axis got knocked to 0 by an earlier edit.
      const ns = baseArr.map((_, i) => (i === axis ? newFactor : (obj.scale[i] / (obj.scale[axis] || newFactor)) * newFactor));
      applyScale(ns);
    } else {
      const ns = [...obj.scale]; ns[axis] = newFactor;
      applyScale(ns);
    }
  };

  const setRealSize = (axis, mm) => {
    if (!obj) return;
    if (!Number.isFinite(mm) || mm <= 0) return;
    const base = baseArr[axis];
    if (!base || base <= 0) return;
    const newFactor = mm / base;
    if (locked) {
      const ns = baseArr.map((_, i) => (i === axis ? newFactor : (obj.scale[i] / (obj.scale[axis] || newFactor)) * newFactor));
      applyScale(ns);
    } else {
      const ns = [...obj.scale]; ns[axis] = newFactor;
      applyScale(ns);
    }
  };

  const labels = ["X", "Y", "Z"];
  return (
    <PopoverShell title={obj ? `Scale — ${obj.name}${multi ? ` +${selectedIds.length - 1}` : ""}` : "Scale"} icon={Scale3D} onClose={onClose} anchor={anchor} testid="scale-popover" width={340}>
      {!obj ? (
        <EmptyMsg>Select an object first.</EmptyMsg>
      ) : (
        <>
          {multi && (
            <div className="text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 leading-snug">
              Scaling the whole selection ({selectedIds.length}). Every member scales by the same factor and spreads outward from <span className="font-semibold">{obj.name}</span> so the assembly grows / shrinks as one unit.
            </div>
          )}
          <label
            className={`flex items-center gap-2 text-[11px] cursor-pointer select-none px-2 py-1.5 rounded border ${
              locked
                ? "bg-orange-500/15 border-orange-500/40 text-orange-200"
                : "bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <input
              data-testid="scale-lock-toggle"
              type="checkbox"
              checked={locked}
              onChange={(e) => setLocked(e.target.checked)}
              className="accent-orange-500"
            />
            {locked
              ? <><Lock size={11} className="text-orange-400" /> Aspect ratio locked — Y/Z auto-update when X changes (and vice versa)</>
              : <><Unlock size={11} className="text-slate-500" /> Free per-axis scaling</>}
          </label>
          <div className="grid grid-cols-[16px_1fr_1fr] gap-2 items-end">
            <div />
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium text-center">Percent</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium text-center">Real Size</div>
            {[0, 1, 2].map((axis) => {
              const factor = obj.scale[axis] || 1;
              const percent = +(factor * 100).toFixed(3);
              const mm = +((baseArr[axis] || 0) * factor).toFixed(3);
              return (
                <React.Fragment key={axis}>
                  <div className="text-[10px] font-semibold text-orange-300 pb-2">{labels[axis]}</div>
                  <NumberField
                    testid={`scale-percent-${labels[axis].toLowerCase()}`}
                    label=""
                    value={percent}
                    onChange={(v) => setPercent(axis, v)}
                    step={10}
                    suffix="%"
                  />
                  <NumberField
                    testid={`scale-mm-${labels[axis].toLowerCase()}`}
                    label=""
                    value={mm}
                    onChange={(v) => setRealSize(axis, v)}
                    step={1}
                    suffix="mm"
                  />
                </React.Fragment>
              );
            })}
          </div>
          <div className="text-[10px] text-slate-500 leading-snug font-mono">
            base size {baseArr[0].toFixed(2)} × {baseArr[1].toFixed(2)} × {baseArr[2].toFixed(2)} mm
          </div>
        </>
      )}
    </PopoverShell>
  );
}

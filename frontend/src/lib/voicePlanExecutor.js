// iter-100.9 — Plan / template step executor.
//
// The voice path can return three shapes from /api/voice/command:
//   1. atomic action — handled by the existing executeCommand path.
//   2. {action:"plan", steps:[...]}                — execute steps in order.
//   3. {action:"template", template_id, params}     — POST to
//      /api/voice/expand-template to get a step list, THEN execute.
//
// Steps are deterministic and selector-driven. Selectors resolve at run
// time against the live scene so a step list emitted in a stateless
// backend can still talk about "all-current" or "all-since:<tag>". This
// keeps the backend templates pure and the frontend the single source
// of scene-state truth.
//
// Selector grammar (resolveTargets):
//   "all-current"          — every object added by THIS plan so far.
//   "all-positives"        — every positive object added by THIS plan.
//   "all-since:<tag>"      — every object added after the step tagged
//                            <tag>, inclusive.
//   "tag:<tag>"            — the specific step tagged <tag>.
//   "step:<index>"         — the step at position <index> (0-based).

import axios from "axios";
import { API } from "./api";
import { useScene } from "./store";
import { combineTwoAsync } from "./workerClient";
import { computeRotatedBBox } from "./geometry";


// Map the LLM/builder step → live scene mutation.
// `state` is the running plan state (ids added so far, tag→id map,
// originalSelection captured at plan start).
export async function executeStep(step, state) {
  const s = useScene.getState();

  // Normalise position / rotation shapes — backends emit
  // `position:[x,y,z]` arrays but the LLM sometimes emits
  // `pos:{x,y,z}` (from the legacy atomic schema). Accept both.
  const pos = _normVec3(step.position ?? step.pos);
  const rot = _normVec3(step.rotation ?? step.rot);

  if (step.action === "add") {
    const id = s.addPrimitive(step.type || "cube", step.modifier === "negative" ? "negative" : "positive");
    if (step.dims && Object.keys(step.dims).length) {
      s.updateDims(id, step.dims);
    }
    if (pos) useScene.setState((sx) => ({
      objects: sx.objects.map((o) => o.id === id ? { ...o, position: pos } : o),
    }));
    if (rot) useScene.setState((sx) => ({
      objects: sx.objects.map((o) => o.id === id ? { ...o, rotation: rot } : o),
    }));
    state.addedIds.push(id);
    if (step.tag) state.tagToId[step.tag] = id;
    state.lastAction = "add";
    return { ok: true, addedId: id };
  }

  if (step.action === "boolean") {
    // Default targets: original selection + everything this plan added.
    // Matches the "subtract these holes from the selected item" intent
    // when the LLM omits targets — which it often does, since the
    // intent is obvious from context.
    let targets = step.targets;
    if (!targets || !targets.length) {
      targets = state.originalSelection.length > 0
        ? ["selected", "all-current"]
        : ["all-current"];
    }
    const ids = resolveTargets(targets, state);
    if (ids.length < 2) return { ok: false, reason: `Boolean needs ≥ 2 targets; got ${ids.length}` };
    const objMap = (id) => useScene.getState().objects.find((o) => o.id === id);
    let accum = objMap(ids[0]);
    for (let i = 1; i < ids.length; i++) {
      const b = objMap(ids[i]);
      if (!accum || !b) return { ok: false, reason: "Lost target mid-bool" };
      const merged = await combineTwoAsync(accum, b, step.op || "subtract");
      // Remember where the OLD accum sat in addedIds so we can put
      // the merged result back in that ORDER slot. Without this, the
      // merged id gets appended to the END of state.addedIds and
      // subsequent steps that target "all-current" iterate negatives
      // BEFORE the running positive → fold-left gives nonsense
      // (cyl − cyl − cyl − positive instead of positive − cyl − cyl).
      const insertAt = state.addedIds.indexOf(accum.id);
      useScene.getState().removeObject(accum.id);
      useScene.getState().removeObject(b.id);
      const newObj = {
        name: `${accum.name || "A"} ${step.op === "union" ? "∪" : step.op === "intersect" ? "∩" : "∖"} ${b.name || "B"}`,
        type: "imported", modifier: "positive", visible: true, locked: false,
        position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dims: {},
        geometry: merged,
      };
      const newId = useScene.getState().addRawObject(newObj);
      state.addedIds = state.addedIds.filter((x) => x !== accum.id && x !== b.id);
      if (insertAt >= 0 && insertAt <= state.addedIds.length) {
        state.addedIds.splice(insertAt, 0, newId);
      } else {
        state.addedIds.push(newId);
      }
      // Rewire any tags pointing at consumed inputs.
      for (const [t, v] of Object.entries(state.tagToId)) {
        if (v === accum.id || v === b.id) state.tagToId[t] = newId;
      }
      // The original selection becomes the merged result if it was an
      // input — otherwise the user's reference would dangle.
      state.originalSelection = state.originalSelection.map((x) =>
        (x === accum.id || x === b.id) ? newId : x
      );
      accum = useScene.getState().objects.find((o) => o.id === newId);
    }
    state.lastAction = "boolean";
    return { ok: true, mergedId: accum?.id };
  }

  if (step.action === "group") {
    const ids = resolveTargets(step.targets || ["all-current"], state);
    if (ids.length === 0) return { ok: false, reason: "Group target empty" };
    useScene.setState({ selectedIds: ids, selectedId: ids[ids.length - 1] });
    useScene.getState().groupSelected(step.name || "Assembly");
    state.lastAction = "group";
    return { ok: true };
  }

  if (step.action === "translate") {
    const d = step.delta || {};
    const ids = resolveTargets(step.targets || ["all-current"], state);
    useScene.setState({ selectedIds: ids, selectedId: ids[ids.length - 1] || null });
    if (ids.length) useScene.getState().translateSelected([d.x || 0, d.y || 0, d.z || 0]);
    return { ok: true };
  }

  if (step.action === "rotate") {
    const d = step.delta || {};
    const ids = resolveTargets(step.targets || ["all-current"], state);
    useScene.setState({ selectedIds: ids, selectedId: ids[ids.length - 1] || null });
    if (ids.length) useScene.getState().rotateSelected([d.x || 0, d.y || 0, d.z || 0]);
    return { ok: true };
  }

  return { ok: false, reason: `Unknown step action: ${step.action}` };
}


// Accept either an [x,y,z] array or a {x,y,z} object. Returns a fresh
// 3-element array or null if neither form is recognisable.
function _normVec3(v) {
  if (!v) return null;
  if (Array.isArray(v)) {
    if (v.length !== 3) return null;
    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  }
  if (typeof v === "object") {
    return [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
  }
  return null;
}


// Selector grammar resolver. State is the running plan state.
function resolveTargets(targets, state) {
  const liveIds = new Set(useScene.getState().objects.map((o) => o.id));
  const out = [];
  const push = (id) => { if (id && liveIds.has(id) && !out.includes(id)) out.push(id); };
  for (const t of targets) {
    if (t === "all-current") {
      state.addedIds.forEach(push);
    } else if (t === "all-positives") {
      const objs = useScene.getState().objects.filter((o) => state.addedIds.includes(o.id));
      objs.filter((o) => o.modifier === "positive").forEach((o) => push(o.id));
    } else if (t === "selected") {
      // Selection captured at plan start — survives intervening adds.
      state.originalSelection.forEach(push);
    } else if (t.startsWith("tag:")) {
      push(state.tagToId[t.slice(4)]);
    } else if (t.startsWith("step:")) {
      const idx = parseInt(t.slice(5), 10);
      if (Number.isFinite(idx)) push(state.addedIds[idx]);
    } else if (t.startsWith("all-since:")) {
      const tag = t.slice(10);
      const anchor = state.tagToId[tag];
      if (anchor) {
        const i = state.addedIds.indexOf(anchor);
        if (i >= 0) state.addedIds.slice(i).forEach(push);
      }
    }
  }
  return out;
}


// Execute an ordered step list. Wrapped in a single history checkpoint
// so the entire plan is one undo entry.
export async function executePlan(steps, { onProgress } = {}) {
  const live = useScene.getState();
  const originalSelection = (
    live.selectedIds.length ? live.selectedIds : (live.selectedId ? [live.selectedId] : [])
  ).slice();
  const state = {
    addedIds: [],
    tagToId: {},
    lastAction: null,
    originalSelection,
  };
  useScene.getState().pushHistory && useScene.getState().pushHistory("voice-plan");
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const r = await executeStep(step, state);
      results.push({ index: i, step, ...r });
      if (onProgress) onProgress({ index: i, total: steps.length, step, result: r });
      if (!r.ok) {
        return { ok: false, executed: i, total: steps.length, results };
      }
    } catch (e) {
      results.push({ index: i, step, ok: false, reason: e.message || String(e) });
      return { ok: false, executed: i, total: steps.length, results };
    }
  }
  return { ok: true, executed: steps.length, total: steps.length, results };
}


// Resolve a template into a step list by calling the backend.
export async function expandTemplate(templateId, params) {
  const { data } = await axios.post(`${API}/voice/expand-template`, {
    template_id: templateId,
    params: params || {},
  });
  return data; // {template_id, steps, summary}
}


// Snapshot the scene for the LLM prompt. Cheap to compute, sized to be
// tiny in JSON so we don't bloat the request payload.
export function getSceneSnapshot() {
  const s = useScene.getState();
  const selIds = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
  const sel = { count: selIds.length };
  if (selIds.length) {
    let mn = [Infinity, Infinity, Infinity];
    let mx = [-Infinity, -Infinity, -Infinity];
    for (const id of selIds) {
      const obj = s.objects.find((o) => o.id === id);
      if (!obj) continue;
      try {
        const bb = computeRotatedBBox(obj);
        if (bb && bb.min && bb.max) {
          mn = mn.map((v, i) => Math.min(v, bb.min[i]));
          mx = mx.map((v, i) => Math.max(v, bb.max[i]));
        }
      } catch { /* skip — bbox failure shouldn't break the snapshot */ }
    }
    if (Number.isFinite(mn[0])) {
      sel.bbox = {
        min: mn.map((v) => Math.round(v * 100) / 100),
        max: mx.map((v) => Math.round(v * 100) / 100),
      };
    }
  }
  return {
    selection: sel,
    build_volume: { x: s.buildVolume.x, y: s.buildVolume.y, z: s.buildVolume.z },
    object_count: s.objects.length,
    mode: s.transformMode || "translate",
  };
}

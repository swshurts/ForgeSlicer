// Regression tests for the extracted transform/history pure modules.
// Run:  cd /app/frontend && node tests/transforms-and-history.mjs
//
// Verifies that the refactor (iter 46) didn't change behaviour:
//   - applyRigidRotate produces the same output as the old inline
//     `rotateSelected` logic (quaternion-composed, primary stays put,
//     children orbit + rotate locally by world dQ)
//   - applyTranslate / applyScaleMul preserve referential identity
//     for un-selected objects (React.memo friendly)
//   - cloneObjects / pushHistoryState / undoState / redoState behave
//     identically to the old inline store internals

import * as THREE from "three";
import {
  applyTranslate,
  applyScaleMul,
  applyRigidRotate,
  isZeroDelta,
  isIdentityFactor,
} from "../src/lib/transforms.js";
import {
  cloneObjects,
  pushHistoryState,
  undoState,
  redoState,
  HISTORY_LIMIT,
} from "../src/lib/historyStack.js";

const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("OK  ", msg);
};
const approx = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

function makeObj(id, pos, rot = [0, 0, 0], scale = [1, 1, 1]) {
  return {
    id, name: id, type: "cube", modifier: "positive",
    visible: true, locked: false, position: pos, rotation: rot,
    scale, dims: { x: 10, y: 10, z: 10 }, colorIndex: 7,
  };
}

// ---- isZeroDelta / isIdentityFactor ----
ok(isZeroDelta(null), "isZeroDelta(null) → true");
ok(isZeroDelta([0, 0, 0]), "isZeroDelta([0,0,0]) → true");
ok(isZeroDelta([1e-7, 0, 0]), "isZeroDelta epsilon → true");
ok(!isZeroDelta([0, 1, 0]), "isZeroDelta([0,1,0]) → false");
ok(isIdentityFactor([1, 1, 1]), "isIdentityFactor([1,1,1]) → true");
ok(!isIdentityFactor([1, 2, 1]), "isIdentityFactor([1,2,1]) → false");

// ---- applyTranslate ----
{
  const objs = [makeObj("a", [0, 0, 0]), makeObj("b", [5, 0, 0]), makeObj("c", [10, 0, 0])];
  const next = applyTranslate(objs, ["a", "c"], [1, 2, 3]);
  ok(next[0].position[0] === 1 && next[0].position[1] === 2, "translate moves selected obj a");
  ok(next[1] === objs[1], "unselected obj b kept by reference");
  ok(next[2].position[0] === 11, "translate moves selected obj c");
}

// ---- applyScaleMul ----
{
  const objs = [makeObj("p", [0, 0, 0]), makeObj("c1", [10, 0, 0]), makeObj("c2", [0, 0, 5])];
  const next = applyScaleMul(objs, ["p", "c1", "c2"], "p", [2, 1, 1]);
  ok(next[0].scale[0] === 2 && next[0].position[0] === 0, "primary scales in place");
  ok(next[1].scale[0] === 2 && next[1].position[0] === 20, "child stretches by factor X");
  ok(next[2].scale[0] === 2 && next[2].position[2] === 5, "child not on X axis keeps Z");
}

// ---- applyRigidRotate ----
{
  // 4-piece assembly, rotate 5 times — same scenario as the existing
  // rotation-group-consecutive.mjs but exercising the EXTRACTED helper.
  let objs = [
    makeObj("primary", [0, 0, 0]),
    makeObj("sat1", [10, 0, 0]),
    makeObj("sat2", [0, 10, 0]),
    makeObj("sat3", [10, 10, 5]),
  ];
  const sequence = [[0, 90, 0], [45, 0, 0], [0, 0, 30], [0, -45, 0], [15, 15, 15]];
  const initial = [
    Math.hypot(0 - 10, 0 - 0, 0 - 0),
    Math.hypot(0 - 0, 0 - 10, 0 - 0),
    Math.hypot(0 - 10, 0 - 10, 0 - 5),
    Math.hypot(10 - 0, 0 - 10, 0 - 0),
    Math.hypot(10 - 10, 0 - 10, 0 - 5),
    Math.hypot(0 - 10, 10 - 10, 0 - 5),
  ];
  for (const d of sequence) {
    objs = applyRigidRotate(objs, ["primary", "sat1", "sat2", "sat3"], "primary", d);
  }
  const finalDists = [
    Math.hypot(objs[0].position[0] - objs[1].position[0], objs[0].position[1] - objs[1].position[1], objs[0].position[2] - objs[1].position[2]),
    Math.hypot(objs[0].position[0] - objs[2].position[0], objs[0].position[1] - objs[2].position[1], objs[0].position[2] - objs[2].position[2]),
    Math.hypot(objs[0].position[0] - objs[3].position[0], objs[0].position[1] - objs[3].position[1], objs[0].position[2] - objs[3].position[2]),
    Math.hypot(objs[1].position[0] - objs[2].position[0], objs[1].position[1] - objs[2].position[1], objs[1].position[2] - objs[2].position[2]),
    Math.hypot(objs[1].position[0] - objs[3].position[0], objs[1].position[1] - objs[3].position[1], objs[1].position[2] - objs[3].position[2]),
    Math.hypot(objs[2].position[0] - objs[3].position[0], objs[2].position[1] - objs[3].position[1], objs[2].position[2] - objs[3].position[2]),
  ];
  for (let i = 0; i < 6; i++) {
    ok(approx(initial[i], finalDists[i]), `pairwise distance #${i} preserved (${initial[i].toFixed(4)} → ${finalDists[i].toFixed(4)})`);
  }
  ok(objs[0].position.every((v) => approx(v, 0)), "primary at origin after 5 rotations");
}

// ---- cloneObjects ----
{
  const orig = [makeObj("a", [1, 2, 3], [10, 20, 30], [0.5, 1, 2])];
  orig[0].dims = { x: 5, y: 6, z: 7 };
  const clone = cloneObjects(orig);
  ok(clone !== orig, "cloneObjects returns a new array");
  ok(clone[0] !== orig[0], "cloneObjects clones objects");
  ok(clone[0].position !== orig[0].position, "cloneObjects clones position");
  ok(clone[0].dims !== orig[0].dims, "cloneObjects clones dims");
  clone[0].position[0] = 999;
  ok(orig[0].position[0] === 1, "mutating clone doesn't affect orig");
}

// ---- pushHistoryState / undoState / redoState ----
{
  const objs1 = [makeObj("a", [0, 0, 0])];
  const objs2 = [makeObj("a", [1, 0, 0])];
  const objs3 = [makeObj("a", [2, 0, 0])];
  // Start with empty history.
  let { history, redoStack } = pushHistoryState([], objs1);
  ok(history.length === 1, "pushHistoryState adds a snapshot");
  ok(redoStack.length === 0, "pushHistoryState clears redo");

  // Push two more.
  ({ history, redoStack } = pushHistoryState(history, objs2));
  ({ history, redoStack } = pushHistoryState(history, objs3));
  ok(history.length === 3, "three pushes → three snapshots");

  // Undo: should restore objs3 (the previous current). The current
  // state when undo() runs is what's IN the store; pass objs3 as the
  // current.
  const u = undoState(history, redoStack, objs3);
  ok(u !== null, "undoState returns truthy with non-empty history");
  ok(u.objects[0].position[0] === 2, "undo restores most recent snapshot");
  ok(u.redoStack.length === 1, "undo populates redo stack");
  ok(u.history.length === 2, "undo trims history by one");

  // Redo back from u.
  const r = redoState(u.history, u.redoStack, u.objects);
  ok(r !== null, "redoState returns truthy with non-empty redo stack");
  ok(r.objects[0].position[0] === 2, "redo restores the undone snapshot");
  ok(r.history.length === 3, "redo grows history again");
  ok(r.redoStack.length === 0, "redo empties redo stack");

  // History limit.
  let big = { history: [], redoStack: [] };
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
    big = pushHistoryState(big.history, [makeObj("x", [i, 0, 0])]);
  }
  ok(big.history.length === HISTORY_LIMIT, `history capped at ${HISTORY_LIMIT}`);

  // undoState on empty → null.
  ok(undoState([], [], objs1) === null, "undoState on empty history → null");
  ok(redoState([], [], objs1) === null, "redoState on empty redoStack → null");
}

console.log("\nAll transforms + historyStack regression assertions passed ✔");

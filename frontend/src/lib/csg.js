import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { buildGeometry, applyTransform } from "./geometry";

const OP_MAP = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };

function makeBrush(obj) {
  const geom = buildGeometry(obj);
  const mat = new THREE.MeshStandardMaterial();
  const b = new Brush(geom, mat);
  applyTransform(b, obj);
  return b;
}

/**
 * Apply scene modifiers to produce a single merged BufferGeometry.
 * Positives are unioned, negatives subtracted in order.
 * Returns: { geometry: BufferGeometry, triangleCount, empty:boolean }
 */
export function evaluateScene(objects) {
  const visibles = objects.filter((o) => o.visible !== false);
  const positives = visibles.filter((o) => o.modifier !== "negative");
  const negatives = visibles.filter((o) => o.modifier === "negative");

  if (positives.length === 0) {
    return { geometry: new THREE.BufferGeometry(), triangleCount: 0, empty: true };
  }

  const evaluator = new Evaluator();
  evaluator.useGroups = false;

  let result = makeBrush(positives[0]);

  for (let i = 1; i < positives.length; i++) {
    const b = makeBrush(positives[i]);
    result = evaluator.evaluate(result, b, ADDITION);
  }

  for (const n of negatives) {
    const b = makeBrush(n);
    result = evaluator.evaluate(result, b, SUBTRACTION);
  }

  // Bake world matrix into geometry
  const baked = result.geometry.clone();
  baked.applyMatrix4(result.matrixWorld);
  baked.computeVertexNormals();

  const triCount = baked.index
    ? baked.index.count / 3
    : baked.attributes.position.count / 3;

  return { geometry: baked, triangleCount: Math.floor(triCount), empty: false };
}

/**
 * Apply boolean op on two specific objects (selected pair). Returns merged
 * geometry as an "imported" object replacement.
 */
export function combineTwo(a, b, op) {
  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  const ba = makeBrush(a);
  const bb = makeBrush(b);
  const operation = OP_MAP[op] || ADDITION;
  const r = evaluator.evaluate(ba, bb, operation);
  const baked = r.geometry.clone();
  baked.applyMatrix4(r.matrixWorld);
  baked.computeVertexNormals();
  const pos = baked.attributes.position.array;
  const indices = baked.index ? baked.index.array : null;
  return {
    vertices: new Float32Array(pos),
    indices: indices ? new Uint32Array(indices) : null,
  };
}
